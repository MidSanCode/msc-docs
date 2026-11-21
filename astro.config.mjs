// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: {
				'zh-CN': 'MSC钟码文档站',
				en: 'MSC Documentation',
			},
			defaultLocale: 'root',
			locales: {
				root: { label: '简体中文', lang: 'zh-CN' },
				en: { label: 'English', lang: 'en' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/midsancode' }],
			sidebar: [
				{
					label: 'MSC 标准',
					translations: { en: 'MSC Standards' },
					items: [
						{
							label: 'LGDF 通用数据格式 v1.0.1',
							translations: { en: 'LGDF Generic Data Format v1.0.1' },
							slug: 'lgdf-standard',
						},
					],
				},
				{
					label: 'OpenPrairie 服务端',
					translations: { en: 'OpenPrairie Server' },
					items: [
						{
							label: '概览',
							translations: { en: 'Overview' },
							slug: 'openprairie',
						},
						{
							label: 'API 调用',
							translations: { en: 'API Reference' },
							items: [
								{ label: 'API 总览', translations: { en: 'API Overview' }, slug: 'openprairie/api' },
								{ label: '认证与会话', translations: { en: 'Authentication and Sessions' }, slug: 'openprairie/api/auth' },
								{ label: '用户与档案', translations: { en: 'Users and Profiles' }, slug: 'openprairie/api/users' },
								{ label: '钱包与支付', translations: { en: 'Wallet and Payments' }, slug: 'openprairie/api/wallet' },
								{ label: '帖子与互动', translations: { en: 'Posts and Interactions' }, slug: 'openprairie/api/posts' },
								{ label: '营地与子群', translations: { en: 'Camps and Subgroups' }, slug: 'openprairie/api/camps' },
								{ label: '聊天与会话', translations: { en: 'Chat and Conversations' }, slug: 'openprairie/api/chat' },
								{ label: '语音与视频通话', translations: { en: 'Voice and Video Calls' }, slug: 'openprairie/api/calls' },
								{ label: '附件与存储', translations: { en: 'Attachments and Storage' }, slug: 'openprairie/api/storage' },
								{ label: '任务与会员', translations: { en: 'Tasks and Membership' }, slug: 'openprairie/api/tasks' },
								{ label: '审核与处罚', translations: { en: 'Moderation and Enforcement' }, slug: 'openprairie/api/moderation' },
								{ label: '系统接口', translations: { en: 'System API' }, slug: 'openprairie/api/system' },
							],
						},
						{
							label: 'Bot 开发指南',
							translations: { en: 'Bot Development Guide' },
							items: [
								{ label: '快速上手与认证', translations: { en: 'Getting Started and Authentication' }, slug: 'openprairie/bots' },
								{ label: '管理接口与能力清单', translations: { en: 'Management API and Capabilities' }, slug: 'openprairie/bots/api' },
								{ label: '实时事件', translations: { en: 'Real-Time Events' }, slug: 'openprairie/bots/events' },
								{ label: '实战与限制', translations: { en: 'Cookbook and Limitations' }, slug: 'openprairie/bots/cookbook' },
							],
						},
					],
				},
			],
		}),
	],
});
