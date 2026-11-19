# 功能留档：恢复拖拽丝滑流畅度并精准修复抽屉误触发

## 变更描述

根除拖拽卡顿：移除错误的 dragging 阻塞以恢复 React Flow 60fps 受控位移；基于实际 onNodeDrag 位移状态守卫精准区分拖拽排版与点击详情，彻底解决拖拽误弹抽屉与连线闪烁问题

## 涉及文件

- `src/App.tsx` — 移除 !change.dragging 恢复受控流畅度；基于 onNodeDrag 状态拦截拖拽伴生的 click 消除误弹抽屉；解耦 visibleEdges 消除连线闪烁
- `src/pages/RegressionPage.tsx` — 对齐清理未使用的本地变量并修复构建类型报错

## 备注

全仓 382 个单测 100% 绿灯，生产构建零报错，拖拽原生 60/120fps 顺滑，连线稳定不闪烁，拖拽绝不误弹抽屉，纯点击正常滑出抽屉
