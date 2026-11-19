---
title: 任务与会员
description: 每日签到、补签、每日活跃阶段任务、一次性成就、经验与等级推导、经验流水、会员档位与加成。
sidebar:
  order: 10
---

经验驱动账号等级；每次经验发放都经过 `GrantExp`，自动应用**生效中的会员倍率**。

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/tasks` | 需认证 | 任务目录 + 当前进度 + 可领取状态 |
| POST | `/tasks/daily-login/claim` | 需认证 | 每日签到领取 |
| GET | `/tasks/daily-login/calendar` | 需认证 | 签到日历 |
| POST | `/tasks/daily-login/makeup` | 需认证 | 补签（自动选最近漏签日） |
| POST | `/tasks/daily-login/makeup-date` | 需认证 | 指定日期补签 |
| POST | `/tasks/daily/:code/claim` | 需认证 | 领取**当天**的活跃阶段奖励 |
| POST | `/tasks/:code/claim` | 需认证 | 领取一次性成就奖励 |
| GET | `/exp/history` | 需认证 | 经验流水（分页） |
| GET | `/membership` | 需认证 | 我的会员状态 + 档位目录 |
| POST | `/membership/purchase` | 需认证 | 购买会员（需支付 PIN） |
| PUT | `/membership/auto-renew` | 需认证 | 自动续费开关 |
| GET | `/membership/purchases` | 需认证 | 购买记录 |
| POST | `/users/me/claim-daily-bonus` | 需认证 | 每日首请求奖励 |

## 每日签到

```http
POST /tasks/daily-login/claim
```

按服务器日（`GAME_TIMEZONE` 定义的边界，默认 UTC）发放经验与货币，默认 `100` exp / `20` 币（`GAME_DAILY_BONUS_EXP` / `GAME_DAILY_BONUS_CURRENCY`）。返回含连续签到天数。

```http
GET /tasks/daily-login/calendar
```

返回签到日历（已签/漏签/可补签）。

### 补签

```http
POST /tasks/daily-login/makeup           # 自动补最近漏签日
POST /tasks/daily-login/makeup-date      # 指定日期
```

补签消耗货币，默认 `100`（`GAME_MAKEUP_COST`）。

## 每日活跃阶段任务

「当天做了多少」分档发奖：每发 **1 / 5 / 10 / 20** 篇帖子、每天在聊天里发 **25 / 50 / 100** 条消息，各档**每天只能领一次**，次日重新计算。

### 内置档位

| code | 目标 | 经验 | 金币 |
| --- | --- | --- | --- |
| `daily_posts_1` | 1 帖 | 10 | 5 |
| `daily_posts_5` | 5 帖 | 40 | 25 |
| `daily_posts_10` | 10 帖 | 100 | 60 |
| `daily_posts_20` | 20 帖 | 260 | 160 |
| `daily_chat_25` | 25 条 | 30 | 15 |
| `daily_chat_50` | 50 条 | 80 | 45 |
| `daily_chat_100` | 100 条 | 200 | 120 |

档位是**累计**的：当天发了 20 篇帖子，四档都能各领一次；发了 60 条消息则 `chat_25` 与 `chat_50` 可领，`chat_100` 仍不可领。

奖励经验同样经过会员倍率（`model.ApplyMemberExp`）。

### 任务类型

| kind | 语义 | `cycle_key` |
| --- | --- | --- |
| `once` | 一次性成就，只领一次 | `''` |
| `streak` | 连续签到里程（3/7/30 天） | `''` |
| `daily` | 当天活跃量分档，每天每档可领一次 | `YYYY-MM-DD` |

`streak` 的进度是连续签到天数，`daily` 的进度是**当天**的帖子数或消息数——后者以当地日期作为 `cycle_key`，所以次日可再领。

### 进度如何统计

- **帖子**：`posts` 中 `user_id` 匹配且 `created_at` 落在当地当天区间的行数；
- **聊天**：`messages` 中 `sender_id` 匹配、`deleted_at IS NULL` 且 `created_at` 在当天区间的行数（撤回/删除不计）；
- 区间由 `GameConfig.Location()` 决定：`from` = 当天 00:00，`to` = `from + 1 天`。

### 领取

```http
POST /tasks/daily/:code/claim
```

| 状态 | 场景 |
| --- | --- |
| `200` | `{"claimed":true,"exp":N,"currency":M}` |
| `404` | 任务不存在 |
| `409` | 当天进度未达该档：`task requirements not met` |
| `409` | 该档今天已领：`task already claimed today` |

并发安全：发放时在事务内先插 `task_completions`（`(user_id, task_id, cycle_key)` 唯一约束），唯一冲突即视为已领并整体回滚，**奖励不会重复发放**。

任务目录由 `seedTasks()` 按 code upsert，`kind` 也在更新列内，因此**已有部署下次启动即获得新档位**，无需迁移版本。

## 一次性成就

```http
GET  /tasks
POST /tasks/:code/claim      # 如资料完善等成就码
```

`GET /tasks` 每个任务带 `kind` / `progress` / `target` / `completed` / `claimable`，客户端按 `kind == "daily"` 分组展示。

## 经验与等级

### 等级推导

累积经验换算等级，成本按几何增长：

| 参数 | 值 |
| --- | --- |
| 升到 2 级成本 | `100` exp（`ExpPerLevel`） |
| 每级增幅 | `×1.05`（`LevelGrowth`） |
| 等级上限 | `200` |

### 经验流水

```http
GET /exp/history
```

分页返回每一次经验发放及其当时的等级，客户端据此渲染时间线。

## 会员

会员是可购买的档位，提升经验并解锁权益。

### 档位目录

| 等级 | 名称 | 价格（币） | 经验倍率 | 存储加成 |
| --- | --- | --- | --- | --- |
| 1 | 薄雾 | 200 | ×2 | +100 MB |
| 2 | 篝火 | 400 | ×2.5 | +200 MB |
| 3 | 明月 | 800 | ×3 | +400 MB |
| 4 | 孤星 | 1600 | ×3.5 | +800 MB |

> 上游 `docs/features.md` 把 Lv.4 的存储加成写成 +400 MB，与代码（`pkg/model/membership.go` 的 `MemberStorageBonusBytes`：1→100、2→200、3→400、4→800 MB）不一致。**以代码为准，即 +800 MB**。

会员有效期 **30 天**；到期后**保留等级**，续费从原等级延续。`MembershipActive` 决定某一时刻倍率/加成是否生效。

### 购买与状态

```http
GET  /membership                  # 我的状态 + 档位目录（含倍率、存储加成、名称样式上限）
POST /membership/purchase         # 扣钱包，需要支付 PIN
PUT  /membership/auto-renew       # 自动续费开关
GET  /membership/purchases        # 购买记录
```

### 加成如何生效

| 加成 | 说明 |
| --- | --- |
| **经验倍率** | 在 `GrantExp` 内应用，正向调整自动放大 |
| **存储配额** | `MemberStorageBonusAt` 生效时叠加，**到期瞬间回落到基础配额**；用量仍高于基础配额时上传被拒直到降回 |
| **创建配额** | 每级 +25%：可拥有的群组数（基础 1000，仅计自己创建的）与可创建的营地数（基础 100） |

配额在创建时由 `pkg/repository/quotas.go` 校验，超限返回 `403` 并附带计算后的上限。

### 管理员授予

```http
PUT /users/:user_id/membership      # 权限 user.membership.grant
{ "level": 2, "days": 30 }
```

`level: 0` 表示清除；`days` 可选，覆盖默认时长。

## 每日首请求奖励

```http
POST /users/me/claim-daily-bonus
```

按服务器日发放一次经验与货币（默认 100 exp / 20 币），与签到是两条独立路径。