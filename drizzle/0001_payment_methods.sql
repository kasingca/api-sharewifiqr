CREATE TABLE `payment_methods` (
	`account_id` char(36) NOT NULL,
	`provider` enum('stripe','paypal') NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_methods_account_id` PRIMARY KEY(`account_id`)
);
--> statement-breakpoint
ALTER TABLE `payment_methods` ADD CONSTRAINT `payment_methods_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;