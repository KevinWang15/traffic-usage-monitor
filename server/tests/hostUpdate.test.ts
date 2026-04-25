import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { remainingAfterAllowanceUpdate } from "../src/lib/hostUpdate";

describe("remainingAfterAllowanceUpdate", () => {
  it("preserves manually corrected remaining bytes when allowance is unchanged", () => {
    const current = {
      trafficAllowanceBytes: 1_000n,
      usedBytes: 300n,
      remainingBytes: 2_000n,
    };

    assert.equal(remainingAfterAllowanceUpdate(current, 1_000n), 2_000n);
  });

  it("recalculates remaining bytes when allowance changes", () => {
    const current = {
      trafficAllowanceBytes: 1_000n,
      usedBytes: 300n,
      remainingBytes: 2_000n,
    };

    assert.equal(remainingAfterAllowanceUpdate(current, 1_500n), 1_200n);
  });

  it("clamps recalculated remaining bytes at zero when used exceeds the new allowance", () => {
    const current = {
      trafficAllowanceBytes: 1_000n,
      usedBytes: 1_300n,
      remainingBytes: 2_000n,
    };

    assert.equal(remainingAfterAllowanceUpdate(current, 1_100n), 0n);
  });
});
