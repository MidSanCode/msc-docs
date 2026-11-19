---
title: 附件与存储
description: 附件上传（含分块）、按哈希复用、预览图、阅后即焚、对象代理路径、配额与多桶存储。
sidebar:
  order: 9
---

文件存放在 RustFS（S3 兼容）对象存储中，`pkg/storage` 封装上传/删除/URL 生成。每个用户有总存储配额，头像与横幅上传也计入其中。

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/attachments` | `storage.upload` | 上传（`multipart/form-data`，字段名 **`file`**） |
| GET | `/attachments?limit=` | `storage.list` | 我的附件 |
| GET | `/attachments/:id` | 公开 | 单个附件元数据（非公开对象仅 owner 可取） |
| GET | `/attachments/by-hash/:hash` | 需认证 | 按内容哈希复用已有上传 |
| POST | `/attachments/:id/burn-arm` | `storage.get` | 设置阅后即焚 |
| DELETE | `/attachments/:id` | `storage.delete` | 删除 |
| POST | `/attachments/chunk/init` | `storage.upload` | 分块上传：初始化 |
| POST | `/attachments/chunk/:upload_id/:index` | `storage.upload` | 分块上传：送第 N 块 |
| GET | `/attachments/chunk/:upload_id` | `storage.upload` | 分块上传：查询进度 |
| POST | `/attachments/chunk/:upload_id/complete` | `storage.upload` | 分块上传：合并 |
| GET | `/storage/usage` | `storage.list` | 已用字节数 |
| GET | `/users/storage-buckets` | 需认证 | 存储桶清单 |
| PUT | `/users/me/storage-bucket` | 需认证 | 切换存储桶 |

## 普通上传

```http
POST /attachments
Content-Type: multipart/form-data
file=<文件>
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

拿到 `id` 后，放进帖子的 `attachment_ids` 或消息的 `attachment_ids` 即可引用。

- 缺 `file` 字段 → `400 {"error":"missing file field"}`；
- 超出配额 → `413 storage quota exceeded`；
- 存储未配置时 → `503`（删除同样 `503`，不会崩）。

## 预览图

图片上传会额外生成两张衍生图：

| 产物 | 规格 |
| --- | --- |
| `preview_url` | 1440px JPEG，质量 82，key 为 `<key>.preview.jpg` |
| 缩略图 | 512px |
| `thumb_url` | 缩略图的公开地址 |

客户端用预览图快速浏览，原图按需再取。预览图随附件一起删除（手动删除、分块去重丢弃、阅后即焚清扫）。

## 按哈希复用

```http
GET /attachments/by-hash/<sha256>
```

云端已有同样内容时直接复用，免得上行重复传输。命中返回附件对象，未命中返回相应错误。

## 阅后即焚

```http
POST /attachments/:id/burn-arm
```

设置后由清扫器在到期时删除对象。因为**具有破坏性**，除所有权与接收方校验外，还要求 `storage.get` 权限。消息层面的对应字段是 `burn_seconds`（`0` 或 `5..86400`）。

## 分块上传（大文件）

```http
POST /attachments/chunk/init
{ "filename": "video.mp4", "size": 104857600, "total_chunks": 10,
  "mime_type": "video/mp4", "visibility": "private" }
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `filename` | ✅ | 原始文件名 |
| `size` | ✅ | 总字节数，须 > 0 |
| `total_chunks` | ✅ | 分块数，须 > 0 |
| `mime_type` |  | MIME |
| `visibility` |  | 可见性 |

返回 `upload_id`，随后：

```http
GET  /attachments/chunk/:upload_id            # 查询已上传的分块进度
POST /attachments/chunk/:upload_id/:index     # 上传第 index 块（从 0 起）
POST /attachments/chunk/:upload_id/complete   # 合并，返回附件对象
```

上传会话归发起者所有，其他用户无法操作。工作对象（`chunks/...`）**永不被外部暴露**。

## 配额

- 每用户 `storage_quota`（默认 100 MB，可由管理员调整或经会员加成）；
- 强制的是**有效配额** = 基础配额 + 生效中的会员加成；
- 上传超限 `413`；
- 会员到期后若已用空间高于基础配额，**在上传被拒**的状态下直到用量降回基础配额以下。

## 多桶存储

每个**逻辑桶**映射到独立的物理 S3 桶，用户被分配到一个逻辑桶。

```http
GET /users/storage-buckets
```

| 返回字段 | 说明 |
| --- | --- |
| `name` | 逻辑桶 id（客户端只认这个） |
| `label` | 展示名 |
| `default_quota` | 该桶默认配额（字节） |
| `min_member_level` | 所需最低会员等级，`0` 表示所有人 |
| `is_default` | 是否默认桶 |
| `locked` | 当前用户是否可用 |
| `current` | 用户当前所在桶 |

```http
PUT /users/me/storage-bucket
{ "bucket": "star" }
```

- 未知桶 `400`，会员等级不足 `403`；
- 切换后配额重置为目标桶的 `default_quota`；
- **已有附件不迁移**，其记录保留原桶，删除仍解析到正确物理存储；
- 会员加成配额**只在默认桶生效**。

配置侧规则：应恰好一个桶标 `is_default: true`（都没有时第一个被当作默认）；桶级 `public_base_url` 覆盖共享配置。

## 对象访问路径

### 直连桶（默认）

附件 URL 直接指向桶主机，因此桶必须允许匿名读。

### 内部代理模式（私有桶）

```yaml
storage:
  public_base_url: "https://api.example.com/api/v1/files"
  internal_proxy:
    enabled: true
```

生成的 URL 变成 `<public_base_url>/<物理桶>/<object-key>`，由 `GET /api/v1/files/<bucket>/<key>` 提供，**桶可以完全私有**：

- 该路径在网关 `NoRoute` 中特判，**只解析 JWT**——**bot token 在此等价于匿名**，读不到私有对象；
- 同时提供缩略图（`<key>.thumb.jpg`，与父对象相邻存放）；
- 支持单区间请求（`206 Partial Content`），媒体播放器可拖动；
- 响应带长期不可变缓存头；
- 上传的临时分块对象不暴露。

> **bot 读取私有附件**必须走服务自己的路由，例如 `GET /api/v1/conversations/:id/files`（在路由表中，认 bot token）。

### URL 是上传时写死的

`attachments.url` / `thumb_url` 在**上传时**由当时的 `public_base_url` 生成并持久化。之后改配置**不会**重写历史行：老附件继续用老主机，新上传才用新主机。对象本身没问题，只是链接过期。

迁移存储域名后需一次性改写历史行（例：从本地 RustFS 换到域名）：

```sql
UPDATE attachments SET
  url       = REPLACE(url,       'http://127.0.0.1:9000/openfield', 'https://io.example.com/openfield'),
  thumb_url = REPLACE(thumb_url, 'http://127.0.0.1:9000/openfield', 'https://io.example.com/openfield')
WHERE url LIKE 'http://127.0.0.1:9000/%' OR thumb_url LIKE 'http://127.0.0.1:9000/%';
```

请在服务停机或静默期执行，避免与新上传竞争。注意**环境变量会覆盖 YAML**（`STORAGE_ENDPOINT`、`STORAGE_PUBLIC_BASE_URL` 等），一个陈旧的 env var 会悄悄赢过配置文件——存储“看起来没配置”时先查 storage 服务启动日志。

## 常见错误

| 状态 | 场景 |
| --- | --- |
| `400` | 缺 `file` 字段；分块参数非法 |
| `403` | 非 owner 取私有附件；缺 `storage.*` 权限 |
| `404` | 附件不存在，或对当前身份不可见 |
| `413` | 超出存储配额 |
| `503` | 对象存储未配置 |