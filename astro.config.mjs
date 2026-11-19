// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'MSC钟码文档站',
			defaultLocale: 'zh-CN',
			locales: {
				root: { label: '简体中文', lang: 'zh-CN' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/midsancode' }],
			sidebar: [
				{
					label: 'MSC 标准',
					items: [
						{ label: 'LGDF 通用数据格式 v1.0.1', slug: 'lgdf-standard' },
					],
				},
				{
					label: 'OpenPrairie 服务端',
					items: [
						{ label: '概览', slug: 'openprairie' },
						{
							label: 'API 调用',
							items: [
								{ label: 'API 总览', slug: 'openprairie/api' },
								{ label: '认证与会话', slug: 'openprairie/api/auth' },
								{ label: '用户与档案', slug: 'openprairie/api/users' },
								{ label: '钱包与支付', slug: 'openprairie/api/wallet' },
								{ label: '帖子与互动', slug: 'openprairie/api/posts' },
								{ label: '营地与子群', slug: 'openprairie/api/camps' },
								{ label: '聊天与会话', slug: 'openprairie/api/chat' },
								{ label: '语音与视频通话', slug: 'openprairie/api/calls' },
								{ label: '附件与存储', slug: 'openprairie/api/storage' },
								{ label: '任务与会员', slug: 'openprairie/api/tasks' },
								{ label: '审核与处罚', slug: 'openprairie/api/moderation' },
								{ label: '系统接口', slug: 'openprairie/api/system' },
							],
						},
						{
							label: 'Bot 开发指南',
							items: [
								{ label: '快速上手与认证', slug: 'openprairie/bots' },
								{ label: '管理接口与能力清单', slug: 'openprairie/bots/api' },
								{ label: '实时事件', slug: 'openprairie/bots/events' },
								{ label: '实战与限制', slug: 'openprairie/bots/cookbook' },
							],
						},
					],
				},
			],
		}),
	],
});
