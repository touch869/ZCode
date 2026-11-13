/**
 * request-security-aliyun-ui 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const requestSecurityAliyunUiModule = {
  id: "request-security-aliyun-ui",
  requires: ["shared", "ui"],
  provides: ["request-security-aliyun-ui"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "claim.ts",
    "errors.ts",
    "messages.ts",
    "parity.ts",
  ],
} as const;
