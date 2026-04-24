import type { Host } from "@prisma/client";
import prisma from "../prisma";
import { normalizeCycleStart } from "../lib/cycles";

export async function ensureResetForHost(host: Host, now = new Date()): Promise<Host> {
  const cycle = normalizeCycleStart(now, host);
  if (host.lastResetCycleId === cycle.id) {
    return host;
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.host.findUnique({ where: { id: host.id } });
    if (!current) {
      throw new Error(`Host ${host.id} disappeared before reset`);
    }

    const currentCycle = normalizeCycleStart(now, current);
    if (current.lastResetCycleId === currentCycle.id) {
      return current;
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

    return tx.host.update({
      where: { id: current.id },
      data: {
        usedBytes: 0n,
        remainingBytes: current.trafficAllowanceBytes,
        currentCycleId: currentCycle.id,
        currentCycleStartedAt: currentCycle.start,
        lastResetCycleId: currentCycle.id,
        lastAlertCycleId: null,
      },
    });
  });
}

export async function runResetSweep(now = new Date()): Promise<void> {
  let cursor: string | undefined;

  while (true) {
    const hosts = await prisma.host.findMany({
      where: { status: { not: "DISABLED" } },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (hosts.length === 0) {
      return;
    }

    for (const host of hosts) {
      try {
        await ensureResetForHost(host, now);
      } catch (error) {
        console.error(`Reset check failed for host ${host.id}`, error);
      }
    }

    cursor = hosts[hosts.length - 1].id;
  }
}

export function startResetScheduler(): NodeJS.Timeout {
  void runResetSweep();
  const timer = setInterval(() => {
    void runResetSweep();
  }, 60 * 1000);
  return timer;
}
