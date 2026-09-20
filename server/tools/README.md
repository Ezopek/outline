Tools are the building blocks of functionality for our internal MCP server.

Each tool is a self-contained unit of functionality that can be invoked by the MCP client to perform a specific task. To test the MCP with Claude in development make sure to run with the following command to ensure that the MCP server trusts the mkcert root CA certificate.

```bash
NODE_EXTRA_CA_CERTS=$(mkcert -CAROOT)/rootCA.pem claude
```

## Fork roadmap: deterministic Wiki linting

### Goal

Extend Outline's built-in MCP server with deterministic document and Wiki
linting. All MCP clients must receive the same tools and hard validation through
the existing standard `/mcp` endpoint. The design must not depend on Hermes,
Claude, Codex, Cursor, a local skill, or client-side composition with a second
MCP server.

The linter is ordinary program logic. It must not invoke an LLM, perform semantic
classification, or judge whether prose is factually or logically appropriate.

### Version boundary

The currently deployed environment was inspected at Outline `v1.10.1`. This
branch began from upstream `main` at `2f57a36d50f78a34adb77009d7499b8c556838db`,
which is newer than tag `v1.10.1` at
`9686f7264506a910ed87a4ad8704bafd361a3393`. Before implementation or deployment,
explicitly choose and verify one of these paths:

1. implement against the deployed `v1.10.1` baseline; or
2. upgrade the deployment to a tested newer revision before enabling the fork.

Do not treat tests against one revision as proof for the other.

### MCP tools and enforcement

Create one reusable lint engine and call it from:

- `create_document`, before persistence;
- `update_document`, against the fully projected post-edit document before
  persistence;
- a new read-only `lint_document` tool; and
- a new read-only `lint_wiki` tool, optionally accepting a collection ID.

`update_document` supports `replace`, `append`, `prepend`, and `patch`. Validation
must inspect the complete resulting title and body after applying the requested
edit with Outline's own transformation semantics. Linting only the incoming text
fragment is incorrect. A failed lint must not partially save the document or
leave externally visible side effects.

Errors block MCP create and update operations. Warnings are returned but do not
block writes. Tool responses use stable machine-readable issue codes rather than
requiring clients to parse prose, for example:

```json
{
  "ok": false,
  "errors": [
    {
      "code": "REQUIRED_FIELD_MISSING",
      "documentId": "document-id",
      "line": 7,
      "path": "Document metadata.Last verified",
      "message": "Required field `Last verified` is missing"
    }
  ],
  "warnings": []
}
```

Tool handlers remain responsible for existing authentication and authorization.
Lint tools must never expose documents or link targets that the authenticated
actor cannot read.

### Initial deterministic rules

The first implementation should support only mechanically verifiable rules:

1. **Document structure**
   - required sections and their order;
   - allowed heading levels;
   - required metadata fields;
   - field syntax, including `Last verified: YYYY-MM-DD`;
   - explicitly forbidden or unsupported Markdown structures.
2. **Internal links**
   - resolve Outline document links by supported ID or URL identifier;
   - report missing, deleted, or inaccessible targets without leaking target
     metadata;
   - leave anchor validation for a later increment unless it is implemented
     without fuzzy matching.
3. **Technical hierarchy integrity**
   - dangling parent IDs;
   - cycles;
   - published documents missing from the collection structure;
   - structurally inconsistent cross-collection parent relationships.
4. **Configured global indexes**
   - verify that one configured surface document directly links to every
     explicitly configured global index document ID;
   - do not infer which documents ought to be global indexes.

Document placement is not a semantic lint rule. The linter must not decide
whether a document logically belongs under a particular parent.

### Templates and visible metadata

Use Outline templates to produce canonical document shapes. Validation checks the
resulting document, so using a template is not by itself proof of validity. A
future tool schema may expose a deterministic `documentType` that selects a
configured template and structural schema.

Prefer a visible Markdown section that survives Outline's Markdown/ProseMirror
round trip, for example:

```markdown
## Document metadata

- Status: Active
- Last verified: 2026-09-20
- Authority: Repository
```

Do not assume YAML front matter has special semantics or stable round-trip
behavior in Outline. Supporting front matter requires an explicit round-trip test
through the actual editor conversion pipeline.

### Explicit non-goals for the first implementation

- semantic validation of parent/category placement;
- detecting whether prose is English;
- judging whether a page points to the correct authority;
- secret or private-payload scanning;
- deciding whether a `_misses` entry describes a real incident;
- onboarding-specific hash validation;
- requiring one `_log` entry per MCP mutation;
- any LLM-backed lint rule.

A logical Wiki change batch may contain several MCP calls, while one call may be
an incidental edit. The MCP server cannot infer that boundary reliably, so batch
logging is not a create/update hook in this phase. A later design may add explicit
`begin_wiki_batch` and `finish_wiki_batch` operations.

### Enforcement boundary

The first implementation enforces hard linting only in built-in MCP
`create_document` and `update_document`. Writes made through the UI or direct API
remain possible and are detected by `lint_wiki`; they are not blocked. Moving the
lint engine into `documentCreator` or `documentUpdater` would affect every editor
and integration and requires a separate decision because of the larger blast
radius.

### Configuration

Keep the lint engine generic. Workspace- or collection-specific schemas,
templates, the surface document ID, and required global index IDs must be supplied
through deterministic server-side configuration. Do not hard-code private
workspace identifiers into reusable source or expose them in tool descriptions.

Configuration errors must fail closed for hard-enforced writes in a configured
scope and return a distinct machine-readable error. Unconfigured collections must
retain upstream behavior until explicitly enabled.

### Required tests

- unit tests for every lint rule and stable issue code;
- create tests proving invalid input is rejected before persistence;
- update tests for `replace`, `append`, `prepend`, and `patch` against the complete
  projected document;
- rollback/no-side-effect tests for failed writes;
- authorization tests for cross-document and broken-link checks;
- collection tests covering valid links, broken links, dangling parents, cycles,
  and required direct surface links;
- Markdown/ProseMirror round-trip tests for the canonical metadata block;
- MCP discovery tests proving the new tools appear on the same `/mcp` endpoint;
- compatibility tests proving unconfigured collections retain upstream behavior.

Implementation is not deployment approval. Build, migration, rollback, and live
acceptance must be handled separately against the selected Outline revision.
