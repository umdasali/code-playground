import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // @php-wasm/universal also targets Node and mentions worker_threads in a branch that never runs in the browser.
    resolveAlias: {
      worker_threads: { browser: "./src/lib/empty-module.ts" },
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The in-browser Linux/C runtime (Wasmer) needs SharedArrayBuffer, which browsers only allow on cross-origin-isolated pages.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
