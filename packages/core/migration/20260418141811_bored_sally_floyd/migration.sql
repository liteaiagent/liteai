ALTER TABLE `session` ADD `session_mode` text DEFAULT 'Normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tool_profile` text DEFAULT 'Plan' NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `fork_enabled` integer DEFAULT 0 NOT NULL;