import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

/** Sandboxed preload cannot load ESM (`import` in a CJS context). */
const PRELOAD_CJS = {
  format: "cjs" as const,
  entryFileNames: "[name].cjs",
  chunkFileNames: "[name]-[hash].cjs",
};

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
          children: `import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`,
        },
      ];
    },
  };
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
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
  },
});

