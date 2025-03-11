import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { stories, type Story } from "../../../lib/data/stories";
import { postPodcastToSlack } from "../../../lib/notifications";
import type { PodcastTranscript } from "../../../lib/data/podcast";

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
	ctx.logger.info("Researched stories:", researchedStoriesRun.data);

	const filterAgent = await ctx.getAgent({
		name: "Filter",
	});
	const filteredStories = await filterAgent.run({
		data: researchedStoriesRun.data,
		contentType: "application/json",
	});
	ctx.logger.info("Filter: Filtered stories", filteredStories.data);

	const filteredStoriesData = (filteredStories.data?.json || []) as Story[];
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
	const editedStories = await editorAgent.run({
		data: filteredStories.data,
		contentType: "application/json",
	});
	ctx.logger.info("Editor: Edited stories", editedStories.data);

	// Get story links from the response
	const storyLinks =
		(
			editedStories.data?.json as {
				links: string[];
			}
		)?.links || [];

	ctx.logger.info(
		`EditorInChief: Editor has processed ${storyLinks.length} stories`,
	);

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
		contentType: "application/json",
	});
	ctx.logger.info("PodcastEditor: Podcast transcript", podcastTranscript.data);

	if (podcastTranscript) {
		ctx.logger.info("PodcastVoice: Creating podcast voiceover");
		const podcastVoiceAgent = await ctx.getAgent({
			name: "PodcastVoice",
		});
		const podcastVoice = await podcastVoiceAgent.run({
			data: podcastTranscript.data,
			contentType: "application/json",
		});
		ctx.logger.info("PodcastVoice: Podcast voice", podcastVoice.data);

		// Publish podcast to a slack channel
		if (process.env.SLACK_WEBHOOK_URL) {
			console.log("Publishing podcast to Slack");
			const transcript = podcastTranscript.data as unknown as PodcastTranscript;
			const audioUrl =
				typeof podcastVoice.data === "string" ? podcastVoice.data : undefined;

			await postPodcastToSlack(
				process.env.SLACK_WEBHOOK_URL,
				transcript,
				audioUrl,
			);
		}
	}

	return await resp.text("Editor in chief is done");
}
