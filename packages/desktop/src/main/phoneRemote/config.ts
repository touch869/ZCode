import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";

export const PHONE_REMOTE_DEFAULT_PORT = 41889;

/** 无易混字符的 Crockford 风格字母表；URL 里手输也安全。 */
const TOKEN_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function generatePhoneRemoteToken(length = 24): string {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
  }
  return token;
}

export interface PhoneRemoteConfig {
  enabled: boolean;
  port: number;
  token: string;
}

function resolveConfigFilePath(): string {
  return join(app.getPath("userData"), "phone-remote.json");
}

function resolvePortFromEnv(): number | undefined {
  const raw = process.env.ZCODE_PHONE_REMOTE_PORT?.trim();
  if (!raw) {
    return undefined;
  }
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

/**
 * 手机远控配置落在桌面 userData（与共享任务库分离）：token 是唯一准入凭据，
 * 泄露与否只影响本功能，不牵连 CLI/账号凭据。文件缺失或 token 无效时回填随机
 * token 并立即持久化，避免每次启动都轮换二维码。
 */
export async function loadOrInitPhoneRemoteConfig(): Promise<PhoneRemoteConfig> {
  let config: Partial<PhoneRemoteConfig> = {};
  try {
    config = JSON.parse(await readFile(resolveConfigFilePath(), "utf8")) as Partial<
      PhoneRemoteConfig
    >;
  } catch {
    config = {};
  }
  const envEnabled = process.env.ZCODE_PHONE_REMOTE?.trim();
  const resolved: PhoneRemoteConfig = {
    enabled:
      typeof config.enabled === "boolean"
        ? config.enabled
        : envEnabled === "1" || envEnabled === "true",
    port: resolvePortFromEnv() ?? PHONE_REMOTE_DEFAULT_PORT,
    token:
      typeof config.token === "string" && config.token.length >= 16
        ? config.token
        : generatePhoneRemoteToken(),
  };
  if (
    resolved.token !== config.token ||
    typeof config.enabled !== "boolean" ||
    resolved.port !== config.port
  ) {
    try {
      await savePhoneRemoteConfig(resolved);
    } catch {
      // 持久化失败不阻断启动；下次启动会再尝试回填。
    }
  }
  return resolved;
}

export async function savePhoneRemoteConfig(config: PhoneRemoteConfig): Promise<void> {
  await writeFile(resolveConfigFilePath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
