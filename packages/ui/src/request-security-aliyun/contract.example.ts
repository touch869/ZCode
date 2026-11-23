/**
 * request-security-aliyun-ui 标准调用示例。
 *
 * claim 与 workspace runtime headers 两条路径共用同一个 captcha port：
 * 领取前生成 proof；模型请求由 Host 下发请求后由 bridge 生成 proof 并回传头。
 */
import type {
  CaptchaPort,
  RequestSecurityAliyunUiContract,
  RuntimeHeadersRequest,
  RequestVerificationService,
} from "./contract.js";
import { prepareClaim } from "./app/claim.js";
import { createRuntimeHeadersResponse } from "./app/bridge.js";

export function exampleRequestSecurityAliyunUi(
  contract: RequestSecurityAliyunUiContract,
  service: RequestVerificationService,
  captchaPort: CaptchaPort,
  signal: AbortSignal,
  onVerifying: () => void,
  request: RuntimeHeadersRequest,
): void {
  void prepareClaim(service, signal, onVerifying, captchaPort);
  void createRuntimeHeadersResponse(request, signal, captchaPort, "Captcha verification failed.");
  void contract;
}
