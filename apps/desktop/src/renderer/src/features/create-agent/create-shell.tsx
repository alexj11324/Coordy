import { Button, cn } from "@coordy/ui";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function AgentCreateShell({
  title,
  onBack,
  backDisabled = false,
  chips,
  children,
}: {
  title: string;
  onBack: () => void;
  backDisabled?: boolean;
  chips?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          disabled={backDisabled}
          aria-label="返回"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
        </div>
        {chips ? (
          <div className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            {chips}
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}

export function AgentCreateChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("rounded-full bg-muted px-2 py-1", className)}>
      {children}
    </span>
  );
}
