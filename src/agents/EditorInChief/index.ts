import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { stories } from "../../../lib/data/stories";
import { postPodcastToSlack } from "../../../lib/notifications";
import type { PodcastTranscript } from "../../../lib/data/podcast";
import type { Article } from "../../../lib/data/research";

// TODO
// Right now this runs the entire flow end to end - but in reality the research stories
// agent can run at a certain time on an interval, separate from the Editor In Chief agent.
// We'll need to refactor this to support that.

type EditorInChiefAction = "full-workflow" | "podcast-only";

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
		contentType: "application/json" 
	});
	// Use the new Data interface to access the payload
	const decodedResearchedStoriesPayload = (researchedStoriesRun as any).data.json;
	ctx.logger.info("Researched stories:", decodedResearchedStoriesPayload);

	const filterAgent = await ctx.getAgent({
		name: "Filter",
	});
	const filteredStories = await filterAgent.run({
		data: decodedResearchedStoriesPayload,
		contentType: "application/json"
	});
	// Use the new Data interface to access the payload
	const decodedFilteredStoriesPayload = (filteredStories as any).data.json;
	ctx.logger.info("Filter: Filtered stories", decodedFilteredStoriesPayload);

	const editorAgent = await ctx.getAgent({
		name: "Editor",
	});
	const editedStories = await editorAgent.run({
		data: decodedFilteredStoriesPayload,
		contentType: "application/json"
	});
	// Use the new Data interface to access the payload
	const decodedEditedStoriesPayload = (editedStories as any).data.json;
	ctx.logger.info("Editor: Edited stories", decodedEditedStoriesPayload);

	// Publish stories
	const unpublishedStories = await stories.getEditedUnpublished(ctx.kv);
	console.log(`EditorInChief: Publishing ${unpublishedStories.length} stories`);
	for (const story of unpublishedStories) {
		console.log(`Publishing: ${story.headline}`);
		await stories.markAsPublished(ctx.kv, story.link);
	}

	// Prep for podcast
	const podcastEditorAgent = await ctx.getAgent({
		name: "PodcastEditor",
	});
	const podcastTranscript = await podcastEditorAgent.run({
		data: {
			dateRange: {
				start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				end: new Date().toISOString(),
			},
		},
		contentType: "application/json"
	});
	// Use the new Data interface to access the payload
	const decodedPodcastTranscriptPayload = (podcastTranscript as any).data.json;
	ctx.logger.info(
		"PodcastEditor: Podcast transcript",
		decodedPodcastTranscriptPayload,
	);

	if (podcastTranscript) {
		console.log("PodcastVoice: Creating podcast voiceover");
		const podcastVoiceAgent = await ctx.getAgent({
			name: "PodcastVoice",
		});
		const podcastVoice = await podcastVoiceAgent.run({
			data: decodedPodcastTranscriptPayload,
			contentType: "application/json"
		});
		// Use the new Data interface to access the payload
		const decodedPodcastVoicePayload = (podcastVoice as any).data.json;
		console.log("PodcastVoice: Podcast voice", decodedPodcastVoicePayload);

		// Publish podcast to a slack channel
		if (process.env.SLACK_WEBHOOK_URL) {
			console.log("Publishing podcast to Slack");
			await postPodcastToSlack(
				process.env.SLACK_WEBHOOK_URL,
				decodedPodcastTranscriptPayload as PodcastTranscript,
				decodedPodcastVoicePayload as string,
			);
		}
	}

	return await resp.text("Editor in chief is done");
}
