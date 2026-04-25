import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResetPeriod } from "@prisma/client";
import { normalizeCycleStart } from "../src/lib/cycles";

const baseConfig = {
  resetPeriod: ResetPeriod.MONTHLY,
  resetDayOfMonth: 1,
  resetDayOfWeek: 1,
  resetMonth: 1,
  resetHourUtc: 0,
  resetMinuteUtc: 0,
};

describe("normalizeCycleStart", () => {
  it("uses day of month for monthly resets and ignores week/month fields", () => {
    const cycle = normalizeCycleStart(new Date("2026-04-25T12:00:00.000Z"), {
      ...baseConfig,
      resetPeriod: ResetPeriod.MONTHLY,
      resetDayOfMonth: 24,
      resetDayOfWeek: 5,
      resetMonth: 12,
    });

    assert.equal(cycle.start.toISOString(), "2026-04-24T00:00:00.000Z");
  });

  it("uses the previous monthly boundary when this month's day has not arrived", () => {
    const cycle = normalizeCycleStart(new Date("2026-04-10T12:00:00.000Z"), {
      ...baseConfig,
      resetPeriod: ResetPeriod.MONTHLY,
      resetDayOfMonth: 24,
      resetDayOfWeek: 5,
      resetMonth: 12,
    });

    assert.equal(cycle.start.toISOString(), "2026-03-24T00:00:00.000Z");
  });

  it("uses month and day of month for yearly resets", () => {
    const cycle = normalizeCycleStart(new Date("2026-04-25T12:00:00.000Z"), {
      ...baseConfig,
      resetPeriod: ResetPeriod.YEARLY,
      resetMonth: 4,
      resetDayOfMonth: 24,
      resetDayOfWeek: 1,
    });

    assert.equal(cycle.start.toISOString(), "2026-04-24T00:00:00.000Z");
  });

  it("uses only day of week for weekly resets", () => {
    const cycle = normalizeCycleStart(new Date("2026-04-25T12:00:00.000Z"), {
      ...baseConfig,
      resetPeriod: ResetPeriod.WEEKLY,
      resetDayOfWeek: 5,
      resetDayOfMonth: 24,
      resetMonth: 12,
    });

    assert.equal(cycle.start.toISOString(), "2026-04-24T00:00:00.000Z");
  });

  it("uses only hour and minute for daily resets", () => {
    const cycle = normalizeCycleStart(new Date("2026-04-25T12:00:00.000Z"), {
      ...baseConfig,
      resetPeriod: ResetPeriod.DAILY,
      resetDayOfWeek: 5,
      resetDayOfMonth: 24,
      resetMonth: 12,
      resetHourUtc: 9,
      resetMinuteUtc: 30,
    });

    assert.equal(cycle.start.toISOString(), "2026-04-25T09:30:00.000Z");
  });
});
