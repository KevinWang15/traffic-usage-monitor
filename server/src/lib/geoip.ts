const geoip = require("geoip-lite") as {
  lookup(ip: string): { country?: string } | null;
};

export function lookupCountryCode(ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }

  const country = geoip.lookup(ip)?.country;
  return typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null;
}
