#!/usr/bin/env bash
# ============================================================================
# ZCode 源码版开发实例 · 一键重编+重启（后台运行）
#
# 用途：改完源码后运行本脚本 → 杀旧实例 → 重编 → 后台拉起 → 健康检查。
# 用法（Git Bash）：
#   cd /c/software/ZCode && ./restart-dev.sh
#
# 行为说明：
#   - 只杀 electron.exe（源码开发版）；官方安装版进程名是 ZCode.exe，不受影响。
#   - 重编 main/host/preload/scheduler（tsup）与手机端页面（packages/web）。
#   - 渲染层由 vite dev (5174) 热更新：存活则复用（改 UI 源码无需重编），
#     未运行则自动后台拉起。
#   - 数据目录隔离在 C:\Users\hgq\.zcode-dev-home，与官方安装版互不干扰。
#   - 运行日志：/tmp/zcode-dev-relaunch.log（vite: .log.vite）
#
# 注意：跑过 pnpm install 之后 electron 二进制会被清掉，本脚本会自动重装。
# ============================================================================
set -uo pipefail

REPO="/c/software/ZCode"
NODE_BIN="/c/software/node24/node-v24.14.0-win-x64"
DATA_DIR='C:\Users\hgq\.zcode-dev-home'
LOG="${TMPDIR:-/tmp}/zcode-dev-relaunch.log"
PORT=41889

export PATH="$NODE_BIN:$PATH"
export ZCODE_ENV=production
export ZCODE_DESKTOP_AGENT_BYTECODE=0
export ZCODE_DATA_BASE_DIR="$DATA_DIR"

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# vite dev 在 Windows 上可能只绑 127.0.0.1 或只绑 [::1]，探活需双栈都试
probe_vite() {
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:5174/ ||
    curl -s -o /dev/null --max-time 2 "http://[::1]:5174/"
}

cd "$REPO" || exit 1

# 0) electron 二进制自愈（pnpm install 的坏 postinstall 会清掉 dist）
if [ ! -f "$REPO/node_modules/electron/dist/electron.exe" ]; then
  step "electron 二进制缺失，重装（npmmirror）"
  (cd "$REPO/node_modules/electron" &&
    ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ "$NODE_BIN/node.exe" install.js) ||
    { echo "electron 重装失败"; exit 1; }
fi

# 1) 杀旧实例
step "杀旧开发实例（仅 electron.exe，官方 ZCode.exe 不受影响）"
taskkill //IM electron.exe //F >/dev/null 2>&1
sleep 2

# 2) 重编桌面主进程/宿主/预加载/调度器
step "重编 main/host/preload/scheduler (tsup)"
(cd "$REPO/packages/desktop" && ../../node_modules/.bin/tsup) || { echo "tsup 失败"; exit 1; }

# 3) 重编手机端页面
step "重编手机端页面 (packages/web)"
(cd "$REPO/packages/web" && ../../node_modules/.bin/vite build) || { echo "web 构建失败"; exit 1; }

# 4) 渲染层 vite dev：存活复用，未运行则后台拉起
step "渲染层 vite dev (5174)"
if probe_vite; then
  echo "  存活，复用（渲染层源码改动热更新，无需重编）"
else
  (cd "$REPO/packages/desktop" &&
    nohup ../../node_modules/.bin/vite dev > "${LOG}.vite" 2>&1 &)
  ok=0
  for _ in $(seq 1 30); do
    if probe_vite; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != 1 ]; then
    echo "vite dev 启动失败，日志: tail -40 ${LOG}.vite"
    exit 1
  fi
  echo "  已拉起"
fi

# 5) 后台拉起桌面实例
step "后台拉起桌面实例"
cd "$REPO/packages/desktop" || exit 1
nohup node scripts/dev.mjs > "$LOG" 2>&1 &
echo "  dev.mjs PID=$!"

# 6) 健康检查：等手机远控端口就绪（= 主进程与内嵌服务器都已起来）
step "健康检查（等待 $PORT 就绪，最多 40s）"
ok=0
for _ in $(seq 1 40); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/panel"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" = 1 ]; then
  echo "  ✓ 就绪：桌面窗口已起，手机远控 http://127.0.0.1:$PORT/panel"
  echo "  日志: tail -f $LOG"
else
  echo "  ✗ $PORT 未就绪，排查: tail -40 $LOG"
  exit 1
fi
