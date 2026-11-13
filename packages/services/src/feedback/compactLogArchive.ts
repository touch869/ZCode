import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getAppConfigDir, getFeedbackLogArchiveDir } from "../paths.js";
import { createFeedbackDiagnosticArchive } from "./feedbackLogArchive.js";

interface ArchiveProgressEvent {
  processedBytes: number;
  totalBytes: number;
}

export async function prepareCompactLogArchive(options?: {
  full?: boolean;
  createFullArchive?: (
    sourceDir: string,
    options?: { onProgress?: (event: ArchiveProgressEvent) => void },
  ) => Promise<{ path: string; size: number }>;
  onProgress?: (event: ArchiveProgressEvent) => void;
}): Promise<{ path: string; size: number }> {
  const sourceDir = getAppConfigDir();
  if (options?.full && options.createFullArchive) {
    return options.createFullArchive(sourceDir, { onProgress: options.onProgress });
  }
  return createFeedbackDiagnosticArchive({
    // 本线不把 CLI 分配诊断目录纳入反馈归档：该目录含 bundle 函数名/行列号/哈希，本线要求不出端。
    sources: [{ directory: join(sourceDir, "logs"), archivePrefix: "logs" }],
    outputRootDir: getFeedbackLogArchiveDir(),
    ...(!options?.full ? { maxTotalBytes: 2 * 1024 * 1024 } : {}),
    onProgress: options?.onProgress,
  });
}

export async function cleanupLogArchive(path: string): Promise<void> {
  await rm(join(path, ".."), { recursive: true, force: true }).catch(() => {});
}
