# Tasks: 节点右键菜单与高密度节点引用复制交互实现

## 1. 契约定义与指纹格式化纯函数 (`src/types/telemetry.ts`)
- [x] 1.1 导出纯函数 `formatNodeReference(params: { node: Node; sessionId?: string; sessionTitle?: string; project?: string }): string`：
  - 格式化输出易于人类阅读与 AI 解析的高密度引用文本：
    ```text
    [NetDive Node Reference]
    - 会话: <sessionId> (<sessionTitle>)
    - 节点: <nodeId> (<title>)
    - 执行主体: <actor>
    - 手势/状态: <gesture> · <status>
    - 摘要: <summary>
    ```
- [x] 1.2 编写对应单元测试验证格式化输出正确性。

## 2. 右键菜单组件实现 (`src/components/NodeContextMenu.tsx`)
- [x] 2.1 新建 `src/components/NodeContextMenu.tsx`：
  - 支持传入鼠标物理坐标 `(x, y)`，自动进行屏幕视口防溢出计算（右侧/下侧贴边时自适应翻转向左/向上展开）；
  - 菜单项包含：
    - 📋 「复制节点引用」：写入剪贴板（兼容 clipboard API 与安全 fallback），触发极简纸墨风格 Toast 提示；
    - 🔍 「检视执行详情」：触发 Inspector 抽屉打开并聚焦该节点；
    - 预留禁用项：「从此处重放 (Replay)」、「派生自愈分支 (Fork Branch)」（显示 `(即将推出)` 徽章）；
  - 点击外部、滚动画布、或按 `Esc` 键时自动平滑关闭。

## 3. React Flow 画布集成 (`src/App.tsx`)
- [x] 3.1 监听 React Flow 的 `onNodeContextMenu` 与 `onPaneClick`；
- [x] 3.2 管理 `contextMenu: { x: number; y: number; node: Node } | null` 状态；
- [x] 3.3 点击「检视执行详情」时无缝打开现有的 `PrunableInspectorDrawer`。

## 4. 单元测试与端到端验证
- [x] 4.1 编写 `src/components/NodeContextMenu.test.ts` 验证指纹格式化、复制事件与交互回调；
- [x] 4.2 运行 `pnpm test` 确保 100% 绿灯。
