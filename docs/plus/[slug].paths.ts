import { readItems } from '@directus/sdk';
import { client, skipRemoteDocsData } from '../.vitepress/lib/directus.js';

export default {
	async paths() {
		if (skipRemoteDocsData) {
			return [
				{
					params: { slug: 'introduction', title: 'Directus Plus' },
					content: '# Directus Plus',
				},
			];
		}

		const articles = (
			await client.request(
				readItems('dplus_docs_articles', {
					fields: ['*'],
				}),
			)
		).map((article) => ({
			params: {
				slug: article.slug,
				title: article.title,
			},
			content: article.content,
		}));

		return articles;
	},
};
