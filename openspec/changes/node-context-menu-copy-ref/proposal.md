# 功能留档：节点右键菜单与高密度节点引用复制交互实现

## 变更描述

在 NetDive 画布节点上引入右键上下文菜单（NodeContextMenu）：支持一键复制高密度节点指纹引用（[NetDive Node Reference]），包含会话 ID、节点 ID、执行主体、手势与摘要，极大降低人类与 AI 沟通节点上下文时的沟通摩擦；同时集成右键直达原始日志检视，并为未来节点重放、自愈分叉预留扩展插槽。

## 涉及文件

- `src/types/telemetry.ts` — 导出 formatNodeReference 纯函数，格式化高密度结构化节点引用指纹
- `src/components/NodeContextMenu.tsx` — 新建右键菜单组件，支持视口防溢出定位、复制引用、查看原始详情与极简 Toast 提示
- `src/App.tsx` — 在 React Flow 上挂载 onNodeContextMenu 事件与全局关闭监听

## 备注

遵循 Paper & Ink 细腻设计规范与全机编码审美；由 Orca 调度 Claude Worker 闭环编码与单测。
