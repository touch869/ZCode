#!/usr/bin/env bash
# ============================================================================
# ZCode 打包版（dist）· 一键重编+重启（带启动失败自动回滚）· mac / Windows 通用
#
# 流程（两平台同语义）：
#   编译 → 编译全过才关正在运行的实例 → 备份当前可用包 → 重新打包 → 部署 →
#   拉起新实例 → 健康检查 → 失败自动用备份回滚再拉起。
#
# 失败安全：
#   - 编译失败：旧实例还活着（先编后杀），什么都不受影响。
#   - 打包/部署/启动失败：自动回滚到上一代备份并重新拉起，
#     失败日志存 packages/desktop/dist-relaunch.log。
#   - 启动成功也不删除备份（启动后可能还有问题），下次运行时才被新备份顶替。
#
# 平台差异：
#   Windows（Git Bash）                            macOS
#   ---------------------------------------------  ---------------------------------------------
#   仓库 /c/software/ZCode（硬编码）               仓库 = 本脚本所在目录（自动识别）
#   工具链 node24 目录 + pnpm.cmd                  mise exec（mise.toml 钉 node/pnpm 版本）
#   electron-builder 原地产出 win-unpacked，       先打出 dist/mac-arm64/ZCode.app（+dmg/zip），
#   备份后原地重打包                               再覆盖部署到 /Applications/ZCode.app
#   备份 win-unpacked-bak                          备份 /Applications/ZCode.app-bak
#   taskkill //IM ZCode.exe //F                    SIGTERM（10s 宽限）→ SIGKILL（先礼后兵）
#   进程识别 tasklist 按映像名                     ps ucomm == ZCode（Electron 主进程会改写
#                                                  自身标题，pgrep -x/-f 都匹配不到，别改回 pgrep）
#   cmd //c start 拉起                             open 拉起
#   启动后 verify-cua-deploy.mjs --fix 终态验证    跳过（该脚本是 Windows 专用：PowerShell +
#                                                  win-unpacked 路径），只做缓存重刷
#
# mac 专项注意：
#   - 本地包是 adhoc 签名；覆盖正式签名包后，macOS 按（bundle id, 签名）记授权，
#     辅助功能/屏幕录制等可能要重勾（系统设置 → 隐私与安全性）。
#   - 请在独立终端（Terminal/iTerm）运行：脚本会退出 ZCode，在 ZCode 会话里跑等于自杀。
#
# 空间语义（至多一份备份）：
#   - 备份用 mv（同卷改名，零拷贝），任何时刻最多两份：当前 + 上一代备份。
#   - 安装包（win NSIS / mac dmg+zip）落 dist/ 根，同版本同名互相覆盖，不逐次堆积。
#
# 用法：
#   Windows(Git Bash):  cd /c/software/ZCode && ./restart-dist.sh
#   macOS:              cd ~/workspace/ZCode && ./restart-dist.sh
#
# 其它：
#   - electron-builder 必须经 pnpm exec 调（直接调 .CMD 会回退 npm 模式，
#     产出 asar 仅 74MB 的坏包，正常 302MB）；全量调用同时产出免安装版与安装版，
#     NSIS 的 beforePack 补丁钩子（patch-nsis-install-section）才会跑。
#   - 仓库在 main(relay-official) 分支上跑包：仓库树 CLI dist 与包必须同源
#     新鲜，所以走全量 pnpm build（含 CLI 链），不做增量跳过。
# ============================================================================
set -uo pipefail

BUNDLE_ID="dev.zcode.app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_BASE="packages/desktop/dist-relaunch.log"

case "$(uname -s)" in
  Darwin) PLATFORM=mac ;;
  MINGW* | MSYS* | CYGWIN*) PLATFORM=win ;;
  *)
    echo "✗ 未支持的平台（$(uname -s)）：本脚本只认 macOS 与 Windows(Git Bash)"
    exit 1
    ;;
esac

if [ "$PLATFORM" = win ]; then
  REPO="/c/software/ZCode"
  DESKTOP="$REPO/packages/desktop"
  NODE_BIN="/c/software/node24/node-v24.14.0-win-x64"
  PNPM="$NODE_BIN/pnpm.cmd"
  APP_DIR="$DESKTOP/dist/win-unpacked"
  BAK_DIR="$DESKTOP/dist/win-unpacked-bak"
  EXE_REL="ZCode.exe"
  export PATH="$NODE_BIN:$PATH"
  export ZCODE_TARGET_OS=win
  export ZCODE_TARGET_ARCH=x64
  LOG="$REPO/$LOG_BASE"
  run_pnpm() { "$PNPM" "$@"; }
  run_node() { node "$@"; }
  packaged_exe_ok() { [ -f "$APP_DIR/$EXE_REL" ]; }
else
  REPO="$SCRIPT_DIR"
  DESKTOP="$REPO/packages/desktop"
  APP_DIR="/Applications/ZCode.app"
  BAK_DIR="/Applications/ZCode.app-bak"
  STAGE_DIR="$DESKTOP/dist/mac-arm64/ZCode.app"
  EXE_REL="Contents/MacOS/ZCode"
  export ZCODE_TARGET_OS=mac
  export ZCODE_TARGET_ARCH=arm64
  LOG="$REPO/$LOG_BASE"
  # mise 按 cwd 发现 mise.toml，必须在仓库目录里调（主流程已 cd "$REPO"），
  # 钉死的 node 24.14.0 + pnpm 10.33.2 随之就位，宿主机 node 版本不影响构建。
  # mise-run.mjs 用 $REPO 绝对路径：electron-builder 步骤 (cd packages/desktop)
  # 后相对路径解析不到（该文件只在仓库根）
  run_pnpm() { mise exec -- node "$REPO/scripts/mise-run.mjs" pnpm "$@"; }
  run_node() { mise exec -- node "$@"; }
  packaged_exe_ok() { [ -f "$STAGE_DIR/$EXE_REL" ]; }
fi

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if [ "$PLATFORM" = mac ]; then
  # Electron 主进程会把进程标题改写成 "ZCode"：ucomm 精确等于 ZCode 的只有主进程，
  # Helper（ZCode Helper / ZCode Computer Use…）与 CLI（zcode-cli）都不会误中
  mac_main_pid() { ps -axo pid=,ucomm= | awk '$2 == "ZCode" {print $1}' | head -1; }

  app_running() { [ -n "$(mac_main_pid)" ]; }

  kill_instance() {
    local pid
    pid="$(mac_main_pid)"
    [ -z "$pid" ] && return 0
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 10); do
      app_running || return 0
      sleep 1
    done
    pid="$(mac_main_pid)"
    if [ -n "$pid" ]; then
      echo "  10s 未退出，SIGKILL"
      kill -9 "$pid" 2>/dev/null
    fi
    for _ in $(seq 1 5); do
      app_running || return 0
      sleep 1
    done
  }

  launch() { open "$APP_DIR"; }

  # 备份：mv 失败重试（LaunchServices 偶尔短暂握着 bundle）；至多 15s，失败报错返回 1
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
    echo "  ✗ 备份失败（旧包被占用）——本次不部署，旧包原地保留"
    return 1
  }

  # 部署：ditto 保住 .app 的权限位/签名 xattr/符号链接（cp -R 可能弄丢 codesign 元数据）
  install_stage() {
    ditto "$STAGE_DIR" "$APP_DIR" || return 1
    [ -f "$APP_DIR/$EXE_REL" ] || return 1
  }
else
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

  launch() {
    (cd "$APP_DIR" && cmd //c start "" ZCode.exe)
  }

  # 备份：mv 失败重试（进程退出 ≠ 句柄立放，Defender/AV 还可能短暂握着）；
  # 重试先 mv 后清上一代备份（避免误删后自身又失败）；
  # 窗口 15s→120s（大包目录被握柄可超 15s，折入 origin 815de52f 的 Windows 修复），
  # 前 3 次失败打印 mv 真实错误与 win-unpacked 占用进程，区分句柄/残留/其他死因
  make_backup() {
    [ -d "$APP_DIR" ] || return 0
    local i mv_err
    for i in $(seq 1 60); do
      if mv_err=$(mv "$APP_DIR" "$BAK_DIR" 2>&1); then
        return 0
      fi
      if [ "$i" -le 3 ]; then
        echo "  mv 失败(第${i}次): $mv_err"
        powershell -NoProfile -Command "Get-Process | Where-Object { \$_.Path -like '*win-unpacked*' } | Select-Object Id,ProcessName,Path | Format-Table -AutoSize | Out-String -Width 200" 2>/dev/null | head -8
      fi
      rm -rf "$BAK_DIR"
      sleep 2
    done
    echo "  ✗ 备份失败（120s 内未释放）——本次不部署，旧包原地保留"
    return 1
  }

  # win 的 electron-builder 直接把 APP_DIR 打出来，无需单独部署步骤
  install_stage() { return 0; }
fi

# 健康检查：进程拉起后 20s 仍存活（asar/Framework 损坏、单实例互斥等死法都在 10s 内现形）
wait_health() {
  sleep 5
  for _ in $(seq 1 16); do
    app_running && return 0
    sleep 1
  done
  return 1
}

# 回滚：清掉失败的新包，用备份顶回，再拉起并复查
rollback() {
  kill_instance
  if [ ! -d "$BAK_DIR" ]; then
    echo "  ✗ 无备份可回滚（首次运行？）。日志: $LOG"
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
run_pnpm install || { echo "✗ install 失败：旧实例未受影响"; exit 1; }

step "全量重编（root pnpm build，含 CLI 链 + desktop out/）"
run_pnpm run build || { echo "✗ 编译失败：旧实例未受影响，改完代码再跑本脚本"; exit 1; }
if [ ! -f "$DESKTOP/out/main/index.js" ]; then
  echo "✗ 编译门禁不过（out/main/index.js 不存在）：旧实例未受影响"
  exit 1
fi

if [ "$PLATFORM" = mac ]; then
  # 2) mac 先打包（产物是 STAGE_DIR，不碰运行中的 /Applications），全过才关实例
  step "electron-builder 打包（ZCode.app + dmg/zip 安装包）"
  (cd "$DESKTOP" && run_pnpm exec electron-builder --config electron-builder.config.js --publish never) || {
    echo "✗ 打包失败：旧实例未受影响（尚未关机），改完代码再跑本脚本"
    exit 1
  }
  if ! packaged_exe_ok; then
    echo "✗ 打包门禁不过（$STAGE_DIR 不存在）：旧实例未受影响"
    exit 1
  fi
  DMG=$(ls -t "$DESKTOP"/dist/*.dmg 2>/dev/null | head -1)
  [ -n "$DMG" ] && echo "  安装包: $DMG"

  step "关闭 ZCode"
  kill_instance

  # 3) 备份 /Applications/ZCode.app（上一次可用包；至多一份）。
  #    备份做不出来就不部署：没有回滚网的覆盖不符合本脚本的安全语义。
  step "备份 /Applications/ZCode.app → ZCode.app-bak"
  if ! make_backup; then
    step "拉起旧包（未部署新版本）"
    launch
    exit 1
  fi
  if [ -d "$BAK_DIR" ]; then
    echo "  已备份 → ZCode.app-bak"
  fi

  step "部署新包 → /Applications/ZCode.app"
  if ! install_stage; then
    echo "✗ 部署失败，自动回滚"
    rollback
    exit 1
  fi
  echo "  ⚠ 本地包为 adhoc 签名：若辅助功能/屏幕录制等权限失效，到 系统设置→隐私与安全性 重新勾选"
else
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
  (cd "$DESKTOP" && run_pnpm exec electron-builder --config electron-builder.config.js --publish never) || {
    echo "✗ 打包失败，自动回滚"
    rollback
    exit 1
  }
  if ! packaged_exe_ok; then
    echo "✗ 打包门禁不过（ZCode.exe 不存在），自动回滚"
    rollback
    exit 1
  fi
  SETUP_EXE=$(ls -t "$DESKTOP"/dist/*.exe 2>/dev/null | head -1)
  [ -n "$SETUP_EXE" ] && echo "  安装版: $SETUP_EXE"
fi

# 4.5) 官方插件缓存同步：此刻进程已死、零句柄，把 glm 树插件内容直接刷进
#      ~/.zcode 缓存（node_repl 实际运行位置）。否则 seed 偶发静默降级会让缓存
#      停留在旧 bundle。失败只告警不回滚——部署本身已成功。
step "同步官方插件缓存（node-repl-host 等）"
run_node "$REPO/sync-plugin-cache.mjs" || echo "  ⚠ 缓存同步失败（不阻断部署）"

# 5) 拉起 + 健康检查
step "拉起新包"
launch
step "健康检查（最多 20s）"
if wait_health; then
  if [ -d "$BAK_DIR" ]; then
    step "✓ 新包已就绪；备份保留（mac: $BAK_DIR / win: win-unpacked-bak，确认稳定后可手删）"
  else
    step "✓ 新包已就绪（首次运行，本次无备份）"
  fi
  # 6) 启动期修复：app 启动会触发插件 seed，存在把缓存写成旧产物的先例。先等
  #    启动尘埃落定，重刷一遍缓存（幂等）；终态验证（verify-cua-deploy.mjs）是
  #    Windows 专用（PowerShell 进程检查 + win-unpacked 路径），mac 跳过。
  step "启动后复核（等 25s → 重刷缓存$( [ "$PLATFORM" = win ] && echo ' → 终态验证' )）"
  sleep 25
  run_node "$REPO/sync-plugin-cache.mjs" >/dev/null 2>&1 || echo "  ⚠ 缓存重刷失败（不阻断）"
  if [ "$PLATFORM" = win ]; then
    if node "$REPO/verify-cua-deploy.mjs" --fix; then
      step "✓ 部署链路终态全绿"
    else
      echo "  ⚠ 终态验证有红项（见上）——包本身已部署成功，属缓存/宿主层问题，可重跑"
      echo "  verify-cua-deploy.mjs --fix 或人工介入。不再自动回滚。"
    fi
  else
    step "✓ 部署完成（mac 无 CUA 终态验证；如插件异常可重跑脚本或手动刷缓存）"
  fi
  exit 0
fi

# 6) 启动失败 → 回滚
step "✗ 新包启动失败，自动回滚"
rollback
exit 1
