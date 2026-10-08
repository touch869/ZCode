import { useMemo, useState } from "react";
import { CopyIcon, LinkIcon, RefreshCwIcon, SmartphoneIcon, SquareIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { IPlatformService } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useWebRemoteScan } from "./webRemoteScanSection/useWebRemoteScan.js";

/**
 * 「手机扫码连接」区块（relay-official 新增，独立文件；架构原则：官方弹窗只加一个渲染点）。
 *
 * 对齐官方闭源版弹窗左栏：服务状态 + 启停 + 二维码 + 刷新/复制链接。
 * 数据面走 IPlatformService 的 webService 契约（CE 方案），UI 不持有任何业务状态。
 */
export function WebRemoteScanSection({ platform }: { platform: IPlatformService }) {
  const { intl } = useZCodeIntl();
  const [confirmingLan, setConfirmingLan] = useState(false);
  const scan = useWebRemoteScan(platform);
  const scanHint = scan.hasLanCandidates
    ? intl.formatMessage({ id: "webRemoteControl.scan.lanHint" })
    : intl.formatMessage({ id: "webRemoteControl.scan.hint" });
  const running = scan.status?.state === "running";
  const failed = scan.status?.state === "failed";

  const lanCandidates = useMemo(() => {
    if (!scan.info?.lanCandidates?.length || !scan.info) return [] as string[];
    return scan.info.lanCandidates.map((ip) =>
      scan.info!.linkWithToken.replace("//0.0.0.0:", `//${ip}:`).replace("//127.0.0.1:", `//${ip}:`),
    );
  }, [scan.info]);

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

      <div className="grid min-h-0 flex-1 gap-3">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-ui-base font-medium text-foreground">
                {running
                  ? intl.formatMessage({ id: "webRemoteControl.scan.statusReady" })
                  : intl.formatMessage({ id: "webRemoteControl.scan.statusWaiting" })}
              </span>
              {running ? (
                <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-ui-xs leading-none text-foreground-subtle">
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
            {running ? (
              <div className="flex shrink-0 items-center gap-2">
                {scan.status?.loopback ? (
                  <ControlHintTooltip
                    title={intl.formatMessage({ id: "webRemoteControl.scan.lanTooltip" })}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={scan.busy}
                      onClick={async () => {
                        if (confirmingLan) {
                          setConfirmingLan(false);
                          await scan.stop();
                          await scan.start("lan");
                          return;
                        }
                        setConfirmingLan(true);
                        window.setTimeout(() => setConfirmingLan(false), 5000);
                      }}
                    >
                      {confirmingLan
                        ? intl.formatMessage({ id: "webRemoteControl.scan.lanConfirmShort" })
                        : intl.formatMessage({ id: "webRemoteControl.scan.switchLan" })}
                    </Button>
                  </ControlHintTooltip>
                ) : null}
                <ControlHintTooltip title={intl.formatMessage({ id: "webRemoteControl.scan.stop" })}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={scan.busy}
                    onClick={() => void scan.stop()}
                  >
                    <SquareIcon className="size-3.5" />
                    {intl.formatMessage({ id: "webRemoteControl.scan.stop" })}
                  </Button>
                </ControlHintTooltip>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <ControlHintTooltip
                  title={intl.formatMessage({ id: "webRemoteControl.scan.lanTooltip" })}
                >
                  <Button
                    type="button"
                    variant={confirmingLan ? "default" : "outline"}
                    size="sm"
                    disabled={scan.busy}
                    onClick={() => {
                      if (confirmingLan) {
                        setConfirmingLan(false);
                        void scan.start("lan");
                        return;
                      }
                      setConfirmingLan(true);
                      window.setTimeout(() => setConfirmingLan(false), 5000);
                    }}
                  >
                    {confirmingLan
                      ? intl.formatMessage({ id: "webRemoteControl.scan.lanConfirmShort" })
                      : intl.formatMessage({ id: "webRemoteControl.scan.startLan" })}
                  </Button>
                </ControlHintTooltip>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={scan.busy}
                  onClick={() => void scan.start("loopback")}
                >
                  {intl.formatMessage({ id: "webRemoteControl.scan.startLocal" })}
                </Button>
              </div>
            )}
          </div>
          <p className="mt-2 text-ui-sm/relaxed text-foreground-subtle">
            {running
              ? intl.formatMessage({ id: "webRemoteControl.scan.runningHint" })
              : scanHint}
          </p>
          {failed ? (
            <p className="mt-2 text-ui-sm/relaxed text-danger">
              {intl.formatMessage(
                { id: "webRemoteControl.scan.failed" },
                { message: scan.status?.error?.message ?? "" },
              )}
            </p>
          ) : null}
        </div>

        {running ? (
          <>
            <div className="flex items-center justify-between gap-2">
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

            {lanCandidates.length > 0 ? (
              <div className="space-y-1">
                {lanCandidates.map((link) => (
                  <button
                    key={link}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                    onClick={() => void scan.copyLink(link)}
                  >
                    <CopyIcon className="size-3.5 shrink-0 text-foreground-subtle" />
                    <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-foreground-subtle">
                      {link}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
