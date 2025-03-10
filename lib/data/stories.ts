/**
 * Ultra-simple stories data management - inspired by research.ts
 */

import type { KeyValueStorage, Json } from "@agentuity/sdk";
import { z } from "zod";

const PREFIX = "stories-simple"; // Use a new prefix to avoid conflicts

// Story schema and type
export const StorySchema = z.object({
	id: z.string(),
	headline: z.string(),
	summary: z.string(),
	link: z.string(),
	source: z.string(),
	date_added: z.string(),
	edited: z.boolean().default(false),
	published: z.boolean().default(false),
	date_published: z.string().optional(),
	body: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export type Story = z.infer<typeof StorySchema>;

// Daily stories collection
interface StoriesCollection {
	stories: Story[];
	updated: string;
}

// Link lookup table - simple object mapping links to story IDs
interface LinkLookup {
	[link: string]: string; // maps link to story ID
}

// Helper functions
const generateId = (): string => {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const getTodayKey = (): string => {
	const date = new Date().toISOString().split("T")[0];
	return `day:${date}`;
};

const getDateKey = (date: string): string => {
	return `day:${date}`;
};

// Core functions

/**
 * Get the stories collection for a specific date
 */
async function getStoriesForDate(
	kv: KeyValueStorage,
	date: string,
): Promise<StoriesCollection> {
	const key = getDateKey(date);
	const data = await kv.get(PREFIX, key);

	if (data) {
		// Make sure we always have a stories array, even if data exists but stories is missing
		const collection = data as unknown as StoriesCollection;
		if (!collection.stories) {
			collection.stories = [];
		}
		return collection;
	}

	// If no data, return an empty collection
	return {
		stories: [],
		updated: new Date().toISOString(),
	};
}

/**
 * Save the stories collection for a specific date
 */
async function saveStoriesForDate(
	kv: KeyValueStorage,
	date: string,
	collection: StoriesCollection,
): Promise<void> {
	try {
		console.log(
			`Saving stories collection for date ${date} with ${collection.stories?.length || 0} stories`,
		);

		// Ensure the collection object is valid
		if (!collection) {
			throw new Error(
				"Invalid collection object: collection is null or undefined",
			);
		}

		// Ensure stories array exists
		if (!collection.stories) {
			collection.stories = [];
		}

		const key = getDateKey(date);
		collection.updated = new Date().toISOString();

		console.log(PREFIX, key, collection);
		await kv.set(
			PREFIX,
			key,
			collection as unknown as Json,
			{ ttl: 365 * 24 * 60 * 60 },
		); // 1 year TTL in seconds
		console.log(`Successfully saved stories for date ${date}`);
	} catch (err) {
		console.error(`Error saving stories for date ${date}:`, err);
		throw err;
	}
}

/**
 * Get the link lookup table
 */
async function getLinkLookup(kv: KeyValueStorage): Promise<LinkLookup> {
	try {
		const data = await kv.get(PREFIX, "links");

		if (data) {
			const lookup = data as unknown as LinkLookup;
			// Ensure it's a valid object
			if (lookup && typeof lookup === "object") {
				return lookup;
			}
		}

		// If no data or invalid data, return empty object
		return {};
	} catch (err) {
		console.error("Error retrieving link lookup:", err);
		return {};
	}
}

/**
 * Save the link lookup table
 */
async function saveLinkLookup(
	kv: KeyValueStorage,
	lookup: LinkLookup,
): Promise<void> {
	try {
		// Create a new object instead of reassigning parameter
		const safeObject = lookup || {};
		await kv.set(PREFIX, "links", safeObject, { ttl: 365 * 24 * 60 * 60 }); // 1 year TTL in seconds
	} catch (err) {
		console.error("Error saving link lookup:", err);
		throw err;
	}
}
/**
 * Add a new story to storage
 */
export const addStory = async (
	kv: KeyValueStorage,
	storyData: Omit<Story, "id">,
): Promise<void> => {
	try {
		// Generate ID and create full story object
		const id = generateId();
		const story: Story = {
			id,
			...storyData,
			edited: storyData.edited || false,
			published: storyData.published || false,
		};

		// Default date_added if missing
		if (!story.date_added) {
			story.date_added = new Date().toISOString();
		}

		// Get date in YYYY-MM-DD format
		const date = story.date_added.split("T")[0];

		// Get existing stories for this date
		const storiesCollection = await getStoriesForDate(kv, date);

		// Ensure stories array exists
		if (!storiesCollection.stories) {
			storiesCollection.stories = [];
		}

		// Add the new story
		storiesCollection.stories.push(story);
		console.log(
			`Adding story to collection: ${story.headline}`,
			storiesCollection.stories.length,
		);

		// Save the updated collection
		await saveStoriesForDate(kv, date, storiesCollection);

		// Update link lookup
		const lookup = await getLinkLookup(kv);
		lookup[story.link] = id;
		await saveLinkLookup(kv, lookup);

		console.log(`Added story "${story.headline}" with ID ${id}`);
	} catch (err) {
		console.error("Error adding story:", err);
		throw err;
	}
};

/**
 * Check if a story with the given link exists
 */
export const exists = async (
	kv: KeyValueStorage,
	link: string,
): Promise<boolean> => {
	const lookup = await getLinkLookup(kv);
	return !!lookup[link];
};

/**
 * Find a story by link across all collections
 */
export const getStory = async (
	kv: KeyValueStorage,
	link: string,
): Promise<Story | null> => {
	// Check link lookup first
	const lookup = await getLinkLookup(kv);
	const id = lookup[link];

	if (!id) {
		return null;
	}

	// Get today's date as default
	const today = new Date().toISOString().split("T")[0];

	// Try last 7 days (reasonable window to search)
	for (let i = 0; i < 7; i++) {
		const date = new Date();
		date.setDate(date.getDate() - i);
		const dateStr = date.toISOString().split("T")[0];

		const collection = await getStoriesForDate(kv, dateStr);
		const story = collection.stories.find((s) => s.id === id);

		if (story) {
			return story;
		}
	}

	return null;
};

/**
 * Get all stories for a specific date
 */
export const getStoriesByDate = async (
	kv: KeyValueStorage,
	date: string = new Date().toISOString().split("T")[0],
): Promise<Story[]> => {
	const collection = await getStoriesForDate(kv, date);
	return collection.stories;
};

/**
 * Get stories for today
 */
export const getTodaysStories = async (
	kv: KeyValueStorage,
): Promise<Story[]> => {
	const today = new Date().toISOString().split("T")[0];
	return getStoriesByDate(kv, today);
};

/**
 * Get unedited stories for today
 */
export const getUneditedStories = async (
	kv: KeyValueStorage,
	date: string = new Date().toISOString().split("T")[0],
): Promise<Story[]> => {
	const stories = await getStoriesByDate(kv, date);
	return stories.filter((story) => !story.edited && !story.published);
};

/**
 * Get edited but unpublished stories
 */
export const getEditedUnpublishedStories = async (
	kv: KeyValueStorage,
	date: string = new Date().toISOString().split("T")[0],
): Promise<Story[]> => {
	const stories = await getStoriesByDate(kv, date);
	return stories.filter((story) => story.edited && !story.published);
};

/**
 * Get published stories
 */
export const getPublishedStories = async (
	kv: KeyValueStorage,
	date: string = new Date().toISOString().split("T")[0],
): Promise<Story[]> => {
	const stories = await getStoriesByDate(kv, date);
	return stories.filter((story) => story.published);
};

/**
 * Update a story with new data
 */
export const updateStory = async (
	kv: KeyValueStorage,
	link: string,
	updates: Partial<Story>,
): Promise<void> => {
	// Find the story's ID
	const lookup = await getLinkLookup(kv);
	const id = lookup[link];

	if (!id) {
		throw new Error(`No story found with link: ${link}`);
	}

	// Try last 7 days to find the story
	let found = false;
	for (let i = 0; i < 7; i++) {
		const date = new Date();
		date.setDate(date.getDate() - i);
		const dateStr = date.toISOString().split("T")[0];

		const collection = await getStoriesForDate(kv, dateStr);
		const storyIndex = collection.stories.findIndex((s) => s.id === id);

		if (storyIndex !== -1) {
			// Update the story
			const story = collection.stories[storyIndex];
			Object.assign(story, updates);

			// Always mark as edited
			if (!updates.edited) {
				story.edited = true;
			}

			// Save the collection
			await saveStoriesForDate(kv, dateStr, collection);
			found = true;
			break;
		}
	}

	if (!found) {
		throw new Error(`Story with ID ${id} not found in recent dates`);
	}
};

/**
 * Mark a story as edited
 */
export const markAsEdited = async (
	kv: KeyValueStorage,
	link: string,
): Promise<void> => {
	await updateStory(kv, link, { edited: true });
};

/**
 * Mark a story as published
 */
export const markAsPublished = async (
	kv: KeyValueStorage,
	link: string,
): Promise<void> => {
	await updateStory(kv, link, {
		published: true,
		date_published: new Date().toISOString(),
	});
};

/**
 * Debug function to see what's in storage
 */
export const debugKvContent = async (kv: KeyValueStorage): Promise<void> => {
	// Check today's stories
	const today = new Date().toISOString().split("T")[0];
	const collection = await getStoriesForDate(kv, today);

	console.log(`Today (${today}) has ${collection.stories.length} stories:`);
	// Use for...of instead of forEach
	for (const story of collection.stories) {
		console.log(
			`- ${story.headline} (${story.edited ? "edited" : "unedited"}, ${story.published ? "published" : "unpublished"})`,
		);
	}

	// Check link lookup
	const lookup = await getLinkLookup(kv);
	console.log(`Link lookup has ${Object.keys(lookup).length} entries`);
};

/**
 * Legacy compatibility function
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
	const today = new Date().toISOString().split("T")[0];

	if (options.publishedOnly) {
		return getPublishedStories(kv, today);
	}

	if (options.unpublishedOnly) {
		const unedited = await getUneditedStories(kv, today);
		const editedUnpublished = await getEditedUnpublishedStories(kv, today);
		return [...unedited, ...editedUnpublished];
	}

	return getStoriesByDate(kv, today);
};

// Export all functions as a convenience object
export const stories = {
	add: addStory,
	get: getStory,
	exists,
	getByDate: getStoriesByDate,
	getToday: getTodaysStories,
	getUnedited: getUneditedStories,
	getEditedUnpublished: getEditedUnpublishedStories,
	getPublished: getPublishedStories,
	markAsEdited,
	markAsPublished,
	update: updateStory,
	debug: debugKvContent,
	getLastNDays: getStoriesLastNDays,
};
