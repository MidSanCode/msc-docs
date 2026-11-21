---
title: API Overview
description: Base URL, authentication, authorization levels, response envelopes, pagination styles, rate limits, and error conventions for the OpenPrairie REST API.
sidebar:
  order: 1
---

All endpoints are exposed through the **gateway**, with the following base URL:

```
http://localhost:8080/api/v1          # local default
https://<your-domain>/api/v1          # production
```

The gateway validates credentials first (a user JWT or a bot's static `ofb_` token), checks permissions against the route table, and then forwards the request to an internal service.

Two paths are exceptions: `GET /api/v1/health` is served by the gateway itself; `GET /api/v1/files/...` is specially handled by the gateway's `NoRoute` handler (JWT parsing only).

## Authentication

| Method | Request header | Description |
| --- | --- | --- |
| User JWT | `Authorization: Bearer <jwt>` | Obtained after login; valid for 24 hours by default |
| Static bot token | `Authorization: Bearer ofb_<64 hex digits>` | Does not expire; invalidated when reset (see [Bot development guide](/en/openprairie/bots/)) |

Failure responses:

| Condition | Response |
| --- | --- |
| No `Authorization` header | `401 {"error":"missing authorization token"}` |
| Invalid/expired JWT | `401` |
| Bot token invalid, reset, or bot banned | `401 {"error":"invalid bot token"}` |
| Missing permission | `403 {"error":"permission denied","permission":"<key>"}` |
| Account banned (JWT) | `403 {"error":"account is banned","banned":true}` |

> A banned **bot** is rejected during token parsing and receives `401`, not `403`. Clients should handle 401 uniformly as “credentials invalid.”

## Authorization levels

| Level | Meaning |
| --- | --- |
| `authPublic` | Public. If a valid token is supplied, identity is still resolved to return personalized fields (`is_following`, `my_role`, and the caller's own reaction/favorite state). |
| `authRequired` | Authentication is required; no specific permission key is checked. |
| `authPermission` | Authentication is required, along with the permission key specified for the route. |
| `authTicket` | `GET /ws` only: the gateway removes client identity headers and exchanges a one-time ticket. |

## General conventions

### Request bodies

Except for file uploads, all `POST` and `PUT` requests use `Content-Type: application/json`. Uploads use `multipart/form-data`.

### Response envelopes

| Endpoint type | Success shape |
| --- | --- |
| Create a single object (post, comment, message) | `201` + **the object itself** |
| List | `200 {"<plural-name>":[…], "page":1}` or `{"messages":[…]}` |
| Delete, mark as read | `204 No Content` |
| Error | `{"error":"…"}`, sometimes with additional fields such as `permission`, `banned`, or `limit` |

### Pagination: two styles—do not mix them

**Page-number pagination** (posts, comments, and a user's posts):

```http
GET /posts?page=1&limit=20
GET /posts?q=keyword&author=alice&tag=news&author_id=7&from=2026-01-01&to=2026-02-01
```

The response's `page` is the current page. There is **no `total` or `has_more`**; an empty array means the end has been reached.

**Cursor pagination** (messages; backward only):

```http
GET /conversations/:id/messages?limit=50&before=12345
```

- `limit` defaults to 50; values outside 1..100 are reset to 50.
- `before=<message id>` returns **older** messages; omit it to get the latest page.
- Results are in **chronological order (old → new)**; the newest item is `messages[-1]`.
- There is **no `after`**: poll the latest page and deduplicate by id to get new messages, or use WebSocket.

### Time and amounts

- Timestamps use RFC3339 (`2026-10-10T15:20:12Z`); `info`-type fields sometimes use Unix seconds.
- **All amounts are integer cents** (`BIGINT`); clients should divide by 100 for display. The `amount` in red-packet and tip endpoints is in “coins” (`10.5`), so distinguish the units.

### Rate limits

| Limit | Value | Scope |
| --- | --- | --- |
| Gateway token bucket | 120 requests/minute, burst 240 | By **actual TCP peer IP**; briefly waits for tokens before returning `429` for sustained excess |
| Reports | 20 per hour | Per user |
| Login / payment PIN attempts | Internal budget (`pkg/ratelimit`) | Per user; counts failures only |

Gateway rate limiting does not distinguish bots from regular users and does not count by token—every request behind the same egress IP shares one bucket.

## Endpoint groups

| Group | Documentation |
| --- | --- |
| Authentication and sessions (OIDC, password, refresh, multiple accounts, QR login) | [Authentication and sessions](/en/openprairie/api/auth/) |
| Users and profiles (profile, avatar, follows, privacy, name styles, storage buckets, account deletion) | [Users and profiles](/en/openprairie/api/users/) |
| Wallet, transfers, payment PIN, red packets | [Wallet and payments](/en/openprairie/api/wallet/) |
| Posts, comments, reactions, tips, camps | [Posts and camps](/en/openprairie/api/posts/) |
| Conversations, messages, group management, E2EE, search | [Chat](/en/openprairie/api/chat/) |
| Voice/video calls | [Calls](/en/openprairie/api/calls/) |
| Attachments and object storage | [Attachments and storage](/en/openprairie/api/storage/) |
| Tasks, experience levels, membership | [Tasks and membership](/en/openprairie/api/tasks/) |
| Reports and punishments | [Moderation and punishments](/en/openprairie/api/moderation/) |
| Announcements, plugins, capability discovery, health checks, real-time push | [System endpoints](/en/openprairie/api/system/) |

## Client integration notes

- **Public routes can still return personalized data**: with a valid token, results from `GET /posts`, `GET /camps`, `GET /users/:id`, and similar endpoints can differ (caller reaction state, `my_role`, `is_following`). Without a token, only the public view is available.
- **Unmatched routes return `404`; backend failures return `503`**. This distinguishes a client path error from an unavailable service.
- **Browser cross-origin requests** require the gateway's `server.allowed_origins` to allow the origin; `localhost` and `127.0.0.1` origins are always allowed by default.
- **Host allowlist**: if `server.allowed_hosts` is configured, requests with a nonmatching `Host` are rejected.

## Known documentation discrepancy

Upstream `docs/punishments.md` says `POST /auth/logout` remains reachable while an account is banned, but the **gateway route table does not register `/auth/logout`**. To invalidate a current session, use `DELETE /auth/sessions/:id` (see [Authentication and sessions](/en/openprairie/api/auth/)).
