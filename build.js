#!/usr/bin/env node
/**
 * build.js — esbuild bundler for YT Scorer
 *
 * Bundles three entry points (content, service-worker, popup) into dist/,
 * then copies static assets (manifest, popup HTML, icons).
 *
 * Usage:
 *   node build.js          — one-shot build
 *   node build.js --watch  — rebuild on file changes
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");
const outdir = path.resolve(__dirname, "dist");

// Ensure output directories exist
fs.mkdirSync(path.join(outdir, "popup"), { recursive: true });
fs.mkdirSync(path.join(outdir, "icons"), { recursive: true });

/** Copy a file from src to dest, creating parent dirs as needed. */
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** Copy static assets that don't need bundling. */
function copyAssets() {
  // manifest.json goes to the root of dist
  copyFile(
    path.join(__dirname, "manifest.json"),
    path.join(outdir, "manifest.json")
  );

  // Popup HTML
  copyFile(
    path.join(__dirname, "src", "popup", "index.html"),
    path.join(outdir, "popup", "index.html")
  );

  // Icons directory
  const iconsDir = path.join(__dirname, "icons");
  if (fs.existsSync(iconsDir)) {
    for (const file of fs.readdirSync(iconsDir)) {
      copyFile(
        path.join(iconsDir, file),
        path.join(outdir, "icons", file)
      );
    }
  }

  console.log("Static assets copied.");
}

/** Shared esbuild options for all entry points. */
const sharedOptions = {
  bundle: true,
  platform: "browser",
  target: "chrome120",
  logLevel: "info",
};

async function build() {
  try {
    // 1. Content script — injected into YouTube pages
    await esbuild.build({
      ...sharedOptions,
      entryPoints: ["src/content/index.ts"],
      outfile: path.join(outdir, "content.js"),
      format: "iife",
      // Avoid polyfilling chrome.* globals
      define: {},
    });

    // 2. Service worker — MV3 background script
    // Must be ESM format so chrome.runtime.onMessage.addListener is registered
    // at module top-level (not inside an IIFE), which Chrome's service worker
    // lifecycle requires to reliably wake the SW on incoming messages.
    // Pair with "type": "module" in manifest.json background section.
    await esbuild.build({
      ...sharedOptions,
      entryPoints: ["src/background/service-worker.ts"],
      outfile: path.join(outdir, "service-worker.js"),
      format: "esm",
    });

    // 3. Popup script
    await esbuild.build({
      ...sharedOptions,
      entryPoints: ["src/popup/popup.ts"],
      outfile: path.join(outdir, "popup/popup.js"),
      format: "iife",
    });

    copyAssets();
    console.log("Build complete →", outdir);
  } catch (err) {
    console.error("Build failed:", err);
    process.exit(1);
  }
}

// esbuild watch mode requires context API
async function buildWatch() {
  const contexts = await Promise.all([
    esbuild.context({
      ...sharedOptions,
      entryPoints: ["src/content/index.ts"],
      outfile: path.join(outdir, "content.js"),
      format: "iife",
    }),
    esbuild.context({
      ...sharedOptions,
      entryPoints: ["src/background/service-worker.ts"],
      outfile: path.join(outdir, "service-worker.js"),
      format: "esm",
    }),
    esbuild.context({
      ...sharedOptions,
      entryPoints: ["src/popup/popup.ts"],
      outfile: path.join(outdir, "popup/popup.js"),
      format: "iife",
    }),
  ]);

  copyAssets();
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching for changes…");
}

if (watch) {
  buildWatch();
} else {
  build();
}
