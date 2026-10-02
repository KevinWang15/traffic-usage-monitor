ALTER TABLE `User` ADD COLUMN `notificationEmailEnabled` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `WebhookTarget` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `url` VARCHAR(2048) NOT NULL,
  `method` VARCHAR(7) NOT NULL DEFAULT 'POST',
  `headers` JSON NOT NULL,
  `bodyTemplate` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `WebhookTarget_userId_idx` (`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `NotificationLog` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `channel` ENUM('EMAIL', 'WEBHOOK') NOT NULL,
  `target` VARCHAR(191) NOT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sentAt` DATETIME(3) NULL,
  `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `purpose` ENUM('TEST', 'TRAFFIC_ALERT', 'MISSING_HOST') NOT NULL,
  `subject` TEXT NOT NULL,
  `preview` TEXT NULL,
  `error` TEXT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `NotificationLog_userId_requestedAt_idx` (`userId`, `requestedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WebhookTarget` ADD CONSTRAINT `WebhookTarget_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `NotificationLog` ADD CONSTRAINT `NotificationLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
