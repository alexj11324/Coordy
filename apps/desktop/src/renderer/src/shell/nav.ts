import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  FileText,
  GitBranch,
  Home,
  Inbox,
  LayoutDashboard,
  Monitor,
  Play,
  Settings,
  Shield,
  StickyNote,
  Users,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

export const personalNav: NavItem[] = [
  { to: "/inbox", label: "收件箱", icon: Inbox },
  { to: "/", label: "开始", icon: Home, end: true },
  { to: "/board", label: "任务", icon: LayoutDashboard },
];

export const workspaceNav: NavItem[] = [{ to: "/agents", label: "智能体", icon: Bot }];

export const configNav: NavItem[] = [
  { to: "/runtimes", label: "运行时", icon: Monitor },
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

export const allNavItems: NavItem[] = [...personalNav, ...workspaceNav, ...configNav, ...moreNav];

export const COMPACT_WIDTH = 768;
export const SIDEBAR_EXPANDED_CLASS = "w-60";
export const SIDEBAR_COLLAPSED_CLASS = "w-12";
