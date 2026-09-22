/**
 * 手机远控壳（Phone Shell）—— 完全独立于官方组件树的增量层。
 *
 * 架构（对齐官方 /remote/v4 两页形态；官方手机壳为闭源注入件，此处自建）：
 * - 列表页：本模块的全屏 overlay 卡片首页。工作区列表订阅官方
 *   WindowController 的 controller/workspaces 投影（全设备口径，与官方一致），
 *   任务列表复用官方 useGlobalTaskList；卡片视觉对齐官方（图标块+名称/徽标+
 *   路径/任务数+更新时间三行卡，默认折叠，点卡片展开/折叠，右侧 + 新建任务）。
 *   样式全部用应用自带 tailwind 主题类，浅色/深色主题自动跟随。
 * - 聊天页：官方应用原树（SessionPane 等）原样复用、零重写，官方升级自动继承。
 *   这里只做两件事：CSS 收起侧栏（html.zcode-chat）+ 顶部返回条。
 *
 * rebase 约束：本目录不 import 官方组件内部实现；仅消费 @zcode/ui 主入口
 * 增量导出的既有模块与 @zcode/shared 协议常量。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Cloud, Folder, Plus } from "lucide-react";
import {
  useGlobalTaskList,
  useServices,
  useZCodeSessionStore,
  type WindowHostControllerTaskListItem,
} from "@zcode/ui";

// 与 @zcode/shared 的 CONTROLLER_WORKSPACES_TOPIC 一致（shared 主入口未导出，
// 为不扩官方导出面而在此内联协议字面量）。
const CONTROLLER_WORKSPACES_TOPIC = "controller/workspaces";

const ZH = /^zh\b/i.test(navigator.language);
const PHONE_QUERY = "(max-width: 767px)";

function usePhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const listener = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return isPhone;
}

// 供 vite 构建期替换进官方 SessionPane/ConversationComposer 的既有
// isMobileViewport 分支（见 packages/web/vite.config.ts 插件；desktop 构建不含本文件）。
(globalThis as Record<string, unknown>).__zcodePhoneViewport = () =>
  window.matchMedia(PHONE_QUERY).matches;

interface WorkspaceFactLite {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sourceAvailability: "online" | "offline";
}

const workspaceKeyOf = (fact: {
  workspacePath: string;
  workspaceIdentity?: string;
}) => fact.workspaceIdentity?.trim() || fact.workspacePath;

/**
 * 订阅 WindowController 的 controller/workspaces 投影（与桌面侧栏/官方手机端同源），
 * 维护全设备工作区事实列表。快照整体替换；delta 增量应用；seq 断档即重订阅。
 */
function useControllerWorkspaces(): WorkspaceFactLite[] {
  const services = useServices();
  const controller = services?.windowControllerService ?? null;
  const [workspaces, setWorkspaces] = useState<WorkspaceFactLite[]>([]);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!controller) {
      return;
    }
    const generation = ++generationRef.current;
    let subscriptionIds: string[] = [];
    let lastSeqByTopic = new Map<string, number>();
    let disposed = false;

    const applyFrame = (frame: {
      topic: string;
      logEpoch: string;
      fromSeq: number;
      toSeq: number;
      payload: { kind: string };
    }) => {
      if (frame.topic !== CONTROLLER_WORKSPACES_TOPIC) {
        return;
      }
      const expected = lastSeqByTopic.get(frame.topic);
      if (expected !== undefined && frame.fromSeq > expected + 1) {
        // seq 断档：放弃本地投影，重订阅拿新快照
        throw new Error("controller/workspaces seq gap");
      }
      lastSeqByTopic.set(frame.topic, frame.toSeq);
      const payload = frame.payload as
        | {
            kind: "snapshot";
            snapshot: { workspaces: WorkspaceFactLite[] };
          }
        | {
            kind: "deltas";
            deltas: Array<
              | { op: "workspace.upserted"; workspace: WorkspaceFactLite }
              | { op: "workspace.removed"; workspacePath: string; workspaceIdentity?: string }
            >;
          };
      setWorkspaces((current) => {
        if (payload.kind === "snapshot") {
          return payload.snapshot.workspaces.map((fact) => ({ ...fact }));
        }
        const next = new Map(current.map((fact) => [workspaceKeyOf(fact), fact]));
        for (const delta of payload.deltas) {
          if (delta.op === "workspace.upserted") {
            next.set(workspaceKeyOf(delta.workspace), { ...delta.workspace });
          } else {
            next.delete(workspaceKeyOf(delta));
          }
        }
        return Array.from(next.values());
      });
    };

    const start = async () => {
      const disposable = controller.onDynamicControllerFrame()((frame) => {
        try {
          applyFrame(frame as Parameters<typeof applyFrame>[0]);
        } catch {
          // seq 断档：重新订阅
          if (generation === generationRef.current && !disposed) {
            for (const id of subscriptionIds) {
              void controller.unsubscribeControllerV4({ subscriptionId: id }).catch(() => {});
            }
            subscriptionIds = [];
            lastSeqByTopic = new Map();
            void start();
          }
        }
      });
      if (disposed) {
        disposable.dispose();
        return;
      }
      try {
        const result = await controller.subscribeControllerV4({
          topic: CONTROLLER_WORKSPACES_TOPIC,
          visibility: "foreground",
        });
        if (disposed || generation !== generationRef.current) {
          void controller.unsubscribeControllerV4({ subscriptionId: result.ack.subscriptionId });
          return;
        }
        subscriptionIds.push(result.ack.subscriptionId);
      } catch {
        // 订阅失败保持空列表；controller 恢复后由本 effect 的依赖变化重试
      }
    };

    void start();
    return () => {
      disposed = true;
      for (const id of subscriptionIds) {
        void controller.unsubscribeControllerV4({ subscriptionId: id }).catch(() => {});
      }
    };
  }, [controller]);

  return workspaces;
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (!Number.isFinite(timestamp ?? NaN)) {
    return "";
  }
  const delta = Date.now() - (timestamp as number);
  if (delta < 60_000) {
    return ZH ? "刚刚" : "just now";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}${ZH ? "分" : "m"}`;
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)}${ZH ? "小时" : "h"}`;
  }
  return `${Math.floor(delta / 86_400_000)}${ZH ? "天" : "d"}`;
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const last = normalized.split(/[\\/]/).pop();
  return last || path;
}

type TaskListItem = ReturnType<typeof useGlobalTaskList>["items"][number];

function statusMeta(status?: string): { label: string; cls: string } {
  if (status === "running") {
    return { label: ZH ? "运行中" : "running", cls: "text-success" };
  }
  if (status === "error") {
    return { label: ZH ? "出错" : "error", cls: "text-destructive" };
  }
  return { label: ZH ? "已完成" : "done", cls: "text-foreground-subtle" };
}

function PhoneTaskHome(props: {
  onOpenTask: (task: TaskListItem) => void;
  onOpenDraft: (fact: WorkspaceFactLite) => void;
}) {
  const workspaces = useControllerWorkspaces();
  const workspaceTabs = useMemo(
    () =>
      workspaces.map((fact) => ({
        kind: "workspace" as const,
        id: workspaceKeyOf(fact),
        workspacePath: fact.workspacePath,
        ...(fact.workspaceIdentity ? { workspaceIdentity: fact.workspaceIdentity } : {}),
      })) as unknown as Parameters<typeof useGlobalTaskList>[0]["workspaceTabs"],
    [workspaces],
  );
  const { items, loading } = useGlobalTaskList({
    kind: "timeline",
    workspaceTabs,
    sortBy: "updated",
    searchQuery: "",
    expanded: true,
    collapsedLimit: 500,
  });
  // 官方形态：卡片默认折叠，点卡片本身展开/折叠（无独立箭头按钮）。
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const tasksByKey = useMemo(() => {
    const map = new Map<string, WindowHostControllerTaskListItem[]>();
    for (const item of items) {
      const key = item.workspaceIdentity?.trim() || item.workspacePath;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    for (const [key, tasks] of map) {
      tasks.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
    }
    return map;
  }, [items]);
  const orderedKeys = useMemo(() => {
    const latestOf = (key: string) =>
      Math.max(0, ...(tasksByKey.get(key) ?? []).map((task) => task.updatedAt ?? 0));
    return workspaces.map(workspaceKeyOf).sort((left, right) => latestOf(right) - latestOf(left));
  }, [workspaces, tasksByKey]);

  return (
    <div
      className="fixed inset-0 overflow-y-auto bg-background px-4 text-foreground"
      style={{ zIndex: 2000000000, paddingTop: 18, paddingBottom: 24 }}
    >
      <h1 className="text-xl font-semibold">{ZH ? "ZCode 远程控制" : "ZCode Remote Control"}</h1>
      <p className="mt-1 text-[13px] text-foreground-subtle">
        {ZH ? "已连接到当前桌面窗口" : "Connected to the current desktop window"}
      </p>
      <div className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-foreground-subtle">
        {ZH
          ? "本次连接可以查看当前设备上已打开的项目、任务和会话；二维码失效后需要回到桌面端重新连接。"
          : "This connection shows the projects, tasks and sessions currently open on this device; the QR code expires and requires re-pairing from the desktop app."}
      </div>
      <h2 className="mt-6 text-[15px] font-semibold">
        {ZH ? "当前设备上的工作区和任务" : "Workspaces & tasks"}
      </h2>
      <p className="mt-0.5 text-[13px] text-foreground-subtle">
        {ZH
          ? `${workspaces.length} 个工作区 · ${items.length} 个任务`
          : `${workspaces.length} workspaces · ${items.length} tasks`}
      </p>
      {orderedKeys.map((key) => {
        const fact = workspaces.find((candidate) => workspaceKeyOf(candidate) === key);
        if (!fact) {
          return null;
        }
        const tasks = tasksByKey.get(key) ?? [];
        const expanded = expandedKeys.has(key);
        const latest = Math.max(0, ...tasks.map((task) => task.updatedAt ?? 0));
        const running = tasks.filter((task) => task.status === "running").length;
        const hasUnread = tasks.some((task) => task.unreadAt);
        const isRemote = Boolean(fact.remoteSessionId);
        return (
          <section
            key={key}
            className="mt-3 overflow-hidden rounded-xl border border-border bg-card"
          >
            <div
              role="button"
              tabIndex={0}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-4"
              onClick={() =>
                setExpandedKeys((current) => {
                  const next = new Set(current);
                  if (next.has(key)) {
                    next.delete(key);
                  } else {
                    next.add(key);
                  }
                  return next;
                })
              }
            >
              <span className="flex size-10 flex-none items-center justify-center rounded-lg bg-surface-hover text-foreground-subtle">
                {isRemote ? <Cloud className="size-5" /> : <Folder className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-semibold leading-6">
                    {basename(key)}
                  </span>
                  <span className="flex-none rounded-full border border-border px-2 py-px text-xs text-foreground-subtle">
                    {fact.sourceAvailability === "offline"
                      ? ZH
                        ? "离线"
                        : "offline"
                      : isRemote
                        ? ZH
                          ? "远程"
                          : "remote"
                        : ZH
                          ? "本地"
                          : "local"}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-foreground-subtle">
                  <span className="min-w-0 truncate font-mono">{fact.workspacePath}</span>
                  {hasUnread ? (
                    <span className="size-1.5 flex-none rounded-full bg-[#4f8ef7]" />
                  ) : null}
                  <span className="flex-none">{tasks.length} 个任务</span>
                  <ChevronRight
                    className={`size-3.5 flex-none transition-transform ${
                      expanded ? "rotate-90" : ""
                    }`}
                  />
                </span>
                <span className="mt-0.5 block text-[13px] text-foreground-subtle">
                  {latest > 0
                    ? ZH
                      ? `更新于 ${formatRelativeTime(latest)}`
                      : `updated ${formatRelativeTime(latest)}`
                    : ZH
                      ? "暂无任务"
                      : "no tasks"}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={ZH ? "新建任务" : "New task"}
                className="flex size-9 flex-none items-center justify-center rounded-lg border border-border text-foreground-subtle active:bg-surface-hover"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenDraft(fact);
                }}
              >
                <Plus className="size-4" />
              </span>
            </div>
            {expanded && running > 0 ? (
              <p className="px-4 pb-1 text-xs text-success">
                {ZH ? `${running} 个任务运行中` : `${running} running`}
              </p>
            ) : null}
            {expanded && tasks.length > 0 ? (
              <ul className="px-1.5 pb-2">
                {tasks.map((task) => {
                  const status = statusMeta(task.status);
                  return (
                    <li key={task.taskId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-surface-hover"
                        onClick={() => props.onOpenTask(task)}
                      >
                        {task.unreadAt ? (
                          <span className="size-2 flex-none rounded-full bg-[#4f8ef7]" />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                        <span className={`flex-none text-xs ${status.cls}`}>{status.label}</span>
                        <span className="flex-none text-xs text-foreground-subtle">
                          {formatRelativeTime(task.updatedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
      {loading && items.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-foreground-subtle">
          {ZH ? "正在获取任务…" : "Loading tasks…"}
        </p>
      ) : null}
      {!loading && orderedKeys.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-foreground-subtle">
          {ZH ? "暂无工作区" : "No workspaces yet"}
        </p>
      ) : null}
    </div>
  );
}

export function PhoneShell() {
  const isPhone = usePhoneViewport();
  const workspaces = useZCodeSessionStore((state) => state.workspaces);
  const setActiveTaskId = useZCodeSessionStore((state) => state.setActiveTaskId);
  const activeEntry = useMemo(
    () => Object.entries(workspaces).find(([, bucket]) => bucket.activeTaskId != null),
    [workspaces],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("zcode-phone", isPhone);
    root.classList.toggle("zcode-chat", isPhone && activeEntry != null);
    root.classList.toggle("zcode-list", isPhone && activeEntry == null);
    // 聊天页收起官方侧栏与分隔条（#sidebar/resizable-handle 为官方稳定 DOM 标记）。
    // 样式随本模块自包含注入，不落官方文件。
    const style = document.createElement("style");
    style.textContent = [
      "html.zcode-phone.zcode-chat #sidebar{display:none}",
      "html.zcode-phone.zcode-chat [data-testid='resizable-handle']{display:none}",
    ].join("");
    document.head.appendChild(style);
    return () => {
      style.remove();
      root.classList.remove("zcode-phone", "zcode-chat", "zcode-list");
    };
  }, [isPhone, activeEntry]);

  if (!isPhone) {
    return null;
  }
  // 首页常驻挂载：进聊天页仅 visibility 隐藏（不卸载），任务数据/订阅/展开状态
  // 全部保留，返回首页零重新加载。
  return (
    <>
      <div className={activeEntry ? "invisible" : ""} aria-hidden={activeEntry || undefined}>
        <PhoneTaskHome
          onOpenTask={(task) =>
            setActiveTaskId(task.workspacePath, task.taskId, task.workspaceIdentity)
          }
          onOpenDraft={(fact) =>
            setActiveTaskId(fact.workspacePath, null, fact.workspaceIdentity)
          }
        />
      </div>
      {activeEntry ? (
        <TaskHomeBackBar
          onBack={() => {
            const [workspaceKey] = activeEntry;
            setActiveTaskId(workspaceKey, null);
          }}
        />
      ) : null}
    </>
  );
}

function TaskHomeBackBar(props: { onBack: () => void }) {
  return (
    <button
      type="button"
      className="fixed inset-x-0 top-0 flex h-10 items-center border-b border-border bg-card px-3.5 text-left text-sm text-foreground"
      style={{ zIndex: 2000000000 }}
      onClick={props.onBack}
    >
      {ZH ? "← 返回任务首页" : "← Back to task home"}
    </button>
  );
}
