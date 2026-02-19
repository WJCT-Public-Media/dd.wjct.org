/**
 * Cloudflare Worker: Linear API Proxy
 *
 * Proxies GraphQL requests to Linear so the API key never reaches the browser.
 * The LINEAR_API_KEY is stored as a Cloudflare secret (never in code).
 *
 * Deploy:
 *   wrangler deploy
 *
 * Set the secret:
 *   wrangler secret put LINEAR_API_KEY
 */

const LINEAR_API = 'https://api.linear.app/graphql';

const ALLOWED_ORIGINS = [
    'http://localhost:8000',
    'https://wjct-public-media.github.io',
    'https://dd.wjct.org',
];

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders(origin),
            });
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        if (!ALLOWED_ORIGINS.includes(origin)) {
            return new Response('Forbidden', { status: 403 });
        }

        const body = await request.text();

        const linearResponse = await fetch(LINEAR_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': env.LINEAR_API_KEY,
            },
            body,
        });

        const data = await linearResponse.text();

        return new Response(data, {
            status: linearResponse.status,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders(origin),
            },
        });
    },
};

function corsHeaders(origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}
