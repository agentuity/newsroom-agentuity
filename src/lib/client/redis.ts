import { Redis } from "@upstash/redis";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

let redisInstance: Redis | null = null;
let isConnected = false;

export function getRedisClient(): Redis {
	if (!redisInstance) {
		if (
			!process.env.UPSTASH_REDIS_REST_URL ||
			!process.env.UPSTASH_REDIS_REST_TOKEN
		) {
			throw new Error(
				"Redis configuration missing. Please check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables.",
			);
		}

		redisInstance = new Redis({
			url: process.env.UPSTASH_REDIS_REST_URL,
			token: process.env.UPSTASH_REDIS_REST_TOKEN,
		});

		isConnected = true;
	}

	return redisInstance;
}

export function isRedisReady(): boolean {
	return isConnected;
}
