// 部署终态验证：把「代码没问题，部署有问题」的五类断链一次查完。
//
// 背景（10-13~10-15 五次事故的共同根因）：验证的位置 ≠ 执行的位置。同一份代码在
// 运行时有多份副本（包内 glm → 插件缓存 → 长命宿主进程内存），任何一环被旧内容
// 覆盖或定格，表现都是「源码/包明明是对的，行为却是旧的」。本脚本从链路末端
// 反向核对到源头，任何红项都直接指明断链环节：
//   1. 运行中的 app 是不是 dist 包实例（老安装版抢跑 = 10-13 早假成功）
//   2. 包内 glm bundle 是带修复的 esbuild 产物（tsc 风格旧物 = 10-15 第八坑）
//   3. 插件缓存与包内 glm 逐字节一致（缓存冻结/被覆盖 = 第五/八坑）
//   4. 缓存内 @trycua 原生驱动在位（seed 源缺驱动 = 第七坑）
//   5. asar 含 node.ts 的保 env 改动
//   6. 长命插件宿主的创建时间 vs 缓存写入时间（宿主定格旧代码 = 第六坑）
//
// 用法：
//   node verify-cua-deploy.mjs           # 只报告，红项 exit 1
//   node verify-cua-deploy.mjs --fix     # 对第 6 项执行修复：杀掉早于缓存写入的宿主
//                                        # （宿主按需重拉，只影响正在进行的 js 调用）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const fix = process.argv.includes("--fix");

const GLM_SERVER = resolve(
  repoRoot,
  "packages/desktop/dist/win-unpacked/resources/glm/packages/node-repl-host/dist/mcp/server.js",
);
// 版本目录跟随包内插件版本动态解析（3.17.1 起 node-repl-host 升 0.7.0，硬编码 0.6.1 会永远红）
const glmPluginManifest = resolve(
  repoRoot,
  "packages/desktop/dist/win-unpacked/resources/glm/packages/node-repl-host/package.json",
);
let cacheVersionSegment = "";
try {
  cacheVersionSegment = JSON.parse(readFileSync(glmPluginManifest, "utf8")).version ?? "";
} catch {
  cacheVersionSegment = "";
}
if (!cacheVersionSegment) {
  console.error(`✗ 无法读取包内插件版本: ${glmPluginManifest}`);
  process.exit(2);
}
const CACHE_DIR = resolve(
  process.env.USERPROFILE ?? process.cwd(),
  `.zcode/cli/plugins/cache/zcode-plugins-official/node-repl-host/${cacheVersionSegment}`,
);
const CACHE_SERVER = resolve(CACHE_DIR, "dist/mcp/server.js");
const CACHE_DRIVER_NODE = resolve(
  CACHE_DIR,
  "node_modules/@trycua/cua-driver-win32-x64-msvc/cua_driver_node_runtime.node",
);
const ASAR = resolve(repoRoot, "packages/desktop/dist/win-unpacked/resources/app.asar");
const DIST_EXE = resolve(repoRoot, "packages/desktop/dist/win-unpacked/ZCode.exe");

const md5 = (bytes) => createHash("md5").update(bytes).digest("hex").slice(0, 10);
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

// 1) 包内 glm bundle：存在 + esbuild 风格（windowRect 修复在）。tsc 转译产物不含
//    windowRect 字样（10-15 实锤判据），一分钟定位第八坑类问题。
let glmBytes;
try {
  glmBytes = readFileSync(GLM_SERVER);
  check(
    glmBytes.includes("windowRect") && glmBytes.includes("createCuaDriverRuntime"),
    "包内 glm bundle 含 CUA 运行时与 windowRect 修复",
    `md5=${md5(glmBytes)}`,
  );
} catch {
  check(false, "包内 glm bundle 存在", GLM_SERVER);
}

// 2) 插件缓存：与包内逐字节一致（执行副本 = 发布副本）。
try {
  const cacheBytes = readFileSync(CACHE_SERVER);
  check(
    !!glmBytes && cacheBytes.equals(glmBytes),
    "插件缓存 bundle 与包内逐字节一致",
    `md5=${md5(cacheBytes)}`,
  );
} catch {
  check(false, "插件缓存 bundle 存在", CACHE_SERVER);
}

// 3) 缓存内原生驱动。
check(
  existsSync(CACHE_DRIVER_NODE),
  "缓存内 @trycua 原生驱动在位",
  existsSync(CACHE_DRIVER_NODE) ? `${statSync(CACHE_DRIVER_NODE).size} bytes` : CACHE_DRIVER_NODE,
);

// 4) asar 含保 env 改动（recipe 失败不降级 UNAVAILABLE 的标记）。
try {
  const asar = readFileSync(ASAR);
  check(asar.includes("ZCODE_CUA_WIN_OPEN_DRIVER"), "asar 含 node.ts 保 env 改动");
} catch {
  check(false, "asar 可读", ASAR);
}

// 5) 运行中的 app 实例身份 + 宿主进程新鲜度（仅 Windows）。
if (process.platform === "win32") {
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='ZCode.exe'\" | " +
          "Where-Object { $_.CommandLine -notmatch '--type' } | " +
          "ForEach-Object { $_.ExecutablePath }",
      ],
      { encoding: "utf8", timeout: 15000 },
    ).trim();
    const paths = out.split("\n").map((s) => s.trim()).filter(Boolean);
    if (paths.length === 0) {
      console.log("· 当前无 ZCode 主进程运行（部署前检查，跳过实例身份/宿主新鲜度）");
    } else {
      check(
        paths.every((p) => p === DIST_EXE),
        "运行中的 app 全部来自 dist 包",
        [...new Set(paths)].join(" | "),
      );
      // 宿主新鲜度：宿主创建早于缓存 bundle 写入时间 = 内存里是旧代码。
      const cacheMtime = statSync(CACHE_SERVER).mtimeMs;
      const hostOut = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='ZCode.exe'\" | " +
            "Where-Object { $_.CommandLine -match '__zcode-plugin-host' } | " +
            "ForEach-Object { $_.ProcessId.ToString() + ',' + $_.CreationDate.ToString('o') }",
        ],
        { encoding: "utf8", timeout: 15000 },
      ).trim();
      const hosts = hostOut
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [pid, created] = s.split(",");
          return { pid: Number(pid), createdMs: Date.parse(created) };
        });
      if (hosts.length === 0) {
        console.log("· 当前无插件宿主进程（下次 js 调用按需拉起，天然加载最新缓存）");
      } else {
        const stale = hosts.filter((h) => h.createdMs < cacheMtime);
        check(
          stale.length === 0,
          "插件宿主全部晚于缓存写入（无定格旧代码）",
          `hosts=${hosts.length} stale=${stale.length}`,
        );
        if (stale.length > 0 && fix) {
          for (const h of stale) {
            try {
              execFileSync("taskkill", ["/PID", String(h.pid), "/F"], { stdio: "ignore" });
              console.log(`  ↻ --fix 已杀定格宿主 pid=${h.pid}（按需重拉即加载新缓存）`);
            } catch (error) {
              console.log(`  ⚠ --fix 杀宿主失败 pid=${h.pid}: ${error.message}`);
            }
          }
        }
      }
    }
  } catch (error) {
    console.log(`· 进程检查不可用：${error.message}`);
  }
}

console.log(failures.length === 0 ? "\n✅ 部署链路终态全绿" : `\n❌ ${failures.length} 项红：${failures.join("；")}`);
process.exit(failures.length === 0 ? 0 : 1);
