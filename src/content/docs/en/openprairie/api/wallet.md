---
title: Wallet and Payments
description: Wallet balances and transactions, administrator adjustments, user-to-user transfers, payment PINs, and creating and claiming red packets (checks).
sidebar:
  order: 4
---

All amounts are stored as **integer cents** (`BIGINT`) to avoid floating-point errors; clients display them as `amount / 100`. There is **no** unrestricted tipping-style transfer between users: a transfer must be accepted by the recipient, and red packets must be claimed.

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/wallet` | `wallet.view` | My balance and recent transactions |
| POST | `/wallet/adjust` | `wallet.manage` | Administrator adjustment (credit/debit) |
| GET | `/transfers` | Auth required | My transfers (pending and history) |
| POST | `/transfers` | Auth required | Initiate transfer |
| POST | `/transfers/:id/accept` | Auth required | Accept transfer |
| POST | `/transfers/:id/decline` | Auth required | Decline transfer |
| POST | `/users/me/pin` | Auth required | Set payment PIN |
| PUT | `/users/me/pin` | Auth required | Change payment PIN (requires old PIN) |
| POST | `/users/me/pin/verify` | Auth required | Verify payment PIN |
| POST | `/checks` | Auth required | Create red packet |
| GET | `/checks/:id` | Auth required | Red packet details |
| POST | `/checks/:id/claim` | Auth required | Claim one share |

## Wallet

### Check balance

```http
GET /wallet
```

```json
{
  "balance": 10000,
  "transactions": [
    {
      "id": 1,
      "amount": 10000,
      "balance_after": 10000,
      "type": "recharge",
      "description": "Admin top-up",
      "created_at": "2026-08-03T10:00:00Z"
    }
  ]
}
```

`10000` = `100.00`. Each transaction records `amount`, `balance_after`, `type`, `description`, and the acting `operator_id` for a complete audit trail.

### Administrator adjustment

```http
POST /wallet/adjust
{ "user_id": 42, "amount": -500, "type": "deduct", "description": "Refund reversal" }
```

- A positive `amount` adds funds; a negative amount deducts funds. A deduction that would make the balance negative is rejected (`400`/`409`).
- `type` is `recharge` / `deduct` (informational; it should match the sign of `amount`).
- The implementation locks the wallet row with `SELECT ... FOR UPDATE` inside a transaction before calculating and recording the transaction.

## Transfers

### Initiate

```http
POST /transfers
{ "recipient_id": 42, "amount": 5000, "note": "Thank you", "pin": "123456" }
```

`pin` is the sender's payment PIN, used to authorize the outgoing funds.

### Accept / decline

```http
POST /transfers/:id/accept      # recipient accepts (payment-PIN semantic validation also applies)
POST /transfers/:id/decline     # recipient declines
```

### List

```http
GET /transfers
```

Returns pending and historical transfers. **Funds are credited only after the recipient accepts**; initiating a transfer does not mean the funds have arrived.

## Payment PIN

A payment PIN is **six digits** and authorizes all outgoing payments (transfers, red packets, membership purchases, and post tips). It does **not** replace the login password and has a separate failure budget, independent of login failures.

| Operation | Request |
| --- | --- |
| Set | `POST /users/me/pin` `{ "pin": "123456" }` |
| Change | `PUT /users/me/pin` `{ "old_pin": "123456", "pin": "654321" }` |
| Verify | `POST /users/me/pin/verify` `{ "pin": "123456" }` |

Changing the PIN requires the old PIN. Administrators can reset any user's PIN directly from the administration panel. Repeated incorrect attempts hit the separate failure budget in `pkg/ratelimit`.

## Red packets (checks)

A **check** is a divisible amount of funds held in escrow from its creator's wallet and claimable by others; it behaves like a red packet.

- Creation immediately deducts the full amount from the wallet (`check_send`); the funds enter escrow and belong to nobody.
- Fields: `total` (cents), `shares` (number of claimable shares), `mode` (`random` / `average`), and `expires_at`.
- **random**: WeChat-style random shares; each share is capped at twice the average of the remaining balance, and the last share receives the remainder.
- **average**: Equal shares; the last claimant receives any rounding remainder.
- Each user may claim each red packet once (`UNIQUE (check_id, user_id)`).
- When all shares are claimed, the check becomes `settled`. If it expires with shares unclaimed, the remaining balance is refunded to the creator (`check_refund`). The refund is triggered lazily on read/claim, with a background cleanup job running every 30 minutes.

**Limits**: total amount 0.01–10000 coins, 1–500 shares, and validity of 1 hour–30 days. Creation requires a payment PIN.

### Create

```http
POST /checks
{ "amount": 10.5, "shares": 3, "mode": "random", "expires_in_hours": 24, "pin": "123456" }
```

```json
{ "check": { "id": 1, "creator_id": 7, "total": 10.5, "shares": 3,
             "mode": "random", "status": "active", "expires_at": "..." } }
```

Note that `amount` / `total` here are in **coins** (`10.5`), not cents.

### View

```http
GET /checks/:id
```

Returns the red packet itself plus display fields: `claims` (each claimant's name/avatar and amount), `claimed_total`, and the current user's `claimed_by_me` / `my_amount`.

A red packet is **not accessible merely by knowing its id**. Visibility depends on where it was shared:

- Attached to a post → the caller must be able to view the post (public/login/friends/private/camp member).
- Sent as a chat message → the caller must be an active member of that conversation.
- Not attached to any object → accessible by id (the id is then its only entry point).

All other cases return `404`, indistinguishable from a nonexistent id, preventing enumeration through sequential ids. The claim endpoint and claim list use the same visibility rules.

### Claim

```http
POST /checks/:id/claim
```

Returns `200 {"claim": {...}}`; `404` if inaccessible or nonexistent; `409` if all shares have been claimed, refunded, expired, or already claimed by the current user.

### Attach to a post or message

`POST /posts` accepts an optional `check_id` (must belong to the caller, be active and unexpired, and not already be attached to another post). The post payload embeds the current state as `"check": {...}` (without the claim list). **Deleting the post does not cancel the check**; any unclaimed balance is still refunded to the creator upon expiry.

`POST /conversations/:id/messages` accepts an optional `check_id`. Such a message has `kind = "check"` and empty `content`. Since it contains no plaintext content, it can also be used in E2EE conversations.

## Error reference

| Status | Scenario |
| --- | --- |
| `400` | Invalid amount, missing PIN, or deduction would make balance negative |
| `403` | Missing `wallet.manage` / attempting to operate on another user's wallet |
| `409` | Balance would become negative after deduction; red packet is fully claimed/expired; duplicate claim |
| `429` | Repeated payment-PIN failures exceeded the failure budget |
