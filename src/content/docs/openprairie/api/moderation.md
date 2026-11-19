---
title: 审核与处罚
description: 举报（帖子/消息/用户）、举报队列与去重配额，以及处罚类型、封禁在请求链路上的生效方式。
sidebar:
  order: 11
---

两块能力都在 Account 服务：**举报**（任何登录用户可用）与**处罚**（需要管理权限）。审核在 Flask 管理面板进行，服务端只负责记录与列表。

## 举报

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/reports` | 需认证 | 提交举报 |
| GET | `/reports/mine?limit=` | 需认证 | 我提交过的举报（默认 50，上限 100） |

### 提交

```http
POST /reports
{ "target_type": "post", "target_id": 123, "reason": "垃圾广告" }
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `target_type` | string | ✅ | `post` \| `message` \| `user` |
| `target_id` | int | ✅ | 被举报内容的 id |
| `reason` | string | ✅ | 1–500 字符 |

成功 `201` + 举报记录。

### 记录字段

| 列 | 含义 |
| --- | --- |
| `reporter_id` | 举报人（级联删除） |
| `target_type` / `target_id` | 目标类型与 id |
| `reason` | 自由文本，≤500 字符 |
| `status` | `pending` / `reviewed` / `dismissed` |
| `reviewer_id` / `reviewer_username` | 处理人及反规范化名字（历史不受账号变更影响） |
| `review_note` | 运营备注 |
| `created_at` / `reviewed_at` | 提交与处理时间 |

`(target_type, target_id)` 刻意**不设外键**：三类目标分处三张表，且**目标被删除后不应抹掉“曾被举报”的记录**。id 在写入时校验，面板对被删目标显式标注。

### 守卫

| 条件 | 响应 |
| --- | --- |
| 未知 `target_type` | `400` |
| `target_id` ≤ 0、`reason` 为空或超长 | `400` |
| 举报自己（`user` 类型且 id 是自己） | `400` |
| 目标不存在 | `404` |
| 同一目标已有**待处理**举报 | `409` |
| 一小时内举报超过 **20** 条 | `429` |

`409` 来自部分唯一索引 `idx_reports_one_open ON (reporter_id, target_type, target_id) WHERE status = 'pending'`；冲突被翻译成明确错误而不是 500。举报被处理后槽位释放，同一目标可再次举报。

### 处理

在管理面板（`/reports`，能力 `reports.manage`）进行：默认列出待处理，可按状态与目标类型筛选；处理时写入 `status`、`reviewer_*`、`review_note`、`reviewed_at` 并记 `admin_audit_log`。已处理的可重开（回到 `pending` 并清空审核字段），除非同一举报人此后又提交了更新的待处理举报（会撞部分唯一索引，故拒绝并给出说明）。

> **处理举报只是记账**：它本身不处罚谁、也不删除内容。运营需另行删除帖子或处罚用户。

### 删除语义

删除用户会因 `reporter_id ... ON DELETE CASCADE` 连带删除**他提交的**举报；**别人举报他的**记录保留，只是 `target_id` 不再能解析——面板会显式显示目标缺失。

## 处罚

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/users/:id/punishments` | `user.punish` | 施加处罚 |
| GET | `/users/:id/punishments` | `user.punish` | 处罚历史 + 当前生效的权限剥夺 |

### 类型

| 类型 | 含义 | 副作用 |
| --- | --- | --- |
| `warning` | 警告 | 仅记录 |
| `demerit` | 记过 | 仅记录 |
| `revoke` | 剥夺权限 | 写 `user_permission_bans` |
| `temp_ban` | 暂时封禁 | `users.status = 'banned'` + `banned_until` |
| `ban` | 永久封禁 | `users.status = 'banned'`，`banned_until = NULL` |
| `unban` | 解除封禁 | 恢复 `status = 'active'`，清空全部权限剥夺 |
| `restore` | 恢复权限 | 删除对应的 `user_permission_bans` 行 |

### 请求体

```http
POST /users/:id/punishments
{ "type": "temp_ban", "reason": "刷屏", "duration_minutes": 120 }
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `type` | ✅ | 上表之一 |
| `reason` |  | 说明文本 |
| `permission_key` | `revoke`/`restore` 必填 | 要剥夺/恢复的权限键 |
| `duration_minutes` | `temp_ban` 必填 | 封禁时长（分钟） |

记录插入与副作用在同一事务内完成。

### 拦截规则

| 条件 | 响应 |
| --- | --- |
| 处罚自己 | `403 cannot punish yourself` |
| 处罚管理员 | `403 cannot punish an administrator` |
| 权限等级不足以处罚该用户（下级不能罚上级） | `403 insufficient rank to punish this user` |
| `revoke`/`restore` 缺 `permission_key` | `400` |
| `temp_ban` 缺 `duration_minutes` | `400` |
| 未知类型 | `400` |

`user_permission_bans` 保存**当前生效的**被剥夺权限，`GetEffectivePermissions` 解析时排除它——被剥夺的键在所有地方失效，直到 `restore` 或 `unban`。

### 封禁如何生效

`users.status` / `banned_until` 会拦下登录与后续每个请求：

| 环节 | 行为 |
| --- | --- |
| 登录 / OIDC 回调 / refresh | 拒绝 `status = 'banned'` 的用户 |
| `temp_ban` | `banned_until` 过期后自动解除（与 `NOW()` 比较） |
| **请求链路** | 网关每个已认证请求检查一次（`IsBannedCached`），命中直接 `403 {"error":"account is banned","banned":true}`，不转发后端。结果缓存 **30 秒**——新封禁半分钟内生效，不必等下次登录 |
| 已签发的 access token | **不吊销**；封禁靠每请求状态检查实现，而非使 token 失效 |
| 部分路由仍可达 | `GET /users/me`、`GET /users/me/punishments`、`POST /auth/refresh`（refresh 只让客户端看见封禁，不会为封禁用户签发 token） |
| 公开路由（`authPublic`） | **不检查封禁**：被封用户仍能读公开内容，token 在那里仍被用于个性化。**封的是动作，不是读** |
| 被封禁的 **bot** | static token 在解析阶段就失败，所有请求（含公开路由）返回 `401 {"error":"invalid bot token"}` |

## 与 bot 的关系

bot 默认组**没有** `user.punish`，因此 bot **不能**封禁或处罚任何人，只能举报。详见 [Bot 开发指南](/openprairie/bots/)。