CREATE TABLE `mp_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`task` text NOT NULL,
	`model` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`result_ref` text,
	`error` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mp_runs_project` ON `mp_agent_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `mp_runs_started` ON `mp_agent_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `mp_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`content_piece_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`content_piece_id`) REFERENCES `mp_content_pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_assets_piece` ON `mp_assets` (`content_piece_id`);--> statement-breakpoint
CREATE TABLE `mp_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`user` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`content` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mp_audit_project` ON `mp_audit_log` (`project_id`);--> statement-breakpoint
CREATE INDEX `mp_audit_created` ON `mp_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `mp_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`platform` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`cadence` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_channels_project` ON `mp_channels` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_community_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`draft_reply` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_leads_project` ON `mp_community_leads` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_content_pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`channel` text NOT NULL,
	`format` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`assets` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`human_edited` integer DEFAULT false NOT NULL,
	`published_at` text,
	`external_url` text,
	`utm` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `mp_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mp_content_project` ON `mp_content_pieces` (`project_id`);--> statement-breakpoint
CREATE INDEX `mp_content_status` ON `mp_content_pieces` (`status`);--> statement-breakpoint
CREATE TABLE `mp_geo_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`engine` text NOT NULL,
	`query` text NOT NULL,
	`mentioned` integer DEFAULT false NOT NULL,
	`position` integer,
	`competitors_mentioned` text DEFAULT '[]' NOT NULL,
	`raw_answer` text DEFAULT '' NOT NULL,
	`taken_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_geo_project` ON `mp_geo_snapshots` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`period` text NOT NULL,
	`metrics` text DEFAULT '{}' NOT NULL,
	`signups` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_insights_project` ON `mp_insights` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`pain_points` text DEFAULT '[]' NOT NULL,
	`language` text DEFAULT 'de' NOT NULL,
	`where_they_hang_out` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_personas_project` ON `mp_personas` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`brief` text DEFAULT '{}' NOT NULL,
	`brand_kit` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mp_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mp_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_at` text,
	`assigned_to` text DEFAULT 'agent' NOT NULL,
	`approval_level` text DEFAULT 'review' NOT NULL,
	`output_refs` text DEFAULT '[]' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_tasks_project` ON `mp_tasks` (`project_id`);