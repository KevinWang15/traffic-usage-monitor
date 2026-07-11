import { HttpError } from "./http";

export function parseBytes(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new HttpError(400, `${fieldName} must be non-negative`);
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new HttpError(400, `${fieldName} must be a non-negative safe integer or string`);
    }
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  throw new HttpError(400, `${fieldName} must be a non-negative integer byte value`);
}

export function formatBytes(bytes: bigint): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = Number(bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

export function percentBasisPointsToPercent(value: number): number {
  return Math.round(value) / 100;
}

export function percentToBasisPoints(value: unknown, fieldName: string): number {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) {
    throw new HttpError(400, `${fieldName} must be between 0 and 100`);
  }
  return Math.round(numberValue * 100);
}

export function remainingPercent(remainingBytes: bigint, allowanceBytes: bigint): number | null {
  if (allowanceBytes <= 0n) {
    return null;
  }
  const basisPoints = Number((remainingBytes * 10000n) / allowanceBytes);
  return Math.round(basisPoints) / 100;
}
