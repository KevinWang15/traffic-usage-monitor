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

export function remainingAfterHostUpdate(
  current: AllowanceState,
  update: { trafficAllowanceBytes?: bigint; remainingBytes?: bigint },
): bigint | undefined {
  if (update.remainingBytes !== undefined) {
    return update.remainingBytes;
  }
  if (update.trafficAllowanceBytes !== undefined) {
    return remainingAfterAllowanceUpdate(current, update.trafficAllowanceBytes);
  }
  return undefined;
}
