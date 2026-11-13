import { useEffect } from "react";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { logger } from "@/logger.js";
import { prewarmCaptcha } from "../adapters/aliyunCaptcha.js";

export function useRequestVerificationPrewarm(visible: boolean): void {
  const services = useServices();
  const userId = useZCodeStore((state) => state.user?.id);
  const service = services.codingPlanSubscriptionService;

  useEffect(() => {
    if (!visible || !userId) return;

    const controller = new AbortController();
    void prewarmCaptcha(service, controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        logger.warn("[request-security-aliyun] captcha prewarm failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => controller.abort();
  }, [visible, userId, service]);
}
