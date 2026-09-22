/**
 * 手机远控壳（Phone Shell）—— 完全独立于官方组件树的增量层。
 *
 * 架构（对齐官方 /remote/v4 两页形态；官方手机壳为闭源注入件，此处自建）：
 * - 列表页：本模块的全屏 overlay 卡片首页。工作区列表订阅官方
 *   WindowController 的 controller/workspaces 投影（全设备口径，与官方一致），
 *   任务列表复用官方 useGlobalTaskList；样式全部用应用自带 tailwind 主题类，
 *   浅色/深色主题自动跟随（不再自造颜色）。
 * - 聊天页：官方应用原树（SessionPane 等）原样复用、零重写，官方升级自动继承。
 *   这里只做两件事：CSS 收起侧栏（html.zcode-chat）+ 顶部返回条。
 *
 * rebase 约束：本目录不 import 官方组件内部实现；仅消费 @zcode/ui 主入口
 * 增量导出的既有模块与 @zcode/shared 协议常量。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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

function PhoneTaskHome(props: { onOpenTask: (task: TaskListItem) => void }) {
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
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const orderedKeys = useMemo(
    () =>
      workspaces
        .map(workspaceKeyOf)
        .sort((left, right) => {
          const leftLatest = Math.max(
            0,
            ...items.filter((item) => item.workspaceIdentity?.trim() || item.workspacePath === left).map((item) => item.updatedAt ?? 0),
          );
          const rightLatest = Math.max(
            0,
            ...items.filter((item) => item.workspaceIdentity?.trim() || item.workspacePath === right).map((item) => item.updatedAt ?? 0),
          );
          return rightLatest - leftLatest;
        }),
    [workspaces, items],
  );
  const tasksByKey = useMemo(() => {
    const map = new Map<string, WindowHostControllerTaskListItem[]>();
    for (const item of items) {
      const key = item.workspaceIdentity?.trim() || item.workspacePath;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  return (
    <div
      className="fixed inset-0 overflow-y-auto bg-background px-4 text-foreground"
      style={{ zIndex: 2000000000, paddingTop: 18, paddingBottom: 24 }}
    >
      <h1 className="text-xl font-semibold">{ZH ? "ZCode 远程控制" : "ZCode Remote Control"}</h1>
      <p className="mt-1 text-xs text-foreground-subtle">
        {ZH ? "已连接到当前桌面窗口" : "Connected to the current desktop window"}
      </p>
      <h2 className="mt-6 flex flex-wrap items-baseline gap-2 text-sm font-semibold">
        {ZH ? "当前设备上的工作区和任务" : "Workspaces & tasks"}
        <span className="text-xs font-normal text-foreground-subtle">
          {ZH
            ? `${workspaces.length} 个工作区 · ${items.length} 个任务`
            : `${workspaces.length} workspaces · ${items.length} tasks`}
        </span>
      </h2>
      {orderedKeys.map((key) => {
        const fact = workspaces.find((candidate) => workspaceKeyOf(candidate) === key);
        if (!fact) {
          return null;
        }
        const tasks = tasksByKey.get(key) ?? [];
        const collapsed = collapsedKeys.has(key);
        const latest = Math.max(0, ...tasks.map((task) => task.updatedAt ?? 0));
        const running = tasks.filter((task) => task.status === "running").length;
        const isRemote = Boolean(fact.remoteSessionId);
        return (
          <section key={key} className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
            <button
              type="button"
              className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-3.5 text-left"
              onClick={() =>
                setCollapsedKeys((current) => {
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
              {collapsed ? (
                <ChevronRight className="size-4 self-center text-foreground-subtle" />
              ) : (
                <ChevronDown className="size-4 self-center text-foreground-subtle" />
              )}
              <span className="text-base font-semibold">{basename(key)}</span>
              <span className="rounded-full border border-border px-2 py-px text-xs text-foreground-subtle">
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
              {running > 0 ? (
                <span className="rounded-full border border-success/40 px-2 py-px text-xs text-success">
                  {ZH ? `${running} 运行中` : `${running} running`}
                </span>
              ) : null}
              <span className="ml-auto text-xs text-foreground-subtle">
                {tasks.length} {ZH ? "个任务" : "tasks"}
                {latest > 0 ? <> · {formatRelativeTime(latest)}</> : null}
              </span>
            </button>
            {!collapsed ? (
              tasks.length > 0 ? (
                <ul className="px-1.5 pb-2">
                  {tasks.map((task) => (
                    <li key={task.taskId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 py-3 text-left text-sm hover:bg-surface-hover"
                        onClick={() => props.onOpenTask(task)}
                      >
                        {task.unreadAt ? (
                          <span className="size-2 flex-none rounded-full bg-[#4f8ef7]" />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                        <span
                          className={`flex-none text-xs ${
                            task.status === "running"
                              ? "text-success"
                              : task.status === "error"
                                ? "text-destructive"
                                : "text-foreground-subtle"
                          }`}
                        >
                          {task.status === "running"
                            ? ZH
                              ? "运行中"
                              : "running"
                            : task.status === "error"
                              ? ZH
                                ? "出错"
                                : "error"
                              : ZH
                                ? "已完成"
                                : "done"}
                        </span>
                        <span className="flex-none text-xs text-foreground-subtle">
                          {formatRelativeTime(task.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 pb-3 text-xs text-foreground-subtlest">
                  {ZH ? "暂无任务" : "No tasks yet"}
                </p>
              )
            ) : null}
          </section>
        );
      })}
      {loading && items.length === 0 ? (
        <p className="mt-10 text-center text-xs text-foreground-subtle">
          {ZH ? "正在获取任务…" : "Loading tasks…"}
        </p>
      ) : null}
      {!loading && orderedKeys.length === 0 ? (
        <p className="mt-10 text-center text-xs text-foreground-subtle">
          {ZH ? "暂无工作区" : "No workspaces yet"}
        </p>
      ) : null}
    </div>
  );
}

type TaskListItem = ReturnType<typeof useGlobalTaskList>["items"][number];

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
    return () => {
      root.classList.remove("zcode-phone", "zcode-chat", "zcode-list");
    };
  }, [isPhone, activeEntry]);

  useEffect(() => {
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
    };
  }, []);

  if (!isPhone) {
    return null;
  }
  if (activeEntry) {
    const [workspaceKey] = activeEntry;
    return (
      <button
        type="button"
        className="fixed inset-x-0 top-0 flex h-10 items-center border-b border-border bg-card px-3.5 text-left text-sm text-foreground"
        style={{ zIndex: 2000000000 }}
        onClick={() => setActiveTaskId(workspaceKey, null)}
      >
        ← {ZH ? "返回任务首页" : "Back to task home"}
      </button>
    );
  }
  return (
    <div>
      <PhoneTaskHome
        onOpenTask={(task) =>
          setActiveTaskId(task.workspacePath, task.taskId, task.workspaceIdentity)
        }
      />
    </div>
  );
}
