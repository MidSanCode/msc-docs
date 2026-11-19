---
title: 实战与限制
description: 聊天机器人与内容机器人写法、E2EE 会话注意事项、数量与速率上限、错误码速查、最佳实践与完整 Python 示例。
sidebar:
  order: 4
---

## 先给自己定位

```python
status, me = bot.request("GET", "/api/v1/users/me")
BOT_ID = me["id"]
```

记住 `BOT_ID`：后面所有“是不是我在说话”的判断都靠它。

## 聊天机器人

### 轮询版（最简单，无需长连接）

思路：每轮取最新一页，按 id 去重，只处理“比我见过的最大 id 更新、且不是我自己发的”消息。

```python
def poll_loop(bot, conv_id, interval=3.0):
    # 启动时先对齐游标，避免把历史消息全部回一遍
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
    if msg["sender_id"] == BOT_ID:            # 自己发的，跳过
        return
    if msg.get("kind") != "text":             # 系统消息（入群/禁言…）不当指令
        return
    if msg.get("sender_is_bot"):              # 别的 bot，忽略，防止互刷
        return
    text = (msg.get("content") or "").strip()
    if text == "/ping":
        bot.request("POST", f"/api/v1/conversations/{conv_id}/messages",
                    body={"content": "pong", "reply_to_id": msg["id"]})
```

:::danger[防自激三连]
**跳过自己**、**跳过非 `text`**、**跳过其它 bot**——缺一个就可能出现自激循环（bot 回复自己的回复，无限刷屏）。
:::

### 事件版（延迟低）

见[实时事件](/openprairie/bots/events/#最小可用循环)。要点：取票再连、同样做防自激三连、断线重连后按轮询对账。

### 主动私聊：必须先发会话请求

```bash
curl -s -X POST "$BASE/api/v1/conversations/start" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id": 7, "message": "你好，我是机器人，可以帮你查天气。", "encrypted": false}'
```

- 这只是**发出请求**，不创建会话；对方接受后才有会话，之后才能发消息；
- 已有待处理请求时再发 → `409 a chat request is already pending`；
- 给自己发 → `400 cannot start a chat with yourself`；
- **`encrypted: true` 请谨慎**，见下方 E2EE 一节。

向群里加 bot：由群管理员用 `POST /conversations/:id/invite` 邀请；公开群也可以让 bot 自己 `POST /conversations/:id/join`。

## 内容机器人

```python
# 一条纯文字帖
bot.request("POST", "/api/v1/posts",
            body={"content": "每日行情：…", "visibility": "public", "tags": ["market"]})

# 带图：先上传，再引用附件 id
aid = upload_file(bot, "chart.png")          # POST /attachments (multipart, 字段名 file)
bot.request("POST", "/api/v1/posts",
            body={"content": "今日图表", "visibility": "public", "attachment_ids": [aid]})

# 转发/引用已有帖子
bot.request("POST", "/api/v1/posts",
            body={"content": "值得一读", "quoted_post_id": 12345})

# 在营地里发（必须先是营地成员）
bot.request("POST", "/api/v1/posts",
            body={"content": "营地专属公告", "camp_id": 66})
```

- 只发不看的定时任务，**不需要** WebSocket；
- 想对**新帖**作出反应，可以监听 `post.created`（`public`/`login` 的帖子会广播给所有已连接客户端），或用 `GET /posts?page=1` 轮询——帖子是页码分页，判断“新”要靠记录见过的最大 id；
- 发帖内容上限 5000 字符、附件最多 9 个，超了直接 `400`。

## E2EE 与聊天

会话可能是**端到端加密**的（`Conversation.Encrypted`）：

> `Encrypted` 标记该会话为端到端加密：消息以密文存储，只有持有群密钥的客户端能解密。

对 bot 的含义很直接：

- 在**加密会话**里，`content` 拿到的是密文，bot **读不懂**；
- bot 自己发的内容也必须由客户端侧加密，服务端不代劳；
- 想真正参与加密会话，bot 需要实现整套群密钥流程：成员各自发布 X25519 公钥，群密钥用每个成员的公钥封装成信封（`E2EEKeyEnvelope`），通过 `GET|POST /api/v1/conversations/:id/e2ee-keys` 存取，并在加人/轮换时更新版本。这对多数社区 bot 来说代价过高；
- E2EE 会话中**历史搜索也不可用**（服务端只有密文）。

:::tip[建议]
bot 只在**非加密**会话里工作。启动或加入会话时检查 `conversation.encrypted`，为 `true` 就跳过并在日志里说明原因，而不是把密文当文本处理（那会产生一堆乱码回复）。
:::

## 上限、封禁与生命周期

| 项 | 值 |
| --- | --- |
| 单个用户可拥有的 bot 数 | **10** |
| 每个 bot 的 token 数 | **1**（重置即替换） |
| bot 能否再建 bot | ❌ `403` |
| token 格式 | `ofb_` + 64 位十六进制（68 字符） |
| 待处理举报频率上限 | **20 条/小时** |
| 网关总量限流 | **按 IP 令牌桶：120 请求/分钟，突发 240** |

关于限流，有两套完全不同的东西，别混为一谈：

- **网关的粗粒度限流**：**每个来源 IP** 一个令牌桶，默认 120 请求/分钟、突发 240。桶的 key 是**真实 TCP 对端地址**，不采信任何客户端可伪造的头。超限时不是立刻拒绝，而是**先短暂等待**令牌，等不到才 `429`——所以正常请求只是被拖慢，持续灌流量才会被打掉。它**不区分 bot 与普通用户**，也**不按 token 计数**：同一个出口 IP 后面的所有请求共用一个桶（NAT/机房出口、代理层后面普遍如此）。
- **`pkg/ratelimit`**：只统计“错误次数”（登录失败、支付 PIN 试错），不作用于正常请求。

举报另有 **20 条/小时** 的独立配额（`429 too many reports, please try again later`）。

> 源码注释提到可用 `OPENFIELD_RATE_LIMIT_RPM` / `_BURST` 覆盖 120/240，但当前实现**没有读取**这两个环境变量，是硬编码值——以代码为准。

所以“刷接口”并非没有代价，而且代价按 IP 结算：上面那些“发送缓冲 256 条就断开”“消息列表 limit 上限 100”是软约束，网关限流是硬的。**请自觉控制频率，用事件驱动而不是忙轮询。**

**封禁**：bot 可以被运营方处罚（`user.punish`）。被封禁的 bot 在 token 解析阶段即被拒绝，所有请求返回 `401 {"error":"invalid bot token"}`。封禁到期后 token 自动恢复可用，无需重置。

**生命周期**：

- 删除 bot（或删除 bot 的所有者，`bot_owner_id` 级联）→ bot 及其全部内容（帖子/回复/消息/附件）一并消失；
- 重置 token → 旧 token 立即失效，bot 本身与内容不受影响；
- bot 无权“改嫁”：`bot_owner_id` 不可通过 API 变更——唯一能改自己的接口 `PUT /users/me` 只接受 `username` / `nickname` / `bio` 三个字段。

## 错误码速查

| 状态 | 典型响应体 | 原因与处理 |
| --- | --- | --- |
| `400` | `missing file field` | 上传没带 `file` 字段 |
| `400` | `invalid request body` | JSON 解析失败、必填字段缺失 |
| `400` | `content exceeds maximum length of 5000` | 内容超长 |
| `400` | `too many attachments (max 9)` | 附件超 9 个 |
| `400` | `unknown visibility` | `visibility` 不在 `public/login/friends/private` 里 |
| `400` | `message cannot be empty` | 消息三个字段全空 |
| `400` | `invalid burn_seconds (allowed: 0, or 5..86400)` | 阅后即焚秒数非法 |
| `401` | `missing authorization token` | 没带 `Authorization` 头 |
| `401` | `invalid bot token` | token 被重置/不存在/**bot 被封禁** → 重新取 token 或联系运营 |
| `403` | `permission denied`（带 `permission` 字段） | 缺权限 |
| `403` | `bot accounts cannot create bots` | 用 bot token 去建 bot |
| `403` | `bot limit reached`（带 `limit: 10`） | 已达上限 |
| `403` | `not your bot` | 操作别人的 bot |
| `403` | `join the camp before posting into it` | 未加入营地就发营地帖 |
| `403` | `only camp admins may post in this camp` | 营地关闭了成员发帖 |
| `403` | `you are not a member of this conversation` | 读非公开群的消息 |
| `404` | `bot not found` / `post not found` | 不存在或对当前身份不可见 |
| `409` | `username already taken` | 建 bot 时用户名被占 |
| `409` | `a chat request is already pending` | 重复发起私聊请求 |
| `409` | `you have already reported this` | 重复举报同一目标 |
| `429` | `too many reports, please try again later` | 举报超 20 条/小时 |
| `500` | 任意 | 服务端故障，可退避重试 |

## 不支持的能力

写 bot 之前先确认需求没有落在这里——这些是**当前实现里确实没有**的：

- **没有出站 Webhook / HTTP 回调**。服务端只会通过 WebSocket 推送，不会主动 POST 到你的地址。接收事件只有两条路：连 WebSocket，或轮询 REST。
- **没有事件订阅过滤**。连上 `/api/v1/ws` 就收你自己该收的全部事件，没有“只订阅 mention”这类服务端筛选，也没有事件重放/补发。
- **没有细粒度 token 作用域**。一个 bot 一个 token，权限=该 bot 的权限组，不能签发“只能发帖”的子 token。
- **消息没有 `after` 游标**，只有 `before`。取新消息要轮询最新页 + 自己去重。
- **没有斜杠命令 / 交互式组件框架**。命令解析完全由你在 bot 侧实现（服务端只是普通消息）。
- **bot 不能创建 bot**，也不能转让归属。
- **没有公开的 bot 目录**（`GET /bots` 只返回自己的 bot）。
- **审核类能力不可得**：默认组没有 `user.punish`，bot 不能封禁/处罚用户，只能举报。
- **对象存储代理不认 bot token**：`GET /api/v1/files/...` 只解析 JWT，bot 在这条路径上等价于匿名，读不到私有附件。走服务自己的路由（如 `GET /conversations/:id/files`）可以。
- **没有按 bot 的独立配额**：网关限流按来源 IP 计，同一出口 IP 后的所有 bot 与用户共用桶。

## 最佳实践

1. **Token 只放环境变量 / 密钥管理**，不要进代码库、日志或 URL query；泄露立刻 regenerate。
2. **启动先自检**：`GET /users/me` 确认身份、`GET /users/me/permissions` 确认能力集，拿到 `401` 就退出并告警，而不是拿去刷请求。
3. **一个功能一个 bot**：便于按 bot 追溯内容、按 bot 重置 token / 停用。
4. **防自激三连**：跳过 `sender_id == BOT_ID`、跳过 `sender_is_bot`、跳过 `kind != "text"`。
5. **首选事件，轮询兜底**：WebSocket 做低延迟触发，定时全量对账补齐掉线期间的事件。
6. **退避重试**：对 `5xx` 用指数退避；对 `429` 先看是哪种限流——网关是按**来源 IP** 的 120 请求/分钟桶（突发 240），退避并降低并发，不要用并发重试把它打得更死；举报的 `429` 则是 20 条/小时配额，要等到下一个小时窗口；**不要对 `401/403` 盲目重试**。
7. **判“是不是新内容”靠 id**，不要靠时间戳（同一秒内多条消息时间戳可能相同）。
8. **别碰加密会话**：`encrypted: true` 的会话跳过，除非真实现了 E2EE 密钥流程。
9. **注意删除的连带影响**：删 bot 会连带删掉它发过的所有帖子和消息；运营方谨慎操作。
10. **态度上别假装人类**：bot 有机器人徽章，社区规则通常要求自动账号行为可识别。

## 完整 Python 示例

只用标准库（`urllib`），可直接跑。把 `BASE` / `BOT_TOKEN` / `CONV_ID` 换成自己的。

```python
#!/usr/bin/env python3
"""OpenPrairie 社区 bot 示例：连接会话，响应 /ping 与 @提及。"""

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
        """发一个请求，返回 (status, payload)。HTTP 错误也返回而不抛出。"""
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

    # --- 常用封装 ---
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
        """multipart/form-data 上传，字段名必须是 file。"""
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
    bot = OpenFieldBot("http://localhost:8080", "ofb_把这里换成你的token")
    status, me = bot.me()
    if status != 200:
        raise SystemExit(f"bot 认证失败：HTTP {status} {me}")
    bot_id = me["id"]
    print(f"已登录：{me['nickname']} (#{bot_id}, is_bot={me.get('is_bot')})")

    conv_id = 33  # 换成你的会话 id

    # 对齐游标，避免回复历史消息
    _, page = bot.messages(conv_id, limit=1)
    last_seen = page["messages"][-1]["id"] if page.get("messages") else 0
    print(f"当前最大消息 id = {last_seen}")

    while True:
        status, page = bot.messages(conv_id, limit=50)
        if status != 200:
            print(f"拉取失败 HTTP {status} {page}，稍后重试")
            time.sleep(10)
            continue

        for msg in page.get("messages", []):
            if msg["id"] <= last_seen:
                continue
            last_seen = msg["id"]

            # 防自激：跳过自己、其它 bot、以及系统消息
            if msg.get("sender_id") == bot_id or msg.get("sender_is_bot"):
                continue
            if msg.get("kind") != "text":
                continue

            text = (msg.get("content") or "").strip()
            mentioned = bot_id in (msg.get("mentions") or []) or -1 in (msg.get("mentions") or [])
            if text == "/ping":
                bot.send_message(conv_id, "pong", reply_to=msg["id"])
            elif mentioned and "天气" in text:
                bot.send_message(conv_id, "今天晴，21°C。", reply_to=msg["id"])

        time.sleep(3)


if __name__ == "__main__":
    main()
```

## 验证口径

本指南的结论来自逐行阅读服务端源码（接口签名、SQL、路由表、权限常量、迁移定义），而非全部经过真实联调。

**尚未在真实环境验证的部分**（接入时请以实际联调为准）：

- **WebSocket 端到端连通**：票据流程、`{"type":"connected"}` 问候帧、事件信封格式均来自源码，但没有在真实网关（尤其是带反向代理、TLS 的环境）上跑过一次完整往返；特别是代理对 WebSocket 升级与 30 秒票据窗口的影响。
- **封禁 bot 返回 `401`**：由“token 解析早于封禁检查”的代码顺序推出，未实测。
- **各类上限的具体表现**：发送缓冲 256 条导致的断连、限流实际吞吐，未压测。
- **`post.created` 广播范围**：`public`/`login` 帖子广播给所有已连接客户端的结论来自 `postRecipients` 返回 `nil` 的实现，未在多客户端环境观测。
- **附件的 multipart 细节**（字段名 `file`）来自 `c.Request.FormFile("file")`，未验证单请求大小上限与允许的 MIME 类型（后者由服务端存储配置决定）。

最小验证集：用两个真实账号 + 一个 bot 跑通「建 bot → 发帖 → 进群 → 收发消息 → 断线重连」，以及一次刻意触发的 `401`/`403`/`409`/`429`。