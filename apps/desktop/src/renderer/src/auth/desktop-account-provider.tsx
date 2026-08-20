import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SanitizedAuthState } from "../../../shared/auth-bridge";
import {
  AccountContextProvider,
  type AccountContextValue,
} from "./account-context";

export function AccountProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: AccountContextValue;
}) {
  const [state, setState] = useState<SanitizedAuthState>({
    status: "loading",
    identity: null,
    organization: null,
  });

  useEffect(() => {
    if (value) return;
    let active = true;
    void window.coordy.authState().then((next) => {
      if (active) setState(next);
    });
    const unsubscribe = window.coordy.subscribeAuth((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [value]);

  const bridgeValue = useMemo<AccountContextValue>(() => value ?? ({
    ...state,
    open: (surface) => {
      void window.coordy.openAuth(surface);
    },
    signOut: async () => {
      await window.coordy.signOutAuth();
    },
  }), [state, value]);

  return (
    <AccountContextProvider value={bridgeValue}>
      {children}
    </AccountContextProvider>
  );
}
