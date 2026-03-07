# Blog Worker

一个独立的 Cloudflare Worker 项目，为博客系统提供后端 API。

> **English Version**: [View English Documentation](../README.md)

## 项目概述

这是博客系统的**后端组件**，采用前后端分离架构：

- **前端**: [DansBlog](https://github.com/Dancncn/DansBlog) - 基于 Astro 的静态博客
- **后端**: 本 Worker - Cloudflare Workers + D1 + R2 + Durable Objects

## 特性 🚀

- GitHub OAuth 认证（Authorization Code + PKCE + state）
- D1 数据库支持的用户、会话和评论管理
- Durable Object 限流机制
- Bearer Token 会话（`Authorization: Bearer <token>`）
- R2 图片存储集成

## API 端点 📡

### 认证

- `GET /api/auth/github/start?returnTo=...` - 启动 OAuth 流程
- `GET /api/auth/github/callback` - OAuth 回调处理
- `GET /api/me` - 获取当前用户信息
- `POST /api/auth/logout` - 登出并销毁会话

### 评论

- `GET /api/comments?slug=<post-slug>` - 获取文章评论
- `POST /api/comments` - 创建新评论（需登录）

### 图片

- `GET /api/images` - 列出已上传图片（需登录）
- `POST /api/upload` - 上传图片到 R2（需登录，有限流）
- `DELETE /api/images` - 删除图片（需登录）

### 注意事项

- 会话基于 Authorization header 的 token
- 不使用跨域 cookie 会话
- OAuth 回调仅使用短期 cookie 存储 `state`/`code_verifier` 进行验证

## 所需密钥 / 变量 🔐

通过 Wrangler CLI 设置密钥，请勿提交真实密钥。

```bash
# 设置 GitHub OAuth 密钥
wrangler secret put GITHUB_CLIENT_SECRET

# 在 wrangler.toml 中设置非敏感变量
GITHUB_CLIENT_ID = "your-client-id"
PUBLIC_ALLOWED_ORIGIN = "https://danarnoux.com,https://www.danarnoux.com"
SESSION_TTL_SECONDS = "2592000"
```

## 部署 🌐

### 前置条件

1. 登录 Cloudflare

```bash
wrangler login
```

2. 创建 D1 数据库

```bash
wrangler d1 create blog_worker_db
```

3. 应用数据库 schema

```bash
wrangler d1 execute blog_worker_db --file db/schema.sql --remote
```

### 部署步骤

```bash
# 部署 Worker
wrangler deploy
```

### 配置说明

需要以下资源（在 `wrangler.toml` 中配置）：

- **D1 数据库**: `blog_worker_db` - 用户会话和评论
- **R2 存储桶**: `blog-images` - 图片存储
- **Durable Object**: `RateLimiter` - 限流
- **自定义域名**: `api.danarnoux.com` - API 访问入口

## 前端集成 🔗

Astro 前端集成方式：

- API 域名：`https://api.danarnoux.com`
- 认证请求发送 `Authorization: Bearer <token>` header
- 建议将 token 存储在 sessionStorage 中
- 无需 Pages Functions - 本 Worker 处理所有后端逻辑

## 开发 💻

```bash
# 本地开发
wrangler dev

# 部署到生产环境
wrangler deploy

# 查看日志
wrangler tail
```

## 项目结构 📁

```text
.
├─ db/
│  └─ schema.sql               # D1 数据库 schema
├─ scripts/
│  └─ upload-images.ps1        # R2 图片上传脚本
├─ src/
│  └─ index.ts                 # Worker 入口和所有路由处理
├─ .gitignore                  # 排除 wrangler.toml, .wrangler/, node_modules/
└─ README.md
```

## 安全说明 🛡️

- `wrangler.toml` 包含敏感的 `database_id` - 已从 git 排除
- 所有密钥必须通过 `wrangler secret put` 设置
- 图片上传端点启用了限流
- 每次请求都会验证会话 token
