---
title: 营地与子群
description: 贴吧式营地（camps）的创建、浏览、成员与角色管理、营地设置、私有子群与级联删除。
sidebar:
  order: 6
---

营地（camp）是贴吧式社区空间：其中的帖子属于营地，而不进全局时间线。营地可以嵌套**私有子群**。

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/camps` | 公开 | 营地目录（`?q=` 搜索、`?mine=1` 我的营地） |
| POST | `/camps` | 需认证 | 创建营地（受配额限制） |
| GET | `/camps/:id` | 公开 | 营地详情（隐藏营地对非成员 404） |
| PUT | `/camps/:id` | 需认证 | 修改营地（admin 改基础项，owner 改权限开关） |
| DELETE | `/camps/:id` | 需认证 | 删除营地（**仅 creator**） |
| GET | `/camps/:id/posts` | 公开 | 营地帖子（**仅成员**；隐藏营地对非成员 404） |
| PUT | `/camps/:id/announcement` | 需认证 | 营地公告（admin+） |
| POST | `/camps/:id/join` | 需认证 | 加入（要求 `direct_join`） |
| DELETE | `/camps/:id/members/me` | 需认证 | 退出（creator 不能退） |
| GET | `/camps/:id/members` | 需认证 | 成员名单（仅成员，按角色排序） |
| POST | `/camps/:id/members/:user_id` | 需认证 | 直接拉人入营（admin+，绕过 `direct_join`） |
| PUT | `/camps/:id/members/:user_id/role` | 需认证 | 升/降角色（仅 owner） |
| DELETE | `/camps/:id/members/:user_id` | 需认证 | 移出成员（admin+ 可移成员，仅 owner 可移 admin） |
| PUT | `/camps/:id/posts/:post_id/pin` | 需认证 | 营地内置顶 |
| GET | `/camps/:id/subgroups` | 公开 | 子群列表（**仅父营地成员**，其它 404） |
| POST | `/camps/:id/subgroups` | 需认证 | 创建子群（父营地 owner/admin） |

## 创建

```http
POST /camps
```

| 字段 | 说明 |
| --- | --- |
| `name` | 唯一；重复返回 `409 camp name already taken`（不是 500） |
| `description` | 可选 |
| `is_visible` | 隐藏营地只对成员列出 |
| `direct_join` | 为 `false` 时拒绝自助加入 |
| `member_post` | 默认 `true`，成员是否可发帖 |
| `member_pin` | 默认 `false`，成员是否可置顶自己的帖 |

创建者成为 **owner**，并计入其营地创建配额（基础 100，会员每级 +25%）。超出配额返回 `403` 并给出计算后的上限。

## 浏览

```http
GET /camps
GET /camps?q=关键词
GET /camps?mine=1          # 我的营地（含隐藏营地）
GET /camps/:id
```

营地载荷带 `my_role`（`owner` / `admin` / `member`）。

> 这三个读接口是 **公开但个性化** 的路由：网关会为有效 token 转发 `X-User-ID`。因此不带 token 时 `?mine=1` 无法工作、隐藏营地对 owner 也表现为不可见——客户端需保证请求带上凭据。
>
> **创建者始终被视为成员/owner**，即使 `camp_members` 行缺失（历史营地）：`GET /camps` 与 `?mine=1` 都会回退到 `creator_id`，owner 不会被判定为非成员。

## 成员与角色

角色层级：`owner`（创建者）> `admin` > `member`，存于 `camp_members.role`。

| 操作 | 规则 |
| --- | --- |
| 加入 | `POST /camps/:id/join`，需营地 `direct_join` 为真；隐藏营地直接拒绝 |
| 直接拉人 | `POST /camps/:id/members/:user_id`，admin+，绕过 `direct_join` |
| 升/降角色 | `PUT /camps/:id/members/:user_id/role`，**仅 owner**，且 owner 自身角色不可改 |
| 移出 | `DELETE /camps/:id/members/:user_id`：admin+ 可移成员，仅 owner 可移 admin，无人可移 owner |
| 退出 | `DELETE /camps/:id/members/me`：creator 不能退出 |

## 营地设置

```http
PUT /camps/:id
```

- **admin** 可改 `name` / `description` / `is_visible` / `direct_join`；
- **`member_post` / `member_pin` 仅 owner 可改**；
- 改名同样受唯一约束（重复 → `409`）。

## 营地发帖

发帖仍走普通接口，带 `camp_id`：

```http
POST /posts
{ "content": "...", "camp_id": 66 }
```

- **必须先是营地成员**，否则 `403 {"error":"join the camp before posting into it"}`；
- 营地关闭 `member_post` 时，只有 owner/admin 能发（`403 {"error":"only camp admins may post in this camp"}`）。

营地帖子：

- 不出现在全局时间线；
- 对非成员的档案、收藏、引用一律屏蔽；
- **营地 owner 与 admin 能看到营地内所有帖子**（无论帖子自身 `visibility`），因为他们负责管理；普通成员只看到可见性允许的帖子。

营地帖的置顶用 `camp_pinned` 标记，只在营地内浮到顶部。

## 删除

```http
DELETE /camps/:id
```

**仅 creator 可删**。删除是事务操作：

- 私有营地（及全部子群）的帖子会被先删除；
- 公有营地的帖子会变成全局帖子（`posts.camp_id` 为 `ON DELETE SET NULL`，裸删除会把私有营地的帖子重新发布到全局，所以必须显式清理）；
- 子群随父营地级联删除。

## 子群（私有嵌套营地）

`camps.parent_camp_id` 把营地挂到另一个营地之下。子群是**结构上私有**，而非靠配置：

- 创建时强制 `is_visible=false`、`direct_join=false`，`PUT /camps/:id` 也会重新强制，因此无法把子群公开或开放自助加入；
- 因而沿用隐藏营地规则：非成员 `GET /camps/:id` 得 `404`，`POST /camps/:id/join` 直接拒绝；
- 子群不出现在 `GET /camps`（该接口过滤 `parent_camp_id IS NULL`）。

| 规则 | 说明 |
| --- | --- |
| 创建 | `POST /camps/:id/subgroups`，`name` + 可选 `description`；**仅父营地 owner/admin** |
| 层级 | 父营地必须是顶级营地，嵌套**只有一层**，子群不能再有子群 |
| 归属 | 创建者成为子群 owner；**不占用**营地创建配额（由父营地成员名单界定） |
| 列表 | `GET /camps/:id/subgroups`，仅父营地成员；其它人得与非成员看隐藏营地相同的 `404` |
| 拉人 | `POST /camps/:id/members/:user_id` 对子群生效时，目标**必须已是父营地成员**，否则 `403` |
| 删除 | 随父营地级联删除 |

## 常见错误

| 状态 | 场景 |
| --- | --- |
| `403` | 缺权限、非成员读营地帖、未加入营地就发营地帖、子群拉非父营地成员 |
| `404` | 营地/子群不存在，或隐藏营地对非成员 |
| `409` | 营地名重复（创建或改名） |
| `403`（配额） | 营地创建数超过配额（附计算后的 limit） |