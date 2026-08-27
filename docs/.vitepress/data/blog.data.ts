import { readItems } from '@directus/sdk';
import { defineLoader } from 'vitepress';
import { client, skipRemoteDocsData } from '../lib/directus.js';

export default defineLoader({
	async load() {
		if (skipRemoteDocsData) {
			return {
				blog: {
					articles: [
						{
							id: 'offline-build',
							title: 'Offline build fixture',
							date_published: '2024-01-01T00:00:00.000Z',
							summary: '',
							image: '',
							author: null,
						},
					],
					tags: [],
				},
			};
		}

		const articles = (
			await client.request(
				readItems('developer_articles', {
					fields: [
						'*',
						{ author: ['first_name', 'last_name', 'avatar', 'title'] },
						{ tags: [{ directus_tags_id: ['title', 'slug', 'type'] }] },
					],
					filter: {
						status: { _eq: 'published' },
					},
					sort: '-date_published',
				}),
			)
		).map((article) => ({
			id: article.slug,
			title: article.title,
			date_published: article.date_published,
			summary: article.summary,
			image: article.image,
			author: article.author,
		}));

		const tags = await client.request(
			readItems('docs_tags', {
				// @ts-ignore
				sort: '-count(developer_articles)',
			}),
		);

		return {
			blog: {
				articles,
				tags,
			},
		};
	},
});
