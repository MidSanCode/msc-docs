---
title: Chat and Conversations
description: Consent-based conversations, private chat requests, groups and invitations, sending and editing messages, @mentions, forwarding, group announcements/todos/files, E2EE keys, and history search.
sidebar:
  order: 7
---

Chat is **consent-based**: starting a private chat or inviting someone to a group creates a **consent request**. The conversation exists only after the other party accepts.

## Endpoint overview

### Consent requests

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/consent-requests` | `chat.request.approve` | My pending requests |
| POST | `/consent-requests/:id/accept` | `chat.request.approve` | Accept |
| POST | `/consent-requests/:id/decline` | `chat.request.approve` | Decline (`204`) |

### Conversations and groups

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/conversations` | `chat.view` | My conversations (including `last_message` and `unread_count`) |
| POST | `/conversations` | `chat.group.create` | Create a group (the caller becomes the owner) |
| POST | `/conversations/start` | `chat.request.send` | Start a private chat (send a request) |
| GET | `/conversations/public` | `chat.view` | Public group list |
| GET | `/conversations/:id` | `chat.view` | Conversation details |
| POST | `/conversations/:id/invite` | `chat.group.invite` | Invite (send a request) |
| POST | `/conversations/:id/join` | `chat.group.manage` | Join a public group |
| POST | `/conversations/:id/leave` | `chat.group.manage` | Leave a group (the owner cannot leave) |
| DELETE | `/conversations/:id` | `chat.group.manage` | Dissolve a conversation |
| PUT | `/conversations/:id/settings` | `chat.group.manage` | Group settings |
| PUT | `/conversations/:id/title` | `chat.group.manage` | Change the group name |
| PUT | `/conversations/:id/avatar` | `chat.group.manage` | Change the group avatar |
| POST/DELETE | `/conversations/:id/mute-all` | `chat.group.manage` | Toggle muting all members |
| DELETE | `/conversations/:id/members/:user_id` | `chat.group.manage` | Remove a member |
| PUT | `/conversations/:id/members/:user_id/role` | `chat.group.manage` | Change a member's role |
| PUT | `/conversations/:id/members/:user_id/title` | `chat.group.manage` | Set a member's title |
| POST/DELETE | `/conversations/:id/members/:user_id/mute` | `chat.group.manage` | Mute an individual member |
| PUT | `/conversations/:id/note` | `chat.note.edit` | Private chat note |
| PUT | `/conversations/:id/group-nickname` | `chat.group.nickname` | My group nickname |
| PUT | `/conversations/:id/notify-level` | `chat.view` | Notification level |
| POST | `/conversations/:id/read` | `chat.view` | Mark as read |
| POST | `/conversations/:id/typing` | `chat.view` | Typing indicator |

### Messages

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/conversations/:id/messages` | `chat.view` | Message list (`before` paginates backward) |
| POST | `/conversations/:id/messages` | `chat.send` | Send a message |
| PUT | `/conversations/:id/messages/:message_id` | `chat.edit` | Edit your own message |
| DELETE | `/conversations/:id/messages/:message_id` | `chat.delete` | Soft-delete |
| POST | `/conversations/:id/messages/:message_id/read` | `chat.view` | Read receipt for one message |
| POST | `/conversations/:id/messages/forward` | `chat.send` | Forward messages |
| GET | `/conversations/:id/messages/search` | `chat.view` | Search history |

### Group extensions and encryption

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/conversations/:id/announcements` | `chat.view` | Group announcements |
| POST | `/conversations/:id/announcements` | `chat.group.manage` | Publish an announcement |
| DELETE | `/conversations/:id/announcements/:announcement_id` | `chat.group.manage` | Delete an announcement |
| GET | `/conversations/:id/todos` | `chat.view` | Group todos |
| POST | `/conversations/:id/todos` | `chat.view` | Add a todo |
| PUT | `/conversations/:id/todos/:todo_id` | `chat.view` | Mark as completed (any member) |
| DELETE | `/conversations/:id/todos/:todo_id` | `chat.view` | Delete a todo |
| GET | `/conversations/:id/files` | `chat.view` | Files shared in the conversation |
| GET | `/conversations/:id/e2ee-keys` | `chat.view` | Retrieve key envelopes |
| POST | `/conversations/:id/e2ee-keys` | `chat.group.manage` | Publish/update key envelopes |

## Private chats and groups

### Start a private chat (send a request)

```http
POST /conversations/start
{ "user_id": 2, "message": "Hello!", "encrypted": false }
```

`201 {"message":"chat request sent"}`. This only **sends a request**; it does not create a conversation.

| Status | Scenario |
| --- | --- |
| `409` | A request is already pending: `a chat request is already pending` |
| `400` | Sending to yourself: `cannot start a chat with yourself` |

### Accept / decline a request

```http
POST /consent-requests/:id/accept
```

```json
{ "message": "request accepted", "conversation": { "id": 5, "type": "private", "title": null } }
```

Declining returns `204 No Content`.

### Create a group and invite members

```http
POST /conversations          { "title": "Family" }          → 201, the caller becomes the owner
POST /conversations/:id/invite   { "user_id": 3, "message": "Come join us" }   → 201 {"message":"invite sent"}
```

Invitations also use consent requests. Members can join public groups themselves (`POST /conversations/:id/join`).

### Conversation details

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

The response includes an `encrypted` flag—check it before integrating with an encrypted conversation.

## Messages

### Send

```http
POST /conversations/:id/messages
```

| Field | Type | Description |
| --- | --- | --- |
| `content` | string | ≤5000 characters |
| `reply_to_id` | int64? | Reference a message |
| `attachment_ids` | []int64 | At most 9 |
| `mentions` | []int64 | IDs of @mentioned users; `-1` means @everyone |
| `check_id` | int64 | Red packet message |
| `burn_seconds` | int | Disappearing message: `0` or `5..86400` |

**At least one** of `content`, `attachment_ids`, and `check_id` is required; otherwise, `400 {"error":"message cannot be empty"}`.

### Notable fields in a message object

| Field | Description |
| --- | --- |
| `sender_id` | Sender; use this to determine whether the sender is the current user |
| `sender_is_bot` | Whether the sender is a bot |
| `kind` | `text` \| `check` \| `call` \| `system.join` \| `system.leave` \| `system.mute` … |
| `mentions` | List of @mentioned user IDs; `-1` = @everyone |
| `deleted_at` | Soft-deletion time (already filtered out of lists) |
| `edited_at` | Edit time; its presence means the message has been edited |
| `burn_seconds` / `burn_at` | Disappearing-message countdown |
| `call_meta` | Outcome and duration for a call-record message |

### List (backward pagination only)

```http
GET /conversations/:id/messages?limit=50&before=12345
```

- `limit` defaults to 50; values outside 1..100 are reset to 50;
- `before` retrieves older messages; omit it to retrieve the latest page;
- Results are in **chronological order** (old → new); the newest message is `messages[-1]`;
- **There is no `after`**. To retrieve new messages, poll and deduplicate by id, or use WebSocket instead.

### Edit and soft-delete

```http
PUT    /conversations/:id/messages/:message_id   { "content": "Edited" }
DELETE /conversations/:id/messages/:message_id   → 204
```

Soft-deletion sets `deleted_at`; the message is no longer returned in lists.

### Forwarding and read receipts

```http
POST /conversations/:id/messages/forward     # Forward (the target conversation is in the request body)
POST /conversations/:id/read                 { "last_message_id": 42 }  → 204
POST /conversations/:id/messages/:message_id/read                       # Read receipt for one message
```

## History search

```http
GET /conversations/:id/messages/search?q=quarterly%20report&sender_id=42&from=2026-08-01&to=2026-08-31&has_attachment=true&file_name=report&limit=50
```

All filters are optional and combined with AND.

| Parameter | Description |
| --- | --- |
| `q` | Case-insensitive content substring |
| `sender_id` | Only messages from this sender |
| `from` / `to` | Inclusive `created_at` range (RFC3339 or Unix seconds) |
| `has_attachment` | Only messages with attachments |
| `file_name` | Substring of an attachment's original filename (implies `has_attachment`) |
| `limit` | Defaults to 50, clamped to 1..100 |

- Only ordinary text messages match: system messages (`system.*`) and soft-deleted messages **never** match;
- Results are **newest first** (the opposite of the regular chronologically ordered list);
- **In E2EE conversations, the server holds only ciphertext**. `q` / `file_name` cannot match plaintext; clients should search their local decrypted cache instead.

Errors: `400` for invalid parameters; `403` for non-members when the group is not public.

## Group extensions

### Announcements

```http
GET    /conversations/:id/announcements
POST   /conversations/:id/announcements
DELETE /conversations/:id/announcements/:announcement_id
```

Members can read; writing requires management permission.

### Todos

```http
GET    /conversations/:id/todos
POST   /conversations/:id/todos
PUT    /conversations/:id/todos/:todo_id   { "done": true }    # Any member can mark it as completed
DELETE /conversations/:id/todos/:todo_id
```

### Conversation files

```http
GET /conversations/:id/files
```

Retrieved directly through the `message_attachments` relation, with **no duplicate storage**, newest first.

## End-to-end encryption (E2EE)

A conversation may be marked `encrypted`: messages are stored as **ciphertext**, and only clients holding the group key can decrypt them.

- Group keys are distributed as **per-member envelopes** (wrapped using X25519 public keys), accessed through `GET|POST /conversations/:id/e2ee-keys`;
- The version must be updated when adding members or rotating keys;
- The server **does not perform encryption or decryption**, so `content` in an E2EE conversation is ciphertext through every read endpoint;
- Red packet messages (`kind = "check"`) contain no plaintext content and work in E2EE conversations as well.

> **Client integration advice**: For conversations with `encrypted: true`, either implement the complete key workflow or skip them and record the reason—do not treat ciphertext as plaintext.

## Error reference

| Status | Scenario |
| --- | --- |
| `400` | All three message fields are empty; invalid `burn_seconds`; sending a conversation request to yourself |
| `403` | Reading messages as a non-member; missing `chat.*` permission |
| `409` | A private chat request is already pending |
