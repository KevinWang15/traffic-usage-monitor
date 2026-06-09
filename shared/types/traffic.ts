export type MeteringType = "EGRESS_ONLY" | "INGRESS_AND_EGRESS";
export type ResetPeriod = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type HostStatus = "ACTIVE" | "STALE" | "DISABLED";

export type HostDto = {
  id: string;
  name: string | null;
  notes: string | null;
  hostname: string;
  machineId: string | null;
  publicIp: string | null;
  countryCode: string | null;
  countryCodeAuto: string | null;
  countryCodeOverride: string | null;
  status: HostStatus;
  trafficAllowanceBytes: string;
  remainingBytes: string;
  usedBytes: string;
  remainingPercent: number | null;
  meteringType: MeteringType;
  resetPeriod: ResetPeriod;
  resetDayOfMonth: number;
  resetDayOfWeek: number;
  resetMonth: number;
  resetHourUtc: number;
  resetMinuteUtc: number;
  currentCycleId: string | null;
  currentCycleStartedAt: string | null;
  lastSeenAt: string | null;
  lastReportAt: string | null;
  recentRateMbps: number;
  trafficSpark: number[];
  alertThresholdPercent: number;
  alertThresholdOverridePercent: number | null;
  trafficAlertSuppressed: boolean;
  trafficAlertSuppressedAt: string | null;
  trafficAlertSuppressedUntilUsedBytes: string | null;
  trafficAlertSuppressedUntilUsedPercent: number | null;
  missingAlertSuppressedAt: string | null;
  pollIntervalSeconds: number;
  createdAt: string;
};

export type TrafficSampleDto = {
  id: string;
  hostId: string;
  interface: string;
  rxBytes: string;
  txBytes: string;
  deltaRxBytes: string;
  deltaTxBytes: string;
  meteredBytes: string;
  observedAt: string;
  createdAt: string;
};

export type HostSamplesDto = {
  samples: TrafficSampleDto[];
  throughputSeries: number[];
};

export type UserDto = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  defaultAlertThresholdPercent: number;
  createdAt: string;
};
