import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import Editor from "./components/Editor";
import "./App.css";

const SAMPLE = `# FloatNotes harness

Type markdown on the left — the raw document appears on the right.

- [ ] try a task
- **bold**, *italic*, \`code\`
`;

/**
 * Dev-only editor harness (step 02): visit /harness.html under \`bun run dev\`.
 * main.tsx / index.html are untouched; \`vite build\` only bundles index.html.
 */
function Harness() {
  const [markdown, setMarkdown] = useState(SAMPLE);

  return (
    <div className="grid h-screen grid-cols-2 gap-4 bg-white p-6">
      <div className="overflow-auto rounded-lg border border-gray-300 p-4">
        <Editor value={markdown} onChange={setMarkdown} />
      </div>
      <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-gray-300 bg-gray-50 p-4 text-xs">
        {markdown}
      </pre>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
