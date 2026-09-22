#!/usr/bin/env bash
# ============================================================================
# ZCode 源码版开发实例 · 一键重编+重启（后台运行，带启动失败自动回滚）
#
# 用途：改完源码后运行本脚本 → 重编（增量，没改的包自动跳过）→ 杀旧 →
#       后台拉起 → 健康检查。
# 用法（Git Bash）：
#   cd /c/software/ZCode && ./restart-dev.sh
#   HEALTH_PORT=49999 ./restart-dev.sh   # 健康检查端口被占用等特殊场景
#   ./restart-dev.sh --full              # 忽略增量戳，强制全量重编
#
# 失败安全：
#   - 编译失败：旧实例还活着（先编后杀），什么都不受影响，改完再跑。
#   - 编译通过但起不来：自动回滚到上次可用产物（out-bak = 上次健康检查
#     通过后的产物快照，位于 packages/desktop/out-bak）并重新拉起；
#     失败日志存 relaunch.log.failed。
#   - 渲染层白屏（vite dev 直接吃源码，无产物可回滚）：走 git 回退你的
#     改动（git stash / checkout）后再跑本脚本。
#
# 其它：
#   - 只杀 electron.exe（源码开发版）；官方安装版进程是 ZCode.exe，不受影响。
#   - 渲染层由 vite dev (5174) 热更新：存活则复用（改 UI 源码无需重编），
#     未运行则自动后台拉起。Windows 上 vite 可能只绑 [::1]，探活需双栈。
#   - 数据目录隔离在 C:\Users\hgq\.zcode-dev-home，与官方安装版互不干扰。
#   - 运行日志：/tmp/zcode-dev-relaunch.log（vite: .log.vite）
#   - 跑过 pnpm install 后 electron 二进制会被清掉，本脚本会自动重装。
# ============================================================================
set -uo pipefail

REPO="/c/software/ZCode"
DESKTOP="$REPO/packages/desktop"
WEB="$REPO/packages/web"
NODE_BIN="/c/software/node24/node-v24.14.0-win-x64"
DATA_DIR='C:\Users\hgq\.zcode-dev-home'
LOG="${TMPDIR:-/tmp}/zcode-dev-relaunch.log"
FAILED_LOG="${LOG}.failed"
OUT_DIR="$DESKTOP/out"
OUT_BAK="$DESKTOP/out-bak"
TSUP_STAMP="$DESKTOP/.tsup.stamp"
WEB_STAMP="$WEB/.web.stamp"
HEALTH_PORT="${HEALTH_PORT:-41889}"

export PATH="$NODE_BIN:$PATH"
export ZCODE_ENV=production
export ZCODE_DESKTOP_AGENT_BYTECODE=0
export ZCODE_DATA_BASE_DIR="$DATA_DIR"

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

probe_vite() {
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:5174/ ||
    curl -s -o /dev/null --max-time 2 "http://[::1]:5174/"
}

kill_instance() {
  taskkill //IM electron.exe //F >/dev/null 2>&1
  sleep 2
}

launch() {
  (cd "$DESKTOP" && nohup node scripts/dev.mjs > "$LOG" 2>&1 &)
}

wait_health() {
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$HEALTH_PORT/panel"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# 增量判断：stamp 比 src 目录里任何文件新 → 跳过重编
sources_fresh() { # $1=stamp 其余=src 根
  local stamp="$1"
  shift
  [ -f "$stamp" ] || return 1
  local dir
  for dir in "$@"; do
    if find "$dir" -type f -newer "$stamp" -print -quit 2>/dev/null | grep -q .; then
      return 1
    fi
  done
  return 0
}

cd "$REPO" || exit 1
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

# 0) electron 二进制自愈（pnpm install 的坏 postinstall 会清掉 dist）
if [ ! -f "$REPO/node_modules/electron/dist/electron.exe" ]; then
  step "electron 二进制缺失，重装（npmmirror）"
  (cd "$REPO/node_modules/electron" &&
    ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ "$NODE_BIN/node.exe" install.js) ||
    { echo "electron 重装失败"; exit 1; }
fi

# 1) 重编主进程/宿主/预加载/调度器（增量；此时旧实例仍在跑，失败无影响）
if [ "$FULL" = 0 ] && sources_fresh "$TSUP_STAMP" \
    "$DESKTOP/src" "$REPO/packages/shared/src" "$REPO/packages/rpc/src" \
    "$REPO/packages/client/src" "$REPO/packages/services/src" \
    "$REPO/packages/provider/src" "$REPO/packages/provider-node/src"; then
  step "tsup：源码无变化，跳过"
else
  step "重编 main/host/preload/scheduler (tsup)"
  (cd "$DESKTOP" && ../../node_modules/.bin/tsup) || {
    echo "✗ tsup 失败：旧实例未受影响，改完代码再跑本脚本"
    exit 1
  }
  touch "$TSUP_STAMP"
fi

# 2) 重编手机端页面（增量）
if [ "$FULL" = 0 ] && sources_fresh "$WEB_STAMP" \
    "$WEB/src" "$REPO/packages/ui/src" "$REPO/packages/shared/src" \
    "$REPO/packages/rpc/src" "$REPO/packages/client/src"; then
  step "web：源码无变化，跳过"
else
  step "重编手机端页面 (packages/web)"
  (cd "$WEB" && ../../node_modules/.bin/vite build) || {
    echo "✗ web 构建失败：旧实例未受影响，改完代码再跑本脚本"
    exit 1
  }
  touch "$WEB_STAMP"
fi

# 3) 渲染层 vite dev：存活复用，未运行则后台拉起
step "渲染层 vite dev (5174)"
if probe_vite; then
  echo "  存活，复用（渲染层源码改动热更新，无需重编）"
else
  (cd "$DESKTOP" && nohup ../../node_modules/.bin/vite dev > "${LOG}.vite" 2>&1 &)
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

# 4) 编译全部通过，才杀旧实例
step "杀旧实例（仅 electron.exe，官方 ZCode.exe 不受影响）"
kill_instance

# 5) 后台拉起新实例 + 健康检查
step "后台拉起新实例"
launch
step "健康检查（等待 $HEALTH_PORT 就绪，最多 40s）"
if wait_health; then
  echo "  ✓ 就绪：桌面窗口已起，手机远控 http://127.0.0.1:$HEALTH_PORT/panel"
  # 健康通过后才刷新回滚快照（out-bak 永远是「上次确认可用」的产物）
  rm -rf "$OUT_BAK"
  cp -r "$OUT_DIR" "$OUT_BAK"
  echo "  日志: tail -f $LOG"
  exit 0
fi

# 6) 启动失败 → 自动回滚到上次可用产物
step "✗ 新实例启动失败，自动回滚到上次可用版本"
if [ ! -d "$OUT_BAK" ]; then
  echo "  ✗ 无 out-bak 备份可回滚（首次运行？）。排查: tail -40 $LOG"
  exit 1
fi
cp "$LOG" "$FAILED_LOG"
kill_instance
rm -rf "$OUT_DIR"
mv "$OUT_BAK" "$OUT_DIR"
launch
if wait_health; then
  echo "  ✓ 已回滚并拉起上个可用版本——你这次的改动有问题，失败日志:"
  echo "    $FAILED_LOG"
else
  echo "  ✗ 回滚后仍未就绪（可能渲染层问题，走 git 回退源码）。日志: $FAILED_LOG"
  exit 1
fi
