---
title: 聊天与会话
description: 同意制会话、私聊请求、群组与邀请、消息收发与编辑、@提及、转发、群公告/待办/文件、E2EE 密钥与历史搜索。
sidebar:
  order: 7
---

聊天是**同意制**的：发起私聊或邀请入群都会创建一条**同意请求**，对方接受后才存在会话。

## 端点一览

### 同意请求

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/consent-requests` | `chat.request.approve` | 我的待处理请求 |
| POST | `/consent-requests/:id/accept` | `chat.request.approve` | 接受 |
| POST | `/consent-requests/:id/decline` | `chat.request.approve` | 拒绝（`204`） |

### 会话与群组

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/conversations` | `chat.view` | 我的会话（含 `last_message`、`unread_count`） |
| POST | `/conversations` | `chat.group.create` | 建群（调用者为 owner） |
| POST | `/conversations/start` | `chat.request.send` | 发起私聊（发请求） |
| GET | `/conversations/public` | `chat.view` | 公开群列表 |
| GET | `/conversations/:id` | `chat.view` | 会话详情 |
| POST | `/conversations/:id/invite` | `chat.group.invite` | 邀请（发请求） |
| POST | `/conversations/:id/join` | `chat.group.manage` | 加入公开群 |
| POST | `/conversations/:id/leave` | `chat.group.manage` | 退群（owner 不能退） |
| DELETE | `/conversations/:id` | `chat.group.manage` | 解散会话 |
| PUT | `/conversations/:id/settings` | `chat.group.manage` | 群设置 |
| PUT | `/conversations/:id/title` | `chat.group.manage` | 改群名 |
| PUT | `/conversations/:id/avatar` | `chat.group.manage` | 改群头像 |
| POST/DELETE | `/conversations/:id/mute-all` | `chat.group.manage` | 全员禁言开关 |
| DELETE | `/conversations/:id/members/:user_id` | `chat.group.manage` | 移出成员 |
| PUT | `/conversations/:id/members/:user_id/role` | `chat.group.manage` | 改成员角色 |
| PUT | `/conversations/:id/members/:user_id/title` | `chat.group.manage` | 设成员头衔 |
| POST/DELETE | `/conversations/:id/members/:user_id/mute` | `chat.group.manage` | 单人禁言 |
| PUT | `/conversations/:id/note` | `chat.note.edit` | 私聊备注 |
| PUT | `/conversations/:id/group-nickname` | `chat.group.nickname` | 我的群昵称 |
| PUT | `/conversations/:id/notify-level` | `chat.view` | 通知级别 |
| POST | `/conversations/:id/read` | `chat.view` | 标记已读 |
| POST | `/conversations/:id/typing` | `chat.view` | 正在输入 |

### 消息

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/conversations/:id/messages` | `chat.view` | 消息列表（`before` 向前翻页） |
| POST | `/conversations/:id/messages` | `chat.send` | 发消息 |
| PUT | `/conversations/:id/messages/:message_id` | `chat.edit` | 编辑自己的消息 |
| DELETE | `/conversations/:id/messages/:message_id` | `chat.delete` | 软删除 |
| POST | `/conversations/:id/messages/:message_id/read` | `chat.view` | 单条已读回执 |
| POST | `/conversations/:id/messages/forward` | `chat.send` | 转发消息 |
| GET | `/conversations/:id/messages/search` | `chat.view` | 历史搜索 |

### 群扩展与加密

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/conversations/:id/announcements` | `chat.view` | 群公告 |
| POST | `/conversations/:id/announcements` | `chat.group.manage` | 发公告 |
| DELETE | `/conversations/:id/announcements/:announcement_id` | `chat.group.manage` | 删公告 |
| GET | `/conversations/:id/todos` | `chat.view` | 群待办 |
| POST | `/conversations/:id/todos` | `chat.view` | 加待办 |
| PUT | `/conversations/:id/todos/:todo_id` | `chat.view` | 勾选完成（任意成员） |
| DELETE | `/conversations/:id/todos/:todo_id` | `chat.view` | 删待办 |
| GET | `/conversations/:id/files` | `chat.view` | 会话内已分享文件 |
| GET | `/conversations/:id/e2ee-keys` | `chat.view` | 取密钥信封 |
| POST | `/conversations/:id/e2ee-keys` | `chat.group.manage` | 发布/更新密钥信封 |

## 私聊与群组

### 发起私聊（发请求）

```http
POST /conversations/start
{ "user_id": 2, "message": "你好！", "encrypted": false }
```

`201 {"message":"chat request sent"}`。这只是**发请求**，不创建会话。

| 状态 | 场景 |
| --- | --- |
| `409` | 已有待处理请求：`a chat request is already pending` |
| `400` | 给自己发：`cannot start a chat with yourself` |

### 接受 / 拒绝请求

```http
POST /consent-requests/:id/accept
```

```json
{ "message": "request accepted", "conversation": { "id": 5, "type": "private", "title": null } }
```

拒绝返回 `204 No Content`。

### 建群与邀请

```http
POST /conversations          { "title": "Family" }          → 201，调用者为 owner
POST /conversations/:id/invite   { "user_id": 3, "message": "来一起" }   → 201 {"message":"invite sent"}
```

邀请同样走同意请求。公开群可由成员自助加入（`POST /conversations/:id/join`）。

### 会话详情

```http
GET /conversations/:id
```

```json
{
  "conversation": { "id": 5, "type": "private", "title": null },
  "members": [],
  "my_membership": { "user_id": 1, "role": "member", "group_nickname": null,
                     "note": null, "last_read_message_id": 0 }
}
```

返回含 `encrypted` 标记——接入加密会话前先检查它。

## 消息

### 发送

```http
POST /conversations/:id/messages
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | string | ≤5000 字符 |
| `reply_to_id` | int64? | 引用某条消息 |
| `attachment_ids` | []int64 | 最多 9 个 |
| `mentions` | []int64 | 被 @ 的用户 id；`-1` 表示 @everyone |
| `check_id` | int64 | 红包消息 |
| `burn_seconds` | int | 阅后即焚：`0` 或 `5..86400` |

`content`、`attachment_ids`、`check_id` **至少提供一个**，否则 `400 {"error":"message cannot be empty"}`。

### 消息对象中值得留意的字段

| 字段 | 说明 |
| --- | --- |
| `sender_id` | 发送者；判断“是不是我自己” |
| `sender_is_bot` | 发送者是否 bot |
| `kind` | `text` \| `check` \| `call` \| `system.join` \| `system.leave` \| `system.mute` … |
| `mentions` | 被 @ 用户 id 列表，`-1` = @everyone |
| `deleted_at` | 软删除时间（列表已过滤） |
| `edited_at` | 编辑时间，存在即表示改过 |
| `burn_seconds` / `burn_at` | 阅后即焚倒计时 |
| `call_meta` | 通话记录消息的结果与时长 |

### 列表（只能是往前翻）

```http
GET /conversations/:id/messages?limit=50&before=12345
```

- `limit` 默认 50，1..100 之外会被重置为 50；
- `before` 取更旧的消息；不传取最新一页；
- 返回**时间正序**（旧 → 新），最新一条是 `messages[-1]`；
- **没有 `after`**，取新消息需轮询 + 按 id 去重，或改用 WebSocket。

### 编辑与软删除

```http
PUT    /conversations/:id/messages/:message_id   { "content": "改过了" }
DELETE /conversations/:id/messages/:message_id   → 204
```

软删除写 `deleted_at`，列表不再返回。

### 转发与已读

```http
POST /conversations/:id/messages/forward     # 转发（目标会话在请求体中）
POST /conversations/:id/read                 { "last_message_id": 42 }  → 204
POST /conversations/:id/messages/:message_id/read                       # 单条已读回执
```

## 历史搜索

```http
GET /conversations/:id/messages/search?q=季度报告&sender_id=42&from=2026-08-01&to=2026-08-31&has_attachment=true&file_name=report&limit=50
```

所有条件可选、以 AND 组合。

| 参数 | 说明 |
| --- | --- |
| `q` | 内容子串，不区分大小写 |
| `sender_id` | 仅该发送者 |
| `from` / `to` | `created_at` 闭区间（RFC3339 或 Unix 秒） |
| `has_attachment` | 仅带附件的消息 |
| `file_name` | 附件原始文件名子串（隐含 `has_attachment`） |
| `limit` | 默认 50，钳制到 1..100 |

- 只匹配普通文本消息：系统消息（`system.*`）与已软删除的消息**永不**命中；
- 结果**最新在前**（与按时间正序的普通列表相反）；
- **E2EE 会话中服务端只有密文**，`q` / `file_name` 无法匹配明文，客户端应改为搜索本地解密缓存。

错误：`400` 参数非法、`403` 非成员且非公开群。

## 群扩展

### 公告

```http
GET    /conversations/:id/announcements
POST   /conversations/:id/announcements
DELETE /conversations/:id/announcements/:announcement_id
```

成员可读，管理权限可写。

### 待办

```http
GET    /conversations/:id/todos
POST   /conversations/:id/todos
PUT    /conversations/:id/todos/:todo_id   { "done": true }    # 任意成员可勾选
DELETE /conversations/:id/todos/:todo_id
```

### 会话文件

```http
GET /conversations/:id/files
```

直接从 `message_attachments` 关联得到，**不重复存储**，最新在前。

## 端到端加密（E2EE）

会话可能被标记为 `encrypted`：消息以**密文**存储，只有持有群密钥的客户端能解密。

- 群密钥以**每成员信封**（X25519 公钥封装）分发，通过 `GET|POST /conversations/:id/e2ee-keys` 存取；
- 加人或轮换密钥时需更新版本；
- 服务端**不代劳加解密**，因此 E2EE 会话里的 `content` 对任何读接口都是密文；
- 红包消息（`kind = "check"`）不含明文内容，在 E2EE 会话中同样可用。

> **客户端接入建议**：`encrypted: true` 的会话要么实现完整密钥流程，要么跳过并记录原因——不要把密文当明文处理。

## 常见错误

| 状态 | 场景 |
| --- | --- |
| `400` | 消息三个字段全空；`burn_seconds` 非法；给自己发会话请求 |
| `403` | 非会话成员读消息；缺 `chat.*` 权限 |
| `409` | 已有待处理私聊请求 |