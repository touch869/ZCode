/**
 * 手机远控壳（Phone Shell）—— 完全独立于官方组件树的增量层。
 *
 * 架构（对齐官方 /remote/v4 两页形态；官方手机壳为闭源注入件，此处自建）：
 * - 列表页：本模块的全屏 overlay 卡片首页，数据全部消费官方既有模块
 *   （useGlobalTaskList / useZCodeSessionStore，经 @zcode/ui 增量导出）；
 * - 聊天页：官方应用原树（SessionPane 等）原样复用、零重写，官方升级自动继承。
 *   这里只做两件事：CSS 收起侧栏（html.zcode-chat）+ 顶部返回条。
 *
 * rebase 约束：本目录不 import 官方组件内部实现；官方文件只允许
 * 「增量导出」级别的接触（见 packages/ui/src/index.ts 末尾）。
 */
import { useEffect, useMemo, useState } from "react";
import { useGlobalTaskList, useZCodeSessionStore } from "@zcode/ui";
import "./phone.css";

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

type TaskListItem = ReturnType<typeof useGlobalTaskList>["items"][number];

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const last = normalized.split(/[\\/]/).pop();
  return last || path;
}

function PhoneTaskHome(props: { onOpenTask: (task: TaskListItem) => void }) {
  // zustand v5（useSyncExternalStore）要求 selector 返回稳定引用；
  // 派生数组必须在 useMemo 里做，否则触发 React #185 无限更新。
  const workspaces = useZCodeSessionStore((state) => state.workspaces);
  const workspaceKeys = useMemo(() => Object.keys(workspaces), [workspaces]);
  const workspaceTabs = useMemo(
    () =>
      workspaceKeys.map((key) => ({
        kind: "workspace" as const,
        id: key,
        workspacePath: key,
      })) as unknown as Parameters<typeof useGlobalTaskList>[0]["workspaceTabs"],
    [workspaceKeys],
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
  const groups = useMemo(() => {
    const map = new Map<string, { tasks: TaskListItem[]; latest: number }>();
    for (const item of items) {
      const key = item.workspaceIdentity?.trim() || item.workspacePath;
      const entry = map.get(key) ?? { tasks: [], latest: 0 };
      entry.tasks.push(item);
      entry.latest = Math.max(entry.latest, item.updatedAt ?? 0);
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort(([, a], [, b]) => b.latest - a.latest);
  }, [items]);

  return (
    <div className="phone-home">
      <h1 className="phone-home-title">{ZH ? "ZCode 远程控制" : "ZCode Remote Control"}</h1>
      <p className="phone-home-subtitle">
        {ZH ? "已连接到当前桌面窗口" : "Connected to the current desktop window"}
      </p>
      <h2 className="phone-home-section">
        {ZH ? "当前设备上的工作区和任务" : "Workspaces & tasks"}
        <span className="phone-home-summary">
          {ZH
            ? `${workspaceKeys.length} 个工作区 · ${items.length} 个任务`
            : `${workspaceKeys.length} workspaces · ${items.length} tasks`}
        </span>
      </h2>
      {groups.map(([key, group]) => {
        const collapsed = collapsedKeys.has(key);
        const running = group.tasks.filter((task) => task.status === "running").length;
        return (
          <section key={key} className="phone-card">
            <button
              type="button"
              className="phone-card-header"
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
              <span className="phone-card-name">{basename(key)}</span>
              {running > 0 ? (
                <span className="phone-badge phone-badge-running">
                  {ZH ? `${running} 运行中` : `${running} running`}
                </span>
              ) : null}
              <span className="phone-card-meta">
                {group.tasks.length} {ZH ? "个任务" : "tasks"} · {formatRelativeTime(group.latest)}
              </span>
            </button>
            {!collapsed ? (
              <ul className="phone-task-list">
                {group.tasks.map((task) => (
                  <li key={task.taskId}>
                    <button
                      type="button"
                      className="phone-task-row"
                      onClick={() => props.onOpenTask(task)}
                    >
                      {task.unreadAt ? <span className="phone-unread-dot" /> : null}
                      <span className="phone-task-title">{task.title}</span>
                      <span
                        className={`phone-task-status phone-task-status-${task.status ?? "completed"}`}
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
                      <span className="phone-task-time">{formatRelativeTime(task.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
      {loading && items.length === 0 ? (
        <p className="phone-home-loading">{ZH ? "正在获取任务…" : "Loading tasks…"}</p>
      ) : null}
      {!loading && groups.length === 0 ? (
        <p className="phone-home-loading">{ZH ? "暂无任务" : "No tasks yet"}</p>
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
    return () => {
      root.classList.remove("zcode-phone", "zcode-chat", "zcode-list");
    };
  }, [isPhone, activeEntry]);

  if (!isPhone) {
    return null;
  }
  if (activeEntry) {
    const [workspaceKey] = activeEntry;
    return (
      <button
        type="button"
        className="phone-back-bar"
        onClick={() => setActiveTaskId(workspaceKey, null)}
      >
        ← {ZH ? "返回任务首页" : "Back to task home"}
      </button>
    );
  }
  return (
    <div className="phone-overlay">
      <PhoneTaskHome onOpenTask={(task) => setActiveTaskId(task.workspacePath, task.taskId, task.workspaceIdentity)} />
    </div>
  );
}
