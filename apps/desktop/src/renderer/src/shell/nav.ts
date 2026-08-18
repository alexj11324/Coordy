import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  FileText,
  FolderKanban,
  GitBranch,
  Home,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Play,
  Puzzle,
  Settings,
  Shield,
  StickyNote,
  User,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

export const personalNav: NavItem[] = [
  { to: "/inbox", label: "收件箱", icon: Inbox },
  { to: "/chat", label: "聊天", icon: MessageSquare },
  { to: "/mine", label: "我的任务", icon: User },
];

export const workspaceNav: NavItem[] = [
  { to: "/board", label: "任务", icon: LayoutDashboard },
  { to: "/projects", label: "项目", icon: FolderKanban },
  { to: "/automations", label: "自动化", icon: Workflow },
  { to: "/agents", label: "智能体", icon: Bot },
  { to: "/squads", label: "小队", icon: UsersRound },
  { to: "/stats", label: "统计", icon: BarChart3 },
];

export const configNav: NavItem[] = [
  { to: "/runtimes", label: "运行时", icon: Monitor },
  { to: "/skills", label: "Skills", icon: Puzzle },
  { to: "/settings", label: "设置", icon: Settings },
];

export const moreNav: NavItem[] = [
  { to: "/runs", label: "动态", icon: Play },
  { to: "/principals", label: "成员", icon: Users },
  { to: "/authority", label: "权限", icon: Shield },
  { to: "/memory", label: "备忘", icon: StickyNote },
  { to: "/contracts", label: "约定", icon: FileText },
  { to: "/dependencies", label: "关联", icon: GitBranch },
  { to: "/conflicts", label: "冲突", icon: AlertTriangle },
];

export const allNavItems: NavItem[] = [
  { to: "/", label: "开始", icon: Home, end: true },
  ...personalNav,
  ...workspaceNav,
  ...configNav,
  ...moreNav,
];

export const COMPACT_WIDTH = 768;

export function navItemActive(pathname: string, item: Pick<NavItem, "to" | "end">): boolean {
  if (item.end || item.to === "/") return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
