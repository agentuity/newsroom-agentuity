import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import type { Story } from "../../lib/data/stories";
import { postPodcastToSlack } from "../../lib/notifications";
import type { PodcastTranscript } from "../../lib/data/podcast";

// TODO
// Right now this runs the entire flow end to end - but in reality the research stories
// agent can run at a certain time on an interval, separate from the Editor In Chief agent.
// We'll need to refactor this to support that.

export default async function EditorInChiefAgentHandler(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	/**
	 * This segment is a full workflow segment
	 */
	const investigatorAgent = await ctx.getAgent({
		name: "Investigator",
	});
	const researchedStoriesRun = await investigatorAgent.run({
		data: {},
		contentType: "application/json",
	});
	const researchedStoriesJson = researchedStoriesRun.data ? await researchedStoriesRun.data.json() : {};
	ctx.logger.info("Researched stories:", researchedStoriesJson);
	const researchedStories = researchedStoriesJson as {
		articles: Story[];
	};

	if (researchedStories?.articles?.length === 0) {
		ctx.logger.info("No articles found to process");
		return await resp.text("No articles found to process");
	}

	const filterAgent = await ctx.getAgent({
		name: "Filter",
	});
	const filteredStoriesRun = await filterAgent.run({
		data: researchedStoriesJson,
		contentType: "application/json",
	});
	const filteredStoriesJson = filteredStoriesRun.data ? await filteredStoriesRun.data.json() : [];
	ctx.logger.info("Filter: Filtered stories", filteredStoriesJson);

	const filteredStoriesData = filteredStoriesJson as Story[];
	if (filteredStoriesData.length === 0) {
		ctx.logger.info("No filtered stories to process, skipping editor step");
		return await resp.text(
			"No filtered stories to process, skipping editor step",
		);
	}

	// Kick off editors
	const editorAgent = await ctx.getAgent({
		name: "Editor",
	});
	const editedStoriesRun = await editorAgent.run({
		data: filteredStoriesJson,
		contentType: "application/json",
	});
	const editedStoriesJson = editedStoriesRun.data ? await editedStoriesRun.data.json() : { links: [] };
	ctx.logger.info("Editor: Edited stories", editedStoriesJson);

	const editedStoriesData = editedStoriesJson as {
		links: string[];
	};
	if (editedStoriesData.links?.length === 0) {
		ctx.logger.info("No stories to process, skipping podcast step");
		return await resp.text("No stories to process, skipping podcast step");
	}

	// Get story links from the response
	const storyLinks = editedStoriesData.links || [];

	ctx.logger.info(
		`EditorInChief: Editor has processed ${storyLinks.length} stories`,
	);

	// Prep for podcast
	const podcastEditorAgent = await ctx.getAgent({
		name: "PodcastEditor",
	});
	const podcastTranscriptRun = await podcastEditorAgent.run({
		data: {
			dateRange: {
				start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				end: new Date().toISOString(),
			},
		},
		contentType: "application/json",
	});
	const podcastTranscriptJson = podcastTranscriptRun.data ? await podcastTranscriptRun.data.json() : null;
	ctx.logger.info("PodcastEditor: Podcast transcript", podcastTranscriptJson);

	if (podcastTranscriptJson) {
		ctx.logger.info("PodcastVoice: Creating podcast voiceover");
		const podcastVoiceAgent = await ctx.getAgent({
			name: "PodcastVoice",
		});
		const podcastVoice = await podcastVoiceAgent.run({
			data: podcastTranscriptJson,
			contentType: "application/json",
		});
		const podcastVoiceJson = podcastVoice.data ? await podcastVoice.data.json() : {};
		ctx.logger.info("PodcastVoice: Podcast voice", podcastVoiceJson);

		// Publish podcast to a slack channel
		if (process.env.SLACK_WEBHOOK_URL) {
			console.log("Publishing podcast to Slack");
			const transcript = podcastTranscriptJson as PodcastTranscript;
			const responseData = podcastVoiceJson as {
				success?: boolean;
				filename?: string;
				audioUrl?: string;
			};
			const audioUrl = responseData?.audioUrl;

			await postPodcastToSlack(
				process.env.SLACK_WEBHOOK_URL,
				transcript,
				audioUrl,
			);
		}
	}

	return await resp.text("Editor in chief is done");
}
