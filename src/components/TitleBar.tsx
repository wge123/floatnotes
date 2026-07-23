import { useCallback } from "react";
import {
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";

import { nextWindowPosition, type DragStart } from "../lib/drag";

const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * Top title bar: shows the note title and drags the panel.
 *
 * Drag is manual (mousemove → setPosition) because startDragging()/
 * data-tauri-drag-region silently no-op on the nonactivating NSPanel —
 * see lib/drag.ts. Not a text area by design: the title is derived
 * server-side from the note's first line, so editing happens in the editor.
 */
export interface TitleBarProps {
  title: string;
}

export default function TitleBar({ title }: TitleBarProps) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!inTauri || e.button !== 0) return;
    e.preventDefault();

    const win = getCurrentWindow();
    let start: DragStart | null = null; // null until origin+scale resolve
    let scale = 1;

    void Promise.all([win.outerPosition(), win.scaleFactor()]).then(
      ([pos, factor]) => {
        scale = factor;
        start = {
          winX: pos.x,
          winY: pos.y,
          screenX: e.screenX,
          screenY: e.screenY,
        };
      },
    );

    const onMove = (move: MouseEvent) => {
      if (!start) return; // origin not resolved yet — drop the frame
      const next = nextWindowPosition(start, move.screenX, move.screenY, scale);
      void win.setPosition(new PhysicalPosition(next.x, next.y));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div
      onMouseDown={onMouseDown}
      className="flex h-9 shrink-0 cursor-default items-center justify-center border-b border-gray-200 px-10"
    >
      <span className="pointer-events-none select-none truncate text-xs font-medium text-gray-500">
        {title}
      </span>
    </div>
  );
}
