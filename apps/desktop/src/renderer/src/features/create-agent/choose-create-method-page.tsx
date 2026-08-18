import { cn } from "@coordy/ui";
import { ChevronRight, FileText, MessageSquare, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AgentCreateShell } from "./create-shell";

const MODES: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  recommended?: boolean;
}[] = [
  {
    icon: FileText,
    title: "从空白开始",
    description: "自己配置每个字段。适合已经明确知道智能体应该如何工作的用户。",
    href: "/agents/new/blank",
  },
  {
    icon: MessageSquare,
    title: "通过 AI 创建",
    description: "描述你想要的结果。Agent Builder 会提出关键问题并实时生成草稿。",
    href: "/agents/new/ai",
    recommended: true,
  },
];

export function ChooseCreateMethodPage() {
  const navigate = useNavigate();
  return (
    <AgentCreateShell title="创建智能体" step="选择起点" onBack={() => navigate("/agents")}>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-10">
        <CreateMethodChooser />
      </main>
    </AgentCreateShell>
  );
}

export function CreateMethodChooser() {
  return (
    <div className="m-auto w-full max-w-5xl">
      <div className="mx-auto max-w-2xl text-center">
        <div className="text-xs font-medium tracking-wider text-muted-foreground uppercase">创建智能体</div>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">你想从哪里开始？</h2>
        <p className="mt-3 text-sm text-pretty text-muted-foreground">
          从空白配置开始，或者直接描述需求，通过对话完成创建。
        </p>
      </div>
      <div className="mx-auto mt-9 grid max-w-3xl gap-4 md:grid-cols-2">
        {MODES.map(({ icon: Icon, title, description, href, recommended }) => (
          <Link
            key={href}
            to={href}
            className={cn(
              "group relative flex min-h-56 flex-col items-start rounded-xl border bg-card p-5 text-left",
              "transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/30",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              recommended && "border-primary/30 bg-primary/[0.025]",
            )}
          >
            {recommended ? (
              <span className="absolute top-4 right-4 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                推荐
              </span>
            ) : null}
            <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
              <Icon className="size-5" />
            </span>
            <span className="mt-7 text-base font-semibold">{title}</span>
            <span className="mt-2 text-sm leading-6 text-muted-foreground">{description}</span>
            <span className="mt-auto flex items-center gap-1 pt-5 text-xs font-medium text-foreground">
              继续
              <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
