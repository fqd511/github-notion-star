import { Client } from '@notionhq/client';
import { NotionPage, Repo } from './types';
import { DatabasesQueryResponse } from '@notionhq/client/build/src/api-endpoints';
import { get, save } from './cache';

// TODO: add assertion
const databaseId = process.env.NOTION_DATABASE_ID as string;

const NAMESPACE = 'notion-page';

export class Notion {
    private notion: Client;

    constructor() {
        this.notion = new Client({
            auth: process.env.NOTION_API_KEY,
            /* * 增加超时时间到 60 秒。
             * 如果你的数据库页面非常多（上千条），建议设置为 120000 (2分钟)
             */
            timeoutMs: 60000, 
        });

        this.pages = get(NAMESPACE, {});

        console.log(`Notion: restored from cache, count is ${Object.keys(this.pages).length}`);
    }

    save() {
        save(NAMESPACE, this.pages);
    }

    pages: Record<string, { id: string }> = {};

    hasPage(name: string) {
        return !!this.pages[name];
    }

    /**
     * full-sync pages in database
     */
    async fullSyncIfNeeded() {
        if (Object.keys(this.pages).length) {
            console.log(`Notion: skipped sync due to cache`);
            return;
        }

        console.log('Notion: Start to get all pages');

        let hasNext = true;
        let cursor: string | undefined = undefined;

        while (hasNext) {
            try {
                const database: DatabasesQueryResponse = await this.notion.databases.query({
                    database_id: databaseId,
                    page_size: 100,
                    start_cursor: cursor,
                });

                this.addPages(database.results as NotionPage[]);
                hasNext = database.has_more;
                // @ts-ignore
                cursor = database.next_cursor;
            } catch (error) {
                console.error(`Notion: Error during database query:`, error);
                throw error; // 向上抛出以停止 Action，避免因数据不全导致的误删
            }
        }

        console.log(`Notion: Get all pages success, count is ${Object.keys(this.pages).length}`);

        this.save();
    }

    addPages(pages: NotionPage[]) {
        pages.forEach((page) => {
            // 增加安全检查，防止 title 为空时报错
            const title = page.properties.Name.title[0]?.plain_text;
            if (title) {
                this.pages[title] = {
                    id: page.id,
                };
            }
        });

        this.save();
    }

    async insertPage(repo: Repo) {
        if (repo.description && repo.description.length >= 2000) {
            repo.description = repo.description.substr(0, 120) + '...'
        }
        const data = await this.notion.pages.create({
            parent: {
                database_id: databaseId,
            },
            properties: {
                Name: {
                    type: 'title',
                    title: [
                        {
                            type: 'text',
                            text: {
                                content: repo.nameWithOwner,
                            },
                        },
                    ],
                },
                Type: {
                    type: 'select',
                    select: {
                        name: 'Star',
                    },
                },
                Link: {
                    type: 'url',
                    url: repo.url,
                },
                Description: {
                    type: 'rich_text',
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: repo.description || '',
                            },
                        },
                    ],
                },
                'Primary Language': {
                    type: 'select',
                    select: {
                        name: repo?.primaryLanguage?.name || 'null',
                    },
                },
                'Repository Topics': {
                    type: 'multi_select',
                    multi_select: repo.repositoryTopics || [],
                },
                'Starred At': {
                    type: 'date',
                    date: {
                        start: repo.starredAt,
                        end: repo.starredAt,
                    },
                },
            },
        });

        this.pages[repo.nameWithOwner] = { id: data.id };

        console.log(`insert page ${repo.nameWithOwner} success, page id is ${data.id}`);

        this.save();
    }
}

export const notion = new Notion();
