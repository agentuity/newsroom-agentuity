import { getRedisClient } from "../client/redis";
import { z } from "zod";

const PREFIX = "stories";
const redis = getRedisClient();

// Story schema and type
export const StorySchema = z.object({
	headline: z.string(),
	summary: z.string(),
	link: z.string(),
	published: z.boolean(),
	date_added: z.string(),
	date_published: z.string().optional(),
	images: z.array(z.string()).optional(),
	body: z.string().optional(),
	source: z.string(),
	tags: z.array(z.string()).optional(),
	edited: z.boolean().optional(),
});

export type Story = z.infer<typeof StorySchema>;

// Key structure utilities
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getStoryKey(id: string): string {
	return `${PREFIX}:story:${id}`;
}

function getDateKey(date: string): string {
	return `${PREFIX}:date:${date}`;
}

function getPublishedKey(): string {
	return `${PREFIX}:published`;
}

function getUnpublishedKey(): string {
	return `${PREFIX}:unpublished`;
}

function getLinkToIdKey(link: string): string {
	return `${PREFIX}:link_to_id:${encodeURIComponent(link)}`;
}

// Date utility functions
function formatDate(date: Date): string {
	return date.toISOString().split("T")[0];
}

function getDatesInRange(startDate: Date, endDate: Date): string[] {
	const dates: string[] = [];
	const currentDate = new Date(startDate);

	while (currentDate <= endDate) {
		dates.push(formatDate(currentDate));
		currentDate.setDate(currentDate.getDate() + 1);
	}

	return dates;
}

export async function addStory(story: Story): Promise<void> {
	const id = generateId();
	const storyKey = getStoryKey(id);
	const dateKey = getDateKey(story.date_added.split("T")[0]);
	const linkKey = getLinkToIdKey(story.link);

	// Store the story
	await redis.set(storyKey, JSON.stringify(story));

	// Add to date index
	await redis.sadd(dateKey, id);

	// Add to unpublished set
	await redis.sadd(getUnpublishedKey(), id);

	// Map link to id for lookups
	await redis.set(linkKey, id);
}

export async function getStory(link: string): Promise<Story | null> {
	const linkKey = getLinkToIdKey(link);
	const id = await redis.get<string>(linkKey);
	if (!id) return null;

	const storyKey = getStoryKey(id);
	const data = await redis.get<string>(storyKey);
	if (!data) return null;

	const parsed = StorySchema.safeParse(JSON.parse(data));
	return parsed.success ? parsed.data : null;
}

export async function markAsPublished(link: string): Promise<void> {
	const linkKey = getLinkToIdKey(link);
	const id = await redis.get<string>(linkKey);
	if (!id) return;

	const storyKey = getStoryKey(id);
	const data = await redis.get<string>(storyKey);
	if (!data) return;

	let story: Story;
	if (typeof data === "object" && data !== null) {
		story = StorySchema.parse(data);
	} else {
		const parsed = StorySchema.safeParse(JSON.parse(data));
		if (!parsed.success) return;
		story = parsed.data;
	}

	story.published = true;
	story.date_published = new Date().toISOString();

	// Update story
	await redis.set(storyKey, JSON.stringify(story));

	// Move from unpublished to published set
	await redis.srem(getUnpublishedKey(), id);
	await redis.sadd(getPublishedKey(), id);
}

async function getStoriesByIds(ids: string[]): Promise<Story[]> {
	if (ids.length === 0) return [];

	const pipeline = redis.pipeline();
	ids.forEach((id) => pipeline.get(getStoryKey(id)));

	const responses = await pipeline.exec();
	if (!responses) return [];

	return responses
		.filter((response): response is unknown => response !== null)
		.map((data) => {
			// If it's already an object, use it directly
			if (typeof data === "object" && data !== null) {
				const parsed = StorySchema.safeParse(data);
				return parsed.success ? parsed.data : null;
			}

			// If it's a string, try to parse it
			if (typeof data === "string") {
				try {
					const parsed = StorySchema.safeParse(JSON.parse(data));
					return parsed.success ? parsed.data : null;
				} catch (error) {
					console.error("Failed to parse story data:", error);
					return null;
				}
			}

			console.error("Unexpected data type:", typeof data);
			return null;
		})
		.filter((story): story is Story => story !== null);
}

export async function getUnpublishedStories(): Promise<Story[]> {
	const ids = await redis.smembers(getUnpublishedKey());
	const stories = await getStoriesByIds(ids);

	return stories.sort(
		(a, b) =>
			new Date(b.date_added).getTime() - new Date(a.date_added).getTime(),
	);
}

export async function getPublishedStories(): Promise<Story[]> {
	const ids = await redis.smembers(getPublishedKey());
	const stories = await getStoriesByIds(ids);

	return stories.sort(
		(a, b) =>
			new Date(b.date_published!).getTime() -
			new Date(a.date_published!).getTime(),
	);
}

export async function exists(link: string): Promise<boolean> {
	const linkKey = getLinkToIdKey(link);
	return (await redis.exists(linkKey)) === 1;
}

// Get stories by date range
export async function getStoriesByDateRange(
	startDate: Date,
	endDate: Date,
	options: {
		publishedOnly?: boolean;
		unpublishedOnly?: boolean;
		limit?: number;
	} = {},
): Promise<Story[]> {
	const dates = getDatesInRange(startDate, endDate);

	// Get all story IDs from the date range
	const pipeline = redis.pipeline();
	dates.forEach((date) => pipeline.smembers(getDateKey(date)));
	const responses = await pipeline.exec();

	if (!responses) return [];

	// Flatten and deduplicate IDs
	const allIds = [
		...new Set(responses.flatMap((r) => (r ? (r as string[]) : []))),
	];

	// If we need to filter by published status
	let filteredIds = allIds;
	if (options.publishedOnly || options.unpublishedOnly) {
		const statusIds = (await redis.smembers(
			options.publishedOnly ? getPublishedKey() : getUnpublishedKey(),
		)) as string[];
		filteredIds = allIds.filter((id) => statusIds.includes(id));
	}

	// Apply limit if specified
	if (options.limit && options.limit > 0) {
		filteredIds = filteredIds.slice(0, options.limit);
	}

	// Fetch and parse stories
	const stories = await getStoriesByIds(filteredIds);

	// Sort by date_added (or date_published for published stories)
	return stories.sort((a, b) => {
		const dateA = options.publishedOnly ? a.date_published! : a.date_added;
		const dateB = options.publishedOnly ? b.date_published! : b.date_added;
		return new Date(dateB).getTime() - new Date(dateA).getTime();
	});
}

// Helper functions for common date ranges
export async function getStoriesLastNDays(
	days: number,
	options: {
		publishedOnly?: boolean;
		unpublishedOnly?: boolean;
		limit?: number;
	} = {},
): Promise<Story[]> {
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);

	return getStoriesByDateRange(startDate, endDate, options);
}

export async function updateStory(story: Story): Promise<void> {
	const linkKey = getLinkToIdKey(story.link);
	const id = await redis.get<string>(linkKey);
	if (!id) {
		throw new Error(`No story found with link: ${story.link}`);
	}

	const storyKey = getStoryKey(id);

	// Store the updated story
	await redis.set(storyKey, JSON.stringify(story));
}

export async function getUneditedUnpublishedStories(): Promise<Story[]> {
	const ids = await redis.smembers(getUnpublishedKey());
	const stories = await getStoriesByIds(ids);

	// Filter for unedited stories
	const uneditedStories = stories.filter((story) => !story.edited);

	return uneditedStories.sort(
		(a, b) =>
			new Date(b.date_added).getTime() - new Date(a.date_added).getTime(),
	);
}

export async function getEditedUnpublishedStories(): Promise<Story[]> {
	const ids = await redis.smembers(getUnpublishedKey());
	const stories = await getStoriesByIds(ids);

	// Filter for edited but unpublished stories
	const editedStories = stories.filter(
		(story) => story.edited && !story.published,
	);

	return editedStories.sort(
		(a, b) =>
			new Date(b.date_added).getTime() - new Date(a.date_added).getTime(),
	);
}

// Update the stories export
export const stories = {
	get: getStory,
	add: addStory,
	update: updateStory,
	markAsPublished,
	getUnpublished: getUnpublishedStories,
	getUneditedUnpublished: getUneditedUnpublishedStories,
	getEditedUnpublished: getEditedUnpublishedStories,
	getPublished: getPublishedStories,
	exists,
	getByDateRange: getStoriesByDateRange,
	getLastNDays: getStoriesLastNDays,
};
