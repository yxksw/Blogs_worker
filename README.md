# Blog Worker

A standalone Cloudflare Worker project providing backend API for the blog system with multi-storage support (R2, S3, Telegram).

[![API](https://img.shields.io/badge/API-https://api.danarnoux.com-0f766e?style=for-the-badge&logo=cloudflare&logoColor=white)](https://api.danarnoux.com)
[![Frontend](https://img.shields.io/badge/Frontend-DansBlog-1d4ed8?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Dancncn/DansBlog)
[![Repository](https://img.shields.io/badge/Repository-DansBlogs_worker-111827?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Dancncn/DansBlogs_worker)
[![Bilibili](https://img.shields.io/badge/Watch-Bilibili-fe738c?style=for-the-badge&logo=bilibili)](https://space.bilibili.com/435440676)

> **Frontend**: [DansBlog](https://github.com/Dancncn/DansBlog)
>
> **中文版**: [查看中文文档](./docs/README.zh-CN.md)

## Project Overview

This is the **backend component** of a decoupled blog architecture:

- **Frontend**: [DansBlog](https://github.com/Dancncn/DansBlog) - Astro-based static blog
- **Backend**: This Worker - Cloudflare Workers with D1, R2, S3, Telegram, and Durable Objects

## Features 🚀

- GitHub OAuth authentication (Authorization Code + PKCE + state)
- D1-backed users, sessions, and comments management
- Durable Object-based rate limiting
- Bearer token session (`Authorization: Bearer <token>`)
- **Multi-storage image support**:
  - **R2**: Cloudflare R2 object storage
  - **S3**: Compatible with 缤纷云(Bitiful) and other S3 providers
  - **Telegram**: Store images via Telegram Bot API
- **Email Notifications**: New comment and reply notifications via Resend API or SMTP (QQ/163/Gmail)

## API Endpoints 📡

### Authentication

- `GET /api/auth/github/start?returnTo=...` - Initiate OAuth flow
- `GET /api/auth/github/callback` - OAuth callback handler
- `GET /api/me` - Get current user info
- `POST /api/auth/logout` - Logout and invalidate session

### Comments

- `GET /api/comments?slug=<post-slug>` - Fetch comments for a post
- `POST /api/comments` - Create a new comment (requires auth)

### Images

- `GET /api/images` - List uploaded images (requires auth)
  - Query params: `prefix=`, `cursor=`, `limit=`, `storage=r2|s3|telegram`
- `GET /api/images?key=<key>` - Serve image (requires auth for non-public)
  - Query params: `key=`, `storage=r2|s3|telegram`
- `POST /api/images` - Upload image (requires auth, rate limited)
  - Query params: `filename=`, `category=posts|avatars|misc`, `storage=r2|s3|telegram`
- `POST /api/upload` - Alias for upload
- `DELETE /api/images` - Delete an image (requires auth)
  - Body: `{ "key": "...", "storageType": "r2|s3|telegram" }`

### Storage

- `GET /api/storage/providers` - Get available storage providers

### Notes

- Session is token-based via Authorization header
- Cross-domain cookie session is not used
- OAuth callback only uses short-lived cookies for `state`/`code_verifier` validation

## Required Secrets / Vars 🔐

Set secrets via Wrangler CLI. Do not commit real secrets.

```bash
# Set GitHub OAuth secret
wrangler secret put GITHUB_CLIENT_SECRET --name blog-worker

# Set S3 credentials (if using 缤纷云)
wrangler secret put S3_ACCESS_KEY_ID
wrangler secret put S3_SECRET_ACCESS_KEY

# Set Telegram Bot Token (if using Telegram storage)
wrangler secret put TELEGRAM_BOT_TOKEN

# Set Resend API Key (for email notifications via Resend)
wrangler secret put RESEND_API_KEY

# Set SMTP credentials (for email notifications via SMTP - QQ/163/Gmail/etc)
wrangler secret put SMTP_PASS
```

### Environment Variables

Set non-secret variables in `wrangler.toml`:

```toml
[vars]
GITHUB_CLIENT_ID = "your-client-id"
PUBLIC_ALLOWED_ORIGIN = "https://danarnoux.com,https://www.danarnoux.com"
SESSION_TTL_SECONDS = "2592000"

# R2 Configuration
R2_ENABLED = "true"
R2_PUBLIC_URL = "https://img.danarnoux.com"
R2_PRIORITY = "1"

# S3 Configuration (缤纷云)
S3_ENABLED = "true"
S3_ENDPOINT = "https://s3.bitiful.net"
S3_BUCKET = "your-bucket-name"
S3_REGION = "auto"
S3_PUBLIC_URL = "https://your-cdn-domain.com"
S3_PRIORITY = "2"

# Telegram Configuration
TELEGRAM_ENABLED = "true"
TELEGRAM_CHAT_ID = "your-channel-id"
TELEGRAM_PROXY_URL = ""  # Optional: proxy domain for Telegram API
TELEGRAM_PRIORITY = "3"

# Default storage provider
DEFAULT_STORAGE = "r2"

# Email Notification Configuration
# Option 1: Resend API (recommended for simplicity)
# Get API key from https://resend.com (free tier: 100 emails/day)
RESEND_API_KEY = ""                        # Set via wrangler secret put RESEND_API_KEY

# Option 2: SMTP (QQ Mail, 163 Mail, Gmail, etc.)
# Uses Cloudflare Workers TCP Sockets - no external service needed
SMTP_USER = "your-qq@qq.com"               # Your email address
SMTP_PASS = ""                             # Set via wrangler secret put SMTP_PASS
SMTP_PROVIDER = "qq"                       # Auto-detected from email domain if not set
                                           # Options: qq, 163, gmail, or leave empty for auto

# Common email settings
EMAIL_FROM = "noreply@yourdomain.com"      # Sender address (defaults to SMTP_USER if using SMTP)
EMAIL_FROM_NAME = "博客评论通知"
EMAIL_TO = "admin@yourdomain.com"          # Where to receive notifications
NOTIFY_ON_COMMENT = "true"                 # Set to "false" to disable notifications
BLOG_BASE_URL = "https://blog.261770.xyz"  # Your blog URL for comment links
```

## Storage Configuration Guide

### 1. R2 (Cloudflare R2) - Default

R2 is the default storage provider. No additional configuration needed beyond `R2_PUBLIC_URL`.

```bash
R2_ENABLED = "true"
R2_PUBLIC_URL = "https://img.danarnoux.com"
```

### 2. S3 (缤纷云/Bitiful)

1. Sign up at [缤纷云](https://www.bitiful.com/)
2. Create a bucket and get your access keys
3. Configure custom domain (recommended for CDN)

```bash
S3_ENABLED = "true"
S3_ENDPOINT = "https://s3.bitiful.net"
S3_BUCKET = "your-bucket"
S3_REGION = "auto"
S3_PUBLIC_URL = "https://your-custom-domain.com"  # CDN domain
```

### 3. Telegram Channel

1. Create a Telegram bot via [@BotFather](https://t.me/botfather)
2. Create a channel and add the bot as administrator
3. Get the channel ID (use [@userinfobot](https://t.me/userinfobot) or API)

```bash
TELEGRAM_ENABLED = "true"
TELEGRAM_BOT_TOKEN = "your-bot-token"
TELEGRAM_CHAT_ID = "-100xxxxxxxxxx"  # Channel ID
TELEGRAM_PROXY_URL = ""  # Optional: use your own domain as proxy
```

#### Using Your Own Domain as Telegram Proxy

If Telegram API is blocked in your region, you can use your Worker as a proxy:

```bash
TELEGRAM_PROXY_URL = "api.danarnoux.com"  # Your Worker domain
```

How it works:
- Set `TELEGRAM_PROXY_URL` to your Worker domain (without `https://`)
- Telegram API requests will be proxied through `https://api.danarnoux.com/api/telegram-proxy`
- The proxy endpoint forwards requests to `https://api.telegram.org`

**Note**: Telegram storage has some limitations:
- Files are stored in a Telegram channel
- Maximum file size: 20MB for photos, 50MB for documents
- File deletion is not supported via API

### 4. Email Notifications

The blog supports email notifications for new comments and replies using two methods:

#### Option A: SMTP (Recommended for China users - QQ Mail, 163 Mail)

Uses Cloudflare Workers' native TCP Sockets to connect directly to SMTP servers. **No external service required!**

**Supported Providers:**
- **QQ Mail** (`smtp.qq.com:587`)
- **163 Mail** (`smtp.163.com:465`)
- **126 Mail** (`smtp.126.com:465`)
- **Gmail** (`smtp.gmail.com:587`)
- **Custom SMTP** (any provider)

**Setup Steps:**

1. **Get SMTP Authorization Code** (not your email password!):
   - **QQ Mail**: Go to QQ Mail → Settings → Accounts → SMTP → Generate Authorization Code
   - **163 Mail**: Go to 163 Mail → Settings → POP3/SMTP → Enable and get Authorization Code
   - **Gmail**: Use App Password (requires 2FA enabled)

2. **Configure Secrets**:

```bash
# Set SMTP password (authorization code, not email password!)
wrangler secret put SMTP_PASS
```

3. **Configure Variables** in `wrangler.toml`:

```toml
[vars]
# SMTP Configuration
SMTP_USER = "your-qq@qq.com"               # Your email address
SMTP_PROVIDER = "qq"                       # Auto-detected if not set: qq, 163, gmail

# Notification settings
EMAIL_FROM_NAME = "博客评论通知"
EMAIL_TO = "your-email@qq.com"             # Where to receive notifications
NOTIFY_ON_COMMENT = "true"
BLOG_BASE_URL = "https://yourblog.com"
```

#### Option B: Resend API

Using [Resend](https://resend.com) - a developer-friendly email API.

**Setup Steps:**

1. **Sign up for Resend**: Go to [resend.com](https://resend.com) and create a free account
2. **Get API Key**: Generate an API key from the dashboard
3. **Configure Secrets**:

```bash
wrangler secret put RESEND_API_KEY
```

4. **Configure Variables** in `wrangler.toml`:

```toml
[vars]
EMAIL_FROM = "noreply@yourdomain.com"      # Must be verified in Resend
EMAIL_FROM_NAME = "博客评论通知"
EMAIL_TO = "your-email@example.com"
NOTIFY_ON_COMMENT = "true"
BLOG_BASE_URL = "https://yourblog.com"
```

**Free Tier Limits:**
- 100 emails per day
- 3,000 emails per month

#### Notification Types

- **New Comment**: When someone comments on your blog post, you receive an email
- **Reply Notification**: When someone replies to a comment, the original commenter is notified (if they have email on file)

#### Email Templates

Both SMTP and Resend use the same beautiful HTML email templates:
- Responsive design for mobile and desktop
- Comment content with proper formatting
- Direct links to comments on your blog
- Plain text fallback for compatibility

## Deployment 🌐

### Prerequisites

1. Login to Cloudflare

```bash
wrangler login
```

2. Create D1 database

```bash
wrangler d1 create blog_worker_db
```

3. Apply database schema

```bash
wrangler d1 execute blog_worker_db --file db/schema.sql --remote
```

### Deploy Steps

```bash
# Deploy the Worker
wrangler deploy

# Set secrets
wrangler secret put GITHUB_CLIENT_SECRET --name blog-worker
wrangler secret put S3_ACCESS_KEY_ID      # If using S3
wrangler secret put S3_SECRET_ACCESS_KEY  # If using S3
wrangler secret put TELEGRAM_BOT_TOKEN --name blog-worker    # If using Telegram
```

### Configuration

The following resources are required (configured in `wrangler.toml`):

- **D1 Database**: `blog_worker_db` - User sessions and comments
- **R2 Bucket**: `blog-images` - Image storage (if using R2)
- **Durable Object**: `RateLimiter` - Rate limiting
- **Custom Domain**: `api.danarnoux.com` - API access point

## Frontend Integration 🔗

For the Astro frontend integration:

- API base: `https://api.danarnoux.com`
- Send `Authorization: Bearer <token>` header for authenticated requests
- Store token client-side (sessionStorage recommended)
- No Pages Functions required - this Worker handles all backend logic

### Upload Example

```typescript
// Upload to specific storage
const uploadImage = async (file: File, storage: 'r2' | 's3' | 'telegram') => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `https://api.danarnoux.com/api/upload?filename=${file.name}&storage=${storage}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': file.type,
      },
      body: file,
    }
  );

  return response.json();
};
```

### Get Storage Providers

```typescript
const getProviders = async () => {
  const response = await fetch('https://api.danarnoux.com/api/storage/providers', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const { providers, defaultProvider } = await response.json();
  return { providers, defaultProvider };
};
```

## Development 💻

```bash
# Local development
wrangler dev

# Deploy to production
wrangler deploy

# View logs
wrangler tail
```

## Project Structure 📁

```text
.
├─ db/
│  └─ schema.sql               # D1 database schema
├─ scripts/
│  └─ upload-images.ps1        # R2 image upload script
├─ src/
│  ├─ storage/
│  │  ├─ types.ts              # Storage type definitions
│  │  ├─ index.ts              # Storage manager
│  │  ├─ r2.ts                 # R2 provider
│  │  ├─ s3.ts                 # S3 provider (缤纷云)
│  │  └─ telegram.ts           # Telegram provider
│  └─ index.ts                 # Worker entry point and all route handlers
├─ .gitignore                  # Excludes wrangler.toml, .wrangler/, node_modules/
└─ README.md
```

## Security Notes 🛡️

- `wrangler.toml` contains sensitive `database_id` - excluded from git
- All secrets must be set via `wrangler secret put`
- Rate limiting is enforced on image upload endpoint
- Session tokens are validated against D1 database on each request
- S3 credentials and Telegram tokens are stored as encrypted secrets

## Multi-Storage Architecture

The storage system uses a provider pattern:

1. **StorageManager** (`src/storage/index.ts`): Unified interface for all storage providers
2. **Providers**: Individual implementations for R2, S3, Telegram
3. **Configuration**: Environment-based configuration with priority support
4. **Fallback**: Automatic fallback to available providers

Upload flow:
1. Client specifies preferred storage via `storage` query param
2. StorageManager routes to appropriate provider
3. Provider uploads file and returns standardized result
4. Result includes `storageType` for future operations

## License

MIT
