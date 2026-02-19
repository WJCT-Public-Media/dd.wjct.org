// Dashboard Configuration

const CONFIG = {
    // Cloudflare Worker URL — proxies Linear API calls so the key stays server-side.
    WORKER_URL: 'https://dd-wjct-linear-proxy.wjct.workers.dev',

    REFRESH_INTERVAL: 10 * 60 * 1000, // 10 minutes

    // Linear team ID for "Digital Media"
    TEAM_ID: 'df1b4af7-cb32-4ca8-afdf-5333632eb6e4',
};
