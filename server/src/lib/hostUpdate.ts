import { ResetPeriod } from "@prisma/client";
import { normalizeCycleStart } from "./cycles";

export type AllowanceState = {
  trafficAllowanceBytes: bigint;
  usedBytes: bigint;
  remainingBytes: bigint;
};

export type ResetScheduleState = {
  resetPeriod: ResetPeriod;
  resetDayOfMonth: number;
  resetDayOfWeek: number;
  resetMonth: number;
  resetHourUtc: number;
  resetMinuteUtc: number;
};

export type CycleAlignment = {
  currentCycleId: string;
  currentCycleStartedAt: Date;
  lastResetCycleId: string;
};

export function remainingAfterAllowanceUpdate(current: AllowanceState, nextAllowance: bigint): bigint {
  if (nextAllowance === current.trafficAllowanceBytes) {
    return current.remainingBytes;
  }
  return nextAllowance > current.usedBytes ? nextAllowance - current.usedBytes : 0n;
}

export function remainingAfterHostUpdate(
  current: AllowanceState,
  update: { trafficAllowanceBytes?: bigint; remainingBytes?: bigint },
): bigint | undefined {
  if (update.remainingBytes !== undefined) {
    return update.remainingBytes;
  }
  if (update.trafficAllowanceBytes !== undefined) {
    return remainingAfterAllowanceUpdate(current, update.trafficAllowanceBytes);
  }
  return undefined;
}

export function cycleAlignmentAfterResetScheduleUpdate(
  current: ResetScheduleState,
  update: Partial<ResetScheduleState>,
  now = new Date(),
): CycleAlignment | undefined {
  const next = {
    ...current,
    ...update,
  };
  const changed = Object.entries(update).some(([key, value]) => {
    return value !== current[key as keyof ResetScheduleState];
  });

  if (!changed) {
    return undefined;
  }

  const cycle = normalizeCycleStart(now, next);
  return {
    currentCycleId: cycle.id,
    currentCycleStartedAt: cycle.start,
    lastResetCycleId: cycle.id,
  };
}
