import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveUsedBytes,
  isTrafficAlertSuppressed,
  nextTrafficAlertSuppressionLimit,
  onePercentAllowanceBytes,
  usedPercentAtBytes,
} from "../src/lib/trafficAlertSuppression";

describe("traffic alert suppression", () => {
  it("sets the suppression limit to effective quota usage plus one percent of allowance", () => {
    const limit = nextTrafficAlertSuppressionLimit({
      trafficAllowanceBytes: 1_000n,
      remainingBytes: 95n,
    });

    assert.equal(limit, 915n);
    assert.equal(usedPercentAtBytes(limit, 1_000n), 91.5);
  });

  it("derives effective quota usage from remaining bytes instead of metered used bytes", () => {
    assert.equal(
      effectiveUsedBytes({
        trafficAllowanceBytes: 1_000n,
        remainingBytes: 95n,
      }),
      905n,
    );
  });

  it("clamps effective quota usage at zero when remaining bytes exceed allowance", () => {
    assert.equal(
      effectiveUsedBytes({
        trafficAllowanceBytes: 1_000n,
        remainingBytes: 1_200n,
      }),
      0n,
    );
  });

  it("rounds the one percent allowance step up to at least one byte for small allowances", () => {
    assert.equal(onePercentAllowanceBytes(1n), 1n);
    assert.equal(onePercentAllowanceBytes(101n), 2n);
  });

  it("suppresses while effective usage is below the stored limit", () => {
    assert.equal(
      isTrafficAlertSuppressed({
        trafficAllowanceBytes: 1_000n,
        remainingBytes: 86n,
        trafficAlertSuppressedUntilUsedBytes: 915n,
      }),
      true,
    );
  });

  it("resumes alerts when effective usage reaches the stored limit", () => {
    assert.equal(
      isTrafficAlertSuppressed({
        trafficAllowanceBytes: 1_000n,
        remainingBytes: 85n,
        trafficAlertSuppressedUntilUsedBytes: 915n,
      }),
      false,
    );
  });
});
