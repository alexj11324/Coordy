import { Button, Calendar, Popover, PopoverContent, PopoverTrigger, cn } from "@coordy/ui";
import { useState } from "react";
import { formatIsoDate, parseIsoDate } from "../lib/coordy/date-picker";

export function DatePickerField({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
  align = "start",
  allowClear = true,
}: {
  value?: string | null;
  onChange: (next: string) => void;
  placeholder: string;
  "aria-label"?: string;
  className?: string;
  align?: "start" | "center" | "end";
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const day = selected ? formatIsoDate(selected) : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        nativeButton
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "flex h-8 w-full items-center text-left outline-none",
          day ? "text-foreground" : "text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">{day || placeholder}</span>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto gap-0 p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(next) => {
            if (!next) return;
            onChange(formatIsoDate(next));
            setOpen(false);
          }}
        />
        {allowClear && day ? (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              清除日期
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
