import type { ZCodeRuntimeEnv } from "@zcode/shared";

/**
 * 遥测移除后的兼容桩：ARMS Browser SDK 已卸载，初始化恒为成功且不产生副作用。
 */
export function initArmsBrowserRumOnce(_runtimeEnv: ZCodeRuntimeEnv): boolean {
  return true;
}

/** preload/renderer 原有调用点保留；无 SDK 可初始化，直接空操作。 */
export function scheduleArmsBrowserRumInit(_runtimeEnv: ZCodeRuntimeEnv, _maxAttempts = 50): void {}
