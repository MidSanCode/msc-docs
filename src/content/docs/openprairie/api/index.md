---
title: API 总览
description: OpenPrairie REST API 的基址、认证方式、鉴权级别、响应信封、分页风格、限流与错误约定。
sidebar:
  order: 1
---

所有接口经**网关**暴露，基址为：

```
http://localhost:8080/api/v1          # 本地默认
https://<你的域名>/api/v1              # 线上
```

网关先校验凭据（用户 JWT，或 bot 的静态 `ofb_` token），再按路由表校验权限，最后转发给内部服务。

两条路径例外：`GET /api/v1/health` 由网关自身应答；`GET /api/v1/files/...` 在网关 `NoRoute` 中特判（只解析 JWT）。

## 认证

| 方式 | 请求头 | 说明 |
| --- | --- | --- |
| 用户 JWT | `Authorization: Bearer <jwt>` | 登录后获得，默认 24 小时 |
| Bot 静态 token | `Authorization: Bearer ofb_<64位十六进制>` | 无过期，重置即失效（见 [Bot 开发指南](/openprairie/bots/)） |

失败响应：

| 情况 | 响应 |
| --- | --- |
| 未带 `Authorization` | `401 {"error":"missing authorization token"}` |
| JWT 无效/过期 | `401` |
| bot token 失效、被重置、bot 被封禁 | `401 {"error":"invalid bot token"}` |
| 缺权限 | `403 {"error":"permission denied","permission":"<键>"}` |
| 账号被封禁（JWT） | `403 {"error":"account is banned","banned":true}` |

> 封禁的 **bot** 在 token 解析阶段就被拒，返回 `401` 而非 `403`。客户端统一按 401 处理“凭据失效”。

## 鉴权级别

| 级别 | 含义 |
| --- | --- |
| `authPublic` | 公开。带有效 token 时仍会解析身份，用于返回个性化字段（`is_following`、`my_role`、自身点赞/收藏状态） |
| `authRequired` | 必须认证，不检查具体权限键 |
| `authPermission` | 必须认证 + 持有该路由的权限键 |
| `authTicket` | 仅 `GET /ws`：网关删除客户端身份头，凭一次性票据兑换 |

## 通用约定

### 请求体

除文件上传外，`POST`/`PUT` 一律 `Content-Type: application/json`。上传为 `multipart/form-data`。

### 响应信封

| 接口类型 | 成功形态 |
| --- | --- |
| 单对象创建（发帖、评论、消息） | `201` + **对象本身** |
| 列表 | `200 {"<复数名>":[…], "page":1}` 或 `{"messages":[…]}` |
| 删除、标记已读 | `204 No Content` |
| 错误 | `{"error":"…"}`，部分附带附加字段（如 `permission`、`banned`、`limit`） |

### 分页：两种风格，别混用

**页码分页**（帖子、评论、用户帖子）：

```http
GET /posts?page=1&limit=20
GET /posts?q=关键词&author=alice&tag=news&author_id=7&from=2026-01-01&to=2026-02-01
```

响应里的 `page` 是当前页；**没有 `total`、没有 `has_more`**——请求到空数组即为末尾。

**游标分页**（消息，只能往前翻）：

```http
GET /conversations/:id/messages?limit=50&before=12345
```

- `limit` 默认 50，合法区间 1..100，越界会被重置为 50；
- `before=<消息 id>` 取**更旧**的消息；不传取最新一页；
- 返回**时间正序（旧 → 新）**，最新一条在 `messages[-1]`；
- **没有 `after`**：取新消息只能轮询最新页按 id 去重，或改用 WebSocket。

### 时间与金额

- 时间戳为 RFC3339（`2026-10-10T15:20:12Z`）；`info` 类字段偶用 Unix 秒。
- **金额一律整数分**（cents，`BIGINT`），客户端自行 `/100` 展示。红包与打赏接口的 `amount` 以“币”为单位（`10.5`），注意区分。

### 限流

| 限制 | 值 | 作用域 |
| --- | --- | --- |
| 网关令牌桶 | 120 请求/分钟，突发 240 | 按**真实 TCP 对端 IP**；超限先等待令牌，持续超限才 `429` |
| 举报 | 20 条/小时 | 按用户 |
| 登录 / 支付 PIN 试错 | 内部预算（`pkg/ratelimit`） | 按用户，仅统计错误次数 |

网关限流不区分 bot 与普通用户，也不按 token 计数——同一出口 IP 后所有请求共用一个桶。

## 接口分组

| 分组 | 文档 |
| --- | --- |
| 认证与会话（OIDC、密码、刷新、多账号、扫码） | [认证与会话](/openprairie/api/auth/) |
| 用户与档案（资料、头像、关注、隐私、名称样式、存储桶、注销） | [用户与档案](/openprairie/api/users/) |
| 钱包、转账、支付 PIN、红包 | [钱包与支付](/openprairie/api/wallet/) |
| 帖子、评论、互动、打赏、营地 | [帖子与营地](/openprairie/api/posts/) |
| 会话、消息、群管理、E2EE、搜索 | [聊天](/openprairie/api/chat/) |
| 语音/视频通话 | [通话](/openprairie/api/calls/) |
| 附件与对象存储 | [附件与存储](/openprairie/api/storage/) |
| 任务、经验等级、会员 | [任务与会员](/openprairie/api/tasks/) |
| 举报与处罚 | [审核与处罚](/openprairie/api/moderation/) |
| 公告、插件、能力探测、健康检查、实时推送 | [系统接口](/openprairie/api/system/) |

## 客户端接入的几点注意

- **公开路由也会个性化**：`GET /posts`、`GET /camps`、`GET /users/:id` 等在带上有效 token 时返回结果会不同（自身点赞状态、`my_role`、`is_following`）。不带 token 只能拿到公共视图。
- **未匹配路由返回 `404`，后端故障返回 `503`**——两者可区分，便于定位是客户端路径写错还是服务挂了。
- **浏览器跨域**：需要网关的 `server.allowed_origins` 放行；`localhost`/`127.0.0.1` 来源默认总是允许。
- **Host 白名单**：配置 `server.allowed_hosts` 后，`Host` 不匹配的请求会被直接拒绝。

## 已知文档差异

上游 `docs/punishments.md` 提到 `POST /auth/logout` 在封禁状态下仍可达，但**网关路由表中没有注册 `/auth/logout`**。当前会话失效请使用 `DELETE /auth/sessions/:id`（见[认证与会话](/openprairie/api/auth/)）。