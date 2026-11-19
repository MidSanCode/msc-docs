---
title: 实时事件
description: bot 如何通过一次性票据连接 WebSocket、事件信封与类型、连接维护要求，以及为什么实时消息不能当作队列。
sidebar:
  order: 3
---

除了轮询，bot 可以连上实时通道接收事件。通道与 App 用的是同一个（push 服务），事件受众由服务端按会话成员/可见性计算——**bot 是成员就能收到**。

## 两步连接：先换票，再连

```http
POST /api/v1/ws          （带 Authorization: Bearer ofb_…）
  → 200 {"ticket":"<64 位十六进制>","expires_in":30}

GET  /api/v1/ws?ticket=<ticket>   （WebSocket 升级；URL 用 ws:// 或 wss://）
```

| 规则 | 说明 |
| --- | --- |
| 票据 | **一次性**，用掉即失效 |
| 有效期 | **30 秒**，只够“取票 → 立刻连接”这段间隔 |
| 过期 / 用过 / 不存在 | 一律拒绝 |

:::caution[裸 GET 会 401]
升级请求（`GET /api/v1/ws`）在网关侧是 `authTicket` 级别——网关会**先删掉身份头再原样转发**，由 push 服务去兑换票据。所以**只带 token 的裸 `GET`（不带 `ticket`）会拿到 `401`**，即使 token 有效。必须走 `POST` 取票这一步。

这也是设计意图：浏览器无法在 WebSocket 握手时自定义头，而把长期 token 放进 URL 会泄进日志，所以用一次性短票代替。**不要为了省事把 bot token 写进 query string。**
:::

## 事件格式

连上后首先收到一句问候：

```json
{"type":"connected"}
```

之后每条消息都是同一个信封：

```json
{
  "type": "chat.message.created",
  "recipients": [7, 4242],
  "data": {
    "id": 9001,
    "conversation_id": 33,
    "sender_id": 7,
    "kind": "text",
    "content": "你好",
    "created_at": "2026-10-10T15:22:41Z"
  }
}
```

`data` 就是对应的资源对象（消息事件给消息对象，帖子事件给帖子对象）；上面只列了几个字段，完整字段见消息模型。

## 事件类型

| `type` | `data` | 受众 |
| --- | --- | --- |
| `chat.message.created` | 消息对象 | 会话内 `active` 成员 |
| `chat.message.updated` | 消息对象 | 同上 |
| `chat.message.deleted` | 消息对象 | 同上 |
| `chat.typing` | `{conversation_id, user_id}` | 会话成员 |
| `chat.conversation.updated` | `{conversation_id}` | 会话成员 |
| `chat.consent.requested` | `{user_id, encrypted, …}` | 被请求方 |
| `chat.e2ee.keys.updated` | 密钥信封元数据 | 会话成员 |
| `post.created` | 帖子对象 | 见下方「可见性」 |
| `post.deleted` | 帖子对象 | 同上 |
| `post.reply.created` / `.updated` / `.deleted` | 评论对象 | 帖子作者等相关方 |
| `call.invited` / `call.ended` 等 | 通话载荷 | 见[通话](/openprairie/api/calls/#推送事件) |

`post.created` 的受众按可见性计算：`private` 只发作者，`friends` 发互关好友 + 作者，`public` / `login` 是**广播给所有已连接客户端**（`recipients` 为空数组即广播）。

## 连接维护

- 服务端每 **54 秒**发一个 ping，读超时 **60 秒**——bot 必须及时回 pong（多数 WebSocket 库自动处理），否则连接被断开；
- 每个连接的发送缓冲是 **256 条**，写不进去（消费太慢）会被**直接断开**，不做堆积。请务必及时处理事件，代价高的操作丢进自己的队列；
- 事件是 PostgreSQL `NOTIFY` 转发的**尽力而为**投递，不是持久队列：服务重启、连接掉线期间的事件**不会补发**。

:::danger[实时 ≠ 可靠]
**实时事件用来做低延迟触发，定期用 REST 做对账。** 断线重连后必须拉一次最新状态（例如消息列表按 id 去重补齐），不要假设事件是完整的。
:::

## 最小可用循环

```python
import asyncio, json, websockets

async def listen(bot, ws_base):
    while True:
        try:
            _, res = bot.request("POST", "/api/v1/ws")          # 取票
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
            await asyncio.sleep(5)      # 断线重连；事件不补发，重连后按轮询对账
```

注意三件事：**取票后再连**、**跳过自己与其他 bot**、**断线后重连并补对账**。