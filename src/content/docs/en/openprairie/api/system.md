---
title: System APIs
description: Capability discovery, site-wide announcements, notification inbox, plugin store, health checks, and real-time push (WebSocket tickets).
sidebar:
  order: 12
---

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/capabilities` | Public | Optional features supported by this server |
| GET | `/announcements` | Public | Active site-wide announcements (`?all=1` includes inactive ones) |
| POST | `/announcements` | `app.announcements.manage` | Publish an announcement |
| PUT | `/announcements/:id` | `app.announcements.manage` | Deactivate an announcement |
| GET | `/notifications` | Auth required | Notification inbox |
| POST | `/notifications/read` | Auth required | Mark as read |
| GET | `/plugins` | Public | Plugin list |
| GET | `/plugins/:id` | Public | Plugin details |
| GET | `/plugins/:id/download` | Auth required | Download a plugin |
| POST | `/plugins/admin/upload` | `plugin.manage` | Upload a plugin package |
| PUT | `/plugins/admin/:id/publish` | `plugin.manage` | Publish |
| PUT | `/plugins/admin/:id/unpublish` | `plugin.manage` | Unpublish |
| DELETE | `/plugins/admin/:id` | `plugin.manage` | Delete |
| GET | `/health` | Public | Aggregated health check (answered by the gateway itself) |
| POST | `/ws` | Auth required | Obtain a single-use WebSocket ticket |
| GET | `/ws?ticket=` | `authTicket` | WebSocket upgrade |

## Capability discovery

```http
GET /capabilities
```

Requires no authentication and returns optional features supported by this server build, allowing clients to maintain a compatibility matrix and degrade gracefully:

```json
{
  "version": "…",
  "capabilities": {
    "auth.password_login": true,
    "auth.oidc_login": true,
    "auth.oidc_multi_account": true,
    "chat.e2ee": true,
    "camps.subgroups": true,
    "moderation.reports": true
  }
}
```

New optional capabilities are registered in this map; clients **must not** assume a capability is present.

## Site-wide announcements

Operational notices displayed when a client starts.

```http
GET /announcements            # Active, newest first
GET /announcements?all=1      # Includes inactive historical entries (administrative view)
POST /announcements           # Publish (app.announcements.manage)
PUT /announcements/:id        { "active": false }   # Deactivate but retain history
```

Clients remember read announcement ids locally, so each announcement is **shown only once per device**, until a new announcement is published.

## Notification inbox

```http
GET  /notifications
POST /notifications/read
```

Read in-app notifications and mark them as read; real-time delivery uses WebSocket (see below).

## Plugin store

The plugin service is an **optional component**: the gateway routing table references it and `run.bat` starts it, but `scripts/start.sh` neither builds nor starts it. As a result, these routes have no backend in some one-click deployments (returning `503`).

```http
GET  /plugins                     # Public list
GET  /plugins/:id                 # Public details
GET  /plugins/:id/download        # Authenticated download
POST /plugins/admin/upload        # plugin.manage
PUT  /plugins/admin/:id/publish   # Publish
PUT  /plugins/admin/:id/unpublish # Unpublish
DELETE /plugins/admin/:id         # Delete
```

Plugin packages are stored in `/app/data/plugins` (inside the container, `OPENFIELD_PLUGIN_DIR`). Mount `/app/data` if they must survive restarts.

## Health checks

### Aggregated endpoint

```http
GET /health
```

The gateway itself answers, concurrently fanning out to `/healthz` on each **configured** backend and measuring latency. Returns `200` if all are healthy, otherwise `503`—**the response body is always parseable**:

```json
{
  "all_healthy": false,
  "checked_at": "2026-08-24T12:00:00Z",
  "services": {
    "gateway": { "status": "up", "latency_ms": 0, "details": { "database": "up" } },
    "account": { "status": "up", "latency_ms": 3, "details": { "database": "up" } },
    "chat":    { "status": "up", "latency_ms": 2, "details": { "database": "up" } },
    "posts":   { "status": "down", "latency_ms": 3001, "error": "context deadline exceeded" },
    "plugin":  { "status": "unknown", "latency_ms": 0, "error": "not configured" }
  }
}
```

Services without a configured URL report `unknown` + `"not configured"`, without bringing down the overall result. No authentication is required, and polling is safe—but each call consumes one DB ping plus six local HTTP GETs. **An interval of ≥ 30 seconds is recommended**.

### Per-service probes

```http
GET /healthz        # Internal port, no authentication
```

account, chat, posts, push, storage, and plugin all expose:

```json
{ "status": "up", "details": { "database": "up" }, "checked_at": "2026-08-24T12:00:00Z" }
```

- `status`: `up` | `down` | `degraded`;
- `details.database`: `PingContext` on the shared PostgreSQL connection pool (3-second timeout; push has no connection pool and reports `n/a`). A failed ping makes the overall status `down`;
- storage also has `details.storage`: `up` when configured and enabled; otherwise `disabled`, with the overall status reduced to `degraded`.

## Real-time push (WebSocket)

The push service holds WebSocket connections and fans out chat events, typing indicators, and notifications. It is the **only** bidirectional channel; all other traffic uses ordinary REST.

### Two-step connection: obtain a ticket, then connect

```http
POST /api/v1/ws          (with Authorization: Bearer <credential>)
  → 200 {"ticket":"<64 hexadecimal characters>","expires_in":30}

GET  /api/v1/ws?ticket=<ticket>      (WebSocket upgrade, ws:// or wss://)
```

| Rule | Description |
| --- | --- |
| Ticket | **Single-use**; invalidated after use |
| Validity | **30 seconds**, just enough to “obtain a ticket → connect immediately” |
| Upgrade request | Uses `authTicket` at the gateway: **identity headers are removed before forwarding the request unchanged**; the push service redeems the ticket |

> **A bare `GET /api/v1/ws` with only a token (without `ticket`) returns `401`**, even if the token is valid. The `POST` ticket step is mandatory.
>
> This is intentional: browsers cannot set custom headers during a WebSocket handshake, while putting a long-lived token in the URL would leak it into logs. A short-lived, single-use ticket is used instead. **Do not put tokens in the query string for convenience.**

### Event envelope

After connecting, the client first receives a greeting frame:

```json
{ "type": "connected" }
```

Each subsequent message uses the same envelope:

```json
{
  "type": "chat.message.created",
  "recipients": [7, 4242],
  "data": { "id": 9001, "conversation_id": 33, "sender_id": 7, "kind": "text" }
}
```

`data` is the corresponding resource object. An empty `recipients` array means **broadcast to all connected clients**.

### Event types

| `type` | `data` | Audience |
| --- | --- | --- |
| `chat.message.created` / `.updated` / `.deleted` | Message object | `active` members of the conversation |
| `chat.typing` | `{conversation_id, user_id}` | Conversation members |
| `chat.conversation.updated` | `{conversation_id}` | Conversation members |
| `chat.consent.requested` | `{user_id, encrypted, …}` | Request recipient |
| `chat.e2ee.keys.updated` | Key-envelope metadata | Conversation members |
| `post.created` / `post.deleted` | Post object | By visibility: `private` author only, `friends` mutual follows + author, `public`/`login` broadcast |
| `post.reply.created` / `.updated` / `.deleted` | Comment object | Relevant parties such as the post's author |
| `call.*` | Call payload | See [Calls](/en/openprairie/api/calls/#push-events) |

### Connection maintenance

- The server pings every **54 seconds**, with a **60-second** read timeout—clients must send pong promptly (most libraries handle this automatically), or they will be disconnected;
- Each connection has a **256-message** send buffer. If it cannot accept a write (the consumer is too slow), the connection is **closed immediately**, without accumulating a backlog;
- Events are **best-effort** deliveries forwarded through PostgreSQL `NOTIFY`, not a durable queue: **events missed** during service restarts or disconnections **are not replayed**.

**Conclusion**: real-time events provide low-latency triggers; state consistency relies on periodic REST reconciliation (such as `GET /conversations/:id/call`).

## Object file proxy

```http
GET /api/v1/files/<bucket>/<key>
```

This path is specially handled by the gateway's `NoRoute` (object keys span multiple path segments and cannot be expressed with `:param`) and **only parses JWTs**:

- Public objects can be retrieved directly;
- Private objects require the owner's identity;
- **A bot token is equivalent to anonymous access here** and cannot read private objects.

See [Attachments and Storage](/en/openprairie/api/storage/).
