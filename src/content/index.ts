/**
 * content/index.ts
 *
 * Content script injected into every YouTube page.
 *
 * Responsibilities:
 *   - Watch for dynamically rendered video thumbnails via MutationObserver.
 *   - Extract video IDs from anchor hrefs.
 *   - Request sentiment scores from the service worker.
 *   - Inject a colour-coded score badge onto each thumbnail.
 *
 * YouTube's SPA continuously adds/removes DOM nodes as the user scrolls,
 * so we use a debounced MutationObserver rather than a one-shot scan.
 */

import type { GetScoreMessage, ScoreResponse } from "../shared/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Attribute we set on processed thumbnails to avoid re-processing. */
const PROCESSED_ATTR = "data-yt-scorer-processed";

/** Debounce delay for the MutationObserver callback (ms). */
const DEBOUNCE_MS = 300;

/** CSS class applied to every badge so we can style/query them uniformly. */
const BADGE_CLASS = "yt-scorer-badge";

// ---------------------------------------------------------------------------
// Score → badge styling helpers
// ---------------------------------------------------------------------------

interface BadgeStyle {
  background: string;
  label: string;
}

/**
 * Convert a numeric score to a visual badge label and background colour.
 * Green ≥ 75, Yellow 40–74, Red < 40.
 */
function getBadgeStyle(score: number): BadgeStyle {
  if (score >= 75) {
    return { background: "#2ecc71", label: `${score} 👍` };
  } else if (score >= 40) {
    return { background: "#f1c40f", label: `${score} 😐` };
  } else {
    return { background: "#e74c3c", label: `${score} 👎` };
  }
}

// ---------------------------------------------------------------------------
// Badge injection
// ---------------------------------------------------------------------------

/**
 * Create and return a score badge element.
 * The badge is positioned absolutely in the top-right corner of the thumbnail.
 */
function createBadge(score: number): HTMLElement {
  const { background, label } = getBadgeStyle(score);

  const badge = document.createElement("div");
  badge.className = BADGE_CLASS;
  badge.textContent = label;

  Object.assign(badge.style, {
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
    pointerEvents: "none",        // Don't block clicks on the thumbnail
    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
  });

  return badge;
}

/**
 * Inject (or update) a score badge on a thumbnail container element.
 *
 * @param container - The element that wraps the <img> thumbnail (should be
 *                    position:relative so our absolute badge lands correctly).
 * @param score     - 0–100 sentiment score.
 */
function injectBadge(container: HTMLElement, score: number): void {
  // Remove any existing badge before (re-)injecting
  container.querySelector(`.${BADGE_CLASS}`)?.remove();

  // Make sure the container is relatively positioned
  const currentPosition = window.getComputedStyle(container).position;
  if (currentPosition === "static") {
    container.style.position = "relative";
  }

  container.appendChild(createBadge(score));
}

// ---------------------------------------------------------------------------
// Service worker communication
// ---------------------------------------------------------------------------

/**
 * Request the sentiment score for a videoId from the service worker.
 * Resolves with the score (0–100) or null on error.
 */
function requestScore(videoId: string): Promise<number | null> {
  return new Promise((resolve) => {
    const message: GetScoreMessage = { type: "GET_SCORE", videoId };

    chrome.runtime.sendMessage(message, (response: ScoreResponse | undefined) => {
      if (chrome.runtime.lastError) {
        // Service worker may be sleeping — this is expected in MV3
        console.warn(
          "[YT Scorer] sendMessage error:",
          chrome.runtime.lastError.message
        );
        resolve(null);
        return;
      }
      resolve(response?.score ?? null);
    });
  });
}

// ---------------------------------------------------------------------------
// Thumbnail scanning
// ---------------------------------------------------------------------------

/**
 * Extract the video ID from a YouTube watch URL, e.g.
 * "/watch?v=dQw4w9WgXcQ" → "dQw4w9WgXcQ"
 */
function extractVideoId(href: string): string | null {
  try {
    // href may be relative or absolute
    const url = new URL(href, "https://www.youtube.com");
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Find the thumbnail anchor for a ytd-thumbnail element.
 *
 * YouTube renders `<a id="thumbnail">` inside an *open* shadow root on
 * ytd-thumbnail, so a plain querySelector() from the outside returns null.
 * We pierce the shadow root explicitly, with a light-DOM fallback for any
 * future YouTube DOM changes.
 */
function getThumbnailAnchor(thumbnail: HTMLElement): HTMLAnchorElement | null {
  // Primary: pierce open shadow root (standard YouTube Polymer layout)
  const shadowAnchor = thumbnail.shadowRoot?.querySelector<HTMLAnchorElement>(
    "a#thumbnail"
  ) ?? null;
  if (shadowAnchor) return shadowAnchor;

  // Fallback: light DOM (handles non-shadow layouts / future changes)
  return thumbnail.querySelector<HTMLAnchorElement>("a[href*='/watch?v=']");
}

/**
 * Find all unprocessed thumbnail containers within a root element,
 * request their scores, and inject badges.
 *
 * YouTube renders thumbnails differently across pages:
 *   - Home/Subscriptions: ytd-rich-item-renderer > ytd-thumbnail
 *   - Search results:     ytd-video-renderer > ytd-thumbnail
 *   - Watch next sidebar: ytd-compact-video-renderer > ytd-thumbnail
 *   - Shorts shelf:       ytd-reel-item-renderer (we skip these)
 *
 * We target `ytd-thumbnail` which is common to all layouts that show a
 * standard video card with a /watch?v= link.
 */
async function processThumbnails(root: Element | Document): Promise<void> {
  // Query for all thumbnail components not yet processed
  const thumbnails = Array.from(
    root.querySelectorAll<HTMLElement>(`ytd-thumbnail:not([${PROCESSED_ATTR}])`)
  );

  for (const thumbnail of thumbnails) {
    // Mark immediately to prevent concurrent duplicate processing
    thumbnail.setAttribute(PROCESSED_ATTR, "1");

    // Pierce shadow DOM to find the anchor — see getThumbnailAnchor() above
    const anchor = getThumbnailAnchor(thumbnail);
    if (!anchor) continue;

    const videoId = extractVideoId(anchor.href);
    if (!videoId) continue;

    // Badge target is the shadow-DOM anchor itself — it wraps the thumbnail
    // image and is already position:relative in YouTube's CSS, so our
    // absolutely-positioned badge lands in the correct visual spot.
    requestScore(videoId).then((score) => {
      if (score !== null) {
        injectBadge(anchor, score);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// MutationObserver + debounce
// ---------------------------------------------------------------------------

/** Simple debounce: returns a function that delays fn by `delay` ms. */
function debounce<T extends () => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fn, delay);
  }) as T;
}

/**
 * Set up the MutationObserver on the document body.
 * We observe the entire body subtree — YouTube's SPA can insert new nodes
 * at arbitrary points — and debounce to avoid redundant work on burst updates.
 */
function startObserver(): void {
  const debouncedScan = debounce(() => {
    processThumbnails(document).catch(console.error);
  }, DEBOUNCE_MS);

  const observer = new MutationObserver((mutations) => {
    // Quick check: only react when nodes were actually added
    const hasNewNodes = mutations.some((m) => m.addedNodes.length > 0);
    if (hasNewNodes) debouncedScan();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Wait for YouTube's initial render, then kick off the first scan and
 * install the persistent observer.
 *
 * YouTube's SPA fires a `yt-navigate-finish` event each time a navigation
 * completes (including the initial page load in some cases).  We listen for
 * it in addition to DOMContentLoaded to handle back/forward navigation.
 */
/**
 * Inject a <style> tag so the page can be queried for `#yt-scorer-styles`
 * as a health-check sentinel (confirms the content script ran), and to
 * ensure our badge class has a baseline style regardless of inline-style
 * specificity battles.
 */
function injectStyles(): void {
  if (document.getElementById("yt-scorer-styles")) return; // already injected

  const style = document.createElement("style");
  style.id = "yt-scorer-styles";
  style.textContent = `
    /* YT Scorer — badge baseline styles (inline styles take precedence) */
    .yt-scorer-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      font-size: 11px;
      font-weight: bold;
      font-family: sans-serif;
      color: #fff;
      padding: 2px 6px;
      border-radius: 4px;
      z-index: 9999;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.5);
      line-height: 1.4;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

function bootstrap(): void {
  // Inject sentinel <style> tag — visible via document.getElementById("yt-scorer-styles")
  injectStyles();

  // Initial scan on script load
  processThumbnails(document).catch(console.error);

  // Persistent observer for infinite scroll / SPA navigation
  startObserver();

  // Re-scan after YouTube finishes each SPA navigation
  document.addEventListener("yt-navigate-finish", () => {
    processThumbnails(document).catch(console.error);
  });
}

// The content script runs at document_idle, so the DOM is ready.
bootstrap();
