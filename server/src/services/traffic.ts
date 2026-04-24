import type { HostInterfaceState } from "@prisma/client";
import prisma from "../prisma";
import { parseBytes } from "../lib/bytes";
import { HttpError } from "../lib/http";
import { maybeSendTrafficAlert } from "./alerts";
import { ensureResetForHost } from "./resetScheduler";

type AgentInterfacePayload = {
  name: unknown;
  rxBytes: unknown;
  txBytes: unknown;
};

type AgentReportPayload = {
  observedAt?: unknown;
  host?: {
    hostname?: unknown;
    machineId?: unknown;
    bootId?: unknown;
  };
  interfaces?: unknown;
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function counterDelta(current: bigint, previous: bigint, bootChanged: boolean, isFirstSample: boolean): bigint {
  if (isFirstSample) {
    return 0n;
  }
  if (bootChanged) {
    return current;
  }
  if (current >= previous) {
    return current - previous;
  }
  // Counter rollover or interface reset. Count the current value since reset instead of dropping it.
  return current;
}

function parseObservedAt(value: unknown): Date {
  if (typeof value !== "string") {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function processAgentReport(hostId: string, payload: AgentReportPayload) {
  const initialHost = await prisma.host.findUnique({ where: { id: hostId } });
  if (!initialHost) {
    throw new HttpError(404, "Host not found");
  }

  await ensureResetForHost(initialHost);

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    include: { interfaceStates: true, user: true },
  });
  if (!host) {
    throw new HttpError(404, "Host not found");
  }

  if (!Array.isArray(payload.interfaces)) {
    throw new HttpError(400, "interfaces must be an array");
  }

  const observedAt = parseObservedAt(payload.observedAt);
  const hostname = stringOrNull(payload.host?.hostname) || host.hostname;
  const machineId = stringOrNull(payload.host?.machineId) || host.machineId;
  const bootId = stringOrNull(payload.host?.bootId);
  const bootChanged = Boolean(bootId && host.lastBootId && bootId !== host.lastBootId);
  const statesByName = new Map<string, HostInterfaceState>();
  for (const state of host.interfaceStates) {
    statesByName.set(state.name, state);
  }

  const sampleInputs = (payload.interfaces as AgentInterfacePayload[]).map((item) => {
    const interfaceName = stringOrNull(item.name);
    if (!interfaceName || interfaceName.length > 64 || interfaceName.includes("/")) {
      throw new HttpError(400, "interface name is invalid");
    }
    const rxBytes = parseBytes(item.rxBytes, `${interfaceName}.rxBytes`);
    const txBytes = parseBytes(item.txBytes, `${interfaceName}.txBytes`);
    const previous = statesByName.get(interfaceName);
    const isFirstSample = !previous;
    const deltaRxBytes = counterDelta(rxBytes, previous?.lastRxBytes ?? 0n, bootChanged, isFirstSample);
    const deltaTxBytes = counterDelta(txBytes, previous?.lastTxBytes ?? 0n, bootChanged, isFirstSample);
    const meteredBytes = host.meteringType === "INGRESS_AND_EGRESS" ? deltaRxBytes + deltaTxBytes : deltaTxBytes;

    return {
      interfaceName,
      rxBytes,
      txBytes,
      deltaRxBytes,
      deltaTxBytes,
      meteredBytes,
    };
  });

  const totalMeteredBytes = sampleInputs.reduce((sum, sample) => sum + sample.meteredBytes, 0n);

  await prisma.$transaction(async (tx) => {
    for (const sample of sampleInputs) {
      await tx.hostInterfaceState.upsert({
        where: { hostId_name: { hostId, name: sample.interfaceName } },
        create: {
          hostId,
          name: sample.interfaceName,
          lastRxBytes: sample.rxBytes,
          lastTxBytes: sample.txBytes,
          lastObservedAt: observedAt,
        },
        update: {
          lastRxBytes: sample.rxBytes,
          lastTxBytes: sample.txBytes,
          lastObservedAt: observedAt,
        },
      });

      await tx.trafficSample.create({
        data: {
          hostId,
          interface: sample.interfaceName,
          rxBytes: sample.rxBytes,
          txBytes: sample.txBytes,
          deltaRxBytes: sample.deltaRxBytes,
          deltaTxBytes: sample.deltaTxBytes,
          meteredBytes: sample.meteredBytes,
          observedAt,
        },
      });
    }

    const current = await tx.host.findUnique({ where: { id: hostId } });
    if (!current) {
      throw new Error(`Host ${hostId} disappeared while processing traffic report`);
    }
    const nextRemaining = current.remainingBytes > totalMeteredBytes ? current.remainingBytes - totalMeteredBytes : 0n;

    await tx.host.update({
      where: { id: hostId },
      data: {
        hostname,
        machineId,
        lastBootId: bootId || current.lastBootId,
        usedBytes: { increment: totalMeteredBytes },
        remainingBytes: nextRemaining,
        lastSeenAt: new Date(),
        lastReportAt: observedAt,
        status: "ACTIVE",
      },
    });
  });

  const updatedHost = await prisma.host.findUnique({
    where: { id: hostId },
    include: { user: true },
  });
  if (updatedHost) {
    await maybeSendTrafficAlert(updatedHost);
  }

  return {
    meteredBytes: totalMeteredBytes,
    interfaceCount: sampleInputs.length,
    pollIntervalSeconds: updatedHost?.pollIntervalSeconds ?? host.pollIntervalSeconds,
  };
}
