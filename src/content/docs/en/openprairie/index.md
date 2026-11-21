---
title: OpenPrairie Server
description: "Documentation for the OpenPrairie (server codename OpenField) microservice backend: services, ports, authentication levels, and documentation navigation."
sidebar:
  order: 1
---

The OpenPrairie server is a Go microservice backend: an API gateway in front of six internal services, plus a Flask administration panel. Clients communicate only with the gateway.

> **Naming note**: The repository is named `OpenPrairie-server`, but the code, database (`openfield`), image names (`openfield-*`), and deep-link scheme (`openfield://`) retain the former name **OpenField**. This documentation uses both names to refer to the server itself; all API paths use `/api/v1/...`.

## Architecture overview

```
                   ┌────────────────────┐
  Client ─────────►│  Gateway  (:8080)  │  ← sole public entry point
                   │  Auth + routing    │
                   └─────────┬──────────┘
                             │ reverse proxy
       ┌──────────┬──────────┼──────────┬───────────┐
       ▼          ▼          ▼          ▼           ▼
    Account    Storage      Chat      Posts        Push
     :8081      :8082      :8083      :8084       :8085
     JWT/       Files/      Sessions/  Posts/      WS tickets
     profiles/  quotas      messages/  comments/   + push hub
     bot                    E2EE       camps

   Plugin :8086 (optional; scripts/start.sh does not start it)
   Flask administration panel :5001 (users, groups, permissions, reports)
   RustFS :9000 (S3-compatible object storage)
```

| Component | Port | Description |
| --- | --- | --- |
| Gateway | 8080 | The only publicly reachable port |
| Account | 8081 | Authentication, profiles, wallet, tasks, membership, bots, reports |
| Storage | 8082 | File upload/download/deletion, quotas, thumbnails |
| Chat | 8083 | Conversations, messages, group management, E2EE keys, call signaling |
| Posts | 8084 | Posts, comments, camps |
| Push | 8085 | WebSocket tickets and push hub |
| Plugin | 8086 | Plugin store (optional) |
| Flask administration panel | 5001 | Operations console |

Internal services bind exclusively to `127.0.0.1` and trust the `X-User-ID` injected by the gateway. **Do not** expose them directly to the public internet.

## Request flow and authentication levels

The gateway declares an authentication level for each route (see [API overview](/en/openprairie/api/)):

| Level | Meaning |
| --- | --- |
| `authPublic` | Public; if a valid token is supplied, identity is still resolved to personalize the response (for example, `is_following`, `my_role`) |
| `authRequired` | Authentication is required; no specific permission key is checked |
| `authPermission` | Authentication and the specified permission key are required; otherwise `403` is returned without forwarding to the backend |
| `authTicket` | WebSocket upgrade path only: the gateway removes all client-supplied identity headers and authenticates with a one-time ticket |

There are two credential types: a user's **JWT** (`Authorization: Bearer <jwt>`) and a bot's static **`ofb_` token**. The gateway routes by prefix; both work on `authPublic`, `authRequired`, and `authPermission` routes.

Two paths do not use the route table:

- `GET /api/v1/health` — served by the gateway itself, which aggregates each backend's `/healthz`;
- `GET /api/v1/files/...` — object keys span multiple path segments, so this is specially handled in the gateway's `NoRoute` handler and **parses JWTs only** (a bot token is treated as anonymous here).

## Services

| Service | Responsibilities |
| --- | --- |
| **Gateway** | The only route table; all authentication and permission checks; aggregated health checks; object-storage proxy; IP-based rate limiting; ban checks; security headers/HSTS; Host allowlist; CORS |
| **Account** | JWT issuance and refresh; password login; OIDC; QR-code login; profiles and avatars; user search; permission self-check; wallet and transfers; payment PIN; red packets (checks); tasks and experience; membership; name styles; follows; **bots**; **reports**; app announcements; storage-bucket assignment |
| **Posts** | Post/comment CRUD, reactions, favorites, views, pinning, tips, **camps and private subgroups** |
| **Storage** | File uploads (including multipart/chunked uploads), listing, deletion, usage, previews (1440px + 512px thumbnails), `/api/v1/files/` proxy and visibility checks |
| **Chat** | Consent-based conversations (chat requests/group invitations), group members and roles, notes, group nicknames, read receipts, messages (quotes, edits, soft deletion, @mentions, forwarding), E2EE group-key envelopes, group announcements/todos/files, **P2P call state machine and signaling relay** |
| **Push** | Issues one-time WebSocket tickets, maintains the connection hub, and fans events out to online clients (best effort, no replay) |
| **Plugin** | Plugin registry and downloads (optional; routes are in the gateway table, but the default stack does not start the service) |

## Permission model

Permission keys use dot-separated domain names and are granted by **user groups**. The `admin` role has all permissions. New accounts (including bots) join the default “Everyone” group, whose permissions are **all keys minus seven administrative keys**:

```
account.verify            user.adjust_exp        user.membership.grant
user.punish               wallet.manage          plugin.manage
app.announcements.manage
```

| Domain | Permission keys |
| --- | --- |
| account | `account.view`, `account.profile.edit`, `account.avatar.edit`, `account.banner.edit`, `account.verify`¹, `account.follow` |
| user | `user.adjust_exp`¹, `user.membership.grant`¹, `user.punish`¹ |
| storage | `storage.upload`, `storage.list`, `storage.get`, `storage.delete` |
| posts | `posts.view`, `posts.create`, `posts.edit`, `posts.delete`, `posts.reply.create`, `posts.reply.edit`, `posts.reply.delete`, `posts.react`, `posts.favorite` |
| chat | `chat.view`, `chat.send`, `chat.call`, `chat.edit`, `chat.delete`, `chat.request.send`, `chat.request.approve`, `chat.group.create`, `chat.group.invite`, `chat.group.manage`, `chat.group.nickname`, `chat.note.edit` |
| wallet | `wallet.view`, `wallet.manage`¹ |
| plugin | `plugin.manage`¹ |
| app | `app.announcements.manage`¹ |

¹ Administrative keys: never granted to the default group. A holder can take action on other users' accounts or site-wide state.

Permissions are checked only once at the gateway. `GET /api/v1/users/me/permissions` requires no permissions, so it can be used to finish registration and inspect one's own access.

## Deployment and runtime notes

- **Configuration**: YAML (default `config/config.local.yaml`; overridden by `OPENFIELD_CONFIG`); environment variables can override some keys. `JWT_SECRET_KEY` must be at least 32 characters and must not be a known default, or the service refuses to start.
- **Database**: PostgreSQL, automatically upgraded at startup through versioned migrations (can be disabled in the configuration file or with `DATABASE_AUTO_MIGRATE`).
- **Redis**: reserved but currently unused (the configuration option exists, but no service calls it).
- **Build each service independently**: the repository root `Dockerfile` takes a `SERVICE` build argument; images run as non-root (uid 10001) and read `/etc/openfield/config.yaml`.
- **Rate limiting**: the gateway uses a token bucket keyed by the **actual TCP peer IP**, with a default of 120 requests/minute and a burst of 240. It briefly waits for a token before rejecting; sustained traffic above the limit eventually receives `429`. It does not distinguish bots from regular users or count by token.
- **Backend unavailable**: the proxy returns `503 {"error":"service temporarily unavailable"}`, distinct from `404` for a missing route.

## Documentation navigation

- **[API reference](/en/openprairie/api/)** — authentication, users, wallet, posts, camps, chat, calls, storage, tasks and membership, moderation, and system endpoints
- **[Bot development guide](/en/openprairie/bots/)** — creation and authentication, capabilities, real-time events, examples, and limitations

Upstream documentation is in the repository's `docs/` directory (`API.md`, `bots.md`, `architecture.md`, and others). This site organizes that material and is based on a route-by-route review of the gateway route table.
