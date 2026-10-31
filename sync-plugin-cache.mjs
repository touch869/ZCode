// 官方插件缓存同步（restart-dist.sh 部署后调用）。
//
// 背景（2026-10-13 CUA 全盲第五层根因）：桌面 host 会优先 spawn 仓库树 CLI
// （apps/zcode-cli/packages/cli/dist/zcode.cjs），其 bootstrap 的插件 seed 在
// Windows 上偶发静默降级（seed 锁残留 / 替换 EPERM），缓存于是停留在旧内容——
// 包是对的、缓存是旧的，node_repl 一直跑旧 bundle。restart-dist.sh 又必然
// taskkill，天然制造锁残留。因此在「进程已死、无任何句柄」的打包完成后立刻
// 把 glm 树的插件内容直接刷进用户缓存，绕开 seed 的并发/锁问题。
//
// 语义：
//   - 对 glm/packages/*/<.zcode-plugin/plugin.json> 的每个插件包，按
//     name@version 定位 ~/.zcode/cli/plugins/cache/zcode-plugins-official/<name>/<version>/，
//     覆盖拷贝全部文件（不删除缓存里的多余文件——source map、marker 等留着无害，
//     删除反而可能碰上句柄）。
//   - marker（.zcode-plugin-seed.json）不写不删：hash 过期只会让下次 boot 多跑
//     一次（成功则重写同样内容，失败则降级用本脚本刷好的缓存——两个方向都正确）。
//   - 顺带清掉 name@version 同级的 *.backup-* / *.seed-lock / *.stale-* / *.tmp-*
//     残留（历史失败的 seed 遗物）。
//   - 任一插件失败只告警不中断（部署本身已成功，缓存问题不该触发回滚）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
// glm 树在打包产物里的位置按平台不同：win 免安装版在 win-unpacked/resources 下，
// mac 是 .app bundle（Contents/Resources）。取存在的那份，两个都没有即产物未打包。
const glmPackagesCandidates = [
  join(repoRoot, "packages", "desktop", "dist", "win-unpacked", "resources", "glm", "packages"),
  join(
    repoRoot,
    "packages",
    "desktop",
    "dist",
    "mac-arm64",
    "ZCode.app",
    "Contents",
    "Resources",
    "glm",
    "packages",
  ),
];
const glmPackagesDir = glmPackagesCandidates.find((candidate) => existsSync(candidate));
if (!glmPackagesDir) {
  console.error("[sync-plugin-cache] 未找到打包产物的 glm 目录——先跑 electron-builder 打包");
  process.exit(1);
}
const cacheMarketplaceDir = join(
  process.env.USERPROFILE ?? homedir(),
  ".zcode",
  "cli",
  "plugins",
  "cache",
  "zcode-plugins-official",
);

function walkFiles(dir, base, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, base, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

let synced = 0;
let failed = 0;

for (const name of readdirSync(glmPackagesDir, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  const sourceRoot = join(glmPackagesDir, name.name);
  const manifestPath = join(sourceRoot, ".zcode-plugin", "plugin.json");
  if (!existsSync(manifestPath)) continue;

  let plugin;
  try {
    plugin = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.warn(`[sync-plugin-cache] skip ${name.name}: bad plugin.json (${error.message})`);
    failed++;
    continue;
  }
  const targetRoot = join(cacheMarketplaceDir, String(plugin.name), String(plugin.version));

  try {
    mkdirSync(targetRoot, { recursive: true });
    let copied = 0;
    let skippedLocked = 0;
    for (const sourcePath of walkFiles(sourceRoot, sourceRoot)) {
      const targetPath = join(targetRoot, sourcePath.slice(sourceRoot.length + 1));
      mkdirSync(dirname(targetPath), { recursive: true });
      // 只拷差异文件：内容一致的跳过。运行中的 node_repl 会锁住缓存里的
      // .node 原生库（EBUSY）——内容没变时无需触碰；内容变了也只告警不失败
      // （部署后进程已死是主场景，此处是中途补跑的边角）。
      const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
      try {
        if (sha(sourcePath) === sha(targetPath)) continue;
      } catch {
        // 目标缺失等情况直接走拷贝
      }
      try {
        copyFileSync(sourcePath, targetPath);
        copied++;
      } catch (error) {
        if (error.code === "EBUSY" || error.code === "EPERM") {
          skippedLocked++;
          continue;
        }
        throw error;
      }
    }
    // 同级残留：seed 失败的 backup/tmp/锁目录（锁是目录形态，rmSync 收掉）
    const parent = dirname(targetRoot);
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!/\.(backup-|seed-lock$|stale-|tmp-)/.test(entry.name)) continue;
      if (entry.name === name.name) continue;
      rmSync(join(parent, entry.name), { recursive: true, force: true });
      console.log(`[sync-plugin-cache] cleaned stale seed leftover: ${entry.name}`);
    }
    console.log(
      `[sync-plugin-cache] ${plugin.name}@${plugin.version}: ${copied} files synced` +
        (skippedLocked ? `, ${skippedLocked} locked-but-stale skipped (in use)` : ""),
    );
    synced++;
  } catch (error) {
    console.warn(
      `[sync-plugin-cache] FAILED ${plugin.name}@${plugin.version}: ${error.message} (deploy continues)`,
    );
    failed++;
  }
}

console.log(`[sync-plugin-cache] done: ${synced} synced, ${failed} failed`);
process.exitCode = failed > synced ? 1 : 0;
