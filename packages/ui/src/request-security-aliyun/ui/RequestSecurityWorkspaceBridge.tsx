import { useEffect } from "react";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { createRuntimeHeadersResponse } from "../app/bridge.js";
import { captchaPort } from "../adapters/aliyunCaptcha.js";
import { dedupeWorkspaceTabs } from "../domain/workspace.js";
import type {
  RequestSecurityWorkspaceTab,
  RuntimeHeadersRequest,
  RuntimeHeadersResponse,
} from "../contract.js";

export function RequestSecurityWorkspaceBridge({
  workspaceTabs,
}: {
  workspaceTabs: readonly RequestSecurityWorkspaceTab[];
}) {
  const services = useServices();
  const { intl } = useZCodeIntl();
  const failureMessage = intl.formatMessage({ id: "manualClaimPlan.claim.failure.captcha" });
  const agentService = services.zcodeAgentService;

  useEffect(() => {
    const tabs = dedupeWorkspaceTabs(workspaceTabs);
    const pending = new Map<string, AbortController>();
    const disposables: Array<{ dispose: () => void }> = [];

    const respond = async (
      request: RuntimeHeadersRequest,
      response: RuntimeHeadersResponse,
    ): Promise<void> => {
      try {
        await agentService.respondProviderRuntimeHeaders({
          workspacePath: request.workspace.workspacePath,
          ...(request.workspace.workspaceIdentity
            ? { workspaceIdentity: request.workspace.workspaceIdentity }
            : {}),
          ...(request.workspace.remoteSessionId
            ? { remoteSessionId: request.workspace.remoteSessionId }
            : {}),
          sessionId: request.sessionId,
          requestId: request.requestId,
          response,
        });
      } catch (error) {
        logger.warn("[request-security-aliyun] runtime headers response failed", {
          requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const handleRequest = async (request: RuntimeHeadersRequest): Promise<void> => {
      if (pending.has(request.requestId)) return;
      const controller = new AbortController();
      pending.set(request.requestId, controller);

      try {
        const response = await createRuntimeHeadersResponse(
          request,
          controller.signal,
          captchaPort,
          failureMessage,
        );
        if (controller.signal.aborted || !response) return;
        await respond(request, response);
      } catch (error) {
        logger.warn("[request-security-aliyun] captcha bridge failed", {
          requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        pending.delete(request.requestId);
      }
    };

    for (const tab of tabs) {
      const target = {
        workspacePath: tab.workspacePath,
        ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
        ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      };

      const requestDisposable = agentService.onDynamicWorkspaceProviderRuntimeHeadersRequest(
        target,
      )((request) => {
        void handleRequest(request);
      });

      const cancelDisposable = agentService.onDynamicWorkspaceProviderRuntimeHeadersCancelled(
        target,
      )((cancelled) => {
        const controller = pending.get(cancelled.requestId);
        if (!controller) return;
        controller.abort(new DOMException("Captcha request cancelled", "AbortError"));
        pending.delete(cancelled.requestId);
      });

      disposables.push(requestDisposable, cancelDisposable);
    }

    return () => {
      for (const controller of pending.values()) {
        controller.abort(new DOMException("Captcha request cancelled", "AbortError"));
      }
      pending.clear();
      for (const disposable of disposables) disposable.dispose();
    };
  }, [workspaceTabs, agentService, failureMessage]);

  return null;
}
