import { Router } from "express";
import { buildHealthPayload, SHARED_APP_NAME } from "@shared/config/runtime";
import { env } from "./config";
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/account";
import hostRoutes from "./routes/hosts";
import agentRoutes from "./routes/agent";

const router = Router();

router.get("/health", (_req, res) => {
  res.json(buildHealthPayload("server"));
});

router.get("/config", (_req, res) => {
  res.json({ app: SHARED_APP_NAME, version: env.appVersion });
});

router.use("/auth", authRoutes);
router.use("/account", accountRoutes);
router.use("/hosts", hostRoutes);
router.use("/agent", agentRoutes);

export default router;
