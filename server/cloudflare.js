import { createTutor, handleTutorFetch } from './tutor.js';

// The AI tutor on Cloudflare Pages. functions/api/explain.js and functions/api/tutor-status.js
// hand their requests here. The key and settings come from the Pages project's
// Variables and Secrets: ANTHROPIC_API_KEY (a secret), and optionally TUTOR_ACCESS_CODE,
// TUTOR_DAILY_LIMIT and TUTOR_MODEL.
//
// Cloudflare keeps each copy of this code running only for a while, so the saved answers
// and the rate limits are per copy: they lower the cost, but the Anthropic console's
// spending limit is what really caps it.

let tutor = null;

export function onTutorRequest({ request, env }) {
    tutor ??= createTutor({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.TUTOR_MODEL || undefined,
        dailyLimit: Number(env.TUTOR_DAILY_LIMIT) || undefined,
        accessCode: env.TUTOR_ACCESS_CODE,
        keyPlace: "the Cloudflare project's Variables and Secrets",
        afterSetup: ', then deploy again',
    });
    return handleTutorFetch(tutor, request, request.headers.get('CF-Connecting-IP') ?? 'visitor');
}
