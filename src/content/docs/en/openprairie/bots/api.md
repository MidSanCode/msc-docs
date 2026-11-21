---
title: Management API and Capabilities
description: Bot creation, listing, token reset, and deletion endpoints; the permission model and default-group boundaries; and a complete table of APIs available to bots, including authentication levels.
sidebar:
  order: 2
---

## Management API

All four endpoints use **a human account's credentials** to manage that account's own bots. Authentication is required for all of them.

### Create

```http
POST /api/v1/bots
```

| Field | Required | Constraints |
| --- | --- | --- |
| `username` | ✅ | `^[a-zA-Z0-9_]{3,32}$` — 3~32 letters, digits, or underscores |
| `nickname` | ✅ | 1~100 characters after trimming leading and trailing whitespace |

Response `201`: `{"user": {…}, "token": "ofb_…"}`. **The token is returned only once.**

| Status | Condition |
| --- | --- |
| `400` | Invalid username / empty or excessively long nickname |
| `401` | Unauthenticated |
| `403` | The caller is itself a bot: `bot accounts cannot create bots` |
| `403` | Bot count limit reached: `bot limit reached` (`limit: 10`) |
| `409` | `username already taken` |
| `500` | Server error |

### List

```http
GET /api/v1/bots
```

```json
{
  "bots": [
    {
      "id": 4242,
      "username": "weather_watcher",
      "nickname": "Weather Watcher",
      "avatar_url": "",
      "created_at": "2026-10-10T15:20:12Z",
      "token_created_at": "2026-10-10T15:20:12Z"
    }
  ],
  "limit": 10
}
```

Use `token_created_at` to determine the token's age (after a reset, it is the reset time; if no token record exists, it falls back to the bot's creation time).

### Reset the Token

```http
POST /api/v1/bots/:id/regenerate
```

`200 {"token":"ofb_…new token…"}`. The old token **immediately becomes invalid** (an atomic replacement with a single-row UPDATE). This is also the only remedy for a leaked token.

| Status | Condition |
| --- | --- |
| `400` | `:id` is not a positive integer |
| `404` | Bot does not exist |
| `403` | `not your bot`—the bot exists but does not belong to you |

### Delete

```http
DELETE /api/v1/bots/:id
```

`200 {"ok": true}`.

:::danger[Irreversible]
The bot's user row is deleted, cascading to its posts, replies, messages, attachments, conversation memberships, and camp memberships (`posts.user_id`, `post_replies.user_id`, `messages.sender_id`, `attachments.user_id`, and `conversation_members.user_id` all use `ON DELETE CASCADE`).
:::

Errors are the same as above (`400`/`404`/`403`).

## Permission Model

The gateway declares an authentication level for each route:

| Level | Meaning |
| --- | --- |
| `authPublic` | Public; when a token is present, identity is still resolved to personalize the response |
| `authRequired` | Authentication required; no specific permission is checked |
| `authPermission` | Authentication + the specified permission key required; otherwise `403` |

A new bot joins the built-in default group “Everyone”, whose permissions are **all permission keys minus seven administrative keys**.

**Administrative permissions unavailable to bots by default** (never granted to the default group):

```
account.verify            Verify users (verification badge)
user.adjust_exp           Modify other users' experience
user.membership.grant     Grant membership to other users
user.punish               Punish/ban other users
wallet.manage             Adjust other users' wallets
plugin.manage             Manage the plugin store
app.announcements.manage  Manage site-wide announcements
```

A bot therefore **can** (depending on the endpoint): create posts and edit/delete its own posts, send messages and edit/delete its own messages, like, favorite, follow, upload attachments, create groups, join groups, send conversation requests, join camps, post in camps, and report content.

It **cannot** ban others, modify other users' wallets/experience/membership, verify other users, or publish site-wide announcements.

### Check Current Permissions

```bash
curl -s "$BASE/api/v1/users/me/permissions" -H "Authorization: Bearer $BOT_TOKEN"
```

If the operator removes the bot from the default group or adds it to a custom group, this endpoint's response changes accordingly—**checking at startup is more reliable than making assumptions**.

The public endpoint `GET /api/v1/capabilities` (no authentication required) lists optional features supported by the current server build, such as `chat.e2ee`, `camps.subgroups`, and `moderation.reports`. Use it to detect the server version's capabilities.

## Capability Reference

The “Authentication” column below comes directly from the gateway route table and is **authoritative**. `authPublic` means the endpoint can be called without a token (providing one adds personalized fields).

### Account

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/users/me` | Required | Own profile (including `is_bot`) |
| PUT | `/users/me` | `account.profile.edit` | Edit nickname, bio, etc. |
| GET | `/users/me/permissions` | Required | Own permission-key list |
| POST | `/users/me/avatar` | `account.avatar.edit` | Upload avatar |
| GET | `/users/search` | Required | Search users |
| GET | `/users/:user_id` | Public | View another user's profile |
| POST/DELETE | `/users/:user_id/follow` | `account.follow` | Follow / unfollow |

### Posts

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| POST | `/posts` | `posts.create` | Create a post |
| GET | `/posts` | Public | Timeline, with `page`/`limit` pagination |
| GET | `/posts/:id` | Public | Single post (records a view) |
| PUT | `/posts/:id` | `posts.edit` | Edit own post |
| DELETE | `/posts/:id` | `posts.delete` | Delete own post |
| GET | `/posts/:id/replies` | Public | Reply list |
| POST | `/posts/:id/replies` | `posts.reply.create` | Create a reply |
| PUT | `/posts/:id/replies/:reply_id` | `posts.reply.edit` | Edit own reply |
| DELETE | `/posts/:id/replies/:reply_id` | `posts.reply.delete` | Delete own reply |
| PUT/DELETE | `/posts/:id/reactions` | `posts.react` | Like / remove like |
| POST/DELETE | `/posts/:id/favorite` | `posts.favorite` | Favorite / remove favorite |
| POST | `/posts/:id/tips` | Required | Tip (requires payment PIN) |
| GET | `/users/:user_id/posts` | Public | A user's posts |

### Chat

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/conversations` | `chat.view` | Own conversation list |
| POST | `/conversations` | `chat.group.create` | Create a group |
| POST | `/conversations/start` | `chat.request.send` | Initiate a direct chat (consent required) |
| GET | `/conversations/public` | `chat.view` | Public group list |
| GET | `/conversations/:id` | `chat.view` | Conversation details |
| GET | `/conversations/:id/messages` | `chat.view` | Message list |
| GET | `/conversations/:id/messages/search` | `chat.view` | Search history |
| POST | `/conversations/:id/messages` | `chat.send` | Send a message |
| POST | `/conversations/:id/messages/forward` | `chat.send` | Forward a message |
| PUT/DELETE | `/conversations/:id/messages/:message_id` | `chat.edit` / `chat.delete` | Edit / delete own message |
| POST | `/conversations/:id/read` | `chat.view` | Mark as read |
| POST | `/conversations/:id/typing` | `chat.view` | Typing indicator |
| POST | `/conversations/:id/join` | `chat.group.manage` | Join a public group |
| POST | `/conversations/:id/invite` | `chat.group.invite` | Invite members |
| POST | `/conversations/:id/leave` | `chat.group.manage` | Leave a group |
| GET | `/conversations/:id/files` | `chat.view` | Files shared in the conversation (**the proper route for reading private attachments**) |
| GET | `/conversations/:id/todos`, etc. | `chat.view` | Group to-dos (read/write) |

### Camps

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/camps` | Public | Camp directory (excludes hidden camps) |
| POST | `/camps` | Required | Create a camp (subject to creation quota; top-level camps only) |
| GET | `/camps/:id` | Public | Camp details (404 for nonmembers of hidden camps) |
| PUT/DELETE | `/camps/:id` | Required | Edit / delete (requires owner/admin; deletion requires owner) |
| GET | `/camps/:id/posts` | Public | Camp posts (visible to members) |
| POST | `/camps/:id/join` | Required | Join |
| DELETE | `/camps/:id/members/me` | Required | Leave |
| GET | `/camps/:id/members` | Required | Member list (members only) |
| GET | `/camps/:id/subgroups` | Public | Subgroup list (handler allows parent-camp members only) |
| POST | `/camps/:id/subgroups` | Required | Create a subgroup (requires parent-camp owner/admin) |

:::note
To post in a camp, include `camp_id` in `POST /posts`. **You must join the camp first**; otherwise, the response is `403 {"error":"join the camp before posting into it"}`. If the camp disables member posting, only the owner/admins can post.
:::

### Storage

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| POST | `/attachments` | `storage.upload` | Upload (**multipart/form-data, field name `file`**) |
| GET | `/attachments` | `storage.list` | Attachment list |
| GET | `/attachments/:id` | Public | Single attachment |
| GET | `/attachments/by-hash/:hash` | Required | Reuse by content hash |
| DELETE | `/attachments/:id` | `storage.delete` | Delete |
| POST | `/attachments/chunk/init`, etc. | `storage.upload` | Chunked upload |

After uploading and obtaining `attachment.id`, include it in the post's or message's `attachment_ids`.

### Other

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| POST | `/reports` | Required | Report a post / message / user |
| GET | `/reports/mine` | Required | Own submitted reports and their outcomes |
| GET | `/notifications` | Required | Notification inbox |
| POST | `/notifications/read` | Required | Mark as read |
| POST/GET | `/ws` | See [Real-Time Events](/en/openprairie/bots/events/) | Real-time events |

**Reports**:

```json
{ "target_type": "post", "target_id": 123, "reason": "Spam" }
```

- `target_type` ∈ `post` | `message` | `user` (other values return `400`);
- `reason` is required and must be ≤500 characters after trimming whitespace;
- You cannot report yourself (reporting yourself with type `user` → `400`);
- Target does not exist → `404`; duplicate report for the same target → `409`;
- Rate limit: **20 reports/hour**; exceeding it returns `429`.

## Request and Response Conventions

### Post Fields

`POST /posts`:

| Field | Type | Description |
| --- | --- | --- |
| `content` | string | ≤5000 characters; at least one of `content` and `quoted_post_id` is required |
| `visibility` | string | `public` \| `login` \| `friends` \| `private`; defaults to `public` |
| `attachment_ids` | []int64 | At most 9 |
| `check_id` | int64 | Associated red packet |
| `tags` | []string | Tags |
| `quoted_post_id` | int64 | Quote/repost |
| `camp_id` | int64 | Post to a camp; `0` means global |

### Message Fields

`POST /conversations/:id/messages`:

| Field | Type | Description |
| --- | --- | --- |
| `content` | string | ≤5000; at least one of `content` / `attachment_ids` / `check_id` is required |
| `reply_to_id` | int64? | Reply to a specific message |
| `attachment_ids` | []int64 | At most 9 |
| `mentions` | []int64 | Mentioned user ids; `-1` means @everyone |
| `check_id` | int64 | Red-packet message |
| `burn_seconds` | int | Disappearing message: `0` or `5..86400` |

### Response Envelopes

| Endpoint | Successful response |
| --- | --- |
| `POST /posts`, `POST …/replies`, `POST …/messages` | `201` + **the object itself** |
| `GET /posts` | `200 {"posts":[…],"page":1}` |
| `GET /conversations/:id/messages` | `200 {"messages":[…]}` |
| Errors | `{"error":"…"}`, sometimes with additional fields |

### Pagination (Two Different Styles)

**Posts: page-number pagination**

```http
GET /posts?page=1&limit=20
GET /posts?q=keyword&author=alice&tag=news&author_id=7&from=2026-01-01&to=2026-02-01
```

There is no `total` or `has_more`—an empty array means the end has been reached.

**Messages: cursor pagination, toward older messages only**

```http
GET /conversations/:id/messages?limit=50&before=12345
```

- `limit` defaults to 50; values outside 1..100 are reset to 50;
- `before` fetches older messages; the returned array is in **chronological order**, so use `messages[-1]` for the newest;
- **There is no `after`**: to fetch new messages, poll the latest page and deduplicate by id, or use WebSocket instead.

### Message Object Fields to Watch

| Field | Description |
| --- | --- |
| `sender_id` | Sender id; **use this to identify your own messages** and avoid automatic-reply loops |
| `sender_is_bot` | Whether the sender is a bot—ignore other bots' messages to prevent two bots from replying endlessly to each other |
| `kind` | `text` \| `check` \| `call` \| `system.join` \| …; **do not treat system messages as user input** |
| `mentions` | List of mentioned user ids; `-1` means @everyone |
| `deleted_at` | Soft-deletion time; list endpoints already filter deleted messages |
| `burn_seconds` / `burn_at` | Disappearing-message countdown |
