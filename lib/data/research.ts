/**
 * KV helper, ported from old redis setup to the new KV storage
 */

import type { KeyValueStorage } from "@agentuity/sdk";
import { z } from "zod";

const PREFIX = "research";

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

// Define ResearchData as a type that can be serialized
interface ResearchData {
	articles: Article[];
	metadata: ResearchMetadata;
}

// Type guard for JSON serializable objects
type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/**
 * Format a date as YYYY-MM-DD
 */
const formatDate = (date: Date): string => {
	return date.toISOString().split("T")[0];
};

/**
 * Get today's research articles using the provided KeyValueStorage
 */
export const getTodaysResearch = async (
	kv: KeyValueStorage,
): Promise<Article[] | undefined> => {
	const todayKey = formatDate(new Date());
	const data = await kv.get(PREFIX, todayKey);
	if (!data) return undefined;

	// The actual data is likely JSON, not ArrayBuffer as incorrectly typed
	const researchData = data as unknown as ResearchData;
	return researchData.articles;
};

/**
 * Get research articles for a specific date
 */
export const getResearchByDate = async (
	kv: KeyValueStorage,
	date: Date,
): Promise<Article[] | undefined> => {
	const dateKey = formatDate(date);
	const data = await kv.get(PREFIX, dateKey);
	if (!data) return undefined;

	// The actual data is likely JSON, not ArrayBuffer as incorrectly typed
	const researchData = data as unknown as ResearchData;
	return researchData.articles;
};

/**
 * Save research articles with metadata
 */
export const saveResearch = async (
	kv: KeyValueStorage,
	articles: Article[],
	source: string,
): Promise<void> => {
	const todayKey = formatDate(new Date());
	const data = {
		articles,
		metadata: {
			lastUpdated: new Date().toISOString(),
			source,
		},
	};

	// Store with 14 days TTL (in seconds)
	const ttl = 14 * 24 * 60 * 60;
	await kv.set(PREFIX, todayKey, data, { ttl });
};

/**
 * Get all research articles across all dates
 * Note: This implementation might need adjustment depending on
 * how KeyValueStorage handles listing keys
 */
export const getAllResearch = async (
	kv: KeyValueStorage,
	daysToLookBack = 14,
): Promise<Article[]> => {
	const allArticles: Article[] = [];
	const today = new Date();

	// Look back X days and collect all articles
	for (let i = 0; i < daysToLookBack; i++) {
		const date = new Date(today);
		date.setDate(today.getDate() - i);

		const articles = await getResearchByDate(kv, date);
		if (articles && articles.length > 0) {
			allArticles.push(...articles);
		}
	}

	// Sort by date_found, newest first
	return allArticles.sort(
		(a, b) =>
			new Date(b.date_found).getTime() - new Date(a.date_found).getTime(),
	);
};

/**
 * Clear research data older than the specified number of days
 * Note: This implementation will need to be adjusted if the KeyValueStorage
 * provides a method for listing/querying keys
 */
export const clearOldResearch = async (
	kv: KeyValueStorage,
	daysToKeep = 14,
): Promise<void> => {
	const today = new Date();

	// Delete data older than daysToKeep
	for (let i = daysToKeep + 1; i <= 365; i++) {
		const date = new Date(today);
		date.setDate(today.getDate() - i);
		const dateKey = formatDate(date);

		// Try to delete this key
		await kv.delete(PREFIX, dateKey);
	}
};
