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
			],
		}),
	],
});
