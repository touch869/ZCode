# ZCode 桌面版升级工作方式（Windows 本机出包 + 重启）

> **跟版升级（迁 main、出双产物、安装与验收顺序）以 [AGENTS.md「官方跟版升级」](../../AGENTS.md) 为准。**
> 本文件只讲本机 `restart-dist.sh` 这条"重编 + 替换正在跑的应用"的链路。

本文件记录「在本机打出桌面包、替换掉正在跑的应用」这条链路的
固定做法、已知坑与故障对照。**这是操作记忆，不是产品规格**；改脚本行为前仍按
`AGENTS.md` 先更新对应 spec。

运行形态：日常使用的是 **NSIS 安装版**（`%LOCALAPPDATA%\Programs\ZCode`），仓库
`packages/desktop/dist` 只是构建产物、不再是在跑包；`restart-dist.sh` 面向"免安装版
直接替换"这条旧链路，仍可用，但不用于日常升级。

---

## 1. 一句话流程

```bash
cd /c/software/ZCode
./restart-dist.sh          # 编译 → 关旧实例 → 备份 → 打包 → 拉起 → 终态验证
```

成功判据：退出码 0，日志末尾 `✓ 部署链路终态全绿`，`packages/desktop/dist/win-unpacked/ZCode.exe`
在跑，`dist/ZCode-<version>-win-x64.exe` 已产出。

---

## 2. 前置条件（缺一项就会以奇怪的方式失败）

| 项 | 要求 | 为什么 |
| --- | --- | --- |
| Defender | 仓库目录在排除项内（`Add-MpPreference -ExclusionPath 'C:\software\ZCode'`，需管理员） | 未排除时 asar 阶段 ~1MB/s；排除后 `asar-extract` 从 108s 降到 50s |
| Node/pnpm | `C:\software\node24\node-v24.14.0-win-x64` 在 PATH（脚本自己会加） | husky pre-push 也要，见 5.2 |
| 磁盘 | `C:` 至少 ~10GB 空闲 | 包本体 1.0GB + 备份 1.0GB + 安装包 246MB |

---

## 3. 两个最容易踩的语义

### 3.1 构建身份：`ZCODE_ENV`（v3.17.2 起）

`packages/desktop/scripts/desktop-product-identity.mjs` 把「身份」和「后端环境」拆成两轴：

| `ZCODE_ENV` | productName | 安装包名 | appId |
| --- | --- | --- | --- |
| `production` | `ZCode` | `ZCode-<ver>-win-x64.exe` | `dev.zcode.app` |
| 未设 / 其它 | `ZCode Preview` | `ZCode Preview-<ver>-win-x64_TEST.exe` | `dev.zcode.app.preview` |

`restart-dist.sh` 的 `EXE_REL`、`taskkill //IM ZCode.exe`、`launch`、`verify-cua-deploy` 全按
`ZCode` 写，所以脚本已默认 `export ZCODE_ENV="${ZCODE_ENV:-production}"`（且必须在
`pnpm build` 之前——tsup 会把该值烘进产物）。

不钉死的后果：**打包成功，但门禁判「ZCode.exe 不存在」→ 误回滚删掉刚打好的包**，再报一句
误导性的「回滚后仍未就绪（数据/环境问题）」。

### 3.2 pnpm 布局：`node-linker=hoisted`

v3.17.2 官方把 `.npmrc` 切成 `node-linker=hoisted`。`node_modules/.pnpm/` 里只剩
`lock.yaml` 是**正常现象**，不要当依赖损坏。

---

## 4. 标准操作

### 4.1 合入新官方版本

1. 旧 main 先留本地分支（`git branch backup-main-pre<ver>`），再 rebase/pick 到官方 tag。
2. 补 `packages/desktop/package.json` 的 `version`（官方发版管线在仓外注入，electron-builder 26.17 强制要求显式版本）。
3. 依赖对齐：`pnpm install`（hoisted 后首次会重建，暖 store 约 15s）。

### 4.2 出包并替换本机实例

```bash
cd /c/software/ZCode && ./restart-dist.sh
```

脚本内部顺序（**先编后杀**，编译失败不动旧实例）：
`pnpm install` → `pnpm -r --workspace-concurrency=1 run build` → 门禁 `out/main/index.js`
→ `taskkill //IM ZCode.exe` → `mv win-unpacked win-unpacked-bak`（最多重试 120s）
→ `electron-builder`（免安装 + NSIS）→ 门禁 `win-unpacked/ZCode.exe`
→ `sync-plugin-cache.mjs` → 拉起 → 20s 健康检查 → 等 25s → 重刷缓存
→ `verify-cua-deploy.mjs --fix`。

失败自动回滚：`kill → rm -rf win-unpacked → mv bak 回来 → 拉起 → 复查`。
启动成功也不删备份，下次运行才被顶替。

### 4.3 验收

```bash
# 日志
grep -E '✓|✗|Segmentation' packages/desktop/dist-relaunch.log
# 终态（脚本已跑，必要时单独跑）
node verify-cua-deploy.mjs --fix
# 产物
ls packages/desktop/dist/*.exe
```

`verify-cua-deploy.mjs` 的 6 项（包内 bundle / 缓存逐字节 / CUA 原生驱动 / asar env 修补 /
运行实例来自 dist 包 / 插件宿主不落后于缓存）全绿才算完。

### 4.4 推送

```bash
export PATH="/c/software/node24/node-v24.14.0-win-x64:$PATH"   # husky 需要 pnpm
git push --force-with-lease=main:<旧origin sha> origin main
```

rebase 过的主线只能强推；**推之前先把旧 main 存成远端备份分支**，避免远端历史丢失：

```bash
git push --no-verify origin backup-main-pre<ver>:refs/heads/backup-main-pre<ver>
```

---

## 5. 故障对照表

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| `web` 构建在 `✓ 8304 modules transformed` 之后 `Segmentation fault`（或 0xC0000005 / 0xC0000409） | rolldown 原生层崩 | 先重跑一次；仍崩可试 `wsl --shutdown` 后重跑作对照。不要改 `--max-old-space-size`，与 JS 堆无关 |
| 打包成功但门禁报 `ZCode.exe 不存在`，随后自动回滚 | `ZCODE_ENV` 未钉死，产物是 `ZCode Preview.exe` | 确认脚本有 `export ZCODE_ENV=${ZCODE_ENV:-production}`；门禁会打印实际 exe 名 |
| `make_backup` 首次 `mv` 报 `Directory not empty` | 上一代 `win-unpacked-bak` 还在，`mv` 会嵌套 | 脚本会 `rm -rf` 后重试；持续失败说明有进程握着目录 |
| 拉起后 20s 内退出、日志无 error | 在 agent 会话里执行（job 对象会杀 GUI 子进程；`notepad` 同样秒退） | 在用户自己的终端跑脚本，或用 `explorer.exe` 转手启动 |
| `git push` 报 `pnpm: command not found` | husky hook 的 PATH 里没有 node24 | `export PATH="/c/software/node24/node-v24.14.0-win-x64:$PATH"` |
| `git push` 报「推送目标不是当前 HEAD」 | 一次推多个 ref（含备份分支） | 备份分支单独 `--no-verify` 推，main 单独推 |

---

## 6. 参考耗时（本机，Defender 已排除）

| 阶段 | 耗时 |
| --- | --- |
| `pnpm install`（暖 store） | ~15s |
| `pnpm -r build`（含 desktop） | ~4m15s |
| electron-builder（含 sourcemap 解包重打 + NSIS） | ~4m |
| 拉起 + 健康检查 + 终态验证 | ~40s |
| **合计** | **~9m** |

未做 Defender 排除时同一台机器约 30~40 分钟（asar 相关两段占 11 分钟）。
