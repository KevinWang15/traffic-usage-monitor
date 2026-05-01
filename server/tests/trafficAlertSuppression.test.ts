import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTrafficAlertSuppressed,
  nextTrafficAlertSuppressionLimit,
  onePercentAllowanceBytes,
  usedPercentAtBytes,
} from "../src/lib/trafficAlertSuppression";

describe("traffic alert suppression", () => {
  it("sets the suppression limit to current used bytes plus one percent of allowance", () => {
    const limit = nextTrafficAlertSuppressionLimit({
      trafficAllowanceBytes: 1_000n,
      usedBytes: 905n,
    });

    assert.equal(limit, 915n);
    assert.equal(usedPercentAtBytes(limit, 1_000n), 91.5);
  });

  it("rounds the one percent allowance step up to at least one byte for small allowances", () => {
    assert.equal(onePercentAllowanceBytes(1n), 1n);
    assert.equal(onePercentAllowanceBytes(101n), 2n);
  });

  it("suppresses while used bytes are below the stored limit", () => {
    assert.equal(
      isTrafficAlertSuppressed({
        trafficAllowanceBytes: 1_000n,
        usedBytes: 914n,
        trafficAlertSuppressedUntilUsedBytes: 915n,
      }),
      true,
    );
  });

  it("resumes alerts when used bytes reach the stored limit", () => {
    assert.equal(
      isTrafficAlertSuppressed({
        trafficAllowanceBytes: 1_000n,
        usedBytes: 915n,
        trafficAlertSuppressedUntilUsedBytes: 915n,
      }),
      false,
    );
  });
});
