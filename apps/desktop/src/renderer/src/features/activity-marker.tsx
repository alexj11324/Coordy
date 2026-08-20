import {
  Bubble,
  BubbleContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageContent,
  MessageHeader,
  Spinner,
  cn,
} from "@coordy/ui";
import {
  Check,
  FileText,
  FoldVertical,
  Folder,
  Globe,
  Pencil,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  describeActivity,
  type ActivityIconName,
} from "../lib/coordy/activity";

const ICONS: Record<ActivityIconName, LucideIcon> = {
  pencil: Pencil,
  fold: FoldVertical,
  file: FileText,
  search: Search,
  terminal: Terminal,
  globe: Globe,
  folder: Folder,
  check: Check,
  wrench: Wrench,
};

function MarkerRow({
  icon,
  title,
  pending,
  interactive,
}: {
  icon: ActivityIconName;
  title: string;
  pending: boolean;
  interactive?: boolean;
}) {
  const Icon = ICONS[icon];
  return (
    <Marker
      className={cn(
        "inline-flex max-w-full items-center gap-2 text-[13px] text-muted-foreground md:text-[13px]",
        interactive && "cursor-pointer hover:text-foreground",
      )}
    >
      <MarkerIcon>{pending ? <Spinner /> : <Icon />}</MarkerIcon>
      <MarkerContent className="truncate">{title}</MarkerContent>
    </Marker>
  );
}

export function ActivityMarker({
  icon,
  title,
  detail,
  pending,
}: {
  icon: ActivityIconName;
  title: string;
  detail?: string;
  pending?: boolean;
}) {
  const busy = Boolean(pending);
  const row = (
    <div className="animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-300">
      <MarkerRow
        icon={icon}
        title={title}
        pending={busy}
        interactive={Boolean(detail)}
      />
    </div>
  );
  if (!detail) return row;
  return (
    <Collapsible className="animate-in fade-in-0 slide-in-from-left-1 fill-mode-both duration-300">
      <CollapsibleTrigger className="flex w-full items-center text-left outline-none">
        <MarkerRow icon={icon} title={title} pending={busy} interactive />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[13px] leading-5 text-muted-foreground md:text-[13px]">
          {detail}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ActivityLine({
  event,
}: {
  event: { kind: string; payload: string };
}) {
  const described = describeActivity(event);
  if (described.tone === "message") {
    return (
      <Message className="animate-in fade-in-0 fill-mode-both duration-300">
        <MessageContent>
          <MessageHeader>{described.label}</MessageHeader>
          <Bubble variant="ghost">
            <BubbleContent className="whitespace-pre-wrap text-[15px] leading-6 md:text-[15px]">
              {described.body}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  return (
    <ActivityMarker
      icon={described.icon}
      title={described.title}
      detail={described.detail}
      pending={described.pending}
    />
  );
}
