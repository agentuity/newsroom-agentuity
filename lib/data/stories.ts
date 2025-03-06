/**
 * KV helper, ported from old redis setup to the new KV storage
 */

import type { KeyValueStorage } from "@agentuity/sdk";
import { z } from "zod";

const PREFIX = "stories";

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

// Type for serializable JSON
type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// Key structure utilities
const generateId = (): string => {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const getStoryKey = (id: string): string => {
	return `story:${id}`;
};

const getDateKey = (date: string): string => {
	return `date:${date}`;
};

const getPublishedKey = (): string => {
	return "published";
};

const getUnpublishedKey = (): string => {
	return "unpublished";
};

const getLinkToIdKey = (link: string): string => {
	return `link_to_id:${encodeURIComponent(link)}`;
};

// Date utility functions
const formatDate = (date: Date): string => {
	return date.toISOString().split("T")[0];
};

const getDatesInRange = (startDate: Date, endDate: Date): string[] => {
	const dates: string[] = [];
	const currentDate = new Date(startDate);

	while (currentDate <= endDate) {
		dates.push(formatDate(currentDate));
		currentDate.setDate(currentDate.getDate() + 1);
	}

	return dates;
};

/**
 * Add a new story to storage
 */
export const addStory = async (
	kv: KeyValueStorage,
	story: Story,
): Promise<void> => {
	const id = generateId();
	const storyKey = getStoryKey(id);
	const dateKey = getDateKey(story.date_added.split("T")[0]);
	const linkKey = getLinkToIdKey(story.link);

	// Store the story
	await kv.set(PREFIX, storyKey, story);

	// Add to date index - we need to get the existing set, add the id, and save it back
	const dateSet = await kv.get(PREFIX, dateKey);
	const dateIds: string[] = dateSet ? (dateSet as unknown as string[]) : [];
	dateIds.push(id);
	await kv.set(PREFIX, dateKey, dateIds);

	// Add to unpublished set
	const unpublishedSet = await kv.get(PREFIX, getUnpublishedKey());
	const unpublishedIds: string[] = unpublishedSet
		? (unpublishedSet as unknown as string[])
		: [];
	unpublishedIds.push(id);
	await kv.set(PREFIX, getUnpublishedKey(), unpublishedIds);

	// Map link to id for lookups
	await kv.set(PREFIX, linkKey, id);
};

/**
 * Get a story by its link
 */
export const getStory = async (
	kv: KeyValueStorage,
	link: string,
): Promise<Story | null> => {
	const linkKey = getLinkToIdKey(link);
	const id = await kv.get(PREFIX, linkKey);
	if (!id) return null;

	const storyKey = getStoryKey(id as unknown as string);
	const data = await kv.get(PREFIX, storyKey);
	if (!data) return null;

	// We know it's actually a Story object, not an ArrayBuffer
	const story = data as unknown as Story;

	// Validate the story data
	const parsed = StorySchema.safeParse(story);
	return parsed.success ? parsed.data : null;
};

/**
 * Mark a story as published
 */
export const markAsPublished = async (
	kv: KeyValueStorage,
	link: string,
): Promise<void> => {
	const linkKey = getLinkToIdKey(link);
	const id = await kv.get(PREFIX, linkKey);
	if (!id) return;

	const storyKey = getStoryKey(id as unknown as string);
	const data = await kv.get(PREFIX, storyKey);
	if (!data) return;

	const story = data as unknown as Story;

	story.published = true;
	story.date_published = new Date().toISOString();

	// Update story
	await kv.set(PREFIX, storyKey, story);

	// Move from unpublished to published set
	// Get unpublished set
	const unpublishedSet = await kv.get(PREFIX, getUnpublishedKey());
	if (unpublishedSet) {
		const unpublishedIds = unpublishedSet as unknown as string[];
		// Remove the id from the array
		const updatedUnpublishedIds = unpublishedIds.filter((item) => item !== id);
		// Save back to KV
		await kv.set(PREFIX, getUnpublishedKey(), updatedUnpublishedIds);
	}

	// Add to published set
	const publishedSet = await kv.get(PREFIX, getPublishedKey());
	const publishedIds: string[] = publishedSet
		? (publishedSet as unknown as string[])
		: [];
	publishedIds.push(id as unknown as string);
	await kv.set(PREFIX, getPublishedKey(), publishedIds);
};

/**
 * Get stories by their IDs
 */
const getStoriesByIds = async (
	kv: KeyValueStorage,
	ids: string[],
): Promise<Story[]> => {
	if (ids.length === 0) return [];

	const stories: Story[] = [];

	for (const id of ids) {
		const storyKey = getStoryKey(id);
		const data = await kv.get(PREFIX, storyKey);

		if (data) {
			// Convert data to Story object
			const story = data as unknown as Story;

			// Validate with zod
			const parsed = StorySchema.safeParse(story);
			if (parsed.success) {
				stories.push(parsed.data);
			}
		}
	}

	return stories;
};

/**
 * Get all unpublished stories
 */
export const getUnpublishedStories = async (
	kv: KeyValueStorage,
): Promise<Story[]> => {
	const unpublishedSet = await kv.get(PREFIX, getUnpublishedKey());
	if (!unpublishedSet) return [];

	const ids = unpublishedSet as unknown as string[];
	const stories = await getStoriesByIds(kv, ids);

	return stories.sort(
		(a, b) =>
			new Date(b.date_added).getTime() - new Date(a.date_added).getTime(),
	);
};

/**
 * Get all published stories
 */
export const getPublishedStories = async (
	kv: KeyValueStorage,
): Promise<Story[]> => {
	const publishedSet = await kv.get(PREFIX, getPublishedKey());
	if (!publishedSet) return [];

	const ids = publishedSet as unknown as string[];
	const stories = await getStoriesByIds(kv, ids);

	return stories.sort((a, b) => {
		const dateA = a.date_published || a.date_added;
		const dateB = b.date_published || b.date_added;
		return new Date(dateB).getTime() - new Date(dateA).getTime();
	});
};

/**
 * Check if a story with the given link exists
 */
export const exists = async (
	kv: KeyValueStorage,
	link: string,
): Promise<boolean> => {
	const linkKey = getLinkToIdKey(link);
	const id = await kv.get(PREFIX, linkKey);
	return id !== null;
};

/**
 * Get stories by date range
 */
export const getStoriesByDateRange = async (
	kv: KeyValueStorage,
	startDate: Date,
	endDate: Date,
	options: {
		publishedOnly?: boolean;
		unpublishedOnly?: boolean;
		limit?: number;
	} = {},
): Promise<Story[]> => {
	const dates = getDatesInRange(startDate, endDate);

	// Get all story IDs from the date range
	const allIds: string[] = [];

	for (const date of dates) {
		const dateKey = getDateKey(date);
		const dateSet = await kv.get(PREFIX, dateKey);

		if (dateSet) {
			const dateIds = dateSet as unknown as string[];
			allIds.push(...dateIds);
		}
	}

	// Remove duplicates
	const uniqueIds = [...new Set(allIds)];

	// If we need to filter by published status
	let filteredIds = uniqueIds;
	if (options.publishedOnly || options.unpublishedOnly) {
		const statusKey = options.publishedOnly
			? getPublishedKey()
			: getUnpublishedKey();
		const statusSet = await kv.get(PREFIX, statusKey);

		if (statusSet) {
			const statusIds = statusSet as unknown as string[];
			filteredIds = uniqueIds.filter((id) => statusIds.includes(id));
		} else {
			return []; // No stories with the requested status
		}
	}

	// Apply limit if specified
	if (options.limit && options.limit > 0) {
		filteredIds = filteredIds.slice(0, options.limit);
	}

	// Fetch and parse stories
	const stories = await getStoriesByIds(kv, filteredIds);

	// Sort by date_added (or date_published for published stories)
	return stories.sort((a, b) => {
		const dateA =
			options.publishedOnly && a.date_published
				? a.date_published
				: a.date_added;
		const dateB =
			options.publishedOnly && b.date_published
				? b.date_published
				: b.date_added;
		return new Date(dateB).getTime() - new Date(dateA).getTime();
	});
};

/**
 * Get stories from the last N days
 */
export const getStoriesLastNDays = async (
	kv: KeyValueStorage,
	days: number,
	options: {
		publishedOnly?: boolean;
		unpublishedOnly?: boolean;
		limit?: number;
	} = {},
): Promise<Story[]> => {
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);

	return getStoriesByDateRange(kv, startDate, endDate, options);
};

/**
 * Update an existing story
 */
export const updateStory = async (
	kv: KeyValueStorage,
	story: Story,
): Promise<void> => {
	const linkKey = getLinkToIdKey(story.link);
	const id = await kv.get(PREFIX, linkKey);

	if (!id) {
		throw new Error(`No story found with link: ${story.link}`);
	}

	const storyKey = getStoryKey(id as unknown as string);

	// Store the updated story
	await kv.set(PREFIX, storyKey, story);
};

/**
 * Get unedited, unpublished stories
 */
export const getUneditedUnpublishedStories = async (
	kv: KeyValueStorage,
): Promise<Story[]> => {
	const unpublishedStories = await getUnpublishedStories(kv);

	// Filter for unedited stories
	const uneditedStories = unpublishedStories.filter((story) => !story.edited);

	return uneditedStories.sort(
		(a, b) =>
			new Date(b.date_added).getTime() - new Date(a.date_added).getTime(),
	);
};

/**
 * Get edited but unpublished stories
 */
export const getEditedUnpublishedStories = async (
	kv: KeyValueStorage,
): Promise<Story[]> => {
	const unpublishedStories = await getUnpublishedStories(kv);

	// Filter for edited but unpublished stories
	const editedStories = unpublishedStories.filter(
		(story) => story.edited && !story.published,
	);

	return editedStories.sort(
		(a, b) =>
			new Date(b.date_added).getTime() - new Date(a.date_added).getTime(),
	);
};

// Export all functions as a convenience object
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
