import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureResetForHost } from "../src/services/resetScheduler";

const JUNE_CYCLE_ID = "MONTHLY:2026-06-01T00:00:00.000Z";
const JULY_CYCLE_ID = "MONTHLY:2026-07-01T00:00:00.000Z";
const JULY_CYCLE_START = new Date("2026-07-01T00:00:00.000Z");
const NOW = new Date("2026-07-04T12:00:00.000Z");
type ResetStore = NonNullable<Parameters<typeof ensureResetForHost>[2]>;

function testHost(overrides: Record<string, unknown> = {}): Parameters<typeof ensureResetForHost>[0] {
  const now = new Date("2026-06-15T00:00:00.000Z");
  return {
    id: "host_1",
    userId: "user_1",
    name: null,
    notes: null,
    hostname: "node.localdomain",
    machineId: "machine_1",
    publicIp: null,
    countryCode: null,
    countryCodeOverride: null,
    lastBootId: null,
    agentKeyHash: "hash",
    status: "ACTIVE",
    trafficAllowanceBytes: 1_000n,
    remainingBytes: 100n,
    usedBytes: 900n,
    meteringType: "EGRESS_ONLY",
    resetPeriod: "MONTHLY",
    resetDayOfMonth: 1,
    resetDayOfWeek: 1,
    resetMonth: 1,
    resetHourUtc: 0,
    resetMinuteUtc: 0,
    currentCycleId: JUNE_CYCLE_ID,
    currentCycleStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    lastResetCycleId: JUNE_CYCLE_ID,
    alertThresholdBasisPts: null,
    lastAlertSentAt: null,
    lastAlertCycleId: null,
    trafficAlertSuppressedAt: null,
    trafficAlertSuppressedUntilUsedBytes: null,
    missingAlertSuppressedAt: null,
    pollIntervalSeconds: 60,
    lastSeenAt: now,
    lastReportAt: now,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as Parameters<typeof ensureResetForHost>[0];
}

describe("ensureResetForHost", () => {
  it("does not reset disabled hosts on read-driven reset checks", async () => {
    const disabled = testHost({ status: "DISABLED" });
    let transactionCalled = false;
    const store = {
      $transaction: async () => {
        transactionCalled = true;
        throw new Error("disabled hosts should not start a reset transaction");
      },
    } as unknown as ResetStore;

    assert.equal(await ensureResetForHost(disabled, NOW, store), disabled);
    assert.equal(transactionCalled, false);
  });

  it("does not overwrite traffic when another reset already claimed the stale cycle", async () => {
    const current = testHost();
    const refreshed = testHost({
      usedBytes: 42n,
      remainingBytes: 958n,
      currentCycleId: JULY_CYCLE_ID,
      currentCycleStartedAt: JULY_CYCLE_START,
      lastResetCycleId: JULY_CYCLE_ID,
    });
    let findUniqueCalls = 0;
    let updateManyArgs: unknown;
    let resetEventCalled = false;

    const tx = {
      host: {
        findUnique: async () => {
          findUniqueCalls += 1;
          return findUniqueCalls === 1 ? current : refreshed;
        },
        updateMany: async (args: unknown) => {
          updateManyArgs = args;
          return { count: 0 };
        },
      },
      resetEvent: {
        upsert: async () => {
          resetEventCalled = true;
        },
      },
    };

    const store = {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as ResetStore;

    const result = await ensureResetForHost(current, NOW, store);

    assert.equal(result.usedBytes, 42n);
    assert.equal(result.remainingBytes, 958n);
    assert.equal(resetEventCalled, false);
    assert.deepEqual(updateManyArgs, {
      where: {
        id: "host_1",
        status: { not: "DISABLED" },
        trafficAllowanceBytes: 1_000n,
        resetPeriod: "MONTHLY",
        resetDayOfMonth: 1,
        resetDayOfWeek: 1,
        resetMonth: 1,
        resetHourUtc: 0,
        resetMinuteUtc: 0,
        lastResetCycleId: JUNE_CYCLE_ID,
      },
      data: {
        usedBytes: 0n,
        remainingBytes: 1_000n,
        currentCycleId: JULY_CYCLE_ID,
        currentCycleStartedAt: JULY_CYCLE_START,
        lastResetCycleId: JULY_CYCLE_ID,
        lastAlertCycleId: null,
        trafficAlertSuppressedAt: null,
        trafficAlertSuppressedUntilUsedBytes: null,
      },
    });
  });

  it("does not reset when the host becomes disabled inside the reset transaction", async () => {
    const initial = testHost();
    const disabled = testHost({ status: "DISABLED" });
    let updateManyCalled = false;

    const tx = {
      host: {
        findUnique: async () => disabled,
        updateMany: async () => {
          updateManyCalled = true;
          return { count: 1 };
        },
      },
      resetEvent: {
        upsert: async () => undefined,
      },
    };

    const store = {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as ResetStore;

    const result = await ensureResetForHost(initial, NOW, store);

    assert.equal(result.status, "DISABLED");
    assert.equal(updateManyCalled, false);
  });

  it("records one reset event when the guarded reset update wins", async () => {
    const current = testHost();
    const updated = testHost({
      usedBytes: 0n,
      remainingBytes: 1_000n,
      currentCycleId: JULY_CYCLE_ID,
      currentCycleStartedAt: JULY_CYCLE_START,
      lastResetCycleId: JULY_CYCLE_ID,
    });
    let findUniqueCalls = 0;
    let resetEventArgs: unknown;

    const tx = {
      host: {
        findUnique: async () => {
          findUniqueCalls += 1;
          return findUniqueCalls === 1 ? current : updated;
        },
        updateMany: async () => ({ count: 1 }),
      },
      resetEvent: {
        upsert: async (args: unknown) => {
          resetEventArgs = args;
        },
      },
    };

    const store = {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as ResetStore;

    const result = await ensureResetForHost(current, NOW, store);

    assert.equal(result.usedBytes, 0n);
    assert.equal(result.remainingBytes, 1_000n);
    assert.deepEqual(resetEventArgs, {
      where: { hostId_cycleId: { hostId: "host_1", cycleId: JULY_CYCLE_ID } },
      create: {
        hostId: "host_1",
        cycleId: JULY_CYCLE_ID,
        cycleStartedAt: JULY_CYCLE_START,
        previousUsedBytes: 900n,
        previousRemainingBytes: 100n,
        allowanceBytes: 1_000n,
      },
      update: {},
    });
  });
});
