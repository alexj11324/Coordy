// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost" }

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useCatalogComposer } from "../features/pages";
import { useLayoutStore } from "../state/layout-store";

describe("new chat flow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not reopen the page composer after command-palette dock creation", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      },
    });
    useLayoutStore.setState({ activeChatId: "chat_existing", chatDock: "closed", pendingFocus: null });
    useLayoutStore.getState().startNewChat();
    useLayoutStore.getState().setActiveChatId("chat_created_from_dock");

    function ChatPageComposerProbe() {
      const { creating } = useCatalogComposer("new-chat");
      return createElement("div", null, creating ? "composer-open" : "composer-closed");
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(ChatPageComposerProbe));
    });

    expect(document.body.textContent).toContain("composer-closed");
    expect(useLayoutStore.getState().pendingFocus).toBeNull();
    expect(useLayoutStore.getState().activeChatId).toBe("chat_created_from_dock");

    await act(async () => root.unmount());
  });
});
