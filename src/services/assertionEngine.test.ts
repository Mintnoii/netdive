import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  AssertionEngine,
  assertionEngine,
  matchHighRiskCommand,
  detectAstError,
  detectTimeoutOrDeadlock,
  detectSchemaError,
  computeFailureSignature,
  type ToolExecutionContext,
} from './assertionEngine'
import type { TelemetryEvent } from '../types/telemetry'

describe('L1 Deterministic Assertion Engine Unit Tests', () => {
  let engine: AssertionEngine

  beforeEach(() => {
    engine = new AssertionEngine()
  })

  describe('Rule 1: Non-zero exit code (exitCode !== 0)', () => {
    it('exitCode === 0 passes all assertions', () => {
      const res = engine.evaluate({
        tool: 'bash',
        command: 'pnpm test:pipeline',
        exitCode: 0,
        output: ['Tests: 156 passed, 156 total'],
      })

      assert.equal(res.passed, true)
      assert.equal(res.triggerSelfCorrection, false)
      assert.equal(res.triggerGate, false)
      assert.equal(res.severity, 'info')
      assert.match(res.reason || '', /Execution passed/i)
    })

    it('exitCode === 1 triggers Self-Correction branching immediately', () => {
      const res = engine.evaluate({
        tool: 'bash',
        command: 'pnpm test:pipeline',
        exitCode: 1,
        output: ['AssertionError: Expected 200 OK, got 500 Internal Error'],
      })

      assert.equal(res.passed, false)
      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.triggerGate, false)
      assert.equal(res.severity, 'warn')
      assert.equal(res.rule, 'exit_code')
      assert.match(res.reason || '', /Non-zero exit code \(1\) detected/i)
      assert.equal(res.failureCount, 1)
    })

    it('exitCode === 127 (command not found) triggers Self-Correction branching', () => {
      const res = engine.evaluate({
        tool: 'bash',
        command: 'foobar-cli run',
        exitCode: 127,
        output: ['sh: foobar-cli: command not found'],
      })

      assert.equal(res.passed, false)
      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.triggerGate, false)
      assert.equal(res.severity, 'warn')
      assert.match(res.reason || '', /Non-zero exit code \(127\) detected/i)
    })
  })

  describe('Rule 2: Repetitive failure loop detector (Fatal Failure Resonance)', () => {
    it('identical failure caught >= 2 times flags Fatal Failure Resonance and forces gate interception', () => {
      const failingExecution: ToolExecutionContext = {
        tool: 'bash',
        command: 'pnpm test:core',
        exitCode: 1,
        output: ['AssertionError: Expected true, got false'],
      }

      // First failure: count = 1 -> triggers self-correction
      const firstRes = engine.evaluate(failingExecution)
      assert.equal(firstRes.passed, false)
      assert.equal(firstRes.triggerSelfCorrection, true)
      assert.equal(firstRes.triggerGate, false)
      assert.equal(firstRes.severity, 'warn')
      assert.equal(firstRes.failureCount, 1)

      // Second failure with IDENTICAL signature: count = 2 -> Fatal Failure Resonance
      const secondRes = engine.evaluate(failingExecution)
      assert.equal(secondRes.passed, false)
      assert.equal(secondRes.triggerSelfCorrection, false) // Stops futile self-reflection!
      assert.equal(secondRes.triggerGate, true)            // Forces emergency gate!
      assert.equal(secondRes.severity, 'critical')
      assert.equal(secondRes.rule, 'resonance_loop')
      assert.equal(secondRes.failureCount, 2)
      assert.match(secondRes.reason || '', /Fatal Failure Resonance/i)
      assert.match(secondRes.reason || '', /caught 2 times/i)

      // Third failure with same signature remains in critical gate interception
      const thirdRes = engine.evaluate(failingExecution)
      assert.equal(thirdRes.triggerGate, true)
      assert.equal(thirdRes.triggerSelfCorrection, false)
      assert.equal(thirdRes.failureCount, 3)
    })

    it('different failures do not trigger resonance loop on first encounter', () => {
      const failureA: ToolExecutionContext = {
        tool: 'bash',
        command: 'pnpm test:unit',
        exitCode: 1,
        output: ['NullPointerException in auth.ts'],
      }

      const failureB: ToolExecutionContext = {
        tool: 'bash',
        command: 'pnpm test:e2e',
        exitCode: 1,
        output: ['Connection refused at port 8080'],
      }

      const resA = engine.evaluate(failureA)
      assert.equal(resA.triggerSelfCorrection, true)
      assert.equal(resA.triggerGate, false)
      assert.equal(resA.failureCount, 1)

      const resB = engine.evaluate(failureB)
      assert.equal(resB.triggerSelfCorrection, true)
      assert.equal(resB.triggerGate, false)
      assert.equal(resB.failureCount, 1)
    })

    it('clearHistory and reset resets the failure history counter', () => {
      const failingExecution: ToolExecutionContext = {
        command: 'pnpm test',
        exitCode: 1,
        output: ['Failed test'],
      }

      engine.evaluate(failingExecution)
      assert.equal(engine.getFailureCount(failingExecution), 1)

      engine.clearHistory()
      assert.equal(engine.getFailureCount(failingExecution), 0)

      // Next failure starts at 1 again
      const nextRes = engine.evaluate(failingExecution)
      assert.equal(nextRes.triggerSelfCorrection, true)
      assert.equal(nextRes.triggerGate, false)
      assert.equal(nextRes.failureCount, 1)
    })
  })

  describe('Rule 3: High-risk command pattern assertion (Human Gate Defense)', () => {
    it('git commit pattern automatically asserts need for Human Gate interception', () => {
      const commands = [
        'git commit -m "feat(core): update pipeline"',
        'git commit --amend',
        'GIT COMMIT -m "uppercase test"',
      ]

      for (const cmd of commands) {
        const res = engine.evaluate({ command: cmd, exitCode: 0 })
        assert.equal(res.passed, false, `Expected ${cmd} to fail automatic pass`)
        assert.equal(res.triggerGate, true, `Expected ${cmd} to trigger gate`)
        assert.equal(res.triggerSelfCorrection, false)
        assert.equal(res.severity, 'critical')
        assert.equal(res.rule, 'high_risk_gate')
        assert.match(res.reason || '', /High-risk command pattern assertion triggered/i)
      }
    })

    it('rm -rf and destructive filesystem commands trigger Human Gate', () => {
      const destructiveCommands = [
        'rm -rf /',
        'rm -rf node_modules dist',
        'rm -r /var/log',
        'rmdir /s /q temp',
        'chmod -R 777 /app',
      ]

      for (const cmd of destructiveCommands) {
        const res = engine.evaluate({ command: cmd })
        assert.equal(res.triggerGate, true, `Expected ${cmd} to trigger gate`)
        assert.equal(res.severity, 'critical')
      }
    })

    it('destructive database commands trigger Human Gate', () => {
      const dbCommands = [
        'DROP TABLE users;',
        'drop database production;',
        'truncate table audit_logs',
        'DELETE FROM accounts',
      ]

      for (const cmd of dbCommands) {
        const res = engine.evaluate({ command: cmd })
        assert.equal(res.triggerGate, true, `Expected ${cmd} to trigger gate`)
        assert.equal(res.severity, 'critical')
      }
    })

    it('safe commands do not trigger high-risk gate', () => {
      const safeCommands = [
        'pnpm test',
        'git status',
        'git diff',
        'ls -la',
        'cat package.json',
      ]

      for (const cmd of safeCommands) {
        const res = engine.evaluate({ command: cmd, exitCode: 0 })
        assert.equal(res.triggerGate, false, `Expected ${cmd} to NOT trigger gate`)
        assert.equal(res.passed, true)
      }
    })
  })

  describe('AST error patterns & Schema validity & Timeout/Deadlock evaluation', () => {
    it('detects AST syntax error and triggers Self-Correction branching', () => {
      const res = engine.evaluate({
        tool: 'bash',
        command: 'node src/index.js',
        output: [
          'SyntaxError: Unexpected token < in JSON at position 0',
          'at Object.parse (native)',
        ],
      })

      assert.equal(res.passed, false)
      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.triggerGate, false)
      assert.equal(res.rule, 'ast_error')
      assert.match(res.reason || '', /AST error pattern detected/i)
    })

    it('detects timeout (exit code 124 or ETIMEDOUT) and triggers Self-Correction', () => {
      const resTimeoutCode = engine.evaluate({
        tool: 'bash',
        command: 'timeout 10s sleep 60',
        exitCode: 124,
      })
      assert.equal(resTimeoutCode.triggerSelfCorrection, true)
      assert.equal(resTimeoutCode.rule, 'timeout_deadlock')

      const resTimeoutOutput = engine.evaluate({
        tool: 'bash',
        command: 'curl http://slow-service.internal',
        output: ['Error: connect ETIMEDOUT 10.0.0.1:80'],
      })
      assert.equal(resTimeoutOutput.triggerSelfCorrection, true)
      assert.equal(resTimeoutOutput.rule, 'timeout_deadlock')
    })

    it('detects deadlock pattern in output and triggers Self-Correction', () => {
      const res = engine.evaluate({
        tool: 'bash',
        command: 'pnpm migrate',
        output: ['FATAL: deadlock detected in transaction #1042'],
      })

      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.rule, 'timeout_deadlock')
    })

    it('detects schema validation failure', () => {
      const res = engine.evaluate({
        tool: 'bash',
        command: 'pnpm validate',
        output: ['ValidationError: missing required property "version" in payload schema'],
      })

      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.rule, 'schema_invalid')
    })

    it('evaluates custom schemaValidator function', () => {
      const invalidPayload = { id: 123 }
      const res = engine.evaluate({
        payload: invalidPayload,
        schemaValidator: (d: any) => typeof d?.title === 'string',
      })

      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.rule, 'schema_invalid')
    })
  })

  describe('TelemetryEvent Integration & Utilities', () => {
    it('evaluates TelemetryEvent object directly with correct normalization', () => {
      const event: TelemetryEvent = {
        traceId: 'trace-101',
        nodeId: 'node-101',
        type: 'node_complete',
        gesture: 'bash',
        title: 'Run test suite',
        observation: {
          exitCode: 1,
          output: ['AssertionError: Expected 200, got 404'],
        },
      }

      const res = engine.evaluate(event)
      assert.equal(res.passed, false)
      assert.equal(res.triggerSelfCorrection, true)
      assert.equal(res.rule, 'exit_code')
    })

    it('evaluates gate_prompt TelemetryEvent with high-risk command', () => {
      const event: TelemetryEvent = {
        traceId: 'trace-gate-1',
        nodeId: 'node-gate-1',
        type: 'gate_prompt',
        gesture: 'gate',
        title: 'Git Commit Review',
        gatePayload: {
          gateId: 'gate-commit',
          title: 'Git Commit',
          riskLevel: 'high',
          proposedAction: {
            command: 'git commit -m "feat(telemetry): add assertion engine"',
            explanation: 'Ready to commit',
          },
          timestamp: new Date().toISOString(),
        },
      }

      const res = engine.evaluate(event)
      assert.equal(res.triggerGate, true)
      assert.equal(res.severity, 'critical')
      assert.equal(res.rule, 'high_risk_gate')
    })

    it('singleton assertionEngine is exported and ready for application-wide use', () => {
      assert.ok(assertionEngine instanceof AssertionEngine)
      assertionEngine.reset()
      const testRes = assertionEngine.evaluate({ exitCode: 0 })
      assert.equal(testRes.passed, true)
    })

    it('exported helper functions work as expected', () => {
      const highRisk = matchHighRiskCommand('rm -rf /test')
      assert.equal(highRisk.matched, true)

      const safe = matchHighRiskCommand('pnpm run build')
      assert.equal(safe.matched, false)

      const astErr = detectAstError(['SyntaxError: invalid token'])
      assert.ok(astErr)

      const timeoutErr = detectTimeoutOrDeadlock([], 124)
      assert.ok(timeoutErr)

      const schemaErr = detectSchemaError(['ValidationError: invalid body'])
      assert.ok(schemaErr)

      const signature = computeFailureSignature({
        command: 'pnpm test',
        exitCode: 1,
        output: ['Fail line 1'],
      })
      assert.ok(signature.includes('pnpm test::exit_1'))
    })
  })
})
