/**
 * shared/types.ts
 *
 * Shared type definitions used by both the content script and service worker.
 */

// ---------------------------------------------------------------------------
// Messages passed between content script ↔ service worker
// ---------------------------------------------------------------------------

/** Content script asks the SW for a video's sentiment score. */
export interface GetScoreMessage {
  type: "GET_SCORE";
  videoId: string;
}

/** Service worker replies with the computed/cached score. */
export interface ScoreResponse {
  videoId: string;
  /** 0–100 sentiment score; null means the API key is missing or the call failed. */
  score: number | null;
  /** Human-readable error, if any */
  error?: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** One entry stored in chrome.storage.local per video. */
export interface CacheEntry {
  score: number;
  /** Unix timestamp (ms) when this entry was stored */
  cachedAt: number;
}

/** The full shape stored in chrome.storage.local under the key "cache". */
export type ScoreCache = Record<string, CacheEntry>;

// ---------------------------------------------------------------------------
// Extension settings
// ---------------------------------------------------------------------------

/** Settings persisted via chrome.storage.local under the key "settings". */
export interface ExtensionSettings {
  apiKey: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// YouTube API shapes (trimmed to only the fields we actually use)
// ---------------------------------------------------------------------------

export interface YouTubeCommentSnippet {
  topLevelComment: {
    snippet: {
      textDisplay: string;
    };
  };
}

export interface YouTubeCommentThreadsResponse {
  items?: YouTubeCommentSnippet[];
  error?: {
    message: string;
    code: number;
  };
}
