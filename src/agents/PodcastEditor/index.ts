import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { stories, type Story } from "../../../lib/data/stories";
import { podcast, type PodcastTranscript } from "../../../lib/data/podcast";

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
You have 4 minutes to cover today's top AI stories.

Your audience is tech-savvy and interested in AI developments, but they value their 
time and want the key points delivered efficiently with energy and insight.

Don't address the listener at the beginning of the podcast. Don't say things like "Hello tech enthusiasts"

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
3. Uses natural transitions between topics when it makes sense otherwise just go right to the next story. Ensure there is a pause between each story.
4. Maintains an upbeat, engaging tone. Avoid using "New" unless it is. Avoid "Unleash" and "Revolutionize" and other hyperbolic language. Be matter of fact - not clickbaity.
5. Provides clear takeaways
6. Wraps up with a quick, memorable summary of the day's top stories.

Remember:
- The maximum length of the podcast is 4 minutes when read aloud - it can be less if the stories are short
- Use conversational language while maintaining professionalism
- Make complex topics accessible without oversimplifying
- Make the transition natural, don't stop and pause ... just go to one to the next like a conversation.
- End with a forward-looking note and how Agentuity Cloud is leading the way.
- Remember this is going to be read aloud as is - So try to take the titles of the stories and make them sound like a question or a statement which leads in to the story.`,
	});

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
	const reqData = req.json() as {
		dateRange?: { start: string; end: string };
		override?: boolean;
	};

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
	const publishedStories = await stories.getByDateRange(
		ctx.kv,
		startDate,
		endDate,
		{
			publishedOnly: true,
		},
	);

	if (publishedStories.length === 0) {
		ctx.logger.info("PodcastEditor: No stories found for date range");
		return resp.json({
			success: false,
			message: "No stories found for date range",
		});
	}

	// Check if transcript already exists for this date
	const existingTranscript = await podcast.getByDate(ctx.kv, endDate);
	if (existingTranscript && !options.override) {
		ctx.logger.info(
			"PodcastEditor: Podcast transcript already exists for this date",
		);
		return resp.json({
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
	const savedTranscript = await podcast.save(
		ctx.kv,
		transcript,
		publishedStories,
	);

	ctx.logger.info("PodcastEditor: Generated podcast transcript successfully");

	return resp.json({
		transcript: savedTranscript,
	});
}
