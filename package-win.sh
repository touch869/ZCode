#!/usr/bin/env bash
# ============================================================================
# ZCode-CE Windows 正式包 · 一键打包
#
# 用途：把当前源码打成 dist/ 下的安装器 exe + win-unpacked（两者同源，一次生成）。
# 用法（Git Bash）：
#   cd /c/software/ZCode && ./package-win.sh            # 常规：跳过 agent 链重编，约 15 分钟
#   cd /c/software/ZCode && ./package-win.sh --full     # 全量：agent CLI 链/CUA 驱动/native
#                                                       #       tools 也重编，约 25-30 分钟
#
# 什么时候用 --full：改了 apps/zcode-cli（agent 链源码）、CUA 驱动相关、
# native search tools 之后；只改 main/renderer/web 源码用默认即可。
#
# 说明：
#   - 可以带着 dev 实例一起跑：生产构建重写 out/ 不影响运行中的 dev
#     （渲染层走 vite dev 吃源码，主进程已加载进内存）。但打好的包与 dev
#     实例默认共写真实 ~/.zcode，**打完包后两者不可同时运行**。
#   - dist\win-unpacked\ZCode-CE.exe 正在运行时重打包会因文件占用失败，
#     脚本会提前检测并拒绝。
#   - 完整日志: /tmp/zcode-package-win.log；失败时打印日志末尾。
#   - 可与 restart-dev.sh 串联（退出码已对齐）：
#       ./restart-dev.sh && ./package-win.sh
#   - 前置修复已永久就位：~/.npmrc 的 script-shell 毒行已删；
#     winCodeSign 缓存已手工解包（绕开 symlink 特权）。
# ============================================================================
set -uo pipefail

REPO="/c/software/ZCode"
DESKTOP="$REPO/packages/desktop"
NODE_BIN="/c/software/node24/node-v24.14.0-win-x64"
LOG="${TMPDIR:-/tmp}/zcode-package-win.log"

export PATH="$NODE_BIN:$PATH"

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $arg（支持 --full / -h）"; exit 1 ;;
  esac
done

# ---- 前置检查 ----
command -v node >/dev/null || { echo "✗ 找不到 node（期望 $NODE_BIN）"; exit 1; }
[ -f "$DESKTOP/scripts/bundle.mjs" ] || { echo "✗ 仓库不完整：找不到 $DESKTOP/scripts/bundle.mjs"; exit 1; }

if tasklist //FI "IMAGENAME eq ZCode-CE.exe" 2>/dev/null | grep -qi "ZCode-CE.exe"; then
  echo "✗ 检测到 ZCode-CE.exe 正在运行（win-unpacked 目录被占用），请先关闭再打包"
  exit 1
fi

FLAGS=(--skip-prepare)
MODE="常规（跳过 agent 链）"
if [ "$FULL" = 1 ]; then
  FLAGS=()
  MODE="全量（含 agent 链重编）"
fi

START_TS=$(date +%s)
step "打包开始：$MODE，日志: $LOG"

# ---- 打包（bundle.mjs 内部串联 prepare:runtime-assets → build → electron-builder → 校验 → 体积审计）----
cd "$DESKTOP" || exit 1
ZCODE_ENV=production node scripts/bundle.mjs --os win --arch x64 "${FLAGS[@]}" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
if [ "$RC" != 0 ]; then
  echo "✗ 打包失败（exit $RC），日志末尾："
  tail -30 "$LOG"
  exit 1
fi

# ---- 产物确认 ----
INSTALLER=$(ls -t "$DESKTOP"/dist/ZCode-CE-*-win-x64.exe 2>/dev/null | head -1)
UNPACKED="$DESKTOP/dist/win-unpacked/ZCode-CE.exe"
if [ -z "$INSTALLER" ] || [ ! -f "$UNPACKED" ]; then
  echo "✗ 打包命令成功但产物缺失，检查日志: $LOG"
  exit 1
fi

ELAPSED=$(( $(date +%s) - START_TS ))
step "✓ 打包完成，耗时 $((ELAPSED / 60)) 分 $((ELAPSED % 60)) 秒"
ls -la "$INSTALLER" "$UNPACKED"
echo "  安装器: $INSTALLER"
echo "  免安装: $UNPACKED"
