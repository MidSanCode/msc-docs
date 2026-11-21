---
title: Camps and Subgroups
description: Forum-style camps, including creation, browsing, member and role management, camp settings, private subgroups, and cascading deletion.
sidebar:
  order: 6
---

A camp is a forum-style community space: its posts belong to the camp and do not appear in the global timeline. Camps can contain nested **private subgroups**.

## Endpoint overview

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/camps` | Public | Camp directory (`?q=` search, `?mine=1` my camps) |
| POST | `/camps` | Authenticated | Create a camp (quota applies) |
| GET | `/camps/:id` | Public | Camp details (hidden camps return 404 to non-members) |
| PUT | `/camps/:id` | Authenticated | Update camp (admin edits basic fields; owner edits permission toggles) |
| DELETE | `/camps/:id` | Authenticated | Delete camp (**creator only**) |
| GET | `/camps/:id/posts` | Public | Camp posts (**members only**; hidden camps return 404 to non-members) |
| PUT | `/camps/:id/announcement` | Authenticated | Camp announcement (admin+) |
| POST | `/camps/:id/join` | Authenticated | Join (requires `direct_join`) |
| DELETE | `/camps/:id/members/me` | Authenticated | Leave (creator cannot leave) |
| GET | `/camps/:id/members` | Authenticated | Member list (members only, sorted by role) |
| POST | `/camps/:id/members/:user_id` | Authenticated | Add a user directly (admin+; bypasses `direct_join`) |
| PUT | `/camps/:id/members/:user_id/role` | Authenticated | Promote/demote a role (owner only) |
| DELETE | `/camps/:id/members/:user_id` | Authenticated | Remove a member (admin+ can remove members; only owner can remove admins) |
| PUT | `/camps/:id/posts/:post_id/pin` | Authenticated | Pin within a camp |
| GET | `/camps/:id/subgroups` | Public | Subgroup list (**parent-camp members only**; others receive 404) |
| POST | `/camps/:id/subgroups` | Authenticated | Create a subgroup (parent-camp owner/admin) |

## Create a camp

```http
POST /camps
```

| Field | Description |
| --- | --- |
| `name` | Must be unique; duplicates return `409 camp name already taken` (not 500) |
| `description` | Optional |
| `is_visible` | Hidden camps are listed only to members |
| `direct_join` | When `false`, self-service joining is denied |
| `member_post` | Defaults to `true`; whether members may post |
| `member_pin` | Defaults to `false`; whether members may pin their own posts |

The creator becomes the **owner** and the camp counts toward their camp-creation quota (base 100, increased by 25% per membership level). Exceeding the quota returns `403` and the calculated limit.

## Browse camps

```http
GET /camps
GET /camps?q=keyword
GET /camps?mine=1          # My camps (including hidden camps)
GET /camps/:id
```

Camp payloads include `my_role` (`owner` / `admin` / `member`).

> These three read endpoints are **public but personalized** routes: for a valid token, the gateway forwards `X-User-ID`. Without a token, `?mine=1` cannot work, and hidden camps also appear invisible to their owners—the client must ensure the request includes credentials.
>
> **The creator is always treated as a member/owner**, even if the `camp_members` row is missing (legacy camps): `GET /camps` and `?mine=1` both fall back to `creator_id`, so the owner is not treated as a non-member.

## Members and roles

Role hierarchy: `owner` (creator) > `admin` > `member`, stored in `camp_members.role`.

| Operation | Rule |
| --- | --- |
| Join | `POST /camps/:id/join`; requires the camp's `direct_join` to be true; hidden camps reject joining directly |
| Add directly | `POST /camps/:id/members/:user_id`; admin+; bypasses `direct_join` |
| Promote/demote | `PUT /camps/:id/members/:user_id/role`; **owner only**, and the owner's own role cannot be changed |
| Remove | `DELETE /camps/:id/members/:user_id`: admin+ can remove members; only the owner can remove admins; no one can remove the owner |
| Leave | `DELETE /camps/:id/members/me`: the creator cannot leave |

## Camp settings

```http
PUT /camps/:id
```

- **Admins** can change `name` / `description` / `is_visible` / `direct_join`.
- **Only the owner can change `member_post` / `member_pin`**.
- Names must remain unique when changed (duplicate → `409`).

## Posting in a camp

Posts still use the regular endpoint, with `camp_id`:

```http
POST /posts
{ "content": "...", "camp_id": 66 }
```

- **You must be a camp member first**, or the response is `403 {"error":"join the camp before posting into it"}`.
- When the camp has disabled `member_post`, only the owner/admin can post (`403 {"error":"only camp admins may post in this camp"}`).

Camp posts:

- Do not appear in the global timeline.
- Are hidden from non-members' profiles, favorites, and quotes.
- **Camp owners and admins can see all posts in the camp**, regardless of each post's own `visibility`, because they are responsible for managing it; regular members see only posts allowed by visibility settings.

Camp posts use the `camp_pinned` flag to pin them to the top within the camp only.

## Delete a camp

```http
DELETE /camps/:id
```

**Only the creator can delete a camp.** Deletion is transactional:

- Posts in private camps (and all subgroups) are deleted first.
- Posts in public camps become global posts (`posts.camp_id` is `ON DELETE SET NULL`; a bare delete would republish private-camp posts globally, so they must be explicitly cleaned up).
- Subgroups are deleted in a cascade with the parent camp.

## Subgroups (private nested camps)

`camps.parent_camp_id` places a camp under another camp. Subgroups are **structurally private**, rather than private by configuration:

- On creation, `is_visible=false` and `direct_join=false` are enforced. `PUT /camps/:id` enforces them again, so a subgroup cannot be made public or opened to self-service joining.
- Therefore, hidden-camp rules apply: a non-member gets `404` from `GET /camps/:id`, and `POST /camps/:id/join` is rejected directly.
- Subgroups do not appear in `GET /camps` (that endpoint filters on `parent_camp_id IS NULL`).

| Rule | Description |
| --- | --- |
| Create | `POST /camps/:id/subgroups`, with `name` and optional `description`; **parent-camp owner/admin only** |
| Hierarchy | The parent camp must be top-level; nesting is limited to **one level**, and a subgroup cannot itself have subgroups |
| Ownership | The creator becomes subgroup owner; **does not count toward** the camp-creation quota (membership is bounded by the parent camp's member list) |
| List | `GET /camps/:id/subgroups`, parent-camp members only; others receive the same `404` as non-members viewing a hidden camp |
| Add members | When `POST /camps/:id/members/:user_id` is used for a subgroup, the target **must already be a member of the parent camp**, or the response is `403` |
| Delete | Deleted in a cascade with the parent camp |

## Common errors

| Status | Scenario |
| --- | --- |
| `403` | Missing permission, non-member reads camp posts, posts to a camp before joining, or adds a subgroup member who is not a parent-camp member |
| `404` | Camp/subgroup does not exist, or a hidden camp is requested by a non-member |
| `409` | Duplicate camp name (on creation or rename) |
| `403` (quota) | Number of created camps exceeds quota (includes calculated `limit`) |
