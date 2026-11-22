CREATE TABLE `accounts` (
	`id` char(36) NOT NULL,
	`public_id` char(32) NOT NULL,
	`identity_key` char(64) NOT NULL,
	`issuer` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`first_name` varchar(150) NOT NULL,
	`last_name` varchar(150) NOT NULL,
	`role` enum('customer','admin') NOT NULL DEFAULT 'customer',
	`status` enum('active','paused') NOT NULL DEFAULT 'active',
	`plan` enum('free','plus','business') NOT NULL DEFAULT 'free',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_public_id_unique` UNIQUE(`public_id`),
	CONSTRAINT `accounts_identity_key_unique` UNIQUE(`identity_key`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`digest` char(64) NOT NULL,
	`state` char(43) NOT NULL,
	`nonce` char(43) NOT NULL,
	`verifier` char(43) NOT NULL,
	`expires_at` int NOT NULL,
	CONSTRAINT `login_attempts_digest` PRIMARY KEY(`digest`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`digest` char(64) NOT NULL,
	`account_id` char(36) NOT NULL,
	`csrf_token` char(43) NOT NULL,
	`created_at` int NOT NULL,
	`expires_at` int NOT NULL,
	`idle_until` int NOT NULL,
	CONSTRAINT `sessions_digest` PRIMARY KEY(`digest`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `login_attempts_expiry_idx` ON `login_attempts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_account_idx` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);