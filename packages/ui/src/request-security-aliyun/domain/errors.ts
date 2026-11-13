const CAPTCHA_REJECTION_PATTERN =
  /captcha verify failed|security verification|安全验证|验证码校验失败|captcha verification failed|verify token was rejected/i;

export const REQUEST_VERIFICATION_REJECTED_MESSAGE =
  "Captcha verification failed. Please try again.";

export function isRequestVerificationRejectedMessage(message: string | undefined): boolean {
  return typeof message === "string" && CAPTCHA_REJECTION_PATTERN.test(message);
}

export function resolveRequestVerificationBusinessCode(
  code: string | undefined,
  message: string | undefined,
): "3007" | undefined {
  const normalized = typeof code === "string" ? code.trim() : "";
  if (normalized === "3007" || normalized.toUpperCase() === "CAPTCHA_VERIFY_FAILED") {
    return "3007";
  }
  if (isRequestVerificationRejectedMessage(message)) return "3007";
  return undefined;
}

export function isRequestVerificationTerminalError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return resolveRequestVerificationBusinessCode(error.code, error.message) === "3007";
}

export const requestVerificationRecoveryAction = null;
export type RequestVerificationRecoveryAction = never;
export const requestVerificationActionMessages = {};
export const requestVerificationErrorAttribution: Record<
  string,
  { source: string; reason: string }
> = {
  CAPTCHA_VERIFY_FAILED: { source: "provider", reason: "auth_failed" },
};
export const requestVerificationClaimFailureMessageId = "manualClaimPlan.claim.failure.captcha";
export const additionalRequestModalSelectors: readonly string[] = [
  ".aliyunCaptcha-mask",
  ".aliyunCaptcha-window",
];

export function resolveRequestSecurityErrorMessageId(error: {
  code?: string;
  message?: string;
}): string | undefined {
  if (error.code === "request_verification_config_network") return "chat.configReadFailed";
  if (error.message === "Request verification configuration read failed")
    return "chat.configReadFailed";
  if (error.message === "Request verification configuration is invalid")
    return "chat.configInvalid";
  return undefined;
}

export function isRequestVerificationConfigNetworkError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.code === "request_verification_config_network" ||
    error.message === "Request verification configuration read failed"
  );
}
