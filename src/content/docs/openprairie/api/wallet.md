---
title: 钱包与支付
description: 钱包余额与流水、管理员调账、用户间转账、支付 PIN、红包（checks）的创建与领取。
sidebar:
  order: 4
---

金额一律以**整数分**（`BIGINT`）存储，避免浮点误差；展示由客户端做 `amount / 100`。**没有**用户间的打赏式随意转账——转账需要收款方接受，红包需要领取。

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/wallet` | `wallet.view` | 我的余额与近期流水 |
| POST | `/wallet/adjust` | `wallet.manage` | 管理员调账（充值/扣减） |
| GET | `/transfers` | 需认证 | 我的转账（待处理与历史） |
| POST | `/transfers` | 需认证 | 发起转账 |
| POST | `/transfers/:id/accept` | 需认证 | 接受转账 |
| POST | `/transfers/:id/decline` | 需认证 | 拒收转账 |
| POST | `/users/me/pin` | 需认证 | 设置支付 PIN |
| PUT | `/users/me/pin` | 需认证 | 修改支付 PIN（需旧 PIN） |
| POST | `/users/me/pin/verify` | 需认证 | 校验支付 PIN |
| POST | `/checks` | 需认证 | 创建红包 |
| GET | `/checks/:id` | 需认证 | 红包详情 |
| POST | `/checks/:id/claim` | 需认证 | 领取一份 |

## 钱包

### 查询余额

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

`10000` = `100.00`。每笔流水都记录 `amount`、`balance_after`、`type`、`description` 与操作的 `operator_id`，可完整审计。

### 管理员调账

```http
POST /wallet/adjust
{ "user_id": 42, "amount": -500, "type": "deduct", "description": "Refund reversal" }
```

- `amount` 正数充值、负数扣减；扣到负余额会被拒绝（`400`/`409`）；
- `type` 取 `recharge` / `deduct`（信息性字段，建议与 `amount` 符号一致）；
- 实现在事务内 `SELECT ... FOR UPDATE` 锁钱包行后计算并写流水。

## 转账

### 发起

```http
POST /transfers
{ "recipient_id": 42, "amount": 5000, "note": "谢谢", "pin": "123456" }
```

`pin` 是发起方支付 PIN，用于授权出账。

### 接受 / 拒收

```http
POST /transfers/:id/accept      # 收款方接受（同样需要支付 PIN 语义校验）
POST /transfers/:id/decline     # 收款方拒收
```

### 列表

```http
GET /transfers
```

返回待处理与历史转账。**资金在对方接受后才入账**——发起不等同于到账。

## 支付 PIN

支付 PIN 是 **6 位数字**，授权一切出账操作（转账、红包、会员购买、帖子打赏）。它**不替代**登录密码，且与登录失败共用一套独立的错误预算。

| 操作 | 请求 |
| --- | --- |
| 设置 | `POST /users/me/pin` `{ "pin": "123456" }` |
| 修改 | `PUT /users/me/pin` `{ "old_pin": "123456", "pin": "654321" }` |
| 校验 | `POST /users/me/pin/verify` `{ "pin": "123456" }` |

修改必须提供旧 PIN。管理员可从管理面板直接重置任意用户的 PIN。连续试错会命中 `pkg/ratelimit` 的独立失败预算。

## 红包（Checks）

一个 **check** 是从创建者钱包**托管扣款**、可由他人领取的可分金额，行为类似红包。

- 创建时立即从钱包扣掉全额（`check_send`），资金进入托管，不属于任何人；
- 字段：`total`（分）、`shares`（可领份数）、`mode`（`random` / `average`）、`expires_at`；
- **random**：微信式随机，每份以“剩余平均值两倍”为上限，最后一份拿走余额；
- **average**：均分，最后领取者吸收舍入误差；
- 每人每个红包限领一次（`UNIQUE (check_id, user_id)`）；
- 份数领完 → `settled`；到期未领完 → 余额退还原主（`check_refund`），退款在读取/领取时惰性触发，并有每 30 分钟一次的后台清扫。

**限额**：总额 0.01–10000 币，1–500 份，有效期 1 小时 – 30 天。创建需要支付 PIN。

### 创建

```http
POST /checks
{ "amount": 10.5, "shares": 3, "mode": "random", "expires_in_hours": 24, "pin": "123456" }
```

```json
{ "check": { "id": 1, "creator_id": 7, "total": 10.5, "shares": 3,
             "mode": "random", "status": "active", "expires_at": "..." } }
```

注意这里的 `amount` / `total` 以**币**为单位（`10.5`），而不是分。

### 查看

```http
GET /checks/:id
```

返回红包本体加展示字段：`claims`（各领取人姓名/头像与金额）、`claimed_total`，以及针对当前用户的 `claimed_by_me` / `my_amount`。

红包**不是靠知道 id 就能访问**，可见性取决于它被分享在何处：

- 挂在帖子上 → 调用者必须能看到该帖子（公开/登录/好友/私有/营地成员）；
- 作为聊天消息发送 → 必须是该会话的活跃成员；
- 未挂载任何对象 → 可按 id 访问（此时 id 是它唯一的入口）。

其余情况一律 `404`，与“id 不存在”不可区分，因此连续 id 无法用来枚举红包。领取接口与领取名单沿用同一可见性规则。

### 领取

```http
POST /checks/:id/claim
```

`200 {"claim": {...}}`；`404` 不可达或不存在；`409` 已领完/已退款/已过期/本人已领过。

### 挂到帖子或消息

`POST /posts` 接受可选 `check_id`（须为本人所有、生效中、未过期、未被其它帖子占用），帖子载荷内嵌当前状态 `"check": {...}`（不含领取名单）。**删除帖子不会取消红包**，未领部分仍会到期退还原主。

`POST /conversations/:id/messages` 接受可选 `check_id`，这类消息为 `kind = "check"`、`content` 为空。因不含明文内容，在 E2EE 会话中同样可用。

## 错误速查

| 状态 | 场景 |
| --- | --- |
| `400` | 金额非法、PIN 缺失、扣减导致负余额 |
| `403` | 缺 `wallet.manage` / 操作他人钱包 |
| `409` | 扣减后余额为负；红包已领完/已过期；重复领取 |
| `429` | 支付 PIN 连续试错命中失败预算 |