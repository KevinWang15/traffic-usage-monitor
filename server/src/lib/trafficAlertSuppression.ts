export type TrafficAlertSuppressionState = {
  trafficAllowanceBytes: bigint;
  remainingBytes: bigint;
  trafficAlertSuppressedUntilUsedBytes: bigint | null;
};

export function onePercentAllowanceBytes(allowanceBytes: bigint): bigint {
  if (allowanceBytes <= 0n) {
    return 0n;
  }
  return (allowanceBytes + 99n) / 100n;
}

export function nextTrafficAlertSuppressionLimit(
  host: Pick<TrafficAlertSuppressionState, "trafficAllowanceBytes" | "remainingBytes">,
): bigint {
  return effectiveUsedBytes(host) + onePercentAllowanceBytes(host.trafficAllowanceBytes);
}

export function isTrafficAlertSuppressed(host: TrafficAlertSuppressionState): boolean {
  return (
    host.trafficAlertSuppressedUntilUsedBytes !== null &&
    effectiveUsedBytes(host) < host.trafficAlertSuppressedUntilUsedBytes
  );
}

export function effectiveUsedBytes(
  host: Pick<TrafficAlertSuppressionState, "trafficAllowanceBytes" | "remainingBytes">,
): bigint {
  if (host.trafficAllowanceBytes <= 0n || host.remainingBytes >= host.trafficAllowanceBytes) {
    return 0n;
  }
  return host.trafficAllowanceBytes - host.remainingBytes;
}

export function usedPercentAtBytes(usedBytes: bigint | null, allowanceBytes: bigint): number | null {
  if (usedBytes === null || allowanceBytes <= 0n) {
    return null;
  }
  const basisPoints = Number((usedBytes * 10000n) / allowanceBytes);
  return Math.round(basisPoints) / 100;
}
