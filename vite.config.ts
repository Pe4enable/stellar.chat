import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.AUDIT_TARGET;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: target
        ? {
            "/audit-service": {
              target,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/audit-service/, ""),
            },
          }
        : undefined,
    },
  };
});
