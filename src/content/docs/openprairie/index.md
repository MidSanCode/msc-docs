---
title: OpenPrairie 服务端
description: OpenPrairie（服务端代号 OpenField）微服务后端文档：服务构成、端口、鉴权级别与文档导航。
sidebar:
  order: 1
---

OpenPrairie 服务端是一个 Go 微服务后端：一个 API 网关在前，六个内部服务在后，另有一个 Flask 管理面板。客户端只与网关通信。

> **命名说明**：仓库名为 `OpenPrairie-server`，但代码、数据库（`openfield`）、镜像名（`openfield-*`）与深链协议（`openfield://`）沿用旧名 **OpenField**。本文档在提到服务端本身时两者通用，接口路径一律是 `/api/v1/...`。

## 架构总览

```
                  ┌────────────────────┐
 客户端 ─────────►│  Gateway  (:8080)  │  ← 唯一对外入口
                  │  鉴权 + 路由        │
                  └─────────┬──────────┘
                            │ 反向代理
      ┌──────────┬──────────┼──────────┬───────────┐
      ▼          ▼          ▼          ▼           ▼
   Account    Storage      Chat      Posts        Push
    :8081      :8082      :8083      :8084       :8085
    JWT/       附件/      会话/      帖子/       WS 票据
    档案/      配额       消息/E2EE  评论/营地    + 推送中心
    bot

  Plugin :8086（可选，scripts/start.sh 不会启动它）
  Flask 管理面板 :5001（用户、用户组、权限、举报）
  RustFS :9000（S3 兼容对象存储）
```

| 组件 | 端口 | 说明 |
| --- | --- | --- |
| Gateway | 8080 | 唯一对外可达端口 |
| Account | 8081 | 认证、档案、钱包、任务、会员、bot、举报 |
| Storage | 8082 | 附件上传/下载/删除、配额、预览图 |
| Chat | 8083 | 会话、消息、群管理、E2EE 密钥、通话信令 |
| Posts | 8084 | 帖子、评论、营地 |
| Push | 8085 | WebSocket 票据与推送中心 |
| Plugin | 8086 | 插件商店（可选） |
| Flask 管理面板 | 5001 | 运营控制台 |

内部服务一律绑定 `127.0.0.1`，信任网关注入的 `X-User-ID`，**不得**直接对外暴露。

## 请求流与鉴权级别

网关对每条路由声明一个鉴权级别（见 [API 总览](/openprairie/api/)）：

| 级别 | 含义 |
| --- | --- |
| `authPublic` | 公开；带上有效 token 时仍解析身份以个性化返回（如 `is_following`、`my_role`） |
| `authRequired` | 必须认证，不校验具体权限键 |
| `authPermission` | 必须认证 + 持有指定权限键，否则 `403`（不转发到后端） |
| `authTicket` | 仅 WebSocket 升级路径：网关删除任何客户端身份头，凭一次性票据鉴权 |

两种凭据：用户的 **JWT**（`Authorization: Bearer <jwt>`）与 bot 的静态 **`ofb_` token**。网关按前缀分流，两者在 `authPublic` / `authRequired` / `authPermission` 路由上同样有效。

两条路径不走路由表：

- `GET /api/v1/health` —— 由网关自身提供，聚合各后端 `/healthz`；
- `GET /api/v1/files/...` —— 对象 key 跨多段路径，在网关 `NoRoute` 中特判，**只解析 JWT**（bot token 在此等价于匿名）。

## 服务构成

| 服务 | 负责 |
| --- | --- |
| **Gateway** | 唯一路由表、全部鉴权与权限判定、聚合健康检查、对象存储代理、按 IP 限流、封禁检查、安全响应头/HSTS、Host 白名单、CORS |
| **Account** | JWT 签发与刷新、密码登录、OIDC、扫码登录、档案与头像、用户搜索、权限自查、钱包与转账、支付 PIN、红包（checks）、任务与经验、会员、名称样式、关注、**bot**、**举报**、App 公告、存储桶分配 |
| **Posts** | 帖子/评论 CRUD、点赞、收藏、浏览、置顶、打赏（tips）、**营地（camps）与私有子群** |
| **Storage** | 附件上传（含分块）、列表、删除、用量、预览图（1440px + 512px 缩略图）、`/api/v1/files/` 代理与可见性判定 |
| **Chat** | 同意制会话（私聊请求/群邀请）、群成员与角色、备注、群昵称、已读、消息（引用、编辑、软删除、@、转发）、E2EE 群密钥信封、群公告/待办/文件、**P2P 通话状态机与信令中继** |
| **Push** | 签发一次性 WebSocket 票据、持有连接中心、把事件扇出给在线客户端（尽力而为，无重放） |
| **Plugin** | 插件注册表与下载（可选，路由在网关表中但默认栈不启动） |

## 权限模型

权限键按域点分命名，由**用户组**授予；`admin` 角色拥有全部权限。新建账号（含 bot）加入默认组「所有人」，其权限 = **全部键 − 7 个管理键**：

```
account.verify            user.adjust_exp        user.membership.grant
user.punish               wallet.manage          plugin.manage
app.announcements.manage
```

| 域 | 权限键 |
| --- | --- |
| account | `account.view`、`account.profile.edit`、`account.avatar.edit`、`account.banner.edit`、`account.verify`¹、`account.follow` |
| user | `user.adjust_exp`¹、`user.membership.grant`¹、`user.punish`¹ |
| storage | `storage.upload`、`storage.list`、`storage.get`、`storage.delete` |
| posts | `posts.view`、`posts.create`、`posts.edit`、`posts.delete`、`posts.reply.create`、`posts.reply.edit`、`posts.reply.delete`、`posts.react`、`posts.favorite` |
| chat | `chat.view`、`chat.send`、`chat.call`、`chat.edit`、`chat.delete`、`chat.request.send`、`chat.request.approve`、`chat.group.create`、`chat.group.invite`、`chat.group.manage`、`chat.group.nickname`、`chat.note.edit` |
| wallet | `wallet.view`、`wallet.manage`¹ |
| plugin | `plugin.manage`¹ |
| app | `app.announcements.manage`¹ |

¹ 管理键：永不下发给默认组，授予者对他人账号或全站状态有处置权。

权限只在网关校验一次；`GET /api/v1/users/me/permissions` 不需要任何权限即可调用（便于注册收尾与自查）。

## 部署与运行要点

- **配置**：YAML（默认 `config/config.local.yaml`，可由 `OPENFIELD_CONFIG` 覆盖），环境变量可覆盖部分键；`JWT_SECRET_KEY` 必须 ≥32 字符且不是已知默认值，否则服务拒绝启动。
- **数据库**：PostgreSQL，启动时按版本化迁移自动升级（配置文件/`DATABASE_AUTO_MIGRATE` 可关）。
- **Redis**：当前预留未用（配置项存在，但无服务调用）。
- **每服务独立构建**：仓库根 `Dockerfile` + `SERVICE` 构建参数；镜像以非 root（uid 10001）运行，读取 `/etc/openfield/config.yaml`。
- **限流**：网关按**真实 TCP 对端 IP** 令牌桶，默认 120 请求/分钟、突发 240；超限先短暂等待令牌，持续灌流量才 `429`。它不分 bot 与普通用户，也不按 token 计数。
- **后端不可达**：代理返回 `503 {"error":"service temporarily unavailable"}`，与「路由不存在」的 `404` 明确区分。

## 文档导航

- **[API 调用](/openprairie/api/)** —— 认证、用户、钱包、帖子、营地、聊天、通话、存储、任务会员、审核、系统接口
- **[Bot 开发指南](/openprairie/bots/)** —— 创建与认证、能力清单、实时事件、实战与限制

上游文档位于仓库 `docs/` 目录（`API.md`、`bots.md`、`architecture.md` 等），本站是对其整理后的中文版，并逐条核对了网关路由表。