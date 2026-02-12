-- Add extension_count to notification_queue for exponential backoff
ALTER TABLE notification_queue ADD COLUMN extension_count INTEGER NOT NULL DEFAULT 0;
