import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import {
	getStoriesByDateRange,
	getUnpublishedStories,
	exists,
	addStory,
	markAsPublished,
	StorySchema,
	type Story,
} from "../../lib/data/stories";
import FirecrawlApp from "@mendable/firecrawl-js";

// Initialize Firecrawl
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// Schema for enhanced content
const EnhancedContentSchema = z.object({
	headline: z.string(),
	summary: z.string(),
	body: z.string(),
	tags: z.array(z.string()),
	reason: z.string(),
});

type EnhancedContent = z.infer<typeof EnhancedContentSchema>;

// Define metadata types
interface MetadataObject {
	[key: string]: string | number | boolean | null | undefined;
	ogImage?: string;
	"og:image"?: string;
}

// Template patterns based on source type
const TEMPLATES = {
	github: `# {headline}

{summary}

{body}

[View on GitHub]({link})`,
	blog: `# {headline}

{summary}

{body}

[Read the full article]({link})`,
	default: `# {headline}

{summary}

{body}

[Read more]({link})`,
};

// Token limit configurations for GPT-4o
const MAX_TOKENS_PER_REQUEST = 25000; // Leave some room for the response
const AVERAGE_CHARS_PER_TOKEN = 4; // Rough estimate for English text
const MAX_CHARS = MAX_TOKENS_PER_REQUEST * AVERAGE_CHARS_PER_TOKEN;
const MAX_STORIES_TO_PROCESS = 10; // Maximum number of stories to process

/**
 * Truncate content to fit within token limits
 */
function truncateContent(content: string, maxChars: number): string {
	if (!content || content.length <= maxChars) return content;

	// Keep the first third and last third of the content to maintain context
	const thirdLength = Math.floor(maxChars / 3);
	const firstPart = content.slice(0, thirdLength);
	const lastPart = content.slice(-thirdLength);

	return `${firstPart}\n\n[Content truncated for length...]\n\n${lastPart}`;
}

/**
 * Enhance content of a story using AI
 */
async function enhanceContent(
	story: Story,
	logger: AgentContext["logger"],
): Promise<EnhancedContent & { metadata?: MetadataObject; images?: string[] }> {
	// First, get additional content from the source using Firecrawl
	logger.info(`Scraping content from: ${story.link}`);
	const scrapeResult = (await firecrawl.scrapeUrl(story.link, {
		formats: ["markdown"],
	})) as {
		success: boolean;
		markdown?: string;
		metadata?: MetadataObject;
	};

	const sourceContent = scrapeResult.success ? scrapeResult.markdown || "" : "";
	const metadata = scrapeResult.success ? scrapeResult.metadata : undefined;

	// Extract images from metadata
	const images: string[] = [];
	if (metadata) {
		if (metadata.ogImage) images.push(metadata.ogImage);
		if (metadata["og:image"]) images.push(metadata["og:image"]);
	}

	const template = story.source.includes("github.com")
		? TEMPLATES.github
		: story.source.includes("blog") || story.source.includes("news")
			? TEMPLATES.blog
			: TEMPLATES.default;

	// Truncate the source content if it's too long
	const truncatedContent = truncateContent(sourceContent, MAX_CHARS);

	// Truncate metadata if needed
	const truncatedMetadata = metadata
		? JSON.stringify(metadata).slice(0, 1000)
		: "";

	// Generate enhanced content using GPT-4
	logger.info(`Enhancing content for: ${story.headline}`);
	const { object } = await generateObject({
		model: openai("gpt-4o"),
		schema: EnhancedContentSchema,
		prompt: `As an AI technology news editor, enhance this article to be more engaging and informative.
Make it fun and exciting while maintaining accuracy. Focus on why readers should care.

Original Headline: ${story.headline}
Original Summary: ${story.summary}
Source Type: ${story.source}
Original Content: ${truncatedContent}
${truncatedMetadata ? `\nMetadata: ${truncatedMetadata}` : ""}

Use this template structure for your response:
${template}

Create:
1. An enhanced headline that's catchy but accurate (max 100 characters). Avoid using "New" unless it is. Avoid "Unleash" and "Revolutionize" and other hyperbolic language.  Be matter of fact - not clickbaity.
2. A compelling summary that makes readers want to learn more (2-3 sentences max)
3. A concise body in markdown format. You can include sections like "What's New", "Key Takeaways", "Technical Details", or "Impact" if relevant - but only if they add value
4. Relevant hashtag-style tags (lowercase, no spaces)
5. A brief reason explaining the enhancements

Keep the content concise and impactful. For technical content (like GitHub), focus on implementation and impact.
For news/blogs, focus on implications and real-world applications.${truncatedContent !== sourceContent ? "\n\nNote: The original content was truncated for length." : ""}`,
	});

	return {
		...object,
		metadata,
		images: images.length > 0 ? images : undefined,
	};
}

// Add utility function for delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Batch size and delay configuration
const BATCH_SIZE = 3; // Process 3 stories at a time
const DELAY_BETWEEN_STORIES = 1000; // 1 second delay between stories
const DELAY_BETWEEN_BATCHES = 5000; // 5 second delay between batches

/**
 * Update a story with enhanced content
 */
async function updateStoryWithContent(
	story: Story,
	enhanced: EnhancedContent & { images?: string[] },
	logger: AgentContext["logger"],
): Promise<string> {
	try {
		// First check if the story exists
		const storyExists = await exists(story.link);
		const now = new Date().toISOString();

		if (!storyExists) {
			// If the story doesn't exist, add it directly with enhanced content
			logger.info(
				`Story not found in data store, adding enhanced version: ${story.headline}`,
			);

			await addStory({
				headline: enhanced.headline,
				summary: enhanced.summary,
				body: enhanced.body,
				tags: enhanced.tags,
				link: story.link,
				source: story.source,
				date_added: story.date_added || now,
				edited: true,
				published: true,
				date_published: now,
				images: enhanced.images,
			});
		} else {
			// If it exists, update it with enhanced content and mark as published
			// The markAsPublished function should update the relevant fields
			await markAsPublished(story.link);
		}

		return story.link;
	} catch (error) {
		logger.error(
			`Error updating story: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

/**
 * Editor agent that enhances unedited stories with improved content
 */
export default async function EditorAgentHandler(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	ctx.logger.info("Editor: Starting to enhance stories");

	// Use input stories if provided, otherwise check request body
	const json = req.data ? (req.data.json as { stories?: Story[] }) : {};
	let uneditedStories = json?.stories;
	if (!uneditedStories) {
		uneditedStories = await getUnpublishedStories();
	}

	if (!uneditedStories || uneditedStories.length === 0) {
		ctx.logger.info("No unedited stories to process");
		return await resp.json({ links: [] });
	}

	// Limit to MAX_STORIES_TO_PROCESS
	if (uneditedStories.length > MAX_STORIES_TO_PROCESS) {
		ctx.logger.info(
			`Limiting processing to ${MAX_STORIES_TO_PROCESS} stories out of ${uneditedStories.length} available`,
		);
		uneditedStories = uneditedStories.slice(0, MAX_STORIES_TO_PROCESS);
	}

	ctx.logger.info(
		`Editor: Processing ${uneditedStories.length} unedited stories`,
	);

	// Store only links instead of full story objects
	const editedLinks: string[] = [];

	// Process stories in batches
	for (let i = 0; i < uneditedStories.length; i += BATCH_SIZE) {
		const batch = uneditedStories.slice(i, i + BATCH_SIZE);
		ctx.logger.info(
			`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(uneditedStories.length / BATCH_SIZE)}`,
		);

		// Process each story in the batch
		for (const story of batch) {
			ctx.logger.info(`Enhancing story: ${story.headline}`);

			try {
				// Get enhanced content
				const enhanced = await enhanceContent(story, ctx.logger);

				// Update the story with enhanced content
				const storyLink = await updateStoryWithContent(
					story,
					enhanced,
					ctx.logger,
				);
				editedLinks.push(storyLink);

				ctx.logger.info(`Enhanced and published story: ${enhanced.headline}`);
				ctx.logger.info(`Reason for changes: ${enhanced.reason}`);
				ctx.logger.info(`Added tags: ${enhanced.tags.join(", ")}`);

				// Add delay between stories to avoid rate limits
				await delay(DELAY_BETWEEN_STORIES);
			} catch (error) {
				ctx.logger.error(
					`Error processing story ${story.headline}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Add delay between batches to avoid rate limits
		if (i + BATCH_SIZE < uneditedStories.length) {
			ctx.logger.info(
				`Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`,
			);
			await delay(DELAY_BETWEEN_BATCHES);
		}
	}

	ctx.logger.info(`Processed ${editedLinks.length} stories successfully`);

	return await resp.json({
		links: editedLinks,
	});
}
