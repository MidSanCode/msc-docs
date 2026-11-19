---
title: Bot 开发指南
description: 在 OpenPrairie 上开发机器人账号：创建、ofb_ 静态 token 认证、能力边界、实时事件与实战。
sidebar:
  order: 2
---

Bot 是**一个普通的用户行**，只是带了三个标记：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `users.is_bot` | `TRUE` | 机器人标记，客户端在名字旁显示徽章 |
| `users.bot_owner_id` | 创建者（人类）的 user id | 归属关系，随所有者删除而级联删除 |
| `users.password_hash` | 24 字节随机数 | 永远匹配不上任何密码，因此 bot **无法交互式登录** |

此外它的 `role='user'`、`needs_registration=FALSE`，创建时自动加入内置默认组「所有人」。

由此推出三条重要结论：

1. **Bot 在系统各处都表现为正常用户**——发帖、发消息、进群、加营地，署名都是它自己（自己的昵称、头像、徽章）。
2. **Bot 没有额外能力，也没有额外限制**：服务端没有任何一处对 `is_bot` 做接口级拦截，唯一例外是 **bot 不能再创建 bot**。
3. **Bot 的权限完全取决于它所在的用户组**；新建 bot 落在默认组，拿到的是「普通注册用户」那套权限。

**认证方式**是静态 API token（`ofb_` 前缀），不是账号密码，也不是有时效的 JWT。Token 与 bot 一一对应（`bot_tokens.user_id` 是主键），重置即旧 token 立即失效。

## 快速上手

设服务端地址为 `$BASE`（本地默认 `http://localhost:8080`，线上通常是 HTTPS 域名），所有接口都在网关的 `/api/v1` 之下。

### 1. 用人类账号创建 bot

创建用的是**你自己的登录凭据**（JWT，或你自己的 bot token 也行），不是新 bot 的 token：

```bash
curl -s -X POST "$BASE/api/v1/bots" \
  -H "Authorization: Bearer $MY_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"weather_watcher","nickname":"天气预报"}'
```

```json
{
  "user": {
    "id": 4242,
    "username": "weather_watcher",
    "nickname": "天气预报",
    "is_bot": true,
    "bot_owner_id": 7,
    "created_at": "2026-10-10T15:20:12Z"
  },
  "token": "ofb_9f2c…（64 位十六进制）"
}
```

:::caution
**`token` 只在这里出现这一次。** 服务端只存它的 SHA-256 哈希，丢了只能重置，找不回来。请立刻写进密钥管理或环境变量。
:::

也可以从客户端 App 创建：账号页 →「我的机器人」→「新建」。

### 2. 验证 token

```bash
export BOT_TOKEN="ofb_9f2c…"
curl -s "$BASE/api/v1/users/me" -H "Authorization: Bearer $BOT_TOKEN"
```

返回的 `id` 就是 `4242`——**bot 以自己身份行动**：`X-User-ID` 由网关按 token 解析，下游服务看到的是 bot 自己的 id，不是创建者的。

### 3. 发一条帖子

```bash
curl -s -X POST "$BASE/api/v1/posts" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"今天北京 21°C，晴。","visibility":"public"}'
```

`201` + 帖子对象本身。

### 4. 发一条聊天消息

```bash
curl -s "$BASE/api/v1/conversations" -H "Authorization: Bearer $BOT_TOKEN"     # 找会话 id

curl -s -X POST "$BASE/api/v1/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"收到，我来处理。"}'
```

:::note
私聊是**同意制**：bot 不能直接给陌生用户发消息。必须先 `POST /api/v1/conversations/start` 发出会话请求，对方接受后才存在会话。
:::

## 认证细节

### 请求头

```http
Authorization: Bearer ofb_<64 位小写十六进制>
```

Token 固定为 `ofb_` + 32 字节随机数的十六进制（共 **68 个字符**）。前缀 `ofb_` 是网关识别 bot token 的唯一依据——看到它就这走 bot 解析路径，否则按 JWT 解析。

### 网关做了什么

1. 取 `Authorization` 头，剥掉 `Bearer `；
2. 以 `ofb_` 开头 → 按 token 哈希查 `bot_tokens` 并 `JOIN users` 校验 `is_bot`；
3. 命中则返回 bot 的 user id，并顺带更新 `last_used_at`（best-effort，失败不影响请求）；
4. 设置内部头 `X-User-ID: <bot id>` 后转发；客户端自己伪造的 `X-User-ID` 会被覆盖或删除，**无法冒充他人**。

### 哪些路由认 bot token

| 路由级别 | 是否认 |
| --- | --- |
| `authPublic` | ✅ 认，且会让返回“个性化”（如自己的点赞状态） |
| `authRequired` | ✅ 认 |
| `authPermission` | ✅ 认，权限按 bot 所在组判定 |
| `authTicket`（`GET /ws`） | 身份头被删除，只认一次性票据 |
| **`GET /api/v1/files/...`** | ❌ **不认** |

:::caution[对象存储路径不认 bot token]
`GET /api/v1/files/...` 不在路由表里（对象 key 含多段斜杠），网关在 `NoRoute` 中特判，那段代码**只用 JWT 解析**，失败就把 `X-User-ID` 删掉当匿名转发。结果是 bot token 在这条路径上**等价于未登录**：公开对象能取，**私有对象取不到**。

想在 bot 里读私有附件，得走各服务自己的正常路由，例如 `GET /api/v1/conversations/:id/files`（在路由表里，认 bot token）。
:::

### 失败长什么样

| 情况 | 响应 |
| --- | --- |
| 没有 `Authorization` 头 | `401 {"error":"missing authorization token"}` |
| token 被重置 / 不存在 / bot 被封禁 | `401 {"error":"invalid bot token"}` |
| 有 token 但缺该接口所需权限 | `403 {"error":"permission denied","permission":"<权限键>"}` |

:::note
**封禁的 bot 返回 `401` 而不是 `403`。** 解析阶段就拒绝 `status='banned'` 且未到期的 bot，请求走不到后面给 JWT 用户的 `403 {"error":"account is banned"}` 检查。写客户端时按 401 处理“token 失效”。
:::

## 接下来

- **[管理接口与能力清单](/openprairie/bots/api/)** —— 创建/列表/重置/删除，bot 能调用的完整 API 表，权限边界
- **[实时事件](/openprairie/bots/events/)** —— WebSocket 票据、事件格式与连接维护
- **[实战与限制](/openprairie/bots/cookbook/)** —— 聊天机器人、内容机器人、E2EE、错误码、最佳实践