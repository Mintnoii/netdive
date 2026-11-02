
async function run() {
  const bridgeUrl = 'http://127.0.0.1:4560/api/telemetry'

  // 会话 1: 微信灵感收录 (Hermes -> Pi -> Tachikoma)
  const ses1 = 'session-wx-spark-101'
  const events1 = [
    {
      traceId: 'tr-101',
      sessionId: ses1,
      sessionTitle: '微信灵感收录: BEAT 架构讨论',
      project: 'tachikoma',
      nodeId: 'node-h1',
      actor: 'Hermes (ClawBot)',
      gesture: 'think' as const,
      title: '接收微信消息并萃取意图',
      type: 'node_complete' as const,
      status: 'completed' as const,
    },
    {
      traceId: 'tr-101',
      sessionId: ses1,
      project: 'tachikoma',
      nodeId: 'node-p1',
      actor: 'Pi (Coordinator)',
      gesture: 'read' as const,
      title: '调用 Tachikoma 语义分类',
      type: 'node_complete' as const,
      status: 'completed' as const,
    },
    {
      traceId: 'tr-101',
      sessionId: ses1,
      project: 'tachikoma',
      nodeId: 'node-t1',
      actor: 'Tachikoma (Engine)',
      gesture: 'edit' as const,
      title: '落库 Sparks [咬文嚼字]',
      type: 'node_complete' as const,
      status: 'completed' as const,
    },
  ]

  // 会话 2: Ghost 异常治理 (Pi -> Claude)
  const ses2 = 'session-ghost-refactor-202'
  const events2 = [
    {
      traceId: 'tr-202',
      sessionId: ses2,
      sessionTitle: 'Ghost pipeline 异常捕获重构',
      project: 'Ghost',
      nodeId: 'node-g1',
      actor: 'Pi (Coordinator)',
      gesture: 'think' as const,
      title: '规划代码重构步骤',
      type: 'node_complete' as const,
      status: 'completed' as const,
    },
    {
      traceId: 'tr-202',
      sessionId: ses2,
      project: 'Ghost',
      nodeId: 'node-c1',
      actor: 'Claude 3.7 (Worker)',
      gesture: 'edit' as const,
      title: '替换 try-catch 为 radash.tryit',
      type: 'node_complete' as const,
      status: 'completed' as const,
    },
  ]

  console.log('--- 发射交错并发事件流 ---')
  const stream = [events1[0], events2[0], events1[1], events2[1], events1[2]]
  for (const e of stream) {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(e),
    })
    console.log(`Delivered [${e.nodeId}] to [${e.sessionId}] -> status: ${res.status}`)
  }
}

run().catch(console.error)
