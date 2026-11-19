---
title: 认证与会话
description: OIDC 登录、密码登录、注册收尾、refresh token 轮换、多账号选择、扫码登录与设备会话管理。
sidebar:
  order: 2
---

OpenPrairie 使用 **OIDC**（OpenID Connect）作为主认证方式，另为管理员创建的本地账号提供密码登录。**不允许自助注册**：新的 OAuth 用户以 `needs_registration = true` 创建，必须先调用 `POST /auth/register` 取一个唯一用户名和昵称才能使用。

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/auth/providers` | 公开 | 可用的登录方式 |
| GET | `/auth/oidc/login` | 公开 | 取 OIDC 授权地址 |
| GET/POST | `/auth/oidc/callback` | 公开 | 授权码回调，换取 token |
| GET | `/auth/oidc/pick` | 公开 | 多账号：列出该身份绑定的账号 |
| POST | `/auth/oidc/pick/select` | 公开 | 多账号：选定账号登录 |
| POST | `/auth/oidc/pick/create` | 公开 | 多账号：新建账号并登录 |
| POST | `/auth/oidc/bind` | 需认证 | 把刚授权的身份绑定到当前账号 |
| POST | `/auth/login` | 公开 | 密码登录 |
| POST | `/auth/register` | 需认证 | 完成注册（取用户名/昵称） |
| POST | `/auth/refresh` | 公开 | 刷新 token（轮换） |
| POST | `/auth/qr` | 公开 | 扫码登录：创建握手 |
| GET | `/auth/qr/:code` | 公开 | 扫码登录：轮询状态 |
| POST | `/auth/qr/:code/approve` | 需认证 | 扫码登录：已登录设备批准 |
| GET | `/auth/sessions` | 需认证 | 我的登录设备列表 |
| DELETE | `/auth/sessions/:id` | 需认证 | 撤销某个设备会话 |

## 登录方式

### 获取可用方式

```http
GET /auth/providers
```

```json
{ "providers": ["oidc", "password"] }
```

### 密码登录（管理员创建的本地账号）

```http
POST /auth/login
{ "username": "alice", "password": "secret" }
```

### OIDC 登录流程

1. 取授权地址：

```http
GET /auth/oidc/login
```

```json
{ "auth_url": "https://auth.yun/oidc/auth?...", "provider": "oidc" }
```

浏览器内发起的登录请带 `?flow=web`，这样第 3 步会跳回 Web 应用而不是触发 `openfield://` 深链（浏览器会静默拒绝自定义协议）。

2. 把用户重定向到 `auth_url`。
3. 授权后提供商带授权码回调。
4. 服务端用授权码换 token：

```http
GET /auth/oidc/callback?code=...
```

配置了 `oidc.app_redirect_url`（如 `openfield://oauth/callback`）时，返回 `302` 到该深链并携带 token：

```
openfield://oauth/callback?access_token=eyJ...&username=openfield&email=...&avatar_url=...
```

否则返回 JSON：

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": { "id": 1, "username": "openfield", "email": "...", "avatar_url": "..." }
}
```

#### 浏览器（Web）回调

以 `flow=web` 发起、且配置了 `oidc.web_redirect_url` 时，回调不会走 JSON 分支，而是 `302` 到该地址并把同样的 token 载荷放在查询串里：

```
302 Location: https://app.example.com/oauth/callback
  ?access_token=eyJ...&refresh_token=...&expires_in=86400
  &refresh_expires_in=2592000&username=openfield&needs_registration=false
```

三点接入要求：

- token 出现在查询串里，**拿到后立刻从 URL 与浏览历史中清掉**，生产必须走 HTTPS；
- `web_redirect_url` 由**提供商重定向到的那个网关实例**读取，要配在那一台上；
- Web 应用所在主机需要把未知路径重写到 `index.html`（history 模式），跨主机时其来源还要在 `server.allowed_origins` 中放行。

## 多账号登录（一个 OAuth 身份 → 多个账号）

一个 OIDC 身份最多绑定 **5** 个账号（`auth.MaxOAuth2Accounts`）。当身份已绑定至少一个账号时，回调**不会自动登录**，而是签发一张短期一次性 **pick 票据**（TTL 10 分钟），携带 `?pick=<ticket>` 重定向。票据本身就是凭据，因此三个 pick 端点都是 `authPublic`。

### 列出绑定账号

```http
GET /auth/oidc/pick?ticket=<ticket>
```

**不消费**票据，可重复查询：

```json
{
  "provider": "oidc",
  "oauth2_username": "alice",
  "email": "alice@example.com",
  "max_accounts": 5,
  "accounts": [{ "id": 1, "username": "openfield", "nickname": "Alice" }]
}
```

票据未知或过期返回 `404`。

### 选定账号登录

```http
POST /auth/oidc/pick/select
{ "ticket": "...", "user_id": 1 }
```

消费票据，校验账号确属该身份，返回与普通登录相同的 token 载荷。账号不属于该身份、被封禁或待删除返回 `403`。

### 新建账号登录

```http
POST /auth/oidc/pick/create
{ "ticket": "..." }
```

消费票据，服务端强制配额（已达 `max_accounts` 时 `409 {"error":"account quota reached"}`），新建一个 `needs_registration = true` 并绑定该身份的账号，返回登录 token。

### 绑定身份

```http
POST /auth/oidc/bind
```

把刚授权的身份绑定到当前已登录账号：

| 情况 | 结果 |
| --- | --- |
| 账号已绑定同一身份 | 幂等成功 |
| 账号已绑定另一个身份 | 失败（`taken`） |
| 该身份已达 5 个账号 | 失败（`quota`） |

## Refresh Token 轮换

### 刷新

```http
POST /auth/refresh
{ "refresh_token": "..." }
```

```json
{
  "access_token": "jwt",
  "refresh_token": "rotated",
  "expires_in": 86400,
  "refresh_expires_in": 2592000,
  "user": { }
}
```

- access token 有效期 `jwt.expiry_hours`（默认 **24 小时**）；
- refresh token 为 256 位随机不透明串，存于服务端 `refresh_tokens` 表，默认 **30 天**；
- **每次刷新都轮换**：旧 refresh token 立即作废（单事务内删旧插新），重放旧 token 会 `401`；
- 缺失/已撤销/过期/未知一律 `401`。

客户端建议：以 `expires_in` 算出到期时间，剩不到 5 分钟时主动刷新；刷新失败即清空本地凭据回到登录页。

## 扫码登录

已登录设备批准陌生设备的登录请求，握手窗口 **5 分钟**：

| 步骤 | 调用 | 方 |
| --- | --- | --- |
| 1 | `POST /auth/qr` → 得到 `code` | 待登录设备（匿名） |
| 2 | `GET /auth/qr/:code` 轮询，直到返回 `confirmed` 与 token | 待登录设备 |
| 3 | `POST /auth/qr/:code/approve` | 已登录设备 |

已登录设备**永不**展示登录二维码。

## 设备会话管理

```http
GET /auth/sessions                 # 我的登录设备
DELETE /auth/sessions/:id          # 撤销某个设备
```

撤销会连带使该会话的 refresh token 失效。

## 常见错误

| 状态 | 场景 |
| --- | --- |
| `401` | refresh token 无效/过期/已轮换；`needs_registration` 未完成时访问受限接口 |
| `403` | 多账号 pick 中账号不属于该身份、被封禁或待删除 |
| `404` | pick 票据未知或过期 |
| `409` | `account quota reached`（多账号超过 5 个） |