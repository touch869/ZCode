# Aliyun captcha plugin

## 目的

恢复开源构建缺失的官方 request-security 能力：

- 领取 Start Plan 前执行 Aliyun captcha；
- Start Plan 模型请求按 Host 下发的 `providerRuntimeHeaders.request` 执行 captcha，
  并把 `X-Aliyun-Captcha-Verify-*` 头回传给 Agent runtime。

实现不散落在 MarketingTouchController、Provider、Root 或 locale 文件中；官方
`request-security-edition` 文件只作为 re-export facade。

## 模块边界

### `request-security-aliyun-policy`（shared/domain）

纯策略，不持有状态：

- `readRequestVerificationConfig` / `readValidatedRequestVerificationConfig`
- `requiresRequestVerification`
- `requestVerificationInteractionAvailable = true`
- `requestVerificationClaimHeaders`
- `withoutRequestVerificationHeaders` / `allowRequestVerificationHeaders`
- `requestSecuritySensitiveHeaders` / `isRequestSecurityFailure`

配置来源：

```text
GET /api/v1/client/configs → data.configs.captcha
{
  enabled,
  prefix,
  region,
  sceneId,
  skip_model_request
}
```

`skip_model_request: true` 只跳过模型请求 preflight；claim 仍走 captcha。

### `request-security-aliyun-ui`（UI plugin）

分层：

- `domain/`：workspace key 去重、语言解析、错误映射。
- `app/`：claim 编排、runtime headers 应答编排。
- `adapters/`：Aliyun SDK 加载、隐藏 host、实例初始化、超时/取消。
- `ui/`：`RequestSecurityHost`、`RequestSecurityWorkspaceBridge`、prewarm hook。

## 状态 owner 与事件顺序

```text
MarketingTouchController ── claim 状态 owner
        ↓ prepareRequestVerificationClaim
UI captcha plugin ── SDK instance + 尝试队列 owner
        ↓ { captchaVerifyParam, captchaRegion? }
codingPlanSubscriptionService.claimManualPlan
        ↓ requestVerificationClaimHeaders
POST /api/v1/zcode-plan/billing/claim

Host zcodeAgentService ── pending runtime headers owner
        ↓ providerRuntimeHeaders.request
UI workspace bridge ── 只应答当前 request，不建第二队列
        ↓ captcha proof headers
Host respondProviderRuntimeHeaders
```

Bridge 去重键：

```text
workspaceIdentity?.trim() || workspacePath
```

取消 requestId 时只 abort 当前 attempt；不再发第二个响应。stale 请求由 Host 的
pending/responding 规则收口，UI 不另建 accepted 队列。

## 运行时

- SDK：`https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js`
- `window.AliyunCaptchaConfig = { region, prefix }`
- `initAliyunCaptcha({ SceneId, region, prefix, mode: "popup", language, showErrorTip: false, element: "#zcode-aliyun-captcha-element", button: "#zcode-aliyun-captcha-button", ... })`
- proof 不缓存；每次 claim 重新生成。
- 超时 120s；abort 时清空当前 attempt。
- SDK 脚本或实例失败 fail-closed：claim 不提交；bridge 回 `headersApplied: false`。

## 错误映射

服务端 `captcha verify failed` 映射到 `3007` / `CAPTCHA_VERIFY_FAILED`：

```text
manualClaimPlan.claim.failure.captcha = 验证码校验失败，请重试。
```

`resolveRequestSecurityErrorMessageId` 继续区分配置读取失败与配置无效。

## 验收

1. 领取：Banner 点击 → captcha 弹层 → 取消不提交 claim；成功后才提交 claim。
2. 模型链路：`skip_model_request: false` 的测试配置下，Host 下发 request，
   bridge 生成 proof，`respondProviderRuntimeHeaders` 返回头，Agent 继续请求。
3. 取消/超时/stale：不重复应答，失败文案稳定。
4. 工程门禁：`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`。

## 开源导出边界

该插件是本仓库 fork 的运行能力；官方开源导出的 `request-security-edition`
占位基线仍是空配置。若需要同时保持开源导出门禁，插件必须作为 fork 专属配置排除，
不能把插件实现当作公开导出内容。
