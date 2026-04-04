# 评论管理指南 (Comments Management)

## 查看评论

### 查看所有评论（按状态）

```bash
# 查看待审核评论
wrangler d1 execute blog_worker_db --command "SELECT c.id, c.post_slug, c.body, c.status, c.created_at, u.login, u.name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.status = 'pending' ORDER BY c.created_at DESC" --remote

# 查看已拒绝评论
wrangler d1 execute blog_worker_db --command "SELECT c.id, c.post_slug, c.body, c.status, c.created_at, u.login, u.name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.status = 'rejected' ORDER BY c.created_at DESC" --remote

# 查看所有评论（不限状态）
wrangler d1 execute blog_worker_db --command "SELECT c.id, c.post_slug, c.body, c.status, c.created_at, u.login, u.name FROM comments c JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC LIMIT 50" --remote
```

### 按文章查看评论

```bash
# 替换 YOUR_POST_SLUG 为实际的文章 slug
wrangler d1 execute blog_worker_db --command "SELECT c.id, c.body, c.status, c.created_at, u.login, u.name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_slug = 'YOUR_POST_SLUG' ORDER BY c.created_at ASC" --remote
```

### 查看特定用户的评论

```bash
# 替换 USER_ID 为实际的用户 ID
wrangler d1 execute blog_worker_db --command "SELECT id, post_slug, body, status, created_at FROM comments WHERE user_id = 'USER_ID' ORDER BY created_at DESC" --remote
```

---

## 删除评论

### 删除单条评论

```bash
# 替换 COMMENT_ID 为实际的评论 ID
wrangler d1 execute blog_worker_db --command "DELETE FROM comments WHERE id = 'COMMENT_ID'" --remote
```

### 批量删除

```bash
# 删除某文章的所有评论（包括子回复）
wrangler d1 execute blog_worker_db --command "DELETE FROM comments WHERE post_slug = 'YOUR_POST_SLUG'" --remote

# 删除某用户的所有评论
wrangler d1 execute blog_worker_db --command "DELETE FROM comments WHERE user_id = 'USER_ID'" --remote

# 删除所有待审核评论（清理垃圾）
wrangler d1 execute blog_worker_db --command "DELETE FROM comments WHERE status = 'pending'" --remote

# 删除所有已拒绝评论
wrangler d1 execute blog_worker_db --command "DELETE FROM comments WHERE status = 'rejected'" --remote
```

### 批量删除多条（指定 ID 列表）

```bash
# 删除多条指定评论
wrangler d1 execute blog_worker_db --command "DELETE FROM comments WHERE id IN ('ID1', 'ID2', 'ID3')" --remote
```

---

## 修改评论状态

### 批准评论（pending → approved）

```bash
wrangler d1 execute blog_worker_db --command "UPDATE comments SET status = 'approved', updated_at = strftime('%s', 'now') * 1000 WHERE id = 'COMMENT_ID'" --remote
```

### 拒绝评论（pending → rejected）

```bash
wrangler d1 execute blog_worker_db --command "UPDATE comments SET status = 'rejected', updated_at = strftime('%s', 'now') * 1000 WHERE id = 'COMMENT_ID'" --remote
```

### 批量批准

```bash
# 批准某文章的所有待审核评论
wrangler d1 execute blog_worker_db --command "UPDATE comments SET status = 'approved', updated_at = strftime('%s', 'now') * 1000 WHERE post_slug = 'YOUR_POST_SLUG' AND status = 'pending'" --remote

# 批准所有待审核评论
wrangler d1 execute blog_worker_db --command "UPDATE comments SET status = 'approved', updated_at = strftime('%s', 'now') * 1000 WHERE status = 'pending'" --remote
```

---

## 评论状态说明

| 状态 | 说明 |
|------|------|
| `pending` | 待审核，需要管理员批准后才能显示 |
| `approved` | 已批准，已显示在文章下 |
| `rejected` | 已拒绝，不会显示 |

---

## 注意事项

- 所有命令默认使用 `--remote` 连接生产 D1 数据库
- 本地预览使用 `--local` 替代 `--remote`
- D1 执行 DELETE/UPDATE 后不会提示影响行数，建议先用 SELECT 确认
- 评论删除是永久性的，没有回收站
