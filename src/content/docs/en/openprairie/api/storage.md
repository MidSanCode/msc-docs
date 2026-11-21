---
title: Attachments and Storage
description: Attachment uploads (including chunked uploads), reuse by hash, previews, burn-after-reading, object proxy paths, quotas, and multi-bucket storage.
sidebar:
  order: 9
---

Files are stored in RustFS (S3-compatible) object storage; `pkg/storage` wraps uploads, deletion, and URL generation. Each user has a total storage quota, which also includes avatar and banner uploads.

## Endpoint overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/attachments` | `storage.upload` | Upload (`multipart/form-data`, field name **`file`**) |
| GET | `/attachments?limit=` | `storage.list` | My attachments |
| GET | `/attachments/:id` | Public | Metadata for one attachment (non-public objects are accessible only to the owner) |
| GET | `/attachments/by-hash/:hash` | Auth required | Reuse an existing upload by content hash |
| POST | `/attachments/:id/burn-arm` | `storage.get` | Arm burn-after-reading |
| DELETE | `/attachments/:id` | `storage.delete` | Delete |
| POST | `/attachments/chunk/init` | `storage.upload` | Chunked upload: initialize |
| POST | `/attachments/chunk/:upload_id/:index` | `storage.upload` | Chunked upload: send chunk N |
| GET | `/attachments/chunk/:upload_id` | `storage.upload` | Chunked upload: query progress |
| POST | `/attachments/chunk/:upload_id/complete` | `storage.upload` | Chunked upload: merge |
| GET | `/storage/usage` | `storage.list` | Bytes used |
| GET | `/users/storage-buckets` | Auth required | Storage bucket list |
| PUT | `/users/me/storage-bucket` | Auth required | Switch storage bucket |

## Regular upload

```http
POST /attachments
Content-Type: multipart/form-data
file=<file>
```

```json
{
  "id": 1,
  "user_id": 1,
  "original_name": "photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 12345,
  "url": "http://localhost:9000/openfield/2026/01/01/uuid.jpg",
  "created_at": "..."
}
```

Once you have the `id`, reference it in a post's `attachment_ids` or a message's `attachment_ids`.

- Missing `file` field → `400 {"error":"missing file field"}`;
- Quota exceeded → `413 storage quota exceeded`;
- Storage not configured → `503` (deletion also returns `503`, without crashing).

## Previews

Image uploads generate two additional derivative images:

| Output | Specification |
| --- | --- |
| `preview_url` | 1440px JPEG, quality 82, with key `<key>.preview.jpg` |
| Thumbnail | 512px |
| `thumb_url` | Public URL of the thumbnail |

Clients use previews for fast browsing and retrieve the original image on demand. Previews are deleted together with their attachment (manual deletion, discarding duplicate chunked uploads, or burn-after-reading cleanup).

## Reuse by hash

```http
GET /attachments/by-hash/<sha256>
```

If identical content already exists in cloud storage, reuse it directly to avoid uploading it again. A hit returns the attachment object; a miss returns the corresponding error.

## Burn-after-reading

```http
POST /attachments/:id/burn-arm
```

Once armed, a cleanup job deletes the object when it expires. Because this is **destructive**, it requires `storage.get` permission in addition to ownership and recipient validation. The corresponding message-level field is `burn_seconds` (`0` or `5..86400`).

## Chunked uploads (large files)

```http
POST /attachments/chunk/init
{ "filename": "video.mp4", "size": 104857600, "total_chunks": 10,
  "mime_type": "video/mp4", "visibility": "private" }
```

| Field | Required | Description |
| --- | --- | --- |
| `filename` | ✅ | Original filename |
| `size` | ✅ | Total bytes; must be > 0 |
| `total_chunks` | ✅ | Number of chunks; must be > 0 |
| `mime_type` |  | MIME |
| `visibility` |  | Visibility |

Returns `upload_id`, then:

```http
GET  /attachments/chunk/:upload_id            # Query progress of uploaded chunks
POST /attachments/chunk/:upload_id/:index     # Upload chunk index (starting at 0)
POST /attachments/chunk/:upload_id/complete   # Merge and return the attachment object
```

The upload session belongs to its initiator; other users cannot operate on it. Working objects (`chunks/...`) are **never exposed externally**.

## Quotas

- Per-user `storage_quota` (100 MB by default, adjustable by administrators or increased by membership bonuses);
- The enforced **effective quota** = base quota + currently active membership bonus;
- Uploads over the limit return `413`;
- If usage exceeds the base quota after membership expires, **uploads remain denied** until usage falls below the base quota again.

## Multi-bucket storage

Each **logical bucket** maps to a separate physical S3 bucket, and each user is assigned to a logical bucket.

```http
GET /users/storage-buckets
```

| Response field | Description |
| --- | --- |
| `name` | Logical bucket id (the only identifier clients use) |
| `label` | Display name |
| `default_quota` | Default quota for this bucket (bytes) |
| `min_member_level` | Minimum required membership level; `0` means everyone |
| `is_default` | Whether this is the default bucket |
| `locked` | Whether the bucket is available to the current user |
| `current` | The user's current bucket |

```http
PUT /users/me/storage-bucket
{ "bucket": "star" }
```

- Unknown bucket: `400`; insufficient membership level: `403`;
- Switching resets the quota to the target bucket's `default_quota`;
- **Existing attachments are not migrated**. Their records retain the original bucket, and deletion still resolves to the correct physical storage;
- Membership bonus quota **applies only in the default bucket**.

Configuration rules: exactly one bucket should have `is_default: true` (if none does, the first is treated as the default); a bucket-level `public_base_url` overrides the shared configuration.

## Object access paths

### Direct bucket access (default)

Attachment URLs point directly to the bucket host, so the bucket must allow anonymous reads.

### Internal proxy mode (private buckets)

```yaml
storage:
  public_base_url: "https://api.example.com/api/v1/files"
  internal_proxy:
    enabled: true
```

Generated URLs become `<public_base_url>/<physical-bucket>/<object-key>`, served by `GET /api/v1/files/<bucket>/<key>`. **The bucket can be entirely private**:

- This path is specially handled by the gateway's `NoRoute` and **only parses JWTs**—**a bot token is equivalent to anonymous access here** and cannot read private objects;
- Thumbnails are also served (`<key>.thumb.jpg`, stored alongside the parent object);
- Single-range requests are supported (`206 Partial Content`), allowing media players to seek;
- Responses include long-lived immutable cache headers;
- Temporary upload chunk objects are not exposed.

> **Bots reading private attachments** must use a service's own route, such as `GET /api/v1/conversations/:id/files` (registered in the routing table and accepts bot tokens).

### URLs are fixed at upload time

`attachments.url` / `thumb_url` are generated from the `public_base_url` in effect **at upload time** and persisted. Later configuration changes **do not** rewrite historical rows: old attachments continue using the old host, and only new uploads use the new host. The objects themselves are intact; only the links are outdated.

After migrating the storage domain, rewrite historical rows once (for example, when moving from local RustFS to a domain):

```sql
UPDATE attachments SET
  url       = REPLACE(url,       'http://127.0.0.1:9000/openfield', 'https://io.example.com/openfield'),
  thumb_url = REPLACE(thumb_url, 'http://127.0.0.1:9000/openfield', 'https://io.example.com/openfield')
WHERE url LIKE 'http://127.0.0.1:9000/%' OR thumb_url LIKE 'http://127.0.0.1:9000/%';
```

Run this during downtime or a quiet period to avoid competing with new uploads. Note that **environment variables override YAML** (`STORAGE_ENDPOINT`, `STORAGE_PUBLIC_BASE_URL`, etc.). A stale environment variable silently takes precedence over the configuration file—if storage “appears unconfigured,” check the storage service's startup logs first.

## Error reference

| Status | Scenario |
| --- | --- |
| `400` | Missing `file` field; invalid chunk parameters |
| `403` | Non-owner requesting a private attachment; missing `storage.*` permission |
| `404` | Attachment does not exist or is not visible to the current identity |
| `413` | Storage quota exceeded |
| `503` | Object storage not configured |
