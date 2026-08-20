// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClerkPublishableKey } from "../../../shared/clerk-config";
import {
  AccountContextProvider,
  RequireOnlineAccount,
  type AccountContextValue,
} from "../auth/account-context";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    act(() => root?.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function publishableKey(host = "steady-owl-7.clerk.accounts.dev"): string {
  const encoded = btoa(`${host}$`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `pk_test_${encoded}`;
}

function account(
  partial: Partial<AccountContextValue>,
): AccountContextValue {
  return {
    status: "signed-out",
    identity: null,
    organization: null,
    open: vi.fn(),
    signOut: vi.fn(async () => undefined),
    ...partial,
  };
}

function renderWithAccount(value: AccountContextValue, node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <AccountContextProvider value={value}>{node}</AccountContextProvider>,
    );
  });
  return host;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(label),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${label}`);
  return found;
}

describe("Clerk configuration", () => {
  it("derives only the exact frontend origin from a valid publishable key", () => {
    expect(parseClerkPublishableKey(publishableKey())).toEqual({
      publishableKey: publishableKey(),
      frontendOrigin: "https://steady-owl-7.clerk.accounts.dev",
    });
    expect(parseClerkPublishableKey("sk_test_secret")).toBeNull();
    expect(parseClerkPublishableKey("pk_test_not-base64")).toBeNull();
    expect(parseClerkPublishableKey(undefined)).toBeNull();
  });

  it("rejects custom decoded domains unless the exact HTTPS origin is approved", () => {
    const key = publishableKey("clerk.accounts.example.com");
    expect(parseClerkPublishableKey(key)).toBeNull();
    expect(parseClerkPublishableKey(key, "https://clerk.accounts.example.com")).toEqual({
      publishableKey: key,
      frontendOrigin: "https://clerk.accounts.example.com",
    });
    expect(parseClerkPublishableKey(key, "https://other.example.com")).toBeNull();
  });
});

describe("online account gate", () => {
  it("keeps local mode usable and makes missing configuration actionable", () => {
    const value = account({ status: "config-missing" });
    const host = renderWithAccount(
      value,
      <RequireOnlineAccount><p>受保护内容</p></RequireOnlineAccount>,
    );
    expect(host.textContent).toContain("Clerk OAuth 公共客户端");
    expect(host.textContent).not.toContain("受保护内容");
    expect(button("在浏览器登录").disabled).toBe(true);
  });

  it("prompts signed-out users and resumes the mounted destination after sign-in", () => {
    const open = vi.fn();
    const signedOut = account({ status: "signed-out", open });
    const host = renderWithAccount(
      signedOut,
      <RequireOnlineAccount><p>真人团队目的地</p></RequireOnlineAccount>,
    );
    act(() => button("在浏览器登录").click());
    expect(open).toHaveBeenCalledWith("sign-in");
    expect(host.textContent).not.toContain("真人团队目的地");

    act(() => {
      roots.at(-1)?.render(
        <AccountContextProvider value={account({ status: "signed-in" })}>
          <RequireOnlineAccount><p>真人团队目的地</p></RequireOnlineAccount>
        </AccountContextProvider>,
      );
    });
    expect(host.textContent).toContain("真人团队目的地");
  });

  it("surfaces Clerk load failure without blocking local mode", () => {
    const host = renderWithAccount(
      account({ status: "config-error" }),
      <RequireOnlineAccount><p>受保护内容</p></RequireOnlineAccount>,
    );
    expect(host.textContent).toContain("Clerk 配置无法加载");
    expect(host.textContent).toContain("本地工作区与 Agent 仍可正常使用");
    expect(button("在浏览器登录").disabled).toBe(true);
  });
});

describe("online team surface", () => {
  it("exposes organization switching, invitations, management, and sign out", async () => {
    const { OnlineTeamPage } = await import("../features/online-team");
    const open = vi.fn();
    const signOut = vi.fn(async () => undefined);
    const host = renderWithAccount(
      account({
        status: "signed-in",
        identity: {
          id: "user_1",
          name: "Alex",
          email: "alex@example.test",
          imageUrl: null,
        },
        organization: { id: "org_1", name: "Coordy Team", imageUrl: null },
        open,
        signOut,
      }),
      <OnlineTeamPage />,
    );

    expect(host.textContent).toContain("Coordy Team");
    expect(host.textContent).not.toContain("Clerk Organization");
    act(() => button("切换团队").click());
    act(() => button("创建团队").click());
    act(() => button("邀请成员").click());
    act(() => button("管理成员与角色").click());
    act(() => button("退出在线账号").click());
    expect(open.mock.calls).toEqual([
      ["organization-list"],
      ["create-organization"],
      ["manage-organization"],
      ["manage-organization"],
    ]);
    expect(signOut).toHaveBeenCalledOnce();
  });
});
