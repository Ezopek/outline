---
title: 'Story 1.9: Sanitize User-Controlled Editor URLs'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: 'c26dc05c9997ae151043ffb5e4050f46b13beb7f'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** NFR-13 and AD-18 require every user-controlled `href`/`src` that a ProseMirror `toDOM` emits to pass through `sanitizeUrl()` or an existing wrapper proven to call it, with a conformance suite that fails on removal or bypass. On the `v1.10.1` baseline, the `mention` node builds its Document and Collection `href` directly from the user-controlled `modelId` and `anchorId` (`shared/editor/nodes/Mention.tsx:166-176`). No test renders any emission path with malicious fixtures.

**Approach:**
- Route every non-User/Date `mention` `href` through one `sanitizeUrl()` call.
- Add one collocated conformance suite. It renders every emission path through `DOMSerializer`, which calls `toDOM`, with safe and malicious fixtures.
- Spies prove that each path calls the sanitizer. A behavioural test proves that `sanitizeImageSrc` delegates to `sanitizeUrl`.
- A probe sweep over every node and mark of the production extension sets fails when an emitter is added, or when one bypasses the sanitizer.

## Boundaries & Constraints

**Always:**
- **Sanitizer contract:** `sanitizeUrl()` and `sanitizeImageSrc()` at `shared/utils/urls.ts:207-246` are unchanged baseline code.
  - `sanitizeUrl()`: empty input gives `undefined`, so the attribute is absent. A blocked or unparseable value gains an `https://` prefix. Values starting with `/` or `#`, allowed schemes, and valid URLs pass trimmed.
  - `sanitizeImageSrc()`: returns allow-listed base64 `data:image/{png,jpeg,gif,webp,avif}` unchanged and passes every other value to `sanitizeUrl`.
- **Neutralized** means one of three things holds: the attribute is absent, WHATWG `new URL(value, "https://base.invalid/")` throws, or the parsed protocol is none of `javascript:`, `vbscript:`, `data:`, `file:`.
- **Emission inventory**, 11 paths:
  1. `link` mark `a[href]`.
  2. `attachment` `a.attachment[href]`.
  3. `embed` `iframe[src]`, built from `transformMatch`.
  4. `embed` fallback `a.embed[href]`.
  5. rich `image` `img[src]`, through `sanitizeImageSrc`.
  6. rich `image` link `a[href]`, from `attrs.marks`.
  7. basic `image` (`SimpleImage`) `img[src]`, through `sanitizeImageSrc`.
  8. `video` `video[src]`.
  9. `mention` `a[href]` for the external types Group, Issue, PullRequest, Project, and URL.
  10. `mention` Document: `${env.URL}/doc/${modelId}`, plus `#${anchorId}` when set.
  11. `mention` Collection: `${env.URL}/collection/${modelId}`.
- **Safe values** render byte-identical to the baseline. With `env.URL` configured, the Document and Collection hrefs do not change.
- **No side effects:** rendering never mutates node attrs. Markdown serialization and every lint path stay untouched; neither calls `toDOM`.
- **Test placement:** tests are collocated under `shared/editor/nodes/`. They pass in both the `shared-node` and `shared-jsdom` projects, given an explicit `JSDOM` document for `DOMSerializer`.

**Never:**
- **Unchanged code:** `sanitizeUrl`, `sanitizeImageSrc`, `toMarkdown`, `parseDOM`, React components and NodeViews, and `data-*` attributes.
- **No additions:** no new sanitizer, renderer, or dependency.
- **Excluded techniques:** secret scanning, semantic URL classification, and fuzzy-link inference.
- **No backport** of the post-`v1.10.1` patch-edit fix.
- **No pilot identifiers:** fixtures use `example.com` and `wiki.example.test` only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Safe value, every `href` path | `https://example.com/a?q=1#f`, `/doc/welcome-abc123`, `#section`, `mailto:team@example.com` | emitted unchanged | none |
| Bare host | `www.example.com` | `https://www.example.com` (baseline) | none |
| Safe `src` (image, video) | `https://example.com/p.png`, `/api/attachments.redirect?id=x`; image only: `data:image/png;base64,iVBORw0KGgo=` | emitted unchanged | none |
| Safe embed | default Framer embed `https://framer.cloud/abc123` | `iframe[src]` is the same value | none |
| Safe mention | `env.URL=https://wiki.example.test`, a UUID `modelId`, `anchorId: heading-1` | `https://wiki.example.test/doc/<uuid>#heading-1`, `https://wiki.example.test/collection/<uuid>` | none |
| Malicious value, every path | `javascript:alert(1)`; `JaVaScRiPt:alert(1)`; a leading-space, a leading-`\u0001`, an embedded-`\t`, and an embedded-`\n` variant; `javascript://example.com/%0Aalert(1)`; `vbscript:msgbox(1)`; `data:text/html;base64,…`; `data:image/svg+xml;base64,…`; `file:///etc/passwd` | emitted value equals the sanitizer applied to the raw value, and is neutralized | none |
| Malicious value, mention Document/Collection | the malicious set placed in `modelId` and in `anchorId` | same as the malicious row | none |
| Malicious value, embed `iframe[src]` | `probe:<malicious>` through a test-only embed whose `transformMatch` returns `<malicious>` | same as the malicious row | none |
| Missing value | `""` or `null` | attribute absent | none |

</intent-contract>

## Code Map

- `shared/utils/urls.ts:182-246` -- `allowedSchemes`, `allowedImageDataUris`, `sanitizeUrl`, and `sanitizeImageSrc`; read-only. `isUrl` (`:110-150`) blocks `javascript:`, `file:`, `vbscript:`, and `data:`.
- `shared/editor/nodes/Mention.tsx:153-187` -- `toDOM`.
  - `href` (`:166-176`) is the only direct construction, for the Document and Collection types.
  - `env` comes from `../../env`: `process.env` in node, `window.env` in jsdom, where `URL` is unset.
- **Already sanitized**, read-only:
  - `shared/editor/marks/Link.tsx:94-103`.
  - `shared/editor/nodes/Attachment.tsx:77-86`.
  - `shared/editor/nodes/Embed.tsx:69-98`, which reads `this.editor?.props.embeds ?? defaultEmbeds` at render time.
  - `shared/editor/nodes/Image.tsx:244-298`: an `...attrs` spread, then a `src` override; the link comes from `attrs.marks`.
  - `shared/editor/nodes/SimpleImage.tsx:76-89`.
  - `shared/editor/nodes/Video.tsx:73-90`.
- **Probe-sweep evidence:** no other `toDOM` in `shared/editor/{nodes,marks}` emits `href` or `src`. Only `doc` and `text` lack a `toDOM`, and only the rich `image.marks` needs a structured probe.
  - A table cell's `colwidth` has no `validate` but holds a number array. In jsdom, `setCellAttrs` (`shared/editor/lib/table.ts:155-157`) throws on a string there. So an attribute counts as string-capable only when its `validate` accepts a string and `toDOM` renders with a string in it.
- **Value-gated branches:**
  - `mention` emits a different `href` for each `MentionType` (`shared/types.ts:126-136`). User and Date emit none.
  - `embed` emits `iframe[src]` only when an embed descriptor matches the `href`.
  - A single flat probe value reaches neither the Document/Collection mention branches nor the iframe.
- **Sibling sanitizer calls:**
  - On Embed, `data-canonical-url` calls `sanitizeUrl(node.attrs.href)`. On Issue, PullRequest and Project mentions, `data-url` does the same. On paths 4 and 9 the spy therefore cannot tell that `href` made the call, and the emitted-value equality check is what catches a bypass.
  - For Document and Collection mentions, `data-url` is `mention://…` and calls no sanitizer.
- **Extension sets:** `shared/editor/nodes/index.ts:56-150` defines `richExtensions`, `basicExtensions`, and `withComments`. `server/editor/index.ts:34-75` builds the production sets from them and binds a stub editor with `embeds: defaultEmbeds`.
- **Extension plumbing:** `shared/editor/lib/ExtensionManager.ts:22-61` instantiates extensions; `Extension.bindEditor` is at `shared/editor/lib/Extension.ts:35`.
- **Embeds:** `shared/editor/embeds/index.tsx:49` defines `EmbedDescriptor`, and the default export `embeds` is at `:749`.
  - Framer (`:296-302`) returns `matches[0]`. Every default regex is anchored to `https?://`.
  - The last default is the generic embed (`:735-746`, `^https?://(.*)$`). An `http(s)` href on an `embed` node therefore always renders `iframe[src]`, never the `a.embed` fallback.
- **Test setup:**
  - `shared/test/editor.ts` -- the schema precedent.
  - `vitest.config.ts:96-120` -- `shared/**` runs under both `shared-node` and `shared-jsdom`.
  - `__mocks__/console.js` -- silences the console.
- **Must stay green:**
  - `shared/editor/nodes/Mention.test.ts`;
  - `server/models/helpers/DocumentHelper.test.ts:291-306`, the server export of `mention` through `toDOM`.

## Tasks & Acceptance

**Execution:**
- `shared/editor/nodes/Mention.tsx` -- wrap the whole non-User/Date `href` expression (Document, Collection, and `node.attrs.href`) in a single `sanitizeUrl(...)` -- this removes the only direct-construction bypass and leaves one chokepoint.
- `shared/editor/nodes/urlSanitization.test.ts` (new) -- the conformance suite:
  - **Mock:** `vi.mock("../../utils/urls")` re-exports the actual module, with `sanitizeUrl` and `sanitizeImageSrc` wrapped as `vi.fn(actual…)`.
  - **Schemas:** built from `withComments(richExtensions)` and `withComments(basicExtensions)`.
    - Each extension is bound to a stub editor whose `embeds` are `defaultEmbeds` plus a test-only descriptor: `regexMatch: [/^probe:(.+)$/s]`, `transformMatch: (m) => m[1]`. The dotAll flag lets the embedded-newline value reach `iframe[src]`.
    - `env.URL` is set to `https://wiki.example.test` for the suite and restored afterwards.
  - **Path table:** a data-driven table of the 11 inventory paths.
    - Each safe fixture asserts the literal expected value. On the `a.embed` fallback path, `https://` fixtures are covered on the `iframe[src]` path instead, because the generic embed claims them.
    - Each malicious fixture asserts three things: the spy was called with the raw value; the emitted attribute equals the actual sanitizer result, or is absent when that result is `undefined`; the value is neutralized.
    - Every render leaves the document JSON unchanged and keeps the visible text.
  - **Delegation:** `sanitizeImageSrc` equals the actual `sanitizeUrl` for every fixture that is not an allow-listed data image, and returns the allow-listed data images unchanged.
  - **Sweep:**
    - **Rendering:** each schema renders every node type with a `toDOM`, and every mark type, with each string-capable attr set to `javascript:alert(1)`. The rich `image.marks` attr gets the structured probe `[{ type: "link", attrs: { href: probe } }]`.
    - **Discriminator variants:** besides the flat render, a node type that has a value-gated branch is rendered once per variant. All other attributes keep the flat probe, and each variant overrides them.
      - `mention`: one variant per value in `Object.values(MentionType)`, so a type added later is included automatically.
      - `embed`: `href: probe:<probe>`, so the test-only descriptor reaches `iframe[src]`.
    - **Inventory:** the observed `type tag[attr]` set, across flat and variant renders, must equal exactly:
      - rich: `attachment a[href]`, `embed a[href]`, `embed iframe[src]`, `image img[src]`, `image a[href]`, `link a[href]`, `mention a[href]`, `video video[src]`;
      - basic: `image img[src]`, `link a[href]`, `mention a[href]`.
    - **Values:** every observed value must be neutralized.

**Acceptance Criteria:**
- **Inventory guard:** Given the `v1.10.1` production extension sets, when the sweep renders every node and mark, flat and with the discriminator variants, then the observed `href` and `src` emissions equal the declared per-schema sets above. Each of the following fails the suite:
  - a new node or mark that emits `href` or `src`;
  - a new `MentionType` whose branch emits a raw `href`;
  - a raw attribute that reaches `href` or `src` on any rendered branch.
- **Value-gated mutation:** Given a temporary mutation that makes the User or Date mention branch emit the raw `node.attrs.href`, when the suite runs, then the sweep fails. The mutation is checked during verification and then reverted.
- **Bypass detection:** Given a temporary mutation that replaces one inventory path's sanitizer call with the raw value, when the suite runs, then at least one test fails. This holds for every sanitizer call site, including the new `mention` wrap. Each mutation is checked during verification and then reverted.
- **Regression:** Given the change, when `Mention.test.ts`, `shared/utils/urls.test.ts`, `DocumentHelper.test.ts`, and the wikiLint suites run, then they pass without edits.

## Spec Change Log

### 2026-10-02 — Loopback 1 (bad_spec)
- **Triggering finding** (review pass 1, grouped medium: Blind Hunter, Edge Case Hunter twice, Intent Alignment): the sweep set every string attr to one flat probe, so it reached only the default branch of each value-gated `toDOM`.
  - `mention` took only the external-`href` branch, and `embed` only the `a.embed` fallback. `embed iframe[src]` was missing from the declared inventory.
  - The AC claim "an added emitter … fails the suite" therefore did not hold for value-gated branches. A new `MentionType`, or a User/Date arm emitting a raw `href`, would pass.
- **Amended:**
  - Tasks, sweep: discriminator variants, one per `Object.values(MentionType)` plus `embed` with `href: probe:<probe>`; the rich inventory now includes `embed iframe[src]`.
  - AC: the inventory-guard wording, and a new value-gated mutation AC.
  - Verification: the mutation list.
  - Code Map: value-gated branches, sibling sanitizer calls, the generic embed, `colwidth`, and `text` without a `toDOM`.
  - Tasks: the probe embed regex gets the dotAll flag. Path table: the `https://` exception on the `a.embed` fallback.
  - Design Notes: the sweep limit.
- **Known-bad state avoided:** a conformance suite that claims to fail on any added emitter, while a raw `href` in a value-gated branch passes it.
- **KEEP**, all verified in pass 1 (584/584 in both projects, 11/11 mutations caught):
  - **`Mention.tsx`:** one `sanitizeUrl(...)` wraps the whole non-User/Date ternary (Document template, Collection template, `node.attrs.href`). User/Date stay `undefined`. Nothing else in the file changes.
  - **Spies:** `vi.mock("../../utils/urls", async (importOriginal) => ({ ...actual, sanitizeUrl: vi.fn(actual.sanitizeUrl), sanitizeImageSrc: vi.fn(actual.sanitizeImageSrc) }))`. `actual` comes from `vi.importActual` in `beforeAll`, and `vi.clearAllMocks()` runs in `beforeEach`.
  - **Environment:** `env.URL` is set to `https://wiki.example.test` in `beforeAll`. `afterAll` restores it, deleting the key if it was absent.
  - **Schemas:**
    - `createSchema(extensions)`: `new ExtensionManager(extensions)`, then `new Schema({ nodes, marks })`, then every extension is bound via `bindEditor` to the stub `{ schema, props: { theme: { isDark: false }, embeds: [...defaultEmbeds, probeEmbed], embedsDisabled: false } }`.
    - The sets are `withComments(richExtensions)` and `withComments(basicExtensions)`.
    - `DOMSerializer` uses an explicit `new JSDOM("").window.document`.
  - **Path table:** a `PATHS` table whose entries carry `name`, `schema`, `sanitizer`, `selector`, `attr`, `build(input)`, `text(input)`, optional `deliver` and `received`, `safe` pairs, and `missing` inputs.
    - Mention path 9 runs once per external type: Group, Issue, PullRequest, Project, URL.
    - Path 10 has two entries, one for `modelId` and one for `anchorId` (whose safe pairs include `""` and `null`, rendered without the fragment).
    - Embed path 3 has three safe fixtures: Framer, `https://example.com/a?q=1#f`, and `probe:www.example.com`, the last rendering as `https://www.example.com`.
  - **`renderPath`:** asserts that the document JSON is unchanged after render, and that `textContent` equals `path.text(input)`.
  - **Malicious fixtures:** each asserts the element is present, `toHaveBeenCalledWith(received)`, the emitted value equals the actual sanitizer result, and `isNeutralized`, where `new URL(value, "https://base.invalid/")` must throw or yield a protocol outside `javascript:`, `vbscript:`, `data:`, `file:`.
  - **Delegation:** the delegation test runs over the deduplicated safe, missing, and malicious inputs, excluding the five allow-listed data images; those five are asserted unchanged.
  - **Sweep:**
    - `acceptsString`: string `validate` checked by its union members, function `validate` by trial, absent `validate` accepted.
    - Per-attribute renderability filter, with required attrs (no `default`) set to the probe.
    - `expect(container, type.name).toBeDefined()` for every node type with a `toDOM`.
    - Marks rendered as probed text.
  - **Lint:** the `MALICIOUS` and `PROBE` constants sit inside `/* oxlint-disable no-script-url */` and `/* oxlint-enable no-script-url */`.

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 20 findings — high 0, medium 4, low 6, false 10, maybe-false 0
- findings:
  - `[low]` `[reject]` **Blind Hunter:** the `Mention` wrap adds no protection and breaks crafted links. A `modelId`/`anchorId` with an embedded newline becomes `https://https://…`, surrounding whitespace is trimmed, and `../` path injection stays. — Verified with the baseline `sanitizeUrl`: a newline fails `isUrl`, so a second scheme is prepended. Only a crafted, invalid `modelId` triggers it; real ids are UUIDs, and the link is broken before and after. An author can already link to any URL with a link mark, so nothing is exposed. The suggested `encodeURIComponent` would change valid anchor hrefs and goes beyond the AC1 sanitizer requirement. The path injection is baseline behaviour, unchanged by the wrap. Grouped with Edge Case Hunter (newline) and Intent Alignment (b).
  - `[false]` `[reject]` **Blind Hunter:** the path 10/11 tests pass automatically and prove nothing. — Reverting `Mention.tsx` to the baseline fails 33 tests through the `toHaveBeenCalledWith(received)` spy, so a bypass is detected. Preserving the origin for crafted ids is not a requirement; AC2 binds to the baseline sanitizer contract.
  - `[false]` `[reject]` **Blind Hunter:** the spy cannot tell which attribute made the call. — On paths 4 and 9, every malicious fixture changes under `sanitizeUrl`, so a raw `href` fails the emitted-value equality. Mutations of the embed anchor and the mention wrap failed 14 and 100 tests. On paths 10/11 no sibling attribute calls `sanitizeUrl`, because `data-url` is `mention://…` (`Mention.tsx:183-185`).
  - `[medium]` `[bad_spec]` **Blind Hunter:** the discriminator branches are not covered exhaustively. Nothing iterates `MentionType`, the sweep never reaches Document/Collection or `embed iframe[src]`, and a new gated emitter escapes. — Verified: with a single flat probe, `type` becomes the probe, so only the external mention branch and the `a.embed` fallback render. Amended the spec with sweep discriminator variants (every `MentionType`, plus the probe embed), `embed iframe[src]` in the inventory, and a value-gated mutation AC (Spec Change Log, loopback 1).
  - `[low]` `[reject]` **Blind Hunter:** the sweep checks only `href` and `src`, not `poster`, `srcset`, `xlink:href` or `style url()`. — The intent (AC1–AC4, NFR-13) is limited to `href` and `src`, and no current `toDOM` emits the other attributes.
  - `[low]` `[reject]` **Blind Hunter:** the `Set` key hides a second same-key emitter, there is a single probe value, and `renderNodeType` swallows exceptions. — A second raw emitter is still caught, because every observed value must be neutralized, not just every key. A `toDOM` that throws on a string emits nothing, and every type must render (`toBeDefined`). A filter matching exactly the lowercase probe is contrived, and running the sweep over the whole malicious list adds loops for a case no developer would write.
  - `[false]` `[reject]` **Blind Hunter:** the swept "basic" schema differs from the server's `basicSchema` and `commentSchema`. — Every extension class in the three server sets (`server/editor/index.ts:34-75`) is swept in one of the two schemas. `toDOM` output depends on the class and the node attrs, not on schema membership.
  - `[false]` `[reject]` **Blind Hunter:** the server export through React components (Attachment, Embed, Image, Video) is not covered. — Those components already sanitize (`Widget.tsx:38`, `Frame.tsx:101`, `components/Image.tsx:225`), so no unsafe output exists. The intent's ACs scope the conformance suite to `toDOM`.
  - `[low]` `[reject]` **Edge Case Hunter:** a newline in `modelId`/`anchorId` makes the href `https://https://…`. — Same root cause as the first Blind Hunter row. A crafted, invalid id is unlikely in everyday use, and the fix changes valid anchors.
  - `[false]` `[reject]` **Edge Case Hunter:** with `env.URL` unset, the href becomes the off-site `https://undefined/doc/<id>`. — Production cannot reach this: `URL` is `@IsNotEmpty` with a required protocol (`server/env.ts:228-236`) and is published to clients. Only jsdom tests lack it, where the baseline `undefined/doc/<id>` was already broken.
  - `[low]` `[reject]` **Edge Case Hunter:** `../`, `?` or `#` in `modelId`/`anchorId` resolves to an arbitrary same-origin path. — This is baseline behaviour, which the wrap does not change. An author can already link to any same-origin path, and real ids are UUIDs. Encoding would change valid anchor hrefs.
  - `[false]` `[reject]` **Edge Case Hunter:** the missing-input test passes on paths 3 and 6 even when the element vanishes. — For an empty URL, no iframe (no embed matches) and no link wrapper are the expected baseline output. Element presence on every path is asserted by the safe and malicious tests (`expect(element).not.toBeNull()`). An iframe with an empty `src` would still fail, because `getAttribute` returns `""`.
  - `[medium]` `[bad_spec]` **Edge Case Hunter:** the sweep uses a single probe, so value-gated branches stay unrendered. — Same root cause as the fourth Blind Hunter row; the same amendment applies.
  - `[medium]` `[bad_spec]` **Edge Case Hunter (claim):** "An added emitter, or a raw attribute that reaches `href` or `src`, fails the suite" is overstated. — Same root cause; the AC was reworded to the variant-backed guarantee, and the sweep was extended to back it.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** paths 10/11 assert the spy received the composed URL, not the raw value. — By the spec's own path 10/11 definitions, the composed URL is the value the sanitizer must receive, and the test asserts exactly that input.
  - `[false]` `[reject]` **Intent Alignment (a):** the tests exercise only `toDOM`, so the React component paths are uncovered under the user-story reading. — No unsafe output exists in those components (see the eighth Blind Hunter row), and AC1–AC4 name `toDOM` explicitly. The router `to=` paths in `Mentions.tsx` are relative `/doc/…` paths.
  - `[low]` `[reject]` **Intent Alignment (b):** the Mention change satisfies AC1 literally, and outputs differ off the normal path. — Same root cause as the first Blind Hunter row; rejected for the same reasons.
  - `[false]` `[reject]` **Intent Alignment (c):** the iframe path is reached only through a test-only embed. — This is intended (Design Notes): default regexes cannot deliver unsafe values, and the test-only descriptor proves the sanitizer call is there.
  - `[medium]` `[bad_spec]` **Intent Alignment (d):** the sweep reaches only default branches. — Same root cause as the fourth Blind Hunter row; the same amendment applies.
  - `[false]` `[reject]` **Intent Alignment (e):** the basic schema differs from the server sets; AC3 untouched; uncommitted. — The auditor itself rates these aligned. No emitter is missed (see the seventh Blind Hunter row), and the commit follows review.

### 2026-10-02 — Review pass (after loopback 1)
- verdicts: 20 findings — high 0, medium 0, low 11, false 9, maybe-false 0
- findings:
  - `[low]` `[reject]` **Blind Hunter:** the sweep inventory strings are not derived from `PATHS`, so a new emitter could pass by adding its key to the inventory without fixtures. — A raw unsafe emission still fails the sweep's neutralization check, and only a deliberate edit that skips fixtures, which code review would see, gets around it. Deriving the inventory needs a per-row sweep key and per-schema grouping, a restructuring rather than a direct correction.
  - `[low]` `[patch]` **Blind Hunter:** `EXTERNAL_MENTION_TYPES` is hard-coded, so a new `MentionType` whose branch builds its href without the sanitizer reaches no spy check. — Patched: the list is now derived as `Object.values(MentionType)` minus User, Date, Document and Collection, which gives today's five types. A new type then gets the spy and safe-value rows automatically. Grouped with Edge Case Hunter (fixed-prefix bypass claim).
  - `[low]` `[patch]` **Blind Hunter:** the rich image inline-icon branch (`span` wrapper when `width` < 48) is never rendered. — Today that branch reuses the same sanitized `children` (`Image.tsx:257-276`), but no test reaches it. Patched: an `image: [{ width: 16 }]` variant was added to `VARIANTS`. The implementer checked by mutation that a raw `href` there surfaces as `image span[href]`.
  - `[false]` `[reject]` **Blind Hunter:** the Document/Collection `modelId` rows skip the missing-value check, and Collection with `anchorId` is untested. — The matrix's missing row covers URL-valued inputs. A null or empty `modelId` still yields the baseline template href, which `sanitizeUrl` returns unchanged as a valid URL. The Collection template does not interpolate `anchorId` (`Mention.tsx:176-178`).
  - `[false]` `[reject]` **Blind Hunter:** only one attribute is compared against the baseline, so `data-*` and `class` on mentions are unchecked. — The `Mention.tsx` diff changes only the `href` expression, plus a comment; the `data-*` and `class` lines are unchanged context.
  - `[false]` `[reject]` **Blind Hunter:** the missing-value test passes when the element is absent. — carried: same location and claim as the pass-1 Edge Case Hunter row. Element presence is asserted on every path by the safe and malicious tests, and the code still reads `element?.getAttribute(...) ?? null`.
  - `[low]` `[patch]` **Blind Hunter:** the safe fixtures lack plain `http://` and a non-mail allow-listed scheme. — Patched: `http://example.com/a` and `tel:+15550100` were added to `SAFE_HREFS`. The `a.embed` fallback filter now excludes every `^https?://` input, because the generic embed claims both schemes.
  - `[low]` `[patch]` **Blind Hunter:** the wrap around the internal templates looks redundant and invites removal. — Patched: a two-line comment above `href` says that every emitted href, including the internal templates, goes through the sanitizer.
  - `[low]` `[reject]` **Edge Case Hunter:** a newline in `modelId`/`anchorId` produces `https://https://…`. — carried: same as the pass-1 rows; a crafted invalid id is unlikely, and the fix changes valid anchors.
  - `[low]` `[reject]` **Edge Case Hunter:** with the server URL derived only from `HEROKU_APP_NAME`, `env.URL` is unset and the href becomes `https://undefined/doc/<id>`. — Verified, and this corrects the pass-1 refutation:
    - on the server, `shared/env` is raw `process.env` (`shared/env.ts:1`), and nothing assigns `process.env.URL` from the derived value (`server/env.ts:236-241`);
    - so server-side `toDOM` export (`Mention` opts out of component rendering) emits the absolute `https://undefined/…` where the baseline emitted the broken relative `undefined/doc/<id>`;
    - the link is broken in both cases, and `undefined` is a single-label host;
    - it is reached only on a Heroku deployment without `URL`, by clicking a mention in an export;
    - a fix needs a fallback (`env.URL ?? ""`) that changes behaviour beyond the baseline contract.

    Recorded as a residual risk.
  - `[low]` `[reject]` **Edge Case Hunter:** a non-string `href` on external mentions makes `sanitizeUrl` throw (`url.trim`). — This is pre-existing: the baseline already called `sanitizeUrl(node.attrs.href)` for these types (baseline `Mention.tsx:176`). It needs crafted ProseMirror JSON, and the fix would add a type guard.
  - `[false]` `[reject]` **Edge Case Hunter:** the newline fixture on paths 10/11 asserts parity with the mangled `https://https://…` output. — carried: same claim as the pass-1 Blind Hunter row on the path 10/11 tests; AC2 binds to the baseline sanitizer contract.
  - `[low]` `[patch]` **Edge Case Hunter (claim):** a new type or branch that builds a fixed-prefix href without `sanitizeUrl` passes the sweep. — Same root cause as the second row. For a new `MentionType` this is closed by deriving `EXTERNAL_MENTION_TYPES`. A fixed-origin template cannot carry an unsafe scheme, and new branches on existing types remain the documented sweep limit.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** sibling `data-*` calls make the spy proof false on paths 4 and 9. — carried: same as the pass-1 Blind Hunter row; the emitted-value equality catches the bypass (the embed-anchor and mention-wrap mutations failed 14 and 100 tests).
  - `[false]` `[reject]` **Intent Alignment:** the React and client surface is not changed or tested, and the change has no visible client effect for Document/Collection. — carried: same as pass-1 Intent Alignment (a). The change is visible in server export and clipboard HTML, and the ACs name `toDOM`.
  - `[low]` `[reject]` **Intent Alignment:** on paths 10/11, AC2 holds only vacuously, and the wrap changes output for crafted ids. — carried: same as pass-1 Intent Alignment (b) and the first Blind Hunter row.
  - `[false]` `[reject]` **Intent Alignment:** there is no `toDOM` → `parseDOM` round trip test, and `parseDOM` reads `href` back. — For valid ids the emitted href is byte-identical, so the round trip is unchanged. For Document/Collection, the parsed `href` attr does not feed the rendered link (the template is used), and `anchorId` is read from `data-anchor-id` first (`Mention.tsx:143-145`).
  - `[false]` `[reject]` **Intent Alignment:** the suite fails on unmodified v1.10.1. — By design: AC1 requires the Mention fix, and "against the exact selected baseline" means the emitter inventory is the baseline's, which the suite pins.
  - `[low]` `[reject]` **Intent Alignment:** the sweep reaches only the declared variants, and the iframe is reached only through a test-only embed. — This is the documented sweep limit (Design Notes); value gates cannot be discovered generically. The one concrete instance found, the image inline icon, was patched above.
  - `[false]` `[reject]` **Intent Alignment:** the tests bypass the Markdown parser and the MCP write path. — Story 1.10 AC12 holds the integration proof of the Story 1.9 paths, and this story's ACs are scoped to `toDOM` rendering.

## Design Notes

**Why spies.** For Document and Collection mentions, the baseline output is already non-executable, because the `env.URL` prefix is fixed. Behaviour alone therefore cannot show that the sanitizer runs. The spy shows that the emitted value came from a `sanitizeUrl` call on the raw value, which AC1 and the bypass check need. `sanitizeImageSrc` calls the module-internal `sanitizeUrl`, which the spy cannot see, so the suite proves delegation behaviourally on the actual module.

**Why a test-only embed.** Every default embed regex is anchored to `https?://`, so no real fixture can reach the `iframe[src]` sanitizer with an unsafe value. The test-only descriptor is generic and mirrors how deployments supply `props.embeds`.

**Unset `env.URL`.** When `env.URL` is unset, only in jsdom tests, the Document href changes from `undefined/doc/<id>` to `https://undefined/doc/<id>`. Both are broken, and production always configures `URL`.

**Out of scope.** React component and NodeView render paths are not `toDOM` and stay unchanged. Examples are `shared/editor/components/Embed.tsx:78`, `DisabledEmbed.tsx:13`, and `Mentions.tsx:271`.

**Sweep limit.** The variants cover the value-gated branches that exist today. A future node whose emission depends on an attribute value outside the variants still escapes the sweep until it gets a variant. For known paths, the path table remains the guard.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project shared-node --project shared-jsdom shared/editor shared/utils/urls.test.ts` -- expected: all pass in both projects.
- `TZ=UTC node_modules/.bin/vitest run --project server server/models/helpers/DocumentHelper.test.ts server/wikiLint server/tools/wikiLint.test.ts`, with the test Postgres from memory `local-test-postgres` -- expected: all pass.
- Scripted, temporary mutations, each restoring the file from a backup -- expected: the suite fails for every mutation; afterwards, `git diff` shows only the intended changes. The mutations are:
  - each sanitizer call site, replaced with the raw value;
  - the baseline `Mention.tsx`;
  - `sanitizeImageSrc` returning `src` unchanged;
  - the User/Date mention branch emitting the raw `node.attrs.href`.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- `grep -rniE "laura|ezop" shared/editor/nodes/Mention.tsx shared/editor/nodes/urlSanitization.test.ts` -- expected: no matches.

## Auto Run Result

Status: done

**Summary.** Every user-controlled `href` and `src` that a ProseMirror `toDOM` emits now passes through `sanitizeUrl()` or `sanitizeImageSrc()`, a wrapper the suite proves delegates to `sanitizeUrl`.
- **The one bypass:** on the baseline, `mention` built its Document and Collection `href` directly from the user-controlled `modelId` and `anchorId`. A single `sanitizeUrl(...)` now wraps the whole non-User/Date `href` expression. With `env.URL` configured, valid ids render byte-identical to the baseline.
- **The conformance suite** covers all 11 inventory paths and has three layers:
  - **Path table:** each path is rendered through `DOMSerializer` with explicit-JSDOM rendering, using safe, malicious and missing fixtures. Spies on `sanitizeUrl` and `sanitizeImageSrc` show the sanitizer receives the raw value. The emitted value must equal the actual sanitizer result and be neutralized.
  - **Delegation:** a behavioural proof that `sanitizeImageSrc` delegates to `sanitizeUrl`.
  - **Sweep:** renders every node and mark of `withComments(richExtensions)` and `withComments(basicExtensions)`, flat and with variants. The variants are every `MentionType`, the probe embed for `iframe[src]`, and the image inline icon. The observed emitters must equal the declared inventory, and every value must be neutralized.
- **Unchanged:** the sanitizer, `toMarkdown`, `parseDOM`, React components and lint code.

**Files changed:**
- `shared/editor/nodes/Mention.tsx` — one `sanitizeUrl(...)` around the non-User/Date `href` (Document template, Collection template, `node.attrs.href`), with a two-line comment.
- `shared/editor/nodes/urlSanitization.test.ts` (new) — the conformance suite: the path table, the delegation proof and the sweep. It runs 308 tests in each of `shared-node` and `shared-jsdom`.

**Review findings breakdown** (two passes; 40 findings in all):
- **Pass 1** (20 findings: high 0, medium 4, low 6, false 10):
  - **Loopback:** one grouped medium entry (Blind Hunter, Edge Case Hunter twice, Intent Alignment) went through a `bad_spec` loopback. The sweep's single flat probe never reached value-gated branches. The spec gained discriminator variants and `embed iframe[src]` in the inventory, and the code was re-derived (Spec Change Log, loopback 1).
  - **Rejected low:**
    - the newline/whitespace effect of the wrap on crafted ids (three rows);
    - `../` path injection, which is baseline behaviour;
    - `href`/`src`-only scope;
    - the sweep `Set` key and single probe.
  - **Rejected false:**
    - the path 10/11 tests "prove nothing" (33 failures when `Mention.tsx` reverts to baseline);
    - sibling-attribute spy ambiguity (equality catches it);
    - the basic schema differs from the server sets (every class is swept);
    - React component coverage (components sanitize; the ACs name `toDOM`);
    - `env.URL` unset (this refutation was corrected in pass 2);
    - the missing-input test on paths 3 and 6;
    - the composed-URL spy claim;
    - Intent Alignment (a), (c) and (e).
- **Pass 2** (20 findings: high 0, medium 0, low 11, false 9):
  - **Patches applied** (4 entries, all low):
    - `EXTERNAL_MENTION_TYPES` derived from `MentionType` (Blind Hunter plus an Edge Case Hunter claim);
    - an image inline-icon sweep variant;
    - `http://` and `tel:` safe fixtures, with the `a.embed` filter widened to `^https?://`;
    - a comment on the `Mention` wrap.
  - **Rejected low:**
    - the inventory is not derived from `PATHS` (restructuring; neutralization still guards);
    - the newline effect (carried);
    - `https://undefined/doc/<id>` with a Heroku-derived URL (residual risk below);
    - a non-string external `href` throwing, which is pre-existing in the baseline;
    - the sweep variant limit (documented);
    - Intent Alignment on paths 10/11 being vacuous (carried).
  - **Rejected false:**
    - the missing `modelId` rows;
    - the attribute-only comparison;
    - the missing-value element check (carried);
    - parity with the mangled output (carried);
    - sibling spy (carried);
    - React surface (carried);
    - the `parseDOM` round trip;
    - failure on unmodified v1.10.1;
    - the Markdown/MCP surface.
- **Deferred:** none.

**Follow-up review recommendation: false.** This was not a follow-up pass. The final pass patched only low entries (4); the medium group was handled by the `bad_spec` loopback and re-reviewed. No specific unverified risk remains: every patch is test-only or a comment, and the full suite and mutation set ran on the final tree.

**Verification performed** (final tree; test database PostgreSQL 14 at `127.0.0.1:5432/outline-test`, migrations current):

| Command | Result |
| --- | --- |
| `TZ=UTC node_modules/.bin/vitest run --project shared-node --project shared-jsdom shared/editor shared/utils/urls.test.ts` | 69 files passed, 1 skipped; 1305 tests passed, 9 skipped (all skips pre-existing and outside the new file) |
| `vitest … shared/editor/nodes/urlSanitization.test.ts` (both projects) | 616/616 passed, none skipped |
| `TZ=UTC node_modules/.bin/vitest run --project server server/models/helpers/DocumentHelper.test.ts server/wikiLint server/tools/wikiLint.test.ts` | 23 files, 947/947 passed |
| Scripted mutations, each restored from a `mktemp` backup | all 12 fail the suite (failure counts in the next table); `git diff` afterwards shows only the intended change |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the changed files | exit 0 |
| `node_modules/.bin/oxfmt --check` on the changed files | all files formatted |
| `grep -rniE "laura\|ezop"` on the changed files | no matches |

Mutation failures:

| Mutation | Tests failed |
| --- | --- |
| link | 15 |
| attachment | 14 |
| embed `iframe` | 13 |
| embed anchor | 14 |
| image `src` | 13 |
| image link | 13 |
| `SimpleImage` | 13 |
| video | 13 |
| `Mention` wrap | 100 |
| `sanitizeImageSrc` passthrough | 39 |
| User/Date raw `href` | 2 (sweep) |
| baseline `Mention.tsx` | 33 |

Matrix test audit: every I/O matrix row has a covering test that ran and passed:
- **Safe values:** the safe rows run on each `href` path, on the image and video `src` paths, on the Framer `iframe`, and on the `mention` Document/Collection templates.
- **Bare host:** `www.example.com` on each `href` path, and `probe:www.example.com` on the `iframe`.
- **Malicious values:** all 11 fixtures run on every path. On the mention paths they go through `modelId` and `anchorId`; on the `iframe` path they go through the probe embed.
- **Missing values:** `""` and, where the schema accepts it, `null`.

**Residual risks:**
- **Unset `env.URL` on the server.**
  - On the server, the shared `env` is raw `process.env`. When the deployment derives its URL from `HEROKU_APP_NAME` without setting `URL`, server-side `toDOM` export renders Document and Collection mentions as `https://undefined/doc/<id>`, where the baseline rendered the relative `undefined/doc/<id>`.
  - Both links are broken, and `undefined` is a single-label host. The Design Note's claim that production always configures `URL` does not hold for that server-side path.
- **Crafted ids** (newline or surrounding whitespace in `modelId`/`anchorId`) now render through the sanitizer contract, for example `https://https://…`. Real ids are UUIDs.
- **Sweep coverage:** the sweep reaches value-gated branches only through declared variants. A future node whose emission depends on another attribute value needs a new variant.
- **React components and NodeViews** (the browser editor, and the server export of Attachment, Embed, Image and Video) are outside this story's `toDOM` scope. They sanitize at baseline but are not guarded by this suite. Story 1.10 holds the end-to-end proof.
