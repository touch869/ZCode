import type { WebContents } from "electron";

/** 遥测移除后的兼容桩：ARMS perf-collector 的 load 补发注入已停用。 */
export function scheduleArmsBrowserPerfLoadNudge(_webContents: WebContents): void {}
