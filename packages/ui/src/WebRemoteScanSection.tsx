import { CopyIcon, LinkIcon, PlayIcon, RefreshCwIcon, RotateCcwIcon, SmartphoneIcon, UnplugIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { IPlatformService } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useWebRemoteScan } from "./webRemoteScanSection/useWebRemoteScan.js";

/**
 * 「手机扫码连接」区块（relay-official 新增，独立文件；架构原则：官方弹窗只加一个渲染点）。
 *
 * 视觉对齐官方闭源版弹窗左栏：状态卡（等待手机连接 · 已就绪 + 停止）→ 分隔线 →
 * 「无法扫码」行（刷新二维码 / 复制链接）→ 大二维码。服务随弹窗打开自动以
 * LAN/Tailscale scope 开放（hook 负责），这里没有仅本机/局域网的模式选择，
 * 也不展示地址候选列表；失败态保留红字与「重试」。
 */
export function WebRemoteScanSection({ platform }: { platform: IPlatformService }) {
  const { intl } = useZCodeIntl();
  const scan = useWebRemoteScan(platform);
  const running = scan.status?.state === "running";
  const failed = scan.status?.state === "failed";
  const stopped = scan.status?.state === "stopped";

  return (
    <section className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-start gap-2">
        <SmartphoneIcon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
        <div className="min-w-0 space-y-1">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "webRemoteControl.scan.title" })}
          </div>
          <p className="text-ui-base/relaxed text-foreground-subtle">
            {intl.formatMessage({ id: "webRemoteControl.scan.description" })}
          </p>
        </div>
      </div>

      {/* 轨道必须 minmax(0,1fr)：auto 轨道会被「无法扫码+按钮」行的 max-content（约450px）
          撑破 396px 的栏宽，状态卡/二维码区整体溢出卡片与右栏重叠（2026-10-10 实测）。 */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-ui-base font-medium text-foreground">
                {stopped
                  ? intl.formatMessage({ id: "webRemoteControl.scan.statusStopped" })
                  : intl.formatMessage({ id: "webRemoteControl.scan.statusWaiting" })}
              </span>
              {running ? (
                <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-ui-xs leading-none text-foreground-subtle">
                  <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                  {intl.formatMessage({ id: "webRemoteControl.scan.badgeReady" })}
                </span>
              ) : null}
              {failed ? (
                <span
                  className="truncate text-ui-xs text-danger"
                  title={scan.status?.error?.message}
                >
                  {scan.status?.error?.message}
                </span>
              ) : null}
              {!running && scan.busy ? (
                <span className="shrink-0 text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: "webRemoteControl.scan.starting" })}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {running ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={scan.busy}
                  onClick={() => void scan.stop()}
                >
                  <UnplugIcon className="size-3.5" />
                  {intl.formatMessage({ id: "webRemoteControl.scan.stop" })}
                </Button>
              ) : null}
              {stopped && !scan.busy ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void scan.start()}
                >
                  <PlayIcon className="size-3.5" />
                  {intl.formatMessage({ id: "webRemoteControl.scan.start" })}
                </Button>
              ) : null}
              {failed && !scan.busy ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void scan.start()}
                >
                  <RotateCcwIcon className="size-3.5" />
                  {intl.formatMessage({ id: "webRemoteControl.scan.retry" })}
                </Button>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-ui-sm/relaxed text-foreground-subtle">
            {failed
              ? intl.formatMessage(
                  { id: "webRemoteControl.scan.failed" },
                  { message: scan.status?.error?.message ?? "" },
                )
              : running
                ? intl.formatMessage({ id: "webRemoteControl.scan.runningHint" })
                : stopped
                  ? intl.formatMessage({ id: "webRemoteControl.scan.stoppedHint" })
                  : intl.formatMessage({ id: "webRemoteControl.scan.starting" })}
          </p>

          {running ? (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <p className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "webRemoteControl.scan.noQrHint" })}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void scan.refresh()}
                >
                  <RefreshCwIcon className="size-3.5" />
                  {intl.formatMessage({ id: "webRemoteControl.scan.refresh" })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!scan.displayLink}
                  onClick={() => scan.displayLink && void scan.copyLink(scan.displayLink)}
                >
                  <CopyIcon className="size-3.5" />
                  {scan.copied
                    ? intl.formatMessage({ id: "webRemoteControl.scan.copied" })
                    : intl.formatMessage({ id: "webRemoteControl.scan.copy" })}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {running ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border p-4">
            {scan.qrDataUrl ? (
              <img src={scan.qrDataUrl} alt="QR" className="max-h-[280px] rounded bg-white p-2" />
            ) : (
              <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
                <LinkIcon className="size-4" />
                <span className="max-w-[280px] truncate">{scan.displayLink}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
