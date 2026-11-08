# 功能留档：修复 Treemap 分类被聚合隐藏的回归

## 变更描述

上一轮为消灭"无文字窄色块"引入了 part 级像素聚合（把 min(w,h) 过小的叶子合并成「另外 N 项」），导致小占比分类（系统提示词、工具定义、Skills、对话）在 Treemap 上整体消失——分类地图丢了分类，属语义级回归。修复方式改为 Magpie tilesOf 的正确策略：part 层永不聚合，只做「面积下限 + 反复重排」——每轮把 min(w,h)<56 的非 free 叶子 layoutValue 乘 (56/min(w,h))*1.05 后重新 squarify，最多 8 轮；free 节点不参与抬升；展示数字始终用真实 tokens。实测七个分类全部各自成块可见（读入的文件 436×130、工具结果 119×70、对话 119×56、系统提示词 70×63、Skills 70×63、工具定义 60×130、剩余空间独立斜纹块）。

## 涉及文件

- `src/components/ContextPromptMap.tsx` — 删除 aggregate 分支/aggregatedKinds/AGGREGATE_CLASSES 与「另外 N 项」；改为 MAX_LAYOUT_ROUNDS=8 的面积下限重排（layoutValue 抬升后重复 treemap 布局），free 不抬升，展示用真实 tokens

## 备注

教训：为消除视觉噪音而做的聚合，必须限定在"叶子内部"层级（Magpie 只在 part 内的 item 层聚合），一旦把聚合抬到分类层，就等价于隐藏数据。此后任何"简化显示"的策略，都要先问一句：这个简化会不会让某一类数据永久不可见。
