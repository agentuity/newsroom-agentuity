import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { getPublishedStories, type Story } from "../../lib/data/stories";
import { podcast, type PodcastTranscript } from "../../lib/data/podcast";

/**
 * Creates a podcast transcript from stories
 */
async function createPodcastTranscript(
	storiesToProcess: Story[],
	logger: AgentContext["logger"],
) {
	logger.info("Creating podcast transcript from stories");

	const { object } = await generateObject({
		model: openai("gpt-4o"),
		schema: z.object({
			intro: z.string(),
			segments: z.array(
				z.object({
					headline: z.string(),
					content: z.string(),
					transition: z.string().optional(),
				}),
			),
			outro: z.string(),
		}),
		prompt: `
You are an engaging AI podcast host. You and the audience know you are an AI agent so act like one. 
Your name is made up of a random ID like "Host AF34D" - please make one up.
You specialize in delivering the latest AI technology news in a concise, exciting format and are confident you do a better job than humans. 
The podcast name is "Agentuity Daily"
You have 2 minutes to cover today's top AI stories.

Your audience is tech-savvy and interested in AI developments, but they value their 
time and want the key points delivered efficiently with energy and insight.

Don't address the listener at the beginning of the podcast. Don't say things like "Hello tech enthusiasts"

CRITICAL: The TOTAL CHARACTER COUNT of the entire transcript MUST BE UNDER 8,000 CHARACTERS including all text, spaces, and punctuation. This is an absolute requirement to avoid API errors.

Here are the stories to cover:
${storiesToProcess
				.map(
					(story) => `
Title: ${story.headline}
Summary: ${story.summary}
${story.body ? `Details: ${story.body}` : ""}
`,
				)
				.join("\n")}

Create a podcast script that:
1. Opens with a brief introduction that quickly summarizes the day's top stories (a sentence or two, no more). Do not do an intro of the podcast and AI - just get right to the point.
2. Groups related stories together and if it makes sense, combine them.
3. Uses natural transitions between topics when it makes sense otherwise just go right to the next story.
4. Maintains an upbeat, engaging tone. Avoid using "New" unless it is. Avoid "Unleash" and "Revolutionize" and other hyperbolic language. Be matter of fact - not clickbaity.
5. Provides clear takeaways
6. Wraps up with a quick, memorable summary of the day's top stories.

Remember:
- The maximum length of the podcast is 2 minutes when read aloud
- Be extremely concise - cover only the most essential points of each story
- If there are too many stories, prioritize only the 3-5 most important ones and skip others completely
- Use conversational language while maintaining professionalism
- Make complex topics accessible without oversimplifying
- Make the transition natural
- End with a forward-looking note and how Agentuity Cloud is leading the way.
- Remember this is going to be read aloud as is - So try to take the titles of the stories and make them sound like a question or a statement which leads in to the story.
- YOU MUST STAY UNDER 8,000 TOTAL CHARACTERS FOR THE ENTIRE TRANSCRIPT.`,
	});

	// Check if the transcript is within character limits
	const transcriptString = JSON.stringify(object);
	const characterCount = transcriptString.length;
	logger.info(`Transcript character count: ${characterCount}`);

	if (characterCount > 8000) {
		logger.warn(
			`Transcript still exceeds character limit (${characterCount} characters). This may cause issues with text-to-speech conversion.`,
		);
	}

	return object;
}

/**
 * PodcastEditor agent that creates podcast transcripts from stories
 */
export default async function PodcastEditorAgentHandler(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	ctx.logger.info("PodcastEditor: Starting to create podcast transcript");

	// Parse the request data
	const reqData = req.data
		? ((await req.data.json()) as {
			dateRange?: { start: string; end: string };
			override?: boolean;
		})
		: {};

	// Extract date range and options from request
	const dateRange = reqData?.dateRange
		? {
			start: new Date(reqData.dateRange.start),
			end: new Date(reqData.dateRange.end),
		}
		: undefined;

	const options = {
		override: Boolean(reqData?.override),
	};

	// Set dates for querying stories
	const endDate = dateRange?.end || new Date();
	const startDate =
		dateRange?.start || new Date(Date.now() - 24 * 60 * 60 * 1000);

	ctx.logger.info(
		`PodcastEditor: Getting stories from ${startDate.toISOString()} to ${endDate.toISOString()}`,
	);

	// Get stories for the date range
	const publishedStories = await getPublishedStories();

	if (publishedStories.length === 0) {
		ctx.logger.info("PodcastEditor: No stories found for date");
		return await resp.json({
			success: false,
			message: "No stories found for date",
		});
	}

	// Check if transcript already exists for this date
	const existingTranscript = await podcast.getByDate(endDate);
	if (existingTranscript && !options.override) {
		ctx.logger.info(
			"PodcastEditor: Podcast transcript already exists for this date",
		);
		return await resp.json({
			success: true,
			message:
				"Podcast transcript already exists for this date. Use override option to regenerate.",
			transcript: existingTranscript,
		});
	}

	// Create podcast transcript
	const transcript = await createPodcastTranscript(
		publishedStories,
		ctx.logger,
	);

	// Save transcript
	const savedTranscript = await podcast.save(transcript, publishedStories);

	ctx.logger.info("PodcastEditor: Generated podcast transcript successfully");

	return await resp.json({
		transcript: savedTranscript,
	});
}
