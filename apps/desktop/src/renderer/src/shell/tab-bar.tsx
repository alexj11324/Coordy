import { Button, cn } from "@coordy/ui";
import { Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTabStore } from "../state/tab-store";

export function TabStrip() {
  const navigate = useNavigate();
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);

  const open = (path: string) => {
    useTabStore.getState().ensure(path);
    navigate(path);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-1">
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const canClose = tabs.length > 1 || tab.path !== "/";
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              data-tab-active={active ? "true" : undefined}
              className={cn(
                "group relative flex max-w-[16rem] min-w-[7rem] shrink-0 items-center",
                active ? "z-10" : "z-0",
              )}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <button
                type="button"
                title={tab.title}
                onClick={() => open(tab.path)}
                onAuxClick={(event) => {
                  if (event.button !== 1 || !canClose) return;
                  event.preventDefault();
                  const next = useTabStore.getState().close(tab.id);
                  navigate(next);
                }}
                className={cn(
                  "flex h-full min-w-0 flex-1 items-center gap-1 rounded-md px-2.5 text-left text-sm",
                  active
                    ? "bg-background font-medium text-foreground"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
              >
                <span className="min-w-0 truncate">{tab.title}</span>
              </button>
              {canClose ? (
                <button
                  type="button"
                  aria-label={`关闭 ${tab.title}`}
                  className={cn(
                    "absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    const next = useTabStore.getState().close(tab.id);
                    navigate(next);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="self-center"
        aria-label="新标签页"
        title="新标签页"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        onClick={() => open("/board")}
      >
        <Plus />
      </Button>
    </div>
  );
}
