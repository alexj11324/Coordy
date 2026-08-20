import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Separator,
} from "@coordy/ui";
import {
  Building2,
  ChevronRight,
  LogOut,
  MailPlus,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { RequireOnlineAccount, useAccount } from "../auth/account-context";

export function OnlineTeamPage() {
  return (
    <RequireOnlineAccount>
      <OnlineTeamContent />
    </RequireOnlineAccount>
  );
}

function OnlineTeamContent() {
  const account = useAccount();
  const identity = account.identity!;
  const organization = account.organization;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-auto">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">在线团队</h1>
          <p className="truncate text-sm text-muted-foreground">
            与真人成员共享项目；本地工作区、小队和 Agent 不受影响。
          </p>
        </div>
        <Button
          variant="ghost"
          className="h-auto min-w-0 gap-2 px-2 py-1.5"
          aria-label="管理在线账号"
          onClick={() => account.open("profile")}
        >
          <Avatar className="size-7">
            {identity.imageUrl ? <AvatarImage src={identity.imageUrl} alt="" /> : null}
            <AvatarFallback className="text-[11px]">{initials(identity.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block max-w-40 truncate text-sm font-medium">{identity.name}</span>
            {identity.email ? (
              <span className="block max-w-40 truncate text-xs font-normal text-muted-foreground">
                {identity.email}
              </span>
            ) : null}
          </span>
          <UserRoundCog data-icon="inline-start" aria-hidden="true" />
        </Button>
      </header>

      <div className="w-full max-w-3xl px-6 py-6">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-10 rounded-lg">
                {organization?.imageUrl ? (
                  <AvatarImage src={organization.imageUrl} alt="" />
                ) : null}
                <AvatarFallback className="rounded-lg bg-muted text-sm font-medium">
                  {organization ? initials(organization.name) : <Building2 className="size-4" />}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold">
                    {organization?.name ?? "尚未选择团队"}
                  </h2>
                  {organization ? (
                    <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[11px] font-normal">
                      <ShieldCheck className="size-3" aria-hidden="true" />
                      已连接
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {organization
                    ? "当前真人协作空间"
                    : "选择已加入的团队，或创建一个新团队"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => account.open("organization-list")}>
                切换团队
              </Button>
              <Button size="sm" onClick={() => account.open("create-organization")}>
                <Building2 data-icon="inline-start" aria-hidden="true" />
                创建团队
              </Button>
            </div>
          </div>

          {organization ? (
            <>
              <Separator />
              <div className="divide-y divide-border" aria-label="团队操作">
                <TeamAction
                  icon={MailPlus}
                  title="邀请成员"
                  description="通过邮箱邀请真人加入当前团队"
                  onClick={() => account.open("manage-organization")}
                />
                <TeamAction
                  icon={UsersRound}
                  title="管理成员与角色"
                  description="查看成员、待处理邀请和访问权限"
                  onClick={() => account.open("manage-organization")}
                />
              </div>
            </>
          ) : (
            <div className="border-t border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              已收到邀请？
              <button
                type="button"
                className="ml-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2"
                onClick={() => account.open("organization-list")}
              >
                查看邀请与可加入团队
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-lg bg-muted/40 px-4 py-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="leading-5 text-muted-foreground">
            只有真人团队协作会使用在线账号。你的本地 Agent、私有记忆和运行环境不会加入团队同步。
          </p>
        </div>

        <div className="mt-6 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void account.signOut()}
          >
            <LogOut data-icon="inline-start" aria-hidden="true" />
            退出在线账号
          </Button>
        </div>
      </div>
    </section>
  );
}

function TeamAction({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof MailPlus;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      onClick={onClick}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

function initials(name: string): string {
  return Array.from(name.trim() || "团队").slice(0, 2).join("").toUpperCase();
}
