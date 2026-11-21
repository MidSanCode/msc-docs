---
title: LGDF General Data Format Standard v1.0.1
description: "Complete specification for the Layered Generic Data Format (LGDF) v1.0.1: asset layer, description layer, metadata layer, core configuration, signing and validation, export/import."
sidebar:
  order: 1
---

> **Version**: v1.0.1 | **Release date**: 2026-09-12 | **Companion SDK**: `lgdf-sdk` (Python, v1.0.1) | **Companion example project**: `example`

This document defines **LGDF (Layered Generic Data Format)**. LGDF is a general-purpose file format that decomposes binary project files into two types of content and organizes them in layers: **assets** and **spec**. It also defines a **metadata layer** and **core configuration (`info.json`)**, which are respectively responsible for the "asset record" and the "project identity card".

This provides the following capabilities:

- **Decoupling assets and descriptions**: descriptions can be parsed directly by readers, toolchains, and scripts without understanding the binary format;
- **Structured archiving**: each asset carries information such as its hash, size, and category, and can be validated and searched independently;
- **Export/import**: cross-machine distribution is enabled by exporting to a compressed archive (with a customizable extension);
- **Cryptographic signing**: author signatures use RSA/ECC algorithms, and timestamp signatures are issued by a public signature provider.

## 1. Terms and Identifiers

### 1.1 Terms

| Term | Meaning |
| --- | --- |
| asset | A specific file under `assets/` (such as an image/audio/model) |
| registered | The asset is registered in `registry.json` and corresponding metadata exists |
| mirror | A one-to-one mapping from `metadata/` to the `assets/` directory tree |
| export | Package the project into a compressed archive (ZIP format, with a customizable extension) |
| import | Restore a directory-mode project from a compressed archive |
| SDK (reader/writer) | A parsing/generation program implementing this specification |

### 1.2 Identification and Recognition

| Item | Value |
| --- | --- |
| Format identifier (`format` in `info.json`) | `"lgdf"` |
| Archive magic number | ZIP header `50 4B 03 04` (`PK\x03\x04`) |
| Archive extension | Customizable (such as `.lgdf`, `.zip`, `.proj`, etc.) |
| SDK version | SDK 1 corresponding to the current specification (the semantics of `min_sdk` are described in §4) |

## 2. Top-Level Structure

### 2.1 Directory Mode (Project Form)

An LGDF project **always exists in directory mode**:

```
example/                          Project root directory
├── info.json                     [required] Core configuration (project identity card)
├── registry.json                 [required] Registered asset list
├── assets/                       [required] Asset layer: images/audio/models...
│   ├── images/        a.jpg  b.svg  c.png
│   ├── audios/        a.mp3  b.wav
│   └── models/        cube.obj
├── metadata/                     [required] Metadata layer: one-to-one mirror of assets/
│   ├── images/        a.jpg.json  b.svg.json  c.png.json
│   ├── audios/        a.mp3.json  b.wav.json
│   └── models/        cube.obj.json
├── spec/                         [optional] Description layer: steps/configuration/specific information
│   ├── overview.md
│   ├── steps.json
│   ├── config.json
│   └── config.schema.json
├── work/                         [optional] Workspace: temporary SDK files, never exported
├── dist/                         [optional] Distribution directory: stores exported packages
├── .lgdfignore                   [optional] Additional exclusion rules (same syntax as gitignore)
└── lgdf-standard.md / LICENSE    [optional] Read-only specification documents (not included in export)
```

### 2.2 Root Directory Rules

Only the following entries are valid in the project root directory:

1. `info.json` (required), `registry.json` (required), `assets/` (required), `metadata/` (required), `spec/` (optional);
2. Non-packaged directories `work/` and `dist/` (may exist and are excluded during export);
3. The optional file `.lgdfignore`;
4. Read-only companion specification documents (such as `lgdf-standard.md` and `LICENSE`), which are not counted as project data.

Path convention: **all internal paths must use `/` as the separator, be relative paths, and have no leading slash**.

### 2.3 Export/Import Mechanism

- **Export**: package the directory-mode project as a ZIP archive, with the extension specified by the user (such as `.lgdf`, `.zip`, or `.proj`);
- **Import**: extract the archive to restore a directory-mode project, while validating integrity.

The internal archive structure is exactly the same as the directory mode (`info.json` + `registry.json` + `assets/` + `metadata/` + `spec/`).

## 3. Encoding and Naming Conventions

- **Text resources** (files whose `type` is `text`): **must use UTF-8 encoding** (BOM permitted);
- JSON files: UTF-8 (without BOM), with **Tab** indentation recommended; JSON keys must use lowercase snake_case;
- Project name `name`: `^[a-z0-9_-]+$`, lowercase; lowercase resource filenames with `-`/`_` separators are recommended;
- The following are prohibited inside `assets/`: symbolic links, absolute path references, and `..` parent-directory traversal.

### 3.1 Recommended Asset Formats

**Use standard file formats rather than custom binary formats whenever possible.**

| Category | Recommended formats | Extensions | Recommended MIME types |
| --- | --- | --- | --- |
| Image | PNG / JPEG / SVG / WebP | `.png` `.jpg` `.svg` `.webp` | `image/png` `image/jpeg` `image/svg+xml` `image/webp` |
| Audio | WAV / OGG / FLAC / MP3 | `.wav` `.ogg` `.flac` `.mp3` | `audio/wav` `audio/ogg` `audio/flac` `audio/mpeg` |
| Video | MP4 / WebM | `.mp4` `.webm` | `video/mp4` `video/webm` |
| Model | glTF / OBJ / STL | `.gltf` `.glb` `.obj` `.stl` | `model/gltf+json` `model/gltf-binary` `text/plain` |
| Text | UTF-8 text | `.txt` `.md` `.json` `.yaml` `.toml` | `text/*` |
| Font | WOFF2 / TTF / OTF | `.woff2` `.ttf` `.otf` | `font/woff2` `font/ttf` |

> Custom binary formats should be a last resort; if one must be used, provide a format description in the `extra` field of `metadata` or in `spec/`.

### 3.2 Recommended Description-Layer Formats

**Use human-readable text formats (JSON, TOML, YAML, Markdown, etc.) whenever possible.**

| File | Recommended format | Description |
| --- | --- | --- |
| `spec/overview.md` | Markdown | Project overview and usage instructions |
| `spec/steps.json` | JSON | Step definitions (structured) |
| `spec/config.json` | JSON | Runtime configuration (can be validated with a schema) |
| `spec/config.schema.json` | JSON Schema | Configuration validation rules |

## 4. info.json (Core Configuration)

### 4.1 Field Specification

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `format` | string | Yes | — | Fixed to `"lgdf"`; readers use it for identification |
| `min_sdk` | int | Yes | — | Minimum SDK version required for reading |
| `name` | string | Yes | — | Project identifier name, `^[a-z0-9_-]+$` |
| `display_name` | string | No | name | Human-readable display name |
| `description` | string | No | `""` | Project description |
| `author` | string | No | — | Author/maintainer |
| `author_sign` | object | No | — | Author signature (RSA/ECC; see §4.3) |
| `license` | string | No | — | SPDX license identifier |
| `tags` | string[] | No | `[]` | Tags |
| `created_time` | int | Yes | — | Creation time, Unix seconds (UTC) |
| `last_update_time` | int | Yes | — | Last update time, Unix seconds; must be `>= created_time` |
| `version` | int | Yes | — | Project version number, `>= 1`, incremented on each release |
| `extra` | object | No | `{}` | Container for extension fields |

### 4.2 Example

```json
{
	"format": "lgdf",
	"min_sdk": 1,
	"name": "example",
	"display_name": "LGDF Example Project",
	"description": "An example project demonstrating the LGDF general-purpose data format.",
	"author": "a human",
	"license": "CC0-1.0",
	"tags": ["example", "tutorial", "lgdf"],
	"created_time": 1788963970,
	"last_update_time": 1789193378,
	"version": 1
}
```

### 4.3 Author Signature (author_sign)

The author signature **must use an RSA or ECC algorithm** to sign key project fields and ensure that the project source is trustworthy.

**Signed object**: Canonical JSON serialization of the following fields (UTF-8, keys sorted alphabetically, no whitespace):

```json
{"format":"lgdf","min_sdk":2,"name":"example","registered_files":["assets/audios/a.mp3","assets/images/a.jpg"],"version":1}
```

**Signature format**:

```json
{
	"algorithm": "RSA-SHA256",
	"public_key": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg...\n-----END PUBLIC KEY-----",
	"signature": "Base64-encoded signature value",
	"signed_at": 1789193378
}
```

| Field | Description |
| --- | --- |
| `algorithm` | `RSA-SHA256`, `RSA-SHA512`, `ECDSA-P256-SHA256`, `ECDSA-P384-SHA384` |
| `public_key` | Public key (PEM format) |
| `signature` | Signature value (Base64) |
| `signed_at` | Signing time (Unix seconds) |

**Verification process**:

1. Read `registered_files` from `registry.json`;
2. Combine it with `format`, `min_sdk`, `name`, and `version` from `info.json`;
3. Sort keys alphabetically and serialize as UTF-8 JSON without whitespace;
4. Use `public_key` to verify `signature`.

## 5. registry.json (Registered Asset List)

### 5.1 Field Specification

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `registered_files` | string[] | Yes | Registered asset list, `/`-separated; sorting recommended |
| `asset_count` | int | No | Total number of assets (should match the length of `registered_files`) |
| `timestamp_sign` | object | No | Public TSA timestamp signature (see §5.2) |
| `extra` | object | No | Extension fields |

### 5.2 Timestamp Signature (timestamp_sign)

Issued by a **public signature provider** (RFC 3161 TSA) to prove that the assets existed at a particular point in time.

```json
{
	"tsa_url": "http://timestamp.digicert.com",
	"token": "MIIG...",
	"signed_at": 1789193378
}
```

| Field | Description |
| --- | --- |
| `tsa_url` | TSA service address |
| `token` | RFC 3161 timestamp token (Base64) |
| `signed_at` | Issuance time (Unix seconds) |

## 6. assets/ Asset Layer

- Use subdirectories by broad category where appropriate: `images/`, `audios/`, `videos/`, `models/`, `fonts/`;
- Every file must be registered in `registry.json` and have a default metadata file;
- **Text resources (those whose `type` is `text`) must use UTF-8 encoding**;
- Standard file formats are recommended (see §3.1).

## 7. metadata/ Metadata Layer

### 7.1 Mirror Rule

`assets/<relative path>` ⇄ `metadata/<relative path>.json`

### 7.2 Common Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | Yes | Asset relative path |
| `type` | string | Yes | `image`, `audio`, `video`, `model`, `text`, `binary`, `other` |
| `mime` | string | No | MIME type |
| `format` | string | No | Format identifier |
| `size` | int | Yes | Number of bytes |
| `sha256` | string | Yes | SHA-256 (**all lowercase hexadecimal**) |
| `hash_algorithm` | string | No | Fixed to `sha256` |
| `created_time` | int | Yes | Creation time |
| `last_update_time` | int | Yes | Last modification time |
| `extra` | object | No | Extension fields |

### 7.3 Optional Classification Fields

| type | Field | Example |
| --- | --- | --- |
| `image` | `width`, `height` | `2160, 2160` |
| `audio` | `duration_seconds`, `sample_rate`, `channels`, `bit_depth` | `1.0, 44100, 1, 16` |
| `model` | `vertices`, `triangles` | `8, 12` |
| `text` | `encoding` (fixed to `"utf-8"`) | `"utf-8"` |

### 7.4 Metadata Example

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

## 8. spec/ Description Layer

| File | Recommended format | Content |
| --- | --- | --- |
| `overview.md` | Markdown | Project overview |
| `steps.json` | JSON | Steps (`id/name/description/inputs/outputs/params`) |
| `config.json` | JSON | Runtime configuration |
| `config.schema.json` | JSON Schema | Configuration validation |

## 9. Export/Import

### 9.1 Export

1. Perform full validation (§10); reject if it fails;
2. Collect: `info.json` + `registry.json` + `assets/**` + `metadata/**` + `spec/**`;
3. Use `/` as the path separator and Deflate compression;
4. Calculate SHA-256 and write the accompanying file `<package-name>.sha256`;
5. The user specifies the extension.

### 9.2 Import

1. Accept only standard entries and reject `..` (zip-slip protection);
2. Extract to the target directory;
3. Perform full validation.

## 10. Validation Process

```
1 Identify       info.json exists and format == "lgdf"
2 Threshold      min_sdk <= reader version
3 Registry       registry.json exists, and registered_files is non-empty with no duplicates
4 Text encoding  Resources with type=="text" must be valid UTF-8
5 Registration   For each registered_file: asset exists, metadata exists, path matches, sha256 matches, size matches
6 Bidirectional  No untracked assets and no orphan metadata
7 Author sign    If author_sign exists, verify according to §4.3
8 Timestamp      If timestamp_sign exists, verify according to §5.2
9 Description    Parse spec/ if it exists
```

## 11. Companion SDK (lgdf-sdk)

Official Python parser library (`F:\exeliang\lgdf-sdk`, standard library only, zero required dependencies, Python ≥ 3.8; signing requires `cryptography`, and schema validation requires `jsonschema`).

### 11.1 API Quick Reference

| Method | Description |
| --- | --- |
| `create(name, path)` | Create an empty project |
| `open(path)` | Read a directory-mode project |
| `add_asset(rel, source/data, properties)` | Register an asset |
| `replace_asset(rel, source/data)` | Replace an asset |
| `remove_asset(rel)` | Unregister an asset |
| `read_asset(rel)` / `get_metadata(rel)` | Read |
| `set_config` / `set_steps` / `set_overview` | Description layer |
| `sign(private_key, algorithm)` | RSA/ECC signing |
| `verify_sign()` | Verify signature |
| `validate()` | Perform full validation |
| `export(out_path)` | Export as a compressed archive |
| `import_from(source, dest)` | Import from a compressed archive |
| `bump_version()` / `save()` | Version management |

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

## 12. Version History

| Version | Date | Summary |
| --- | --- | --- |
| 1.0 | 2026-09-12 | Initial version |
| 1.0.1 | 2026-09-12 | Removed single-file mode; added export/import; split out registry.json; RSA/ECC signing; public TSA timestamps; mandatory UTF-8 for text; recommended standard formats |
