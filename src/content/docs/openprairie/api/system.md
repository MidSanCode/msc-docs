---
title: 系统接口
description: 能力探测、全站公告、通知收件箱、插件商店、健康检查与实时推送（WebSocket 票据）。
sidebar:
  order: 12
---

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/capabilities` | 公开 | 本服务端支持的可选特性 |
| GET | `/announcements` | 公开 | 生效中的全站公告（`?all=1` 含已下线） |
| POST | `/announcements` | `app.announcements.manage` | 发布公告 |
| PUT | `/announcements/:id` | `app.announcements.manage` | 下线公告 |
| GET | `/notifications` | 需认证 | 通知收件箱 |
| POST | `/notifications/read` | 需认证 | 标记已读 |
| GET | `/plugins` | 公开 | 插件列表 |
| GET | `/plugins/:id` | 公开 | 插件详情 |
| GET | `/plugins/:id/download` | 需认证 | 下载插件 |
| POST | `/plugins/admin/upload` | `plugin.manage` | 上传插件包 |
| PUT | `/plugins/admin/:id/publish` | `plugin.manage` | 上架 |
| PUT | `/plugins/admin/:id/unpublish` | `plugin.manage` | 下架 |
| DELETE | `/plugins/admin/:id` | `plugin.manage` | 删除 |
| GET | `/health` | 公开 | 聚合健康检查（网关自身应答） |
| POST | `/ws` | 需认证 | 换取一次性 WebSocket 票据 |
| GET | `/ws?ticket=` | `authTicket` | WebSocket 升级 |

## 能力探测

```http
GET /capabilities
```

无需认证，返回本服务端构建支持的可选特性，客户端据此做兼容矩阵与优雅降级：

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

新增可选能力时会在该表中登记；客户端**不要**假设能力一定存在。

## 全站公告

客户端启动时展示的运营通知。

```http
GET /announcements            # 生效中，最新在前
GET /announcements?all=1      # 含已下线的历史条目（管理视图）
POST /announcements           # 发布（app.announcements.manage）
PUT /announcements/:id        { "active": false }   # 下线但保留历史
```

客户端在本地记住已读公告 id，因此一条公告**每设备只展示一次**，直到有新公告发布。

## 通知收件箱

```http
GET  /notifications
POST /notifications/read
```

站内通知的读取与已读标记；实时投递走 WebSocket（见下）。

## 插件商店

插件服务是**可选组件**：网关路由表引用了它，`run.bat` 会启动它，但 `scripts/start.sh` 既不构建也不启动，因此在某些一键部署上这些路由没有后端（会得到 `503`）。

```http
GET  /plugins                     # 公开列表
GET  /plugins/:id                 # 公开详情
GET  /plugins/:id/download        # 需认证的下载
POST /plugins/admin/upload        # plugin.manage
PUT  /plugins/admin/:id/publish   # 上架
PUT  /plugins/admin/:id/unpublish # 下架
DELETE /plugins/admin/:id         # 删除
```

插件包存放于 `/app/data/plugins`（容器内，`OPENFIELD_PLUGIN_DIR`），如需重启后保留要挂载 `/app/data`。

## 健康检查

### 聚合端点

```http
GET /health
```

由网关自身应答，并发扇出到每个**已配置**后端的 `/healthz`，并测量延迟。全部健康返回 `200`，否则 `503`——**响应体永远可解析**：

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

未配置 URL 的服务报 `unknown` + `"not configured"`，不会拖垮整体。不需要认证，可安全轮询——但每次调用都会消耗一个 DB ping 加六次本机 HTTP GET，**建议间隔 ≥ 30 秒**。

### 各服务探针

```http
GET /healthz        # 内部端口，免认证
```

account、chat、posts、push、storage、plugin 均挂载：

```json
{ "status": "up", "details": { "database": "up" }, "checked_at": "2026-08-24T12:00:00Z" }
```

- `status`：`up` | `down` | `degraded`；
- `details.database`：对共享 PostgreSQL 连接池的 `PingContext`（3 秒超时；push 无连接池，报 `n/a`），ping 失败则整体 `down`；
- storage 额外有 `details.storage`：已配置且启用为 `up`，否则 `disabled` 并把整体降级为 `degraded`。

## 实时推送（WebSocket）

推送服务持有 WebSocket 连接并扇出聊天事件、正在输入与通知。它是**唯一**双向通道，其余流量都是普通 REST。

### 两步连接：先换票，再连

```http
POST /api/v1/ws          (带 Authorization: Bearer <凭据>)
  → 200 {"ticket":"<64 位十六进制>","expires_in":30}

GET  /api/v1/ws?ticket=<ticket>      (WebSocket 升级，ws:// 或 wss://)
```

| 规则 | 说明 |
| --- | --- |
| 票据 | **一次性**，用掉即失效 |
| 有效期 | **30 秒**，只够“取票 → 立刻连接” |
| 升级请求 | 网关侧为 `authTicket`：**先删除身份头再原样转发**，由 push 服务兑换票据 |

> **只带 token 的裸 `GET /api/v1/ws`（不带 `ticket`）会拿到 `401`**，即使 token 有效。必须走 `POST` 取票这一步。
>
> 这是设计意图：浏览器无法在 WebSocket 握手时自定义头，把长期 token 放进 URL 又会泄进日志，所以用一次性短票代替。**不要为了省事把 token 写进 query string。**

### 事件信封

连上后先收到问候帧：

```json
{ "type": "connected" }
```

之后每条消息同一信封：

```json
{
  "type": "chat.message.created",
  "recipients": [7, 4242],
  "data": { "id": 9001, "conversation_id": 33, "sender_id": 7, "kind": "text" }
}
```

`data` 即对应资源对象。`recipients` 为空数组表示**广播给所有已连接客户端**。

### 事件类型

| `type` | `data` | 受众 |
| --- | --- | --- |
| `chat.message.created` / `.updated` / `.deleted` | 消息对象 | 会话内 `active` 成员 |
| `chat.typing` | `{conversation_id, user_id}` | 会话成员 |
| `chat.conversation.updated` | `{conversation_id}` | 会话成员 |
| `chat.consent.requested` | `{user_id, encrypted, …}` | 被请求方 |
| `chat.e2ee.keys.updated` | 密钥信封元数据 | 会话成员 |
| `post.created` / `post.deleted` | 帖子对象 | 按可见性：`private` 仅作者，`friends` 互关 + 作者，`public`/`login` 广播 |
| `post.reply.created` / `.updated` / `.deleted` | 评论对象 | 帖子作者等相关方 |
| `call.*` | 通话载荷 | 见[通话](/openprairie/api/calls/#推送事件) |

### 连接维护

- 服务端每 **54 秒** ping，读超时 **60 秒**——必须及时回 pong（多数库自动处理），否则断连；
- 每连接发送缓冲 **256 条**，写不进（消费太慢）会**直接断开**，不做堆积；
- 事件是 PostgreSQL `NOTIFY` 转发的**尽力而为**投递，不是持久队列：服务重启、连接掉线期间的**事件不会补发**。

**结论**：实时事件用于低延迟触发；状态一致性靠定期 REST 对账（如 `GET /conversations/:id/call`）。

## 对象文件代理

```http
GET /api/v1/files/<bucket>/<key>
```

该路径在网关 `NoRoute` 中特判（对象 key 跨多段路径，`:param` 表达不了），**只解析 JWT**：

- 公开对象可直接取；
- 私有对象要求 owner 身份；
- **bot token 在此等价于匿名**，读不到私有对象。

详见[附件与存储](/openprairie/api/storage/)。