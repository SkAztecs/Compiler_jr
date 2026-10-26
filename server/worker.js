import { onTutorRequest } from './cloudflare.js';

// The whole app as one Cloudflare Worker (see wrangler.jsonc). Cloudflare serves the
// built files in dist/ by itself; requests that match no file come here, and the
// tutor answers the /api/ ones.
export default {
    async fetch(request, env) {
        if (new URL(request.url).pathname.startsWith('/api/')) return onTutorRequest({ request, env });
        return env.ASSETS.fetch(request);
    },
};
