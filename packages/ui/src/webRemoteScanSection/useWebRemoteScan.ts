import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type {
  IPlatformService,
  WebServiceConnectionInfoPayload,
  WebServiceStatusPayload,
} from "@zcode/shared";

/**
 * 「手机扫码连接」的状态与动作（relay-official 新增，独立文件）。
 *
 * 数据面全部走 IPlatformService 的 webService 可选方法（CE 方案的 IPC 契约）：
 * status + onWebServiceChanged（不轮询）+ start/stop + connectionInfo（唯一含令牌的通道）。
 * 二维码在渲染进程本地生成（qrcode 已是 @zcode/ui 既有依赖），令牌不进任何日志。
 */
export interface WebRemoteScanController {
  status: WebServiceStatusPayload | null;
  info: WebServiceConnectionInfoPayload | null;
  /** 二维码图（data URL）；null = 无链接或生成中。 */
  qrDataUrl: string | null;
  /** 展示用链接：LAN 下优先非回环候选（含 Tailscale 100.x）。 */
  displayLink: string | null;
  busy: boolean;
  copied: boolean;
  /** LAN scope 下存在非回环候选（含 Tailscale 100.x）。 */
  hasLanCandidates: boolean;
  start: (scope: "loopback" | "lan") => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
  copyLink: (link: string) => Promise<void>;
}

export function useWebRemoteScan(platform: IPlatformService): WebRemoteScanController {
  const [status, setStatus] = useState<WebServiceStatusPayload | null>(null);
  const [info, setInfo] = useState<WebServiceConnectionInfoPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running = status?.state === "running";

  const refresh = useCallback(async () => {
    const next = await platform.getWebServiceStatus?.();
    setStatus(next ?? null);
    if (next?.state === "running") {
      // connectionInfo 失败（如主进程侧异常）不该炸掉整个刷新链：状态照常显示，二维码区留空。
      let info: WebServiceConnectionInfoPayload | null = null;
      try {
        info = (await platform.getWebServiceConnectionInfo?.()) ?? null;
      } catch {
        info = null;
      }
      setInfo(info);
      if (info?.linkWithToken) {
        // LAN 下 0.0.0.0/127.0.0.1 不是手机可访问地址：优先非回环候选（Tailscale 100.x）。
        const candidate = info.lanCandidates?.[0];
        const qrLink =
          candidate && /\/\/(0\.0\.0\.0|127\.0\.0\.1):/.test(info.linkWithToken)
            ? info.linkWithToken.replace(/\/{2}(0\.0\.0\.0|127\.0\.0\.1):/, `//${candidate}:`)
            : info.linkWithToken;
        try {
          setQrDataUrl(await QRCode.toDataURL(qrLink, { width: 240, margin: 1 }));
        } catch {
          setQrDataUrl(null);
        }
      } else {
        setQrDataUrl(null);
      }
    } else {
      setInfo(null);
      setQrDataUrl(null);
    }
  }, [platform]);

  useEffect(() => {
    void refresh();
    const dispose = platform.onWebServiceChanged?.((next) => {
      setStatus(next);
      void refresh();
    });
    return () => dispose?.();
  }, [platform, refresh]);

  const start = useCallback(
    async (scope: "loopback" | "lan") => {
      setBusy(true);
      try {
        const next = await platform.startWebService?.({ scope });
        setStatus(next ?? null);
        // 失败态不能跟着 refresh：refresh 会立刻探到 stopped，把红字错误一闪冲掉，
        // 用户看到的就是"点了没反应"（2026-10-09 实测）。失败详情要停在原地等人处理。
        if (next?.state !== "failed") {
          await refresh();
        }
      } finally {
        setBusy(false);
      }
    },
    [platform, refresh],
  );

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      const next = await platform.stopWebService?.();
      setStatus(next ?? null);
      if (next?.state !== "failed") {
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [platform, refresh]);

  const copyLink = useCallback(
    async (link: string) => {
      // 非安全上下文（局域网 http://IP）没有 navigator.clipboard，退回 execCommand。
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    },
    [],
  );

  const displayLink = useMemo(() => {
    if (!running || !info) return null;
    // LAN 下 0.0.0.0 不是可访问地址：优先非回环候选（Tailscale 100.x / 局域网 IP）。
    const candidate = info.lanCandidates?.[0];
    if (candidate && info.url.includes("//0.0.0.0:")) {
      return info.linkWithToken.replace("//0.0.0.0:", `//${candidate}:`);
    }
    return info.linkWithToken;
  }, [running, info]);

  return {
    status,
    info,
    qrDataUrl,
    displayLink,
    busy,
    copied,
    hasLanCandidates: Boolean(info?.lanCandidates?.length),
    start,
    stop,
    refresh,
    copyLink,
  };
}
