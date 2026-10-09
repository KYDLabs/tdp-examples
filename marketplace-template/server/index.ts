import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app";
import { readServerConfig } from "./config";

const config = readServerConfig(
  process.env,
  process.argv.includes("--production") ||
    process.env.NODE_ENV === "production",
);
const app = createApp(config);

if (config.production) {
  const dist = resolve("dist");
  if (!existsSync(resolve(dist, "index.html"))) {
    throw new Error("Run pnpm build before pnpm start.");
  }
  app.use(express.static(dist));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(resolve(dist, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "**/*.{crt,pem}",
          "**/.git/**",
          "**/server/**",
          "**/.data/**",
          `${resolve(config.ordersDirectory)}/**`,
        ],
      },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(config.port, config.host, () => {
  console.log(`TDP template: http://${config.host}:${config.port}`);
});
