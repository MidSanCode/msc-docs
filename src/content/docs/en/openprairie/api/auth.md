---
title: Authentication and Sessions
description: OIDC login, password login, registration completion, refresh-token rotation, multi-account selection, QR-code login, and device-session management.
sidebar:
  order: 2
---

OpenPrairie uses **OIDC** (OpenID Connect) as its primary authentication method and also provides password login for local accounts created by administrators. **Self-service registration is not allowed**: new OAuth users are created with `needs_registration = true` and must first call `POST /auth/register` to choose a unique username and nickname before they can use the account.

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/auth/providers` | Public | Available login methods |
| GET | `/auth/oidc/login` | Public | Get the OIDC authorization URL |
| GET/POST | `/auth/oidc/callback` | Public | Authorization-code callback; exchange the code for a token |
| GET | `/auth/oidc/pick` | Public | Multiple accounts: list accounts linked to this identity |
| POST | `/auth/oidc/pick/select` | Public | Multiple accounts: select an account to log in |
| POST | `/auth/oidc/pick/create` | Public | Multiple accounts: create an account and log in |
| POST | `/auth/oidc/bind` | Auth required | Link the just-authorized identity to the current account |
| POST | `/auth/login` | Public | Password login |
| POST | `/auth/register` | Auth required | Complete registration (choose username/nickname) |
| POST | `/auth/refresh` | Public | Refresh token (rotation) |
| POST | `/auth/qr` | Public | QR-code login: create handshake |
| GET | `/auth/qr/:code` | Public | QR-code login: poll status |
| POST | `/auth/qr/:code/approve` | Auth required | Approve from an already logged-in device |
| GET | `/auth/sessions` | Auth required | List my logged-in devices |
| DELETE | `/auth/sessions/:id` | Auth required | Revoke a device session |

## Login methods

### Get available methods

```http
GET /auth/providers
```

```json
{ "providers": ["oidc", "password"] }
```

### Password login (local accounts created by an administrator)

```http
POST /auth/login
{ "username": "alice", "password": "secret" }
```

### OIDC login flow

1. Get the authorization URL:

```http
GET /auth/oidc/login
```

```json
{ "auth_url": "https://auth.yun/oidc/auth?...", "provider": "oidc" }
```

For login initiated in a browser, include `?flow=web`. In step 3, this redirects back to the web app instead of invoking the `openfield://` deep link (browsers silently reject custom schemes).

2. Redirect the user to `auth_url`.
3. The provider returns to the callback with an authorization code.
4. The server exchanges the code for a token:

```http
GET /auth/oidc/callback?code=...
```

When `oidc.app_redirect_url` is configured (for example, `openfield://oauth/callback`), the response is a `302` redirect to that deep link with the token:

```
openfield://oauth/callback?access_token=eyJ...&username=openfield&email=...&avatar_url=...
```

Otherwise, the response is JSON:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": { "id": 1, "username": "openfield", "email": "...", "avatar_url": "..." }
}
```

#### Browser (web) callback

If login was initiated with `flow=web` and `oidc.web_redirect_url` is configured, the callback does not return JSON. Instead, it redirects (`302`) to that URL and places the same token payload in the query string:

```
302 Location: https://app.example.com/oauth/callback
  ?access_token=eyJ...&refresh_token=...&expires_in=86400
  &refresh_expires_in=2592000&username=openfield&needs_registration=false
```

Three integration requirements:

- The token appears in the query string. **Remove it from the URL and browser history immediately after receiving it**; production must use HTTPS.
- `web_redirect_url` is read by the **gateway instance that the provider redirects to**, so configure it on that instance.
- The host serving the web app must rewrite unknown paths to `index.html` (history mode). For cross-host deployments, allow its origin in `server.allowed_origins` as well.

## Multiple-account login (one OAuth identity → multiple accounts)

An OIDC identity can be linked to at most **5** accounts (`auth.MaxOAuth2Accounts`). Once an identity is linked to at least one account, the callback **does not log in automatically**. Instead, it issues a short-lived, one-time **pick ticket** (TTL 10 minutes) and redirects with `?pick=<ticket>`. The ticket itself is a credential, so all three pick endpoints use `authPublic`.

### List linked accounts

```http
GET /auth/oidc/pick?ticket=<ticket>
```

The ticket is **not consumed**, so this can be queried repeatedly:

```json
{
  "provider": "oidc",
  "oauth2_username": "alice",
  "email": "alice@example.com",
  "max_accounts": 5,
  "accounts": [{ "id": 1, "username": "openfield", "nickname": "Alice" }]
}
```

An unknown or expired ticket returns `404`.

### Select an account to log in

```http
POST /auth/oidc/pick/select
{ "ticket": "...", "user_id": 1 }
```

Consumes the ticket, verifies that the account belongs to the identity, and returns the same token payload as a regular login. Returns `403` if the account is not linked to the identity, is banned, or is pending deletion.

### Create an account and log in

```http
POST /auth/oidc/pick/create
{ "ticket": "..." }
```

Consumes the ticket. The server enforces the quota (`409 {"error":"account quota reached"}` if `max_accounts` has been reached), creates an account with `needs_registration = true` linked to the identity, and returns a login token.

### Link an identity

```http
POST /auth/oidc/bind
```

Links the just-authorized identity to the currently logged-in account:

| Condition | Result |
| --- | --- |
| The account is already linked to the same identity | Idempotent success |
| The account is already linked to another identity | Failure (`taken`) |
| The identity already has 5 linked accounts | Failure (`quota`) |

## Refresh-token rotation

### Refresh

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

- The access token lifetime is `jwt.expiry_hours` (24 hours by default).
- The refresh token is a 256-bit random opaque string stored in the server-side `refresh_tokens` table; the default lifetime is **30 days**.
- **Each refresh rotates the token**: the old refresh token is invalidated immediately (old row deletion and new row insertion happen in one transaction). Replaying an old token returns `401`.
- Missing, revoked, expired, and unknown tokens all return `401`.

Client recommendation: calculate the expiration time from `expires_in` and proactively refresh when fewer than 5 minutes remain. If refresh fails, clear local credentials and return to the login screen.

## QR-code login

An already logged-in device can approve a login request from a new device. The handshake window is **5 minutes**:

| Step | Call | Actor |
| --- | --- | --- |
| 1 | `POST /auth/qr` → obtain `code` | Device waiting to log in (anonymous) |
| 2 | Poll `GET /auth/qr/:code` until it returns `confirmed` and a token | Device waiting to log in |
| 3 | `POST /auth/qr/:code/approve` | Already logged-in device |

An already logged-in device **never** displays a login QR code.

## Device-session management

```http
GET /auth/sessions                 # my logged-in devices
DELETE /auth/sessions/:id          # revoke a device
```

Revoking a session also invalidates its refresh token.

## Common errors

| Status | Scenario |
| --- | --- |
| `401` | Refresh token invalid/expired/rotated; restricted endpoint accessed before completing `needs_registration` |
| `403` | In a multi-account pick, account is not linked to that identity, is banned, or is pending deletion |
| `404` | Pick ticket is unknown or expired |
| `409` | `account quota reached` (more than 5 accounts in a multi-account flow) |
