/**
 * Top title bar: shows the note title and drags the panel.
 *
 * `data-tauri-drag-region` must sit on the exact element that receives the
 * mousedown, so the text span is pointer-events-none — every click lands on
 * the bar itself. Not a text area by design: the title is derived server-side
 * from the note's first line, so editing happens in the editor, not here.
 */
export interface TitleBarProps {
  title: string;
}

export default function TitleBar({ title }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 cursor-default items-center justify-center border-b border-gray-200 px-10"
    >
      <span className="pointer-events-none select-none truncate text-xs font-medium text-gray-500">
        {title}
      </span>
    </div>
  );
}
