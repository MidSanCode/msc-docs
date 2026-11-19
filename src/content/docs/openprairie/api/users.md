---
title: 用户与档案
description: 我的档案、头像与横幅、权限自查、用户搜索、关注与好友、隐私、名称样式、存储桶分配、每日奖励、注销账号。
sidebar:
  order: 3
---

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/users/me` | 需认证 | 我的完整档案 |
| PUT | `/users/me` | `account.profile.edit` | 改用户名/昵称/简介 |
| GET | `/users/me/permissions` | 需认证 | 我的权限键与用户组 |
| POST | `/users/me/avatar` | `account.avatar.edit` | 上传头像 |
| POST | `/users/me/banner` | `account.banner.edit` | 上传横幅 |
| PUT | `/users/me/locale` | 需认证 | 区域与语言 |
| PUT | `/users/me/privacy` | 需认证 | 隐私开关 |
| PUT | `/users/me/name-style` | `account.profile.edit` | 名称样式（会员能力） |
| PUT | `/users/me/e2ee-key` | 需认证 | 发布 X25519 公钥 |
| POST | `/users/me/claim-daily-bonus` | 需认证 | 领取每日奖励 |
| POST | `/users/me/heartbeat` | 需认证 | 在线心跳 |
| POST | `/users/me/deletion-request` | 需认证 | 申请注销 |
| DELETE | `/users/me/deletion-request` | 需认证 | 撤回注销申请 |
| GET | `/users/search?q=&limit=` | 需认证 | 搜索用户 |
| GET | `/users/:user_id` | 公开 | 他人档案 |
| PUT | `/users/:user_id/exp` | `user.adjust_exp` | 调整他人经验 |
| PUT | `/users/:user_id/membership` | `user.membership.grant` | 授予会员 |
| POST/DELETE | `/users/:user_id/follow` | `account.follow` | 关注 / 取关 |
| GET | `/users/:user_id/followers` | 公开 | 粉丝列表 |
| GET | `/users/:user_id/following` | 公开 | 关注列表 |
| GET | `/users/:user_id/friends` | 公开 | 好友（互关）列表 |
| GET | `/users/storage-buckets` | 需认证 | 存储桶清单与锁定状态 |
| PUT | `/users/me/storage-bucket` | 需认证 | 切换存储桶 |

## 我的档案

```http
GET /users/me
```

```json
{
  "id": 1,
  "username": "alice",
  "nickname": "Alice",
  "avatar_url": "https://...",
  "storage_quota": 104857600,
  "storage_used": 2048000
}
```

返回还包含会员字段、名称样式字段与 `is_bot`（bot 账号）。`storage_quota` 是**有效配额**（基础配额 + 生效中的会员加成）。

### 修改档案

```http
PUT /users/me
{ "username": "alice", "nickname": "Alice", "bio": "..." }
```

三个字段均可选，但至少提供一个。用户名沿用注册时的唯一性规则。调用后清除 `needs_registration`。

> 这个接口**只**接受 `username` / `nickname` / `bio`——改不到 bot 标记与归属关系。

### 头像与横幅

```http
POST /users/me/avatar      Content-Type: multipart/form-data   file=<图片>
POST /users/me/banner      Content-Type: multipart/form-data   file=<图片>
```

两者都**计入存储配额**。

### 区域与语言

```http
PUT /users/me/locale
{ "region": "CN", "lang": "zh-CN" }
```

用于日期边界与推送语言。

### 在线心跳

```http
POST /users/me/heartbeat    → 200 {"online": true}
```

更新 `last_seen`。

## 权限自查

```http
GET /users/me/permissions
```

```json
{ "permissions": ["posts.view", "posts.create", "chat.send"], "groups": ["admin", "beta-users"] }
```

该接口**不需要任何权限**即可调用（否则无法完成注册收尾），是启动时确认“我到底能做什么”的可靠方式。完整键表见[服务端概览](/openprairie/#权限模型)。

## 用户搜索与查看

```http
GET /users/search?q=alice&limit=20     # 按用户名或昵称子串匹配
GET /users/:user_id                    # 公开档案
```

```json
{ "users": [{ "id": 2, "username": "alice", "nickname": "Alice", "avatar_url": null }] }
```

`GET /users/:user_id` 是 `authPublic`：带 token 时结果会附带 `is_following` / `is_friend` 等个性化字段。

## 关注与好友

```http
POST   /users/:user_id/follow      # 关注
DELETE /users/:user_id/follow      # 取关
```

互相关注的两人成为**好友**。列表：

```http
GET /users/:user_id/followers
GET /users/:user_id/following
GET /users/:user_id/friends
```

档案里带 `follower_count` / `following_count` 与 `is_following` / `is_friend`。

### 隐私

```http
PUT /users/me/privacy
{ "hide_follow_lists": true }
```

开启后，三个列表对除本人以外的所有人返回 `403`，且他/她的档案中不再返回粉丝/关注数。

## 名称样式（会员能力）

```http
PUT /users/me/name-style
```

可设置 `name_color`、`name_color_to`（渐变第二色）、`name_dynamic`（动态渐变）。按会员等级限制：

| 等级 | 允许 |
| --- | --- |
| Lv.1 薄雾 | 仅预设调色板 |
| Lv.2 篝火 | 任意合法十六进制色 |
| Lv.3 明月 | 追加渐变第二色 |
| Lv.4 孤星 | 追加动态渐变 |

Lv.1 的“仅预设”由服务端强制校验，不依赖客户端。

## 经验与会员（管理操作）

```http
PUT /users/:user_id/exp         { "..." }        # 权限 user.adjust_exp
PUT /users/:user_id/membership  { "level": 2, "days": 30 }   # 权限 user.membership.grant
```

会员授予传 `level: 0` 表示清除。经验加成在 `GrantExp` 内按生效会员倍率放大。详见[任务与会员](/openprairie/api/tasks/)。

## 存储桶分配

服务端支持**物理多桶对象存储**：每个逻辑桶映射到独立的 S3 桶，并可要求最低会员等级。

```http
GET /users/storage-buckets
```

返回桶的 `name`、`label`、`default_quota`、`min_member_level`、`is_default`、`locked`（当前用户是否可用），以及用户当前的 `current` 桶。

```http
PUT /users/me/storage-bucket
{ "bucket": "star" }
```

- 未知桶 → `400`；会员等级不足 → `403`；
- 切换后配额重置为目标桶的 `default_quota`；
- **已有附件不会迁移**，其记录保留上传时的桶，删除时仍解析到正确的物理存储；
- 会员加成配额**只在默认桶生效**。

## 每日奖励与注销

### 每日奖励

```http
POST /users/me/claim-daily-bonus
```

按服务器日（`GAME_TIMEZONE` 定义的边界）发放一次经验与货币（默认 `100` exp / `20` 币）。返回含连续签到天数。

### 注销账号

```http
POST   /users/me/deletion-request     # 申请注销
DELETE /users/me/deletion-request     # 撤回
```

申请后账号**立即从各处隐藏、登录被拒**，数据行在 **30 天**后清除；期间可撤回。

> bot 与普通账号不同：删除 bot（或删除其所有者）会级联删除它的帖子、评论、消息、附件与会话/营地成员关系，不可恢复。

## 存储用量

```http
GET /storage/usage
```

返回已用字节数，配合 `storage_quota` 展示配额进度。详见[附件与存储](/openprairie/api/storage/)。