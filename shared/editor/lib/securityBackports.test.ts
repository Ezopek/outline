import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { DOMSerializer, Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView, __parseFromClipboard } from "prosemirror-view";
import { prosemirrorToYDoc, yDocToProsemirror } from "y-prosemirror";
import * as Y from "yjs";
import defaultEmbeds from "../embeds";
import { richExtensions, withComments } from "../nodes";
import type Extension from "./Extension";
import ExtensionManager from "./ExtensionManager";

const requirePackage = createRequire(import.meta.url);
const manager = new ExtensionManager(withComments(richExtensions));
const schema = new Schema({ nodes: manager.nodes, marks: manager.marks });
for (const extension of manager.extensions) {
  extension.bindEditor({
    schema,
    props: {
      theme: { isDark: false },
      embeds: defaultEmbeds,
      embedsDisabled: false,
    },
  } as unknown as Parameters<Extension["bindEditor"]>[0]);
}
const parser = manager.parser({ schema, plugins: manager.rulePlugins });
const serializer = manager.serializer();
const views: EditorView[] = [];
let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("", {
    pretendToBeVisual: true,
    url: "https://wiki.example.test",
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "MutationObserver",
    "Node",
    "HTMLElement",
  ]) {
    vi.stubGlobal(
      key,
      key === "window" ? dom.window : dom.window[key as keyof Window]
    );
  }
  vi.stubGlobal(
    "getComputedStyle",
    dom.window.getComputedStyle.bind(dom.window)
  );
  // jsdom lacks ClipboardEvent; pasteHTML supplies its own HTML payload and
  // needs only the event identity, not a platform clipboard implementation.
  vi.stubGlobal("ClipboardEvent", dom.window.Event);
});

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
  document.body.replaceChildren();
});

afterAll(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

function createView() {
  const host = document.body.appendChild(document.createElement("div"));
  const view = new EditorView(host, { state: EditorState.create({ schema }) });
  views.push(view);
  return view;
}

describe("ProseMirror security backport", () => {
  it("uses the exact qualified view and minimum compatible model", () => {
    for (const [name, version] of [
      ["prosemirror-view", "1.42.3"],
      ["prosemirror-model", "1.25.8"],
    ]) {
      const manifest = path.join(
        path.dirname(requirePackage.resolve(name)),
        "../package.json"
      );
      expect(JSON.parse(readFileSync(manifest, "utf8")).version).toBe(version);
    }
  });

  it.each([
    ["heading", { level: "2" }],
    ["image", { src: ["img", { src: "invalid" }] }],
    ["image", { src: "/image.png", alt: { invalid: true } }],
  ])(
    "rejects forged %s clipboard context using shipped validators",
    (name, attrs) => {
      const view = createView();
      const element = document.createElement("p");
      element.textContent = "Safe content";
      element.setAttribute(
        "data-pm-slice",
        `0 0 ${JSON.stringify([name, attrs])}`
      );
      const slice = __parseFromClipboard(
        view,
        "Safe content",
        element.outerHTML,
        false,
        view.state.selection.$from
      );
      expect(slice?.content.firstChild?.type.name).toBe("paragraph");
      expect(slice?.content.textBetween(0, slice.content.size)).toBe(
        "Safe content"
      );
    }
  );

  it("preserves valid copied block context and ordinary external HTML", () => {
    const view = createView();
    const copied = "<p data-pm-slice='0 0 [\"blockquote\",null]'>Quoted</p>";
    const slice = __parseFromClipboard(
      view,
      "Quoted",
      copied,
      false,
      view.state.selection.$from
    );
    expect(slice?.content.firstChild?.type.name).toBe("blockquote");
    expect(
      view.pasteHTML(
        "<h2>Heading</h2><p><strong>Ordinary</strong> text</p><ul><li>Item</li></ul>"
      )
    ).toBe(true);
    view.state.doc.check();
    expect(view.state.doc.textContent).toContain("Ordinary text");
    expect(serializer.serialize(view.state.doc)).toContain("## Heading");
  });

  it("retains safe links and sanitizes unsafe href/src during clipboard rendering", () => {
    const view = createView();
    // No script executes: jsdom has no script execution or resource loading enabled.
    const html =
      '<p><a href="javascript:alert(1)">Unsafe</a> <a href="/doc/control-abcdefghij">Safe</a><img src="javascript:alert(1)" alt="image"></p>';
    expect(view.pasteHTML(html)).toBe(true);
    const output = document.createElement("div");
    output.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(view.state.doc.content)
    );
    for (const element of output.querySelectorAll("[href], [src]")) {
      expect(
        element.getAttribute("href") ?? element.getAttribute("src")
      ).not.toMatch(/^javascript:/i);
    }
    expect(
      output.querySelector('a[href="/doc/control-abcdefghij"]')?.textContent
    ).toBe("Safe");
  });

  it("round trips tables, lists and links through collaborative state and Markdown", () => {
    const markdown =
      "## Heading\n\n* Item\n\n[Safe](/doc/control-abcdefghij)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    const original = parser.parse(markdown);
    const source = prosemirrorToYDoc(original);
    const receiver = new Y.Doc();
    try {
      Y.applyUpdate(receiver, Y.encodeStateAsUpdate(source));
      const restored = yDocToProsemirror(schema, receiver);
      restored.check();
      expect(restored.toJSON()).toEqual(original.toJSON());
      const canonical = serializer.serialize(restored);
      expect(serializer.serialize(parser.parse(canonical))).toBe(canonical);
    } finally {
      source.destroy();
      receiver.destroy();
    }
  });
});
