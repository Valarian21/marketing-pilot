ALTER TABLE `mp_content_pieces` ADD `meta` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_content_pieces` ADD `ai_tell_score` integer;--> statement-breakpoint
ALTER TABLE `mp_content_pieces` ADD `ai_tell_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_content_pieces` ADD `rejection_reason` text DEFAULT '' NOT NULL;