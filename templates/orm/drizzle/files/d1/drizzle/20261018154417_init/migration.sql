CREATE TABLE `note` (
	`id` text PRIMARY KEY,
	`org_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `note` (`id`, `title`, `created_at`) VALUES
	('seed-1', 'Welcome to your new app', unixepoch() * 1000),
	('seed-2', 'Notes are read through the Database service', unixepoch() * 1000);
