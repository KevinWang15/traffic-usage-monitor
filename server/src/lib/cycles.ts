import { ResetPeriod, type Host } from "@prisma/client";
import { HttpError } from "./http";

export type CycleResult = {
  id: string;
  start: Date;
};

type CycleConfig = Pick<
  Host,
  "resetPeriod" | "resetDayOfMonth" | "resetDayOfWeek" | "resetMonth" | "resetHourUtc" | "resetMinuteUtc"
>;

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

function atUtc(
  year: number,
  monthZeroBased: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, monthZeroBased, day, hour, minute, 0, 0));
}

function clampDay(year: number, monthZeroBased: number, requestedDay: number): number {
  return Math.min(Math.max(requestedDay, 1), daysInMonth(year, monthZeroBased));
}

function previousMonth(year: number, monthZeroBased: number): { year: number; month: number } {
  if (monthZeroBased === 0) {
    return { year: year - 1, month: 11 };
  }
  return { year, month: monthZeroBased - 1 };
}

function normalizeDaily(now: Date, config: CycleConfig): Date {
  let start = atUtc(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    config.resetHourUtc,
    config.resetMinuteUtc,
  );
  if (now < start) {
    start = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  }
  return start;
}

function normalizeWeekly(now: Date, config: CycleConfig): Date {
  const resetDayOfWeek = ((config.resetDayOfWeek % 7) + 7) % 7;
  const currentDayOfWeek = now.getUTCDay();
  const diffDays = (currentDayOfWeek - resetDayOfWeek + 7) % 7;
  let start = atUtc(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - diffDays,
    config.resetHourUtc,
    config.resetMinuteUtc,
  );
  if (now < start) {
    start = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return start;
}

function normalizeMonthly(now: Date, config: CycleConfig): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = clampDay(year, month, config.resetDayOfMonth);
  let start = atUtc(year, month, day, config.resetHourUtc, config.resetMinuteUtc);
  if (now < start) {
    const previous = previousMonth(year, month);
    start = atUtc(
      previous.year,
      previous.month,
      clampDay(previous.year, previous.month, config.resetDayOfMonth),
      config.resetHourUtc,
      config.resetMinuteUtc,
    );
  }
  return start;
}

function normalizeYearly(now: Date, config: CycleConfig): Date {
  const resetMonth = Math.min(Math.max(config.resetMonth, 1), 12) - 1;
  const year = now.getUTCFullYear();
  const day = clampDay(year, resetMonth, config.resetDayOfMonth);
  let start = atUtc(year, resetMonth, day, config.resetHourUtc, config.resetMinuteUtc);
  if (now < start) {
    const previousYear = year - 1;
    start = atUtc(
      previousYear,
      resetMonth,
      clampDay(previousYear, resetMonth, config.resetDayOfMonth),
      config.resetHourUtc,
      config.resetMinuteUtc,
    );
  }
  return start;
}

export function normalizeCycleStart(now: Date, config: CycleConfig): CycleResult {
  let start: Date;
  if (config.resetPeriod === ResetPeriod.DAILY) {
    start = normalizeDaily(now, config);
  } else if (config.resetPeriod === ResetPeriod.WEEKLY) {
    start = normalizeWeekly(now, config);
  } else if (config.resetPeriod === ResetPeriod.MONTHLY) {
    start = normalizeMonthly(now, config);
  } else if (config.resetPeriod === ResetPeriod.YEARLY) {
    start = normalizeYearly(now, config);
  } else {
    throw new HttpError(400, "Unsupported reset period");
  }

  return {
    id: `${config.resetPeriod}:${start.toISOString()}`,
    start,
  };
}

export function validateResetConfig(data: Partial<CycleConfig>): void {
  if (data.resetDayOfMonth !== undefined && (data.resetDayOfMonth < 1 || data.resetDayOfMonth > 31)) {
    throw new HttpError(400, "resetDayOfMonth must be between 1 and 31");
  }
  if (data.resetDayOfWeek !== undefined && (data.resetDayOfWeek < 0 || data.resetDayOfWeek > 6)) {
    throw new HttpError(400, "resetDayOfWeek must be between 0 and 6, where 0 is Sunday");
  }
  if (data.resetMonth !== undefined && (data.resetMonth < 1 || data.resetMonth > 12)) {
    throw new HttpError(400, "resetMonth must be between 1 and 12");
  }
  if (data.resetHourUtc !== undefined && (data.resetHourUtc < 0 || data.resetHourUtc > 23)) {
    throw new HttpError(400, "resetHourUtc must be between 0 and 23");
  }
  if (data.resetMinuteUtc !== undefined && (data.resetMinuteUtc < 0 || data.resetMinuteUtc > 59)) {
    throw new HttpError(400, "resetMinuteUtc must be between 0 and 59");
  }
}
