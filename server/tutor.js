import Anthropic from '@anthropic-ai/sdk';
import { TUTOR_SYSTEM_PROMPT, buildUserMessage } from './tutorPrompt.js';

// The AI tutor's server side. It runs inside the Vite dev server (see vite.config.js),
// or as Cloudflare Pages Functions (see functions/), so the API key stays on the
// server and is never sent to the browser.
//
//   GET  /api/tutor-status   -> { configured, model, needsCode }
//   POST /api/explain        -> the explanation, streamed as plain text
//
// When an access code is set (TUTOR_ACCESS_CODE), every question must carry it in
// the X-Tutor-Code header, so only people who were given the code can spend the key.
//
// Costs are kept low by: a small model, short answers, low thinking effort, a cached
// system prompt, answers saved for repeated questions, and rate limits.

export const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 4000;         // a short answer plus a little thinking
const MAX_CODE_CHARS = 8000;     // larger programs are not sent
const MAX_FACTS_CHARS = 6000;
const CACHE_SIZE = 200;          // answers kept for repeated questions
const PER_MINUTE = 6;            // explanations per browser per minute
const DEFAULT_PER_DAY = 300;     // explanations in total per day (TUTOR_DAILY_LIMIT)

export class TutorError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Checks what the browser sent, and keeps it within the size limits
export function validateRequest(body) {
    if (!body || typeof body !== 'object') throw new TutorError(400, 'The request was empty.');
    const { kind, language, code, keywords } = body;
    if (kind !== 'error' && kind !== 'line' && kind !== 'complexity') throw new TutorError(400, 'Unknown kind of question.');
    if (typeof code !== 'string' || code.trim() === '') throw new TutorError(400, 'There is no program to explain.');
    if (code.length > MAX_CODE_CHARS) throw new TutorError(413, `The program is too long for the tutor (over ${MAX_CODE_CHARS.toLocaleString()} characters).`);
    const request = {
        kind,
        language: typeof language === 'string' && language.length <= 40 ? language : 'English',
        code,
        keywords: Object.fromEntries(Object.entries(keywords ?? {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 20), String(v).slice(0, 40)])),
    };
    if (kind === 'error') {
        if (!Array.isArray(body.errors) || body.errors.length === 0) throw new TutorError(400, 'There is no error to explain.');
        request.phase = String(body.phase ?? 'the compiler').slice(0, 60);
        request.errors = body.errors.slice(0, 5).map(e => ({
            line: Number.isInteger(e?.line) ? e.line : null,
            message: String(e?.message ?? '').slice(0, 500),
        }));
    } else if (kind === 'complexity') {
        if (typeof body.facts !== 'string' || body.facts.trim() === '') throw new TutorError(400, 'There is no complexity report to explain.');
        request.facts = body.facts.slice(0, MAX_FACTS_CHARS);
    } else {
        if (!Number.isInteger(body.line) || body.line < 1) throw new TutorError(400, 'There is no line to explain.');
        request.line = body.line;
        request.facts = String(body.facts ?? '').slice(0, MAX_FACTS_CHARS);
    }
    return request;
}

// keyPlace and afterSetup say where the key goes, for the "not set up" messages
export function createTutor({
    apiKey, model = DEFAULT_MODEL, client, dailyLimit = DEFAULT_PER_DAY, accessCode, now = () => Date.now(),
    keyPlace = '.env.local', afterSetup = ' and restart npm run dev',
} = {}) {
    const key = (apiKey ?? '').trim();
    const code = (accessCode ?? '').trim();
    const configured = Boolean(client) || key !== '';
    const anthropic = client ?? (configured ? new Anthropic({ apiKey: key }) : null);
    const cache = new Map();        // question -> answer (oldest first)
    const recent = new Map();       // browser -> times of its recent explanations
    let day = new Date(now()).toDateString();
    let usedToday = 0;

    const status = () => ({ configured, model, needsCode: code !== '' });

    function checkLimits(who) {
        const today = new Date(now()).toDateString();
        if (today !== day) {
            day = today;
            usedToday = 0;
        }
        if (usedToday >= dailyLimit) throw new TutorError(429, `The tutor has reached today's limit of ${dailyLimit} explanations. It resets tomorrow.`);
        const times = (recent.get(who) ?? []).filter(time => now() - time < 60000);
        if (times.length >= PER_MINUTE) throw new TutorError(429, 'Too many questions in one minute. Wait a moment and try again.');
        times.push(now());
        recent.set(who, times);
        usedToday++;
    }

    // Answers one question, calling onText with each piece of the answer as it arrives.
    // givenCode is the access code the browser sent. Returns { cached, usage }.
    async function explain(body, who, onText, givenCode = '') {
        if (!configured) throw new TutorError(503, `The tutor is not set up: add ANTHROPIC_API_KEY to ${keyPlace}${afterSetup}.`);
        if (code !== '' && String(givenCode).trim() !== code) {
            throw new TutorError(401, givenCode ? 'That access code is not right.' : 'Enter the access code to use the tutor.');
        }
        const request = validateRequest(body);
        const question = JSON.stringify(request);
        if (cache.has(question)) {
            onText(cache.get(question));
            return { cached: true, usage: null };
        }
        checkLimits(who);

        let answer = '';
        try {
            const stream = anthropic.messages.stream({
                model,
                max_tokens: MAX_TOKENS,
                output_config: { effort: 'low' }, // a short explanation needs little thinking
                system: [{ type: 'text', text: TUTOR_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: buildUserMessage(request) }],
            });
            stream.on('text', (delta) => {
                answer += delta;
                onText(delta);
            });
            const message = await stream.finalMessage();
            if (message.stop_reason === 'refusal') {
                const note = 'The tutor could not answer this question.';
                onText(answer ? `\n\n${note}` : note);
                return { cached: false, usage: message.usage };
            }
            if (message.stop_reason === 'max_tokens') onText('\n\n(The answer was cut short.)');
            else if (answer.trim() !== '') {
                cache.set(question, answer);
                if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
            }
            return { cached: false, usage: message.usage };
        } catch (error) {
            usedToday = Math.max(0, usedToday - 1); // a failed call doesn't count towards today's limit
            if (error instanceof Anthropic.AuthenticationError) throw new TutorError(502, `The API key was not accepted. Check ANTHROPIC_API_KEY in ${keyPlace}.`);
            if (error instanceof Anthropic.PermissionDeniedError) throw new TutorError(502, 'This API key is not allowed to use the tutor\'s model.');
            if (error instanceof Anthropic.RateLimitError) throw new TutorError(503, 'Claude is busy right now. Try again in a minute.');
            if (error instanceof Anthropic.APIConnectionError) throw new TutorError(503, 'Could not reach Claude. Check the internet connection.');
            if (error instanceof Anthropic.APIError) throw new TutorError(502, `Claude returned an error (${error.status ?? 'unknown'}).`);
            throw error;
        }
    }

    return { status, explain };
}

// Connect middleware for the Vite dev and preview servers
export function tutorMiddleware(tutor) {
    return async (req, res, next) => {
        const path = req.url.split('?')[0];
        if (path === '/api/tutor-status' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(tutor.status()));
            return;
        }
        if (path !== '/api/explain') {
            next();
            return;
        }
        const sendError = (status, message) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: message }));
        };
        if (req.method !== 'POST') {
            sendError(405, 'Use POST.');
            return;
        }
        let raw = '';
        for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 100000) {
                sendError(413, 'The request is too large.');
                return;
            }
        }
        let body;
        try {
            body = JSON.parse(raw);
        } catch {
            sendError(400, 'The request was not valid JSON.');
            return;
        }
        let started = false;
        try {
            await tutor.explain(body, req.socket.remoteAddress ?? 'local', (text) => {
                if (!started) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-cache');
                    started = true;
                }
                res.write(text);
            }, req.headers['x-tutor-code'] ?? '');
            res.end();
        } catch (error) {
            const message = error instanceof TutorError ? error.message : 'The tutor ran into a problem.';
            if (!(error instanceof TutorError)) console.error('[tutor]', error);
            if (started) res.end(`\n\n(The tutor stopped: ${message})`);
            else sendError(error instanceof TutorError ? error.status : 500, message);
        }
    };
}

// The same endpoints for hosts that use web Requests and Responses, such as Cloudflare
// Pages Functions. who identifies the visitor for the per-minute limit.
export async function handleTutorFetch(tutor, request, who) {
    const json = (status, value) => new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
    const path = new URL(request.url).pathname;
    if (path === '/api/tutor-status') return request.method === 'GET' ? json(200, tutor.status()) : json(405, { error: 'Use GET.' });
    if (path !== '/api/explain') return json(404, { error: 'Not found.' });
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    const raw = await request.text();
    if (raw.length > 100000) return json(413, { error: 'The request is too large.' });
    let body;
    try {
        body = JSON.parse(raw);
    } catch {
        return json(400, { error: 'The request was not valid JSON.' });
    }

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const write = (text) => writer.write(encoder.encode(text)).catch(() => {}); // the visitor may have left
    const describe = (error) => {
        if (!(error instanceof TutorError)) console.error('[tutor]', error);
        return error instanceof TutorError ? error.message : 'The tutor ran into a problem.';
    };
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const finished = tutor.explain(body, who, (text) => {
        markStarted();
        write(text);
    }, request.headers.get('X-Tutor-Code') ?? '');

    // Wait for the first piece of the answer, so an error before it is still sent as JSON
    try {
        await Promise.race([started, finished]);
    } catch (error) {
        writer.close().catch(() => {});
        return json(error instanceof TutorError ? error.status : 500, { error: describe(error) });
    }
    finished.then(
        () => writer.close().catch(() => {}),
        (error) => write(`

(The tutor stopped: ${describe(error)})`).then(() => writer.close().catch(() => {})),
    );
    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
}
