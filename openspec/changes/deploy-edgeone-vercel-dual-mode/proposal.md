# OpenSpec 提案：NetDive 公网 EdgeOne 部署与双模自愈控制台架构

- **提案状态**: 实施已就绪 (Ready for Deployment)
- **目标工程**: `NetDive` (AI Agent 实时可观测拓扑与决策门禁控制台)
- **发布架构**: 方案 A（Vercel 自动化构建源站 + 腾讯云 EdgeOne 边缘加速分发）

---

## 1. 核心诉求与架构决策

### 1.1 背景与痛点
1. **单一代码库双重形态**：NetDive 既是本地私有 Agent 的可观测与审批控制台（消费 `127.0.0.1:4560`），又是对外展示个人系统审美与 Agent 控制论硬核深度的公开作品（Live Demo）；
2. **国内直连访问痛点**：单纯依赖国外免费服务（如 `*.vercel.app`）易遭受国内 DNS 污染与握手阻断；
3. **安全物理边界**：公网公开部署**坚决不暴露本地执行服务**，前端必须在无后端伴生状态下 100% 具备沙盒回放、错误自愈推演、微压缩对比与门禁交互能力。

### 1.2 架构拓扑设计 (方案 A)
```text
[本地开发/工作流]
  Agent (Pi/Claude) ───HTTP/WS───> Hono Sidecar (127.0.0.1:4560) ───WS───> NetDive 本地浏览器

[公网分发链路 (全自动 0 运维)]
  GitHub push (main) ───Webhook───> Vercel 静态构建 (netdive.vercel.app 源站)
                                            │
                                            ▼ (HTTPS 回源)
                                  腾讯云 EdgeOne (边缘节点全球 CDN + 免费 SSL 证书)
                                            │
                                            ▼ (毫秒级极速直连)
                                  访客 (netdive.yourdomain.com)
                                            │
                                  [前端双模自动感知]
                                    ├─ 本地无 Bridge ➔ 自动切入「离线交互沙盒」模式 (Mock/推演/压缩全可用)
                                    └─ 访客本机启动 Bridge ➔ 秒级点亮「实时伴生控制台」
```

---

## 2. 腾讯云 EdgeOne 部署实操清单 (SOP)

### 步骤 1：Vercel 导入与构建 (2 分钟)
1. 打开 [Vercel 控制台](https://vercel.com/)，点击 `Add New...` -> `Project`；
2. 关联导入 GitHub 仓库 `Mintnoii/netdive`；
3. Framework Preset 选择 `Vite`，Root Directory 保持 `./`，构建命令保持 `pnpm build`（输出目录为 `dist`）；
4. 点击 `Deploy`，等待 30 秒构建完成，获得专属源站域名（如 `netdive-xxxx.vercel.app`）。

### 步骤 2：腾讯云 EdgeOne 接入 (3 分钟)
1. 登录 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone)；
2. 进入【站点管理】，选择你在腾讯云上的主域名；
3. 点击【添加域名 / 规则】，添加二级域名（如 `netdive.yourdomain.com`）：
   - **加速区域**：中国大陆全部加速（或全球加速）；
   - **源站类型**：选择 **【回源到域名】**；
   - **源站地址**：填入 Vercel 分配的地址（如 `netdive-xxxx.vercel.app`）；
   - **回源 Host**：设置为与源站域名相同（`netdive-xxxx.vercel.app`）；
   - **回源协议**：选择 `HTTPS`，端口 `443`。
4. 【HTTPS 配置】：开启 HTTPS，选择 EdgeOne 免费证书（一键申请，系统自动验证并签发）；
5. 【缓存规则】：
   - 对 `/assets/*` 静态资源配置长期缓存（如 30 天）；
   - 对 `/` 根路由配置协商缓存（跟随源站或 5 分钟），保证发版秒级生效。

### 步骤 3：腾讯云 DNS 解析绑定 (1 分钟)
1. 在 EdgeOne 域名列表获取该域名对应的 EdgeOne CNAME 地址（如 `netdive.yourdomain.com.eo.dnse*.com`）；
2. 前往【腾讯云 DNSPod 域名解析】，添加一条记录：
   - 主机记录：`netdive`
   - 记录类型：`CNAME`
   - 记录值：粘贴 EdgeOne 的 CNAME 地址；
3. 保存后等待 1~2 分钟，即可通过 `https://netdive.yourdomain.com` 国内免翻墙毫秒级秒开！

---

## 3. 前端自愈与双模感知演进落地
1. **Bridge 状态双模态自愈**：
   - 在前端顶部胶囊清晰展示 `[Live Bridge 实时工作流模式]` vs `[Demo Sandbox 离线演示沙盒]`；
   - 离线访问时不弹出红字报错，而是自然呈现提示气泡：“当前运行于展示沙盒中，点击下方按钮即可完整体验因果拓扑与自愈分叉”；
2. **纯静态全功能闭环**：
   - 播放流式事件、暂停/继续、错误自愈注入、决策门禁 (HITL) 审批、上下文剪枝热力图微压缩等所有交互在纯静态模式下 100% 独立闭环运行。
