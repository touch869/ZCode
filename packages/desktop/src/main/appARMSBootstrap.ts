/**
 * 遥测移除后的兼容桩：仅保留 armsInitPromise 语义（立即 resolve），
 * 消费方（index.ts 的 await armsInitPromise）无需感知。ARMS SDK 已卸载。
 */
export const armsInitPromise: Promise<void> = Promise.resolve();
