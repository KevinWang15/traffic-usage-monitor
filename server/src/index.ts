import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { API_PREFIX } from "@shared/config/runtime";
import { env } from "./config";
import routes from "./routes";
import prisma from "./prisma";
import { HttpError, toJsonSafe } from "./lib/http";
import { startResetScheduler } from "./services/resetScheduler";

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(cors({ credentials: true }));
app.use(API_PREFIX, routes);

const candidateStaticDirs = [
  path.resolve(__dirname, "public"),
  path.resolve(__dirname, "../../client/dist"),
];
const staticDir = candidateStaticDirs.find((dir) => fs.existsSync(dir));
if (staticDir) {
  app.use(express.static(staticDir));
  app.get(/.*/, (req, res) => {
    if (path.extname(req.path)) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.sendFile("index.html", { root: staticDir });
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Internal Server Error";
  if (statusCode >= 500) {
    console.error(error);
  }
  res.status(statusCode).json(toJsonSafe({ error: message }));
});

const resetTimer = startResetScheduler();

const server = app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down...`);
  clearInterval(resetTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
