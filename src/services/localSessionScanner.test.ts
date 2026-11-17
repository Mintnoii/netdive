/**
 * @file src/services/localSessionScanner.test.ts
 * @description 本地会话扫描纯函数契约测试
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import {
  countTranscriptLines,
  extractSessionTitle,
  readLocalTranscript,
  resolveProjectName,
  resolveSessionId,
  scanLocalSessions,
} from './localSessionScanner'

const SESSION_UUID = '01a195f4-beb3-75a8-9165-bffa1e306b28'

/** 构造合法 JSONL 行集合 */
function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

describe('Local Session Scanner 纯函数契约', () => {
  let root: string

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'netdive-scan-'))
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('目录不存在时返回空集合，不抛异常', () => {
    assert.deepEqual(scanLocalSessions(30, join(root, 'not-exists')), [])
    assert.equal(readLocalTranscript('missing-id', join(root, 'not-exists')), null)
  })

  it('由目录名解析工程名，命中工作区命名规约', () => {
    assert.equal(resolveProjectName('--C--Users-wangqing-Desktop-netdive--'), 'netdive')
    assert.equal(resolveProjectName('--C--Users-wangqing-workspaces-ghost--'), 'ghost')
    assert.equal(resolveProjectName('--plain-folder--'), 'plain-folder')
  })

  it('由文件名解析会话 ID，UUID 优先并退化去扩展名', () => {
    assert.equal(resolveSessionId(`2026-11-01T07-13-27-219Z_${SESSION_UUID}.jsonl`), SESSION_UUID)
    assert.equal(resolveSessionId('no-uuid.jsonl'), 'no-uuid')
  })

  it('非空行计数忽略空行与尾随换行', () => {
    assert.equal(countTranscriptLines('a\n\n b \n'), 2)
  })

  it('标题优先级：session.title 高于首条 user 消息高于文件名', () => {
    const withSession = jsonl([
      { type: 'message', message: { role: 'user', content: '用户首问意图' } },
      { type: 'session', title: '会话正式标题' },
    ])
    assert.equal(extractSessionTitle(withSession, 'fallback'), '会话正式标题')

    const withUser = jsonl([
      { type: 'message', message: { role: 'user', content: '帮我重构一下解析器\n第二行内容' } },
    ])
    assert.equal(extractSessionTitle(withUser, 'fallback'), '帮我重构一下解析器')

    assert.equal(extractSessionTitle(jsonl([{ type: 'noop' }]), 'fallback'), 'fallback')
  })

  it('脏 JSONL 行自愈跳过，不中断整轮扫描', () => {
    const dirty = ['{"type":"session","title":"脏行也能解析"}', '{坏行', ''].join('\n')
    assert.equal(extractSessionTitle(dirty, 'fallback'), '脏行也能解析')
  })

  it('超长标题截断为 36 字 + 省略号', () => {
    const longTitle = '标题'.repeat(40)
    const title = extractSessionTitle(
      jsonl([{ type: 'message', message: { role: 'user', content: longTitle } }]),
      'fallback'
    )
    assert.equal(title.length, 39, '36 字正文 + 3 位省略号')
    assert.ok(title.endsWith('...'))
  })

  it('扫描按 mtime 倒序并遵守 limit 截断', () => {
    const folder = join(root, '--C--Users-demo-Desktop-netdive--')
    mkdirSync(folder, { recursive: true })

    writeFileSync(
      join(folder, `older_${SESSION_UUID}.jsonl`),
      jsonl([{ type: 'session', title: '旧会话' }, { type: 'message' }]),
      'utf-8'
    )
    writeFileSync(
      join(folder, 'newest.jsonl'),
      jsonl([{ type: 'session', title: '新会话' }, { type: 'message' }, { type: 'message' }]),
      'utf-8'
    )

    const all = scanLocalSessions(30, root)
    assert.equal(all.length, 2)
    assert.equal(all[0].project, 'netdive')
    assert.equal(all[0].lineCount, 3)

    const limited = scanLocalSessions(1, root)
    assert.equal(limited.length, 1)
    assert.equal(limited[0].mtime, all[0].mtime)
  })

  it('按会话 ID 命中读取全文，未命中返回 null', () => {
    const raw = readLocalTranscript(SESSION_UUID, root)
    assert.ok(raw?.includes('旧会话'))

    assert.equal(readLocalTranscript('00000000-0000-0000-0000-000000000000', root), null)
  })
})
