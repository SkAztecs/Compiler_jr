// Talks to the AI tutor on the server (server/tutor.js: the dev server or Cloudflare). The browser never sees
// the API key; it only sends the question and reads the answer as it streams in.

// { configured, model, needsCode }, or not configured when there is no tutor (e.g. a static build)
export async function getTutorStatus() {
    try {
        const response = await fetch('/api/tutor-status');
        if (!response.ok) return { configured: false, available: false };
        return { ...(await response.json()), available: true };
    } catch {
        return { configured: false, available: false };
    }
}

// Sends one question; onText receives the answer piece by piece. Throws with a
// readable message if the tutor refuses (not set up, wrong access code, too many questions...).
export async function askTutor(request, onText, signal, accessCode = '') {
    const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessCode ? { 'X-Tutor-Code': accessCode } : {}) },
        body: JSON.stringify(request),
        signal,
    });
    if (!response.ok) {
        let message = `The tutor is not available (${response.status}).`;
        try {
            message = (await response.json()).error ?? message;
        } catch {
            // not JSON: keep the general message
        }
        throw new Error(message);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onText(decoder.decode(value, { stream: true }));
    }
}
