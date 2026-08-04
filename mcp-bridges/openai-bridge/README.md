# openai-bridge

MCP server that lets Claude delegate a subtask **directly to the OpenAI API**
(Chat Completions + function calling), without going through a
locally-installed Codex CLI.

Use this instead of [`codex-bridge`](../codex-bridge) specifically when
Claude is running somewhere that cannot reach a local Codex CLI process —
most notably **Cowork / Claude Code on the web**, which runs in an isolated
cloud container with no access to your local machine or its Codex CLI login
session. On your own machine (Claude Code Desktop app or terminal) with
Codex CLI installed and logged in, prefer `codex-bridge` — it hands the task
to the real Codex agent instead of the small tool loop implemented here.

## What it does

Implements a minimal agent loop against the OpenAI Chat Completions API:
the model gets three tools — `read_file`, `list_dir`, and (for
`role="executor"` only) `write_file` — all sandboxed to a working directory
that cannot be escaped via `../` path traversal. The loop runs until the
model replies with plain text (no more tool calls), and only that final
text is returned to the caller — intermediate tool calls and reasoning stay
inside this process, which is the point (context compression).

## Requirements

- Node.js >= 18
- An OpenAI API key with access to a coding-capable model

## Install

```bash
cd mcp-bridges/openai-bridge
npm install
```

## Register with Claude Code (project-scoped, recommended)

This repo's root [`.mcp.json`](../../.mcp.json) already registers
`openai-bridge` for any Claude Code surface that opens this project — CLI,
Desktop app, or Cowork/web. You only need to make `OPENAI_API_KEY` (and
optionally `OPENAI_MODEL`) available in your shell/environment before
starting Claude Code; `.mcp.json` pulls them in via `${OPENAI_API_KEY}`
substitution rather than hardcoding secrets into the file.

For a Cowork/remote environment specifically, set these as environment
variables on the environment/session itself (however your setup manages
secrets for that environment) so they're present when Claude Code spawns
the MCP server.

To register manually instead (e.g. in a different project):

```bash
claude mcp add openai-bridge --env OPENAI_API_KEY=sk-... --env OPENAI_MODEL=your-model-id \
  -- node /absolute/path/to/mcp-bridges/openai-bridge/src/index.js
```

## Tool: `delegate_to_openai`

| Arg | Description |
|---|---|
| `prompt` (required) | Self-contained task description. The model has no memory of the calling conversation. |
| `role` | `executor` (default, gets `write_file` too) or `reviewer` (read-only). |
| `cwd` | Working directory the model's file tools are sandboxed to. |
| `model` | Overrides `OPENAI_MODEL`. |
| `timeoutSeconds` | Aborts the loop after N seconds (default 900). |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — (required) | OpenAI API key. |
| `OPENAI_MODEL` | — (required unless `model` arg is passed) | Model ID. No hardcoded default on purpose — pick a coding-capable model ID currently available on your account. |
| `OPENAI_BRIDGE_MAX_ITERATIONS` | `25` | Safety cap on tool-call round-trips. |
| `HTTPS_PROXY` / `https_proxy` | — | If set, the server routes the OpenAI SDK's requests through this proxy via `undici`'s `ProxyAgent`. Cowork/remote environments typically require this — see that environment's proxy docs for the value to use. |

## Security notes

- `read_file`/`list_dir`/`write_file` cannot resolve outside the given
  `cwd` — path traversal (`../../etc/passwd` etc.) is rejected.
- There is no shell/command-execution tool. If you need the delegate to run
  commands, use `codex-bridge` (real Codex CLI, with its own sandbox
  controls) instead.
- Default `role=reviewer` omits `write_file` entirely, so a "just review
  this" delegation cannot accidentally modify files.
