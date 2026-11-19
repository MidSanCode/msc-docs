---
title: 帖子与互动
description: 发帖、可见性、评论、点赞、收藏、置顶、帖子打赏，以及个人时间线与收藏列表。
sidebar:
  order: 5
---

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/posts` | `posts.create` | 发帖 |
| GET | `/posts?page=&limit=` | 公开 | 时间线（支持筛选） |
| GET | `/posts/:id` | 公开 | 单帖（记录浏览） |
| PUT | `/posts/:id` | `posts.edit` | 改自己的帖 |
| DELETE | `/posts/:id` | `posts.delete` | 删自己的帖 |
| PUT | `/posts/:id/pin` | 需认证 | 置顶（作者/营地管理员） |
| GET | `/posts/:id/replies?limit=` | 公开 | 评论列表 |
| POST | `/posts/:id/replies` | `posts.reply.create` | 发评论 |
| PUT | `/posts/:id/replies/:reply_id` | `posts.reply.edit` | 改自己的评论 |
| DELETE | `/posts/:id/replies/:reply_id` | `posts.reply.delete` | 删自己的评论 |
| PUT | `/posts/:id/reactions` | `posts.react` | 点赞/表情 |
| DELETE | `/posts/:id/reactions` | `posts.react` | 取消表情 |
| POST | `/posts/:id/favorite` | `posts.favorite` | 收藏 |
| DELETE | `/posts/:id/favorite` | `posts.favorite` | 取消收藏 |
| POST | `/posts/:id/tips` | 需认证 | 打赏（需支付 PIN） |
| POST | `/posts/:id/replies/:reply_id/favorite` | `posts.favorite` | 收藏评论 |
| DELETE | `/posts/:id/replies/:reply_id/favorite` | `posts.favorite` | 取消收藏评论 |
| GET | `/users/:user_id/posts` | 公开 | 某人的帖子 |
| GET | `/users/:user_id/favorites/posts` | 需认证 | 我的收藏帖子 |
| GET | `/users/:user_id/favorites/replies` | 需认证 | 我的收藏评论 |

## 发帖

```http
POST /posts
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | string | ≤5000 字符；`content` 与 `quoted_post_id` 至少一个 |
| `visibility` | string | `public` \| `login` \| `friends` \| `private`，默认 `public` |
| `attachment_ids` | []int64 | 最多 9 个，需先上传 |
| `check_id` | int64 | 关联红包 |
| `tags` | []string | 标签 |
| `quoted_post_id` | int64 | 引用/转发 |
| `camp_id` | int64 | 发到营地；`0` 或省略 = 全局 |

响应 `201` + 帖子对象本身。

### 可见性语义

| 值 | 谁能看 |
| --- | --- |
| `public` | 所有人 |
| `login` | 任意已登录用户 |
| `friends` | 互关好友 + 作者 |
| `private` | 仅作者 |

营地帖另加一层：**仅营地成员与作者可见**，且不出现在全局时间线。

### 帖子载荷

包含 `reply_count`、`favorite_count`、表情聚合表，以及作者的会员等级与名称样式反规范化字段；带 token 请求时还包含调用者自身的点赞/收藏状态与 `pinned` 标记。

## 时间线与筛选

```http
GET /posts?page=1&limit=20
GET /posts?q=关键词&author=alice&tag=news&author_id=7&from=2026-01-01&to=2026-02-01
```

**页码分页**：返回 `{"posts":[…],"page":1}`，**没有 `total`/`has_more`**，请求到空数组即为末尾。

## 修改与删除

```http
PUT /posts/:id
{ "content": "新文本", "attachment_ids": [1, 3] }
```

`attachment_ids` 会**整体替换**原附件列表（最多 9 个）。**编辑不会把帖子在营地之间移动**。

```http
DELETE /posts/:id
```

仅作者可删。删除帖子**不会取消**其关联红包（未领部分到期退还原主）。

## 评论

```http
POST /posts/:id/replies
{ "content": "写得不错", "parent_id": null, "attachment_ids": [] }
```

- `content` 必填，≤5000 字符；
- `parent_id` 必须指向**同一帖子下**存在的评论（二级回复）；
- 列表：`GET /posts/:id/replies?limit=50` → `{"replies":[…],"page":1}`。

## 表情与点赞

```http
PUT    /posts/:id/reactions    { "reaction": "like" }
DELETE /posts/:id/reactions
```

可用表情键：`like`、`dislike`、`love`、`haha`、`wow`、`sad`、`angry`。非法键返回 `400 {"error":"unknown reaction"}`。响应返回更新后的帖子对象。

## 收藏

```http
POST   /posts/:id/favorite
DELETE /posts/:id/favorite
```

评论也可收藏：`POST|DELETE /posts/:id/replies/:reply_id/favorite`。

收藏列表（只能查自己）：

```http
GET /users/:user_id/favorites/posts
GET /users/:user_id/favorites/replies
```

## 置顶

```http
PUT /posts/:id/pin
{ "pinned": true }
```

- 全局帖：**作者本人**置顶，置顶帖浮到作者主页与全局时间线顶部；
- 营地帖：营地 **owner/admin 可置顶任意帖**；普通成员只能置顶自己的，且需营地开启 `member_pin`；
- 营地置顶另有独立入口 `PUT /camps/:id/posts/:post_id/pin`，只影响营地内的排序。

`pinned` 为必填布尔值，缺失返回 `400`。

## 打赏（Tips）

```http
POST /posts/:id/tips
{ "amount": 100, "pin": "123456" }
```

- `amount` 以**币**为单位，范围 1 – 100000；
- 必须提供支付 PIN；
- **不能打赏自己的帖子**（`400 {"error":"cannot tip your own post"}`）；
- 打赏人付出全额，作者收到 **95%**，其余 5% 为平台费；
- **帖子被删除时**，作者钱包中的对应 95% 会退回打赏人并标记 `refunded_at`；
- 帖子对当前用户不可见时返回 `404`。

## 常见错误

| 状态 | 场景 |
| --- | --- |
| `400` | 内容超 5000、附件超 9、未知 `visibility`、未知表情、`pinned` 缺失、打赏自己的帖 |
| `403` | 缺 `posts.*` 权限；营地帖未加入营地或营地关闭了成员发帖 |
| `404` | 帖子不存在或对当前身份不可见 |