ALTER TABLE `Host`
  ADD COLUMN `trafficAlertSuppressedAt` DATETIME(3) NULL,
  ADD COLUMN `trafficAlertSuppressedUntilUsedBytes` BIGINT NULL;
