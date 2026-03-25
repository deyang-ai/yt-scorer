# YT Scorer — Claude Code Context

## Project Overview

YT Scorer is a Chrome Manifest V3 extension that scores YouTube videos based on comment sentiment, helping users quickly gauge video quality before watching.

## Architecture

```
src/
├── content/index.ts        # Content script — injected into YouTube pages
├── background/service-worker.ts  # MV3 service worker — background logic
├── popup/
│   ├── index.html          # Extension popup UI
│   └── popup.ts            # Popup logic (reads scores from storage)
└── shared/
    ├── sentiment.ts        # Sentiment scoring algorithm (shared)
    ├── types.ts            # Shared TypeScript types
```

**Build output** → `dist/` (not committed to git)

## Key Technical Gotchas

### Shadow DOM Piercing
YouTube's comment section uses shadow DOM. Standard `querySelector` won't reach into it. Use `shadowRoot` traversal or a recursive pierce helper when selecting comment elements.

### MV3 Service Worker Lifecycle
MV3 service workers are ephemeral — they spin up on demand and terminate after ~30s of inactivity. Do **not** rely on in-memory state persisting between events. Use `chrome.storage.local` for anything that needs to survive.

### MutationObserver Debounce
The content script uses a MutationObserver to detect when comments load (YouTube is a SPA). Always debounce the observer callback (100–300ms) to avoid flooding on rapid DOM mutations during navigation.

### Host Permissions
`manifest.json` grants `*://www.youtube.com/*` and `https://www.googleapis.com/*`. Any new API calls must match these or require a manifest update.

## Build

```bash
npm run build        # One-time build → dist/
npm run watch        # Watch mode (uses build.js --watch via esbuild)
```

Build tool: **esbuild** (via `build.js`). TypeScript is compiled by esbuild directly (no separate `tsc` step needed for building; `tsc` is only for type-checking).

## Reloading in Chrome After Changes

1. Run `npm run build`
2. Open `chrome://extensions`
3. Find **YT Scorer** and click the ↻ reload button
4. Navigate to any YouTube video and open the popup

## File Notes

- `manifest.json` — lives at project root, copied to `dist/` by build
- `icons/` — PNG icons (16, 48, 128px), copied to `dist/icons/`
- `build.js` — esbuild config script
- `generate-icons.js` — utility to regenerate icon PNGs
- `tsconfig.json` — TypeScript config (strict mode)
