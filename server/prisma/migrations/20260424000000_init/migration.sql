-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `joinToken` VARCHAR(191) NOT NULL,
    `defaultAlertThresholdBasisPts` INTEGER NOT NULL DEFAULT 1000,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_joinToken_key`(`joinToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Host` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NULL,
    `lastBootId` VARCHAR(191) NULL,
    `agentKeyHash` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'STALE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `trafficAllowanceBytes` BIGINT NOT NULL DEFAULT 1099511627776,
    `remainingBytes` BIGINT NOT NULL DEFAULT 1099511627776,
    `usedBytes` BIGINT NOT NULL DEFAULT 0,
    `meteringType` ENUM('EGRESS_ONLY', 'INGRESS_AND_EGRESS') NOT NULL DEFAULT 'EGRESS_ONLY',
    `resetPeriod` ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') NOT NULL DEFAULT 'MONTHLY',
    `resetDayOfMonth` INTEGER NOT NULL DEFAULT 1,
    `resetDayOfWeek` INTEGER NOT NULL DEFAULT 1,
    `resetMonth` INTEGER NOT NULL DEFAULT 1,
    `resetHourUtc` INTEGER NOT NULL DEFAULT 0,
    `resetMinuteUtc` INTEGER NOT NULL DEFAULT 0,
    `currentCycleId` VARCHAR(191) NULL,
    `currentCycleStartedAt` DATETIME(3) NULL,
    `lastResetCycleId` VARCHAR(191) NULL,
    `alertThresholdBasisPts` INTEGER NULL,
    `lastAlertSentAt` DATETIME(3) NULL,
    `lastAlertCycleId` VARCHAR(191) NULL,
    `pollIntervalSeconds` INTEGER NOT NULL DEFAULT 60,
    `lastSeenAt` DATETIME(3) NULL,
    `lastReportAt` DATETIME(3) NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Host_userId_machineId_key`(`userId`, `machineId`),
    INDEX `Host_userId_idx`(`userId`),
    INDEX `Host_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HostInterfaceState` (
    `id` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `lastRxBytes` BIGINT NOT NULL DEFAULT 0,
    `lastTxBytes` BIGINT NOT NULL DEFAULT 0,
    `lastObservedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `HostInterfaceState_hostId_name_key`(`hostId`, `name`),
    INDEX `HostInterfaceState_hostId_idx`(`hostId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrafficSample` (
    `id` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `interface` VARCHAR(191) NOT NULL,
    `rxBytes` BIGINT NOT NULL,
    `txBytes` BIGINT NOT NULL,
    `deltaRxBytes` BIGINT NOT NULL,
    `deltaTxBytes` BIGINT NOT NULL,
    `meteredBytes` BIGINT NOT NULL,
    `observedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrafficSample_hostId_observedAt_idx`(`hostId`, `observedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResetEvent` (
    `id` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `cycleStartedAt` DATETIME(3) NOT NULL,
    `previousUsedBytes` BIGINT NOT NULL,
    `previousRemainingBytes` BIGINT NOT NULL,
    `allowanceBytes` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ResetEvent_hostId_cycleId_key`(`hostId`, `cycleId`),
    INDEX `ResetEvent_hostId_createdAt_idx`(`hostId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RemainingCorrection` (
    `id` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `previousRemainingBytes` BIGINT NOT NULL,
    `newRemainingBytes` BIGINT NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RemainingCorrection_hostId_createdAt_idx`(`hostId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlertEvent` (
    `id` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `remainingBytes` BIGINT NOT NULL,
    `allowanceBytes` BIGINT NOT NULL,
    `thresholdBasisPts` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AlertEvent_hostId_createdAt_idx`(`hostId`, `createdAt`),
    INDEX `AlertEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Host` ADD CONSTRAINT `Host_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HostInterfaceState` ADD CONSTRAINT `HostInterfaceState_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrafficSample` ADD CONSTRAINT `TrafficSample_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResetEvent` ADD CONSTRAINT `ResetEvent_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RemainingCorrection` ADD CONSTRAINT `RemainingCorrection_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RemainingCorrection` ADD CONSTRAINT `RemainingCorrection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlertEvent` ADD CONSTRAINT `AlertEvent_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlertEvent` ADD CONSTRAINT `AlertEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
