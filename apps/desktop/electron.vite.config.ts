import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv, type Plugin } from "vite";

/** Sandboxed preload cannot load ESM (`import` in a CJS context). */
const PRELOAD_CJS = {
  format: "cjs" as const,
  entryFileNames: "[name].cjs",
  chunkFileNames: "[name]-[hash].cjs",
};

export const AUTH_REACT_REFRESH_PREAMBLE = `import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`;

function serveReactRefreshPreamble(): Plugin {
  return {
    name: "coordy-react-refresh-preamble",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module" },
          injectTo: "body-prepend",
          children: AUTH_REACT_REFRESH_PREAMBLE,
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publishableKey = env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  const approvedOrigin = env.VITE_CLERK_APPROVED_ORIGIN ?? "";
  const oauthClientId = env.VITE_CLERK_OAUTH_CLIENT_ID ?? "";

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        "process.env.VITE_CLERK_PUBLISHABLE_KEY":
          JSON.stringify(publishableKey),
        "process.env.VITE_CLERK_APPROVED_ORIGIN":
          JSON.stringify(approvedOrigin),
        "process.env.VITE_CLERK_OAUTH_CLIENT_ID":
          JSON.stringify(oauthClientId),
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve("src/preload/index.ts"),
          },
          output: PRELOAD_CJS,
        },
      },
    },
    renderer: {
      plugins: [serveReactRefreshPreamble(), react(), tailwindcss()],
      resolve: {
        alias: {
          "@": resolve("src/renderer/src"),
        },
        dedupe: ["react", "react-dom"],
      },
      server: {
        host: "127.0.0.1",
        fs: {
          allow: [resolve("../..")],
        },
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve("src/renderer/index.html"),
          },
        },
      },
    },
  };
});
