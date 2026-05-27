import { isIP } from "node:net";
import type { Request } from "express";

export function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (!value) {
    return null;
  }

  let ip = value.trim();
  if (!ip) {
    return null;
  }

  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  }
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice("::ffff:".length);
  }

  const zoneIndex = ip.indexOf("%");
  if (zoneIndex !== -1) {
    ip = ip.slice(0, zoneIndex);
  }

  return isIP(ip) ? ip : null;
}

export function normalizeIpv4Address(value: unknown): string | null {
  const ip = normalizeIpAddress(value);
  return ip && isIP(ip) === 4 ? ip : null;
}

export function observedRequestIp(req: Request): string | null {
  return normalizeIpAddress(req.ip) ?? normalizeIpAddress(req.socket.remoteAddress);
}
