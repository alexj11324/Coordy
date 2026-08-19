// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost" }

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueCreateDialog } from "../features/issue-create-dialog";
import { useLayoutStore } from "../state/layout-store";
import { useSession } from "../state/session-store";

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return match;
}

describe("issue create dialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps selected attachments when switching modes and back", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    Object.assign(window, {
      coordy: {
        view: vi.fn(async ({ query }: { query: { type: string } }) => {
          if (query.type === "Workspaces") return { type: "Workspaces", items: [] };
          if (query.type === "Agents") return { type: "Agents", items: [] };
          if (query.type === "Projects") return { type: "Projects", items: [] };
          throw new Error(`unexpected view: ${query.type}`);
        }),
        submit: vi.fn(),
        discoverAgents: vi.fn(async () => []),
      },
    });
    useSession.getState().setWorkspace("ws");
    useSession.getState().setPrincipal("p1");
    useLayoutStore.setState({ lastCreateMode: "manual" });
    useLayoutStore.getState().openIssueComposer();

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(IssueCreateDialog),
          ),
        ),
      );
    });

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["evidence"], "evidence.txt", { type: "text/plain" })],
    });
    await act(async () => {
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("已选 evidence.txt");

    await act(async () => button("切换到智能体").click());
    await act(async () => button("切换到手动").click());
    expect(document.body.textContent).toContain("已选 evidence.txt");

    await act(async () => root.unmount());
  });
});
