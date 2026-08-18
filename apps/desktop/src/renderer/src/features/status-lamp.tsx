import { cn } from "@coordy/ui";
import type { LampTone } from "../lib/coordy/labels";

const TONE_CLASS: Record<LampTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
  gray: "bg-muted-foreground/50",
};

export function StatusLamp({
  tone,
  label,
  className,
}: {
  tone: LampTone;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        TONE_CLASS[tone],
        tone === "yellow" && "animate-pulse",
        className,
      )}
    />
  );
}
