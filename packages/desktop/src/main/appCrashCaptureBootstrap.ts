import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 须在 appARMSBootstrap 之前完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// 本线 ARMS 已被 no-op 替身取代（shared/armsRumNoop.ts），不存在远端 crash 上报，因此传
// false 启动 Electron 本地 crashReporter：uploadToServer=false、submitURL 指向 .invalid，
// dump 只落盘到 crashDumps 并在下次启动归档，不产生任何出端请求。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
