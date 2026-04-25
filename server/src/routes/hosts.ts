import { HostStatus, MeteringType, Prisma, ResetPeriod, type Host, type TrafficSample, type User } from "@prisma/client";
import { Router } from "express";
import prisma from "../prisma";
import { parseBytes, percentBasisPointsToPercent, percentToBasisPoints, remainingPercent } from "../lib/bytes";
import { validateResetConfig } from "../lib/cycles";
import { remainingAfterHostUpdate } from "../lib/hostUpdate";
import { asyncHandler, clampInteger, HttpError, optionalBodyString, sendJson } from "../lib/http";
import { requireUser } from "../middleware/auth";
import { ensureResetForHost } from "../services/resetScheduler";

const router = Router();
router.use(requireUser);

type HostSampleMetrics = {
  recentRateMbps: number;
  trafficSpark: number[];
};

const EMPTY_SAMPLE_METRICS: HostSampleMetrics = {
  recentRateMbps: 0,
  trafficSpark: [],
};

function buildThroughputSeries(
  samples: Array<Pick<TrafficSample, "observedAt" | "meteredBytes">>,
  since: Date,
  until: Date,
  bucketCount: number,
): number[] {
  const bucketMs = (until.getTime() - since.getTime()) / bucketCount;
  const bucketSeconds = bucketMs / 1000;
  const buckets = Array(bucketCount).fill(0) as number[];

  for (const sample of samples) {
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((sample.observedAt.getTime() - since.getTime()) / bucketMs)),
    );
    buckets[bucketIndex] += Number(sample.meteredBytes);
  }

  return buckets.map((bytes) => (bytes * 8) / bucketSeconds / 1_000_000);
}

function hostDto(host: Host, user: User, sampleMetrics: HostSampleMetrics = EMPTY_SAMPLE_METRICS) {
  const threshold = host.alertThresholdBasisPts ?? user.defaultAlertThresholdBasisPts;
  return {
    id: host.id,
    name: host.name,
    notes: host.notes,
    hostname: host.hostname,
    machineId: host.machineId,
    publicIp: host.publicIp,
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
    recentRateMbps: sampleMetrics.recentRateMbps,
    trafficSpark: sampleMetrics.trafficSpark,
    alertThresholdPercent: percentBasisPointsToPercent(threshold),
    alertThresholdOverridePercent:
      host.alertThresholdBasisPts === null ? null : percentBasisPointsToPercent(host.alertThresholdBasisPts),
    pollIntervalSeconds: host.pollIntervalSeconds,
    createdAt: host.createdAt,
  };
}

async function buildSampleMetrics(hostIds: string[]): Promise<Map<string, HostSampleMetrics>> {
  const metrics = new Map<string, HostSampleMetrics>();
  if (hostIds.length === 0) {
    return metrics;
  }

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rateSince = new Date(now.getTime() - 5 * 60 * 1000);
  const bucketCount = 48;
  const bucketMs = (now.getTime() - since.getTime()) / bucketCount;

  const samples = await prisma.trafficSample.findMany({
    where: {
      hostId: { in: hostIds },
      observedAt: { gte: since },
    },
    orderBy: { observedAt: "asc" },
  });

  for (const hostId of hostIds) {
    metrics.set(hostId, { recentRateMbps: 0, trafficSpark: Array(bucketCount).fill(0) as number[] });
  }

  const recentBytesByHost = new Map<string, bigint>();
  for (const sample of samples) {
    const hostMetrics = metrics.get(sample.hostId);
    if (!hostMetrics) {
      continue;
    }

    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((sample.observedAt.getTime() - since.getTime()) / bucketMs)),
    );
    hostMetrics.trafficSpark[bucketIndex] += Number(sample.meteredBytes);

    if (sample.observedAt >= rateSince) {
      recentBytesByHost.set(sample.hostId, (recentBytesByHost.get(sample.hostId) ?? 0n) + sample.meteredBytes);
    }
  }

  for (const [hostId, recentBytes] of recentBytesByHost) {
    const hostMetrics = metrics.get(hostId);
    if (hostMetrics) {
      hostMetrics.recentRateMbps = Number(recentBytes) * 8 / 300 / 1_000_000;
    }
  }

  return metrics;
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
    const sampleMetrics = await buildSampleMetrics(refreshed.map((host) => host.id));

    sendJson(res, { hosts: refreshed.map((host) => hostDto(host, req.user!, sampleMetrics.get(host.id))) });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const host = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const current = await ensureResetForHost(host);
    const sampleMetrics = await buildSampleMetrics([current.id]);
    sendJson(res, { host: hostDto(current, req.user!, sampleMetrics.get(current.id)) });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const current = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const data: Prisma.HostUpdateInput = {};
    const resetData: Record<string, number> = {};
    let nextAllowance: bigint | undefined;
    let explicitRemainingBytes: bigint | undefined;
    let correctionReason: string | null = null;

    if (req.body.name !== undefined) {
      data.name = optionalBodyString(req.body.name) ?? null;
    }
    if (req.body.notes !== undefined) {
      data.notes = optionalBodyString(req.body.notes) ?? null;
    }
    if (req.body.trafficAllowanceBytes !== undefined) {
      const newAllowance = parseBytes(req.body.trafficAllowanceBytes, "trafficAllowanceBytes");
      nextAllowance = newAllowance;
      data.trafficAllowanceBytes = newAllowance;
    }
    if (req.body.remainingBytes !== undefined) {
      explicitRemainingBytes = parseBytes(req.body.remainingBytes, "remainingBytes");
      correctionReason = typeof req.body.remainingCorrectionReason === "string" && req.body.remainingCorrectionReason.trim()
        ? req.body.remainingCorrectionReason.trim()
        : null;
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

    const nextRemaining = remainingAfterHostUpdate(current, {
      trafficAllowanceBytes: nextAllowance,
      remainingBytes: explicitRemainingBytes,
    });
    if (nextRemaining !== undefined) {
      data.remainingBytes = nextRemaining;
    }

    const host = await prisma.$transaction(async (tx) => {
      if (explicitRemainingBytes !== undefined && explicitRemainingBytes !== current.remainingBytes) {
        await tx.remainingCorrection.create({
          data: {
            hostId: current.id,
            userId: req.user!.id,
            previousRemainingBytes: current.remainingBytes,
            newRemainingBytes: explicitRemainingBytes,
            reason: correctionReason,
          },
        });
      }
      return tx.host.update({ where: { id: current.id }, data });
    });
    const sampleMetrics = await buildSampleMetrics([host.id]);
    sendJson(res, { host: hostDto(host, req.user!, sampleMetrics.get(host.id)) });
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

    const sampleMetrics = await buildSampleMetrics([host.id]);
    sendJson(res, { host: hostDto(host, req.user!, sampleMetrics.get(host.id)) });
  }),
);

router.get(
  "/:id/samples",
  asyncHandler(async (req, res) => {
    const host = await requireOwnedHost(req.user!.id, requireRouteParam(req.params.id, "id"));
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const bucketCount = 96;
    const [samples, chartSamples] = await Promise.all([
      prisma.trafficSample.findMany({
        where: { hostId: host.id },
        orderBy: { observedAt: "desc" },
        take: 200,
      }),
      prisma.trafficSample.findMany({
        where: {
          hostId: host.id,
          observedAt: { gte: since },
        },
        select: {
          observedAt: true,
          meteredBytes: true,
        },
        orderBy: { observedAt: "asc" },
      }),
    ]);

    sendJson(res, { samples, throughputSeries: buildThroughputSeries(chartSamples, since, now, bucketCount) });
  }),
);

export default router;
