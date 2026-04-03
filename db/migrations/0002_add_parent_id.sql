-- Migration: v2 - Add parent_id for comment replies
ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments(id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
