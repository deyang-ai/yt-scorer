#!/bin/bash
# After any file write to src/, auto-run build
if [[ "$CLAUDE_TOOL_NAME" == "Write" || "$CLAUDE_TOOL_NAME" == "Edit" ]]; then
  if echo "$CLAUDE_TOOL_INPUT" | grep -q '"src/'; then
    echo "[$(date)] Auto-rebuilding after source change..." >> .claude/tool-usage.log
    npm run build 2>&1 | tail -5 >> .claude/tool-usage.log
  fi
fi
