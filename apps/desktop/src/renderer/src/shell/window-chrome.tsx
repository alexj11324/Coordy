import { Button, SidebarTrigger, cn } from "@coordy/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNavHistoryFlags, useNavHistoryStore } from "../state/nav-history-store";

export function WindowChrome({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { canBack, canForward } = useNavHistoryFlags();
  const back = useNavHistoryStore((s) => s.back);
  const forward = useNavHistoryStore((s) => s.forward);
  const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <SidebarTrigger aria-label="切换侧边栏" title="切换侧边栏" style={noDrag} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canBack}
        aria-label="后退"
        title="后退"
        style={noDrag}
        onClick={() => {
          const path = back();
          if (path) navigate(path);
        }}
      >
        <ChevronLeft />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canForward}
        aria-label="前进"
        title="前进"
        style={noDrag}
        onClick={() => {
          const path = forward();
          if (path) navigate(path);
        }}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
