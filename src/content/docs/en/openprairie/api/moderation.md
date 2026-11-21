---
title: Moderation and Punishments
description: Reports for posts/messages/users, the report queue and deduplication quotas, punishment types, and how bans take effect in the request pipeline.
sidebar:
  order: 11
---

Both capabilities reside in the Account service: **reports** (available to any logged-in user) and **punishments** (requiring administrative permission). Moderation is performed in the Flask administration panel; the server only records and lists entries.

## Reports

### Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/reports` | Auth required | Submit a report |
| GET | `/reports/mine?limit=` | Auth required | Reports I have submitted (default 50, maximum 100) |

### Submit

```http
POST /reports
{ "target_type": "post", "target_id": 123, "reason": "Spam advertising" }
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `target_type` | string | ✅ | `post` \| `message` \| `user` |
| `target_id` | int | ✅ | Id of the reported content |
| `reason` | string | ✅ | 1–500 characters |

Success returns `201` + the report record.

### Record fields

| Column | Meaning |
| --- | --- |
| `reporter_id` | Reporter (cascading deletion) |
| `target_type` / `target_id` | Target type and id |
| `reason` | Free text, ≤500 characters |
| `status` | `pending` / `reviewed` / `dismissed` |
| `reviewer_id` / `reviewer_username` | Reviewer and denormalized name (history is unaffected by account changes) |
| `review_note` | Moderation note |
| `created_at` / `reviewed_at` | Submission and review times |

`(target_type, target_id)` deliberately has **no foreign key**: the three target types reside in three different tables, and **deleting a target should not erase the record that it was reported**. The id is validated on write, and the panel explicitly marks deleted targets.

### Guards

| Condition | Response |
| --- | --- |
| Unknown `target_type` | `400` |
| `target_id` ≤ 0, or `reason` is empty or too long | `400` |
| Reporting yourself (`user` type with your own id) | `400` |
| Target does not exist | `404` |
| An existing **pending** report for the same target | `409` |
| More than **20** reports within one hour | `429` |

`409` comes from the partial unique index `idx_reports_one_open ON (reporter_id, target_type, target_id) WHERE status = 'pending'`; conflicts are translated into an explicit error rather than a 500. Reviewing a report frees the slot, allowing the same target to be reported again.

### Review

Performed in the administration panel (`/reports`, capability `reports.manage`): pending reports are listed by default, with filters for status and target type. Reviewing writes `status`, `reviewer_*`, `review_note`, and `reviewed_at`, and records an `admin_audit_log` entry. Reviewed reports can be reopened (returning to `pending` and clearing review fields), unless the same reporter has since submitted a newer pending report for that target (which would violate the partial unique index, so reopening is rejected with an explanation).

> **Reviewing a report only records the decision**: it does not itself punish anyone or delete content. Moderators must delete posts or punish users separately.

### Deletion semantics

Deleting a user also deletes **reports they submitted** through `reporter_id ... ON DELETE CASCADE`. **Reports submitted by others about that user** are retained; only `target_id` can no longer be resolved—the panel explicitly shows that the target is missing.

## Punishments

### Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/users/:id/punishments` | `user.punish` | Apply a punishment |
| GET | `/users/:id/punishments` | `user.punish` | Punishment history + currently active permission revocations |

### Types

| Type | Meaning | Side effect |
| --- | --- | --- |
| `warning` | Warning | Record only |
| `demerit` | Demerit | Record only |
| `revoke` | Revoke a permission | Write to `user_permission_bans` |
| `temp_ban` | Temporary ban | `users.status = 'banned'` + `banned_until` |
| `ban` | Permanent ban | `users.status = 'banned'`, `banned_until = NULL` |
| `unban` | Lift a ban | Restore `status = 'active'` and clear all permission revocations |
| `restore` | Restore a permission | Delete the corresponding `user_permission_bans` row |

### Request body

```http
POST /users/:id/punishments
{ "type": "temp_ban", "reason": "Flooding", "duration_minutes": 120 }
```

| Field | Required | Description |
| --- | --- | --- |
| `type` | ✅ | One of the types above |
| `reason` |  | Explanatory text |
| `permission_key` | Required for `revoke`/`restore` | Permission key to revoke/restore |
| `duration_minutes` | Required for `temp_ban` | Ban duration (minutes) |

Record insertion and side effects occur in the same transaction.

### Rejection rules

| Condition | Response |
| --- | --- |
| Punishing yourself | `403 cannot punish yourself` |
| Punishing an administrator | `403 cannot punish an administrator` |
| Insufficient permission rank to punish this user (lower ranks cannot punish higher ranks) | `403 insufficient rank to punish this user` |
| `revoke`/`restore` without `permission_key` | `400` |
| `temp_ban` without `duration_minutes` | `400` |
| Unknown type | `400` |

`user_permission_bans` stores **currently active** permission revocations, which `GetEffectivePermissions` excludes during resolution. Revoked keys are ineffective everywhere until `restore` or `unban`.

### How bans take effect

`users.status` / `banned_until` block login and each subsequent request:

| Stage | Behavior |
| --- | --- |
| Login / OIDC callback / refresh | Reject users with `status = 'banned'` |
| `temp_ban` | Automatically lifted after `banned_until` expires (compared against `NOW()`) |
| **Request pipeline** | The gateway checks every authenticated request (`IsBannedCached`). A hit immediately returns `403 {"error":"account is banned","banned":true}` without forwarding to the backend. Results are cached for **30 seconds**—new bans take effect within half a minute, without waiting for the next login |
| Previously issued access tokens | **Not revoked**; bans are enforced by per-request status checks rather than invalidating tokens |
| Some routes remain accessible | `GET /users/me`, `GET /users/me/punishments`, `POST /auth/refresh` (refresh only lets the client see the ban; it does not issue a token for a banned user) |
| Public routes (`authPublic`) | **Do not check bans**: banned users can still read public content, and their tokens are still used there for personalization. **Actions are banned, not reading** |
| Banned **bots** | Static token resolution fails immediately; all requests (including public routes) return `401 {"error":"invalid bot token"}` |

## Relationship to bots

The default bot group **does not have** `user.punish`, so bots **cannot** ban or punish anyone; they can only submit reports. See the [Bot Development Guide](/en/openprairie/bots/).
