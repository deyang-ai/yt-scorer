/**
 * content/index.ts — YT Scorer content script
 *
 * Observation strategy (read before editing):
 *
 * YouTube is a SPA built on Polymer custom elements with open shadow DOM.
 * Three things work against a naive badge-injection approach:
 *
 *   1. ytd-thumbnail lives in the shadow root of ytd-rich-item-renderer /
 *      ytd-video-renderer etc., so document.querySelectorAll('ytd-thumbnail')
 *      always returns 0.
 *
 *   2. YouTube re-renders shadow roots frequently (lazy image loading, infinite
 *      scroll, SPA navigation) — badges injected into shadow DOM are wiped.
 *
 *   3. yt-navigate-finish fires on every SPA page change; the entire
 *      ytd-app subtree may be rebuilt.
 *
 * Solution:
 *   • Query light-DOM renderer elements (ytd-rich-item-renderer, ytd-video-renderer …)
 *     which ARE findable from document.
 *   • Pierce each renderer's shadow root once to reach ytd-thumbnail.
 *   • Append the badge to ytd-thumbnail as a *light-DOM child* — it survives
 *     shadow-root re-renders because Polymer only replaces the shadow tree.
 *   • Stamp data-yt-scorer=<videoId> on ytd-thumbnail so we know the video ID
 *     even after the badge is wiped.
 *   • On every MutationObserver tick, re-badge any ytd-thumbnail whose badge
 *     is missing — use an in-memory score map so we never re-call the API.
 *   • ytd-thumbnail gets position:relative via injected CSS so absolute badges
 *     stay anchored to the thumbnail image.
 */

import type { GetScoreMessage, ScoreResponse } from "../shared/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Attribute stamped on ytd-thumbnail once we know its video ID. */
const SCORED_ATTR = "data-yt-scorer";

/** CSS class on every badge div. */
const BADGE_CLASS = "yt-scorer-badge";

/** Debounce for MutationObserver callbacks (ms). */
const OBSERVER_DEBOUNCE_MS = 400;

/** Delay after yt-navigate-finish before re-scanning (ms). */
const NAVIGATE_DELAY_MS = 500;

/** Renderer tag names that are in the light DOM and host a ytd-thumbnail. */
const RENDERER_TAGS = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
] as const;

// Selector string used in querySelectorAll
const RENDERER_SELECTOR = RENDERER_TAGS.join(", ");

// ---------------------------------------------------------------------------
// In-memory score cache
// ---------------------------------------------------------------------------

/**
 * Scores retrieved from the service worker, keyed by videoId.
 * Populated on first request; used for instant re-badge after YouTube wipes
 * the DOM without making another API call.
 */
const localScoreCache = new Map<string, number>();

// ---------------------------------------------------------------------------
// Badge styling
// ---------------------------------------------------------------------------

interface BadgeStyle { background: string; label: string; }

function getBadgeStyle(score: number): BadgeStyle {
  if (score >= 75) return { background: "#2ecc71", label: `${score} 👍` };
  if (score >= 40) return { background: "#f1c40f", label: `${score} 😐` };
  return { background: "#e74c3c", label: `${score} 👎` };
}

function createBadge(score: number): HTMLElement {
  const { background, label } = getBadgeStyle(score);
  const el = document.createElement("div");
  el.className = BADGE_CLASS;
  el.textContent = label;
  Object.assign(el.style, {
    position: "absolute",
    top: "6px",
    right: "6px",
    background,
    color: "#fff",
    fontSize: "11px",
    fontWeight: "bold",
    fontFamily: "sans-serif",
    padding: "2px 6px",
    borderRadius: "4px",
    zIndex: "9999",
    pointerEvents: "none",
    boxShadow: "0 1px 3px rgba(0,0,0,.5)",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
  });
  return el;
}

/**
 * Append a badge to `target` (a ytd-thumbnail element).
 * Removes any stale badge first to avoid duplicates.
 */
function injectBadge(target: HTMLElement, score: number): void {
  target.querySelector(`.${BADGE_CLASS}`)?.remove();
  target.appendChild(createBadge(score));
  console.log(`[YT Scorer] Badge injected: score=${score} videoId=${target.getAttribute(SCORED_ATTR)}`);
}

// ---------------------------------------------------------------------------
// Service worker communication
// ---------------------------------------------------------------------------

/**
 * Returns false once the extension has been reloaded or uninstalled.
 * chrome.runtime.id becomes undefined when the context is invalidated.
 */
function isContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function requestScore(videoId: string): Promise<number | null> {
  return new Promise((resolve) => {
    // Guard: extension may have been reloaded since this content script started
    if (!isContextValid()) { resolve(null); return; }

    const message: GetScoreMessage = { type: "GET_SCORE", videoId };
    try {
      chrome.runtime.sendMessage(message, (response: ScoreResponse | undefined) => {
        if (chrome.runtime.lastError) {
          // Covers "Extension context invalidated" and "Receiving end does not exist"
          console.warn("[YT Scorer] sendMessage error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        const score = response?.score ?? null;
        console.log(`[YT Scorer] SW response: videoId=${videoId} score=${score}`);
        resolve(score);
      });
    } catch {
      // Synchronous throw when context is already gone
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function extractVideoId(href: string): string | null {
  try {
    return new URL(href, "https://www.youtube.com").searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Find ytd-thumbnail inside a renderer.
 * Tries the renderer's shadow root first (standard Polymer layout), then light DOM.
 */
function findThumbnailInRenderer(renderer: Element): HTMLElement | null {
  return (
    renderer.shadowRoot?.querySelector<HTMLElement>("ytd-thumbnail") ??
    renderer.querySelector<HTMLElement>("ytd-thumbnail")
  );
}

/**
 * Find the /watch?v= anchor inside a ytd-thumbnail.
 * Tries light DOM first (confirmed layout), then shadow root (fallback).
 */
function findAnchorInThumbnail(thumbnail: HTMLElement): HTMLAnchorElement | null {
  // Light DOM — confirmed HasLightAnchor: true on observed YouTube layout
  const light = thumbnail.querySelector<HTMLAnchorElement>(
    "a#thumbnail, a[href*='/watch?v=']"
  );
  if (light) return light;

  // Shadow root fallback (layout may vary)
  return (
    thumbnail.shadowRoot?.querySelector<HTMLAnchorElement>(
      "a#thumbnail, a[href*='/watch?v=']"
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

/**
 * Process a single renderer element:
 *   1. Find ytd-thumbnail inside it.
 *   2. Find the /watch?v= anchor inside that thumbnail.
 *   3. Stamp data-yt-scorer on the thumbnail (idempotent).
 *   4. If the badge is already present → done.
 *   5. If we have the score in memory → re-badge immediately (YouTube wiped it).
 *   6. Otherwise → ask the service worker and badge once we hear back.
 */
function processRenderer(renderer: Element): void {
  const thumbnail = findThumbnailInRenderer(renderer);
  if (!thumbnail) return;

  const anchor = findAnchorInThumbnail(thumbnail);
  if (!anchor) return;

  const videoId = extractVideoId(anchor.href);
  if (!videoId) return;

  // Stamp the video ID on the thumbnail so we can re-badge after wipes
  thumbnail.setAttribute(SCORED_ATTR, videoId);

  // Badge already present — nothing to do
  if (thumbnail.querySelector(`.${BADGE_CLASS}`)) return;

  // Score already in memory (YouTube wiped the badge) — re-inject instantly
  const cached = localScoreCache.get(videoId);
  if (cached !== undefined) {
    injectBadge(thumbnail, cached);
    return;
  }

  // First time — ask the service worker
  console.log(`[YT Scorer] Requesting SW score for videoId=${videoId}`);
  requestScore(videoId).then((score) => {
    if (score === null) {
      console.log(`[YT Scorer] No score for ${videoId} (null — check API key)`);
      return;
    }
    localScoreCache.set(videoId, score);   // save for re-badge on wipe
    injectBadge(thumbnail, score);
  });
}

/**
 * Scan the entire document for renderers and process each one.
 * Safe to call repeatedly — processRenderer() is idempotent per thumbnail.
 */
function processAllThumbnails(): void {
  const renderers = document.querySelectorAll<Element>(RENDERER_SELECTOR);
  console.log(`[YT Scorer] processAllThumbnails: ${renderers.length} renderer(s) found`);
  renderers.forEach(processRenderer);
}

// ---------------------------------------------------------------------------
// MutationObserver
// ---------------------------------------------------------------------------

function debounce<T extends () => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }) as T;
}

/**
 * Watch document.body for any DOM changes.
 * Triggers on:
 *   • New renderer elements added (infinite scroll, SPA nav)
 *   • YouTube re-rendering shadow roots (causes badge wipe — we re-badge)
 *
 * Debounced at OBSERVER_DEBOUNCE_MS to absorb rapid burst mutations.
 */
function startObserver(): void {
  const debouncedScan = debounce(processAllThumbnails, OBSERVER_DEBOUNCE_MS);

  const observer = new MutationObserver((mutations) => {
    // Stop observing if the extension was reloaded — prevents "context invalidated" errors
    if (!isContextValid()) {
      observer.disconnect();
      return;
    }
    const relevant = mutations.some((m) => m.addedNodes.length > 0 || m.removedNodes.length > 0);
    if (relevant) debouncedScan();
  });

  // Watch the full subtree — YouTube mutates at arbitrary depths
  observer.observe(document.body, { childList: true, subtree: true });

  console.log("[YT Scorer] MutationObserver started on document.body");
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById("yt-scorer-styles")) return;

  const style = document.createElement("style");
  style.id = "yt-scorer-styles";
  // Give ytd-thumbnail a stacking context so absolute badges land correctly.
  // The badge is appended as a light-DOM child of ytd-thumbnail.
  style.textContent = `
    ytd-thumbnail {
      position: relative !important;
      display: block;
    }
    .${BADGE_CLASS} {
      position: absolute;
      top: 6px; right: 6px;
      font-size: 11px; font-weight: bold; font-family: sans-serif;
      color: #fff; padding: 2px 6px; border-radius: 4px;
      z-index: 9999; pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,.5);
      line-height: 1.4; white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
  console.log("[YT Scorer] #yt-scorer-styles injected");
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bootstrap(): void {
  console.log("[YT Scorer] bootstrap() — content script initialising");

  // Inject CSS (sets position:relative on ytd-thumbnail)
  injectStyles();

  // Immediate scan of already-visible thumbnails
  processAllThumbnails();

  // Watch for new/replaced thumbnails (infinite scroll, re-renders)
  startObserver();

  // Second immediate pass to cover anything added between the first scan
  // and the observer starting
  processAllThumbnails();

  // Re-scan after every YouTube SPA navigation
  document.addEventListener("yt-navigate-finish", () => {
    console.log("[YT Scorer] yt-navigate-finish — scheduling re-scan");
    // Delay gives YouTube time to render the new page's thumbnails
    setTimeout(() => processAllThumbnails(), NAVIGATE_DELAY_MS);
  });
}

bootstrap();
