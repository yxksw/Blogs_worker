# Blog Worker

博客系统的后端 API，基于 Cloudflare Workers 构建。

[![API](https://img.shields.io/badge/API-https://api.danarnoux.com-0f766e?style=for-the-badge&logo=cloudflare&logoColor=white)](https://api.danarnoux.com)
[![前端](https://img.shields.io/badge/前端-DansBlog-1d4ed8?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Dancncn/DansBlog)
[![仓库](https://img.shields.io/badge/仓库-DansBlogs_worker-111827?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Dancncn/DansBlogs_worker)

> **前端**: [DansBlog](https://github.com/Dancncn/DansBlog)
>
> **English Version**: [查看英文文档](../README.md)

## 系统架构

这是一个**前后端分离**的博客架构：

```
┌─────────────────────────────────────────┐
│           Cloudflare Pages              │
│         (Astro 静态博客)                 │
└─────────────────┬───────────────────────┘
                  │ REST API
                  ▼
┌─────────────────────────────────────────┐
│        Cloudflare Worker                │
│   ┌─────────────────────────────────┐   │
│   │  API 处理器 (GitHub OAuth,       │   │
│   │  评论、图片、管理后台)            │   │
│   └─────────────────────────────────┘   │
│   ┌─────────────────────────────────┐   │
│   │  Cloudflare Workers AI           │   │
│   │  (评论 AI 审核)                  │   │
│   └─────────────────────────────────┘   │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
 ┌──────┐     ┌──────┐     ┌────────┐
 │  D1  │     │  R2  │     │   KV   │
 │(SQL) │     │(对象)│     │(缓存)  │
 └──────┘     └──────┘     └────────┘
```

## 功能特性 🚀

| 功能 | 描述 |
|------|------|
| GitHub 登录 | PKCE 授权流程 |
| 邮箱登录 | 通过 Resend 发送魔法链接 |
| 评论系统 | 按文章隔离，AI 辅助审核 |
| 图片托管 | R2 对象存储 |
| 限流机制 | Durable Objects + KV |
| AI 审核 | Cloudflare Workers AI 自动审核评论 |
| 管理员后台 | Cloudflare Access 保护（开发中） |

## API 端点 📡

### 认证

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/auth/github/start` | GET | 启动 GitHub OAuth |
| `/api/auth/github/callback` | GET | 处理 OAuth 回调 |
| `/api/auth/email/send` | POST | 发送登录链接 |
| `/api/auth/email/verify` | GET | 验证登录令牌 |
| `/api/auth/logout` | POST | 登出 |
| `/api/me` | GET | 获取当前用户信息 |

### 内容

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/comments` | GET | 获取文章评论 |
| `/api/comments` | POST | 创建评论（需登录） |

### 媒体

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/upload` | POST | 上传图片到 R2（需登录） |
| `/api/images` | GET | 列出已上传图片 |
| `/api/images` | DELETE | 删除图片 |

### 管理员（需 Cloudflare Access）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/admin/check` | GET | 检查管理员状态 |
| `/api/admin/stats` | GET | 评论统计 |
| `/api/admin/comments` | GET | 获取所有评论 |
| `/api/admin/comment/approve` | POST | 批准评论 |
| `/api/admin/comment/reject` | POST | 拒绝评论 |
| `/api/admin/comment` | DELETE | 删除评论 |

## 数据模型

### 用户
```sql
users(id, github_id, login, name, email, avatar_url, is_admin, created_at)
```

### 会话
```sql
sessions(id, user_id, token, expires_at, created_at)
```

### 评论
```sql
comments(id, parent_id, post_slug, user_id, body, status, created_at, updated_at)
```

### 图片
```sql
images(id, user_id, name, url, size, created_at)
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 数据库 | Cloudflare D1 (SQLite) |
| 对象存储 | Cloudflare R2 |
| 限流 | Durable Objects + KV |
| AI | Cloudflare Workers AI (Llama 3) |
| 认证 | GitHub OAuth + 邮箱魔法链接 |
| 邮件 | Resend |
| 验证码 | Cloudflare Turnstile |

## 前端集成

Astro 前端通过 REST API 调用此服务：

```typescript
const API_BASE = 'https://api.danarnoux.com';

fetch(`${API_BASE}/api/comments?slug=my-post`, {
  headers: { Authorization: `Bearer ${token}` }
})
```

## 部署

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 部署到生产
npm run deploy
```

## 项目结构

```
worker/
├─ src/
│  └─ index.ts          # 所有 API 路由处理
├─ db/
│  └─ schema.sql        # D1 数据库 Schema
├─ docs/
│  └─ README.zh-CN.md   # 中文文档
└─ wrangler.toml        # Cloudflare 配置（不提交到 git）
```

> **注意**: `wrangler.toml` 包含基础设施绑定，已从 git 排除。配置通过环境变量或 `wrangler secret put` 设置。
