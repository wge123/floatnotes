import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";

import Tooltip from "./Tooltip";

const inTauri = "__TAURI_INTERNALS__" in window;

/** Height of the title bar (h-9), i.e. what is left when the panel is shaded. */
const SHADE_HEIGHT = 36;
/** Mirrors minWidth/minHeight in tauri.conf.json. */
const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
/** Breathing room left around a zoomed panel, and space for the menu bar. */
const ZOOM_INSET = 24;
const MENUBAR_INSET = 40;

/**
 * macOS-style traffic lights, drawn in the DOM rather than by AppKit.
 *
 * Native buttons are not an option here. Adding `titled`/`closable` to the
 * panel's style mask does produce real NSWindow buttons (they report
 * hidden=false, alpha=1, correct 14x14 frames inside a correctly placed 32pt
 * NSTitlebarContainerView) but they never paint, because the panel's content
 * view is a layer-backed WKWebView covering the full frame. Neither
 * `full_size_content_view`, `titleBarStyle: Overlay`, re-parenting the title
 * bar as the frontmost sibling, forcing `wantsLayer`, nor letting the panel
 * become the main window changed that.
 *
 * The actions are hand-rolled for the same reason: `minimize()` and
 * `maximize()` both return Ok on an NSPanel and then do nothing (measured:
 * is_minimized/is_maximized stay false, outer_size unchanged). `setSize` and
 * `setPosition` do work, so both behaviors are built from those.
 *
 * Close hides rather than quits: the app runs under ActivationPolicy::Accessory,
 * so a real close would strand it with no window and no Dock tile. Quit lives in
 * the menubar menu.
 */
export default function WindowControls() {
  /** Height before shading, restored on the next click. */
  const preShadeHeight = useRef<number | null>(null);
  /** Frame before zooming, restored on the next click. */
  const preZoom = useRef<{
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);

  /**
   * Roll the panel up to just its title bar. This is what the middle light
   * does instead of minimizing: an NSPanel cannot go to the Dock, and with no
   * Dock tile there would be nothing to click to get it back.
   */
  const toggleShade = async () => {
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const { width, height } = (await win.innerSize()).toLogical(scale);

    if (preShadeHeight.current === null) {
      preShadeHeight.current = height;
      // minHeight would otherwise clamp the shade back open.
      await win.setMinSize(new LogicalSize(MIN_WIDTH, SHADE_HEIGHT));
      await win.setSize(new LogicalSize(width, SHADE_HEIGHT));
    } else {
      await win.setSize(new LogicalSize(width, preShadeHeight.current));
      await win.setMinSize(new LogicalSize(MIN_WIDTH, MIN_HEIGHT));
      preShadeHeight.current = null;
    }
  };

  /** Fill the current monitor, or go back to the pre-zoom frame. */
  const toggleZoom = async () => {
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();

    if (preZoom.current) {
      const { width, height, x, y } = preZoom.current;
      await win.setPosition(new LogicalPosition(x, y));
      await win.setSize(new LogicalSize(width, height));
      preZoom.current = null;
      return;
    }

    const monitor = await currentMonitor();
    if (!monitor) return;

    const size = (await win.innerSize()).toLogical(scale);
    const position = (await win.outerPosition()).toLogical(scale);
    preZoom.current = {
      width: size.width,
      height: size.height,
      x: position.x,
      y: position.y,
    };

    const area = monitor.size.toLogical(monitor.scaleFactor);
    const origin = monitor.position.toLogical(monitor.scaleFactor);
    await win.setPosition(
      new LogicalPosition(origin.x + ZOOM_INSET, origin.y + MENUBAR_INSET),
    );
    await win.setSize(
      new LogicalSize(
        area.width - ZOOM_INSET * 2,
        area.height - MENUBAR_INSET - ZOOM_INSET,
      ),
    );
  };

  const lights = [
    {
      id: "close",
      label: "Hide panel (⌥N brings it back)",
      color: "bg-[#FF5F57]",
      glyph: "✕",
      run: () => void invoke("hide_panel"),
    },
    {
      id: "shade",
      label: "Collapse to the title bar",
      color: "bg-[#FEBC2E]",
      glyph: "−",
      run: () => {
        if (inTauri) void toggleShade();
      },
    },
    {
      id: "zoom",
      label: "Fill the screen",
      color: "bg-[#28C840]",
      glyph: "+",
      run: () => {
        if (inTauri) void toggleZoom();
      },
    },
  ];

  return (
    <div
      // The title bar turns a press into a window drag; a press on a light
      // must not do both.
      onMouseDown={(e) => e.stopPropagation()}
      className="group absolute left-3 z-10 flex items-center gap-2"
    >
      {lights.map((light) => (
        <Tooltip key={light.id} label={light.label} align="left" side="bottom">
          <button
            type="button"
            aria-label={light.label}
            onClick={light.run}
            className={`flex h-3 w-3 items-center justify-center rounded-full ${light.color} text-[8px] leading-none font-bold text-black/60 focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1 focus-visible:outline-none`}
          >
            <span className="opacity-0 group-hover:opacity-100">
              {light.glyph}
            </span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
