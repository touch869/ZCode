import type {
  CaptchaAttemptOptions,
  CaptchaPort,
  RequestVerificationService,
} from "../contract.js";
import type { RequestVerificationConfig, RequestVerificationProof } from "@zcode/shared";
import { resolveCaptchaLanguage } from "../domain/language.js";

const SDK_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const CAPTCHA_CONTAINER_ID = "zcode-aliyun-captcha-container";
const CAPTCHA_ELEMENT_ID = "zcode-aliyun-captcha-element";
const CAPTCHA_BUTTON_ID = "zcode-aliyun-captcha-button";
const INSTANCE_TIMEOUT_MS = 10_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;

interface AliyunCaptchaInstance {
  show?: () => void;
  startTracelessVerification?: () => void;
}

interface AliyunCaptchaOptions {
  SceneId: string;
  region: string;
  prefix: string;
  mode?: string;
  language?: string;
  captchaLogoImg?: string;
  showErrorTip?: boolean;
  element: string;
  button: string;
  getInstance: (instance: AliyunCaptchaInstance) => void;
  success: (captchaVerifyParam: string) => void;
  fail: (error: unknown) => void;
  onError: (error: unknown) => void;
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string };
    initAliyunCaptcha?: (options: AliyunCaptchaOptions) => unknown;
  }
}

interface CaptchaController {
  configKey: string;
  instancePromise: Promise<AliyunCaptchaInstance>;
  button: HTMLButtonElement;
}

interface ActiveAttempt {
  resolve: (captchaVerifyParam: string) => void;
  reject: (error: unknown) => void;
  allowInteractive: boolean;
}

let scriptPromise: Promise<void> | null = null;
let controller: CaptchaController | null = null;
let activeAttempt: ActiveAttempt | null = null;
let attemptQueue: Promise<void> = Promise.resolve();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Captcha request cancelled", "AbortError");
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function getHostElements(): { mount: HTMLElement; button: HTMLButtonElement } {
  const mount = document.getElementById(CAPTCHA_ELEMENT_ID);
  const button = document.getElementById(CAPTCHA_BUTTON_ID);
  if (!(mount instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
    throw new Error("Captcha host container is not mounted.");
  }
  return { mount, button };
}

function isInteractiveCaptchaFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { success?: unknown; verifyResult?: unknown; verifyCode?: unknown };
  const verifyCode = typeof value.verifyCode === "string" ? value.verifyCode : "";
  return (
    value.success === true &&
    value.verifyResult === false &&
    (verifyCode === "F001" || verifyCode === "F015" || verifyCode === "")
  );
}

function handleSdkFail(error: unknown): void {
  const attempt = activeAttempt;
  if (!attempt) return;
  // F001/F015 是弹出交互验证的前置失败，SDK 仍会在用户完成拼图后回调 success；
  // 不能把它当成终态失败，否则会立即丢弃用户尚未完成的 captcha。
  if (attempt.allowInteractive && isInteractiveCaptchaFailure(error)) {
    return;
  }
  activeAttempt = null;
  attempt.reject(error instanceof Error ? error : new Error("Captcha verification failed."));
}

function resetController(): void {
  if (activeAttempt) {
    activeAttempt.reject(new Error("Captcha attempt reset."));
    activeAttempt = null;
  }
  controller = null;
  document.getElementById(CAPTCHA_ELEMENT_ID)?.replaceChildren();
}

function loadScript(signal?: AbortSignal): Promise<void> {
  if (typeof window !== "undefined" && typeof window.initAliyunCaptcha === "function") {
    return Promise.resolve();
  }
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src="${SDK_URL}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Failed to load captcha script.")),
          { once: true },
        );
        return;
      }
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load captcha script."));
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return withAbort(scriptPromise, signal);
}

function configKey(config: RequestVerificationConfig): string {
  return [
    config.region ?? "",
    config.prefix ?? "",
    config.sceneId ?? "",
    config.mode ?? "popup",
    config.language ?? resolveCaptchaLanguage(),
    config.captchaLogoImg ?? "",
  ].join("::");
}

async function initController(
  config: RequestVerificationConfig,
  signal?: AbortSignal,
): Promise<CaptchaController> {
  const region = config.region;
  const prefix = config.prefix;
  const sceneId = config.sceneId;
  if (!region || !prefix || !sceneId) {
    throw new Error("Request verification configuration is invalid");
  }

  const key = configKey(config);
  if (controller && controller.configKey === key) return controller;

  resetController();
  await loadScript(signal);
  signal?.throwIfAborted();

  const { button } = getHostElements();
  window.AliyunCaptchaConfig = { region, prefix };

  const instancePromise = new Promise<AliyunCaptchaInstance>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Captcha instance timed out after ${INSTANCE_TIMEOUT_MS}ms.`));
    }, INSTANCE_TIMEOUT_MS);

    try {
      window.initAliyunCaptcha?.({
        SceneId: sceneId,
        region,
        prefix,
        mode: config.mode ?? "popup",
        language: config.language ?? resolveCaptchaLanguage(),
        ...(config.captchaLogoImg ? { captchaLogoImg: config.captchaLogoImg } : {}),
        showErrorTip: false,
        element: `#${CAPTCHA_ELEMENT_ID}`,
        button: `#${CAPTCHA_BUTTON_ID}`,
        getInstance: (instance) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(instance);
        },
        success: (captchaVerifyParam) => {
          const attempt = activeAttempt;
          activeAttempt = null;
          attempt?.resolve(captchaVerifyParam);
        },
        fail: handleSdkFail,
        onError: (error) => {
          const attempt = activeAttempt;
          activeAttempt = null;
          attempt?.reject(
            error instanceof Error ? error : new Error("Captcha verification failed."),
          );
        },
      });
    } catch (error) {
      window.clearTimeout(timeout);
      reject(error);
    }
  });

  controller = { configKey: key, instancePromise, button };
  return controller;
}

async function getProof(
  config: RequestVerificationConfig,
  options: CaptchaAttemptOptions,
): Promise<RequestVerificationProof | undefined> {
  return withSlot(async () => {
    const signal = options.signal;
    signal?.throwIfAborted();

    const current = await initController(config, signal);
    const instance = await withAbort(current.instancePromise, signal);
    signal?.throwIfAborted();

    const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;

    const captchaVerifyParam = await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        activeAttempt = null;
        resetController();
        reject(new Error(`Captcha verification timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const onAbort = () => {
        window.clearTimeout(timeout);
        activeAttempt = null;
        resetController();
        reject(abortReason(signal!));
      };

      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      activeAttempt = {
        resolve: (value) => {
          window.clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        allowInteractive: options.allowInteractive !== false,
      };

      try {
        if (options.allowInteractive !== false) {
          current.button.click();
        } else if (typeof instance.startTracelessVerification === "function") {
          instance.startTracelessVerification();
        } else {
          throw new Error("Traceless verification is unavailable for this captcha instance.");
        }
      } catch (error) {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        activeAttempt = null;
        reject(error);
      }
    });

    signal?.throwIfAborted();
    if (!captchaVerifyParam.trim()) return undefined;

    return {
      captchaVerifyParam,
      ...(config.region ? { captchaRegion: config.region } : {}),
    };
  });
}

function withSlot<T>(task: () => Promise<T>): Promise<T> {
  const run = attemptQueue.then(task, task);
  attemptQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function prewarmCaptcha(
  service: RequestVerificationService,
  signal?: AbortSignal,
): Promise<void> {
  const config = await service.getRequestVerificationConfig();
  signal?.throwIfAborted();
  if (!config || config.enabled === false) return;
  if (!config.region || !config.prefix || !config.sceneId) return;
  await initController(config, signal);
}

export const captchaPort: CaptchaPort = { getProof };

// 供测试/诊断读取 host 是否已挂载；不暴露 proof 或实例状态。
export function captchaHostMounted(): boolean {
  return (
    document.getElementById(CAPTCHA_CONTAINER_ID) instanceof HTMLElement &&
    document.getElementById(CAPTCHA_ELEMENT_ID) instanceof HTMLElement &&
    document.getElementById(CAPTCHA_BUTTON_ID) instanceof HTMLButtonElement
  );
}
