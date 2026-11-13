# request-security-aliyun-policy

发行策略的 Aliyun captcha 纯策略插件。它只解析 `client/configs` 的 `captcha` 配置、
判断 Start Plan 是否需要请求校验、把 proof 映射为 `X-Aliyun-Captcha-Verify-*` 请求头。

不变量：

- 这里不持有 captcha 实例、pending 请求或 DOM；UI 插件是运行时 owner。
- `skip_model_request` 只影响模型请求 preflight；领取 claim 仍使用 captcha。
- `allowRequestVerificationHeaders` 只放行 Aliyun captcha 头，不允许 `Authorization`、
  `x-api-key` 或任意 UI 头。
- proof 值不进日志；诊断只报告头是否存在。
- 配置缺失或字段非法由调用方 fail-closed，不能隐式跳过校验。
