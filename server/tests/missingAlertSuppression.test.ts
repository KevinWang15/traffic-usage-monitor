import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maybeSendMissingHostAlert } from "../src/services/alerts";

describe("missing alert suppression", () => {
  it("returns before database or email work when missing-node alerts are muted", async () => {
    const now = new Date("2026-06-09T00:00:00.000Z");
    const host = {
      id: "host_1",
      userId: "user_1",
      name: "muted host",
      notes: null,
      hostname: "muted.localdomain",
      machineId: "machine_1",
      publicIp: null,
      countryCode: null,
      countryCodeOverride: null,
      lastBootId: null,
      agentKeyHash: "hash",
      status: "STALE",
      trafficAllowanceBytes: 1000n,
      remainingBytes: 1000n,
      usedBytes: 0n,
      meteringType: "EGRESS_ONLY",
      resetPeriod: "MONTHLY",
      resetDayOfMonth: 1,
      resetDayOfWeek: 1,
      resetMonth: 1,
      resetHourUtc: 0,
      resetMinuteUtc: 0,
      currentCycleId: "2026-06",
      currentCycleStartedAt: now,
      lastResetCycleId: "2026-06",
      alertThresholdBasisPts: null,
      lastAlertSentAt: null,
      lastAlertCycleId: null,
      trafficAlertSuppressedAt: null,
      trafficAlertSuppressedUntilUsedBytes: null,
      missingAlertSuppressedAt: now,
      pollIntervalSeconds: 60,
      lastSeenAt: now,
      lastReportAt: now,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      user: {
        id: "user_1",
        email: "user@example.com",
        name: "Test User",
        emailVerifiedAt: null,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordHash: "hash",
        joinToken: "join",
        defaultAlertThresholdBasisPts: 1000,
        createdAt: now,
        updatedAt: now,
      },
    } as unknown as Parameters<typeof maybeSendMissingHostAlert>[0];

    await assert.doesNotReject(() => maybeSendMissingHostAlert(host, now));
  });
});
