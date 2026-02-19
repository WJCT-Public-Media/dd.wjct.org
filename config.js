// Dashboard Configuration

const CONFIG = {
    // Cloudflare Worker URL — proxies Linear API calls so the key stays server-side.
    // After deploying worker.js, replace this with your actual Worker URL.
    // Example: 'https://dd-wjct-linear-proxy.rayhollister.workers.dev'
    WORKER_URL: 'https://dd-wjct-linear-proxy.wjct.workers.dev',

    REFRESH_INTERVAL: 10 * 60 * 1000, // 10 minutes
};
