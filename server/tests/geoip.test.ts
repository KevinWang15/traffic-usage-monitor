import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mmdbPath = path.resolve(__dirname, "../geoip/GeoLite2-Country.mmdb");
process.env.GEOIP_MMDB_PATH = fs.existsSync(mmdbPath) ? mmdbPath : "";
const { lookupCountryCode } = require("../src/lib/geoip") as typeof import("../src/lib/geoip");

describe("lookupCountryCode", () => {
  it("resolves public IPs when a MaxMind database is configured", (t: TestContext) => {
    if (!fs.existsSync(mmdbPath)) {
      t.skip("GeoLite2-Country.mmdb is not available");
      return;
    }

    assert.equal(lookupCountryCode("8.8.8.8"), "US");
  });

  it("returns null for private or invalid IPs", () => {
    assert.equal(lookupCountryCode("10.42.0.1"), null);
    assert.equal(lookupCountryCode("not-an-ip"), null);
  });
});
