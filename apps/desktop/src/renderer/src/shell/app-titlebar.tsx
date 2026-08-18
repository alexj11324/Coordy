import { useQuery } from "@tanstack/react-query";
import { WindowChrome } from "./window-chrome";
import { TabStrip } from "./tab-bar";

export function AppTitlebar() {
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.coordy.getAppInfo(),
  });
  const darwin = appInfo.data?.os === "darwin";

  return (
    <header
      className="absolute inset-x-0 top-0 z-30 flex h-11 items-center gap-1 border-b border-sidebar-border bg-sidebar pr-1"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <WindowChrome className={darwin ? "pl-[72px]" : "pl-2"} />
      <TabStrip />
    </header>
  );
}
