import type { RequestVerificationConfig, RequestVerificationProof } from "@zcode/shared";

export interface RequestVerificationService {
  getRequestVerificationConfig(): Promise<RequestVerificationConfig | null>;
}

export interface CaptchaAttemptOptions {
  signal?: AbortSignal;
  allowInteractive?: boolean;
  timeoutMs?: number;
  source?: string;
  providerId?: string;
}

export interface RequestSecurityWorkspaceTab {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export interface RuntimeHeadersRequest {
  requestId: string;
  sessionId: string;
  workspace: {
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  };
  providerId: string;
  requestVerificationConfig?: RequestVerificationConfig;
  reason?: string;
}

export type RuntimeHeadersResponse =
  | { headersApplied: true; runtimeProviderHeaders: Record<string, string>; errorMessage?: string }
  | { headersApplied: false; errorMessage?: string };

export interface CaptchaPort {
  getProof(
    config: RequestVerificationConfig,
    options: CaptchaAttemptOptions,
  ): Promise<RequestVerificationProof | undefined>;
}

export interface RequestSecurityAliyunUiContract {
  prepareClaim(
    service: RequestVerificationService,
    signal: AbortSignal,
    onVerifying: () => void,
  ): Promise<RequestVerificationProof | undefined>;
  prewarm(service: RequestVerificationService, signal?: AbortSignal): Promise<void>;
  getCaptchaProof(
    config: RequestVerificationConfig,
    options: CaptchaAttemptOptions,
  ): Promise<RequestVerificationProof | undefined>;
  respondRuntimeHeaders(
    request: RuntimeHeadersRequest,
    signal: AbortSignal,
  ): Promise<RuntimeHeadersResponse | undefined>;
}
