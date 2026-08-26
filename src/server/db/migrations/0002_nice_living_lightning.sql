CREATE TABLE `mp_strategy_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`plan` text DEFAULT '{}' NOT NULL,
	`diff` text DEFAULT '[]' NOT NULL,
	`created_by` text DEFAULT 'agent' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_strategy_project` ON `mp_strategy_plans` (`project_id`);--> statement-breakpoint
ALTER TABLE `mp_tasks` ADD `channel` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_tasks` ADD `week` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_tasks` ADD `plan_version` integer DEFAULT 0 NOT NULL;