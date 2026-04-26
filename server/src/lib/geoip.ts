import fs from "fs";
import maxmind, { Reader, type CountryResponse } from "maxmind";
import { env } from "../config";

let reader: Reader<CountryResponse> | null | undefined;
let warned = false;

function readerForLookup(): Reader<CountryResponse> | null {
  if (reader !== undefined) {
    return reader;
  }

  if (!env.geoipMmdbPath) {
    reader = null;
    return reader;
  }

  try {
    reader = new Reader<CountryResponse>(fs.readFileSync(env.geoipMmdbPath));
  } catch (error) {
    reader = null;
    if (!warned) {
      warned = true;
      console.warn("geoip-mmdb-load-failed", {
        path: env.geoipMmdbPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return reader;
}

function countryFromResponse(response: CountryResponse | null): string | null {
  const country = response?.country?.iso_code ?? response?.registered_country?.iso_code ?? null;
  return typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null;
}

export function lookupCountryCode(ip: string | null | undefined): string | null {
  if (!ip || !maxmind.validate(ip)) {
    return null;
  }

  return countryFromResponse(readerForLookup()?.get(ip) ?? null);
}
