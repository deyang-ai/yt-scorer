# Manual Extension Testing

Steps to manually test YT Scorer on YouTube:

1. Build first: `npm run build`
2. Load/reload the extension in Chrome (see `/project:reload`)
3. Open a YouTube video with comments, e.g. a popular video
4. Wait for comments to load fully (scroll down if needed)
5. Click the YT Scorer popup icon — it should show a sentiment score
6. Test edge cases:
   - Video with disabled comments
   - Video with very few comments (<5)
   - Navigating between videos (SPA navigation test)
   - Live streams (no standard comment section)

Check the browser console (`F12 → Console`) for any errors from `content.js` or `service-worker.js`.
