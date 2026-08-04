# claude-bridge

MCP server that lets **Codex CLI** (or any other MCP-capable host) delegate
a subtask to **Claude Code** and get back only the compressed final result.
Claude's full turn-by-turn transcript stays inside the `claude -p`
subprocess — only the final report enters the calling model's context.

## Requirements

- Node.js >= 18
- The [Claude Code CLI](https://claude.com/claude-code) installed and
  logged in (`claude` on `PATH`, or point `CLAUDE_BIN` at its binary)

## Install

```bash
cd mcp-bridges/claude-bridge
npm install
```

## Register with Codex CLI

Add an MCP server entry to `~/.codex/config.toml`:

```toml
[mcp_servers.claude_bridge]
command = "node"
args = ["/absolute/path/to/mcp-bridges/claude-bridge/src/index.js"]

[mcp_servers.claude_bridge.env]
CLAUDE_BRIDGE_PERMISSION_MODE = "acceptEdits"
```

(Codex CLI's MCP server config format has changed across versions — check
`codex mcp --help` / the current docs and adapt the table name if needed.)

Once registered, Codex gains a `delegate_to_claude` tool it can call to hand
off work to Claude Code.

## Tool: `delegate_to_claude`

| Arg | Description |
|---|---|
| `prompt` (required) | Self-contained task description. The subprocess has no memory of the calling conversation. |
| `role` | `executor` (default, may edit files) or `reviewer` (plan-mode, findings report only). |
| `cwd` | Working directory for Claude Code. |
| `permissionMode` | `acceptEdits` \| `auto` \| `bypassPermissions` \| `manual` \| `dontAsk` \| `plan` (defaults to `plan` for `reviewer`, `acceptEdits` otherwise). |
| `model` | Override Claude model. |
| `timeoutSeconds` | Kill the subprocess after N seconds (default 900). |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI binary. |
| `CLAUDE_BRIDGE_PERMISSION_MODE` | `acceptEdits` | Default `--permission-mode`. |
| `CLAUDE_BRIDGE_TIMEOUT_MS` | `900000` | Default subprocess timeout. |

## How it works

The server runs `claude -p "<framed prompt>" --output-format json
--permission-mode <mode>` and parses the resulting JSON object's `result`
field, discarding the rest. If `--output-format json` isn't available in
your installed version, it falls back to raw stdout (text mode).
