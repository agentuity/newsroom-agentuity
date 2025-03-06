import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import FilterAgentHandler from "../Filter";
import { stories } from "../../../lib/data/stories";
import { postPodcastToSlack } from "../../../lib/notifications";
import type { PodcastTranscript } from "../../../lib/data/podcast";

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
		// id: "agent_KqdnT67c9b6a8gm4tNUGHR86liUC2dd5",
		name: "Investigator",
	});
	const researchedStories = await investigatorAgent.run();
	ctx.logger.info("Investigator: Stories", researchedStories);

	const filterAgent = await ctx.getAgent({
		name: "Filter",
	});
	const filteredStories = await filterAgent.run(researchedStories.payload);
	ctx.logger.info("Filter: Filtered stories", filteredStories);

	const editorAgent = await ctx.getAgent({
		name: "Editor",
	});
	const editedStories = await editorAgent.run(filteredStories.payload);
	ctx.logger.info("Editor: Edited stories", editedStories);

	// Publish stories - Just auto publish for now until the approve step is implemented above.
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
		dateRange: {
			start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			end: new Date().toISOString(),
		},
	});

	if (podcastTranscript) {
		console.log("PodcastVoice: Creating podcast voiceover");
		const podcastVoiceAgent = await ctx.getAgent({
			name: "PodcastVoice",
		});
		const podcastVoice = await podcastVoiceAgent.run(podcastTranscript.payload);

		// Publish podcast to a slack channel
		if (process.env.SLACK_WEBHOOK_URL) {
			console.log("Publishing podcast to Slack");
			await postPodcastToSlack(
				process.env.SLACK_WEBHOOK_URL,
				podcastTranscript.payload as PodcastTranscript,
				podcastVoice.payload as string,
			);
		}
	}

	return resp.text("Editor in chief is done");
}
