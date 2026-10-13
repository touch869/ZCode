#!/usr/bin/env bash
# ============================================================================
# ZCode 打包版（dist）· 一键重编+重启（带启动失败自动回滚）
#
# 与 relay 分支的 restart-dev.sh（源码 dev 模式）同宗，面向 dist 正式包：
#   编译 → 编译全过才关 ZCode.exe → 备份当前 dist → 重新打包（免安装版 +
#   NSIS 安装版）→ 拉起新 exe → 健康检查 → 失败自动用备份回滚再拉起。
#
# 失败安全（语义与 restart-dev.sh 一致）：
#   - 编译失败：旧实例还活着（先编后杀），什么都不受影响。
#   - 打包/启动失败：自动回滚到 win-unpacked-bak（上一次可用的包）并重新拉起，
#     失败日志存 packages/desktop/dist-relaunch.log。
#   - 启动成功也不删除备份（启动后可能还有问题），下次运行时才被新备份顶替。
#
# 空间语义（至多一份备份）：
#   - 备份用 mv（同卷改名，零拷贝），任何时刻最多存在两份包：当前 + 上一代备份。
#   - 安装包落在 dist/ 根（同版本同名互相覆盖，不会逐次堆积）。
#
# 用法（Git Bash）：
#   cd /c/software/ZCode && ./restart-dist.sh
#
# 其它：
#   - taskkill 按映像名杀 ZCode.exe：对本脚本而言就是要替换的 dist 包实例。
#   - electron-builder 必须经 pnpm exec 调（直接调 .CMD 会回退 npm 模式，
#     产出 asar 仅 74MB 的坏包，正常 302MB）；全量调用同时产出免安装版与
#     安装版，NSIS 的 beforePack 补丁钩子（patch-nsis-install-section）才会跑。
#   - 仓库在 main(relay-official) 分支上跑包：仓库树 CLI dist 与包必须同源
#     新鲜，所以这里走全量 pnpm build（含 CLI 链），不做增量跳过。
# ============================================================================
set -uo pipefail

REPO="/c/software/ZCode"
DESKTOP="$REPO/packages/desktop"
NODE_BIN="/c/software/node24/node-v24.14.0-win-x64"
PNPM="$NODE_BIN/pnpm.cmd"
APP_DIR="$DESKTOP/dist/win-unpacked"
BAK_DIR="$DESKTOP/dist/win-unpacked-bak"
LOG="$DESKTOP/dist-relaunch.log"

export PATH="$NODE_BIN:$PATH"
export ZCODE_TARGET_OS=win
export ZCODE_TARGET_ARCH=x64

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

app_running() {
  tasklist //FI "IMAGENAME eq ZCode.exe" 2>/dev/null | grep -qi "ZCode.exe"
}

kill_instance() {
  taskkill //IM ZCode.exe //F >/dev/null 2>&1
  # 等进程真正消失（force-kill 后句柄释放有延迟，直接 mv 会 Permission denied）
  for _ in $(seq 1 10); do
    app_running || return 0
    sleep 1
  done
}

# 备份：mv 失败重试（进程退出 ≠ 句柄立放，Defender/AV 还可能短暂握着）；
# 重试先 mv 后清上一代备份（避免误删后自身又失败）；至多 15s，失败报错返回 1
make_backup() {
  [ -d "$APP_DIR" ] || return 0
  local i
  for i in $(seq 1 15); do
    if mv "$APP_DIR" "$BAK_DIR" 2>/dev/null; then
      return 0
    fi
    rm -rf "$BAK_DIR"
    sleep 1
  done
  echo "  ✗ 备份失败（旧包句柄未释放）——本次不部署，旧包原地保留"
  return 1
}

launch() {
  (cd "$APP_DIR" && cmd //c start "" ZCode.exe)
}

# 健康检查：进程拉起后 20s 仍存活（asar 损坏/单实例互斥等死法都在 10s 内现形）
wait_health() {
  sleep 5
  for _ in $(seq 1 16); do
    app_running && return 0
    sleep 1
  done
  return 1
}

# 回滚：清掉失败的 dist/win-unpacked，用备份顶回，再拉起并复查
rollback() {
  kill_instance
  if [ ! -d "$BAK_DIR" ]; then
    echo "  ✗ 无 win-unpacked-bak 可回滚（首次运行？）。日志: $LOG"
    return 1
  fi
  rm -rf "$APP_DIR"
  mv "$BAK_DIR" "$APP_DIR"
  launch
  if wait_health; then
    echo "  ✓ 已回滚并拉起上个可用版本——这次的新包有问题，日志: $LOG"
  else
    echo "  ✗ 回滚后仍未就绪（数据/环境问题），日志: $LOG"
    return 1
  fi
}

exec > >(tee "$LOG") 2>&1

cd "$REPO" || exit 1

# 1) 依赖对齐（store 命中时秒级）+ 全量重编（pnpm -r build，含仓库树 CLI 链）
step "pnpm install"
"$PNPM" install || { echo "✗ install 失败：旧实例未受影响"; exit 1; }

step "全量重编（root pnpm build，含 CLI 链 + desktop out/）"
"$PNPM" run build || { echo "✗ 编译失败：旧实例未受影响，改完代码再跑本脚本"; exit 1; }
if [ ! -f "$DESKTOP/out/main/index.js" ]; then
  echo "✗ 编译门禁不过（out/main/index.js 不存在）：旧实例未受影响"
  exit 1
fi

# 2) 编译全过，才关正在运行的实例
step "关闭 ZCode.exe"
kill_instance

# 3) 备份当前 dist（上一次可用包；旧的上一代备份此时才被顶替，至多一份）。
#    备份做不出来就不部署：没有回滚网的覆盖不符合本脚本的安全语义。
step "备份当前 dist → win-unpacked-bak"
if ! make_backup; then
  step "拉起旧包（未部署新版本）"
  launch
  exit 1
fi
if [ -d "$BAK_DIR" ]; then
  echo "  已备份 → win-unpacked-bak"
fi

# 4) 重新打包：免安装版（win-unpacked）+ 安装版（NSIS，落 dist/ 根，同版本同名覆盖）
step "electron-builder 打包（免安装版 + NSIS 安装版）"
(cd "$DESKTOP" && "$PNPM" exec electron-builder --config electron-builder.config.js --publish never) || {
  echo "✗ 打包失败，自动回滚"
  rollback
  exit 1
}
if [ ! -f "$APP_DIR/ZCode.exe" ]; then
  echo "✗ 打包门禁不过（ZCode.exe 不存在），自动回滚"
  rollback
  exit 1
fi
SETUP_EXE=$(ls -t "$DESKTOP"/dist/*.exe 2>/dev/null | head -1)
[ -n "$SETUP_EXE" ] && echo "  安装版: $SETUP_EXE"

# 4.5) 官方插件缓存同步：此刻进程已死、零句柄，把 glm 树插件内容直接刷进
#      ~/.zcode 缓存（node_repl 实际运行位置）。否则 seed 在 Windows 上偶发
#      静默降级会让缓存停留在旧 bundle（10-13 CUA 全盲的第五层根因）。
#      失败只告警不回滚——部署本身已成功。
step "同步官方插件缓存（node-repl-host 等）"
node "$REPO/sync-plugin-cache.mjs" || echo "  ⚠ 缓存同步失败（不阻断部署）"

# 5) 拉起 + 健康检查
step "拉起新包"
launch
step "健康检查（最多 20s）"
if wait_health; then
  if [ -d "$BAK_DIR" ]; then
    step "✓ 新包已就绪；备份保留在 win-unpacked-bak（确认稳定后可手删），安装版在 dist/ 根"
  else
    step "✓ 新包已就绪（首次运行，本次无备份），安装版在 dist/ 根"
  fi
  exit 0
fi

# 6) 启动失败 → 回滚
step "✗ 新包启动失败，自动回滚"
rollback
exit 1
