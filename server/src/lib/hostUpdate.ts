export type AllowanceState = {
  trafficAllowanceBytes: bigint;
  usedBytes: bigint;
  remainingBytes: bigint;
};

export function remainingAfterAllowanceUpdate(current: AllowanceState, nextAllowance: bigint): bigint {
  if (nextAllowance === current.trafficAllowanceBytes) {
    return current.remainingBytes;
  }
  return nextAllowance > current.usedBytes ? nextAllowance - current.usedBytes : 0n;
}
