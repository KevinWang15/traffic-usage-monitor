import { HostStatus, MeteringType, Prisma, ResetPeriod, type Host, type User } from "@prisma/client";
import { Router } from "express";
import prisma from "../prisma";
import { parseBytes, percentBasisPointsToPercent, percentToBasisPoints, remainingPercent } from "../lib/bytes";
import { validateResetConfig } from "../lib/cycles";
import { asyncHandler, clampInteger, HttpError, optionalBodyString, sendJson } from "../lib/http";
import { requireUser } from "../middleware/auth";
import { ensureResetForHost } from "../services/resetScheduler";

const router = Router();
router.use(requireUser);

function hostDto(host: Host, user: User) {
  const threshold = host.alertThresholdBasisPts ?? user.defaultAlertThresholdBasisPts;
  return {
    id: host.id,
    name: host.name,
    hostname: host.hostname,
    machineId: host.machineId,
    status: host.status,
    trafficAllowanceBytes: host.trafficAllowanceBytes,
    remainingBytes: host.remainingBytes,
    usedBytes: host.usedBytes,
    remainingPercent: remainingPercent(host.remainingBytes, host.trafficAllowanceBytes),
    meteringType: host.meteringType,
    resetPeriod: host.resetPeriod,
    resetDayOfMonth: host.resetDayOfMonth,
    resetDayOfWeek: host.resetDayOfWeek,
    resetMonth: host.resetMonth,
    resetHourUtc: host.resetHourUtc,
    resetMinuteUtc: host.resetMinuteUtc,
    currentCycleId: host.currentCycleId,
    currentCycleStartedAt: host.currentCycleStartedAt,
    lastSeenAt: host.lastSeenAt,
    lastReportAt: host.lastReportAt,
    alertThresholdPercent: percentBasisPointsToPercent(threshold),
    alertThresholdOverridePercent:
      host.alertThresholdBasisPts === null ? null : percentBasisPointsToPercent(host.alertThresholdBasisPts),
    pollIntervalSeconds: host.pollIntervalSeconds,
    createdAt: host.createdAt,
  };
}

async function requireOwnedHost(userId: string, hostId: string): Promise<Host> {
  const host = await prisma.host.findFirst({ where: { id: hostId, userId } });
  if (!host) {
    throw new HttpError(404, "Host not found");
  }
  return host;
}

function requireRouteParam(value: string | string[] | undefined, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} is required`);
  }
  return value;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const hosts = await prisma.host.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ status: "asc" }, { hostname: "asc" }],
    });

    await Promise.all(hosts.map((host) => ensureResetForHost(host)));
    const refreshed = await prisma.host.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ status: "asc" }, { hostname: "asc" }],
    });

    sendJson(res, { hosts: refreshed.map((host) => hostDto(host, req.user!)) });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const host = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const current = await ensureResetForHost(host);
    sendJson(res, { host: hostDto(current, req.user!) });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const current = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const data: Prisma.HostUpdateInput = {};
    const resetData: Record<string, number> = {};

    if (req.body.name !== undefined) {
      data.name = optionalBodyString(req.body.name) ?? null;
    }
    if (req.body.trafficAllowanceBytes !== undefined) {
      const newAllowance = parseBytes(req.body.trafficAllowanceBytes, "trafficAllowanceBytes");
      data.trafficAllowanceBytes = newAllowance;
      data.remainingBytes = newAllowance > current.usedBytes ? newAllowance - current.usedBytes : 0n;
    }
    if (req.body.meteringType !== undefined) {
      if (!Object.values(MeteringType).includes(req.body.meteringType)) {
        throw new HttpError(400, "meteringType is invalid");
      }
      data.meteringType = req.body.meteringType;
    }
    if (req.body.resetPeriod !== undefined) {
      if (!Object.values(ResetPeriod).includes(req.body.resetPeriod)) {
        throw new HttpError(400, "resetPeriod is invalid");
      }
      data.resetPeriod = req.body.resetPeriod;
    }
    if (req.body.resetDayOfMonth !== undefined) {
      const value = clampInteger(req.body.resetDayOfMonth, "resetDayOfMonth", 1, 31);
      data.resetDayOfMonth = value;
      resetData.resetDayOfMonth = value;
    }
    if (req.body.resetDayOfWeek !== undefined) {
      const value = clampInteger(req.body.resetDayOfWeek, "resetDayOfWeek", 0, 6);
      data.resetDayOfWeek = value;
      resetData.resetDayOfWeek = value;
    }
    if (req.body.resetMonth !== undefined) {
      const value = clampInteger(req.body.resetMonth, "resetMonth", 1, 12);
      data.resetMonth = value;
      resetData.resetMonth = value;
    }
    if (req.body.resetHourUtc !== undefined) {
      const value = clampInteger(req.body.resetHourUtc, "resetHourUtc", 0, 23);
      data.resetHourUtc = value;
      resetData.resetHourUtc = value;
    }
    if (req.body.resetMinuteUtc !== undefined) {
      const value = clampInteger(req.body.resetMinuteUtc, "resetMinuteUtc", 0, 59);
      data.resetMinuteUtc = value;
      resetData.resetMinuteUtc = value;
    }
    if (req.body.alertThresholdPercent !== undefined) {
      data.alertThresholdBasisPts =
        req.body.alertThresholdPercent === null
          ? null
          : percentToBasisPoints(req.body.alertThresholdPercent, "alertThresholdPercent");
    }
    if (req.body.pollIntervalSeconds !== undefined) {
      data.pollIntervalSeconds = clampInteger(req.body.pollIntervalSeconds, "pollIntervalSeconds", 10, 3600);
    }
    if (req.body.status !== undefined) {
      if (!["ACTIVE", "STALE", "DISABLED"].includes(req.body.status)) {
        throw new HttpError(400, "status is invalid");
      }
      data.status = req.body.status as HostStatus;
    }

    validateResetConfig(resetData);

    const host = await prisma.host.update({ where: { id: current.id }, data });
    sendJson(res, { host: hostDto(host, req.user!) });
  }),
);

router.post(
  "/:id/correct-remaining",
  asyncHandler(async (req, res) => {
    const current = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const newRemainingBytes = parseBytes(req.body.remainingBytes, "remainingBytes");
    const reason = typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null;

    const host = await prisma.$transaction(async (tx) => {
      await tx.remainingCorrection.create({
        data: {
          hostId: current.id,
          userId: req.user!.id,
          previousRemainingBytes: current.remainingBytes,
          newRemainingBytes,
          reason,
        },
      });
      return tx.host.update({
        where: { id: current.id },
        data: { remainingBytes: newRemainingBytes },
      });
    });

    sendJson(res, { host: hostDto(host, req.user!) });
  }),
);

router.get(
  "/:id/samples",
  asyncHandler(async (req, res) => {
    const host = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const samples = await prisma.trafficSample.findMany({
      where: { hostId: host.id },
      orderBy: { observedAt: "desc" },
      take: 200,
    });
    sendJson(res, { samples });
  }),
);

export default router;
