ALTER TABLE `User`
  ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `emailVerificationTokenHash` VARCHAR(191) NULL,
  ADD COLUMN `emailVerificationExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `passwordResetTokenHash` VARCHAR(191) NULL,
  ADD COLUMN `passwordResetExpiresAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `User_emailVerificationTokenHash_key` ON `User`(`emailVerificationTokenHash`);
CREATE UNIQUE INDEX `User_passwordResetTokenHash_key` ON `User`(`passwordResetTokenHash`);

UPDATE `User`
SET `emailVerifiedAt` = CURRENT_TIMESTAMP(3)
WHERE `emailVerifiedAt` IS NULL;
