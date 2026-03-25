/**
 * generate-icons.js
 *
 * Generates simple PNG icons (16×16, 48×48, 128×128) for YT Scorer
 * using only Node.js built-ins + the Canvas API via the `canvas` npm package.
 *
 * Run: node generate-icons.js
 * (called automatically by npm run build via build.js if icons are missing)
 *
 * Falls back to writing minimal valid 1×1 transparent PNGs if `canvas`
 * is not installed, so the build never fails in CI.
 */

const path = require("path");
const fs = require("fs");

const SIZES = [16, 48, 128];
const OUT_DIR = path.join(__dirname, "icons");
fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Draw the YT Scorer icon on a canvas:
 *   - Red rounded rectangle background
 *   - White "bar chart" glyph (three bars of increasing height)
 */
function drawIcon(canvas, size) {
  const ctx = canvas.getContext("2d");
  const r = size * 0.18; // corner radius

  // Background — YouTube-ish red
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
  ctx.fill();

  // Bar chart — three white bars
  ctx.fillStyle = "#ffffff";
  const barW = size * 0.14;
  const gap = size * 0.08;
  const baseY = size * 0.78;
  const bars = [
    { h: size * 0.3 },
    { h: size * 0.5 },
    { h: size * 0.42 },
  ];

  const totalW = bars.length * barW + (bars.length - 1) * gap;
  let x = (size - totalW) / 2;

  for (const bar of bars) {
    ctx.fillRect(x, baseY - bar.h, barW, bar.h);
    x += barW + gap;
  }
}

try {
  const { createCanvas } = require("canvas");

  for (const size of SIZES) {
    const canvas = createCanvas(size, size);
    drawIcon(canvas, size);
    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), buffer);
    console.log(`  icon${size}.png written (canvas)`);
  }
} catch {
  // `canvas` not available — write minimal 1×1 transparent PNGs as placeholders
  console.warn(
    "  Warning: `canvas` package not found. Writing placeholder PNGs."
  );

  // Minimal valid 1×1 transparent PNG (67 bytes, hard-coded)
  const TRANSPARENT_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  );

  for (const size of SIZES) {
    fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), TRANSPARENT_PNG);
    console.log(`  icon${size}.png written (placeholder)`);
  }
}
