import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeIpAddress, normalizeIpv4Address } from "../src/lib/requestIp";

describe("normalizeIpAddress", () => {
  it("normalizes IPv4-mapped IPv6 addresses", () => {
    assert.equal(normalizeIpAddress("::ffff:203.0.113.10"), "203.0.113.10");
  });
});

describe("normalizeIpv4Address", () => {
  it("accepts IPv4 addresses", () => {
    assert.equal(normalizeIpv4Address("203.0.113.10"), "203.0.113.10");
  });

  it("rejects IPv6 addresses", () => {
    assert.equal(normalizeIpv4Address("2001:db8::1"), null);
  });
});
