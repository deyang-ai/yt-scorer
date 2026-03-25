# YT Scorer

A Chrome extension (Manifest V3) that scores YouTube videos based on comment sentiment — helping you quickly gauge video quality before watching.

## How It Works

1. When you open a YouTube video, the extension fetches comments via the YouTube Data API.
2. Comments are analyzed using a lexicon-based sentiment algorithm (0–100 scale).
3. A score is displayed in the extension popup — higher is better.

**Scoring:** `score = positives / (positives + negatives) × 100`. Returns 50 (neutral) if no sentiment words are found.

## Installation

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/deyang-ai/yt-scorer.git
   cd yt-scorer
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Load in Chrome:
   - Go to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `dist/` folder

## Development

```bash
npm run watch   # Watch mode — rebuilds on file changes
```

After rebuilding, click the ↻ reload button on `chrome://extensions` to apply changes.

## Project Structure

```
src/
├── content/index.ts               # Content script — injected into YouTube pages
├── background/service-worker.ts   # MV3 service worker — background logic
├── popup/
│   ├── index.html                 # Extension popup UI
│   └── popup.ts                   # Popup logic (reads scores from storage)
└── shared/
    ├── sentiment.ts               # Sentiment scoring algorithm
    └── types.ts                   # Shared TypeScript types
```

## Tech Stack

- **TypeScript** — strict mode
- **esbuild** — fast bundler
- **Chrome Manifest V3** — service worker architecture
