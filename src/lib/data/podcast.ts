import { getRedisClient } from "../client/redis";
import { z } from "zod";
import type { Story } from "./stories";

const PREFIX = "podcast";
const redis = getRedisClient();

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

function getKey(date: Date): string {
	const dateStr = date.toISOString().split("T")[0];
	return `${PREFIX}:${dateStr}`;
}

async function save(
	transcript: PodcastTranscriptInput,
	stories: Story[],
): Promise<PodcastTranscript> {
	const key = getKey(new Date());

	const podcastData: PodcastTranscript = {
		...transcript,
		stories: stories.map((story) => ({
			headline: story.headline,
			summary: story.summary,
			link: story.link,
			date_published: story.date_published ?? "",
		})),
		date_created: new Date().toISOString(),
	};

	await redis.set(key, JSON.stringify(podcastData));

	return podcastData;
}

async function getByDate(date: Date): Promise<PodcastTranscript | null> {
	const key = getKey(date);
	const data = await redis.get<string>(key);

	if (!data) return null;

	try {
		let parsed;
		if (typeof data === "object" && data !== null) {
			parsed = PodcastTranscriptSchema.safeParse(data);
		} else if (typeof data === "string") {
			parsed = PodcastTranscriptSchema.safeParse(JSON.parse(data));
		} else {
			console.error("Unexpected data type:", typeof data);
			return null;
		}
		return parsed.success ? parsed.data : null;
	} catch (error) {
		console.error("Failed to parse podcast data:", error);
		return null;
	}
}

async function getLatest(): Promise<PodcastTranscript | null> {
	return getByDate(new Date());
}

async function getLastNDays(days: number): Promise<PodcastTranscript[]> {
	const keys = [];
	const now = new Date();

	for (let i = 0; i < days; i++) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		keys.push(getKey(date));
	}

	const pipeline = redis.pipeline();
	for (const key of keys) {
		pipeline.get(key);
	}

	const responses = await pipeline.exec();
	if (!responses) return [];

	return responses
		.filter((response): response is string => response !== null)
		.map((data) => {
			try {
				const parsed = PodcastTranscriptSchema.safeParse(JSON.parse(data));
				return parsed.success ? parsed.data : null;
			} catch (error) {
				console.error("Failed to parse podcast data:", error);
				return null;
			}
		})
		.filter(
			(transcript): transcript is PodcastTranscript => transcript !== null,
		)
		.sort(
			(a, b) =>
				new Date(b.date_created).getTime() - new Date(a.date_created).getTime(),
		);
}

async function updateAudioUrl(date: Date, audioUrl: string): Promise<void> {
	const key = getKey(date);
	const transcript = await getByDate(date);

	if (!transcript) {
		throw new Error("No podcast transcript found for the specified date");
	}

	const updatedTranscript: PodcastTranscript = {
		...transcript,
		audio_url: audioUrl,
	};

	await redis.set(key, JSON.stringify(updatedTranscript));
}

export const podcast = {
	save,
	getByDate,
	getLatest,
	getLastNDays,
	updateAudioUrl,
};
