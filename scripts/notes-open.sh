#!/usr/bin/env bash
# Open the FloatNotes web UI (http://localhost:4949) where the user is looking.
#
# Inside cmux: reuse an existing browser surface showing the app if one is
# visible in this workspace, else open a browser split beside the caller.
# Outside cmux (or cmux app not running): fall back to the default browser.
set -euo pipefail

port="${FLOATNOTES_PORT:-4949}"
url="http://localhost:${port}"

# Gate: no cmux socket (background job, launchd, cmux not running) → plain open.
if ! cmux identify >/dev/null 2>&1; then
  exec open "$url"
fi

# 1. Reuse: is the app already open in a browser surface in this workspace?
existing="$(
  for p in $(cmux list-panes 2>/dev/null | grep -o 'pane:[0-9]*'); do
    cmux list-pane-surfaces --pane "$p" 2>/dev/null
  done | grep "localhost:${port}" | grep -o 'surface:[0-9]*' | head -1
)" || true
if [ -n "${existing}" ]; then
  cmux focus-panel --panel "${existing}" >/dev/null 2>&1 && exit 0
fi

# 2. One atomic browser-in-a-new-split beside the caller (user-initiated → focus).
if cmux browser open-split "$url" --focus true >/dev/null 2>&1; then
  exit 0
fi

# 3. Last resorts: let cmux place it, else the default browser.
cmux open "$url" >/dev/null 2>&1 || exec open "$url"
