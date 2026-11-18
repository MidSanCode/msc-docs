---
title: LGDF 通用数据格式标准 v1.0.1
description: 分层通用数据格式（Layered Generic Data Format）v1.0.1 规范全文：资源层、描述层、元数据层、核心配置、签名与校验、导出/导入。
sidebar:
  order: 1
---

> **版本**：v1.0.1 ｜ **发布日期**：2026-09-12 ｜ **配套 SDK**：`lgdf-sdk`（Python，v1.0.1）｜ **配套示例工程**：`example`

本文档定义 **LGDF（Layered Generic Data Format，分层通用数据格式）**。LGDF 是一种通用文件格式，把二进制工程文件拆解为两类内容并分层组织：**资源（assets）** 与 **描述（spec）**，另设 **元数据层（metadata）** 与 **核心配置（info.json）**，分别承担「资源档案」与「工程身份证」的职责。

由此获得的能力：

- **资源与描述解耦**：描述可被读取器、工具链、脚本直接解析，无需理解二进制格式；
- **结构化归档**：每个资源自带哈希、尺寸、分类等信息，可独立校验与检索；
- **导出/导入**：通过导出为压缩包（扩展名可自定义）实现跨机器分发；
- **密码学签名**：作者签名使用 RSA/ECC 算法，时间戳签名由公共签名提供商签发。

## 1. 术语与标识

### 1.1 术语

| 术语 | 含义 |
| --- | --- |
| 资源（asset） | `assets/` 下的一个具体文件（图片/音频/模型等） |
| 注册（registered） | 资源在 `registry.json` 中登记，且存在对应元数据 |
| 镜像（mirror） | `metadata/` 对 `assets/` 目录树的一一映射 |
| 导出（export） | 将工程打包为压缩包（ZIP 格式，扩展名可自定义） |
| 导入（import） | 从压缩包恢复为目录模式工程 |
| SDK（读取器/写入器） | 实现本规范的解析/生成程序 |

### 1.2 标识与识别

| 项目 | 值 |
| --- | --- |
| 格式标识（info.json 的 `format`） | `"lgdf"` |
| 压缩包魔数 | ZIP 头 `50 4B 03 04`（`PK\x03\x04`） |
| 压缩包扩展名 | 可自定义（如 `.lgdf`、`.zip`、`.proj` 等） |
| SDK 版本 | 当前规范对应 SDK 1（`min_sdk` 语义见 §4） |

## 2. 顶层结构

### 2.1 目录模式（工程形态）

LGDF 工程**始终以目录模式存在**：

```
example/                          工程根目录
├── info.json                     [必填] 核心配置（工程身份证）
├── registry.json                 [必填] 注册资源清单
├── assets/                       [必填] 资源层：图片/音频/模型……
│   ├── images/        a.jpg  b.svg  c.png
│   ├── audios/        a.mp3  b.wav
│   └── models/        cube.obj
├── metadata/                     [必填] 元数据层：与 assets/ 一一镜像
│   ├── images/        a.jpg.json  b.svg.json  c.png.json
│   ├── audios/        a.mp3.json  b.wav.json
│   └── models/        cube.obj.json
├── spec/                         [可选] 描述层：步骤/配置/具体信息
│   ├── overview.md
│   ├── steps.json
│   ├── config.json
│   └── config.schema.json
├── work/                         [可选] 工作区：SDK 临时文件，永不导出
├── dist/                         [可选] 发布目录：存放导出包
├── .lgdfignore                   [可选] 附加排除规则（语法同 gitignore）
└── lgdf-standard.md / LICENSE    [可选] 规范只读文档（不参与导出）
```

### 2.2 根目录规则

工程根目录合法条目仅限：

1. `info.json`（必填）、`registry.json`（必填）、`assets/`（必填）、`metadata/`（必填）、`spec/`（可选）；
2. 非打包目录 `work/`、`dist/`（允许存在，导出时排除）；
3. 可选文件 `.lgdfignore`；
4. 规范配套只读文档（如 `lgdf-standard.md`、`LICENSE`），不计入工程数据。

路径约定：**所有内部路径一律使用 `/` 分隔、相对路径、无前导斜杠**。

### 2.3 导出/导入机制

- **导出**：将目录模式工程打包为 ZIP 压缩包，扩展名由用户指定（如 `.lgdf`、`.zip`、`.proj`）；
- **导入**：从压缩包解包恢复为目录模式工程，同时校验完整性。

压缩包内部结构与目录模式完全一致（`info.json` + `registry.json` + `assets/` + `metadata/` + `spec/`）。

## 3. 编码与命名规范

- **文本类型资源**（`type` 为 `text` 的文件）：**必须使用 UTF-8 编码**（可含 BOM）；
- JSON 文件：UTF-8（无 BOM），缩进建议 **Tab**；JSON 键均为小写下划线风格（snake_case）；
- 工程名 `name`：`^[a-z0-9_-]+$`，小写；资源文件名建议小写、用 `-`/`_` 分隔；
- `assets/` 内禁止：符号链接、绝对路径引用、`..` 上级跳转。

### 3.1 资源格式推荐

**推荐使用标准文件格式，而非自定义二进制格式。**

| 分类 | 推荐格式 | 扩展名 | 建议 MIME |
| --- | --- | --- | --- |
| 图片 | PNG / JPEG / SVG / WebP | `.png` `.jpg` `.svg` `.webp` | `image/png` `image/jpeg` `image/svg+xml` `image/webp` |
| 音频 | WAV / OGG / FLAC / MP3 | `.wav` `.ogg` `.flac` `.mp3` | `audio/wav` `audio/ogg` `audio/flac` `audio/mpeg` |
| 视频 | MP4 / WebM | `.mp4` `.webm` | `video/mp4` `video/webm` |
| 模型 | glTF / OBJ / STL | `.gltf` `.glb` `.obj` `.stl` | `model/gltf+json` `model/gltf-binary` `text/plain` |
| 文本 | UTF-8 文本 | `.txt` `.md` `.json` `.yaml` `.toml` | `text/*` |
| 字体 | WOFF2 / TTF / OTF | `.woff2` `.ttf` `.otf` | `font/woff2` `font/ttf` |

> 自定义二进制格式应作为最后手段；若必须使用，应在 `metadata` 的 `extra` 字段或 `spec/` 中提供格式说明。

### 3.2 描述层格式推荐

**推荐使用人类可读的文本格式（JSON、TOML、YAML、Markdown 等）。**

| 文件 | 推荐格式 | 说明 |
| --- | --- | --- |
| `spec/overview.md` | Markdown | 工程概述、使用说明 |
| `spec/steps.json` | JSON | 步骤定义（结构化） |
| `spec/config.json` | JSON | 运行配置（可用 schema 校验） |
| `spec/config.schema.json` | JSON Schema | 配置校验规则 |

## 4. info.json（核心配置）

### 4.1 字段规范

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `format` | string | 是 | — | 固定为 `"lgdf"`，读取器据此识别 |
| `min_sdk` | int | 是 | — | 读取所需的最低 SDK 版本 |
| `name` | string | 是 | — | 工程标识名，`^[a-z0-9_-]+$` |
| `display_name` | string | 否 | name | 人类可读的显示名 |
| `description` | string | 否 | `""` | 工程简介 |
| `author` | string | 否 | — | 作者/维护者 |
| `author_sign` | object | 否 | — | 作者签名（RSA/ECC，见 §4.3） |
| `license` | string | 否 | — | 许可证 SPDX 标识 |
| `tags` | string[] | 否 | `[]` | 标签 |
| `created_time` | int | 是 | — | 创建时间，Unix 秒（UTC） |
| `last_update_time` | int | 是 | — | 最后更新时间，Unix 秒；须 `>= created_time` |
| `version` | int | 是 | — | 工程版本号，`>= 1`，每次发布递增 |
| `extra` | object | 否 | `{}` | 扩展字段容器 |

### 4.2 示例

```json
{
	"format": "lgdf",
	"min_sdk": 1,
	"name": "example",
	"display_name": "LGDF 示例工程",
	"description": "演示 LGDF 通用数据格式的示例工程。",
	"author": "a human",
	"license": "CC0-1.0",
	"tags": ["example", "tutorial", "lgdf"],
	"created_time": 1788963970,
	"last_update_time": 1789193378,
	"version": 1
}
```

### 4.3 作者签名（author_sign）

作者签名**必须使用 RSA 或 ECC 算法**，对工程关键字段进行签名，确保工程来源可信。

**签名对象**：以下字段的 JSON 规范序列化（UTF-8、键按字母序排列、无空白）：

```json
{"format":"lgdf","min_sdk":2,"name":"example","registered_files":["assets/audios/a.mp3","assets/images/a.jpg"],"version":1}
```

**签名格式**：

```json
{
	"algorithm": "RSA-SHA256",
	"public_key": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg...\n-----END PUBLIC KEY-----",
	"signature": "base64编码的签名值",
	"signed_at": 1789193378
}
```

| 字段 | 说明 |
| --- | --- |
| `algorithm` | `RSA-SHA256`、`RSA-SHA512`、`ECDSA-P256-SHA256`、`ECDSA-P384-SHA384` |
| `public_key` | 公钥（PEM 格式） |
| `signature` | 签名值（Base64） |
| `signed_at` | 签名时间（Unix 秒） |

**验证流程**：

1. 读取 `registry.json` 中的 `registered_files`；
2. 与 `info.json` 的 `format`、`min_sdk`、`name`、`version` 组装；
3. 按字母序键排序、UTF-8、无空白 JSON 序列化；
4. 使用 `public_key` 验证 `signature`。

## 5. registry.json（注册资源清单）

### 5.1 字段规范

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `registered_files` | string[] | 是 | 注册资源清单，`/` 分隔，建议排序 |
| `asset_count` | int | 否 | 资源总数（应与 `registered_files` 长度一致） |
| `timestamp_sign` | object | 否 | 公共 TSA 时间戳签名（见 §5.2） |
| `extra` | object | 否 | 扩展字段 |

### 5.2 时间戳签名（timestamp_sign）

由**公共签名提供商**（RFC 3161 TSA）签发，证明资源在某个时间点已存在。

```json
{
	"tsa_url": "http://timestamp.digicert.com",
	"token": "MIIG...",
	"signed_at": 1789193378
}
```

| 字段 | 说明 |
| --- | --- |
| `tsa_url` | TSA 服务地址 |
| `token` | RFC 3161 时间戳令牌（Base64） |
| `signed_at` | 签发时间（Unix 秒） |

## 6. assets/ 资源层

- 建议按大类分子目录：`images/`、`audios/`、`videos/`、`models/`、`fonts/`；
- 每个文件都必须：被 `registry.json` 登记，且存在默认元数据文件；
- **文本类型资源（`type` 为 `text`）必须使用 UTF-8 编码**；
- 推荐使用标准文件格式（见 §3.1）。

## 7. metadata/ 元数据层

### 7.1 镜像规则

`assets/<相对路径>` ⇄ `metadata/<相对路径>.json`

### 7.2 公共字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 资源相对路径 |
| `type` | string | 是 | `image`、`audio`、`video`、`model`、`text`、`binary`、`other` |
| `mime` | string | 否 | MIME 类型 |
| `format` | string | 否 | 格式标识 |
| `size` | int | 是 | 字节数 |
| `sha256` | string | 是 | SHA-256（**全小写十六进制**） |
| `hash_algorithm` | string | 否 | 固定 `sha256` |
| `created_time` | int | 是 | 创建时间 |
| `last_update_time` | int | 是 | 最后修改时间 |
| `extra` | object | 否 | 扩展字段 |

### 7.3 分类可选字段

| type | 字段 | 示例 |
| --- | --- | --- |
| `image` | `width`、`height` | `2160, 2160` |
| `audio` | `duration_seconds`、`sample_rate`、`channels`、`bit_depth` | `1.0, 44100, 1, 16` |
| `model` | `vertices`、`triangles` | `8, 12` |
| `text` | `encoding`（固定 `"utf-8"`） | `"utf-8"` |

### 7.4 元数据示例

```json
{
	"path": "assets/images/icon.png",
	"type": "image",
	"mime": "image/png",
	"format": "png",
	"size": 224566,
	"sha256": "c4e870d358d64ce677e958c156d0e3fba466993d8e915fc81c5dc64937a9b696",
	"hash_algorithm": "sha256",
	"created_time": 1794837041,
	"last_update_time": 1794837041,
	"width": 800,
	"height": 600,
	"extra": {
		"license": "CC0-1.0 / Public Domain",
		"source": "Wikimedia Commons: PNG transparency demonstration"
	}
}
```

## 8. spec/ 描述层

| 文件 | 推荐格式 | 内容 |
| --- | --- | --- |
| `overview.md` | Markdown | 工程概述 |
| `steps.json` | JSON | 步骤（id/name/description/inputs/outputs/params） |
| `config.json` | JSON | 运行配置 |
| `config.schema.json` | JSON Schema | 配置校验 |

## 9. 导出/导入

### 9.1 导出

1. 全量校验（§10），失败则拒绝；
2. 收集：`info.json` + `registry.json` + `assets/**` + `metadata/**` + `spec/**`；
3. 路径 `/` 分隔，Deflate 压缩；
4. 计算 SHA-256，写 `<包名>.sha256` 伴生文件；
5. 扩展名用户指定。

### 9.2 导入

1. 只接受标准条目，拒绝 `..`（zip-slip 防护）；
2. 解包到目标目录；
3. 全量校验。

## 10. 校验流程

```
1 识别      info.json 存在且 format == "lgdf"
2 门槛      min_sdk <= 读取器版本
3 注册表    registry.json 存在，registered_files 非空无重复
4 文本编码  type=="text" 的资源必须为合法 UTF-8
5 注册核对  每个 registered_file：资源存在、元数据存在、path 一致、sha256 匹配、size 匹配
6 双向镜像  无游离资源、无孤儿元数据
7 作者签名  author_sign 存在时按 §4.3 验证
8 时间戳    timestamp_sign 存在时按 §5.2 验证
9 描述层    spec/ 存在时解析
```

## 11. 配套 SDK（lgdf-sdk）

官方 Python 解析器库（`F:\exeliang\lgdf-sdk`，纯标准库，零必选依赖，Python ≥ 3.8；签名需 `cryptography`，schema 校验需 `jsonschema`）。

### 11.1 API 速查

| 方法 | 说明 |
| --- | --- |
| `create(name, path)` | 创建空工程 |
| `open(path)` | 读取目录工程 |
| `add_asset(rel, source/data, properties)` | 注册资源 |
| `replace_asset(rel, source/data)` | 替换资源 |
| `remove_asset(rel)` | 注销资源 |
| `read_asset(rel)` / `get_metadata(rel)` | 读取 |
| `set_config` / `set_steps` / `set_overview` | 描述层 |
| `sign(private_key, algorithm)` | RSA/ECC 签名 |
| `verify_sign()` | 验证签名 |
| `validate()` | 全量校验 |
| `export(out_path)` | 导出为压缩包 |
| `import_from(source, dest)` | 从压缩包导入 |
| `bump_version()` / `save()` | 版本管理 |

### 11.2 CLI

```bash
python -m lgdf create   ./demo --name demo
python -m lgdf add      ./demo images/a.png ./a.png
python -m lgdf remove   ./demo images/a.png
python -m lgdf list     ./demo
python -m lgdf info     ./demo
python -m lgdf validate ./demo
python -m lgdf export   ./demo -o dist/demo.lgdf
python -m lgdf import   dist/demo.lgdf ./restored
```

## 12. 版本历史

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 1.0 | 2026-09-12 | 初版 |
| 1.0.1 | 2026-09-12 | 移除单文件模式；新增导出/导入；拆分 registry.json；RSA/ECC 签名；公共 TSA 时间戳；文本 UTF-8 强制；推荐标准格式 |