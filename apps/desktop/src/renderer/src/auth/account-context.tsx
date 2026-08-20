import { Button } from "@coordy/ui";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type {
  AuthStatus,
  AuthSurface,
  SanitizedAuthState,
} from "../../../shared/auth-bridge";

export type AccountContextValue = {
  status: AuthStatus;
  identity: SanitizedAuthState["identity"];
  organization: SanitizedAuthState["organization"];
  open: (surface: AuthSurface) => void;
  signOut: () => Promise<void>;
};

export const LOCAL_ONLY_ACCOUNT: AccountContextValue = {
  status: "config-missing",
  identity: null,
  organization: null,
  open: () => undefined,
  signOut: async () => undefined,
};

const AccountContext = createContext<AccountContextValue>(LOCAL_ONLY_ACCOUNT);

export function AccountContextProvider({
  value,
  children,
}: {
  value: AccountContextValue;
  children: ReactNode;
}) {
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}

export function RequireOnlineAccount({ children }: { children: ReactNode }) {
  const account = useAccount();

  if (account.status === "signed-in") return children;
  if (account.status === "loading") {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        正在恢复在线账号…
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-64 max-w-xl flex-col items-start justify-center gap-4 rounded-xl border border-border bg-card p-8">
      <div>
        <h2 className="text-lg font-semibold">在线团队需要账号</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {account.status === "config-missing"
            ? "当前构建没有配置 Clerk OAuth 公共客户端，因此只能使用本地工作区、成员、小队和 Agent。"
            : account.status === "config-error"
              ? "Clerk 配置无法加载、已失效或当前网络不可达。请检查 OAuth 客户端配置和网络后重试；本地工作区与 Agent 仍可正常使用。"
            : "将在系统浏览器打开 Clerk 官方登录页。登录后会自动返回 Coordy；本地工作区与 Agent 不受影响。"}
        </p>
      </div>
      <Button
        disabled={account.status === "config-missing" || account.status === "config-error"}
        onClick={() => account.open("sign-in")}
      >
        在浏览器登录
      </Button>
    </div>
  );
}
