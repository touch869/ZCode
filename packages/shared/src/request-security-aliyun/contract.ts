/**
 * request-security-aliyun-policy 公共契约。
 *
 * 该模块只做发行策略的纯解析与映射：不读取 DOM、不持有 captcha 实例、不发起网络请求。
 * 具体 captcha 运行时由 UI 插件负责；调用方只消费这里的结果。
 */
export type RequestVerificationClientConfig = Readonly<Record<string, unknown>>;

export interface RequestVerificationConfig {
  enabled?: boolean;
  skipModelRequest?: boolean;
  region?: string;
  prefix?: string;
  sceneId?: string;
  mode?: string;
  language?: string;
  captchaLogoImg?: string;
  readonly [key: string]: unknown;
}

export interface RequestVerificationProof {
  captchaVerifyParam: string;
  captchaRegion?: string;
}

export interface RequestVerificationAccess {
  mode?: string;
}

export interface RequestSecurityAliyunPolicyContract {
  readRequestVerificationConfig(
    configs: RequestVerificationClientConfig | null | undefined,
  ): RequestVerificationConfig | null;
  readValidatedRequestVerificationConfig(
    configs: RequestVerificationClientConfig | null | undefined,
  ): RequestVerificationConfig | null;
  requestVerificationClaimHeaders(proof: RequestVerificationProof): Record<string, string>;
  withoutRequestVerificationHeaders(
    headers: Record<string, string> | undefined,
  ): Record<string, string>;
  allowRequestVerificationHeaders(headers: Record<string, string>): Record<string, string>;
  requiresRequestVerification(
    access: RequestVerificationAccess | undefined,
    config?: RequestVerificationConfig | null,
  ): boolean;
  isRequestVerificationMessage(message: string): boolean;
  summarizeRequestVerificationHeaders(headers: Record<string, string>): Record<string, unknown>;
}
