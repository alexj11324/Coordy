import { Input } from "@coordy/ui";
import { Bot, FolderKanban, LayoutDashboard, MessageSquare, PanelLeft, Plus, Puzzle, Search, UsersRound, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { modifierSymbol } from "../lib/coordy/shortcuts";
import { allNavItems } from "./nav";
import { useLayoutStore } from "../state/layout-store";

type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  keywords: string[];
  run: () => void;
};

export function CommandPalette({ os }: { os?: string }) {
  const open = useLayoutStore((s) => s.paletteOpen);
  const setOpen = useLayoutStore((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const mod = modifierSymbol(os);

  const items = useMemo<PaletteItem[]>(() => {
    const go = (path: string) => {
      navigate(path);
      setOpen(false);
    };
    const commands: PaletteItem[] = [
      {
        id: "cmd:new-task",
        label: "新建任务",
        hint: "C",
        keywords: ["new", "task", "issue", "创建", "任务", "事项"],
        run: () => {
          useLayoutStore.getState().requestNewTaskFocus();
          setOpen(false);
        },
      },
      {
        id: "cmd:new-agent",
        label: "新建智能体",
        keywords: ["new", "agent", "智能体", "创建"],
        run: () => go("/agents/new"),
      },
      {
        id: "cmd:new-squad",
        label: "新建小队",
        keywords: ["new", "squad", "小队", "创建"],
        run: () => {
          useLayoutStore.getState().requestFocus("new-squad");
          go("/squads");
        },
      },
      {
        id: "cmd:new-project",
        label: "新建项目",
        keywords: ["new", "project", "项目", "创建"],
        run: () => {
          useLayoutStore.getState().requestFocus("new-project");
          go("/projects");
        },
      },
      {
        id: "cmd:new-automation",
        label: "新建自动化",
        keywords: ["new", "automation", "自动化", "runbook", "创建"],
        run: () => {
          useLayoutStore.getState().requestFocus("new-automation");
          go("/automations");
        },
      },
      {
        id: "cmd:new-skill",
        label: "新建 Skill",
        keywords: ["new", "skill", "技能", "创建"],
        run: () => {
          useLayoutStore.getState().requestFocus("new-skill");
          go("/skills");
        },
      },
      {
        id: "cmd:new-chat",
        label: "新建聊天",
        keywords: ["new", "chat", "聊天", "对话", "创建"],
        run: () => {
          useLayoutStore.getState().openChatDock();
          setOpen(false);
        },
      },
      {
        id: "cmd:toggle-sidebar",
        label: "收起或展开侧栏",
        hint: `${mod}+B`,
        keywords: ["sidebar", "侧栏", "折叠", "收起"],
        run: () => {
          useLayoutStore.getState().toggleSidebar();
          setOpen(false);
        },
      },
    ];
    const pages: PaletteItem[] = allNavItems.map((item) => ({
      id: `page:${item.to}`,
      label: item.label,
      hint: item.to === "/" ? "开始" : undefined,
      keywords: [item.label, item.to],
      run: () => go(item.to),
    }));
    const q = query.trim().toLowerCase();
    const matched = [...commands, ...pages].filter((item) => {
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.keywords.some((word) => word.toLowerCase().includes(q));
    });
    return matched;
  }, [mod, navigate, query, setOpen]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;
  const current = items[index] ?? items[0];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭搜索"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索"
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setIndex((value) => Math.min(value + 1, Math.max(items.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter" && current) {
            event.preventDefault();
            current.run();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            placeholder="搜索页面或命令…"
            className="border-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <ul className="max-h-80 overflow-auto p-1">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的命令</li>
          ) : (
            items.map((item, itemIndex) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm",
                    item === current || itemIndex === index ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                  ].join(" ")}
                  onMouseEnter={() => setIndex(itemIndex)}
                  onClick={() => item.run()}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {item.id.startsWith("cmd:new-task") ? (
                      <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-agent") ? (
                      <Bot className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-squad") ? (
                      <UsersRound className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-project") ? (
                      <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-automation") ? (
                      <Workflow className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-skill") ? (
                      <Puzzle className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-chat") ? (
                      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:new-") ? (
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                    ) : item.id.startsWith("cmd:toggle") ? (
                      <PanelLeft className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Search className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.hint ? <kbd className="text-[10px] text-muted-foreground">{item.hint}</kbd> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
