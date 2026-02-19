#!/bin/bash

# Test the dashboard locally.
# Requires the Cloudflare Worker to already be deployed (or run `npx wrangler dev`
# in a separate terminal and set WORKER_URL to http://localhost:8787 in config.js).

echo "Starting local dashboard on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""

python3 -m http.server 8000
