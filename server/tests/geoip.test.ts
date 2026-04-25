import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lookupCountryCode } from "../src/lib/geoip";

describe("lookupCountryCode", () => {
  it("resolves public IPs to two-letter country codes", () => {
    assert.equal(lookupCountryCode("8.8.8.8"), "US");
  });

  it("returns null for private IPs", () => {
    assert.equal(lookupCountryCode("10.42.0.1"), null);
  });
});
