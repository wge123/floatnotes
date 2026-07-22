#!/usr/bin/env bash
# Fuzzy-pick a note from the notes dir and open it in the cmux markdown viewer.
# Outside cmux, fall back to the system default opener.
set -euo pipefail

notes_dir="${FLOATNOTES_DIR:-$HOME/Notes}"

if [ ! -d "$notes_dir" ]; then
  echo "note-pick: notes dir not found: $notes_dir" >&2
  exit 1
fi

command -v fzf >/dev/null 2>&1 || { echo "note-pick: fzf not installed" >&2; exit 1; }

# Newest-first list of top-level notes (trash lives in .trash/, excluded by -maxdepth 1
# because find doesn't descend into it with this filter, and dotfiles are skipped).
pick="$(
  find "$notes_dir" -maxdepth 1 -name '*.md' -not -name '.*' -print0 |
    xargs -0 ls -t 2>/dev/null |
    fzf --prompt='note> ' --delimiter=/ --with-nth=-1 \
        --preview 'head -40 {}' --preview-window=right:60%
)" || exit 0 # user cancelled

[ -n "$pick" ] || exit 0

# Gate: markdown viewer needs a live cmux socket; else default opener.
if cmux identify >/dev/null 2>&1; then
  cmux markdown open "$pick" >/dev/null 2>&1
else
  open "$pick"
fi
