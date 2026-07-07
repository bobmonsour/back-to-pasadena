#!/usr/bin/env bash
# Prints the back-to-pasadena usage summary at session start (SessionStart hook).
# Output is JSON with a systemMessage field, displayed to the user in the UI.

read -r -d '' MESSAGE <<'EOF'
back-to-pasadena — house-hunting app for the Pasadena area

WHAT IT IS
A password-protected web app for comparing residential properties. Add a listing by pasting a Redfin URL; a research pipeline scrapes property data, researches the neighborhood via Claude, computes distances to stores and friends/family, and pulls lot size, fire, and flood risk from government APIs. Built with Eleventy 3, hosted on Cloudflare Workers, with mutable state (notes, favorites, status) in Cloudflare KV.

WORKFLOW
1. Local dev: npm run dev (builds the static site, then starts the Wrangler dev server; needs .dev.vars with APP_PASSWORD).
2. Add properties in the app via the Add Property modal (Redfin URL) — build runs sync-kv.js to research pending stubs; or research one manually with npm run research "<address>" "<city>" <id> "<redfinUrl>".
3. Ship it: npm run deploy (build + deploy to Cloudflare Workers). npm run refresh-status re-scrapes listing status.
EOF

jq -nc --arg m "$MESSAGE" '{systemMessage: $m}'
