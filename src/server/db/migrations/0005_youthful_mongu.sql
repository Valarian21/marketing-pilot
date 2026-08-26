CREATE TABLE `mp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event` text NOT NULL,
	`utm_source` text DEFAULT '' NOT NULL,
	`utm_medium` text DEFAULT '' NOT NULL,
	`utm_campaign` text DEFAULT '' NOT NULL,
	`utm_content` text DEFAULT '' NOT NULL,
	`user_ref` text DEFAULT '' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_events_project` ON `mp_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `mp_events_occurred` ON `mp_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `mp_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`week_start` text NOT NULL,
	`report` text DEFAULT '' NOT NULL,
	`proposed_plan` text DEFAULT '{}' NOT NULL,
	`diff` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_reports_project` ON `mp_reports` (`project_id`);