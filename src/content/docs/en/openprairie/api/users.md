---
title: Users and Profiles
description: My profile, avatar and banner, permission self-check, user search, follows and friends, privacy, name styles, storage-bucket assignment, daily bonuses, and account deletion.
sidebar:
  order: 3
---

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/users/me` | Auth required | My complete profile |
| PUT | `/users/me` | `account.profile.edit` | Change username/nickname/bio |
| GET | `/users/me/permissions` | Auth required | My permission keys and groups |
| POST | `/users/me/avatar` | `account.avatar.edit` | Upload avatar |
| POST | `/users/me/banner` | `account.banner.edit` | Upload banner |
| PUT | `/users/me/locale` | Auth required | Region and language |
| PUT | `/users/me/privacy` | Auth required | Privacy settings |
| PUT | `/users/me/name-style` | `account.profile.edit` | Name style (membership feature) |
| PUT | `/users/me/e2ee-key` | Auth required | Publish X25519 public key |
| POST | `/users/me/claim-daily-bonus` | Auth required | Claim daily bonus |
| POST | `/users/me/heartbeat` | Auth required | Online heartbeat |
| POST | `/users/me/deletion-request` | Auth required | Request account deletion |
| DELETE | `/users/me/deletion-request` | Auth required | Withdraw deletion request |
| GET | `/users/search?q=&limit=` | Auth required | Search users |
| GET | `/users/:user_id` | Public | Another user's profile |
| PUT | `/users/:user_id/exp` | `user.adjust_exp` | Adjust another user's experience |
| PUT | `/users/:user_id/membership` | `user.membership.grant` | Grant membership |
| POST/DELETE | `/users/:user_id/follow` | `account.follow` | Follow / unfollow |
| GET | `/users/:user_id/followers` | Public | Followers list |
| GET | `/users/:user_id/following` | Public | Following list |
| GET | `/users/:user_id/friends` | Public | Friends (mutual follows) list |
| GET | `/users/storage-buckets` | Auth required | Storage-bucket list and lock status |
| PUT | `/users/me/storage-bucket` | Auth required | Switch storage bucket |

## My profile

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

The response also includes membership and name-style fields, plus `is_bot` (for bot accounts). `storage_quota` is the **effective quota** (base quota + currently active membership bonus).

### Update profile

```http
PUT /users/me
{ "username": "alice", "nickname": "Alice", "bio": "..." }
```

All three fields are optional, but at least one must be provided. Username uniqueness follows the same rules as registration. Calling this endpoint clears `needs_registration`.

> This endpoint accepts **only** `username`, `nickname`, and `bio`; it cannot change the bot flag or ownership relationship.

### Avatar and banner

```http
POST /users/me/avatar      Content-Type: multipart/form-data   file=<image>
POST /users/me/banner      Content-Type: multipart/form-data   file=<image>
```

Both **count against the storage quota**.

### Region and language

```http
PUT /users/me/locale
{ "region": "CN", "lang": "zh-CN" }
```

Used for date boundaries and push-notification language.

### Online heartbeat

```http
POST /users/me/heartbeat    → 200 {"online": true}
```

Updates `last_seen`.

## Permission self-check

```http
GET /users/me/permissions
```

```json
{ "permissions": ["posts.view", "posts.create", "chat.send"], "groups": ["admin", "beta-users"] }
```

This endpoint can be called **without any permissions** (otherwise registration could not be completed) and is a reliable way to check “what can I actually do?” at startup. See the complete key table in the [Server overview](/en/openprairie/#permission-model).

## Search and view users

```http
GET /users/search?q=alice&limit=20     # match username or nickname substrings
GET /users/:user_id                    # public profile
```

```json
{ "users": [{ "id": 2, "username": "alice", "nickname": "Alice", "avatar_url": null }] }
```

`GET /users/:user_id` uses `authPublic`: with a token, the result includes personalized fields such as `is_following` and `is_friend`.

## Follows and friends

```http
POST   /users/:user_id/follow      # follow
DELETE /users/:user_id/follow      # unfollow
```

Two users who follow each other become **friends**. Lists:

```http
GET /users/:user_id/followers
GET /users/:user_id/following
GET /users/:user_id/friends
```

Profiles include `follower_count` / `following_count` and `is_following` / `is_friend`.

### Privacy

```http
PUT /users/me/privacy
{ "hide_follow_lists": true }
```

When enabled, all three lists return `403` to everyone except the user, and the user's profile no longer includes follower/following counts.

## Name styles (membership feature)

```http
PUT /users/me/name-style
```

Can set `name_color`, `name_color_to` (second gradient color), and `name_dynamic` (animated gradient). The available options depend on membership level:

| Level | Allowed |
| --- | --- |
| Lv.1 Mist | Preset palette only |
| Lv.2 Bonfire | Any valid hexadecimal color |
| Lv.3 Bright Moon | Add a second gradient color |
| Lv.4 Lone Star | Add an animated gradient |

The server enforces Lv.1's “preset only” restriction; it does not rely on the client.

## Experience and membership (administrative operations)

```http
PUT /users/:user_id/exp         { "..." }        # permission user.adjust_exp
PUT /users/:user_id/membership  { "level": 2, "days": 30 }   # permission user.membership.grant
```

For a membership grant, `level: 0` clears membership. Experience bonuses are multiplied by the active membership multiplier inside `GrantExp`. See [Tasks and membership](/en/openprairie/api/tasks/).

## Storage-bucket assignment

The server supports **multiple physical object-storage buckets**: each logical bucket maps to a separate S3 bucket and can require a minimum membership level.

```http
GET /users/storage-buckets
```

Returns each bucket's `name`, `label`, `default_quota`, `min_member_level`, `is_default`, and `locked` (whether the current user can use it), as well as the user's current `current` bucket.

```http
PUT /users/me/storage-bucket
{ "bucket": "star" }
```

- Unknown bucket → `400`; insufficient membership level → `403`.
- After switching, the quota resets to the target bucket's `default_quota`.
- **Existing attachments are not migrated**. Their records retain the bucket used at upload time, so deletion still resolves to the correct physical storage.
- Membership bonus quota applies **only to the default bucket**.

## Daily bonus and account deletion

### Daily bonus

```http
POST /users/me/claim-daily-bonus
```

Grants experience and currency once per server day (boundary defined by `GAME_TIMEZONE`; defaults to `100` exp / `20` coins). The response includes the consecutive check-in day count.

### Delete account

```http
POST   /users/me/deletion-request     # request deletion
DELETE /users/me/deletion-request     # withdraw request
```

After a request, the account is **immediately hidden everywhere and login is denied**. Its data rows are purged after **30 days**; the request can be withdrawn during that period.

> Bots differ from regular accounts: deleting a bot (or its owner) cascades to delete its posts, comments, messages, attachments, and conversation/camp membership relationships. This cannot be undone.

## Storage usage

```http
GET /storage/usage
```

Returns bytes used; use it with `storage_quota` to display quota progress. See [Attachments and storage](/en/openprairie/api/storage/).
