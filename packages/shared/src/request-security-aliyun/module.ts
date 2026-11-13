/**
 * request-security-aliyun-policy 模块清单（architecture-governance managed 模块）。
 * 层：domain。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const requestSecurityAliyunPolicyModule = {
  id: "request-security-aliyun-policy",
  requires: ["shared"],
  provides: ["request-security-aliyun-policy"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
