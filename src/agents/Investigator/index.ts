import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { research, type Article } from "../../lib/data/research";

// Initialize Firecrawl
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// Default content sources
const DEFAULT_SOURCES = [
	"https://news.ycombinator.com/",
	"https://techcrunch.com/latest/",
	"https://openai.com/news/",
	"https://www.anthropic.com/news",
	"https://aisecret.us/",
	"https://www.theneurondaily.com/",
];

// Schema for scraping instructions
const ScrapeSchema = z.object({
	stories: z
		.array(
			z.object({
				headline: z.string().describe("Story or post headline"),
				summary: z.string().describe("A summary of the story or post"),
				body: z.string().describe("The body of the story or post").optional(),
				link: z.string().describe("A link to the post or story"),
				images: z
					.array(z.string())
					.describe("Images from the story or post")
					.optional(),
				date_posted: z
					.string()
					.describe("The date the story or post was published")
					.optional(),
			}),
		)
		.describe("The latest trending news on AI, agents, LLMs, etc."),
});

// Handle scraping sources
const scrapeSources = async (sources: string[]): Promise<Article[]> => {
	const combinedStories: Article[] = [];

	for (const source of sources) {
		const prompt = `
You are an investigative news reporter. You are tasked with finding the latest trending 
news on AI agents which includes - LLMs, Agents, and other AI related topics.
Return AI related stories or posts headlines and links in JSON format from the page content.
The summary is something that you think is interesting about the story - make it short, concise but click worthy and exciting.
The site you are researching is ${source}. For the summary, make sure to consider the site and it's audience, when you create the summary.
The body is the full text of the story or post, if you can get it. Convert and format this as markdown.
The images are the images from the story or post, if you can get them. They need to be absolute links to the image.

The format should be:
{
  "stories": [
    {
      "headline": "headline1",
      "summary": "summary1",
      "link": "link1",
      "date_posted": "YYYY-MM-DD",
      "body": "body1",
      "images": ["image1", "image2", "image3"]
    },
    ...
  ]
}

The source link is ${source}. 
If a story link is not absolute, prepend ${source} to make it absolute. 
Return only pure JSON in the specified format (no extra text, no markdown, no \`\`\`).`;

		try {
			// Convert Zod schema to JSON Schema explicitly to satisfy Firecrawl API validation
			const jsonSchema = zodToJsonSchema(ScrapeSchema);
			const result = await firecrawl.extract([source], {
				prompt,
				schema: jsonSchema,
			});

			if (!result.success) {
				console.error(`Failed to scrape ${source}: ${result.error}`);
				continue;
			}

			const todayStories = result.data.stories.map((story: Article) => ({
				...story,
				source,
				date_found: new Date().toISOString(),
			}));

			console.log(`Found ${todayStories.length} stories from ${source}`);
			combinedStories.push(...todayStories);
		} catch (error: unknown) {
			if (
				error &&
				typeof error === "object" &&
				"statusCode" in error &&
				error.statusCode === 429
			) {
				console.error(
					`Rate limit exceeded for ${source}. Skipping this source.`,
				);
			} else {
				console.error(`Error scraping source ${source}:`, error);
			}
		}
	}

	return combinedStories;
};

export default async function InvestigatorAgentHandler(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	ctx.logger.info("Investigator: Start looking for stories");
	const json = req.data ? (await req.data.json()) as { dynamicSources?: string[] } : {};
	const dynamicSources = json?.dynamicSources;
	const sources = [...DEFAULT_SOURCES, ...(dynamicSources ?? [])];

	ctx.logger.info("Sources to research:", sources);

	if (!dynamicSources?.length) {
		// Check research first if no dynamic sources
		const todaysResearch = await research.getToday();
		if (todaysResearch) {
			ctx.logger.info("Using today's research");
			return await resp.json({
				articles: todaysResearch,
			});
		}
	}

	// Scrape fresh articles
	const articles = await scrapeSources(sources);

	if (articles.length > 0) {
		// Save research if we found any articles
		await research.save(articles, "investigator");
		ctx.logger.info(`Saved ${articles.length} articles to research`);
	} else {
		ctx.logger.info("No articles found to save");
	}

	return resp.json(
		{
			articles,
		},
		{
			sourcesUsed: sources,
		},
	);
}
