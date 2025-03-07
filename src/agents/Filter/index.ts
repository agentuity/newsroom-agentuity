import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getTodaysResearch, type Article } from "../../../lib/data/research";
import { stories, type Story } from "../../../lib/data/stories";

// Schema for relevance check
const RelevanceSchema = z.object({
	isRelevant: z.boolean(),
	confidence: z.number().min(0).max(1),
	reason: z.string(),
});

type RelevanceCheck = z.infer<typeof RelevanceSchema>;

/**
 * Determines if a story is relevant to AI topics
 */
async function isStoryRelevant(article: {
	headline: string;
	summary: string;
}): Promise<RelevanceCheck> {
	const { object } = await generateObject({
		model: openai("gpt-4o"),
		schema: RelevanceSchema,
		prompt: `As an AI news filter, evaluate if this story is relevant to AI technology, specifically focusing on:
- Large Language Models (LLMs)
- AI Agents and Autonomous Systems
- Significant AI Industry News
- AI Research Breakthroughs
- AI Ethics and Policy

Story Headline: ${article.headline}
Story Summary: ${article.summary}

Evaluate the story's relevance to these topics and provide:
1. Whether it's relevant (true/false)
2. Confidence score (0-1)
3. Brief reason for the decision`,
	});

	return object;
}

/**
 * Checks if a story is similar to previously published stories
 */
async function isStorySimilar(
	article: {
		headline: string;
		summary: string;
		date_added: string;
	},
	publishedStories: Story[],
): Promise<{ isSimilar: boolean; confidence: number; similarTo?: string }> {
	if (publishedStories.length === 0) {
		return { isSimilar: false, confidence: 1 };
	}

	// Create a context of published story headlines and summaries with dates
	const publishedStoriesContext = publishedStories
		.map(
			(story, index) =>
				`${index + 1}. Headline: ${story.headline}\nDate Published: ${story.date_published || "N/A"}\nSummary: ${story.summary}`,
		)
		.join("\n\n");

	const { object } = await generateObject({
		model: openai("gpt-4o"),
		schema: z.object({
			isSimilar: z.boolean(),
			confidence: z.number().min(0).max(1),
			similarToIndex: z.number().optional(),
			reason: z.string(),
		}),
		prompt: `As an AI news filter, determine if this new story is substantially similar to any of our previously published stories. Consider:
- Same core news/announcement but from different sources
- Similar events or developments being reported
- Different angles on the same underlying story
- Updates or follow-ups that don't add significant new information

Important Time-Based Considerations:
- If the new story is more than 2 weeks after a similar story, check if it contains substantial new developments or information
- For ongoing topics, evaluate if enough time has passed and if there are meaningful updates
- Breaking news might have multiple valid updates in the same day
- Industry announcements might have follow-up stories with new details

New Story:
Headline: ${article.headline}
Date: ${article.date_added}
Summary: ${article.summary}

Previously Published Stories:
${publishedStoriesContext}

Evaluate if this story is substantially similar to any of the above stories and provide:
1. Whether it's similar (true/false)
2. Confidence score (0-1)
3. If similar, the index number of the similar story (1-${publishedStories.length})
4. Brief reason for the decision, including time-based considerations`,
	});

	return {
		isSimilar: object.isSimilar,
		confidence: object.confidence,
		similarTo: object.similarToIndex
			? publishedStories[object.similarToIndex - 1].headline
			: undefined,
	};
}

/**
 * Filter agent that filters research articles based on relevance and similarity
 */
export default async function FilterAgentHandler(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	try {
		ctx.logger.info("Filter: Starting to filter stories");
		// Use input articles if provided, otherwise check request body
		const json = req.json() as { articles?: Article[] };
		const inputArticles = json?.articles;
		let articles = inputArticles;
		if (!articles) {
			const json = req.json();
			if (json && typeof json === "object" && "articles" in json) {
				articles = json.articles as Article[];
			} else {
				// Get today's research articles if no articles were provided
				articles = await getTodaysResearch(ctx.kv);
			}
		}

		if (!articles || articles.length === 0) {
			ctx.logger.info("No articles to filter");
			return resp.json({ filteredStories: [] });
		}

		ctx.logger.info(`Filter: Processing ${articles.length} articles`);

		// Get published stories from the last 3 days for similarity check
		const today = new Date().toISOString().split("T")[0];
		const publishedStories = await stories.getPublished(ctx.kv, today);

		const filteredStories: Story[] = [];

		for (const article of articles) {
			// Add current date to article for similarity check
			const articleWithDate = {
				...article,
				date_added: new Date().toISOString(),
			};

			// Skip if story already exists
			if (await stories.exists(ctx.kv, article.link)) {
				ctx.logger.info(`Story already exists: ${article.headline}`);
				continue;
			}

			// Check if article is relevant
			const relevance = await isStoryRelevant(articleWithDate);
			if (!relevance.isRelevant || relevance.confidence < 0.6) {
				ctx.logger.info(
					`Article not relevant: ${article.headline} (Confidence: ${relevance.confidence})`,
				);
				ctx.logger.info(`Reason: ${relevance.reason}`);
				continue;
			}

			// Check if story is similar to any published stories
			const similarity = await isStorySimilar(
				articleWithDate,
				publishedStories,
			);
			if (similarity.isSimilar && similarity.confidence > 0.6) {
				ctx.logger.info(
					`Article is similar to existing story: ${article.headline}`,
				);
				ctx.logger.info(
					`Similar to: ${similarity.similarTo} (Confidence: ${similarity.confidence})`,
				);
				continue;
			}

			// Convert relevant and unique article to a story
			const storyData: Omit<Story, "id"> = {
				...article,
				published: false,
				edited: false,
				date_added: articleWithDate.date_added,
			};

			// Add the story to storage
			await stories.add(ctx.kv, storyData);

			// Now fetch the complete story (with ID) to add to filtered stories
			const completeStory = await stories.get(ctx.kv, storyData.link);
			if (completeStory) {
				filteredStories.push(completeStory);
			}

			ctx.logger.info(`Added new story: ${article.headline}`);
			ctx.logger.info(`Relevance confidence: ${relevance.confidence}`);
			ctx.logger.info(`Reason: ${relevance.reason}`);
		}

		ctx.logger.info(
			`Filter: Finished filtering. Found ${filteredStories.length} relevant stories`,
		);

		// Return as response if called directly as an agent
		return resp.json({ stories: filteredStories });
	} catch (error) {
		ctx.logger.error("Error in FilterAgent:", error);
		throw error;
	}
}
