---
title: 'Gate 2 A2+B: bounded parser, clipboard, transport and mail backports'
type: security
created: '2026-10-28'
status: in-review
baseline_revision: aac4615d1f303103e465e96a7c15f7c1c82a530d
---

# Intent and authority

Implement the maintainer-approved local dependency continuation on the v1.10.1
fork. Preserve the reviewed A1 preimage, including SDK 1.32.0 and Zod 4.6.6.
The tooling-only base has source parent
`dd92d84d632841ea20b6ad7e9c85917c5b098955`. This spec supplements the accepted
Wiki lint contract; it does not amend its PRD, epics, rules or rollout gates.

Priority remains server-side MCP create/update validation of the full projected
document, internal links and structural integrity. No new UI or REST enforcement,
semantic classification, coordinator repair, production configuration or Node
image change is authorized. Existing browser tests qualify dependency compatibility.

# Exact change

Pin markdown-it 14.3.3, js-yaml 4.3.2, prosemirror-view 1.42.3 and the minimum
compatible prosemirror-model 1.25.8. Resolve Engine.IO to 6.6.10 within Socket.IO's
existing range. Separately qualify Nodemailer 10.1.4 at the root and replace
mailparser's exact vulnerable 9.0.5 edge with a precise Yarn resolution.
Generate the lock through Yarn; explain every additional graph change.
No production code beyond these dependency declarations is expected.

# Acceptance criteria

1. **Parser resources:** hostile multiline Markdown references and repeated empty
   YAML merge sources execute in disposable child processes with explicit wall,
   heap and output limits and modest inputs. Normal references, aliased and
   malformed frontmatter retain their existing behavior through actual converters.
2. **Canonical MCP compatibility:** the actual shared editor/server parser,
   serializer, create/update projection and canonical lint syntax retain stable
   ordinary metadata, links and round trips. Existing deterministic rules,
   authorization and atomicity tests remain required.
3. **Clipboard compatibility:** real DOM-backed EditorView clipboard handling
   rejects forged slice contexts using shipped attribute validators; valid paste,
   title paste, safe URL controls and collaborative round trips still work. No
   validator weakening or new web guard is permitted.
4. **Transport:** isolated loopback Engine.IO sessions reject missing/mismatched
   protocol upgrade revisions and invalid handshakes; ordinary handshake, upgrade
   and reconnect succeed without uncaught asynchronous errors.
5. **Mail:** offline MIME import, canonical recipients, synthetic stream/JSON
   composition, attachment and reply-header controls pass. Root and mailparser
   resolve exactly 10.1.4, with no effective installed or locked Nodemailer 9.0.5
   locator. Mailparser's upstream 9.0.5 declaration remains metadata overridden
   by the exact parent-scoped Yarn resolution. No SMTP delivery.
6. **Source qualification:** coherent RED before each package slice, then GREEN;
   early full typecheck after installation; affected existing converter, email,
   websocket, shared editor and app title suites; formatting, lint and immutable
   install pass through the admitted broker. Retain actual commands and results.
7. **Preservation and review:** only the assignment's ten source paths may change;
   all protected A1 bytes outside the manifest/lock remain identical. Perform a
   final sequential adversarial self-review. Independent review and fresh-database
   wiki-lint regression belong to the controller; self-review cannot accept itself.

# Method and stop conditions

Validate this spec's explicit criteria before development, then use small TDD
slices: Markdown/YAML, clipboard/model, Engine.IO, separately Nodemailer/mailparser.
An assertion of an exact patched version may establish RED, but cannot replace
behavioral qualification. Stop source changes if a demonstrated runtime or type
repair needs an unapproved path, or if the broker cannot provide a real result.

Native BMAD discover/materialize reports `UNSUPPORTED_CONTRACT`: no installed
`_bmad` or client skill contract. Native method installation/validation remains
**BLOCKED/UNVERIFIED**. This explicit spec and criteria record preserve the method
without representing a native workflow success or waiving its gate.

The result is a local candidate only. Build/image provenance, advisory rematching,
Gate 1 impact, publication, deployment and policy activation remain later gates.
The policy pilot still requires at least seven days, ten logical change batches
and two clients; source tests provide no pilot evidence.

# Source qualification closeout (2026-10-28)

**READY_FOR_INDEPENDENT_SOURCE_REVIEW.** This is a source handoff status;
independent source review and controller acceptance remain pending.

Author RED/GREEN slices and the final sequential adversarial author self-review
are recorded separately from the controller's independent source qualification.
All 16 controller commands passed, including full typecheck, formatting,
type-aware lint, targeted server/MCP and audit tests, fresh-database Wiki lint,
shared editor and title suites, and the actual offline immutable install.
The controller verified unchanged candidate source and 531 linked dependency
source files across immutable installation. Only these three documentary records
change at closeout; executable, dependency and test bytes remain qualified.

The [criteria execution record](spec-gate2-a2-b-validation.md) and
[backport record](../../docs/wikilint-gate-2/a2-b-security-backports.md) distinguish
author evidence, controller results, retained baseline skips and remaining gates.
Native BMAD remains **BLOCKED/UNVERIFIED / UNSUPPORTED_CONTRACT**. Source
qualification neither repairs nor waives that gate and grants no Gate 2, image,
Gate 1 requalification, release, deployment or pilot approval.
