# WJCT Digital Media Department Dashboard — Project Handoff

## Overview

This is a web dashboard for WJCT Public Media's Digital Media department, intended to be deployed at **dd.wjct.org**. It provides a real-time view of the department's Linear project management data for non-technical stakeholders (David and Geri). The project was started by an OpenClaw AI agent (Tiberius) and is being handed off for completion.

**Linear Issue:** [DM-690](https://linear.app/wjct/issue/DM-690/build-digital-media-department-dashboard-ddwjctorg)  
**Status:** In Review (past due date of Feb 10, 2026)  
**Priority:** High  
**Assignee:** Ray Hollister

## Project Location

```
/Users/rayhollister/Dev/dashboards/dd.wjct.org
```

This was copied from the OpenClaw workspace backup at `/Volumes/Macintosh HD-1/Users/rayhollister/openclaw-backup/workspace/digital-dashboard/`. There may be a `test-local.sh` script to spin it up locally.

## What Was Built (MVP)

According to the build notes, the following features were completed:

- Clean, responsive UI with real-time Linear data
- Summary cards: Urgent, Active, Blocked, Done issue counts
- Urgent deadlines section (next 7 days)
- Active work overview
- Blocked issues tracking
- Projects overview
- Metrics chart
- Local test script (`test-local.sh`, serves on http://localhost:8000)

## What Still Needs to Be Done

### 1. Audit the existing code
- Examine the full codebase — it was AI-generated in one session and may have rough edges
- Check if it's vanilla JS/HTML or React
- Verify the Linear API integration is working and using proper error handling
- Check for hardcoded API keys or tokens that need to be moved to environment variables

### 2. Authentication — Google OAuth2
- Restrict access to @wjct.org email addresses only
- Use Google OAuth2 for sign-in
- This is a requirement from the Linear issue spec

### 3. Linear API Integration
- The dashboard pulls from the WJCT Linear workspace
- Team: "Digital Media" (team ID: df1b4af7-cb32-4ca8-afdf-5333632eb6e4)
- Should show: active issues, upcoming deadlines, project health, metrics
- Auto-refresh every 10 minutes
- The Linear API key should be stored securely, NOT in client-side code
  - If the dashboard is purely client-side (GitHub Pages), the API key is exposed. Consider adding a lightweight backend or using a serverless function to proxy Linear API requests.

### 4. Export to PDF
- Users (David/Geri) should be able to export the current dashboard view as a PDF

### 5. Mobile-friendly
- The spec requires mobile responsiveness — verify this works on phone/tablet

### 6. Git Setup
- Initialize a git repo if one doesn't exist
- Remote: Forgejo at `http://10.0.0.202:3000/rayhollister/dd.wjct.org.git` (repo may need to be created)
- Push mirror to GitHub at `https://github.com/RayHollister/dd.wjct.org.git` (repo may need to be created)
- The Forgejo instance has push mirror support — once code is pushed to Forgejo, it can auto-mirror to GitHub

### 7. Deployment
- Initial: GitHub Pages for testing
- Production: dd.wjct.org subdomain (DNS and hosting TBD)

## Tech Stack (from spec)

- **Frontend:** React or vanilla JS (check what was actually built)
- **Backend:** Linear API direct (no database) — but see note above about API key security
- **Auth:** Google OAuth2 (@wjct.org only)
- **Hosting:** GitHub Pages → dd.wjct.org

## Environment & Credentials

- **Linear API:** Ray has a Linear account with the WJCT workspace. A Linear API key will be needed. Ray can generate one at https://linear.app/wjct/settings/api
- **Google OAuth:** Will need a Google Cloud project with OAuth credentials configured for @wjct.org domain. Ray has a personal Google Cloud project ("Tiberius") but should probably create a WJCT-specific one for production.
- **Forgejo:** Running at http://10.0.0.202:3000, API token stored in 1Password as "Forgejo API Token"
- **1Password CLI** is available on the Mac Mini (`op` command) for retrieving secrets. Use `--account my.1password.com` flag.

## Key Context

- **Users:** David McGowan CEO and Geri Cirillo COO need a simple, visual way to see what the Digital Media team is working on without logging into Linear
- **The dashboard should be dead simple to use** — these are non-technical stakeholders
- **Auto-refresh is important** — they want to pull it up on a screen and have it stay current
- **Don't over-engineer it** — the original spec estimated 4-6 hours for MVP, 2-3 hours for polish

## First Steps for Claude Code

1. `cd /Users/rayhollister/Dev/dashboards/dd.wjct.org`
2. Explore the codebase: `find . -type f | head -50` and read key files
3. Try running it: `./test-local.sh` or `python3 -m http.server 8000`
4. Assess what works, what's broken, what's missing
5. Report back to Ray with findings and a plan before making changes
