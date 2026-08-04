# mcp-bridges

Two minimal MCP servers that let Claude Code and the Codex CLI delegate work
to each other, so a paid Claude subscription and a paid ChatGPT subscription
can act as mutually complementary "executor / reviewer" agents instead of
two isolated tools.

- **[`codex-bridge/`](./codex-bridge)** — register in Claude Code so it can
  call `delegate_to_codex` (Claude → Codex).
- **[`claude-bridge/`](./claude-bridge)** — register in Codex CLI so it can
  call `delegate_to_claude` (Codex → Claude).

Both servers work the same way: they shell out to the other CLI in
non-interactive/print mode, wait for it to finish, and return **only the
final report** as the tool result. The delegate's intermediate reasoning,
tool calls, and file diffs never enter the calling model's context — this
is the context-compression mechanism the whole setup exists for. See
[`docs/chatgpt-claude-integration-blueprint.md`](../docs/chatgpt-claude-integration-blueprint.md)
for the full design rationale, setup walkthrough, and operating patterns.

## Quick start

```bash
cd mcp-bridges/codex-bridge && npm install
cd ../claude-bridge && npm install
```

Then follow each server's README to register it with the corresponding CLI.
