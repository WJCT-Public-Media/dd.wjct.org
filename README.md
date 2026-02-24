# WJCT Digital Media Department Dashboard

Real-time project status and metrics dashboard for the Digital Media Department.

## Features

- 📊 Real-time issue tracking from Linear
- 🚨 Urgent deadline alerts (next 7 days)
- 🔥 Active work overview
- 🚧 Blocked issues tracking
- 📈 Visual metrics and charts
- 🔄 Auto-refresh every 10 minutes
- 📱 Mobile-friendly responsive design

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Data Source:** Linear API (GraphQL)
- **Charts:** Chart.js
- **Hosting:** GitHub Pages → dd.wjct.org

## Setup for Development

1. **Configure API Key:**
   ```bash
   # Copy config template
   cp config.js config.local.js
   
   # Edit config.local.js and add your Linear API key
   # Get key from: https://linear.app/settings/api
   ```

2. **Test locally:**
   ```bash
   # Simple HTTP server
   python3 -m http.server 8000
   # or
   npx http-server
   
   # Open: http://localhost:8000
   ```

3. **Update config.js with actual key** (for testing only - don't commit!)

## Deployment

### Option 1: GitHub Pages (Initial Testing)

1. Create GitHub repo: `wjct-digital-dashboard`
2. Push code to `main` branch
3. Enable GitHub Pages in repo settings
4. Access at: `https://wjct.github.io/wjct-digital-dashboard`

### Option 2: dd.wjct.org (Production)

1. Build static files
2. Configure DNS: `dd.wjct.org` CNAME to hosting
3. Deploy via:
   - Cloudflare Pages
   - Netlify
   - GitHub Pages with custom domain
   - Direct WJCT server

## Security Considerations

⚠️ **IMPORTANT:** Do not expose Linear API credentials in client-side code.

### Current security model (implemented)

- The dashboard calls a Cloudflare Worker proxy (`worker.js`) instead of calling Linear directly.
- The Linear API key is stored as a Cloudflare secret (`LINEAR_API_KEY`), not in browser JS.
- Worker CORS is restricted via `ALLOWED_ORIGINS` to approved hosts (e.g., `dd.wjct.org`, approved localhost/dev origins).
- Browser requests must be `POST` with JSON; unsupported methods are rejected.

### Operational safeguards

- Keep `config.local.js` and any local secret-bearing files out of Git.
- Review and minimize `ALLOWED_ORIGINS` before production deploys.
- Rotate `LINEAR_API_KEY` periodically and immediately on suspected exposure.
- Prefer read-only scoped access for dashboard workloads where possible.

### Recommended hardening (next)

1. Add lightweight auth at the Worker edge (token/header allowlist) for non-public environments.
2. Add request validation/rate limiting in the Worker.
3. Add periodic audit of Worker secrets and allowed origins.

## Current Status

- ✅ Dashboard UI complete
- ✅ Linear API integration working
- ✅ Real-time data updates
- ✅ Responsive design
- ⏳ Authentication pending
- ⏳ Production deployment pending

## Roadmap

- [ ] Add Google OAuth authentication
- [ ] Build backend proxy for API key security
- [ ] Add filtering/search capabilities
- [ ] Add team member breakdown
- [ ] Deploy to dd.wjct.org
- [ ] Add email alerts for urgent deadlines
- [ ] Add historical trend charts

## Maintenance

**Updating the dashboard:**
1. Make changes to local files
2. Test locally
3. Push to GitHub
4. GitHub Pages auto-deploys (or manual deploy to dd.wjct.org)

**API Key Rotation:**
1. Generate new Linear API key
2. Update config (backend or frontend depending on approach)
3. Test thoroughly
4. Revoke old key

## Files

- `index.html` - Main dashboard page
- `styles.css` - Styling and layout
- `dashboard.js` - Data fetching and rendering logic
- `config.js` - Configuration (API key, settings)
- `README.md` - This file

## Support

For issues or questions:
- Ray Hollister: rhollister@wjct.org
- Linear: DM-690

## License

Internal WJCT tool - Not for public distribution
