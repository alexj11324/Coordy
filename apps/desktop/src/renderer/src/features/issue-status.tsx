import { cn } from "@coordy/ui";
import { Circle } from "lucide-react";
import { statusTone } from "../lib/coordy/issues";
import { taskStatusLabel } from "../lib/coordy/labels";

export function StatusGlyph({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Circle
      aria-label={taskStatusLabel(status)}
      className={cn("size-3.5 fill-current", statusTone(status), className)}
    />
  );
}
