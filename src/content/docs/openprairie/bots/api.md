---
title: 管理接口与能力清单
description: bot 的创建/列表/重置/删除接口，权限模型与默认组边界，以及 bot 可调用接口的完整表（含鉴权级别）。
sidebar:
  order: 2
---

## 管理接口

这 4 个接口都是**用人类账号的凭据**调用的（管理自己的 bot），全部需要认证。

### 创建

```http
POST /api/v1/bots
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `username` | ✅ | `^[a-zA-Z0-9_]{3,32}$` —— 3~32 位字母、数字、下划线 |
| `nickname` | ✅ | 去首尾空白后 1~100 字符 |

响应 `201`：`{"user": {…}, "token": "ofb_…"}`。**token 只出现这一次。**

| 状态 | 条件 |
| --- | --- |
| `400` | username 不合规 / nickname 为空或超长 |
| `401` | 未认证 |
| `403` | 调用者本身是 bot：`bot accounts cannot create bots` |
| `403` | 已达数量上限：`bot limit reached`（`limit: 10`） |
| `409` | `username already taken` |
| `500` | 服务端错误 |

### 列表

```http
GET /api/v1/bots
```

```json
{
  "bots": [
    {
      "id": 4242,
      "username": "weather_watcher",
      "nickname": "天气预报",
      "avatar_url": "",
      "created_at": "2026-10-10T15:20:12Z",
      "token_created_at": "2026-10-10T15:20:12Z"
    }
  ],
  "limit": 10
}
```

`token_created_at` 用于判断“这个 token 有多旧”（重置后等于重置时间；无 token 记录时回退为 bot 创建时间）。

### 重置 token

```http
POST /api/v1/bots/:id/regenerate
```

`200 {"token":"ofb_…新 token…"}`。旧 token **立即失效**（单行 UPDATE 原子替换）——这也是 token 泄露后唯一的补救手段。

| 状态 | 条件 |
| --- | --- |
| `400` | `:id` 不是正整数 |
| `404` | bot 不存在 |
| `403` | `not your bot`——bot 存在但不是你的 |

### 删除

```http
DELETE /api/v1/bots/:id
```

`200 {"ok": true}`。

:::danger[不可逆]
bot 的 user 行被删掉，级联删除它的帖子、回复、消息、附件、会话成员关系和营地成员关系（`posts.user_id`、`post_replies.user_id`、`messages.sender_id`、`attachments.user_id`、`conversation_members.user_id` 均为 `ON DELETE CASCADE`）。
:::

错误同上（`400`/`404`/`403`）。

## 权限模型

网关对每个路由声明鉴权级别：

| 级别 | 含义 |
| --- | --- |
| `authPublic` | 公开；带 token 时仍解析身份以个性化返回 |
| `authRequired` | 必须认证，不检查具体权限项 |
| `authPermission` | 必须认证 + 持有指定权限键，否则 `403` |

新建 bot 加入内置默认组「所有人」，其权限 = **全部权限键 减去 7 个管理类键**。

**bot 默认拿不到的管理权限**（永不下发给默认组）：

```
account.verify            用户认证（加V）
user.adjust_exp           修改他人经验
user.membership.grant     授予他人会员
user.punish               处罚/封禁他人
wallet.manage             调整他人钱包
plugin.manage             插件商店管理
app.announcements.manage  全站公告管理
```

因此 bot **可以**（取决于具体接口）：发帖/改删自己的帖、发/改删自己的消息、点赞、收藏、关注、上传附件、建群、加群、发会话请求、加入营地、在营地发帖、举报内容。

**不能**：封禁别人、改他人钱包/经验/会员、认证他人、发全站公告。

### 自查当前权限

```bash
curl -s "$BASE/api/v1/users/me/permissions" -H "Authorization: Bearer $BOT_TOKEN"
```

运营方若把 bot 移出默认组或加入自定义组，这个接口的返回会跟着变——**启动时检查一次比假设更可靠**。

另有公开接口 `GET /api/v1/capabilities`（无需认证），列出本服务端构建支持的可选特性（如 `chat.e2ee`、`camps.subgroups`、`moderation.reports`），可用于探测服务端版本能力。

## 能力清单

下表「鉴权」列取自网关路由表，是**权威值**。`authPublic` 表示无需 token 也能调用（带 token 会返回个性化字段）。

### 账号

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/users/me` | 需认证 | 自己的档案（含 `is_bot`） |
| PUT | `/users/me` | `account.profile.edit` | 改昵称、简介等 |
| GET | `/users/me/permissions` | 需认证 | 自己的权限键列表 |
| POST | `/users/me/avatar` | `account.avatar.edit` | 上传头像 |
| GET | `/users/search` | 需认证 | 搜索用户 |
| GET | `/users/:user_id` | 公开 | 看别人的档案 |
| POST/DELETE | `/users/:user_id/follow` | `account.follow` | 关注 / 取关 |

### 帖子

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/posts` | `posts.create` | 发帖 |
| GET | `/posts` | 公开 | 时间线，`page`/`limit` 分页 |
| GET | `/posts/:id` | 公开 | 单帖（会记录浏览） |
| PUT | `/posts/:id` | `posts.edit` | 改自己的帖 |
| DELETE | `/posts/:id` | `posts.delete` | 删自己的帖 |
| GET | `/posts/:id/replies` | 公开 | 评论列表 |
| POST | `/posts/:id/replies` | `posts.reply.create` | 发评论 |
| PUT | `/posts/:id/replies/:reply_id` | `posts.reply.edit` | 改自己的评论 |
| DELETE | `/posts/:id/replies/:reply_id` | `posts.reply.delete` | 删自己的评论 |
| PUT/DELETE | `/posts/:id/reactions` | `posts.react` | 点赞 / 取消 |
| POST/DELETE | `/posts/:id/favorite` | `posts.favorite` | 收藏 / 取消 |
| POST | `/posts/:id/tips` | 需认证 | 打赏（需支付 PIN） |
| GET | `/users/:user_id/posts` | 公开 | 某人的帖子 |

### 聊天

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/conversations` | `chat.view` | 自己的会话列表 |
| POST | `/conversations` | `chat.group.create` | 建群 |
| POST | `/conversations/start` | `chat.request.send` | 发起私聊（同意制） |
| GET | `/conversations/public` | `chat.view` | 公开群列表 |
| GET | `/conversations/:id` | `chat.view` | 会话详情 |
| GET | `/conversations/:id/messages` | `chat.view` | 消息列表 |
| GET | `/conversations/:id/messages/search` | `chat.view` | 历史搜索 |
| POST | `/conversations/:id/messages` | `chat.send` | 发消息 |
| POST | `/conversations/:id/messages/forward` | `chat.send` | 转发消息 |
| PUT/DELETE | `/conversations/:id/messages/:message_id` | `chat.edit` / `chat.delete` | 改 / 删自己的消息 |
| POST | `/conversations/:id/read` | `chat.view` | 标记已读 |
| POST | `/conversations/:id/typing` | `chat.view` | 正在输入 |
| POST | `/conversations/:id/join` | `chat.group.manage` | 加入公开群 |
| POST | `/conversations/:id/invite` | `chat.group.invite` | 邀请成员 |
| POST | `/conversations/:id/leave` | `chat.group.manage` | 退群 |
| GET | `/conversations/:id/files` | `chat.view` | 会话内已分享文件（**读私有附件的正路**） |
| GET | `/conversations/:id/todos` 等 | `chat.view` | 群待办（读写） |

### 营地

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/camps` | 公开 | 营地目录（不含隐藏营地） |
| POST | `/camps` | 需认证 | 建营地（受创建配额限制，仅顶级营地） |
| GET | `/camps/:id` | 公开 | 营地详情（隐藏营地非成员 404） |
| PUT/DELETE | `/camps/:id` | 需认证 | 改 / 删（需 owner/admin；删除仅 owner） |
| GET | `/camps/:id/posts` | 公开 | 营地帖子（成员可见） |
| POST | `/camps/:id/join` | 需认证 | 加入 |
| DELETE | `/camps/:id/members/me` | 需认证 | 退出 |
| GET | `/camps/:id/members` | 需认证 | 成员名单（仅成员） |
| GET | `/camps/:id/subgroups` | 公开 | 子群列表（处理层只允许父营地成员） |
| POST | `/camps/:id/subgroups` | 需认证 | 建子群（需父营地 owner/admin） |

:::note
往营地里发帖：`POST /posts` 带 `camp_id`。**必须先加入该营地**，否则 `403 {"error":"join the camp before posting into it"}`；营地关闭「成员可发帖」时只有 owner/admin 能发。
:::

### 存储

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/attachments` | `storage.upload` | 上传（**multipart/form-data，字段名 `file`**） |
| GET | `/attachments` | `storage.list` | 附件列表 |
| GET | `/attachments/:id` | 公开 | 单个附件 |
| GET | `/attachments/by-hash/:hash` | 需认证 | 按内容哈希复用 |
| DELETE | `/attachments/:id` | `storage.delete` | 删除 |
| POST | `/attachments/chunk/init` 等 | `storage.upload` | 分块上传 |

上传拿到 `attachment.id` 后，放进帖子的 `attachment_ids` 或消息的 `attachment_ids`。

### 其它

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/reports` | 需认证 | 举报帖子 / 消息 / 用户 |
| GET | `/reports/mine` | 需认证 | 自己提交过的举报及结果 |
| GET | `/notifications` | 需认证 | 通知收件箱 |
| POST | `/notifications/read` | 需认证 | 标记已读 |
| POST/GET | `/ws` | 见[实时事件](/openprairie/bots/events/) | 实时事件 |

**举报**：

```json
{ "target_type": "post", "target_id": 123, "reason": "垃圾广告" }
```

- `target_type` ∈ `post` | `message` | `user`（其它值 `400`）；
- `reason` 必填、去空白后 ≤500 字符；
- 不能举报自己（`user` 类型自己举报自己 → `400`）；
- 目标不存在 → `404`；同一目标重复举报 → `409`；
- 频率上限 **20 条/小时**，超出 `429`。

## 请求与响应约定

### 发帖字段

`POST /posts`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | string | ≤5000 字符；`content` 与 `quoted_post_id` 至少一个 |
| `visibility` | string | `public` \| `login` \| `friends` \| `private`，默认 `public` |
| `attachment_ids` | []int64 | 最多 9 个 |
| `check_id` | int64 | 关联红包 |
| `tags` | []string | 标签 |
| `quoted_post_id` | int64 | 引用/转发 |
| `camp_id` | int64 | 发到营地；`0` 表示全局 |

### 发消息字段

`POST /conversations/:id/messages`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | string | ≤5000；`content` / `attachment_ids` / `check_id` 至少一个 |
| `reply_to_id` | int64? | 引用某条消息 |
| `attachment_ids` | []int64 | 最多 9 个 |
| `mentions` | []int64 | @ 的用户 id；`-1` 表示 @everyone |
| `check_id` | int64 | 红包消息 |
| `burn_seconds` | int | 阅后即焚：`0` 或 `5..86400` |

### 响应信封

| 接口 | 成功响应 |
| --- | --- |
| `POST /posts`、`POST …/replies`、`POST …/messages` | `201` + **对象本身** |
| `GET /posts` | `200 {"posts":[…],"page":1}` |
| `GET /conversations/:id/messages` | `200 {"messages":[…]}` |
| 错误 | `{"error":"…"}`，部分带附加字段 |

### 分页（两种风格不同）

**帖子类：页码分页**

```http
GET /posts?page=1&limit=20
GET /posts?q=关键词&author=alice&tag=news&author_id=7&from=2026-01-01&to=2026-02-01
```

没有 `total`、没有 `has_more`——请求到空数组即为末尾。

**消息：游标分页，只能往前翻**

```http
GET /conversations/:id/messages?limit=50&before=12345
```

- `limit` 默认 50，不在 1..100 之间会被重置为 50；
- `before` 取更旧的消息；返回数组是**时间正序**，最新一条用 `messages[-1]`；
- **没有 `after`**：取新消息只能轮询最新页 + 按 id 去重，或改用 WebSocket。

### 消息对象里要留意的字段

| 字段 | 说明 |
| --- | --- |
| `sender_id` | 发送者 id；**用它判断“是不是我自己”**，避免自动回复死循环 |
| `sender_is_bot` | 发送者是否 bot——建议忽略其它 bot 的消息，否则两个 bot 会互刷 |
| `kind` | `text` \| `check` \| `call` \| `system.join` \| …，**系统消息不要当用户输入** |
| `mentions` | 被 @ 的用户 id 列表，`-1` 表示 @everyone |
| `deleted_at` | 软删除时间；列表接口已过滤 |
| `burn_seconds` / `burn_at` | 阅后即焚倒计时 |