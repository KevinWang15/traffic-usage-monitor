export type TrafficAlertSuppressionState = {
  trafficAllowanceBytes: bigint;
  usedBytes: bigint;
  trafficAlertSuppressedUntilUsedBytes: bigint | null;
};

export function onePercentAllowanceBytes(allowanceBytes: bigint): bigint {
  if (allowanceBytes <= 0n) {
    return 0n;
  }
  return (allowanceBytes + 99n) / 100n;
}

export function nextTrafficAlertSuppressionLimit(
  host: Pick<TrafficAlertSuppressionState, "trafficAllowanceBytes" | "usedBytes">,
): bigint {
  return host.usedBytes + onePercentAllowanceBytes(host.trafficAllowanceBytes);
}

export function isTrafficAlertSuppressed(host: TrafficAlertSuppressionState): boolean {
  return (
    host.trafficAlertSuppressedUntilUsedBytes !== null && host.usedBytes < host.trafficAlertSuppressedUntilUsedBytes
  );
}

export function usedPercentAtBytes(usedBytes: bigint | null, allowanceBytes: bigint): number | null {
  if (usedBytes === null || allowanceBytes <= 0n) {
    return null;
  }
  const basisPoints = Number((usedBytes * 10000n) / allowanceBytes);
  return Math.round(basisPoints) / 100;
}
