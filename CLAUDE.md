# CLAUDE.md — `subscription-proxy-pool`

Claude Code entry point for this package. The full working guide is the
vendor-neutral [`AGENTS.md`](./AGENTS.md), imported below.

@AGENTS.md

## Claude-Code-specific notes

- Global rules from `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md`, and
  `~/.claude/sdd/*.md` apply on top of `AGENTS.md`.
- Code navigation order: LSP → `mcp__code-skeleton__*` for files > 200 LOC →
  `Grep` for string literals (event names, spec IDs like `spp-proxy:INV-001`) →
  `Read` for files < 100 LOC or right before an edit.
- Stay out of `node_modules/`; scope searches to `src/`, `spec/`, `migrations/`.
