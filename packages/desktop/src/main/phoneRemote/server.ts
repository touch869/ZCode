import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { networkInterfaces, hostname } from "node:os";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  type UtilityProcess as ElectronUtilityProcess,
} from "electron";
import { Emitter, SocketProtocol, VSBuffer, type ISocket } from "@zcode/rpc";
import {
  HostMessageTypes,
  SERVER_REMOTE_PROTOCOL_VERSION,
  ZCODE_VERSION,
  type ServerRemoteWorkspaceInfo,
} from "@zcode/shared";
import {
  generatePhoneRemoteToken,
  loadOrInitPhoneRemoteConfig,
  savePhoneRemoteConfig,
  type PhoneRemoteConfig,
} from "./config.js";

/* ============================================================================
 * 手机远控（Phone Remote）—— 桌面内嵌 HTTP+WS 服务器
 *
 * 架构：复用官方 web-remote-replayable 通道语义。手机浏览器加载 packages/web
 * 构建产物（即官方 Web 客户端，天然手机形态：不传 isDesktop、移动端指纹、
 * replayable overlay），其 /ws WebSocket 在此被桥接到窗口 Host 进程：
 *
 *   手机 WS (13 字节分帧 SocketProtocol)
 *      ⇅  本模块做字节级直通（帧 body ⇄ MessagePort Uint8Array）
 *   AttachServicePort { clientMode: "web-remote-replayable", scope: local }
 *      ⇅  Host 内 MessagePortProtocol + ChannelServer（全套本地服务）
 *
 * 手机因此获得与桌面 renderer 同源的 RPC 面：任务列表/快照/实时流
 * （v4 conversation frames）、sendText/stop/resolveInteraction 命令。
 * 每个 WS 连接在 Host 内是独立 attachment + 独立 connectionScope，互不干扰。
 *
 * 安全：token（userData/phone-remote.json）是唯一准入；?token= 首次进入即种
 * HttpOnly cookie（与 packages/server http.ts 同一策略）；外部监听只绑定
 * Tailscale 网段（100.64.0.0/10）地址，默认关闭，需面板或配置显式开启。
 * ==========================================================================*/

interface PhoneRemoteLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface PhoneRemoteServerOptions {
  logger: PhoneRemoteLogger;
  /** 当前可挂载的窗口 Host 进程；无窗口 Host 时返回 null。 */
  resolveTargetHost: () => ElectronUtilityProcess | null;
  /** server-info 暴露给手机端的 workspace 列表（本地 workspace 无 identity，按 path 键）。 */
  getWorkspaces: () => ServerRemoteWorkspaceInfo[];
}

export interface PhoneRemoteStatus {
  enabled: boolean;
  port: number;
  token: string;
  loopbackUrl: string;
  tailscaleAddresses: string[];
  tailscaleUrl: string | null;
  listening: boolean;
  connectionCount: number;
  webDistAvailable: boolean;
}

const TOKEN_COOKIE_NAME = "zcode_lite_token";
const PANEL_WINDOW_SIZE = { width: 560, height: 760 } as const;
const PORT_PROBE_RANGE = 10;

function wrapWebSocket(ws: WebSocket): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  ws.on("message", (raw) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    onData.fire(VSBuffer.wrap(new Uint8Array(buf)));
  });
  ws.on("close", () => {
    onClose.fire();
    onEnd.fire();
  });
  ws.on("error", () => {
    onClose.fire();
    onEnd.fire();
  });

  return {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer) {
      if (ws.readyState === ws.OPEN) {
        ws.send(buffer.buffer);
      }
    },
    end() {
      ws.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      ws.close();
    },
  };
}

/** Tailscale 的 CGNAT 网段 100.64.0.0/10：首字节 100，次字节 64..127。
 * Windows TUN 适配器对地址上报 /32 前缀，不能依赖 prefix 长度判断。 */
export function resolveTailscaleAddresses(): string[] {
  const addresses: string[] = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const ni of interfaces ?? []) {
      if (ni.family !== "IPv4" || ni.internal) {
        continue;
      }
      const octets = ni.address.split(".");
      const first = Number.parseInt(octets[0] ?? "", 10);
      const second = Number.parseInt(octets[1] ?? "", 10);
      if (first === 100 && second >= 64 && second <= 127) {
        addresses.push(ni.address);
      }
    }
  }
  return [...new Set(addresses)];
}

const STATIC_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** 可 gzip 的文本类型：手机端常走 Tailscale DERP 中继（高 RTT 低带宽），
 * 文本资产压缩后体积约 1/3~1/4，是慢链路下最大的单点提速。 */
const GZIP_MIME_TYPES = new Set([
  "text/javascript",
  "text/css",
  "text/html",
  "text/plain",
  "application/json",
  "image/svg+xml",
]);

function isInsideDirectory(root: string, candidate: string): boolean {
  const diff = relative(root, candidate);
  return diff === "" || (!diff.startsWith("..") && !diff.includes(`..${sep}`));
}

async function resolveStaticFile(
  staticRoot: string,
  pathname: string,
): Promise<{ filePath: string; noCache: boolean } | null> {
  const root = resolve(staticRoot);
  const normalizedPathname = pathname === "/" ? "/index.html" : pathname;
  const relativePath = decodeURIComponent(normalizedPathname).replace(/^\/+/, "");
  const candidate = resolve(root, relativePath);
  if (!isInsideDirectory(root, candidate)) {
    return null;
  }
  // index.html（无论直链还是 SPA fallback）都是 no-cache 语义：重建产物后必须
  // 立即反映新哈希资产清单，gzip/HTTP 缓存都不能复用旧副本。
  const isIndexFile = candidate === resolve(root, "index.html");
  try {
    const candidateStat = await stat(candidate);
    if (candidateStat.isFile()) {
      return { filePath: candidate, noCache: isIndexFile };
    }
  } catch {
    // 未命中继续 SPA fallback
  }
  const indexFile = resolve(root, "index.html");
  try {
    const indexStat = await stat(indexFile);
    if (indexStat.isFile()) {
      return { filePath: indexFile, noCache: true };
    }
  } catch {
    return null;
  }
  return null;
}

function resolveWebDistDir(): string | null {
  const override = process.env.ZCODE_PHONE_REMOTE_WEB_DIST?.trim();
  const candidates: string[] = override
    ? [override]
    : [
        // dev: packages/desktop/out/main → packages/web/dist
        join(import.meta.dirname, "../../../web/dist"),
        // packaged: resources/web-dist（打包集成后续补）
        app.isPackaged ? join(process.resourcesPath, "web-dist") : join(app.getAppPath(), "web-dist"),
      ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function readJsonBody(req: IncomingMessage, byteLimit = 8 * 1024): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > byteLimit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on("error", reject);
  });
}

export function createPhoneRemoteServer(options: PhoneRemoteServerOptions) {
  const { logger } = options;
  let config: PhoneRemoteConfig = { enabled: false, port: 41889, token: "" };
  let loopbackServer: Server | null = null;
  let externalServer: Server | null = null;
  let actualPort = config.port;
  let webDistDir: string | null = null;
  let panelWindow: BrowserWindow | null = null;
  const activeConnections = new Set<{ connectedAt: number }>();
  // permessage-deflate：WS 上的 RPC 载荷（任务列表/快照等 JSON 密集帧）在慢速
  // 中继链路上是主要瓶颈，逐帧压缩通常可缩 5-10 倍，浏览器端原生协商无需改动。
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: { threshold: 1024 },
  });
  // dist 内哈希资产不可变：gzip 结果按路径缓存，避免每个手机连接重复压缩。
  const gzipCache = new Map<string, Buffer>();

  // ── 鉴权（与 packages/server http.ts 同策略）────────────────────────────
  function tokenFromRequest(url: URL, req: IncomingMessage): string | null {
    const queryToken = url.searchParams.get("token");
    if (queryToken) {
      return queryToken;
    }
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      return null;
    }
    for (const part of cookieHeader.split(";")) {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      if (part.slice(0, separator).trim() === TOKEN_COOKIE_NAME) {
        return decodeURIComponent(part.slice(separator + 1).trim());
      }
    }
    return null;
  }

  function authorize(url: URL, req: IncomingMessage, res: ServerResponse): boolean {
    const presented = tokenFromRequest(url, req);
    if (presented && presented === config.token) {
      res.setHeader(
        "Set-Cookie",
        `${TOKEN_COOKIE_NAME}=${encodeURIComponent(config.token)}; Path=/; HttpOnly; SameSite=Lax`,
      );
      return true;
    }
    return false;
  }

  function isTokenProtectedPath(pathname: string): boolean {
    return pathname === "/ws" || pathname.startsWith("/ws/") || pathname.startsWith("/api/");
  }

  // ── Host 桥接 ────────────────────────────────────────────────────────────
  function bridgeWebSocketToHost(ws: WebSocket): void {
    const target = options.resolveTargetHost();
    if (!target) {
      ws.close(4001, "no-active-window-host");
      return;
    }
    const { port1, port2 } = new MessageChannelMain();
    try {
      target.postMessage(
        {
          type: HostMessageTypes.AttachServicePort,
          requestId: randomUUID(),
          attachmentId: randomUUID(),
          // 手机远控 = replayable 客户端：与桌面 renderer(continuous) 不同，
          // Host 内该 attachment 走 web-remote-replayable 门禁（provisioning 等被禁）。
          clientMode: "web-remote-replayable",
          scope: { kind: "local" },
        },
        [port2],
      );
    } catch (error) {
      logger.warn("[phone-remote] attach-service-port post failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      port1.close();
      port2.close();
      ws.close(4002, "host-attach-failed");
      return;
    }

    port1.start();
    const entry = {
      connectedAt: Date.now(),
      isAlive: true,
      // 诊断计数：区分"链路慢"与"流量停滞"（卡loading时看 up/down 是否还在涨）。
      downBytes: 0,
      downFrames: 0,
      upBytes: 0,
      upFrames: 0,
    };
    activeConnections.add(entry);
    const statsTimer = setInterval(() => {
      if (closed) {
        return;
      }
      logger.info("[phone-remote] ws stats", {
        seconds: Math.round((Date.now() - entry.connectedAt) / 1000),
        downMB: +(entry.downBytes / 1048576).toFixed(2),
        downFrames: entry.downFrames,
        upMB: +(entry.upBytes / 1048576).toFixed(2),
        upFrames: entry.upFrames,
      });
    }, 30_000);
    // 心跳：DERP 中继/NAT 会在静默期回收映射，iOS 后台挂起也只会留下半开连接。
    // 25s ping + 两轮无 pong 即 terminate，让手机端尽快收到 close 并触发重连。
    const pingTimer = setInterval(() => {
      if (closed) {
        return;
      }
      if (!entry.isAlive) {
        ws.terminate();
        return;
      }
      entry.isAlive = false;
      try {
        ws.ping();
      } catch {
        // ping 失败说明连接已坏，等下一轮 terminate
      }
    }, 25_000);
    ws.on("pong", () => {
      entry.isAlive = true;
    });
    const socket = wrapWebSocket(ws);
    const protocol = new SocketProtocol(socket);
    let closed = false;
    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(pingTimer);
      clearInterval(statsTimer);
      activeConnections.delete(entry);
      protocol.dispose();
      try {
        ws.close(4000, "bridge-closed");
      } catch {
        // ws 已关闭时 close 幂等
      }
      port1.close();
    };

    protocol.onMessage((body) => {
      if (closed) {
        return;
      }
      entry.upBytes += body.byteLength;
      entry.upFrames += 1;
      try {
        // SocketProtocol 帧体 ⇄ MessagePort Uint8Array：两侧语义一致（RPC body），
        // 桥只做载荷直通，不解析 Channel 语义。
        port1.postMessage(body.buffer);
      } catch {
        cleanup();
      }
    });
    port1.on("message", (event: { data: unknown }) => {
      if (closed) {
        return;
      }
      const data = event.data;
      if (!(data instanceof Uint8Array)) {
        // MessagePort 旁带对象（流控/未知控制帧）不跨 WS：TCP 背压天然限速，
        // 缺失 SAT/DRN 只影响 CLI pause 优化，不影响正确性。
        return;
      }
      entry.downBytes += data.byteLength;
      entry.downFrames += 1;
      try {
        protocol.send(VSBuffer.wrap(data));
      } catch {
        cleanup();
      }
    });
    port1.once("close", () => {
      if (closed) {
        return;
      }
      closed = true;
      activeConnections.delete(entry);
      protocol.dispose();
      try {
        ws.close(4003, "host-port-closed");
      } catch {
        // 同上
      }
    });
    socket.onClose(() => {
      if (closed) {
        return;
      }
      closed = true;
      activeConnections.delete(entry);
      protocol.dispose();
      port1.close();
    });
    logger.info("[phone-remote] ws bridged to window host", {
      connectionCount: activeConnections.size,
    });
  }

  // ── HTTP 路由 ────────────────────────────────────────────────────────────
  function getStatus(): PhoneRemoteStatus {
    const tailscaleAddresses = resolveTailscaleAddresses();
    const tailscaleAddress = tailscaleAddresses[0];
    const tailscaleUrl = tailscaleAddress
      ? `http://${tailscaleAddress}:${actualPort}/?token=${encodeURIComponent(config.token)}`
      : null;
    return {
      enabled: config.enabled,
      port: actualPort,
      token: config.token,
      loopbackUrl: `http://127.0.0.1:${actualPort}/?token=${encodeURIComponent(config.token)}`,
      tailscaleAddresses,
      tailscaleUrl,
      listening: loopbackServer !== null,
      connectionCount: activeConnections.size,
      webDistAvailable: webDistDir !== null,
    };
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(body);
  }

  async function renderPanelHtml(): Promise<string> {
    const status = getStatus();
    const qrTarget = status.tailscaleUrl ?? status.loopbackUrl;
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(qrTarget, {
        margin: 1,
        width: 232,
        color: { dark: "#101014ff", light: "#ffffffff" },
      });
    } catch {
      qrDataUrl = "";
    }
    const localeHint = /^zh\b/i.test(app.getLocale()) ? "zh" : "en";
    return PANEL_HTML_TEMPLATE.replace("__QR_DATA_URL__", qrDataUrl).replace(
      "__LOCALE__",
      localeHint,
    );
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const authorized = authorize(url, req, res);
    if (isTokenProtectedPath(url.pathname) && !authorized) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/server-info") {
      sendJson(res, 200, {
        serverId: hostname(),
        name: "ZCode Desktop · Phone Remote",
        version: ZCODE_VERSION,
        protocolVersion: SERVER_REMOTE_PROTOCOL_VERSION,
        authRequired: true,
        workspaces: options.getWorkspaces(),
        capabilities: {
          desktopContinuous: false,
          websocketRpc: true,
          processResourceTelemetry: true,
        },
      });
      return;
    }

    if (url.pathname === "/api/phone-remote/status" && req.method === "GET") {
      sendJson(res, 200, getStatus());
      return;
    }

    if (url.pathname === "/api/phone-remote/config" && req.method === "POST") {
      const body = (await readJsonBody(req)) as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") {
        sendJson(res, 400, { error: "enabled must be boolean" });
        return;
      }
      const next = await applyEnabled(body.enabled);
      sendJson(res, 200, next);
      return;
    }

    if (url.pathname === "/api/phone-remote/token" && req.method === "POST") {
      config = { ...config, token: generatePhoneRemoteToken() };
      await savePhoneRemoteConfig(config);
      logger.info("[phone-remote] token regenerated");
      sendJson(res, 200, getStatus());
      return;
    }

    if (req.method === "GET" && url.pathname === "/panel") {
      const html = await renderPanelHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && webDistDir) {
      const staticEntry = await resolveStaticFile(webDistDir, url.pathname);
      if (staticEntry) {
        const file = await readFile(staticEntry.filePath);
        const contentType =
          STATIC_MIME_TYPES[extname(staticEntry.filePath).toLowerCase()] ??
          "application/octet-stream";
        const headers: Record<string, string> = {
          "Cache-Control": staticEntry.noCache
            ? "no-cache"
            : "public, max-age=31536000, immutable",
          "Content-Type": contentType,
        };
        // 只有带哈希的不可变资产可缓存压缩结果；index.html 每次都重新压缩。
        const acceptsGzip = (req.headers["accept-encoding"] ?? "").includes("gzip");
        const compressible =
          acceptsGzip && GZIP_MIME_TYPES.has(contentType.split(";")[0]!.trim());
        let body: Buffer = file;
        if (compressible) {
          const cached = staticEntry.noCache ? undefined : gzipCache.get(staticEntry.filePath);
          if (cached) {
            body = cached;
          } else {
            const started = Date.now();
            body = gzipSync(file, { level: 6 });
            if (!staticEntry.noCache) {
              gzipCache.set(staticEntry.filePath, body);
            }
            logger.info("[phone-remote] gzip prepared", {
              file: basename(staticEntry.filePath),
              raw: file.byteLength,
              gzipped: body.byteLength,
              ms: Date.now() - started,
            });
          }
          headers["Content-Encoding"] = "gzip";
          headers["Vary"] = "Accept-Encoding";
        }
        res.writeHead(200, headers);
        res.end(body);
        logger.info("[phone-remote] static served", {
          path: url.pathname,
          bytes: body.byteLength,
          encoding: compressible ? "gzip" : "identity",
        });
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
    handleRequest(req, res).catch((error) => {
      logger.warn("[phone-remote] request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500);
      }
      try {
        res.end();
      } catch {
        // 连接已断开时忽略
      }
    });
  };

  const upgradeHandler = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): void => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const presented = tokenFromRequest(url, req);
    if (!presented || presented !== config.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    // 手机端 WS 请求必须同源（浏览器携带 Origin）；非浏览器客户端无 Origin 也放行，
    // token 已是充分鉴权。
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== req.headers.host) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      bridgeWebSocketToHost(ws);
    });
  };

  function listenWithPortProbe(
    server: Server,
    host: string,
    preferredPort: number,
  ): Promise<number> {
    return new Promise((resolveListen, rejectListen) => {
      let attempted = 0;
      const tryListen = (port: number): void => {
        attempted += 1;
        const onError = (error: NodeJS.ErrnoException): void => {
          server.removeListener("error", onError);
          if (error.code === "EADDRINUSE" && attempted < PORT_PROBE_RANGE) {
            tryListen(port + 1);
            return;
          }
          rejectListen(error);
        };
        server.once("error", onError);
        server.listen(port, host, () => {
          server.removeListener("error", onError);
          resolveListen(port);
        });
      };
      tryListen(preferredPort);
    });
  }

  function closeServer(server: Server | null): Promise<void> {
    return new Promise((resolveClose) => {
      if (!server) {
        resolveClose();
        return;
      }
      server.close(() => resolveClose());
      // 关闭悬挂 keep-alive 连接，让 close 回调可達
      server.closeAllConnections?.();
      resolveClose();
    });
  }

  async function startExternalServer(): Promise<void> {
    await closeServer(externalServer);
    externalServer = null;
    if (!config.enabled) {
      return;
    }
    const addresses = resolveTailscaleAddresses();
    if (addresses.length === 0) {
      logger.warn("[phone-remote] enabled but no tailscale address found; external disabled");
      return;
    }
    const server = createServer(requestHandler);
    server.on("upgrade", upgradeHandler);
    // loopback 侧可能因端口占用顺延过；外部监听跟随实际端口，保证二维码 URL 一致。
    for (const address of addresses) {
      await listenWithPortProbe(server, address, actualPort);
    }
    externalServer = server;
    logger.info("[phone-remote] external listening", {
      addresses,
      port: config.port,
    });
  }

  async function applyEnabled(enabled: boolean): Promise<PhoneRemoteStatus> {
    if (config.enabled === enabled) {
      return getStatus();
    }
    config = { ...config, enabled };
    await savePhoneRemoteConfig(config);
    await startExternalServer();
    logger.info("[phone-remote] enabled changed", { enabled });
    return getStatus();
  }

  return {
    async start(): Promise<void> {
      config = await loadOrInitPhoneRemoteConfig();
      webDistDir = resolveWebDistDir();
      if (!webDistDir) {
        logger.warn(
          "[phone-remote] web dist not found (run packages/web build); serving disabled",
        );
      }
      const server = createServer(requestHandler);
      server.on("upgrade", upgradeHandler);
      actualPort = await listenWithPortProbe(server, "127.0.0.1", config.port);
      loopbackServer = server;
      logger.info("[phone-remote] loopback listening", { port: actualPort });
      await startExternalServer();
    },
    async stop(): Promise<void> {
      await closeServer(externalServer);
      externalServer = null;
      await closeServer(loopbackServer);
      loopbackServer = null;
      for (const client of wss.clients) {
        client.close(4000, "server-stopping");
      }
    },
    getStatus,
    async setEnabled(enabled: boolean): Promise<PhoneRemoteStatus> {
      return applyEnabled(enabled);
    },
    async resetToken(): Promise<PhoneRemoteStatus> {
      config = { ...config, token: generatePhoneRemoteToken() };
      await savePhoneRemoteConfig(config);
      return getStatus();
    },
    openPanelWindow(): void {
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.focus();
        // token 可能已轮换，重载面板保证二维码最新
        void panelWindow.loadURL(
          `http://127.0.0.1:${actualPort}/panel?token=${encodeURIComponent(config.token)}`,
        );
        return;
      }
      panelWindow = new BrowserWindow({
        width: PANEL_WINDOW_SIZE.width,
        height: PANEL_WINDOW_SIZE.height,
        useContentSize: true,
        title: "手机远控 · Phone Remote",
        backgroundColor: "#0b0b0d",
        autoHideMenuBar: true,
        minimizable: true,
        maximizable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      panelWindow.once("ready-to-show", () => panelWindow?.show());
      panelWindow.on("closed", () => {
        panelWindow = null;
      });
      void panelWindow.loadURL(
        `http://127.0.0.1:${actualPort}/panel?token=${encodeURIComponent(config.token)}`,
      );
    },
  };
}

/* ── 面板页 ─────────────────────────────────────────────────────────────────
 * 面板由内嵌服务器自身托管（同源），开关/重置走 /api（cookie 鉴权），
 * 不依赖任何 Electron IPC。深色基调对齐桌面端。*/
const PANEL_HTML_TEMPLATE = `<!doctype html>
<html lang="__LOCALE__">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>手机远控 · Phone Remote</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 13px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0b0b0d; color: #e7e7ea; padding: 22px 26px; }
  h1 { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  h1 .dot { width: 9px; height: 9px; border-radius: 50%; background: #6b6b74; }
  h1 .dot.on { background: #34c77b; }
  h1 .dot.off { background: #e5484d; }
  .card { background: #131317; border: 1px solid #26262c; border-radius: 12px;
          padding: 16px 18px; margin-top: 14px; }
  .qr-wrap { display: flex; justify-content: center; padding: 10px;
             background: #fff; border-radius: 10px; width: fit-content; margin: 4px auto 10px; }
  .qr-wrap img { width: 232px; height: 232px; display: block; }
  .url { font-size: 12px; color: #9b9ba4; word-break: break-all; text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
  .row .k { color: #9b9ba4; white-space: nowrap; }
  .row .v { text-align: right; word-break: break-all; }
  .v.ok { color: #34c77b; } .v.bad { color: #e5484d; }
  button { font: inherit; border-radius: 8px; border: 1px solid #2e2e36; cursor: pointer;
           background: #1c1c22; color: #e7e7ea; padding: 7px 14px; }
  button:hover { background: #26262e; }
  button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
  button.primary:hover { background: #5b52f0; }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 10px; margin-top: 14px; }
  .hint { color: #7d7d87; font-size: 12px; margin-top: 10px; }
  code { background: #1c1c22; border-radius: 5px; padding: 1px 6px; font-size: 12px; }
</style>
</head>
<body>
<h1><span class="dot" id="dot"></span><span id="title">手机远控</span></h1>
<div class="card" id="qrCard">
  <div class="qr-wrap"><img id="qr" alt="QR" src="__QR_DATA_URL__" /></div>
  <div class="url" id="url">…</div>
</div>
<div class="card" id="statusCard">
  <div class="row"><span class="k">外部访问（Tailscale）</span><span class="v" id="extState">…</span></div>
  <div class="row"><span class="k">监听端口</span><span class="v" id="port">…</span></div>
  <div class="row"><span class="k">在线连接</span><span class="v" id="conns">…</span></div>
  <div class="row"><span class="k">手机端页面</span><span class="v" id="dist">…</span></div>
  <div class="row"><span class="k">Tailscale 地址</span><span class="v" id="tsAddrs">…</span></div>
</div>
<div class="actions">
  <button class="primary" id="toggleBtn">…</button>
  <button id="resetBtn">重置令牌</button>
</div>
<p class="hint">手机扫码或输入 URL 打开远控页（Token 已附在链接里）。首次打开如见引导页，跟随完成一次即可。外部监听仅绑定 Tailscale 网段地址；无 Tailscale 时仅本机可访问。</p>
<script>
(function () {
  var dot = document.getElementById("dot");
  var title = document.getElementById("title");
  var qrImg = document.getElementById("qr");
  var urlEl = document.getElementById("url");
  var extState = document.getElementById("extState");
  var portEl = document.getElementById("port");
  var connsEl = document.getElementById("conns");
  var distEl = document.getElementById("dist");
  var tsAddrsEl = document.getElementById("tsAddrs");
  var toggleBtn = document.getElementById("toggleBtn");
  var resetBtn = document.getElementById("resetBtn");

  function render(s) {
    dot.className = "dot " + (s.enabled && s.tailscaleUrl ? "on" : "off");
    title.textContent = "手机远控" + (s.enabled ? " · 已开启" : " · 已关闭");
    urlEl.textContent = s.tailscaleUrl || s.loopbackUrl;
    extState.textContent = !s.enabled ? "已关闭" : (s.tailscaleUrl ? "已监听" : "未检测到 Tailscale 地址");
    extState.className = "v " + (s.enabled && s.tailscaleUrl ? "ok" : "bad");
    portEl.textContent = String(s.port);
    connsEl.textContent = String(s.connectionCount);
    distEl.textContent = s.webDistAvailable ? "已就绪" : "缺失（需构建 packages/web）";
    distEl.className = "v " + (s.webDistAvailable ? "ok" : "bad");
    tsAddrsEl.textContent = s.tailscaleAddresses.length ? s.tailscaleAddresses.join(", ") : "—";
    toggleBtn.textContent = s.enabled ? "关闭外部访问" : "开启外部访问";
  }

  function refresh() {
    fetch("/api/phone-remote/status", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { title.textContent = "手机远控 · 状态获取失败"; });
  }
  setInterval(refresh, 4000);

  toggleBtn.addEventListener("click", function () {
    toggleBtn.disabled = true;
    fetch("/api/phone-remote/status", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        return fetch("/api/phone-remote/config", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !s.enabled }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(refresh)
      .finally(function () { toggleBtn.disabled = false; });
  });

  resetBtn.addEventListener("click", function () {
    if (!window.confirm("重置令牌后，所有手机需重新扫码。继续？")) { return; }
    resetBtn.disabled = true;
    fetch("/api/phone-remote/token", { method: "POST", credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        // 旧 cookie 已失效，携带新 token 重新进入面板刷新二维码
        window.location.replace("/panel?token=" + encodeURIComponent(s.token));
      })
      .catch(function () { resetBtn.disabled = false; });
  });

  qrImg.addEventListener("click", function () {
    var text = urlEl.textContent || "";
    if (navigator.clipboard) { navigator.clipboard.writeText(text); }
  });

  refresh();
})();
</script>
</body>
</html>`;
