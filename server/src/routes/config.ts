import { HostStatus, MeteringType, Prisma, ResetPeriod } from "@prisma/client";
import { Router } from "express";
import prisma from "../prisma";
import { asyncHandler, HttpError, sendJson } from "../lib/http";
import { requireUser } from "../middleware/auth";

const router = Router();
router.use(requireUser);

const EXPORT_VERSION = 1;
const EXPORT_APP = "traffic-usage-monitor";

const HOST_STATUSES: ReadonlyArray<HostStatus> = ["ACTIVE", "STALE", "DISABLED"];
const METERING_TYPES: ReadonlyArray<MeteringType> = ["EGRESS_ONLY", "INGRESS_AND_EGRESS"];
const RESET_PERIODS: ReadonlyArray<ResetPeriod> = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

class ConfigImportValidationError extends Error {}

type ImportedHost = {
  id: string;
  name: string | null;
  notes: string | null;
  hostname: string;
  machineId: string | null;
  publicIp: string | null;
  countryCode: string | null;
  countryCodeOverride: string | null;
  agentKeyHash: string;
  status: HostStatus;
  trafficAllowanceBytes: bigint;
  remainingBytes: bigint;
  usedBytes: bigint;
  meteringType: MeteringType;
  resetPeriod: ResetPeriod;
  resetDayOfMonth: number;
  resetDayOfWeek: number;
  resetMonth: number;
  resetHourUtc: number;
  resetMinuteUtc: number;
  currentCycleId: string | null;
  currentCycleStartedAt: Date | null;
  lastResetCycleId: string | null;
  alertThresholdBasisPts: number | null;
  trafficAlertSuppressedAt: Date | null;
  trafficAlertSuppressedUntilUsedBytes: bigint | null;
  missingAlertSuppressedAt: Date | null;
  pollIntervalSeconds: number;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  lastReportAt: Date | null;
};

function fail(message: string): never {
  throw new ConfigImportValidationError(message);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function asStringOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    fail(`${field} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNonNegativeBigInt(value: unknown, field: string): bigint {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  fail(`${field} must be a non-negative integer byte value`);
}

function asNonNegativeBigIntOrNull(value: unknown, field: string): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asNonNegativeBigInt(value, field);
}

function asInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function asIntegerOrNull(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asInteger(value, field, min, max);
}

function asDateOrNull(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    fail(`${field} must be an ISO date string or null`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail(`${field} must be a valid ISO date string`);
  }
  return date;
}

function asEnum<T extends string>(value: unknown, allowed: ReadonlyArray<T>, field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseHost(entry: unknown): ImportedHost {
  if (!entry || typeof entry !== "object") {
    fail("Each host must be an object");
  }
  const h = entry as Record<string, unknown>;

  return {
    id: asString(h.id, "host.id"),
    name: asStringOrNull(h.name, "host.name"),
    notes: asStringOrNull(h.notes, "host.notes"),
    hostname: asString(h.hostname, "host.hostname"),
    machineId: asStringOrNull(h.machineId, "host.machineId"),
    publicIp: asStringOrNull(h.publicIp, "host.publicIp"),
    countryCode: asStringOrNull(h.countryCode, "host.countryCode"),
    countryCodeOverride: asStringOrNull(h.countryCodeOverride, "host.countryCodeOverride"),
    agentKeyHash: asString(h.agentKeyHash, "host.agentKeyHash"),
    status: asEnum(h.status, HOST_STATUSES, "host.status"),
    trafficAllowanceBytes: asNonNegativeBigInt(h.trafficAllowanceBytes, "host.trafficAllowanceBytes"),
    remainingBytes: asNonNegativeBigInt(h.remainingBytes, "host.remainingBytes"),
    usedBytes: asNonNegativeBigInt(h.usedBytes, "host.usedBytes"),
    meteringType: asEnum(h.meteringType, METERING_TYPES, "host.meteringType"),
    resetPeriod: asEnum(h.resetPeriod, RESET_PERIODS, "host.resetPeriod"),
    resetDayOfMonth: asInteger(h.resetDayOfMonth, "host.resetDayOfMonth", 1, 31),
    resetDayOfWeek: asInteger(h.resetDayOfWeek, "host.resetDayOfWeek", 0, 6),
    resetMonth: asInteger(h.resetMonth, "host.resetMonth", 1, 12),
    resetHourUtc: asInteger(h.resetHourUtc, "host.resetHourUtc", 0, 23),
    resetMinuteUtc: asInteger(h.resetMinuteUtc, "host.resetMinuteUtc", 0, 59),
    currentCycleId: asStringOrNull(h.currentCycleId, "host.currentCycleId"),
    currentCycleStartedAt: asDateOrNull(h.currentCycleStartedAt, "host.currentCycleStartedAt"),
    lastResetCycleId: asStringOrNull(h.lastResetCycleId, "host.lastResetCycleId"),
    alertThresholdBasisPts: asIntegerOrNull(h.alertThresholdBasisPts, "host.alertThresholdBasisPts", 0, 10000),
    trafficAlertSuppressedAt: asDateOrNull(h.trafficAlertSuppressedAt, "host.trafficAlertSuppressedAt"),
    trafficAlertSuppressedUntilUsedBytes: asNonNegativeBigIntOrNull(
      h.trafficAlertSuppressedUntilUsedBytes,
      "host.trafficAlertSuppressedUntilUsedBytes",
    ),
    missingAlertSuppressedAt: asDateOrNull(h.missingAlertSuppressedAt, "host.missingAlertSuppressedAt"),
    pollIntervalSeconds: asInteger(h.pollIntervalSeconds, "host.pollIntervalSeconds", 10, 3600),
    joinedAt: asDateOrNull(h.joinedAt, "host.joinedAt"),
    lastSeenAt: asDateOrNull(h.lastSeenAt, "host.lastSeenAt"),
    lastReportAt: asDateOrNull(h.lastReportAt, "host.lastReportAt"),
  };
}

type ImportPayload = {
  name?: string;
  joinToken?: string;
  defaultAlertThresholdBasisPts?: number;
  hosts: ImportedHost[];
};

function parseImportPayload(payload: unknown): ImportPayload {
  if (!payload || typeof payload !== "object") {
    fail("Import payload must be a JSON object");
  }
  const p = payload as Record<string, unknown>;

  if (p.version !== EXPORT_VERSION) {
    fail(`Unsupported export version: ${String(p.version ?? "missing")}`);
  }
  if (p.app !== EXPORT_APP) {
    fail("Invalid export file");
  }

  const userPayload = p.user;
  if (!userPayload || typeof userPayload !== "object") {
    fail("Import payload must include a user object");
  }
  const u = userPayload as Record<string, unknown>;

  const name = u.name === undefined ? undefined : asString(u.name, "user.name");
  const joinToken = u.joinToken === undefined ? undefined : asString(u.joinToken, "user.joinToken");
  const defaultAlertThresholdBasisPts =
    u.defaultAlertThresholdBasisPts === undefined
      ? undefined
      : asInteger(u.defaultAlertThresholdBasisPts, "user.defaultAlertThresholdBasisPts", 0, 10000);

  const hosts = p.hosts;
  if (!Array.isArray(hosts)) {
    fail("Import file must contain a hosts array");
  }

  const parsedHosts: ImportedHost[] = [];
  const seenIds = new Set<string>();
  const seenMachineIds = new Set<string>();
  for (const entry of hosts) {
    const host = parseHost(entry);
    if (seenIds.has(host.id)) {
      fail(`Duplicate host id in import: ${host.id}`);
    }
    seenIds.add(host.id);
    if (host.machineId) {
      if (seenMachineIds.has(host.machineId)) {
        fail(`Duplicate machineId in import: ${host.machineId}`);
      }
      seenMachineIds.add(host.machineId);
    }
    parsedHosts.push(host);
  }

  return { name, joinToken, defaultAlertThresholdBasisPts, hosts: parsedHosts };
}

router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        email: true,
        name: true,
        joinToken: true,
        defaultAlertThresholdBasisPts: true,
        hosts: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            notes: true,
            hostname: true,
            machineId: true,
            publicIp: true,
            countryCode: true,
            countryCodeOverride: true,
            agentKeyHash: true,
            status: true,
            trafficAllowanceBytes: true,
            remainingBytes: true,
            usedBytes: true,
            meteringType: true,
            resetPeriod: true,
            resetDayOfMonth: true,
            resetDayOfWeek: true,
            resetMonth: true,
            resetHourUtc: true,
            resetMinuteUtc: true,
            currentCycleId: true,
            currentCycleStartedAt: true,
            lastResetCycleId: true,
            alertThresholdBasisPts: true,
            trafficAlertSuppressedAt: true,
            trafficAlertSuppressedUntilUsedBytes: true,
            missingAlertSuppressedAt: true,
            pollIntervalSeconds: true,
            joinedAt: true,
            lastSeenAt: true,
            lastReportAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    sendJson(res, {
      version: EXPORT_VERSION,
      app: EXPORT_APP,
      exportedAt: new Date().toISOString(),
      user: {
        email: user.email,
        name: user.name,
        joinToken: user.joinToken,
        defaultAlertThresholdBasisPts: user.defaultAlertThresholdBasisPts,
      },
      hosts: user.hosts,
    });
  }),
);

router.post(
  "/import",
  asyncHandler(async (req, res) => {
    let parsed: ImportPayload;
    try {
      parsed = parseImportPayload(req.body);
    } catch (err) {
      if (err instanceof ConfigImportValidationError) {
        throw new HttpError(400, err.message);
      }
      throw err;
    }

    const userId = req.user!.id;
    const importedIds = parsed.hosts.map((host) => host.id);

    if (importedIds.length > 0) {
      const conflicts = await prisma.host.findMany({
        where: { id: { in: importedIds }, userId: { not: userId } },
        select: { id: true },
      });
      if (conflicts.length > 0) {
        throw new HttpError(
          409,
          `Host ids in import already belong to another account: ${conflicts.map((c) => c.id).join(", ")}`,
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      const userUpdate: Prisma.UserUpdateInput = {};
      if (parsed.name !== undefined) {
        userUpdate.name = parsed.name;
      }
      if (parsed.joinToken !== undefined) {
        userUpdate.joinToken = parsed.joinToken;
      }
      if (parsed.defaultAlertThresholdBasisPts !== undefined) {
        userUpdate.defaultAlertThresholdBasisPts = parsed.defaultAlertThresholdBasisPts;
      }
      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userUpdate });
      }

      await tx.host.deleteMany({
        where: {
          userId,
          ...(importedIds.length > 0 ? { id: { notIn: importedIds } } : {}),
        },
      });

      for (const host of parsed.hosts) {
        const shared = {
          name: host.name,
          notes: host.notes,
          hostname: host.hostname,
          machineId: host.machineId,
          publicIp: host.publicIp,
          countryCode: host.countryCode,
          countryCodeOverride: host.countryCodeOverride,
          agentKeyHash: host.agentKeyHash,
          status: host.status,
          trafficAllowanceBytes: host.trafficAllowanceBytes,
          remainingBytes: host.remainingBytes,
          usedBytes: host.usedBytes,
          meteringType: host.meteringType,
          resetPeriod: host.resetPeriod,
          resetDayOfMonth: host.resetDayOfMonth,
          resetDayOfWeek: host.resetDayOfWeek,
          resetMonth: host.resetMonth,
          resetHourUtc: host.resetHourUtc,
          resetMinuteUtc: host.resetMinuteUtc,
          currentCycleId: host.currentCycleId,
          currentCycleStartedAt: host.currentCycleStartedAt,
          lastResetCycleId: host.lastResetCycleId,
          alertThresholdBasisPts: host.alertThresholdBasisPts,
          trafficAlertSuppressedAt: host.trafficAlertSuppressedAt,
          trafficAlertSuppressedUntilUsedBytes: host.trafficAlertSuppressedUntilUsedBytes,
          missingAlertSuppressedAt: host.missingAlertSuppressedAt,
          pollIntervalSeconds: host.pollIntervalSeconds,
          lastSeenAt: host.lastSeenAt,
          lastReportAt: host.lastReportAt,
          ...(host.joinedAt ? { joinedAt: host.joinedAt } : {}),
        };

        await tx.host.upsert({
          where: { id: host.id },
          create: { id: host.id, user: { connect: { id: userId } }, ...shared },
          update: shared,
        });
      }
    });

    sendJson(res, {
      ok: true,
      importedHosts: parsed.hosts.length,
      message: `Restored ${parsed.hosts.length} host configuration${parsed.hosts.length === 1 ? "" : "s"}.`,
    });
  }),
);

export default router;
