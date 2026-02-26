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
    'http://127.0.0.1:8000',
    'http://10.0.0.202:8000',
    'http://hollister-home-server.tail32ad5b.ts.net:8000',
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

        if (!isAllowedOrigin(origin)) {
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

function isAllowedOrigin(origin) {
    if (ALLOWED_ORIGINS.includes(origin)) return true;

    try {
        const url = new URL(origin);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

        // Allow Tailscale direct-IP access from office/home.
        // Support both default HTTP origin (:80 implied, port="") and explicit :8000 local dev.
        if (url.protocol === 'http:' && (url.port === '' || url.port === '8000')) {
            const m = url.hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
            if (m) {
                const a = Number(m[1]);
                const b = Number(m[2]);
                // Tailscale IPv4 CGNAT range: 100.64.0.0/10
                if (a === 100 && b >= 64 && b <= 127) return true;
            }
        }
    } catch {
        return false;
    }

    return false;
}

function corsHeaders(origin) {
    if (!isAllowedOrigin(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}
