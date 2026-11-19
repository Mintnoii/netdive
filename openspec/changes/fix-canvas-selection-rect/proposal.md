# 功能留档：清退 React Flow 拖拽原生虚线框与焦点选区残留

## 变更描述

在 React Flow 画布中，拖拽节点时 applyNodeChanges 默认伴随派发 select 事件，导致触发了原生 .react-flow__nodesselection-rect 虚线选区框以及容器 focus outline。本次改动在 App.tsx 的 handleFlowNodesChange 中严格过滤 select 变更，显式锁定 elementsSelectable=false 与 selectionOnDrag=false，并在 index.css 中抹平 --xy-selection-border 与焦点 outline，彻底恢复纸白纯净拖拽体验。

## 涉及文件

- `src/App.tsx` — handleFlowNodesChange 过滤 select 变更，ReactFlow 配置锁定 elementsSelectable 为 false
- `src/index.css` — 清退 .react-flow__nodesselection-rect 与焦点 outline，重设 selection-border 变量
- `src/services/transcriptParser.ts` — 清理无用的 measured 冗余属性赋值

## 备注

拖拽半透明毛玻璃透视与连线 2px 微投影样式完整保留，382 项单测全绿通过。
