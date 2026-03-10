CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	github_id INTEGER NOT NULL UNIQUE,
	login TEXT NOT NULL,
	name TEXT,
	avatar_url TEXT,
	profile_url TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	ip TEXT,
	user_agent TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	post_slug TEXT NOT NULL,
	user_id TEXT NOT NULL,
	parent_id TEXT,
	body TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
	CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_comments_post_status_created_at
	ON comments(post_slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- Optional: Store uploaded image metadata for multi-storage tracking
CREATE TABLE IF NOT EXISTS images (
	id TEXT PRIMARY KEY,
	key TEXT NOT NULL,
	storage_type TEXT NOT NULL CHECK (storage_type IN ('r2', 's3', 'telegram')),
	url TEXT NOT NULL,
	thumbnail_url TEXT,
	size INTEGER NOT NULL,
	content_type TEXT NOT NULL,
	user_id TEXT NOT NULL,
	category TEXT NOT NULL DEFAULT 'misc',
	filename TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	metadata TEXT, -- JSON string for provider-specific metadata
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_storage_type ON images(storage_type);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);

-- Analytics table for page view tracking
CREATE TABLE IF NOT EXISTS analytics (
	id TEXT PRIMARY KEY,
	page_path TEXT NOT NULL,
	page_title TEXT,
	referrer TEXT,
	visitor_id TEXT NOT NULL,
	timestamp INTEGER NOT NULL,
	user_agent TEXT,
	ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_page_path ON analytics(page_path);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor_id ON analytics(visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics(timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_page_timestamp ON analytics(page_path, timestamp);
