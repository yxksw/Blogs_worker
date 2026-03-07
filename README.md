# Blog Worker

A standalone Cloudflare Worker project providing backend API for the blog system.

> **中文版**: [查看中文文档](./docs/README.zh-CN.md)

## Project Overview

This is the **backend component** of a decoupled blog architecture:

- **Frontend**: [DansBlog](https://github.com/Dancncn/DansBlog) - Astro-based static blog
- **Backend**: This Worker - Cloudflare Workers with D1, R2, and Durable Objects

## Features 🚀

- GitHub OAuth authentication (Authorization Code + PKCE + state)
- D1-backed users, sessions, and comments management
- Durable Object-based rate limiting
- Bearer token session (`Authorization: Bearer <token>`)
- R2 image storage integration

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
- `POST /api/upload` - Upload image to R2 (requires auth, rate limited)
- `DELETE /api/images` - Delete an image (requires auth)

### Notes

- Session is token-based via Authorization header
- Cross-domain cookie session is not used
- OAuth callback only uses short-lived cookies for `state`/`code_verifier` validation

## Required Secrets / Vars 🔐

Set secrets via Wrangler CLI. Do not commit real secrets.

```bash
# Set GitHub OAuth secret
wrangler secret put GITHUB_CLIENT_SECRET

# Set non-secret variables in wrangler.toml
GITHUB_CLIENT_ID = "your-client-id"
PUBLIC_ALLOWED_ORIGIN = "https://danarnoux.com,https://www.danarnoux.com"
SESSION_TTL_SECONDS = "2592000"
```

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
```

### Configuration

The following resources are required (configured in `wrangler.toml`):

- **D1 Database**: `blog_worker_db` - User sessions and comments
- **R2 Bucket**: `blog-images` - Image storage
- **Durable Object**: `RateLimiter` - Rate limiting
- **Custom Domain**: `api.danarnoux.com` - API access point

## Frontend Integration 🔗

For the Astro frontend integration:

- API base: `https://api.danarnoux.com`
- Send `Authorization: Bearer <token>` header for authenticated requests
- Store token client-side (sessionStorage recommended)
- No Pages Functions required - this Worker handles all backend logic

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
│  └─ index.ts                 # Worker entry point and all route handlers
├─ .gitignore                  # Excludes wrangler.toml, .wrangler/, node_modules/
└─ README.md
```

## Security Notes 🛡️

- `wrangler.toml` contains sensitive `database_id` - excluded from git
- All secrets must be set via `wrangler secret put`
- Rate limiting is enforced on image upload endpoint
- Session tokens are validated against D1 database on each request
