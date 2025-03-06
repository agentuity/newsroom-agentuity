/**
 * KV helper, ported from old redis setup to the new KV storage
 */

import type { KeyValueStorage } from "@agentuity/sdk";
import { z } from "zod";
import type { Story } from "./stories";

const PREFIX = "podcast";

// Podcast transcript schema and type
export const PodcastTranscriptSchema = z.object({
	intro: z.string(),
	segments: z.array(
		z.object({
			headline: z.string(),
			content: z.string(),
			transition: z.string().optional(),
		}),
	),
	outro: z.string(),
	stories: z
		.array(
			z.object({
				headline: z.string(),
				summary: z.string(),
				link: z.string(),
				date_published: z.string(),
			}),
		)
		.optional(),
	date_created: z.string(),
	audio_url: z.string().optional(),
});

export type PodcastTranscript = z.infer<typeof PodcastTranscriptSchema>;

type PodcastTranscriptInput = {
	intro: string;
	segments: {
		headline: string;
		content: string;
		transition?: string;
	}[];
	outro: string;
	audio_url?: string;
};

/**
 * Format a date as YYYY-MM-DD for storage
 */
const formatDate = (date: Date): string => {
	return date.toISOString().split("T")[0];
};

/**
 * Get storage key for a specific date
 */
const getKey = (date: Date): string => {
	const dateStr = formatDate(date);
	return dateStr;
};

/**
 * Save a new podcast transcript
 */
export const save = async (
	kv: KeyValueStorage,
	transcript: PodcastTranscriptInput,
	stories: Story[],
): Promise<PodcastTranscript> => {
	const key = getKey(new Date());

	const podcastData: PodcastTranscript = {
		...transcript,
		stories: stories.map((story) => ({
			headline: story.headline,
			summary: story.summary,
			link: story.link,
			date_published: story.date_published || new Date().toISOString(),
		})),
		date_created: new Date().toISOString(),
	};

	await kv.set(PREFIX, key, podcastData);

	return podcastData;
};

/**
 * Get a podcast transcript by date
 */
export const getByDate = async (
	kv: KeyValueStorage,
	date: Date,
): Promise<PodcastTranscript | null> => {
	const key = getKey(date);
	const data = await kv.get(PREFIX, key);

	if (!data) return null;

	// Data is already in the right format, but TypeScript doesn't know
	const transcript = data as unknown as PodcastTranscript;

	// Validate with zod
	const parsed = PodcastTranscriptSchema.safeParse(transcript);
	return parsed.success ? parsed.data : null;
};

/**
 * Get the latest podcast transcript
 */
export const getLatest = async (
	kv: KeyValueStorage,
): Promise<PodcastTranscript | null> => {
	return getByDate(kv, new Date());
};

/**
 * Get podcast transcripts for the last N days
 */
export const getLastNDays = async (
	kv: KeyValueStorage,
	days: number,
): Promise<PodcastTranscript[]> => {
	const transcripts: PodcastTranscript[] = [];
	const now = new Date();

	for (let i = 0; i < days; i++) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		const transcript = await getByDate(kv, date);

		if (transcript) {
			transcripts.push(transcript);
		}
	}

	// Sort by date, newest first
	return transcripts.sort(
		(a, b) =>
			new Date(b.date_created).getTime() - new Date(a.date_created).getTime(),
	);
};

/**
 * Update the audio URL for an existing podcast transcript
 */
export const updateAudioUrl = async (
	kv: KeyValueStorage,
	date: Date,
	audioUrl: string,
): Promise<void> => {
	const key = getKey(date);
	const transcript = await getByDate(kv, date);

	if (!transcript) {
		throw new Error("No podcast transcript found for the specified date");
	}

	const updatedTranscript: PodcastTranscript = {
		...transcript,
		audio_url: audioUrl,
	};

	await kv.set(PREFIX, key, updatedTranscript);
};

// Export functions as a convenience object
export const podcast = {
	save,
	getByDate,
	getLatest,
	getLastNDays,
	updateAudioUrl,
};
