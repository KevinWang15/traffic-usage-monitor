UPDATE `User`
SET `name` = `email`
WHERE `name` IS NULL OR TRIM(`name`) = '';

ALTER TABLE `User` MODIFY `name` VARCHAR(191) NOT NULL;
