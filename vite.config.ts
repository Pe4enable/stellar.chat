import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { handleAuditRequest } from "./server/audit.mjs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "savant-audit-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleAuditRequest(req, res)
            .then((handled) => {
              if (!handled) next();
            })
            .catch(next);
        });
      },
    },
  ],
  server: { port: 5173 },
});
