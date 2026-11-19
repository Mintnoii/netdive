# 功能留档：扩大流程节点间距并修复拖拽误触发抽屉

## 变更描述

调整拓扑布局间距参数使节点间连线舒展可见，并在节点拖拽事件中增加防抖守卫以彻底消除拖拽误触详情抽屉的问题

## 涉及文件

- `src/services/flowLayout.ts` — 将 FLOW_LAYOUT.stepX 扩至 370px 留出 90px 水平连线空间，nodesPerRow 调为 5，TURN_GRID.stepX 扩至 450px
- `src/App.tsx` — 引入 isNodeDraggingRef 拖拽守卫，拖拽节点调整排版时彻底拦截右侧抽屉误触发
- `src/services/transcriptParser.test.ts` — 对齐拓扑网格步距与折行断言至 flowLayout 单一真源常量
- `src/hooks/useTelemetryStream.test.ts` — 对齐实时流主干顺延与自愈下沉单测断言至 FLOW_LAYOUT
- `src/services/sessionTopology.test.ts` — 对齐会话拓扑坐标纯函数断言至 FLOW_LAYOUT

## 备注

全仓 382 项单测 100% 绿灯通过，生产构建零报错
