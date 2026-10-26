// Tests for the AI tutor's server side. Claude is replaced by a fake client,
// so these tests never use an API key or cost anything. Run with: npm test
import assert from 'node:assert/strict';
import process from 'node:process';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { createTutor, tutorMiddleware, handleTutorFetch, validateRequest, DEFAULT_MODEL } from '../server/tutor.js';
import { onTutorRequest } from '../server/cloudflare.js';
import worker from '../server/worker.js';
import { TUTOR_SYSTEM_PROMPT } from '../server/tutorPrompt.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failed++;
        console.log(`  FAIL ${name}\n       ${String(error.stack ?? error).split('\n').slice(0, 6).join('\n       ')}`);
    }
}

// A stand-in for the Anthropic client: records each request and streams a fixed answer
function fakeClient({ answer = 'This is the explanation.', stopReason = 'end_turn', failWith = null } = {}) {
    const requests = [];
    return {
        requests,
        messages: {
            stream(params) {
                requests.push(params);
                const listeners = [];
                return {
                    on(event, listener) {
                        if (event === 'text') listeners.push(listener);
                        return this;
                    },
                    async finalMessage() {
                        if (failWith) throw failWith;
                        for (const piece of answer.match(/.{1,8}/gs) ?? []) listeners.forEach(listener => listener(piece));
                        return { stop_reason: stopReason, usage: { input_tokens: 900, output_tokens: 120 } };
                    },
                };
            },
        },
    };
}

const errorQuestion = (overrides = {}) => ({
    kind: 'error',
    language: 'Tamil',
    code: 'மாறி total = 0;\nபதிப்பி(totl);',
    keywords: { let: 'மாறி', print: 'பதிப்பி' },
    phase: 'semantic analysis',
    errors: [{ line: 2, message: "'totl' is not declared. Did you mean 'total'?" }],
    ...overrides,
});

async function collect(tutor, question, who = 'student-1') {
    let text = '';
    const result = await tutor.explain(question, who, piece => { text += piece; });
    return { text, ...result };
}

console.log('AI tutor (server side, fake Claude)');

await test('without a key the tutor says how to set it up', async () => {
    const tutor = createTutor({ apiKey: '' });
    assert.deepEqual(tutor.status(), { configured: false, model: DEFAULT_MODEL, needsCode: false });
    await assert.rejects(collect(tutor, errorQuestion()), /add ANTHROPIC_API_KEY to \.env\.local/);
});

await test('questions are checked and kept small', () => {
    assert.throws(() => validateRequest({ kind: 'poem', code: 'x' }), /Unknown kind/);
    assert.throws(() => validateRequest({ kind: 'error', code: '  ' }), /no program/);
    assert.throws(() => validateRequest({ kind: 'line', code: 'print(1);', line: 0 }), /no line/);
    assert.throws(() => validateRequest({ kind: 'error', code: 'x'.repeat(9000), errors: [{}] }), /too long/);
    const request = validateRequest(errorQuestion({ errors: Array.from({ length: 9 }, () => ({ line: 1, message: 'm'.repeat(900) })) }));
    assert.equal(request.errors.length, 5);
    assert.equal(request.errors[0].message.length, 500);
});

await test('Claude Haiku 5.5 is asked with a cached system prompt, low effort and the compiler facts', async () => {
    const client = fakeClient();
    const tutor = createTutor({ client });
    const { text, cached } = await collect(tutor, errorQuestion());
    assert.equal(text, 'This is the explanation.');
    assert.equal(cached, false);
    const [request] = client.requests;
    assert.equal(request.model, 'claude-haiku-5-5');
    assert.deepEqual(request.output_config, { effort: 'low' });
    assert.ok(!('temperature' in request) && !('thinking' in request));
    assert.deepEqual(request.system, [{ type: 'text', text: TUTOR_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    const message = request.messages[0].content;
    for (const expected of ['Request: explain this error.', 'Answer in: Tamil.', 'let -> மாறி', '  2 | பதிப்பி(totl);',
        '<compiler_errors phase="semantic analysis">', "line 2: 'totl' is not declared"]) {
        assert.ok(message.includes(expected), `missing "${expected}" in:\n${message}`);
    }
});

await test('a line question sends what every compiler phase did with it', async () => {
    const client = fakeClient();
    await collect(createTutor({ client }), { kind: 'line', language: 'Hindi', code: 'let a = 1;', line: 1, facts: '1. Lexer: tokens\n    LET let' });
    const message = client.requests[0].messages[0].content;
    assert.ok(message.includes('The student is asking about line 1.'));
    assert.ok(message.includes('<compiler_facts>\n1. Lexer: tokens'));
});

await test('a complexity question sends the advisor report and asks for checked improvements', async () => {
    const client = fakeClient();
    await collect(createTutor({ client }), {
        kind: 'complexity', language: 'English', code: 'let n = 9;', facts: 'Time:   O(n²)\nMeasured: grows like n².',
    });
    const message = client.requests[0].messages[0].content;
    assert.ok(message.includes('Request: explain the time and space complexity of this program, and how to improve it.'));
    assert.ok(message.includes('<complexity_report>\nTime:   O(n²)'));
    assert.ok(TUTOR_SYSTEM_PROMPT.includes('the compiler will run it to check'));
    assert.throws(() => validateRequest({ kind: 'complexity', code: 'x', facts: '  ' }), /no complexity report/);
});

await test('asking the same question again reuses the saved answer for free', async () => {
    const client = fakeClient();
    const tutor = createTutor({ client });
    await collect(tutor, errorQuestion());
    const again = await collect(tutor, errorQuestion());
    assert.equal(again.cached, true);
    assert.equal(again.text, 'This is the explanation.');
    assert.equal(client.requests.length, 1);
    await collect(tutor, errorQuestion({ language: 'English' })); // a different language is a new question
    assert.equal(client.requests.length, 2);
});

await test('rate limits: 6 questions a minute per student, and a daily total', async () => {
    let time = Date.parse('2026-10-25T10:00:00');
    const tutor = createTutor({ client: fakeClient(), now: () => time, dailyLimit: 8 });
    const question = (i) => errorQuestion({ code: `print(${i});` });
    for (let i = 0; i < 6; i++) await collect(tutor, question(i));
    await assert.rejects(collect(tutor, question(6)), /Too many questions in one minute/);
    await collect(tutor, question(6), 'student-2'); // another student is not blocked
    time += 61000;
    await collect(tutor, question(7));
    await assert.rejects(collect(tutor, question(8)), /today's limit of 8/);
    time += 24 * 3600 * 1000;
    await collect(tutor, question(8)); // a new day
});

await test('a refusal or a cut-off answer is not saved for reuse', async () => {
    const refusing = fakeClient({ answer: '', stopReason: 'refusal' });
    const tutor = createTutor({ client: refusing });
    assert.match((await collect(tutor, errorQuestion())).text, /could not answer/);
    await collect(tutor, errorQuestion());
    assert.equal(refusing.requests.length, 2);
    const cut = fakeClient({ stopReason: 'max_tokens' });
    const tutor2 = createTutor({ client: cut });
    assert.match((await collect(tutor2, errorQuestion())).text, /cut short/);
});

await test('API errors become clear messages, and do not use up the daily limit', async () => {
    const authError = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
    const tutor = createTutor({ client: fakeClient({ failWith: authError }), dailyLimit: 1 });
    await assert.rejects(collect(tutor, errorQuestion()), /API key was not accepted/);
    await assert.rejects(collect(tutor, errorQuestion()), /API key was not accepted/); // not "daily limit"
});

await test('the HTTP endpoints stream the answer and report errors as JSON', async () => {
    const tutor = createTutor({ client: fakeClient({ answer: 'Streaming works.' }) });
    const middleware = tutorMiddleware(tutor);
    const server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('next'); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const status = await (await fetch(`${base}/api/tutor-status`)).json();
        assert.deepEqual(status, { configured: true, model: 'claude-haiku-5-5', needsCode: false });
        const answer = await fetch(`${base}/api/explain`, { method: 'POST', body: JSON.stringify(errorQuestion()) });
        assert.equal(answer.status, 200);
        assert.equal(await answer.text(), 'Streaming works.');
        const bad = await fetch(`${base}/api/explain`, { method: 'POST', body: '{"kind":"poem"}' });
        assert.equal(bad.status, 400);
        assert.match((await bad.json()).error, /Unknown kind/);
        assert.equal(await (await fetch(`${base}/somewhere-else`)).text(), 'next');
    } finally {
        server.close();
    }
});

await test('with an access code set, only questions that carry it are answered', async () => {
    const client = fakeClient();
    const tutor = createTutor({ client, accessCode: ' class2026 ' });
    assert.equal(tutor.status().needsCode, true);
    const ask = (code) => tutor.explain(errorQuestion(), 'student-1', () => {}, code);
    await assert.rejects(ask(''), /Enter the access code/);
    await assert.rejects(ask('wrong'), /access code is not right/);
    assert.equal(client.requests.length, 0); // nothing was sent to Claude
    await ask('class2026');
    assert.equal(client.requests.length, 1);
});

await test('the Cloudflare handler streams answers and sends errors as JSON', async () => {
    const tutor = createTutor({ client: fakeClient({ answer: 'Streaming on Cloudflare.' }), accessCode: 'abc' });
    const post = (body, code) => new Request('https://compiler.example/api/explain', {
        method: 'POST', body, headers: code ? { 'X-Tutor-Code': code } : {},
    });
    const status = await handleTutorFetch(tutor, new Request('https://compiler.example/api/tutor-status'), 'v1');
    assert.deepEqual(await status.json(), { configured: true, model: 'claude-haiku-5-5', needsCode: true });
    const answer = await handleTutorFetch(tutor, post(JSON.stringify(errorQuestion()), 'abc'), 'v1');
    assert.equal(answer.status, 200);
    assert.equal(await answer.text(), 'Streaming on Cloudflare.');
    const noCode = await handleTutorFetch(tutor, post(JSON.stringify(errorQuestion())), 'v1');
    assert.equal(noCode.status, 401);
    assert.match((await noCode.json()).error, /access code/);
    const bad = await handleTutorFetch(tutor, post('{"kind":"poem"}', 'abc'), 'v1');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Unknown kind/);
    const broken = await handleTutorFetch(tutor, post('{', 'abc'), 'v1');
    assert.equal(broken.status, 400);
});

await test('a Cloudflare error after the answer started is added to the streamed text', async () => {
    const client = fakeClient();
    client.messages.stream = () => ({
        on(event, listener) { if (event === 'text') this.listener = listener; return this; },
        async finalMessage() { this.listener('Part of it'); throw new Error('connection dropped'); },
    });
    const original = console.error;
    console.error = () => {}; // the handler logs unexpected errors
    try {
        const response = await handleTutorFetch(createTutor({ client }), new Request('https://compiler.example/api/explain', {
            method: 'POST', body: JSON.stringify(errorQuestion()),
        }), 'v1');
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'Part of it\n\n(The tutor stopped: The tutor ran into a problem.)');
    } finally {
        console.error = original;
    }
});

await test('the Cloudflare function reads the key from the project settings', async () => {
    const response = await onTutorRequest({ request: new Request('https://compiler.example/api/explain', {
        method: 'POST', body: JSON.stringify(errorQuestion()),
    }), env: {} });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Cloudflare project's Variables and Secrets, then deploy again/);
});

await test('the Cloudflare Worker sends /api/ to the tutor and everything else to the built files', async () => {
    const assets = { fetch: async (request) => new Response(`file ${new URL(request.url).pathname}`) };
    const page = await worker.fetch(new Request('https://compiler.example/assets/index.js'), { ASSETS: assets });
    assert.equal(await page.text(), 'file /assets/index.js');
    const status = await worker.fetch(new Request('https://compiler.example/api/tutor-status'), { ASSETS: assets });
    assert.deepEqual(await status.json(), { configured: false, model: 'claude-haiku-5-5', needsCode: false });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
