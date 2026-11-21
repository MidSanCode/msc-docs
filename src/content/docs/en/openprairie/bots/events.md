---
title: Real-Time Events
description: How bots connect to WebSocket using one-time tickets, event envelopes and types, connection maintenance requirements, and why real-time messages are not a queue.
sidebar:
  order: 3
---

In addition to polling, a bot can connect to the real-time channel to receive events. This is the same channel the app uses (the push service). The server determines recipients from conversation membership/visibility—**a bot receives events when it is a member**.

## Two-Step Connection: Obtain a Ticket, Then Connect

```http
POST /api/v1/ws          (with Authorization: Bearer ofb_…)
  → 200 {"ticket":"<64 hexadecimal digits>","expires_in":30}

GET  /api/v1/ws?ticket=<ticket>   (WebSocket upgrade; use ws:// or wss:// in the URL)
```

| Rule | Description |
| --- | --- |
| Ticket | **Single-use**; invalidated as soon as it is used |
| Validity | **30 seconds**, enough only to obtain the ticket and connect immediately |
| Expired / already used / nonexistent | Always rejected |

:::caution[A Bare GET Returns 401]
The upgrade request (`GET /api/v1/ws`) uses the gateway's `authTicket` level. The gateway **first removes identity headers and then forwards the request unchanged**, leaving ticket redemption to the push service. Therefore, **a bare `GET` carrying only a token (without `ticket`) returns `401`**, even if the token is valid. You must first obtain a ticket with `POST`.

This is intentional: browsers cannot set custom headers during a WebSocket handshake, and placing a long-lived token in a URL would leak it into logs. A short-lived, one-time ticket avoids this. **Do not put the bot token in the query string for convenience.**
:::

## Event Format

The first message after connecting is a greeting:

```json
{"type":"connected"}
```

Every subsequent message uses the same envelope:

```json
{
  "type": "chat.message.created",
  "recipients": [7, 4242],
  "data": {
    "id": 9001,
    "conversation_id": 33,
    "sender_id": 7,
    "kind": "text",
    "content": "Hello",
    "created_at": "2026-10-10T15:22:41Z"
  }
}
```

`data` is the corresponding resource object (a message object for message events, a post object for post events). Only a few fields are shown above; see the message model for the complete field list.

## Event Types

| `type` | `data` | Recipients |
| --- | --- | --- |
| `chat.message.created` | Message object | `active` conversation members |
| `chat.message.updated` | Message object | Same as above |
| `chat.message.deleted` | Message object | Same as above |
| `chat.typing` | `{conversation_id, user_id}` | Conversation members |
| `chat.conversation.updated` | `{conversation_id}` | Conversation members |
| `chat.consent.requested` | `{user_id, encrypted, …}` | Request recipient |
| `chat.e2ee.keys.updated` | Key-envelope metadata | Conversation members |
| `post.created` | Post object | See “Visibility” below |
| `post.deleted` | Post object | Same as above |
| `post.reply.created` / `.updated` / `.deleted` | Reply object | Post author and other relevant parties |
| `call.invited` / `call.ended`, etc. | Call payload | See [Calls](/en/openprairie/api/calls/#push-events) |

Recipients of `post.created` depend on visibility: `private` goes only to the author; `friends` goes to mutual followers + the author; `public` / `login` is **broadcast to every connected client** (an empty `recipients` array means broadcast).

## Connection Maintenance

- The server sends a ping every **54 seconds**, with a **60-second** read timeout. The bot must return pong promptly (most WebSocket libraries handle this automatically), or the connection is closed;
- Each connection has a send buffer of **256 messages**. If the buffer cannot accept another message (the consumer is too slow), the connection is **closed immediately** rather than allowing a backlog. Process events promptly and move expensive operations into your own queue;
- Events are forwarded through PostgreSQL `NOTIFY` with **best-effort** delivery, not a durable queue. Events during a service restart or disconnection **are not replayed**.

:::danger[Real-Time ≠ Reliable]
**Use real-time events as low-latency triggers, and periodically reconcile state through REST.** After reconnecting, fetch the latest state (for example, fill gaps using the message list and deduplicate by id). Do not assume the event stream is complete.
:::

## Minimal Working Loop

```python
import asyncio, json, websockets

async def listen(bot, ws_base):
    while True:
        try:
            _, res = bot.request("POST", "/api/v1/ws")          # Obtain a ticket
            async with websockets.connect(
                    f"{ws_base}/api/v1/ws?ticket={res['ticket']}") as ws:
                async for raw in ws:
                    evt = json.loads(raw)
                    if evt.get("type") != "chat.message.created":
                        continue
                    data = evt.get("data") or {}
                    if data.get("sender_id") == BOT_ID or data.get("sender_is_bot"):
                        continue
                    await handle(data)
        except Exception:
            await asyncio.sleep(5)      # Reconnect; events are not replayed, so reconcile by polling afterward
```

Remember three things: **obtain a ticket before connecting**, **skip yourself and other bots**, and **reconnect and reconcile after disconnection**.
