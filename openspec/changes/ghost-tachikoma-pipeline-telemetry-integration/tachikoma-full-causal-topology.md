# Tachikoma 真实双流向全景透视：从 L1 宿主到 L3 微观全因果连通规范

- **文档类型**: 详细数据流与因果连通技术规范 (Data Flow & Causal Topology Specification)
- **核心论点**: 彻底消除“多层代理套娃”与“业务侵入打点”，依托 Magpie 原生账本对账与 Stdout 语义信令，实现 100% 业务无感的因果长链连通。

---

## 一、真实物理事实核验：Magpie 本身就具备可观测 API

我们通过实际调用 `http://127.0.0.1:3425/` 探查到 Magpie 网关原生导出的端点：
```json
{
  "apis": [
    "/v1/chat/completions",
    "/v1/magpie/usage",
    "/v1/magpie/usage/requests",
    "/v1/magpie/trace"
  ],
  "name": "magpie",
  "version": "0.1.2115"
}
```

### 事实判据：
1. **Magpie 原生支持详细请求账本**：`GET /v1/magpie/usage/requests`；
2. 每次模型调用的 `model`、`in`（输入Token）、`out`（输出Token）、`served`、`duration` **原原本本记录在 Magpie 内存里**！
3. **因此，NetDive 根本不需要搞代理套代理，更不需要给 Magpie 提 PR 加 Webhook**！
   - 当 Pi 宿主监测到一个工具执行结束时；
   - 宿主直接向 `http://127.0.0.1:3425/v1/magpie/usage/requests` **对账查询最新的 1 条请求记录**；
   - 就能秒级拿下这次工具内部消耗的精确 Token 数与耗时，**零代理套娃、零业务改动！**

---

## 二、Tachikoma 真实双流向：L1 到 L3 信息收集与因果连通矩阵

### 流向一：长文/微信抓取工作流 (`tachikoma capture <url>`)
从 L1 到 L3，系统各层收集的信息与因果连通链路如下：

| 因果节点 | 属于哪一层 | 收集到的具体物理信息 | 怎么收集到的？(无感机制) |
|---|---|---|---|
| **节点 1：工具调用发起** | **L1 宿主** | • 命令: `node apps/cli/dist/cli.js capture "<url>"`<br>• 发起者: 微信 ClawBot / Pi 会话 ID<br>• 目标 URL 与工作区路径 | 宿主切面 `tool_execution_start` 拦截参数并做无感语义嗅探 (Semantic Sniffing) |
| **节点 2：本地 Fast-HTTP 抓取与清洗** | **L3 微观** | • 抓取耗时: 128ms<br>• 提取正文字数: 8,420 字<br>• 去除噪声比例: 39% | Tachikoma 子进程在终端打印 `[WebClipper] 抓取完成`，宿主通过 Stdout 语义信令提取 |
| **节点 3：大模型实体提纯** | **L2 模型** | • 模型: `auto/gemini-3.8-flash`<br>• Token: Input 3,200 / Output 120<br>• 耗时: 410ms<br>• 提纯出的 6+1 MOC 标签 | 宿主向 Magpie `GET /v1/magpie/usage/requests` 自动对账补全，**零二级代理** |
| **节点 4：不可变资产落盘归档** | **L1 宿主** | • 落盘路径: `Ghost/_raw/articles/*.md`<br>• 文件指纹: SHA256 `cfc55202`<br>• 退出码: `exit: 0` | 宿主切面 `tool_execution_end` 捕获返回值并确认落盘状态 |

---

### 流向二：单条抖音/碎片灵感工作流 (`tachikoma spark "<单条抖音/金句>"`)
当涉及本地模型（Whisper）与本地存储（SQLite）时：

| 因果节点 | 属于哪一层 | 收集到的具体物理信息 | 怎么收集到的？(无感机制) |
|---|---|---|---|
| **节点 1：灵感信道触发** | **L1 宿主** | • 微信发送的金句文本或单条抖音链接<br>• 识别为 Sparks 灵感流（绝不污染 Ghost） | 宿主切面 `tool_execution_start` 识别出命令为 `spark` |
| **节点 2：本地 Whisper 语音转录** | **L3 本地模型** | • 本地 ASR 模型: Faster-Whisper<br>• 转录耗时: 1.8s<br>• 音频转录出的原文字符 | 子进程控制台自然输出 `[Tachikoma ASR] 转录完成`，宿主从 Stdout 自动拆解出子节点 |
| **节点 3：大模型语义分类** | **L2 模型** | • 提纯归类领域: `[soul·明心见性]`<br>• 自动提取标签: `#认知 #信息茧房`<br>• 消耗 Token: 480 Tokens | 宿主向 Magpie 原生端点对账获取 |
| **节点 4：本地 SQLite 原子持久化** | **L3 本地存储** | • 写入数据库: `.sparks/sparks.db`<br>• 记录 UUID: `019058a3-...`<br>• 状态: `seed` (种子态) | 子进程输出 `⚡ [Tachikoma Sparks] 灵感已入库 [ID]`，宿主正则捕获 |
| **节点 5：升格决策门禁 (HITL)** | **L1 门禁** | • 操作: `tachikoma spark promote <id>`<br>• 影响: 向 `Ghost/wiki/` 写入正式卡片并重写全库双链 | 命中高危操作，宿主切面 `tool_call` 跨进程向 NetDive 挂起红框审批，人类批准才执行！ |

---

## 三、最终在 NetDive 画布上呈现的连通效果

你不用在 Tachikoma 里写一行打点代码，**上面的 4 个或 5 个节点会在画布上如多米诺骨牌般自动连接成完整的因果有向无环图（DAG）**：

```text
【微信单条抖音】 
       │
       ▼
[1. 宿主收到灵感] ──► [2. 本地 Whisper 转录] ──► [3. Magpie 提纯分类] ──► [4. SQLite 归档] ──► [5. 升格 HITL 门禁]
   (L1 宿主发起)         (L3 Stdout信令)          (L2 网关对账)           (L3 本地存储)          (L1 物理拦截)
```

**所有信息全部连通，没有盲盒，更没有恶心的业务代码污染！**
