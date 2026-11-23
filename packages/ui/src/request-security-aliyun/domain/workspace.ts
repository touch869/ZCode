import type { RequestSecurityWorkspaceTab } from "../contract.js";

export function workspaceKey(tab: RequestSecurityWorkspaceTab): string {
  return tab.workspaceIdentity?.trim() || tab.workspacePath;
}

export function dedupeWorkspaceTabs(
  tabs: readonly RequestSecurityWorkspaceTab[],
): RequestSecurityWorkspaceTab[] {
  const seen = new Set<string>();
  const result: RequestSecurityWorkspaceTab[] = [];
  for (const tab of tabs) {
    const key = workspaceKey(tab);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tab);
  }
  return result;
}
