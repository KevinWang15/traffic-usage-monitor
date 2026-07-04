import type { Host } from "@prisma/client";
import axios from "axios";
import { env } from "../config";
import prisma from "../prisma";
import { normalizeCycleStart } from "../lib/cycles";
import { maybeSendMissingHostAlert } from "./alerts";

async function pingHealthcheck(): Promise<void> {
  const pingUrl = process.env.HEALTHCHECKS_PING_URL;
  if (!pingUrl) {
    return;
  }

  try {
    await axios.get(pingUrl, { timeout: 10000 });
    console.log("Healthcheck ping sent successfully");
  } catch (error) {
    console.error("Healthcheck ping failed", error);
  }
}

type ResetStore = Pick<typeof prisma, "$transaction">;

export async function ensureResetForHost(host: Host, now = new Date(), store: ResetStore = prisma): Promise<Host> {
  if (host.status === "DISABLED") {
    return host;
  }

  const cycle = normalizeCycleStart(now, host);
  if (host.lastResetCycleId === cycle.id) {
    return host;
  }

  return store.$transaction(async (tx) => {
    const current = await tx.host.findUnique({ where: { id: host.id } });
    if (!current) {
      throw new Error(`Host ${host.id} disappeared before reset`);
    }
    if (current.status === "DISABLED") {
      return current;
    }

    const currentCycle = normalizeCycleStart(now, current);
    if (current.lastResetCycleId === currentCycle.id) {
      return current;
    }

    const reset = await tx.host.updateMany({
      where: {
        id: current.id,
        status: { not: "DISABLED" },
        trafficAllowanceBytes: current.trafficAllowanceBytes,
        resetPeriod: current.resetPeriod,
        resetDayOfMonth: current.resetDayOfMonth,
        resetDayOfWeek: current.resetDayOfWeek,
        resetMonth: current.resetMonth,
        resetHourUtc: current.resetHourUtc,
        resetMinuteUtc: current.resetMinuteUtc,
        lastResetCycleId: current.lastResetCycleId,
      },
      data: {
        usedBytes: 0n,
        remainingBytes: current.trafficAllowanceBytes,
        currentCycleId: currentCycle.id,
        currentCycleStartedAt: currentCycle.start,
        lastResetCycleId: currentCycle.id,
        lastAlertCycleId: null,
        trafficAlertSuppressedAt: null,
        trafficAlertSuppressedUntilUsedBytes: null,
      },
    });

    if (reset.count === 0) {
      const refreshed = await tx.host.findUnique({ where: { id: current.id } });
      if (!refreshed) {
        throw new Error(`Host ${host.id} disappeared before reset`);
      }
      return refreshed;
    }

    await tx.resetEvent.upsert({
      where: { hostId_cycleId: { hostId: current.id, cycleId: currentCycle.id } },
      create: {
        hostId: current.id,
        cycleId: currentCycle.id,
        cycleStartedAt: currentCycle.start,
        previousUsedBytes: current.usedBytes,
        previousRemainingBytes: current.remainingBytes,
        allowanceBytes: current.trafficAllowanceBytes,
      },
      update: {},
    });

    const updated = await tx.host.findUnique({ where: { id: current.id } });
    if (!updated) {
      throw new Error(`Host ${host.id} disappeared before reset`);
    }
    return updated;
  });
}

export async function runResetSweep(now = new Date()): Promise<void> {
  let cursor: string | undefined;
  const missingCutoff = new Date(now.getTime() - env.missingNodeGraceMinutes * 60 * 1000);

  while (true) {
    const hosts = await prisma.host.findMany({
      where: { status: { not: "DISABLED" } },
      include: { user: true },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (hosts.length === 0) {
      break;
    }

    for (const host of hosts) {
      try {
        await ensureResetForHost(host, now);
        const lastContactAt = host.lastSeenAt ?? host.lastReportAt ?? host.joinedAt ?? host.createdAt;
        if (lastContactAt < missingCutoff) {
          if (host.status !== "STALE") {
            await prisma.host.update({
              where: { id: host.id },
              data: { status: "STALE" },
            });
          }
          await maybeSendMissingHostAlert(host, now);
        }
      } catch (error) {
        console.error(`Reset check failed for host ${host.id}`, error);
      }
    }

    cursor = hosts[hosts.length - 1].id;
  }

  await pingHealthcheck();
}

export function startResetScheduler(): NodeJS.Timeout {
  void runResetSweep();
  const timer = setInterval(() => {
    void runResetSweep();
  }, 60 * 1000);
  return timer;
}
