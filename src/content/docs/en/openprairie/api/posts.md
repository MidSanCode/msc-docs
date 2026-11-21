---
title: Posts and Interactions
description: Creating posts, visibility, comments, reactions, favorites, pinning, post tips, personal timelines, and favorites lists.
sidebar:
  order: 5
---

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/posts` | `posts.create` | Create a post |
| GET | `/posts?page=&limit=` | Public | Timeline (supports filters) |
| GET | `/posts/:id` | Public | Single post (records a view) |
| PUT | `/posts/:id` | `posts.edit` | Edit your own post |
| DELETE | `/posts/:id` | `posts.delete` | Delete your own post |
| PUT | `/posts/:id/pin` | Auth required | Pin (author/camp administrator) |
| GET | `/posts/:id/replies?limit=` | Public | List comments |
| POST | `/posts/:id/replies` | `posts.reply.create` | Create a comment |
| PUT | `/posts/:id/replies/:reply_id` | `posts.reply.edit` | Edit your own comment |
| DELETE | `/posts/:id/replies/:reply_id` | `posts.reply.delete` | Delete your own comment |
| PUT | `/posts/:id/reactions` | `posts.react` | Like/react |
| DELETE | `/posts/:id/reactions` | `posts.react` | Remove reaction |
| POST | `/posts/:id/favorite` | `posts.favorite` | Favorite |
| DELETE | `/posts/:id/favorite` | `posts.favorite` | Remove favorite |
| POST | `/posts/:id/tips` | Auth required | Tip (requires payment PIN) |
| POST | `/posts/:id/replies/:reply_id/favorite` | `posts.favorite` | Favorite a comment |
| DELETE | `/posts/:id/replies/:reply_id/favorite` | `posts.favorite` | Remove comment favorite |
| GET | `/users/:user_id/posts` | Public | A user's posts |
| GET | `/users/:user_id/favorites/posts` | Auth required | My favorite posts |
| GET | `/users/:user_id/favorites/replies` | Auth required | My favorite comments |

## Create a post

```http
POST /posts
```

| Field | Type | Description |
| --- | --- | --- |
| `content` | string | ≤5000 characters; at least one of `content` and `quoted_post_id` is required |
| `visibility` | string | `public` \| `login` \| `friends` \| `private`, default `public` |
| `attachment_ids` | []int64 | Up to 9; upload first |
| `check_id` | int64 | Link a red packet |
| `tags` | []string | Tags |
| `quoted_post_id` | int64 | Quote/repost |
| `camp_id` | int64 | Post to a camp; `0` or omitted = global |

Response: `201` + the post object itself.

### Visibility semantics

| Value | Who can view |
| --- | --- |
| `public` | Everyone |
| `login` | Any logged-in user |
| `friends` | Mutual-follow friends + author |
| `private` | Author only |

Camp posts add another restriction: **only camp members and the author can view them**, and they do not appear in the global timeline.

### Post payload

Includes `reply_count`, `favorite_count`, a reaction aggregation map, and denormalized author membership-level and name-style fields. When a token is supplied, it also includes the caller's own reaction/favorite state and the `pinned` flag.

## Timeline and filters

```http
GET /posts?page=1&limit=20
GET /posts?q=keyword&author=alice&tag=news&author_id=7&from=2026-01-01&to=2026-02-01
```

**Page-number pagination**: returns `{"posts":[…],"page":1}` with **no `total` or `has_more`**; an empty array indicates the end.

## Update and delete

```http
PUT /posts/:id
{ "content": "Updated text", "attachment_ids": [1, 3] }
```

`attachment_ids` **replaces the entire** existing attachment list (up to 9). **Editing does not move a post between camps.**

```http
DELETE /posts/:id
```

Only the author can delete a post. **Deleting a post does not cancel** its linked red packet (any unclaimed shares are refunded to the creator on expiry).

## Comments

```http
POST /posts/:id/replies
{ "content": "Nice post", "parent_id": null, "attachment_ids": [] }
```

- `content` is required and limited to 5000 characters.
- `parent_id` must refer to an existing comment **on the same post** (a second-level reply).
- List: `GET /posts/:id/replies?limit=50` → `{"replies":[…],"page":1}`.

## Reactions and likes

```http
PUT    /posts/:id/reactions    { "reaction": "like" }
DELETE /posts/:id/reactions
```

Available reaction keys: `like`, `dislike`, `love`, `haha`, `wow`, `sad`, `angry`. An invalid key returns `400 {"error":"unknown reaction"}`. The response is the updated post object.

## Favorites

```http
POST   /posts/:id/favorite
DELETE /posts/:id/favorite
```

Comments can also be favorited: `POST|DELETE /posts/:id/replies/:reply_id/favorite`.

Favorites lists (you can only view your own):

```http
GET /users/:user_id/favorites/posts
GET /users/:user_id/favorites/replies
```

## Pinning

```http
PUT /posts/:id/pin
{ "pinned": true }
```

- Global posts: only the **author** can pin. A pinned post moves to the top of the author's profile and the global timeline.
- Camp posts: camp **owners/admins can pin any post**; regular members can pin only their own, and only if the camp has enabled `member_pin`.
- Camp pinning also has a separate endpoint, `PUT /camps/:id/posts/:post_id/pin`, which affects ordering within the camp only.

`pinned` is a required boolean; if omitted, the endpoint returns `400`.

## Tips

```http
POST /posts/:id/tips
{ "amount": 100, "pin": "123456" }
```

- `amount` is in **coins**, in the range 1–100000.
- A payment PIN is required.
- **You cannot tip your own post** (`400 {"error":"cannot tip your own post"}`).
- The tipper pays the full amount; the author receives **95%**, and the remaining 5% is a platform fee.
- **When the post is deleted**, the corresponding 95% in the author's wallet is returned to the tipper and marked with `refunded_at`.
- Returns `404` if the post is not visible to the current user.

## Common errors

| Status | Scenario |
| --- | --- |
| `400` | Content over 5000 characters, more than 9 attachments, unknown `visibility`, unknown reaction, missing `pinned`, or tipping your own post |
| `403` | Missing `posts.*` permission; not a camp member or camp has disabled member posting |
| `404` | Post does not exist or is not visible to the current identity |
