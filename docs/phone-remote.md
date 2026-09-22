# 手机远控（Phone Remote）

开源版 ZCode 桌面端的手机远控能力：手机浏览器扫码接入，实时查看/操控桌面端正在运行的任务。不需要官方云端 relay，全部流量留在本机与你的 Tailscale 网内。

## 使用

1. 桌面端菜单 **文件 → 手机远控…** 打开面板（面板由桌面内嵌服务器托管，`http://127.0.0.1:41889/panel`）。
2. 点击 **开启外部访问**——外部监听只会绑定 Tailscale 网段（100.64.0.0/10）地址；未检测到 Tailscale 时仅本机可访问。
3. 手机扫码（或输入链接）打开远控页。链接已附带 token；首次进入会种下 HttpOnly cookie，之后直接访问即可。
4. 首次打开如见引导页，跟随完成一次即可（per 浏览器一次性）。

手机端 = 完整的 packages/web 工作台（即官方 Web 客户端，天然手机形态）。支持：

- 任务/工作区列表、历史会话完整渲染（快照）
- 活跃任务实时流（正文与思维链逐字更新）
- 发送新消息（续跑/追问）、停止生成
- 权限与 elicitation 弹窗应答（v4 resolveInteraction 通道）

## 架构

```
手机浏览器 (packages/web 构建产物, clientMode=web-remote-replayable)
   │  HTTP/WS  (13 字节分帧 SocketProtocol, token cookie 鉴权)
   ▼
desktop main: phoneRemoteServer  ── 帧体 ⇄ MessagePort Uint8Array 直通桥
   │  AttachServicePort { clientMode:"web-remote-replayable", scope:{kind:"local"} }
   ▼
窗口 Host utilityProcess (MessagePortProtocol + ChannelServer)
   └─ 与桌面 renderer 同一套本地服务：zcode-task / zcode-agent(v4) / 快照 / 列表
```

要点：

- **为什么走 AttachServicePort 而不是 TaskRealtimeBus mirror**：mirror 批流
  （`relay_bridge` deliveryKind）在开源版只有协议类型，生产者/消费者两侧都未接线
  （本地任务不向总线发布 stream op；`onDidReceiveEvent`/owner-command 零订阅者）。
  而宿主侧 `AttachServicePort` 的处理注释明写"刷新/**手机** attachment 复用同一
  Host"，`web-remote-replayable` clientMode 的门禁（provisioning 禁用等）在
  `exposeServicesOnMessagePort` 内现成生效。手机因此直接讲 v4 RPC，读写路径与
  桌面 renderer 完全同源，无需自研 apply 层。
- 每个 WS 连接在 Host 内是**独立 attachment + 独立 connectionScope**，与桌面
  窗口互不干扰；Host 挂掉/窗口关闭时 WS 以 4003 关闭，手机端重新加载即可重连
  （Web 客户端无自动重连）。
- 多窗口时桥接到**最近聚焦窗口**的 Host（`resolvePhoneRemoteTargetHost`）。

## 安全模型

- token（24 字符随机，`userData/phone-remote.json`）是唯一准入；`?token=` 首次
  进入种 cookie（`HttpOnly; SameSite=Lax`，与 packages/server 同策略）；WS 升级
  校验 token + Origin 同源。
- 外部监听**只绑定 Tailscale 网段地址**，默认关闭；loopback 面板常驻。
- relay 承载权限审批（resolveInteraction 即授权决策通道），token 等同桌面全权，
  请勿外传二维码截图；可在面板一键重置令牌。
- 已知取舍：token 比较非常数时间（24 字符随机值 + 私网监听，风险可控）。

## 开发与构建

- 手机端静态产物：`cd packages/web && ../../node_modules/.bin/vite build`
  （产出 `packages/web/dist`，dev 运行自动发现）。可用
  `ZCODE_PHONE_REMOTE_WEB_DIST` 覆盖目录。
- desktop main 重建：`cd packages/desktop && ../../node_modules/.bin/tsup`。
- 环境变量：`ZCODE_PHONE_REMOTE=1`（默认开启）、`ZCODE_PHONE_REMOTE_PORT`。

## 已知限制（Roadmap）

- 打包版安装包尚未捆绑 `web-dist`（需 electron-builder extraResources 集成）。
- 手机端 Web 客户端无自动重连；Host 退出后需手动刷新。
- 任务在多窗口不同工作区分布时，手机只挂最近聚焦窗口的 Host。
- `isMobileViewport` 等 UI 层手机分支仍为占位（会话视图可用，工作台外壳未做
  手机适配）；微信 bot、官方云端 relay（跨网络场景）不在本特性范围。
