/**
 * popup/popup.ts
 *
 * Script for the YT Scorer settings popup.
 *
 * Loads saved settings from chrome.storage.local on open, and writes
 * them back when the user clicks "Save Settings".
 */

import type { ExtensionSettings } from "../shared/types";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const enabledToggle = document.getElementById("enabled-toggle") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------

/** Show a temporary status message. Clears itself after `duration` ms. */
function showStatus(message: string, type: "success" | "error", duration = 2500): void {
  statusEl.textContent = message;
  statusEl.className = type;

  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "";
  }, duration);
}

// ---------------------------------------------------------------------------
// Load settings on popup open
// ---------------------------------------------------------------------------

async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get("settings");
  const settings: ExtensionSettings = data["settings"] ?? { apiKey: "", enabled: true };

  apiKeyInput.value = settings.apiKey;
  enabledToggle.checked = settings.enabled;
}

// ---------------------------------------------------------------------------
// Save settings on button click
// ---------------------------------------------------------------------------

async function saveSettings(): Promise<void> {
  const settings: ExtensionSettings = {
    apiKey: apiKeyInput.value.trim(),
    enabled: enabledToggle.checked,
  };

  try {
    await chrome.storage.local.set({ settings });
    showStatus("Settings saved ✓", "success");
  } catch (err) {
    showStatus("Failed to save settings", "error");
    console.error("[YT Scorer popup] Save error:", err);
  }
}

// ---------------------------------------------------------------------------
// Wire up events
// ---------------------------------------------------------------------------

saveBtn.addEventListener("click", () => {
  saveSettings();
});

// Allow pressing Enter in the API key field to save
apiKeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveSettings();
});

// Load on open
loadSettings().catch(console.error);
