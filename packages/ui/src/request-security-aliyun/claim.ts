import type { RequestVerificationProof } from "@zcode/shared";
import { prepareClaim } from "./app/claim.js";
import { captchaPort } from "./adapters/aliyunCaptcha.js";
import { useRequestVerificationPrewarm } from "./ui/useRequestVerificationPrewarm.js";
import type { RequestVerificationService } from "./contract.js";

export async function prepareRequestVerificationClaim(
  service: RequestVerificationService,
  signal: AbortSignal,
  onVerifying: () => void,
): Promise<RequestVerificationProof | undefined> {
  return prepareClaim(service, signal, onVerifying, captchaPort);
}

export { useRequestVerificationPrewarm };
