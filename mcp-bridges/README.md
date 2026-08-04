# mcp-bridges

Three minimal MCP servers that let Claude (Claude Code — CLI, Desktop app,
or Cowork/web) and ChatGPT (Codex CLI) delegate work to each other, so a
paid Claude subscription and a paid ChatGPT subscription can act as
mutually complementary "executor / reviewer" agents instead of two isolated
tools.

| Server | Registered in | Tool | Direction | Requires |
|---|---|---|---|---|
| [`codex-bridge/`](./codex-bridge) | Claude Code (any surface, local machine) | `delegate_to_codex` | Claude → Codex | Local Codex CLI, logged in |
| [`claude-bridge/`](./claude-bridge) | Codex CLI | `delegate_to_claude` | Codex → Claude | Local Claude Code CLI, logged in (sidecar only — not your main interface) |
| [`openai-bridge/`](./openai-bridge) | Claude Code (esp. Cowork/web, where a local Codex CLI isn't reachable) | `delegate_to_openai` | Claude → OpenAI (direct API) | `OPENAI_API_KEY` |

`codex-bridge` and `openai-bridge` are two ways to get the same "ask
ChatGPT's side for a second opinion" outcome, chosen by *where Claude is
running*: `codex-bridge` shells out to a real, locally-installed Codex CLI
(full agent, but only reachable when Claude is running on that same
machine — Desktop app or terminal); `openai-bridge` calls the OpenAI API
directly with a small built-in tool loop, which works from a sandboxed
cloud session (Cowork) that has no access to your local machine at all.

All three servers work on the same principle: they run the other side
non-interactively, wait for it to finish, and return **only the final
report** as the tool result. The delegate's intermediate reasoning, tool
calls, and file diffs never enter the calling model's context — this is the
context-compression mechanism the whole setup exists for. See
[`docs/chatgpt-claude-integration-blueprint.md`](../docs/chatgpt-claude-integration-blueprint.md)
for the full design rationale, setup walkthrough, and operating patterns.

## Quick start

```bash
cd mcp-bridges/codex-bridge && npm install
cd ../claude-bridge && npm install
cd ../openai-bridge && npm install
```

`codex-bridge` and `openai-bridge` are already registered for this repo via
the root [`.mcp.json`](../.mcp.json) — they'll show up automatically the
next time you open this project in Claude Code (CLI, Desktop app, or
Cowork/web), pending a one-time approval prompt. `claude-bridge` registers
on the Codex CLI side instead (`~/.codex/config.toml`); see its README.
