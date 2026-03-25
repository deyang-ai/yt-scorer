/**
 * shared/sentiment.ts
 *
 * Lexicon-based sentiment scoring.
 *
 * Algorithm:
 *   1. Tokenise each comment into lowercase words.
 *   2. Count how many tokens appear in the positive / negative word lists.
 *   3. score = positives / (positives + negatives) * 100
 *   4. If no words from either list were found, return 50 (neutral default).
 */

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = new Set([
  "good",
  "great",
  "amazing",
  "helpful",
  "love",
  "excellent",
  "best",
  "awesome",
  "informative",
  "useful",
  "clear",
  "well",
  "recommended",
  "brilliant",
  "fantastic",
  "enjoyed",
  "learned",
  "perfect",
  "outstanding",
  "wonderful",
]);

const NEGATIVE_WORDS = new Set([
  "bad",
  "terrible",
  "awful",
  "waste",
  "boring",
  "wrong",
  "misleading",
  "clickbait",
  "useless",
  "disappointing",
  "poor",
  "horrible",
  "skip",
  "fake",
  "scam",
  "avoid",
  "worst",
  "hate",
  "stupid",
  "confusing",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a list of comment strings on a 0–100 scale.
 *
 * @param comments - Raw comment text strings (typically 50 from the API).
 * @returns A number from 0 (very negative) to 100 (very positive).
 *          Returns 50 if neither positive nor negative words were found.
 */
export function scoreComments(comments: string[]): number {
  let positiveCount = 0;
  let negativeCount = 0;

  for (const comment of comments) {
    // Tokenise: lowercase, strip punctuation, split on whitespace
    const tokens = comment
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    for (const token of tokens) {
      if (POSITIVE_WORDS.has(token)) positiveCount++;
      if (NEGATIVE_WORDS.has(token)) negativeCount++;
    }
  }

  const total = positiveCount + negativeCount;

  // No sentiment signal found — return neutral
  if (total === 0) return 50;

  return Math.round((positiveCount / total) * 100);
}
