import { cn } from "@coordy/ui";
import { forwardRef, type HTMLAttributes } from "react";

export const BaseNode = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { selected?: boolean }
>(({ className, selected, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative rounded-md border bg-card text-card-foreground",
      selected ? "border-muted-foreground shadow-lg" : "hover:ring-1 hover:ring-border",
      className,
    )}
    tabIndex={0}
    {...props}
  />
));
BaseNode.displayName = "BaseNode";

export const BaseNodeHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn("flex flex-row items-center justify-between gap-2 px-3 py-2", className)}
      {...props}
    />
  ),
);
BaseNodeHeader.displayName = "BaseNodeHeader";

export const BaseNodeHeaderTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("min-w-0 flex-1 truncate text-sm font-semibold", className)}
      {...props}
    />
  ),
);
BaseNodeHeaderTitle.displayName = "BaseNodeHeaderTitle";

export const BaseNodeContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-y-1 px-3 pb-3", className)} {...props} />
  ),
);
BaseNodeContent.displayName = "BaseNodeContent";
