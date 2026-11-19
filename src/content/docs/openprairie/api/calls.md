---
title: 语音与视频通话
description: P2P 通话的状态机、REST 上行信令 + WebSocket 下行事件、群组 mesh 语义、ICE/TURN 配置与已知限制。
sidebar:
  order: 8
---

通话是**点对点**的：媒体在两端的 WebRTC 连接间直传，服务端只做两件事——维护**状态机**（谁在打给谁、响铃还是接通、为什么结束）与**中继信令**（SDP / ICE）。服务端不解码、不转码，因此没有媒体带宽成本，也不需要 SFU/MCU。

代价是：没有 TURN 时，对称 NAT 与企业防火墙环境**无法建连**。

## 端点一览

全部需要权限 **`chat.call`**（普通功能键，默认组自动持有；运营方可用组撤权整体关停通话）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/calls` | 发起通话 `{ conversation_id, mode }` |
| GET | `/calls/ice` | 本部署下发的 ICE 服务器 |
| GET | `/calls/:id` | 通话详情（含参与者与推导时长） |
| GET | `/conversations/:id/call` | 该会话当前通话，无则 `null` |
| POST | `/calls/:id/answer` | 接听 |
| POST | `/calls/:id/decline` | 拒接 |
| POST | `/calls/:id/hangup` | 挂断 |
| POST | `/calls/:id/signal` | 信令中继 |

## 为什么信令走 REST

`GET /api/v1/ws` 是**纯下行**通道：服务端的读循环只用于探测断连，读到的帧直接丢弃。客户端无法把 ICE candidate 写上去。因此：

```
客户端 A ──POST /calls/:id/signal──► chat 服务 ──NOTIFY──► push 服务
                                                              │
客户端 B ◄──────────── WebSocket: call.signal ◄───────────────┘
```

**上行走 REST，下行复用现有推送**。

## 数据模型

### call_sessions

| 列 | 说明 |
| --- | --- |
| `id` | 通话 ID |
| `conversation_id` | 所属会话，级联删除 |
| `initiator_id` | 发起人，级联删除 |
| `mode` | `audio` \| `video` |
| `state` | `ringing` \| `active` \| `ended` |
| `end_reason` | `hung_up` \| `cancelled` \| `declined` \| `timeout` |
| `created_at` / `answered_at` / `ended_at` | 时间戳 |
| `duration_seconds` | **不落库**，查询时由时间戳推导 |

部分唯一索引 `idx_calls_live ON call_sessions(conversation_id) WHERE state <> 'ended'` 提供并发保证：**同一会话同时只允许一通未结束的通话**，第二次发起命中唯一冲突返回 `409`，而不是让对端同时响两个铃。

### call_participants

主键 `(call_id, user_id)`，`state` 取 `invited` \| `accepted` \| `declined` \| `left`。发起人创建时即写为 `accepted`，被叫方初始 `invited`。

## 状态机

```
                 answer
   ringing ──────────────────► active ──── hangup ────► ended
      │                          │
      ├── decline ───────────────┤
      ├── cancel（振铃时挂断）────┤
      └── timeout（45s 未接）─────┘
```

`ended` 是终态，不会回到响铃；再打是新 id。`answer` 用条件更新 `WHERE state = 'ringing'` 实现，天然解决多端同时接听的竞态：抢输的一端拿到 `409` 与当前通话状态，据此停止响铃。

## 发起

```http
POST /calls
{ "conversation_id": 123, "mode": "audio" }
```

`mode` 可省略，默认 `audio`。成功 `201` + `{"call": {...}}`，同时向被叫推送 `call.invited`（群组通话额外携带 `participant_ids` 花名册）。

| 状态 | 场景 |
| --- | --- |
| `400` | 参数错误；会话类型不是 `private`/`group`；群里除自己外无可呼叫成员；群人数超 20 |
| `403` | 不是会话成员；**发起方是 bot**（bot 没有媒体端点） |
| `404` | 会话不存在 |
| `409` | 该会话已有进行中的通话 |

群组花名册 = 会话中**活跃（`status = active`）且非 bot** 的成员，发起人除外（bot 静默跳过）。

## 接听 / 拒接 / 挂断

```http
POST /calls/:id/answer
```

成功返回 `200` 与最新通话，并向**全部参与者**推送 `call.accepted`（让被叫的其他设备停止响铃）。`400` 发起人接听自己的去电；`403` 非参与者；`409` 通话已结束（一对一场景下也用于“已不再响铃”）。

```http
POST /calls/:id/decline
```

**一对一**：拒接即结束整通电话（`end_reason = declined`）。
**群组（mesh）**：只把自己移出响铃名单，通话对其他人继续响铃；一直无人接则由清扫器超时收尾。

```http
POST /calls/:id/hangup
```

- 响铃阶段挂断 → `end_reason = cancelled`；
- 接通后挂断 → `end_reason = hung_up`。

`End()` 是条件更新 `WHERE state <> 'ended'`，所以 `call.ended` **只推一次**。

**群组语义**：挂断只把自己标记 `left` 并拆掉自己的对等连接——发起人在响铃阶段挂断则整通作废；其余情况只要还有任何 `accepted` 参与者就继续通话，并给其余人推 `call.participant_left`；最后一个 `accepted` 挂断时通话结束。

## 群组 mesh 通话

- 两两建连，**上行带宽随人数线性增长**（每人多 N−1 份自己的上行流），**人数上限 20**；
- 每个成员**各自接听**：第一个接听把通话从 `ringing` 推进到 `active`，之后接听属于“加入进行中的通话”，返回 `200` 而非 `409`；
- 每个加入者都要为花名册里每个已接受成员建立自己的对等连接；
- 不做强一致的响铃/接通知：迟到的成员靠 `call.accepted` 事件 + `GET /calls/:id` 拉花名册补齐连接。

超过 20 人的群组需要 SFU（当前未实现）。

## 信令中继

```http
POST /calls/:id/signal
{ "type": "offer", "payload": { } }
```

```http
{ "type": "candidate", "to_user_id": 456, "payload": { "candidate": "..." } }
```

| 规则 | 说明 |
| --- | --- |
| `type` | 只能是 `offer` / `answer` / `candidate` |
| `payload` | **不透明**，服务端不解析不校验 |
| `to_user_id` | 可省略；省略则转发给所有其他参与者（一对一客户端的既有契约），指定则只发给该参与者（mesh 每对连接单独协商）。目标必须是本通话参与者，否则 `403` |
| 上限 | **6000 字节**，超出 `413`（因 `pg_notify` 单条上限 8000 字节，宁可明确拒绝也不要静默丢包） |
| 持久化 | **不落库**（candidate 交换频繁且通话后无价值） |

无对端可投递或通话已结束 → `409`。下行事件为 `call.signal`。

> **多端限制**：Hub 按 `user_id` 索引连接，`call.signal` 会投递到被叫**所有设备**。客户端必须按 `call_id` 过滤，只在真正接听的那台设备上处理协商数据。

## 推送事件

| 事件 | 接收者 | 载荷 |
| --- | --- | --- |
| `call.invited` | 被叫方 | `call_id`、`conversation_id`、`initiator_id`、`mode`、`created_at`（群组另有 `participant_ids`） |
| `call.accepted` | 全体参与者 | `call_id`、`user_id` |
| `call.declined` | 发起人 | `call_id`、`user_id` |
| `call.participant_left` | 其余已接受参与者 | `call_id`、`user_id`（mesh 专用：拆掉通向该用户的对等连接） |
| `call.ended` | 全体参与者 | `call_id`、`conversation_id`、`end_reason`、`duration_seconds` |
| `call.signal` | 目标或全体其他参与者 | `call_id`、`from_user_id`、`to_user_id`、`type`、`payload` |

### 状态恢复

推送是尽力而为、**没有事件重放**。客户端进入聊天页、重连或怀疑漏收事件时，必须主动对齐：

```http
GET /conversations/:id/call      # 该会话是否有进行中的通话（无则 null）
GET /calls/:id                   # 完整状态与参与者
```

漏收 `call.invited` 就没有 call id 可查，所以前一个接口是必须的入口。

## 超时与清理

- 振铃超时 **45 秒**；
- chat 服务运行 **2 秒**周期的清扫器，把超时的 `ringing` 通话置为 `ended`（`end_reason = timeout`）并推送 `call.ended`；
- 由部分索引 `idx_calls_ringing` 支撑，避免全表扫描；
- 没有清扫器，主叫进程被杀后对端会**一直响铃**，且 `idx_calls_live` 会让该会话**再也打不通电话**。

## ICE / TURN 配置

服务端配置一次，客户端通过 `GET /calls/ice` 取用：

```yaml
call:
  stun_urls: ["stun:stun.example.com:3478"]   # 省略则用内置公共 STUN 列表
  turn_url: "turn:turn.example.com:3478"
  turn_secret: "<coturn use-auth-secret 的共享密钥>"
```

环境变量：`CALL_STUN_URLS`、`CALL_TURN_URL`、`CALL_TURN_USERNAME`、`CALL_TURN_CREDENTIAL`、`CALL_TURN_SECRET`。

### 按用户短期凭据（推荐）

配置 `turn_secret` 后不再下发静态账号密码，而是为**当前用户**签发短期凭据：

```json
{
  "ice_servers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "turn:turn.example.com:3478",
      "username": "1736000000:42", "credential": "7j...base64" }
  ],
  "turn": true,
  "ttl": 3600
}
```

`username = "<过期unix时间戳>:<user_id>"`，`credential = base64(HMAC-SHA1(turn_secret, username))`，有效期 1 小时。coturn 用同一密钥验签并检查时间戳，服务端无需存任何会话状态。

好处：泄漏的凭据只对应**一个用户、一小时**；静态凭据是全系统共享的。`ttl` 告诉客户端何时该重新拉取——过期后应重新 `GET /calls/ice` 再重协商，不要拿过期凭据死撞 NAT。

### 未配置 TURN

`{"ice_servers": [...], "turn": false}`：对称 NAT / 企业防火墙 / 部分移动网络**必然**连不通，表现为一直“连接中”后失败。客户端应据此明确提示。

部署 coturn 要点：开放 `3478/udp`、`3478/tcp`、`5349/tls` 与中继端口段；生产用 `use-auth-secret` 而非静态账号；只有中继流量计费（经验比例 10%–20%）。

## 通话记录消息

每次通话结束（接通、拒接、超时、取消）都会在会话里留下一条 `kind = "call"` 的消息：

```json
{ "call_id": 42, "mode": "audio", "outcome": "answered", "duration_seconds": 201, "initiator_id": 7 }
```

- 只在状态真正迁到 `ended` 时写入（条件更新决定胜负，不会重复写）；
- `content` 为空，结果与时长在 `call_meta`（JSONB），**措辞由客户端本地化**——同一行对主叫和被叫读法不同；
- `outcome`：`answered`（带时长）、`declined`、`missed`（超时）、`cancelled`；
- 写入后照常广播 `chat.message.created`，客户端即时插入。

## 已知限制

- **App 被杀死时收不到来电**：iOS 仅在 App 存活时才能投递 CallKit 来电，覆盖该场景需 PushKit + APNs VoIP 证书与服务端 VoIP 推送通道（当前最大缺口）。
- **群组通话是 mesh**，上限 20 人。
- **bot 不能发起通话**（`403`）；用户给 bot 打电话会正常响铃后 45 秒超时；群组花名册中的 bot 被静默跳过。
- **`call.signal` 投递到被叫所有设备**，需客户端按 `call_id` 过滤。
- **无事件重放**：重连后已接通但未重协商的通话无法恢复，客户端只在 `ringing` 时接管。

## 排障

| 现象 | 排查方向 |
| --- | --- |
| 发起返回 `409` | 该会话已有未结束通话：`SELECT ... FROM call_sessions WHERE conversation_id=$1 AND state<>'ended'` |
| 对端收不到 `call.invited` | 对端是否在线（WS 是否连着）；事件通道是否正常；是否共用同一 PostgreSQL |
| `call.signal` 返回 `413` | 载荷超 6000 字节，检查是否塞了整段带 simulcast 的 SDP |
| 一直“连接中” | NAT 穿透失败：确认 STUN/TURN 可达、candidate 是否成对 |
| 通话结束后会话仍打不通 | 确认 `state` 已为 `ended`；`idx_calls_live` 只排除已结束行 |