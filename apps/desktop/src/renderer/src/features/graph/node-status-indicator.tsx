import { cn } from "@coordy/ui";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export type NodeStatus = "loading" | "success" | "error" | "initial";

export function NodeStatusIndicator({
  status = "initial",
  variant = "border",
  children,
  className,
}: {
  status?: NodeStatus;
  variant?: "border" | "overlay";
  children?: ReactNode;
  className?: string;
}) {
  const ring =
    status === "loading"
      ? "border-sky-500/80"
      : status === "success"
        ? "border-emerald-500/80"
        : status === "error"
          ? "border-destructive/80"
          : "";

  return (
    <div className={cn("relative rounded-[inherit]", className)}>
      {status !== "initial" && variant === "border" ? (
        <div
          className={cn(
            "pointer-events-none absolute -top-px -left-px h-[calc(100%+2px)] w-[calc(100%+2px)] rounded-[inherit] border-2",
            ring,
          )}
        />
      ) : null}
      {status === "loading" && variant === "overlay" ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-background/50">
          <LoaderCircle className="size-4 animate-spin text-sky-500" />
        </div>
      ) : null}
      {children}
    </div>
  );
}
