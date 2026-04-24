import { ResetPeriod } from "@prisma/client";
import { Router } from "express";
import prisma from "../prisma";
import { readAgentAsset } from "../agentAssets";
import { asyncHandler, HttpError, sendJson } from "../lib/http";
import { hashSecret, randomToken, readBearerToken } from "../lib/security";
import { normalizeCycleStart } from "../lib/cycles";
import { requireAgent } from "../middleware/auth";
import { processAgentReport } from "../services/traffic";

const router = Router();

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

router.get("/install.sh", (_req, res) => {
  res.type("text/x-shellscript").send(readAgentAsset("install.sh"));
});

router.get("/traffic-agent.sh", (_req, res) => {
  res.type("text/x-shellscript").send(readAgentAsset("traffic-agent.sh"));
});

router.post(
  "/join",
  asyncHandler(async (req, res) => {
    const joinToken = readBearerToken(req.header("Authorization"));
    const user = await prisma.user.findUnique({ where: { joinToken } });
    if (!user) {
      throw new HttpError(401, "Invalid account join token");
    }

    const hostname = stringOrNull(req.body.hostname) || "unknown-host";
    const name = stringOrNull(req.body.name);
    const machineId = stringOrNull(req.body.machineId) || `${hostname}:${randomToken(8)}`;
    const bootId = stringOrNull(req.body.bootId);
    const agentKey = randomToken(32);
    const now = new Date();

    const defaults = {
      resetPeriod: ResetPeriod.MONTHLY,
      resetDayOfMonth: 1,
      resetDayOfWeek: 1,
      resetMonth: 1,
      resetHourUtc: 0,
      resetMinuteUtc: 0,
    };
    const cycle = normalizeCycleStart(now, defaults);

    const host = await prisma.host.upsert({
      where: { userId_machineId: { userId: user.id, machineId } },
      create: {
        userId: user.id,
        name,
        hostname,
        machineId,
        lastBootId: bootId,
        agentKeyHash: hashSecret(agentKey),
        currentCycleId: cycle.id,
        currentCycleStartedAt: cycle.start,
        lastResetCycleId: cycle.id,
        lastSeenAt: now,
      },
      update: {
        name: name ?? undefined,
        hostname,
        lastBootId: bootId,
        agentKeyHash: hashSecret(agentKey),
        status: "ACTIVE",
        lastSeenAt: now,
      },
    });

    sendJson(res, {
      agentId: host.id,
      agentKey,
      pollIntervalSeconds: host.pollIntervalSeconds,
    });
  }),
);

router.post(
  "/report",
  requireAgent,
  asyncHandler(async (req, res) => {
    const result = await processAgentReport(req.agentHost!.id, req.body);
    sendJson(res, { ok: true, ...result });
  }),
);

export default router;
