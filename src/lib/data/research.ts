import { getRedisClient } from "../client/redis";
import { z } from "zod";

const PREFIX = "research";
const redis = getRedisClient();

// Article schema and type
export const ArticleSchema = z.object({
	headline: z.string(),
	summary: z.string(),
	link: z.string(),
	source: z.string(),
	date_found: z.string(),
	content: z.string().optional(),
	images: z.array(z.string()).optional(),
	date_posted: z.string().optional(),
	body: z.string().optional(),
});

export type Article = z.infer<typeof ArticleSchema>;

// Research data types
interface ResearchMetadata {
	lastUpdated: string;
	source: string;
}

interface ResearchData {
	articles: Article[];
	metadata: ResearchMetadata;
}

function getKey(date: Date): string {
	const dateStr = date.toISOString().split("T")[0];
	return `${PREFIX}:${dateStr}`;
}

async function saveResearch(
	articles: Article[],
	source: string,
): Promise<void> {
	const key = getKey(new Date());
	const data: ResearchData = {
		articles,
		metadata: {
			lastUpdated: new Date().toISOString(),
			source,
		},
	};

	// Store with 14 days TTL since this is raw research
	await redis.set(key, data, { ex: 14 * 24 * 60 * 60 });
}

async function getTodaysResearch(): Promise<Article[] | undefined> {
	const key = getKey(new Date());
	const data = await redis.get<ResearchData>(key);
	return data?.articles;
}

async function getResearchByDate(date: Date): Promise<Article[] | undefined> {
	const key = getKey(date);
	const data = await redis.get<ResearchData>(key);
	return data?.articles;
}

async function getAllResearch(): Promise<Article[]> {
	const keys = await redis.keys(`${PREFIX}:*`);
	if (keys.length === 0) return [];

	const pipeline = redis.pipeline();
	for (const key of keys) {
		pipeline.get(key);
	}

	const responses = await pipeline.exec();
	if (!responses) return [];

	const allArticles: Article[] = [];
	for (const response of responses) {
		if (response) {
			const data = response as ResearchData;
			if (data.articles) {
				allArticles.push(...data.articles);
			}
		}
	}

	// Sort by date_found, newest first
	return allArticles.sort(
		(a, b) =>
			new Date(b.date_found).getTime() - new Date(a.date_found).getTime(),
	);
}

async function clearOldResearch(daysToKeep = 14): Promise<void> {
	const keys = await redis.keys(`${PREFIX}:*`);
	const now = new Date();

	for (const key of keys) {
		const dateStr = key.split(":")[1];
		const keyDate = new Date(dateStr);
		const daysDiff =
			(now.getTime() - keyDate.getTime()) / (1000 * 60 * 60 * 24);

		if (daysDiff > daysToKeep) {
			await redis.del(key);
		}
	}
}

export const research = {
	save: saveResearch,
	getToday: getTodaysResearch,
	getByDate: getResearchByDate,
	getAll: getAllResearch,
	clearOld: clearOldResearch,
};
