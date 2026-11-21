---
title: Voice and Video Calls
description: The P2P call state machine, REST upstream signaling and WebSocket downstream events, group mesh semantics, ICE/TURN configuration, and known limitations.
sidebar:
  order: 8
---

Calls are **peer-to-peer**: media flows directly between the endpoints' WebRTC connections. The server does only two things—maintains the **state machine** (who is calling whom, whether the call is ringing or connected, and why it ended) and **relays signaling** (SDP / ICE). The server neither decodes nor transcodes media, so it incurs no media bandwidth costs and requires no SFU/MCU.

The trade-off: without TURN, connections **cannot be established** through symmetric NAT or corporate firewalls.

## Endpoint overview

All endpoints require **`chat.call`** permission (a regular feature permission, automatically held by the default group; operators can disable calling entirely by revoking it from groups).

| Method | Path | Description |
| --- | --- | --- |
| POST | `/calls` | Initiate a call `{ conversation_id, mode }` |
| GET | `/calls/ice` | ICE servers provided by this deployment |
| GET | `/calls/:id` | Call details (including participants and derived duration) |
| GET | `/conversations/:id/call` | The conversation's current call, or `null` if none |
| POST | `/calls/:id/answer` | Answer |
| POST | `/calls/:id/decline` | Decline |
| POST | `/calls/:id/hangup` | Hang up |
| POST | `/calls/:id/signal` | Relay signaling |

## Why signaling uses REST

`GET /api/v1/ws` is a **downstream-only** channel: the server's read loop only detects disconnections, and any received frames are discarded. Clients cannot send ICE candidates through it. Therefore:

```
Client A ──POST /calls/:id/signal──► chat service ──NOTIFY──► push service
                                                                  │
Client B ◄──────────── WebSocket: call.signal ◄────────────────────┘
```

**Upstream uses REST; downstream reuses the existing push channel**.

## Data model

### call_sessions

| Column | Description |
| --- | --- |
| `id` | Call ID |
| `conversation_id` | Parent conversation, with cascading deletion |
| `initiator_id` | Initiator, with cascading deletion |
| `mode` | `audio` \| `video` |
| `state` | `ringing` \| `active` \| `ended` |
| `end_reason` | `hung_up` \| `cancelled` \| `declined` \| `timeout` |
| `created_at` / `answered_at` / `ended_at` | Timestamps |
| `duration_seconds` | **Not persisted**; derived from timestamps at query time |

The partial unique index `idx_calls_live ON call_sessions(conversation_id) WHERE state <> 'ended'` guarantees concurrency safety: **only one unfinished call is allowed per conversation at a time**. A second initiation hits the uniqueness constraint and returns `409`, rather than making two calls ring at the other end simultaneously.

### call_participants

The primary key is `(call_id, user_id)`, and `state` is `invited` \| `accepted` \| `declined` \| `left`. The initiator is recorded as `accepted` when the call is created; callees initially have `invited`.

## State machine

```
                 answer
   ringing ─────────────────────────► active ──── hangup ────► ended
      │                                 │
      ├── decline ──────────────────────┤
      ├── cancel (hang up while ringing)┤
      └── timeout (unanswered for 45s) ─┘
```

`ended` is terminal and never returns to ringing; calling again creates a new id. `answer` uses a conditional update with `WHERE state = 'ringing'`, naturally resolving the race when multiple devices answer simultaneously: the losing device receives `409` and the current call state, and stops ringing accordingly.

## Initiate

```http
POST /calls
{ "conversation_id": 123, "mode": "audio" }
```

`mode` is optional and defaults to `audio`. Success returns `201` + `{"call": {...}}` and pushes `call.invited` to the callees (group calls also include the `participant_ids` roster).

| Status | Scenario |
| --- | --- |
| `400` | Invalid parameters; conversation type is not `private`/`group`; no callable group members other than yourself; group exceeds 20 members |
| `403` | Not a conversation member; **the initiator is a bot** (bots have no media endpoint) |
| `404` | Conversation does not exist |
| `409` | The conversation already has an ongoing call |

The group roster consists of **active (`status = active`), non-bot** conversation members, excluding the initiator (bots are silently skipped).

## Answer / decline / hang up

```http
POST /calls/:id/answer
```

Success returns `200` and the latest call, and pushes `call.accepted` to **all participants** (so the callee's other devices stop ringing). `400` if the initiator answers their own outgoing call; `403` for a non-participant; `409` if the call has ended (also used for “no longer ringing” in one-to-one calls).

```http
POST /calls/:id/decline
```

**One-to-one**: declining ends the entire call (`end_reason = declined`).
**Group (mesh)**: declining only removes you from the ringing list; the call continues ringing for others. If nobody answers, the cleanup job eventually times it out.

```http
POST /calls/:id/hangup
```

- Hang up while ringing → `end_reason = cancelled`;
- Hang up after connecting → `end_reason = hung_up`.

`End()` uses a conditional update with `WHERE state <> 'ended'`, so `call.ended` is **pushed only once**.

**Group semantics**: hanging up only marks you as `left` and tears down your own peer connections—if the initiator hangs up while ringing, the entire call is cancelled. Otherwise, the call continues as long as any `accepted` participant remains, and `call.participant_left` is pushed to the others. The call ends when the last `accepted` participant hangs up.

## Group mesh calls

- Each pair establishes a connection, so **upstream bandwidth grows linearly with the number of participants** (each person sends N−1 copies of their own upstream stream), with a **maximum of 20 participants**;
- Each member **answers independently**: the first answer advances the call from `ringing` to `active`; subsequent answers join the ongoing call and return `200` rather than `409`;
- Each joining participant must establish their own peer connection to every accepted member in the roster;
- Ringing/answer notifications are not strongly consistent: late joiners use `call.accepted` events + `GET /calls/:id` to retrieve the roster and establish any missing connections.

Groups larger than 20 require an SFU (not currently implemented).

## Signaling relay

```http
POST /calls/:id/signal
{ "type": "offer", "payload": { } }
```

```http
{ "type": "candidate", "to_user_id": 456, "payload": { "candidate": "..." } }
```

| Rule | Description |
| --- | --- |
| `type` | Must be `offer` / `answer` / `candidate` |
| `payload` | **Opaque**; the server neither parses nor validates it |
| `to_user_id` | Optional; when omitted, forwards to all other participants (the existing contract for one-to-one clients). When specified, sends only to that participant (each mesh peer connection negotiates separately). The target must be a participant in this call, otherwise `403` |
| Limit | **6000 bytes**; exceeding it returns `413` (because `pg_notify` has an 8000-byte per-notification limit, explicit rejection is preferable to silently dropping packets) |
| Persistence | **Not persisted** (candidates are exchanged frequently and have no value after the call) |

No peer available for delivery, or call already ended → `409`. The downstream event is `call.signal`.

> **Multi-device limitation**: the Hub indexes connections by `user_id`, so `call.signal` is delivered to **all of the callee's devices**. Clients must filter by `call_id` and process negotiation data only on the device that actually answered.

## Push events

| Event | Recipients | Payload |
| --- | --- | --- |
| `call.invited` | Callees | `call_id`, `conversation_id`, `initiator_id`, `mode`, `created_at` (plus `participant_ids` for groups) |
| `call.accepted` | All participants | `call_id`, `user_id` |
| `call.declined` | Initiator | `call_id`, `user_id` |
| `call.participant_left` | Other accepted participants | `call_id`, `user_id` (mesh only: tear down the peer connection to this user) |
| `call.ended` | All participants | `call_id`, `conversation_id`, `end_reason`, `duration_seconds` |
| `call.signal` | Target participant or all other participants | `call_id`, `from_user_id`, `to_user_id`, `type`, `payload` |

### State recovery

Push delivery is best-effort, with **no event replay**. Clients must explicitly resynchronize when entering a chat page, reconnecting, or suspecting a missed event:

```http
GET /conversations/:id/call      # Whether this conversation has an ongoing call (null if none)
GET /calls/:id                   # Full state and participants
```

If `call.invited` was missed, there is no call id to query, so the first endpoint is an essential entry point.

## Timeouts and cleanup

- Ringing timeout: **45 seconds**;
- The chat service runs a cleanup job every **2 seconds**, marking expired `ringing` calls as `ended` (`end_reason = timeout`) and pushing `call.ended`;
- The partial index `idx_calls_ringing` supports this without full-table scans;
- Without the cleanup job, if the caller process is killed, the other end would **keep ringing indefinitely**, and `idx_calls_live` would prevent the conversation from **ever starting another call**.

## ICE / TURN configuration

Configure the server once; clients retrieve the configuration through `GET /calls/ice`:

```yaml
call:
  stun_urls: ["stun:stun.example.com:3478"]   # Uses the built-in public STUN list if omitted
  turn_url: "turn:turn.example.com:3478"
  turn_secret: "<shared secret for coturn use-auth-secret>"
```

Environment variables: `CALL_STUN_URLS`, `CALL_TURN_URL`, `CALL_TURN_USERNAME`, `CALL_TURN_CREDENTIAL`, `CALL_TURN_SECRET`.

### Per-user short-lived credentials (recommended)

When `turn_secret` is configured, the server no longer distributes static usernames and passwords. Instead, it issues short-lived credentials for **the current user**:

```json
{
  "ice_servers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "turn:turn.example.com:3478",
      "username": "1736000000:42", "credential": "7j...base64" }
  ],
  "turn": true,
  "ttl": 3600
}
```

`username = "<expiration Unix timestamp>:<user_id>"`, `credential = base64(HMAC-SHA1(turn_secret, username))`, valid for 1 hour. coturn verifies the signature using the same secret and checks the timestamp; the server does not need to store any session state.

Benefit: leaked credentials apply to **one user for one hour**, whereas static credentials are shared system-wide. `ttl` tells clients when to fetch them again—after expiry, call `GET /calls/ice` again and renegotiate, rather than repeatedly attempting NAT traversal with expired credentials.

### No TURN configured

`{"ice_servers": [...], "turn": false}`: connections **will fail** through symmetric NAT / corporate firewalls / some mobile networks, appearing to remain “connecting” before failing. Clients should display an explicit explanation based on this flag.

coturn deployment essentials: open `3478/udp`, `3478/tcp`, `5349/tls`, and the relay port range; use `use-auth-secret` rather than static accounts in production; only relayed traffic incurs bandwidth charges (typically 10%–20% of traffic).

## Call-record messages

Every ended call (answered, declined, timed out, or cancelled) leaves a `kind = "call"` message in the conversation:

```json
{ "call_id": 42, "mode": "audio", "outcome": "answered", "duration_seconds": 201, "initiator_id": 7 }
```

- Written only when the state actually transitions to `ended` (the conditional update determines the winner, preventing duplicate writes);
- `content` is empty; the outcome and duration are in `call_meta` (JSONB). **Wording is localized by the client**—the same row reads differently for the caller and callee;
- `outcome`: `answered` (with duration), `declined`, `missed` (timeout), `cancelled`;
- After writing, `chat.message.created` is broadcast as usual, allowing clients to insert the message immediately.

## Known limitations

- **Incoming calls cannot be received when the app has been killed**: on iOS, CallKit incoming calls can only be delivered while the app is running. Supporting this scenario requires PushKit + an APNs VoIP certificate and a server-side VoIP push channel (the largest current gap).
- **Group calls use mesh**, with a maximum of 20 participants.
- **Bots cannot initiate calls** (`403`); a user's call to a bot rings normally and times out after 45 seconds; bots in group rosters are silently skipped.
- **`call.signal` is delivered to all of the callee's devices**; clients must filter by `call_id`.
- **No event replay**: after reconnection, a connected call that has not been renegotiated cannot be recovered; clients only take over calls in `ringing` state.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Initiation returns `409` | The conversation already has an unfinished call: `SELECT ... FROM call_sessions WHERE conversation_id=$1 AND state<>'ended'` |
| The other party does not receive `call.invited` | Whether they are online (WS connected); whether the event channel is working; whether the services share the same PostgreSQL instance |
| `call.signal` returns `413` | Payload exceeds 6000 bytes; check whether it includes a complete SDP with simulcast |
| Stuck on “connecting” | NAT traversal failed: check STUN/TURN reachability and whether candidates are paired |
| The conversation cannot start another call after one ends | Check that `state` is `ended`; `idx_calls_live` excludes only ended rows |
