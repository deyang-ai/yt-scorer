/**
 * content/index.ts — YT Scorer content script
 *
 * Simple, reliable approach:
 *   1. Query ytd-thumbnail elements directly (works once YouTube renders them).
 *   2. Find the /watch?v= anchor inside each thumbnail.
 *   3. Show a loading badge, ask the service worker, update badge with score.
 *   4. MutationObserver re-runs recheckBadges() on any DOM change — if YouTube
 *      wipes a badge, we clear the processed attribute and re-process.
 *   5. yt-navigate-finish + periodic retries handle SPA navigation.
 */

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById("yt-scorer-styles")) return;

  const style = document.createElement("style");
  style.id = "yt-scorer-styles";
  style.textContent = `
    ytd-thumbnail { position: relative !important; }
    .yt-scorer-badge {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 9999;
      padding: 3px 7px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
      color: white;
      pointer-events: none;
      background: rgba(0,0,0,0.7);
      font-family: -apple-system, sans-serif;
    }
    .yt-scorer-badge.green  { background: #27ae60; }
    .yt-scorer-badge.yellow { background: #f39c12; }
    .yt-scorer-badge.red    { background: #e74c3c; }
    .yt-scorer-badge.loading { background: rgba(0,0,0,0.5); }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// ---------------------------------------------------------------------------
// In-memory score cache
// ---------------------------------------------------------------------------

/**
 * Stores scores keyed by videoId for the lifetime of this page context.
 * First visit: wait for SW response (2-5 s). Every re-render after that:
 * badge is injected instantly from this map without touching the SW.
 */
const localCache = new Map<string, number>();

// ---------------------------------------------------------------------------
// Video ID extraction
// ---------------------------------------------------------------------------

function getVideoId(thumb: Element): string | null {
  // Select by id first — works even before href is bound (skeleton elements).
  // Fall back to href selector for non-standard layouts.
  const a =
    thumb.querySelector<HTMLAnchorElement>("a#thumbnail") ??
    thumb.querySelector<HTMLAnchorElement>('a[href*="watch?v="]');
  if (!a) return null;

  // getAttribute returns the raw attribute value, which may be empty string
  // while YouTube's data binding is still pending (skeleton state).
  const href = a.getAttribute("href") ?? "";
  if (!href) return null; // not hydrated yet — observer will retry on href change

  const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Process a single ytd-thumbnail
// ---------------------------------------------------------------------------

/** Apply a numeric score to an existing badge element in-place. */
function applyScore(badge: HTMLElement, score: number): void {
  if (score >= 75) {
    badge.textContent = `${score} 👍`;
    badge.className = "yt-scorer-badge green";
  } else if (score >= 40) {
    badge.textContent = `${score} 😐`;
    badge.className = "yt-scorer-badge yellow";
  } else {
    badge.textContent = `${score} 👎`;
    badge.className = "yt-scorer-badge red";
  }
}

async function processThumbnail(thumb: Element): Promise<void> {
  // Skip if already processed (attribute set means in-flight or done)
  if (thumb.getAttribute("data-yt-scorer")) return;

  const videoId = getVideoId(thumb);
  if (!videoId) return;

  // Mark immediately so concurrent MutationObserver callbacks don't double-process
  thumb.setAttribute("data-yt-scorer", videoId);

  // --- Fast path: score already in memory from a previous SW round-trip ---
  const cached = localCache.get(videoId);
  if (cached !== undefined) {
    const badge = document.createElement("div");
    badge.className = "yt-scorer-badge";
    thumb.appendChild(badge);
    applyScore(badge, cached);
    console.log(`[YT Scorer] score received (cache): ${videoId}`, cached);
    return;
  }

  // --- Slow path: ask the service worker (first time seeing this video) ---
  const badge = document.createElement("div");
  badge.className = "yt-scorer-badge loading";
  badge.textContent = "...";
  thumb.appendChild(badge);

  try {
    const response: { score?: number; error?: string } | undefined =
      await chrome.runtime.sendMessage({ type: "GET_SCORE", videoId });

    if (response && typeof response.score === "number") {
      const score = Math.round(response.score);
      localCache.set(videoId, score); // store so re-renders are instant
      applyScore(badge, score);
      console.log(`[YT Scorer] score received (sw): ${videoId}`, score);
    } else {
      // Show the actual error so we can diagnose what's failing
      const errText = (response as { error?: string })?.error ?? "no response";
      console.warn(`[YT Scorer] null score for ${videoId}:`, errText);
      badge.textContent = errText.slice(0, 14);
      badge.className = "yt-scorer-badge";
      badge.style.cssText = "background:rgba(120,0,200,0.9)!important;font-size:10px!important;";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[YT Scorer] sendMessage failed for ${videoId}:`, msg);
    badge.textContent = msg.slice(0, 14);
    badge.className = "yt-scorer-badge";
    badge.style.cssText = "background:rgba(200,0,0,0.9)!important;font-size:10px!important;";
  }
}

// ---------------------------------------------------------------------------
// Scan / recheck
// ---------------------------------------------------------------------------

/** Process all ytd-thumbnail elements currently in the document. */
function processAll(): void {
  document.querySelectorAll("ytd-thumbnail").forEach((thumb) => {
    processThumbnail(thumb).catch(() => {});
  });
}

/**
 * For every already-processed thumbnail, check whether YouTube wiped its
 * badge.  If so, clear the attribute so processAll() will re-process it.
 */
function recheckBadges(): void {
  document.querySelectorAll("ytd-thumbnail[data-yt-scorer]").forEach((thumb) => {
    // If the anchor href is gone (YouTube recycled the element for a new video),
    // clear everything so this thumbnail is treated as fresh on the next processAll.
    const currentVideoId = getVideoId(thumb);
    const stampedVideoId = thumb.getAttribute("data-yt-scorer");
    if (!currentVideoId || currentVideoId !== stampedVideoId) {
      thumb.querySelector(".yt-scorer-badge")?.remove();
      thumb.removeAttribute("data-yt-scorer");
      return;
    }

    if (!thumb.querySelector(".yt-scorer-badge")) {
      const cached = localCache.get(stampedVideoId);
      if (cached !== undefined) {
        // Score in memory — re-inject instantly, no SW round-trip
        const badge = document.createElement("div");
        badge.className = "yt-scorer-badge";
        thumb.appendChild(badge);
        applyScore(badge, cached);
      } else {
        // Not cached yet — clear so processAll() re-queues a SW request
        thumb.removeAttribute("data-yt-scorer");
      }
    }
  });
  processAll();
}

// ---------------------------------------------------------------------------
// MutationObserver
// ---------------------------------------------------------------------------

function startObserver(): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    // Debounce at 400 ms to absorb rapid YouTube DOM bursts
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(recheckBadges, 400);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"], // catch YouTube data-binding filling in the href
  });
  console.log("[YT Scorer] MutationObserver active");
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bootstrap(): void {
  console.log("[YT Scorer] bootstrap()");
  injectStyles();
  processAll();
  startObserver();

  // Delayed retries to catch thumbnails that load after document_idle
  setTimeout(processAll, 1000);
  setTimeout(processAll, 3000);

  // SPA navigation: YouTube fires this after each page transition
  document.addEventListener("yt-navigate-finish", () => {
    console.log("[YT Scorer] yt-navigate-finish");
    setTimeout(processAll, 800);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
