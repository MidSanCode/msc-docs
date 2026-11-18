# MSC钟码文档站（midsancode standards）

MSC钟码文档站 —— 收录 LGDF 等分层数据格式规范的公开标准文档站，基于 [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) 构建。

当前收录：

- **LGDF 通用数据格式 v1.0.1**（Layered Generic Data Format）— [标准全文](https://github.com/midsancode/msc-standards/blob/main/src/content/docs/lgdf-standard.md)

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 产物输出到 dist/
npm run preview  # 预览构建产物
```

要求 Node.js ≥ 22.23.4（见 `.nvmrc`）。

## 目录结构

```
.
├── astro.config.mjs          # 站点与侧边栏配置
├── src/
│   ├── content.config.ts
│   └── content/docs/         # .md/.mdx 即路由
│       ├── index.mdx         # 首页
│       └── lgdf-standard.md  # LGDF 标准全文
└── package.json
```

新增标准：在 `src/content/docs/` 下添加 Markdown 文件，并在 `astro.config.mjs` 的 `sidebar` 中登记。

## 部署（Cloudflare Pages）

| 配置项 | 值 |
| --- | --- |
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `22`（由 `.nvmrc` 指定，也可设环境变量 `NODE_VERSION=22`） |

纯静态输出，无需 Functions 或适配器。

## 许可

标准文本与站点内容由 midsancode 发布。