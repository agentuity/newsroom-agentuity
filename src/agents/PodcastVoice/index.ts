import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { podcast, type PodcastTranscript } from "../../../lib/data/podcast";
import fs from "node:fs/promises";
import path from "node:path";
import { S3Client } from "bun";

const ELEVEN_LABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const VOICE_ID = "nPczCjzI2devNBz1zQrb";
const ELEVEN_LABS_API_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

// Initialize R2 client
const r2Client = new S3Client({
	accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
	secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
	bucket: process.env.R2_BUCKET_NAME || "",
	endpoint: `https://${process.env.R2_ACCOUNT_ID || ""}.r2.cloudflarestorage.com`,
});

/**
 * Format a podcast transcript into a single string for TTS
 */
function formatTranscriptForVoice(transcript: PodcastTranscript): string {
	let scriptText = `${transcript.intro}\n\n`;

	// Add each segment
	transcript.segments.forEach((segment, index) => {
		scriptText += `${segment.headline}\n`;
		scriptText += `${segment.content}\n`;

		// Add transition if it exists and it's not the last segment
		if (segment.transition && index < transcript.segments.length - 1) {
			scriptText += `${segment.transition}\n\n`;
		}
	});

	// Add outro
	scriptText += transcript.outro;

	return scriptText;
}

/**
 * Generate audio using Eleven Labs API
 */
async function generateAudio(
	text: string,
	logger: AgentContext["logger"],
): Promise<ArrayBuffer> {
	logger.info("Calling Eleven Labs API to generate audio");

	const response = await fetch(
		`${ELEVEN_LABS_API_URL}?output_format=mp3_44100_128`,
		{
			method: "POST",
			headers: {
				"xi-api-key": ELEVEN_LABS_API_KEY,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text: text,
				model_id: "eleven_multilingual_v2",
			}),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Eleven Labs API error: ${response.status} ${errorText}`);
	}

	return await response.arrayBuffer();
}

/**
 * Save audio file locally in development mode
 */
async function saveLocally(
	filename: string,
	audioBuffer: ArrayBuffer,
	logger: AgentContext["logger"],
) {
	if (process.env.NODE_ENV === "development") {
		const localDir = path.join(process.cwd(), "tmp");
		await fs.mkdir(localDir, { recursive: true });
		await fs.writeFile(path.join(localDir, filename), Buffer.from(audioBuffer));
		logger.info(`Saved locally to: tmp/${filename}`);
	}
}

/**
 * Upload audio to R2 storage
 */
async function uploadToR2(
	filename: string,
	audioBuffer: ArrayBuffer,
	logger: AgentContext["logger"],
): Promise<string> {
	const s3File = r2Client.file(`podcasts/${filename}`);
	await s3File.write(Buffer.from(audioBuffer), {
		type: "audio/mpeg",
	});
	logger.info(`Uploaded to R2: podcasts/${filename}`);

	// Return the public URL
	return `${process.env.R2_PUBLIC_URL}/podcasts/${filename}`;
}

/**
 * PodcastVoice agent that generates audio from podcast transcripts
 */
export default async function PodcastVoiceAgentHandler(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	ctx.logger.info("PodcastVoice: Starting to generate audio for podcast");

	// Get transcript from request or latest
	let transcript: PodcastTranscript | null = null;

	// Check if request contains a transcript ID or date
	const requestData = req.json();
	if (requestData && typeof requestData === "object") {
		if ("transcript" in requestData) {
			transcript = requestData.transcript as PodcastTranscript;
		} else {
			transcript = await podcast.getLatest(ctx.kv);
		}
	}

	if (!transcript) {
		// Check if we found a transcript
		ctx.logger.error("PodcastVoice: No transcript found");
		return await resp.json({
			success: false,
			error: "No transcript found",
		});
	}

	if (transcript.audio_url) {
		// Check if transcript already has audio
		ctx.logger.info("PodcastVoice: Transcript already has audio");
		return await resp.json({
			success: true,
			message: "Transcript already has audio",
			audioUrl: transcript.audio_url,
		});
	}

	// Format the transcript text
	const scriptText = formatTranscriptForVoice(transcript);

	// Generate audio
	const audioBuffer = await generateAudio(scriptText, ctx.logger);

	// Generate filename based on date
	const transcriptDate = new Date(transcript.date_created);
	const date = transcriptDate.toISOString().split("T")[0];
	const filename = `podcast-${date}.mp3`;

	// Save locally in development
	await saveLocally(filename, audioBuffer, ctx.logger);

	// Upload to R2
	let audioUrl: string;
	try {
		audioUrl = await uploadToR2(filename, audioBuffer, ctx.logger);

		// Update the podcast record with the audio URL
		await podcast.updateAudioUrl(ctx.kv, transcriptDate, audioUrl);
		ctx.logger.info("PodcastVoice: Updated podcast record with audio URL");
	} catch (error) {
		ctx.logger.error("PodcastVoice: Failed to upload to R2", error);
		return await resp.json({
			success: false,
			error: `Failed to upload to R2: ${error}`,
		});
	}

	// Return success response
	return await resp.json({
		success: true,
		filename,
		audioUrl,
	});
}
