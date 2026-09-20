# Input Reconciliation — Root `README.md`

**Source role:** Repository overview and fork-scope pointer

**Verdict:** Fully aligned

## Confirmed Coverage

- The PRD defines deterministic Wiki linting in Outline's built-in MCP server.
- The single standard `/mcp` endpoint remains the client-independent product boundary.
- The PRD treats `server/tools/README.md` as the fork-specific source of scope and acceptance constraints rather than deriving policy from upstream product documentation.
- Compatibility, authentication-sensitive behavior, and implementation verification are covered by the PRD, its addendum, and the repository's authoritative execution instructions.

## Intentionally Not Duplicated

General Outline installation, contribution, development, migration, and upstream project information does not define this fork's product behavior and is therefore not repeated in the PRD.

## Gaps or Conflicts

None.
