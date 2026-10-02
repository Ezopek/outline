import { JSDOM } from "jsdom";
import type { AttributeSpec, MarkType, NodeType } from "prosemirror-model";
import { DOMSerializer, Fragment, Schema } from "prosemirror-model";
import env from "../../env";
import { MentionType } from "../../types";
import type * as Urls from "../../utils/urls";
import { sanitizeImageSrc, sanitizeUrl } from "../../utils/urls";
import defaultEmbeds, { EmbedDescriptor } from "../embeds";
import type Extension from "../lib/Extension";
import ExtensionManager from "../lib/ExtensionManager";
import type { AnyExtensionClass } from "../lib/types";
import { basicExtensions, richExtensions, withComments } from ".";

vi.mock("../../utils/urls", async (importOriginal) => {
  const actual = await importOriginal<typeof Urls>();
  return {
    ...actual,
    sanitizeUrl: vi.fn(actual.sanitizeUrl),
    sanitizeImageSrc: vi.fn(actual.sanitizeImageSrc),
  };
});

const BASE_URL = "https://wiki.example.test";
const MODEL_ID = "c85a0d80-3a89-4b25-a0cd-e7fc83f0d226";
const MENTION_ID = "0c440212-8b40-49fa-8a64-2548d6b60d59";
const UNSAFE_PROTOCOLS = ["javascript:", "vbscript:", "data:", "file:"];

/* oxlint-disable no-script-url */
const MALICIOUS = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "\u0001javascript:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "javascript://example.com/%0Aalert(1)",
  "vbscript:msgbox(1)",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+",
  "file:///etc/passwd",
];
const PROBE = "javascript:alert(1)";
/* oxlint-enable no-script-url */

const ALLOWED_DATA_IMAGES = [
  "data:image/png;base64,iVBORw0KGgo=",
  "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  "data:image/gif;base64,R0lGODlhAQABAA==",
  "data:image/webp;base64,UklGRhoAAABXRUJQ",
  "data:image/avif;base64,AAAAIGZ0eXBhdmlm",
];

type SafePair = [string | null, string];

const SAFE_HREFS: SafePair[] = [
  ["https://example.com/a?q=1#f", "https://example.com/a?q=1#f"],
  ["/doc/welcome-abc123", "/doc/welcome-abc123"],
  ["#section", "#section"],
  ["mailto:team@example.com", "mailto:team@example.com"],
  ["www.example.com", "https://www.example.com"],
  ["http://example.com/a", "http://example.com/a"],
  ["tel:+15550100", "tel:+15550100"],
];

const SAFE_SRCS: SafePair[] = [
  ["https://example.com/p.png", "https://example.com/p.png"],
  ["/api/attachments.redirect?id=x", "/api/attachments.redirect?id=x"],
];

const SAFE_IMAGE_SRCS: SafePair[] = [
  ...SAFE_SRCS,
  [ALLOWED_DATA_IMAGES[0], ALLOWED_DATA_IMAGES[0]],
];

/** A test-only embed that delivers any value to the iframe `src` sanitizer. */
const probeEmbed = new EmbedDescriptor({
  id: "probe",
  title: "Probe",
  regexMatch: [/^probe:(.+)$/s],
  transformMatch: (matches) => matches[1],
});

const domDocument = new JSDOM("").window.document;

/**
 * Builds a schema from a production extension set and binds every extension
 * to a stub editor, as the server does.
 *
 * @param extensions the extension classes.
 * @returns the bound schema.
 */
function createSchema(extensions: AnyExtensionClass[]) {
  const manager = new ExtensionManager(extensions);
  const schema = new Schema({ nodes: manager.nodes, marks: manager.marks });
  const editor = {
    schema,
    props: {
      theme: { isDark: false },
      embeds: [...defaultEmbeds, probeEmbed],
      embedsDisabled: false,
    },
  } as unknown as Parameters<Extension["bindEditor"]>[0];
  for (const extension of manager.extensions) {
    extension.bindEditor(editor);
  }
  return schema;
}

const richSchema = createSchema(withComments(richExtensions));
const basicSchema = createSchema(withComments(basicExtensions));

/**
 * Whether an emitted value cannot execute: absent, unparseable, or parsed to
 * a protocol outside the unsafe set.
 *
 * @param value the emitted attribute value.
 * @returns true if the value is neutralized.
 */
function isNeutralized(value: string | null) {
  if (value === null) {
    return true;
  }
  try {
    return !UNSAFE_PROTOCOLS.includes(
      new URL(value, "https://base.invalid/").protocol
    );
  } catch {
    return true;
  }
}

/**
 * Wraps a serialized fragment or node in a container element.
 *
 * @param child the serialized DOM.
 * @returns the container.
 */
function contain(child: globalThis.Node) {
  const container = domDocument.createElement("div");
  container.appendChild(child);
  return container;
}

type EmissionPath = {
  /** The inventory entry. */
  name: string;
  schema: Schema;
  sanitizer: "sanitizeUrl" | "sanitizeImageSrc";
  selector: string;
  attr: "href" | "src";
  /** Builds the document JSON that carries the input. */
  build: (input: string | null) => Record<string, unknown>;
  /** The visible text the render must keep. */
  text: (input: string | null) => string;
  /** Maps a malicious fixture to the attribute value that reaches the path. */
  deliver?: (input: string) => string;
  /** Maps a malicious fixture to the value the sanitizer must receive. */
  received?: (input: string) => string;
  /** Inputs paired with the literal value they must emit. */
  safe: SafePair[];
  /** Inputs that must leave the attribute absent. */
  missing: (string | null)[];
};

const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const mention = (attrs: Record<string, unknown>) =>
  paragraph({
    type: "mention",
    attrs: { id: MENTION_ID, label: "Welcome", modelId: MODEL_ID, ...attrs },
  });

/** Every mention type whose href comes from `attrs.href`, including later additions. */
const EXTERNAL_MENTION_TYPES = Object.values(MentionType).filter(
  (type) =>
    ![
      MentionType.User,
      MentionType.Date,
      MentionType.Document,
      MentionType.Collection,
    ].includes(type)
);

const PATHS: EmissionPath[] = [
  {
    name: "link a[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a",
    attr: "href",
    build: (href) =>
      doc(
        paragraph({
          type: "text",
          text: "Link text",
          marks: [{ type: "link", attrs: { href } }],
        })
      ),
    text: () => "Link text",
    safe: SAFE_HREFS,
    missing: [""],
  },
  {
    name: "attachment a.attachment[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a.attachment",
    attr: "href",
    build: (href) =>
      doc({ type: "attachment", attrs: { href, title: "Spec.pdf" } }),
    text: () => "Spec.pdf",
    safe: SAFE_HREFS,
    missing: ["", null],
  },
  {
    name: "embed iframe[src]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "iframe",
    attr: "src",
    build: (href) => doc({ type: "embed", attrs: { href } }),
    text: () => "",
    deliver: (input) => `probe:${input}`,
    safe: [
      ["https://framer.cloud/abc123", "https://framer.cloud/abc123"],
      ["https://example.com/a?q=1#f", "https://example.com/a?q=1#f"],
      ["probe:www.example.com", "https://www.example.com"],
    ],
    missing: [""],
  },
  {
    name: "embed a.embed[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a.embed",
    attr: "href",
    build: (href) => doc({ type: "embed", attrs: { href } }),
    text: (href) => href ?? "",
    // The generic embed claims every https:// value, see the iframe path.
    safe: SAFE_HREFS.filter(([input]) => !/^https?:\/\//.test(input ?? "")),
    missing: [""],
  },
  {
    name: "image img[src]",
    schema: richSchema,
    sanitizer: "sanitizeImageSrc",
    selector: "img",
    attr: "src",
    build: (src) =>
      doc(paragraph({ type: "image", attrs: { src, alt: "Diagram" } })),
    text: () => "Diagram",
    safe: SAFE_IMAGE_SRCS,
    missing: [""],
  },
  {
    name: "image a[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a",
    attr: "href",
    build: (href) =>
      doc(
        paragraph({
          type: "image",
          attrs: {
            src: "https://example.com/p.png",
            alt: "Diagram",
            marks: [{ type: "link", attrs: { href } }],
          },
        })
      ),
    text: () => "Diagram",
    safe: SAFE_HREFS,
    missing: ["", null],
  },
  {
    name: "basic image img[src]",
    schema: basicSchema,
    sanitizer: "sanitizeImageSrc",
    selector: "img",
    attr: "src",
    build: (src) =>
      doc(paragraph({ type: "image", attrs: { src, alt: "Diagram" } })),
    text: () => "",
    safe: SAFE_IMAGE_SRCS,
    missing: ["", null],
  },
  {
    name: "video video[src]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "video",
    attr: "src",
    build: (src) => doc({ type: "video", attrs: { src, title: "Demo" } }),
    text: () => "Demo",
    safe: SAFE_SRCS,
    missing: ["", null],
  },
  ...EXTERNAL_MENTION_TYPES.map((type): EmissionPath => ({
    name: `mention (${type}) a[href]`,
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a.mention",
    attr: "href",
    build: (href) => doc(mention({ type, href })),
    text: () => "Welcome",
    safe: SAFE_HREFS,
    missing: ["", null],
  })),
  {
    name: "mention (document) modelId a[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a.mention",
    attr: "href",
    build: (modelId) => doc(mention({ type: MentionType.Document, modelId })),
    text: () => "Welcome",
    received: (modelId) => `${BASE_URL}/doc/${modelId}`,
    safe: [[MODEL_ID, `${BASE_URL}/doc/${MODEL_ID}`]],
    missing: [],
  },
  {
    name: "mention (document) anchorId a[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a.mention",
    attr: "href",
    build: (anchorId) => doc(mention({ type: MentionType.Document, anchorId })),
    text: () => "Welcome",
    received: (anchorId) => `${BASE_URL}/doc/${MODEL_ID}#${anchorId}`,
    safe: [
      ["heading-1", `${BASE_URL}/doc/${MODEL_ID}#heading-1`],
      ["", `${BASE_URL}/doc/${MODEL_ID}`],
      [null, `${BASE_URL}/doc/${MODEL_ID}`],
    ],
    missing: [],
  },
  {
    name: "mention (collection) modelId a[href]",
    schema: richSchema,
    sanitizer: "sanitizeUrl",
    selector: "a.mention",
    attr: "href",
    build: (modelId) => doc(mention({ type: MentionType.Collection, modelId })),
    text: () => "Welcome",
    received: (modelId) => `${BASE_URL}/collection/${modelId}`,
    safe: [[MODEL_ID, `${BASE_URL}/collection/${MODEL_ID}`]],
    missing: [],
  },
];

/**
 * Renders a path's document through `DOMSerializer`, asserting that the
 * render leaves the document unchanged and keeps its visible text.
 *
 * @param path the emission path.
 * @param input the value placed in the document.
 * @returns the rendered container.
 */
function renderPath(path: EmissionPath, input: string | null) {
  const node = path.schema.nodeFromJSON(path.build(input));
  const before = JSON.stringify(node.toJSON());
  const container = contain(
    DOMSerializer.fromSchema(path.schema).serializeFragment(node.content, {
      document: domDocument,
    })
  );
  expect(JSON.stringify(node.toJSON())).toBe(before);
  expect(container.textContent).toBe(path.text(input));
  return container;
}

let actual: typeof Urls;
let hadUrl: boolean;
let previousUrl: string | undefined;

beforeAll(async () => {
  actual = await vi.importActual<typeof Urls>("../../utils/urls");
  hadUrl = "URL" in env;
  previousUrl = env.URL;
  env.URL = BASE_URL;
});

afterAll(() => {
  if (hadUrl) {
    env.URL = previousUrl;
  } else {
    delete env.URL;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(PATHS)("$name", (path) => {
  const spy = path.sanitizer === "sanitizeUrl" ? sanitizeUrl : sanitizeImageSrc;

  it.each(path.safe)("renders %j as %j", (input, expected) => {
    const element = renderPath(path, input).querySelector(path.selector);
    expect(element).not.toBeNull();
    expect(element?.getAttribute(path.attr)).toBe(expected);
  });

  it.each(MALICIOUS)("neutralizes %j", (input) => {
    const received = path.received?.(input) ?? input;
    const element = renderPath(
      path,
      path.deliver?.(input) ?? input
    ).querySelector(path.selector);
    expect(element).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(received);

    const value = element?.getAttribute(path.attr) ?? null;
    expect(value).toBe(actual[path.sanitizer](received) ?? null);
    expect(isNeutralized(value)).toBe(true);
  });

  if (path.missing.length > 0) {
    it.each(path.missing)("omits the attribute for %j", (input) => {
      const element = renderPath(path, input).querySelector(path.selector);
      expect(element?.getAttribute(path.attr) ?? null).toBeNull();
    });
  }
});

describe("sanitizeImageSrc", () => {
  const inputs = [
    ...new Set([
      ...PATHS.flatMap((path) => [
        ...path.safe.map(([input]) => input),
        ...path.missing,
      ]),
      ...MALICIOUS,
    ]),
  ].filter((input) => !ALLOWED_DATA_IMAGES.includes(input as string));

  it.each(inputs)("delegates %j to sanitizeUrl", (input) => {
    expect(actual.sanitizeImageSrc(input)).toBe(actual.sanitizeUrl(input));
  });

  it.each(ALLOWED_DATA_IMAGES)("returns %j unchanged", (input) => {
    expect(actual.sanitizeImageSrc(input)).toBe(input);
  });
});

describe("toDOM sweep", () => {
  /** Attribute values that a flat string probe cannot represent. */
  const STRUCTURED_PROBES: Record<string, Record<string, unknown>> = {
    image: { marks: [{ type: "link", attrs: { href: PROBE } }] },
  };

  /** Extra renders that reach the value-gated branches of a node type. */
  const VARIANTS: Record<string, Record<string, unknown>[]> = {
    mention: Object.values(MentionType).map((type) => ({ type })),
    embed: [{ href: `probe:${PROBE}` }],
    // A small numeric width renders the rich image's inline-icon `span` branch.
    image: [{ width: 16 }],
  };

  const SCHEMAS = [
    {
      name: "rich",
      schema: richSchema,
      inventory: [
        "attachment a[href]",
        "embed a[href]",
        "embed iframe[src]",
        "image img[src]",
        "image a[href]",
        "link a[href]",
        "mention a[href]",
        "video video[src]",
      ],
    },
    {
      name: "basic",
      schema: basicSchema,
      inventory: ["image img[src]", "link a[href]", "mention a[href]"],
    },
  ];

  /**
   * Whether an attribute may hold a string, judged by its `validate`.
   *
   * @param spec the attribute spec.
   * @returns true if a string passes validation.
   */
  function acceptsString(spec: AttributeSpec) {
    const { validate } = spec;
    if (validate === undefined) {
      return true;
    }
    if (typeof validate === "string") {
      return validate.split("|").includes("string");
    }
    try {
      validate(PROBE);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Builds probe attributes: required attributes always carry the probe, and
   * each optional string-capable attribute carries it when it still renders.
   *
   * @param type the node or mark type.
   * @param render renders the type with the given attributes.
   * @returns the probe attributes.
   */
  function probeAttrs(
    type: NodeType | MarkType,
    render: (attrs: Record<string, unknown>) => HTMLElement | undefined
  ) {
    const specs = type.spec.attrs ?? {};
    const structured = STRUCTURED_PROBES[type.name] ?? {};
    const required: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(specs)) {
      if (!("default" in spec)) {
        required[name] = structured[name] ?? PROBE;
      }
    }

    const attrs = { ...required };
    for (const [name, spec] of Object.entries(specs)) {
      if (name in required || (!(name in structured) && !acceptsString(spec))) {
        continue;
      }
      const value = structured[name] ?? PROBE;
      if (render({ ...required, [name]: value })) {
        attrs[name] = value;
      }
    }
    return attrs;
  }

  /**
   * Collects every `href` and `src` the container emits.
   *
   * @param typeName the rendered type.
   * @param container the rendered container.
   * @returns the emission keys and values.
   */
  function observe(typeName: string, container: HTMLElement) {
    return Array.from(container.querySelectorAll("[href], [src]")).flatMap(
      (element) =>
        ["href", "src"].flatMap((attr) => {
          const value = element.getAttribute(attr);
          return value === null
            ? []
            : [
                {
                  key: `${typeName} ${element.tagName.toLowerCase()}[${attr}]`,
                  value,
                },
              ];
        })
    );
  }

  it.each(SCHEMAS)(
    "emits exactly the declared inventory ($name)",
    ({ schema, inventory }) => {
      const serializer = DOMSerializer.fromSchema(schema);
      const observations: { key: string; value: string }[] = [];

      for (const type of Object.values(schema.nodes)) {
        if (!type.spec.toDOM) {
          continue;
        }
        const render = (attrs: Record<string, unknown>) => {
          try {
            return contain(
              serializer.serializeNode(type.create(attrs), {
                document: domDocument,
              })
            );
          } catch {
            return undefined;
          }
        };
        const attrs = probeAttrs(type, render);
        for (const variant of [{}, ...(VARIANTS[type.name] ?? [])]) {
          const container = render({ ...attrs, ...variant });
          expect(container, type.name).toBeDefined();
          if (container) {
            observations.push(...observe(type.name, container));
          }
        }
      }

      for (const type of Object.values(schema.marks)) {
        const render = (attrs: Record<string, unknown>) => {
          try {
            return contain(
              serializer.serializeFragment(
                Fragment.from(schema.text("Probe text", [type.create(attrs)])),
                { document: domDocument }
              )
            );
          } catch {
            return undefined;
          }
        };
        const container = render(probeAttrs(type, render));
        expect(container, type.name).toBeDefined();
        if (container) {
          observations.push(...observe(type.name, container));
        }
      }

      expect(new Set(observations.map(({ key }) => key))).toEqual(
        new Set(inventory)
      );
      for (const { key, value } of observations) {
        expect(isNeutralized(value), `${key}: ${value}`).toBe(true);
      }
    }
  );
});
