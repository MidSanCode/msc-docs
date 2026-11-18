// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'MSC 标准',
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
