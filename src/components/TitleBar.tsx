import { useCallback } from "react";
import {
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";

import { isClick, nextWindowPosition, type DragStart } from "../lib/drag";
import Tooltip from "./Tooltip";

const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * Top title bar: shows the note title, drags the panel, and copies the note's
 * file path on a click.
 *
 * Drag is manual (mousemove → setPosition) because startDragging()/
 * data-tauri-drag-region silently no-op on the nonactivating NSPanel —
 * see lib/drag.ts. Not a text area by design: the title is derived
 * server-side from the note's first line, so editing happens in the editor.
 *
 * Click and drag share one mousedown: a press that releases without moving
 * past CLICK_SLOP is the copy gesture, anything further is a window move.
 */
export interface TitleBarProps {
  title: string;
  /** Absent until a note is open — the bar then only drags. */
  onCopyPath?: () => void;
}

export default function TitleBar({ title, onCopyPath }: TitleBarProps) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const origin = { screenX: e.screenX, screenY: e.screenY };
      let start: DragStart | null = null; // null until origin+scale resolve
      let scale = 1;

      // No window to move outside the panel — the browser surface still
      // tracks the gesture so the click-to-copy half works there too.
      const win = inTauri ? getCurrentWindow() : null;
      if (win) {
        void Promise.all([win.outerPosition(), win.scaleFactor()]).then(
          ([pos, factor]) => {
            scale = factor;
            start = { winX: pos.x, winY: pos.y, ...origin };
          },
        );
      }

      const onMove = (move: MouseEvent) => {
        if (!win || !start) return; // origin not resolved yet — drop the frame
        const next = nextWindowPosition(
          start,
          move.screenX,
          move.screenY,
          scale,
        );
        void win.setPosition(new PhysicalPosition(next.x, next.y));
      };
      const onUp = (up: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (isClick(origin, up.screenX, up.screenY)) onCopyPath?.();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onCopyPath],
  );

  return (
    <Tooltip label="Click to copy file path" align="left" side="bottom">
      <div
        onMouseDown={onMouseDown}
        className="flex h-9 w-full shrink-0 cursor-default items-center justify-center border-b border-gray-200 px-10"
      >
        <span className="pointer-events-none select-none truncate text-xs font-medium text-gray-500">
          {title}
        </span>
      </div>
    </Tooltip>
  );
}
