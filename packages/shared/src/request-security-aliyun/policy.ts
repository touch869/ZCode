import type {
  RequestVerificationAccess,
  RequestVerificationClientConfig,
  RequestVerificationConfig,
  RequestVerificationProof,
} from "./contract.js";

export const requestVerificationReasons = ["model-request"] as const;
export type RequestVerificationReason = (typeof requestVerificationReasons)[number];

export const requestVerificationTimeoutMessage =
  "Captcha verification request timed out. Please send your message again.";

export const REQUEST_VERIFICATION_REQUIRED = "request_verification_unavailable";

// 完整模型链路需要 UI 应答方；claim 路径独立使用同一 captcha 插件。
export const requestVerificationInteractionAvailable = true;

export const requestSecuritySensitiveHeaders: readonly string[] = [
  "X-Aliyun-Captcha-Verify-Param",
  "X-Aliyun-Captcha-Verify-Region",
];

const CAPTCHA_HEADER_NAMES = ["X-Aliyun-Captcha-Verify-Param", "X-Aliyun-Captcha-Verify-Region"];
const CAPTCHA_HEADER_SET = new Set(CAPTCHA_HEADER_NAMES.map((name) => name.toLowerCase()));

function readCaptchaConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): Record<string, unknown> | null {
  const captcha = configs?.captcha;
  if (!captcha || typeof captcha !== "object" || Array.isArray(captcha)) return null;
  return captcha as Record<string, unknown>;
}

export function readRequestVerificationConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationConfig | null {
  const captcha = readCaptchaConfig(configs);
  if (!captcha) return null;
  const { skip_model_request: skipModelRequestRaw, ...rest } = captcha;
  return {
    ...rest,
    ...(typeof skipModelRequestRaw === "boolean" ? { skipModelRequest: skipModelRequestRaw } : {}),
  };
}

export function readValidatedRequestVerificationConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationConfig | null {
  const captcha = readCaptchaConfig(configs);
  if (!captcha) return null;

  if (captcha.enabled !== undefined && typeof captcha.enabled !== "boolean") return null;
  if (captcha.skip_model_request !== undefined && typeof captcha.skip_model_request !== "boolean")
    return null;

  const config = readRequestVerificationConfig(configs);
  if (!config) return null;

  if (config.enabled !== false && config.skipModelRequest !== true) {
    const required = [config.region, config.prefix, config.sceneId];
    if (!required.every((value) => typeof value === "string" && value.trim())) return null;
  }

  return config;
}

export function requestVerificationClaimHeaders(
  proof: RequestVerificationProof,
): Record<string, string> {
  const param = proof.captchaVerifyParam?.trim();
  if (!param) return {};
  const headers: Record<string, string> = {
    "X-Aliyun-Captcha-Verify-Param": param,
  };
  const region = proof.captchaRegion?.trim();
  if (region) headers["X-Aliyun-Captcha-Verify-Region"] = region;
  return headers;
}

export function withoutRequestVerificationHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = headers ? { ...headers } : {};
  for (const key of Object.keys(result)) {
    if (CAPTCHA_HEADER_SET.has(key.trim().toLowerCase())) delete result[key];
  }
  return result;
}

export function allowRequestVerificationHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) continue;
    const name = CAPTCHA_HEADER_NAMES.find(
      (candidate) => candidate.toLowerCase() === rawName.trim().toLowerCase(),
    );
    if (name) result[name] = value;
  }
  return result;
}

export function requiresRequestVerification(
  access: RequestVerificationAccess | undefined,
  config?: RequestVerificationConfig | null,
): boolean {
  return (
    access?.mode === "start-plan" &&
    config?.enabled !== false &&
    config?.skipModelRequest !== true &&
    requestVerificationInteractionAvailable
  );
}

export function isRequestVerificationMessage(message: string): boolean {
  return message.includes("请完成安全验证") || /security verification/i.test(message);
}

export function summarizeRequestVerificationHeaders(
  headers: Record<string, string>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const name of CAPTCHA_HEADER_NAMES) {
    const value = headers[name];
    summary[name] = typeof value === "string" && value.trim() ? true : false;
  }
  return summary;
}

function readBodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch {
      return "";
    }
  }
  return String(body ?? "");
}

export function isRequestSecurityFailure(
  body: unknown,
  codes: readonly (string | undefined)[],
): boolean {
  const text = readBodyText(body);
  const normalizedCodes = codes.filter((code): code is string => typeof code === "string");
  const markers = [
    "3007",
    "CAPTCHA_VERIFY_FAILED",
    "VERIFY_APIKEY_EXPIRED",
    "VERIFY_SIGNATURE_INVALID",
  ];
  return (
    normalizedCodes.some((code) => markers.includes(code)) ||
    /captcha verify failed|security verification|安全验证|验证码校验失败/i.test(text)
  );
}

export function requestVerificationDiagnostics(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    reason: input.reason ?? null,
    hasConfig: input.config != null,
    interactionRequired: Boolean(input.interactionRequired),
  };
}
