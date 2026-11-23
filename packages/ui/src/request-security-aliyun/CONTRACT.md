# request-security-aliyun-ui

Aliyun captcha 运行时插件。它持有 SDK 实例、串行尝试队列与隐藏 host DOM；claim 与模型请求
两条路径共用同一个 captcha port。

不变量：

- SDK 实例和尝试队列由本模块独占；MarketingTouchController 只持有 claim 状态，
  Host `zcodeAgentService` 只持有 pending runtime headers 请求。
- claim 路径不经过 workspace bridge；bridge 只应答 Host 已下发的
  `providerRuntimeHeaders.request`，不建立第二份 accepted 队列。
- bridge 按 `workspaceIdentity?.trim() || workspacePath` 去重；取消 requestId
  只 abort 当前 attempt，不重复回传响应。
- proof 不进日志；失败只返回稳定本地化文案。
- SDK 从官方 CDN 加载；网络或脚本失败时 fail-closed，不提交 claim。
