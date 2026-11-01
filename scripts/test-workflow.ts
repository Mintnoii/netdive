async function runRealWorkflow() {
  const BRIDGE = 'http://127.0.0.1:4560'
  console.log('🚀 Agent 启动：开始执行真实工作流任务...\n')

  // 1. 发射思考与规划动作
  console.log('-> 1. 正在上报 Agent 规划与意图...')
  await fetch(`${BRIDGE}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'real-node-1',
      traceId: 'trace-demo-1',
      title: '目标拆解与安全边界分析',
      actor: 'Pi Agent (Real CLI)',
      gesture: 'think',
      type: 'node_complete',
      status: 'completed',
      payload: { plan: '排查并重构 pipeline 异常兜底，严禁破坏存量测试' },
    }),
  })
  console.log('   ✅ 步骤 1 上报成功！')
  await new Promise((r) => setTimeout(r, 1200))

  // 2. 发射只读 bash 探测
  console.log('-> 2. 正在执行只读命令 (git status)...')
  await fetch(`${BRIDGE}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'real-node-2',
      parentId: 'real-node-1',
      traceId: 'trace-demo-1',
      title: '只读环境探测',
      actor: 'Claude Worker',
      gesture: 'bash',
      type: 'node_complete',
      status: 'completed',
      observation: {
        command: 'git status -s',
        // 验证非标多行字符串输出格式自动兼容与规约 (Robust string output normalization)
        output: 'M package.json\nM src/App.tsx\n?? test.log',
        exitCode: 0,
      },
    }),
  })
  console.log('   ✅ 步骤 2 探测完成！')
  await new Promise((r) => setTimeout(r, 1200))

  // 3. 触发敏感操作：Agent 调用决策门禁 RPC，协程挂起！
  console.log('\n⚠️ 遇到敏感高危操作：Agent 拟执行 git commit！')
  console.log('⏳ 进程已跨进程挂起 (Pending)，请前往浏览器界面 (http://localhost:5173) 查看！')
  console.log('👉 网页上会弹出审批弹窗，等待你在网页上点击【批准放行】或【拒绝拦截】...\n')

  const gateRes = await fetch(`${BRIDGE}/api/gate/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'real-node-3',
      parentId: 'real-node-2',
      gateId: 'gate-commit-verify',
      title: '代码提交安全审查门禁 (Git Commit)',
      riskLevel: 'critical',
      proposedAction: {
        command: "git commit -m 'feat: safe pipeline update'",
        diff: '+ 2 insertions(+), - 1 deletion(-)\nAll 64 tests passed.',
        explanation: 'Agent 已经完成重构并跑通单测，请求人类操作员授权进行本地 Commit。',
      },
    }),
  })

  const decision = await gateRes.json()
  console.log('==========================================')
  console.log('🎉 收到来自浏览器网页端的人类决策！')
  console.log('决策详情:', JSON.stringify(decision, null, 2))

  if (decision.action === 'approve') {
    console.log('🟢 结论：人类批准放行！Agent 恢复运行，继续推进后续任务。')

    // 4. 人类批准后，Agent 继续执行后续动作并上报拓扑收敛
    console.log('-> 4. 正在执行后续操作：安全写入与任务收敛...')
    await new Promise((r) => setTimeout(r, 1000))

    await fetch(`${BRIDGE}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: 'real-node-4',
        parentId: 'real-node-3',
        traceId: 'trace-demo-1',
        title: '交付归档与演进沉淀',
        actor: 'Pi (Coordinator)',
        gesture: 'think',
        type: 'node_complete',
        status: 'completed',
        payload: {
          summary: '门禁已获人类授权，完成本地变更记录与 StandAlone 时间轴归档',
        },
      }),
    })
    console.log('   ✅ 步骤 4 完成：拓扑主干闭环收敛！\n')
  } else {
    console.log('🔴 结论：人类拒绝拦截！Agent 严格遵守停机指令，安全退出，未发生任何写入。')
  }
}

runRealWorkflow().catch((err) => {
  console.error('❌ 执行失败:', err.message)
})
