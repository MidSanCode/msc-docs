---
title: Cookbook and Limitations
description: Chat and content bot patterns, E2EE conversation considerations, count and rate limits, an error-code reference, best practices, and a complete Python example.
sidebar:
  order: 4
---

## Identify Yourself First

```python
status, me = bot.request("GET", "/api/v1/users/me")
BOT_ID = me["id"]
```

Remember `BOT_ID`: all subsequent checks for your own messages depend on it.

## Chat Bots

### Polling Version (Simplest; No Persistent Connection Required)

On each iteration, fetch the latest page, deduplicate by id, and process only messages newer than the highest id already seen and not sent by the bot itself.

```python
def poll_loop(bot, conv_id, interval=3.0):
    # Initialize the cursor at startup to avoid replying to the entire message history
    _, page = bot.request("GET", f"/api/v1/conversations/{conv_id}/messages",
                          query={"limit": 1})
    last_seen = page["messages"][-1]["id"] if page["messages"] else 0

    while True:
        _, page = bot.request("GET", f"/api/v1/conversations/{conv_id}/messages",
                              query={"limit": 50})
        for msg in page["messages"]:
            if msg["id"] <= last_seen:
                continue
            last_seen = msg["id"]
            handle(bot, conv_id, msg)
        time.sleep(interval)


def handle(bot, conv_id, msg):
    if msg["sender_id"] == BOT_ID:            # Skip messages sent by this bot
        return
    if msg.get("kind") != "text":             # Do not treat system messages (joins/mutes…) as commands
        return
    if msg.get("sender_is_bot"):              # Ignore other bots to prevent reply loops
        return
    text = (msg.get("content") or "").strip()
    if text == "/ping":
        bot.request("POST", f"/api/v1/conversations/{conv_id}/messages",
                    body={"content": "pong", "reply_to_id": msg["id"]})
```

:::danger[Three Guards Against Reply Loops]
**Skip yourself**, **skip non-`text` messages**, and **skip other bots**. Omitting any one of these checks can cause a feedback loop (a bot replying to its own replies and flooding the conversation indefinitely).
:::

### Event-Driven Version (Low Latency)

See [Real-Time Events](/en/openprairie/bots/events/#minimal-working-loop). Key points: obtain a ticket before connecting, apply the same three reply-loop guards, and reconcile by polling after reconnecting.

### Initiating Direct Chats: Send a Conversation Request First

```bash
curl -s -X POST "$BASE/api/v1/conversations/start" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id": 7, "message": "Hello, I'm a bot. I can help you check the weather.", "encrypted": false}'
```

- This only **sends a request**; it does not create a conversation. The conversation exists only after the recipient accepts, and messages can be sent afterward;
- Sending another request while one is pending → `409 a chat request is already pending`;
- Sending a request to yourself → `400 cannot start a chat with yourself`;
- **Use `encrypted: true` with care**; see the E2EE section below.

To add a bot to a group, a group administrator invites it using `POST /conversations/:id/invite`. For public groups, the bot can also join itself using `POST /conversations/:id/join`.

## Content Bots

```python
# A text-only post
bot.request("POST", "/api/v1/posts",
            body={"content": "Daily market update: …", "visibility": "public", "tags": ["market"]})

# With an image: upload first, then reference the attachment id
aid = upload_file(bot, "chart.png")          # POST /attachments (multipart, field name file)
bot.request("POST", "/api/v1/posts",
            body={"content": "Today's chart", "visibility": "public", "attachment_ids": [aid]})

# Repost/quote an existing post
bot.request("POST", "/api/v1/posts",
            body={"content": "Worth a read", "quoted_post_id": 12345})

# Post in a camp (must already be a member)
bot.request("POST", "/api/v1/posts",
            body={"content": "Camp-exclusive announcement", "camp_id": 66})
```

- Scheduled jobs that only publish content and never read it **do not need** WebSocket;
- To react to **new posts**, listen for `post.created` (`public`/`login` posts are broadcast to all connected clients), or poll with `GET /posts?page=1`. Posts use page-number pagination; identify new posts by tracking the highest id seen;
- Post content is limited to 5000 characters and at most 9 attachments; exceeding either limit returns `400` immediately.

## E2EE and Chat

A conversation may be **end-to-end encrypted** (`Conversation.Encrypted`):

> `Encrypted` marks the conversation as end-to-end encrypted: messages are stored as ciphertext, and only clients holding the group key can decrypt them.

For bots, the implications are straightforward:

- In an **encrypted conversation**, `content` contains ciphertext that the bot **cannot read**;
- Messages sent by the bot must also be encrypted on the client side; the server does not do this for it;
- To fully participate in encrypted conversations, a bot must implement the entire group-key workflow: each member publishes an X25519 public key; the group key is wrapped into an envelope (`E2EEKeyEnvelope`) for each member using that member's public key; envelopes are stored and retrieved through `GET|POST /api/v1/conversations/:id/e2ee-keys`; and the version is updated when adding members or rotating keys. This is too costly for most community bots;
- **History search is also unavailable** in E2EE conversations (the server has only ciphertext).

:::tip[Recommendation]
Run bots only in **unencrypted** conversations. Check `conversation.encrypted` at startup or when joining a conversation. If it is `true`, skip the conversation and log the reason instead of treating ciphertext as text (which would produce garbled replies).
:::

## Limits, Bans, and Lifecycle

| Item | Value |
| --- | --- |
| Bots owned by one user | **10** |
| Tokens per bot | **1** (a reset replaces it) |
| Can a bot create another bot? | ❌ `403` |
| Token format | `ofb_` + 64 hexadecimal digits (68 characters) |
| Pending-report rate limit | **20/hour** |
| Gateway aggregate rate limit | **Per-IP token bucket: 120 requests/minute, burst 240** |

There are two entirely different rate-limiting mechanisms:

- **Coarse gateway rate limiting**: one token bucket **per source IP**, with a default of 120 requests/minute and burst 240. The bucket key is the **actual TCP peer address**; client-forgeable headers are not trusted. Exceeding the limit does not immediately reject a request: it **waits briefly** for a token and returns `429` only if none becomes available. Normal requests are therefore slowed down; sustained traffic floods are rejected. It **does not distinguish bots from ordinary users** and **does not count per token**. All requests behind the same outbound IP share a bucket (common with NAT/data-center egress and behind proxy layers).
- **`pkg/ratelimit`**: counts only “failed attempts” (failed logins and incorrect payment PIN attempts); it does not apply to normal requests.

Reports have a separate quota of **20/hour** (`429 too many reports, please try again later`).

> Source comments mention overriding 120/240 with `OPENFIELD_RATE_LIMIT_RPM` / `_BURST`, but the current implementation **does not read** these environment variables. The values are hardcoded; follow the code.

Repeatedly hammering endpoints therefore has a cost, charged per IP. Constraints such as disconnection at a 256-message send buffer or a message-list limit of 100 are soft constraints; gateway rate limiting is a hard one. **Control request frequency and prefer events over busy polling.**

**Bans**: operators can punish bots (`user.punish`). A banned bot is rejected during token parsing, and all requests return `401 {"error":"invalid bot token"}`. Once the ban expires, the token becomes usable automatically; no reset is needed.

**Lifecycle**:

- Deleting a bot (or deleting its owner, through the `bot_owner_id` cascade) → the bot and all its content (posts/replies/messages/attachments) disappear together;
- Resetting the token → the old token immediately becomes invalid; the bot and its content are unaffected;
- A bot cannot change owners: `bot_owner_id` cannot be changed through the API. The only endpoint for editing its own profile, `PUT /users/me`, accepts only `username` / `nickname` / `bio`.

## Error-Code Reference

| Status | Typical response body | Cause and handling |
| --- | --- | --- |
| `400` | `missing file field` | Upload omitted the `file` field |
| `400` | `invalid request body` | JSON parsing failed or required fields are missing |
| `400` | `content exceeds maximum length of 5000` | Content is too long |
| `400` | `too many attachments (max 9)` | More than 9 attachments |
| `400` | `unknown visibility` | `visibility` is not one of `public/login/friends/private` |
| `400` | `message cannot be empty` | All three message fields are empty |
| `400` | `invalid burn_seconds (allowed: 0, or 5..86400)` | Invalid disappearing-message duration |
| `401` | `missing authorization token` | No `Authorization` header |
| `401` | `invalid bot token` | Token reset/nonexistent/**bot banned** → obtain the token again or contact the operator |
| `403` | `permission denied` (with `permission` field) | Missing permission |
| `403` | `bot accounts cannot create bots` | Attempted bot creation using a bot token |
| `403` | `bot limit reached` (with `limit: 10`) | Limit reached |
| `403` | `not your bot` | Attempted to operate on another user's bot |
| `403` | `join the camp before posting into it` | Attempted to post in a camp without joining |
| `403` | `only camp admins may post in this camp` | The camp has disabled member posting |
| `403` | `you are not a member of this conversation` | Attempted to read messages in a nonpublic group |
| `404` | `bot not found` / `post not found` | Does not exist or is invisible to the current identity |
| `409` | `username already taken` | Username already in use when creating a bot |
| `409` | `a chat request is already pending` | Duplicate direct-chat request |
| `409` | `you have already reported this` | Duplicate report for the same target |
| `429` | `too many reports, please try again later` | More than 20 reports/hour |
| `500` | Any | Server failure; retry with backoff |

## Unsupported Capabilities

Before writing a bot, check that your requirements do not depend on the following capabilities—these are **absent from the current implementation**:

- **No outbound Webhooks / HTTP callbacks**. The server pushes only through WebSocket; it does not proactively POST to your address. There are only two ways to receive events: connect to WebSocket or poll REST.
- **No event subscription filters**. Connecting to `/api/v1/ws` delivers all events addressed to your identity. There is no server-side filtering such as “mentions only”, and no event replay or redelivery.
- **No fine-grained token scopes**. Each bot has one token, with permissions determined by its permission groups. You cannot issue a subordinate token limited to posting.
- **Messages have no `after` cursor**, only `before`. Poll the latest page and deduplicate yourself to obtain new messages.
- **No slash-command / interactive-component framework**. Implement all command parsing in the bot; the server treats commands as ordinary messages.
- **Bots cannot create bots** or transfer ownership.
- **No public bot directory** (`GET /bots` returns only your own bots).
- **Moderation capabilities are unavailable**: the default group lacks `user.punish`, so bots cannot ban/punish users; they can only report them.
- **The object-storage proxy does not accept bot tokens**: `GET /api/v1/files/...` parses only JWTs. On this path a bot is anonymous and cannot read private attachments. Use the service's own routes instead, such as `GET /conversations/:id/files`.
- **No independent per-bot quota**: gateway rate limiting is keyed by source IP; all bots and users behind the same outbound IP share a bucket.

## Best Practices

1. **Store tokens only in environment variables / secret managers**, never in a repository, logs, or URL queries; regenerate immediately if leaked.
2. **Check at startup**: confirm identity with `GET /users/me` and the capability set with `GET /users/me/permissions`. On `401`, exit and alert instead of continuing to send requests.
3. **One bot per function** makes content traceable by bot and allows token reset / deactivation per bot.
4. **Apply all three reply-loop guards**: skip `sender_id == BOT_ID`, skip `sender_is_bot`, and skip `kind != "text"`.
5. **Prefer events, with polling as a fallback**: use WebSocket for low-latency triggers and periodically reconcile the full state to fill gaps from disconnections.
6. **Retry with backoff**: use exponential backoff for `5xx`. For `429`, first identify the limit: the gateway uses a **source-IP** bucket of 120 requests/minute (burst 240), so back off and reduce concurrency; concurrent retries only worsen the throttling. A report `429` means the 20/hour quota; wait for the next hourly window. **Do not blindly retry `401/403`**.
7. **Identify new content by id**, not timestamps (multiple messages within the same second can have identical timestamps).
8. **Avoid encrypted conversations**: skip conversations with `encrypted: true` unless you implement the E2EE key workflow.
9. **Consider cascading deletion**: deleting a bot also deletes all posts and messages it has sent; operators should take care.
10. **Do not pretend to be human**: bots have a bot badge, and community rules usually require automated-account behavior to be identifiable.

## Complete Python Example

Uses only the standard library (`urllib`) and can run directly. Replace `BASE` / `BOT_TOKEN` / `CONV_ID` with your own values.

```python
#!/usr/bin/env python3
"""OpenPrairie community bot example: join a conversation and respond to /ping and @mentions."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request


class OpenFieldBot:
    def __init__(self, base_url: str, token: str):
        self.base = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, body=None, query=None):
        """Send a request and return (status, payload). Return HTTP errors rather than raising them."""
        url = f"{self.base}{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = {"error": raw.decode("utf-8", "replace")}
            return exc.code, payload

    # --- Common helpers ---
    def me(self):
        return self.request("GET", "/api/v1/users/me")

    def send_message(self, conv_id, content, reply_to=None):
        body = {"content": content}
        if reply_to:
            body["reply_to_id"] = reply_to
        return self.request("POST", f"/api/v1/conversations/{conv_id}/messages", body=body)

    def messages(self, conv_id, limit=50, before=0):
        query = {"limit": limit}
        if before:
            query["before"] = before
        return self.request("GET", f"/api/v1/conversations/{conv_id}/messages", query=query)

    def create_post(self, content, visibility="public"):
        return self.request("POST", "/api/v1/posts",
                            body={"content": content, "visibility": visibility})

    def upload(self, path, mime="application/octet-stream"):
        """Upload as multipart/form-data; the field name must be file."""
        boundary = "----openprairiebot"
        with open(path, "rb") as fh:
            blob = fh.read()
        parts = [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path}"\r\n'.encode(),
            f"Content-Type: {mime}\r\n\r\n".encode(),
            blob,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        req = urllib.request.Request(f"{self.base}/api/v1/attachments",
                                     data=b"".join(parts), method="POST")
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())


def main():
    bot = OpenFieldBot("http://localhost:8080", "ofb_replace-this-with-your-token")
    status, me = bot.me()
    if status != 200:
        raise SystemExit(f"Bot authentication failed: HTTP {status} {me}")
    bot_id = me["id"]
    print(f"Logged in: {me['nickname']} (#{bot_id}, is_bot={me.get('is_bot')})")

    conv_id = 33  # Replace with your conversation id

    # Initialize the cursor to avoid replying to historical messages
    _, page = bot.messages(conv_id, limit=1)
    last_seen = page["messages"][-1]["id"] if page.get("messages") else 0
    print(f"Current highest message id = {last_seen}")

    while True:
        status, page = bot.messages(conv_id, limit=50)
        if status != 200:
            print(f"Fetch failed HTTP {status} {page}; retrying later")
            time.sleep(10)
            continue

        for msg in page.get("messages", []):
            if msg["id"] <= last_seen:
                continue
            last_seen = msg["id"]

            # Prevent reply loops: skip yourself, other bots, and system messages
            if msg.get("sender_id") == bot_id or msg.get("sender_is_bot"):
                continue
            if msg.get("kind") != "text":
                continue

            text = (msg.get("content") or "").strip()
            mentioned = bot_id in (msg.get("mentions") or []) or -1 in (msg.get("mentions") or [])
            if text == "/ping":
                bot.send_message(conv_id, "pong", reply_to=msg["id"])
            elif mentioned and "weather" in text:
                bot.send_message(conv_id, "Sunny today, 21°C.", reply_to=msg["id"])

        time.sleep(3)


if __name__ == "__main__":
    main()
```

## Basis for Verification

The conclusions in this guide come from line-by-line reading of the server source (endpoint signatures, SQL, route tables, permission constants, and migration definitions), rather than comprehensive live integration testing.

**Items not yet verified in a real environment** (validate these during integration):

- **End-to-end WebSocket connectivity**: the ticket flow, `{"type":"connected"}` greeting frame, and event-envelope format come from source code, but a full round trip has not been tested through a real gateway (especially with a reverse proxy and TLS). In particular, check proxy effects on WebSocket upgrades and the 30-second ticket window.
- **Banned bots returning `401`**: inferred from the code order in which token parsing precedes the ban check; not tested live.
- **Actual limit behavior**: disconnection at a 256-message send buffer and actual rate-limit throughput have not been load-tested.
- **`post.created` broadcast scope**: the conclusion that `public`/`login` posts are broadcast to all connected clients comes from the implementation returning `nil` in `postRecipients`; it has not been observed with multiple clients.
- **Attachment multipart details** (field name `file`) come from `c.Request.FormFile("file")`. The maximum single-request size and permitted MIME types have not been verified (the latter depend on the server's storage configuration).

Minimum validation set: use two real accounts + one bot to complete “create bot → publish post → join group → send/receive messages → disconnect/reconnect”, plus deliberately trigger `401`/`403`/`409`/`429` once each.
