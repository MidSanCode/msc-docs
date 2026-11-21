---
title: Bot Development Guide
description: Develop bot accounts on OpenPrairie—creation, ofb_ static-token authentication, capability boundaries, real-time events, and practical examples.
sidebar:
  order: 2
---

A bot is **an ordinary user row** with three distinguishing fields:

| Field | Value | Meaning |
| --- | --- | --- |
| `users.is_bot` | `TRUE` | Bot flag; clients display a badge next to the name |
| `users.bot_owner_id` | The creator's (human) user id | Ownership; the bot is deleted by cascade when its owner is deleted |
| `users.password_hash` | 24 random bytes | Never matches any password, so a bot **cannot log in interactively** |

It also has `role='user'` and `needs_registration=FALSE`, and automatically joins the built-in default group “Everyone” when created.

This has three important consequences:

1. **A bot behaves as a normal user throughout the system**—when posting, sending messages, joining groups, or joining camps, it acts under its own name (with its own nickname, avatar, and badge).
2. **A bot has no additional capabilities or restrictions**: the server does not block any endpoint based on `is_bot`, with one exception: **a bot cannot create another bot**.
3. **A bot's permissions depend entirely on its user groups**. A new bot belongs to the default group and receives the same permissions as an ordinary registered user.

**Authentication** uses a static API token (prefixed with `ofb_`), rather than a username/password or an expiring JWT. Each bot has exactly one token (`bot_tokens.user_id` is the primary key); resetting it immediately invalidates the old token.

## Quick Start

Let `$BASE` be the server address (locally, `http://localhost:8080` by default; usually an HTTPS domain in production). All endpoints are under the gateway's `/api/v1` prefix.

### 1. Create a Bot Using a Human Account

Creation uses **your own login credentials** (a JWT, or your own bot token), not the new bot's token:

```bash
curl -s -X POST "$BASE/api/v1/bots" \
  -H "Authorization: Bearer $MY_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"weather_watcher","nickname":"Weather Watcher"}'
```

```json
{
  "user": {
    "id": 4242,
    "username": "weather_watcher",
    "nickname": "Weather Watcher",
    "is_bot": true,
    "bot_owner_id": 7,
    "created_at": "2026-10-10T15:20:12Z"
  },
  "token": "ofb_9f2c…<64 hex digits>"
}
```

:::caution
**This is the only time `token` is returned.** The server stores only its SHA-256 hash. If you lose it, you must reset it; it cannot be recovered. Store it in a secret manager or environment variable immediately.
:::

You can also create a bot in the client app: Account → “My Bots” → “New”.

### 2. Verify the Token

```bash
export BOT_TOKEN="ofb_9f2c…"
curl -s "$BASE/api/v1/users/me" -H "Authorization: Bearer $BOT_TOKEN"
```

The returned `id` is `4242`—**the bot acts as itself**. The gateway derives `X-User-ID` from the token, so downstream services see the bot's own id, not the creator's.

### 3. Publish a Post

```bash
curl -s -X POST "$BASE/api/v1/posts" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Sunny in Beijing today, 21°C.","visibility":"public"}'
```

Returns `201` + the post object itself.

### 4. Send a Chat Message

```bash
curl -s "$BASE/api/v1/conversations" -H "Authorization: Bearer $BOT_TOKEN"     # Find the conversation id

curl -s -X POST "$BASE/api/v1/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Got it, I'll take care of it."}'
```

:::note
Direct chats require **consent**: a bot cannot send messages directly to an unfamiliar user. It must first send a conversation request with `POST /api/v1/conversations/start`. The conversation exists only after the recipient accepts.
:::

## Authentication Details

### Request Header

```http
Authorization: Bearer ofb_<64 lowercase hexadecimal digits>
```

A token always consists of `ofb_` + the hexadecimal representation of 32 random bytes (**68 characters** in total). The `ofb_` prefix is the gateway's sole criterion for identifying a bot token: it selects the bot-token parsing path when present; otherwise, the gateway parses the token as a JWT.

### What the Gateway Does

1. Reads the `Authorization` header and strips `Bearer `;
2. If the token starts with `ofb_`, looks up its hash in `bot_tokens` and uses `JOIN users` to verify `is_bot`;
3. If a match is found, returns the bot's user id and updates `last_used_at` on a best-effort basis (an update failure does not affect the request);
4. Sets the internal header `X-User-ID: <bot id>` and forwards the request. A client-supplied `X-User-ID` is overwritten or removed, so **it cannot be used to impersonate another user**.

### Routes That Accept Bot Tokens

| Route level | Accepted? |
| --- | --- |
| `authPublic` | ✅ Yes; also personalizes the response (for example, the current user's like status) |
| `authRequired` | ✅ Yes |
| `authPermission` | ✅ Yes; permissions are determined by the bot's groups |
| `authTicket` (`GET /ws`) | Identity headers are removed; only a one-time ticket is accepted |
| **`GET /api/v1/files/...`** | ❌ **No** |

:::caution[Object Storage Paths Do Not Accept Bot Tokens]
`GET /api/v1/files/...` is absent from the route table (object keys contain multiple slash-separated segments). The gateway handles it specially in `NoRoute`, where the code **parses JWTs only**. If parsing fails, it removes `X-User-ID` and forwards the request anonymously. A bot token on this path is therefore **equivalent to being unauthenticated**: public objects are accessible, but **private objects are not**.

To read private attachments from a bot, use the individual services' normal routes, such as `GET /api/v1/conversations/:id/files` (which is in the route table and accepts bot tokens).
:::

### Failure Responses

| Situation | Response |
| --- | --- |
| No `Authorization` header | `401 {"error":"missing authorization token"}` |
| Token reset / nonexistent / bot banned | `401 {"error":"invalid bot token"}` |
| Token present but required endpoint permission missing | `403 {"error":"permission denied","permission":"<permission key>"}` |

:::note
**A banned bot receives `401`, not `403`.** Token parsing rejects bots whose `status='banned'` has not expired, so the request never reaches the later `403 {"error":"account is banned"}` check used for JWT users. Client implementations should handle this as a 401 “token invalid” condition.
:::

## Next Steps

- **[Management API and Capabilities](/en/openprairie/bots/api/)** — Create/list/reset/delete, the complete table of APIs available to bots, and permission boundaries
- **[Real-Time Events](/en/openprairie/bots/events/)** — WebSocket tickets, event format, and connection maintenance
- **[Cookbook and Limitations](/en/openprairie/bots/cookbook/)** — Chat bots, content bots, E2EE, error codes, and best practices
