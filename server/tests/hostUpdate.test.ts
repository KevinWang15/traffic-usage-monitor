import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { remainingAfterAllowanceUpdate, remainingAfterHostUpdate } from "../src/lib/hostUpdate";

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

describe("remainingAfterHostUpdate", () => {
  it("lets explicit remaining bytes win when allowance changes in the same update", () => {
    const current = {
      trafficAllowanceBytes: 1_000n,
      usedBytes: 300n,
      remainingBytes: 700n,
    };

    assert.equal(
      remainingAfterHostUpdate(current, {
        trafficAllowanceBytes: 1_500n,
        remainingBytes: 2_000n,
      }),
      2_000n,
    );
  });

  it("preserves the explicitly submitted remaining bytes even when it equals the old remaining value", () => {
    const current = {
      trafficAllowanceBytes: 1_000n,
      usedBytes: 300n,
      remainingBytes: 700n,
    };

    assert.equal(
      remainingAfterHostUpdate(current, {
        trafficAllowanceBytes: 1_500n,
        remainingBytes: 700n,
      }),
      700n,
    );
  });

  it("returns undefined when neither allowance nor remaining is updated", () => {
    const current = {
      trafficAllowanceBytes: 1_000n,
      usedBytes: 300n,
      remainingBytes: 700n,
    };

    assert.equal(remainingAfterHostUpdate(current, {}), undefined);
  });
});
