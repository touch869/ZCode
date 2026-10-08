/**
 * 遥测移除后的兼容桩：ARMS user 身份同步已停用（不再上报 device_mid）。
 */
export interface ArmsUserIdentitySyncDeps {
  deviceMid: string;
  setUser: (user: { name: string }) => void;
}

export interface ArmsUserIdentitySync {
  refresh: () => void;
}

export function createArmsUserIdentitySync(_deps: ArmsUserIdentitySyncDeps): ArmsUserIdentitySync {
  return { refresh() {} };
}
