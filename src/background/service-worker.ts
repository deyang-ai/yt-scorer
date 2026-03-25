/**
 * background/service-worker.ts
 *
 * MV3 service worker for YT Scorer.
 *
 * Responsibilities:
 *   - Receive GET_SCORE messages from the content script.
 *   - Return a cached score if one exists and is <24 h old.
 *   - On cache miss: call the YouTube Data API v3 commentThreads.list,
 *     run sentiment analysis, persist the result, and reply.
 *   - Gracefully handle missing API keys and network errors.
 */

import type {
  CacheEntry,
  ExtensionSettings,
  GetScoreMessage,
  ScoreCache,
  ScoreResponse,
  YouTubeCommentThreadsResponse,
} from "../shared/types";
import { scoreComments } from "../shared/sentiment";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cache time-to-live: 24 hours in milliseconds. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Storage key for the score cache object. */
const CACHE_KEY = "cache";

/** Storage key for extension settings. */
const SETTINGS_KEY = "settings";

/** Max comments to fetch per video. Higher = more accurate, more quota used. */
const MAX_RESULTS = 50;

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** Read the entire score cache from storage. */
async function readCache(): Promise<ScoreCache> {
  const data = await chrome.storage.local.get(CACHE_KEY);
  return (data[CACHE_KEY] as ScoreCache) ?? {};
}

/** Write the entire score cache back to storage. */
async function writeCache(cache: ScoreCache): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

/**
 * Look up a videoId in the cache.
 * Returns the score if it exists and is within the TTL, otherwise null.
 */
async function getCached(videoId: string): Promise<number | null> {
  const cache = await readCache();
  const entry: CacheEntry | undefined = cache[videoId];

  if (!entry) return null;

  const age = Date.now() - entry.cachedAt;
  if (age > CACHE_TTL_MS) {
    // Stale — remove and signal cache miss
    delete cache[videoId];
    await writeCache(cache);
    return null;
  }

  return entry.score;
}

/** Persist a computed score for a video. */
async function setCached(videoId: string, score: number): Promise<void> {
  const cache = await readCache();
  cache[videoId] = { score, cachedAt: Date.now() };
  await writeCache(cache);
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/** Read extension settings from storage. */
async function readSettings(): Promise<ExtensionSettings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return (data[SETTINGS_KEY] as ExtensionSettings) ?? { apiKey: "", enabled: true };
}

// ---------------------------------------------------------------------------
// YouTube API
// ---------------------------------------------------------------------------

/**
 * Fetch up to MAX_RESULTS top-level comments for a video via the YouTube
 * Data API v3 commentThreads.list endpoint.
 *
 * Returns an array of raw comment text strings.
 * Throws an Error on network failure or API error.
 */
async function fetchComments(videoId: string, apiKey: string): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("maxResults", String(MAX_RESULTS));
  url.searchParams.set("order", "relevance");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`YouTube API HTTP ${response.status}: ${response.statusText}`);
  }

  const json: YouTubeCommentThreadsResponse = await response.json();

  // The API can return HTTP 200 with an error body (e.g. comments disabled)
  if (json.error) {
    throw new Error(`YouTube API error ${json.error.code}: ${json.error.message}`);
  }

  return (json.items ?? []).map(
    (item) => item.topLevelComment.snippet.textDisplay
  );
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Handle a GET_SCORE message from the content script.
 * Returns a ScoreResponse that will be sent back via sendResponse.
 */
async function handleGetScore(videoId: string): Promise<ScoreResponse> {
  console.log(`[SW] GET_SCORE received for ${videoId}`);

  // 1. Read settings — bail early if the extension is disabled or no API key
  const settings = await readSettings();
  console.log(`[SW] settings: apiKey=${settings.apiKey ? settings.apiKey.slice(0,8)+"..." : "(empty)"} enabled=${settings.enabled}`);

  if (!settings.enabled) {
    return { videoId, score: null, error: "Extension is disabled" };
  }

  if (!settings.apiKey) {
    return { videoId, score: null, error: "NO_API_KEY" };
  }

  // 2. Check cache
  const cached = await getCached(videoId);
  if (cached !== null) {
    console.log(`[SW] Cache hit for ${videoId}: ${cached}`);
    return { videoId, score: cached };
  }

  // 3. Fetch comments and compute score
  try {
    console.log(`[SW] Fetching comments for ${videoId}...`);
    const comments = await fetchComments(videoId, settings.apiKey);
    console.log(`[SW] Got ${comments.length} comments for ${videoId}`);
    const score = scoreComments(comments);
    console.log(`[SW] Score for ${videoId}: ${score}`);

    // 4. Persist in cache
    await setCached(videoId, score);

    return { videoId, score };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SW] Failed to score video ${videoId}:`, message);
    return { videoId, score: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// chrome.runtime.onMessage listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ScoreResponse) => void
  ): boolean => {
    // Type guard
    if (
      typeof message !== "object" ||
      message === null ||
      (message as GetScoreMessage).type !== "GET_SCORE"
    ) {
      return false; // Not our message
    }

    const { videoId } = message as GetScoreMessage;

    // We must return `true` to keep the message channel open while the async
    // handler runs; MV3 service workers require this.
    handleGetScore(videoId).then(sendResponse).catch((err) => {
      sendResponse({ videoId, score: null, error: String(err) });
    });

    return true; // Keep the channel open for async response
  }
);

// Log service worker startup (visible in chrome://serviceworker-internals)
console.log("[YT Scorer] Service worker started.");
