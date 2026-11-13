/** 发行策略边界；请求状态与异步编排仍由调用方持有。 */
export const requestSecurityEditionModule = {
  id: "request-security-edition",
  requires: ["shared", "request-security-aliyun-policy"],
  provides: ["request-security-edition"],
  publicEntrypoints: ["index.ts", "policy.ts", "verification-policy.ts", "contract.ts"],
} as const;
