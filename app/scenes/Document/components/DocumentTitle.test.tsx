import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import defaultEmbeds from "@shared/editor/embeds";
import type Extension from "@shared/editor/lib/Extension";
import ExtensionManager from "@shared/editor/lib/ExtensionManager";
import { richExtensions } from "@shared/editor/nodes";
import { light } from "@shared/styles/theme";
import DocumentTitle from "./DocumentTitle";

const manager = new ExtensionManager(richExtensions);
const schema = new Schema({ nodes: manager.nodes, marks: manager.marks });
for (const extension of manager.extensions) {
  extension.bindEditor({
    schema,
    props: { theme: light, embeds: defaultEmbeds },
  } as unknown as Parameters<Extension["bindEditor"]>[0]);
}
const pasteParser = manager.parser({
  schema,
  plugins: manager.rulePlugins,
  rules: { linkify: true },
});
let view: EditorView;
let root: Root;
let host: HTMLDivElement;
const execCommand = vi.fn(() => true);

vi.mock("~/components/DocumentContext", () => ({
  useDocumentContext: () => ({ editor: { view, pasteParser } }),
}));
vi.mock("~/hooks/usePolicy", () => ({ default: () => ({ update: false }) }));
vi.mock("~/hooks/useOnScreen", () => ({ default: () => true }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  execCommand.mockClear();
  host = document.body.appendChild(document.createElement("div"));
  const editorHost = document.body.appendChild(document.createElement("div"));
  view = new EditorView(editorHost, { state: EditorState.create({ schema }) });
  root = createRoot(host);
  act(() =>
    root.render(
      <ThemeProvider theme={light}>
        <DocumentTitle documentId="control" title="Original" color="#000000" />
      </ThemeProvider>
    )
  );
});

afterEach(() => {
  act(() => root.unmount());
  view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function paste(text: string, html: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : html) },
  });
  act(() => {
    host.querySelector('[aria-label="Document title"]')!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}

it("keeps the first pasted HTML line in the title and inserts remaining body lines", () => {
  paste(
    "New title\nFirst body\nSecond body",
    "<p>New title</p><p>First body</p><p>Second body</p>"
  );
  expect(execCommand).toHaveBeenCalledWith("insertText", false, "New title");
  expect(view.state.doc.textContent).toContain("First bodySecond body");
  expect(view.state.doc.textContent).not.toContain("New title");
  view.state.doc.check();
});

it("keeps title paste compatible with Markdown headings and lists", () => {
  paste("# New title\n## Body heading\n\n* Item", "");
  expect(execCommand).toHaveBeenCalledWith("insertText", false, "New title");
  expect(manager.serializer().serialize(view.state.doc)).toContain(
    "## Body heading"
  );
  expect(view.state.doc.textContent).toContain("Item");
  expect(pasteParser.tokenizer.options.linkify).toBe(true);
});

it("rejects a forged clipboard context before splitting title from body", () => {
  const context = JSON.stringify(["heading", { level: "2" }]);
  paste(
    "New title\nSafe body",
    `<p data-pm-slice='0 0 ${context}'>New title</p><p>Safe body</p>`
  );
  expect(execCommand).toHaveBeenCalledWith("insertText", false, "New title");
  expect(view.state.doc.textContent).toContain("Safe body");
  view.state.doc.check();
});
