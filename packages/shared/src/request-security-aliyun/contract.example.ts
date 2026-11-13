/**
 * request-security-aliyun-policy 标准调用示例。
 *
 * 典型路径：读取 client/configs 的 captcha 配置，判断 start-plan 是否需要交互，
 * 再把 UI 返回的 proof 映射成请求头。
 */
import type {
  RequestSecurityAliyunPolicyContract,
  RequestVerificationClientConfig,
  RequestVerificationProof,
} from "./contract.js";

export function exampleRequestSecurityAliyunPolicy(
  contract: RequestSecurityAliyunPolicyContract,
  configs: RequestVerificationClientConfig,
  access: { mode?: string },
  proof: RequestVerificationProof,
): void {
  const config = contract.readValidatedRequestVerificationConfig(configs);
  if (!config) return;
  if (!contract.requiresRequestVerification(access, config)) return;
  contract.requestVerificationClaimHeaders(proof);
}
