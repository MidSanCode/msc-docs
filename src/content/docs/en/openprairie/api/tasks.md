---
title: Tasks and Membership
description: Daily check-ins, makeup check-ins, daily activity milestones, one-time achievements, experience and level calculation, experience history, and membership tiers and bonuses.
sidebar:
  order: 10
---

Experience determines the account level; every experience grant goes through `GrantExp`, which automatically applies the **currently active membership multiplier**.

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/tasks` | Auth required | Task catalog + current progress + claimability |
| POST | `/tasks/daily-login/claim` | Auth required | Claim daily check-in rewards |
| GET | `/tasks/daily-login/calendar` | Auth required | Check-in calendar |
| POST | `/tasks/daily-login/makeup` | Auth required | Makeup check-in (automatically selects the most recent missed day) |
| POST | `/tasks/daily-login/makeup-date` | Auth required | Makeup check-in for a specified date |
| POST | `/tasks/daily/:code/claim` | Auth required | Claim **today's** activity milestone reward |
| POST | `/tasks/:code/claim` | Auth required | Claim a one-time achievement reward |
| GET | `/exp/history` | Auth required | Experience history (paginated) |
| GET | `/membership` | Auth required | My membership status + tier catalog |
| POST | `/membership/purchase` | Auth required | Purchase membership (requires payment PIN) |
| PUT | `/membership/auto-renew` | Auth required | Toggle automatic renewal |
| GET | `/membership/purchases` | Auth required | Purchase history |
| POST | `/users/me/claim-daily-bonus` | Auth required | Daily first-request bonus |

## Daily check-in

```http
POST /tasks/daily-login/claim
```

Grants experience and currency by server day (day boundaries are defined by `GAME_TIMEZONE`, UTC by default). Defaults are `100` exp / `20` coins (`GAME_DAILY_BONUS_EXP` / `GAME_DAILY_BONUS_CURRENCY`). The response includes the number of consecutive check-in days.

```http
GET /tasks/daily-login/calendar
```

Returns a check-in calendar (checked in / missed / eligible for makeup).

### Makeup check-in

```http
POST /tasks/daily-login/makeup           # Automatically make up the most recent missed day
POST /tasks/daily-login/makeup-date      # Specify a date
```

A makeup check-in costs currency, `100` by default (`GAME_MAKEUP_COST`).

## Daily activity milestone tasks

Rewards are tiered by “how much was done today”: publish **1 / 5 / 10 / 20** posts or send **25 / 50 / 100** chat messages in a day. Each milestone **can be claimed only once per day**, and progress resets the next day.

### Built-in milestones

| code | Target | Experience | Coins |
| --- | --- | --- | --- |
| `daily_posts_1` | 1 post | 10 | 5 |
| `daily_posts_5` | 5 posts | 40 | 25 |
| `daily_posts_10` | 10 posts | 100 | 60 |
| `daily_posts_20` | 20 posts | 260 | 160 |
| `daily_chat_25` | 25 messages | 30 | 15 |
| `daily_chat_50` | 50 messages | 80 | 45 |
| `daily_chat_100` | 100 messages | 200 | 120 |

Milestones are **cumulative**: publishing 20 posts in a day allows all four milestones to be claimed once each. Sending 60 messages makes `chat_25` and `chat_50` claimable, but not `chat_100`.

Experience rewards also receive the membership multiplier (`model.ApplyMemberExp`).

### Task types

| kind | Meaning | `cycle_key` |
| --- | --- | --- |
| `once` | One-time achievement, claimable only once | `''` |
| `streak` | Consecutive check-in milestone (3/7/30 days) | `''` |
| `daily` | Daily activity milestones, each claimable once per day | `YYYY-MM-DD` |

For `streak`, progress is the number of consecutive check-in days. For `daily`, progress is the number of posts or messages **that day**—the latter uses the local date as `cycle_key`, allowing rewards to be claimed again the next day.

### How progress is counted

- **Posts**: the number of rows in `posts` with a matching `user_id` and `created_at` within the current local day's interval;
- **Chat**: the number of rows in `messages` with a matching `sender_id`, `deleted_at IS NULL`, and `created_at` within the day's interval (retracted/deleted messages do not count);
- The interval is determined by `GameConfig.Location()`: `from` = 00:00 that day, `to` = `from + 1 day`.

### Claim

```http
POST /tasks/daily/:code/claim
```

| Status | Scenario |
| --- | --- |
| `200` | `{"claimed":true,"exp":N,"currency":M}` |
| `404` | Task does not exist |
| `409` | Today's progress has not reached this milestone: `task requirements not met` |
| `409` | This milestone has already been claimed today: `task already claimed today` |

Concurrency safety: granting first inserts into `task_completions` inside a transaction (unique constraint on `(user_id, task_id, cycle_key)`). A uniqueness conflict is treated as already claimed and rolls back the entire transaction, so **rewards are never granted twice**.

The task catalog is upserted by code through `seedTasks()`, with `kind` included among the updated columns. Therefore, **existing deployments receive the new milestones on their next startup**, without a versioned migration.

## One-time achievements

```http
GET  /tasks
POST /tasks/:code/claim      # An achievement code, such as completing a profile
```

Each task in `GET /tasks` includes `kind` / `progress` / `target` / `completed` / `claimable`. Clients group tasks with `kind == "daily"` for display.

## Experience and levels

### Level calculation

Accumulated experience is converted to a level, with costs growing geometrically:

| Parameter | Value |
| --- | --- |
| Cost to reach level 2 | `100` exp (`ExpPerLevel`) |
| Increase per level | `×1.05` (`LevelGrowth`) |
| Level cap | `200` |

### Experience history

```http
GET /exp/history
```

Returns a paginated record of every experience grant and the level at the time, allowing clients to render a timeline.

## Membership

Membership consists of purchasable tiers that increase experience gains and unlock benefits.

### Tier catalog

| Level | Name | Price (coins) | Experience multiplier | Storage bonus |
| --- | --- | --- | --- | --- |
| 1 | Mist | 200 | ×2 | +100 MB |
| 2 | Campfire | 400 | ×2.5 | +200 MB |
| 3 | Bright Moon | 800 | ×3 | +400 MB |
| 4 | Lone Star | 1600 | ×3.5 | +800 MB |

> Upstream `docs/features.md` lists the Lv.4 storage bonus as +400 MB, which differs from the code (`MemberStorageBonusBytes` in `pkg/model/membership.go`: 1→100, 2→200, 3→400, 4→800 MB). **The code is authoritative: +800 MB**.

Membership is valid for **30 days**; the **level is retained** after expiry, and renewal continues from the previous level. `MembershipActive` determines whether multipliers/bonuses apply at a given moment.

### Purchase and status

```http
GET  /membership                  # My status + tier catalog (including multipliers, storage bonuses, and name-style limits)
POST /membership/purchase         # Debit the wallet; requires payment PIN
PUT  /membership/auto-renew       # Toggle automatic renewal
GET  /membership/purchases        # Purchase history
```

### How bonuses apply

| Bonus | Description |
| --- | --- |
| **Experience multiplier** | Applied inside `GrantExp`; positive adjustments are automatically multiplied |
| **Storage quota** | Added while `MemberStorageBonusAt` is in effect; **reverts to the base quota at the instant of expiry**. If usage remains above the base quota, uploads are denied until it falls back within the quota |
| **Creation quotas** | +25% per level: number of groups that can be owned (base 1000, counting only those created by the user) and number of camps that can be created (base 100) |

Quotas are checked at creation time by `pkg/repository/quotas.go`. Exceeding a quota returns `403` with the calculated limit.

### Administrator grants

```http
PUT /users/:user_id/membership      # Permission: user.membership.grant
{ "level": 2, "days": 30 }
```

`level: 0` clears membership; optional `days` overrides the default duration.

## Daily first-request bonus

```http
POST /users/me/claim-daily-bonus
```

Grants experience and currency once per server day (100 exp / 20 coins by default). This is a separate path from check-in.
