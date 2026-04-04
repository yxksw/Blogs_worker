# Blog Worker

A standalone Cloudflare Worker providing backend API for the blog system.

[![API](https://img.shields.io/badge/API-https://api.danarnoux.com-0f766e?style=for-the-badge&logo=cloudflare&logoColor=white)](https://api.danarnoux.com)
[![Frontend](https://img.shields.io/badge/Frontend-DansBlog-1d4ed8?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Dancncn/DansBlog)
[![Repository](https://img.shields.io/badge/Repository-DansBlogs_worker-111827?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Dancncn/DansBlogs_worker)

> **Frontend**: [DansBlog](https://github.com/Dancncn/DansBlog)
>
> **中文版**: [查看中文文档](./docs/README.zh-CN.md)

## Architecture Overview

This is the **backend component** of a decoupled blog architecture:

```
┌─────────────────────────────────────────┐
│           Cloudflare Pages              │
│         (Astro Static Site)             │
└─────────────────┬───────────────────────┘
                  │ REST API
                  ▼
┌─────────────────────────────────────────┐
│        Cloudflare Worker                │
│   ┌─────────────────────────────────┐    │
│   │  API Handlers (GitHub OAuth,   │    │
│   │  Comments, Images, Admin)      │    │
│   └─────────────────────────────────┘    │
│   ┌─────────────────────────────────┐    │
│   │  Cloudflare Workers AI           │    │
│   │  (Comment Moderation)           │    │
│   └─────────────────────────────────┘    │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
 ┌──────┐     ┌──────┐     ┌────────┐
 │  D1  │     │  R2  │     │   KV   │
 │(SQL) │     │(Blob)│     │(Cache) │
 └──────┘     └──────┘     └────────┘
```

## Features 🚀

| Feature | Description |
|---------|-------------|
| GitHub OAuth | PKCE-based authorization flow |
| Email Login | Magic link via Resend |
| Comments | Per-post, D1-backed with AI moderation |
| Image Hosting | R2-backed with signed URLs |
| Rate Limiting | Durable Object-based mechanism |
| AI Moderation | Cloudflare Workers AI auto-reviews comments |
| Admin Dashboard | Cloudflare Access protected (under development) |

## API Endpoints 📡

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/github/start` | GET | Initiate GitHub OAuth |
| `/api/auth/github/callback` | GET | Handle OAuth callback |
| `/api/auth/email/send` | POST | Send magic login link |
| `/api/auth/email/verify` | GET | Verify magic link token |
| `/api/auth/logout` | POST | Invalidate session |
| `/api/me` | GET | Get current user info |

### Content

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/comments` | GET | Fetch comments by post slug |
| `/api/comments` | POST | Create a comment (auth required) |

### Media

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload` | POST | Upload image to R2 (auth required) |
| `/api/images` | GET | List user's uploaded images |
| `/api/images` | DELETE | Delete an image |

### Admin (Cloudflare Access Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/check` | GET | Check admin status |
| `/api/admin/stats` | GET | Comment statistics |
| `/api/admin/comments` | GET | List all comments |
| `/api/admin/comment/approve` | POST | Approve a comment |
| `/api/admin/comment/reject` | POST | Reject a comment |
| `/api/admin/comment` | DELETE | Delete a comment |

## Data Model

### Users
```sql
users(id, github_id, login, name, email, avatar_url, is_admin, created_at)
```

### Sessions
```sql
sessions(id, user_id, token, expires_at, created_at)
```

### Comments
```sql
comments(id, parent_id, post_slug, user_id, body, status, created_at, updated_at)
```

### Images
```sql
images(id, user_id, name, url, size, created_at)
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Object Storage | Cloudflare R2 |
| Rate Limiting | Durable Objects + KV |
| AI | Cloudflare Workers AI (Llama 3) |
| Authentication | GitHub OAuth + Email Magic Links |
| Email | Resend |
| Captcha | Cloudflare Turnstile |

## Frontend Integration

The Astro frontend consumes this API:

```typescript
// API base URL
const API_BASE = 'https://api.danarnoux.com';

// Authenticated request
fetch(`${API_BASE}/api/comments?slug=my-post`, {
  headers: { Authorization: `Bearer ${token}` }
})
```

## Deployment

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Deploy to production
npm run deploy
```

## Project Structure

```
worker/
├─ src/
│  └─ index.ts          # All API route handlers
├─ db/
│  └─ schema.sql        # D1 database schema
├─ docs/
│  └─ README.zh-CN.md   # Chinese documentation
└─ wrangler.toml        # Cloudflare config (not committed)
```

> **Note**: `wrangler.toml` contains infrastructure bindings and is excluded from git. Configure via environment variables or `wrangler secret put`.
