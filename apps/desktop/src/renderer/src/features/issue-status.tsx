import { cn } from "@coordy/ui";
import {
  AlertCircle,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
import { priorityBarCount, priorityTone, statusTone } from "../lib/coordy/issues";
import { taskStatusLabel } from "../lib/coordy/labels";

const STATUS_ICONS: Record<string, LucideIcon> = {
  backlog: CircleDashed,
  open: Circle,
  running: CircleDot,
  review: CircleDot,
  blocked: CircleAlert,
  done: CircleCheck,
  cancelled: CircleSlash,
};

export function StatusGlyph({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const Icon = STATUS_ICONS[status] ?? Circle;
  return (
    <Icon
      aria-label={taskStatusLabel(status)}
      className={cn(
        "size-3.5 shrink-0 stroke-[1.75]",
        status === "done" && "fill-current",
        statusTone(status),
        className,
      )}
    />
  );
}

export function PriorityGlyph({
  priority,
  className,
}: {
  priority?: string | null;
  className?: string;
}) {
  const key = priority && priority !== "none" ? priority : "none";
  if (key === "urgent") {
    return <AlertCircle className={cn("size-3.5 shrink-0", priorityTone(key), className)} />;
  }
  const filled = priorityBarCount(key);
  return (
    <span
      aria-hidden
      className={cn("inline-flex h-3.5 w-3 shrink-0 items-end justify-between", priorityTone(key), className)}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "w-0.5 rounded-[1px]",
            index === 0 ? "h-1.5" : index === 1 ? "h-2.5" : "h-3.5",
            index < filled ? "bg-current" : "bg-current/20",
          )}
        />
      ))}
    </span>
  );
}
