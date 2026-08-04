#!/usr/bin/env node
// openai-bridge: MCP server that lets Claude delegate a subtask directly to
// the OpenAI API (Chat Completions + function calling), without going
// through a locally-installed Codex CLI. This exists for surfaces where a
// local Codex CLI process is not reachable — most notably Cowork / Claude
// Code on the web, which run in an isolated cloud container that has no
// access to the user's local machine or its Codex CLI login session.
//
// For local work (Claude Code Desktop app or CLI on your own machine,
// where a logged-in `codex` binary is on PATH), prefer `codex-bridge`
// instead — it reuses the full Codex CLI agent rather than reimplementing
// a small one here.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import OpenAI from 'openai';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Cowork/remote environments route outbound HTTPS through an agent proxy.
// If HTTPS_PROXY/https_proxy is set, route the OpenAI SDK's fetch through it.
async function buildFetch() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxyUrl) return undefined;
  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  return undefined; // global dispatcher covers the SDK's own fetch calls
}
await buildFetch();

const OPENAI_MODEL = process.env.OPENAI_MODEL; // no hardcoded default — see README
const MAX_ITERATIONS = Number(process.env.OPENAI_BRIDGE_MAX_ITERATIONS || 25);
const MAX_FILE_BYTES = 200_000;

const ROLE_PREAMBLE = {
  executor:
    'You are acting as a delegated EXECUTOR sub-agent for another AI (Claude) that is running the ' +
    'primary session. Perform the task described below yourself using the read_file/list_dir/' +
    'write_file tools, then reply with a concise final report (plain text, no tool call): what you ' +
    'changed/found, file paths touched, and anything the calling agent must know. Do not ask the ' +
    'user questions; make reasonable decisions and note any assumptions in the report.',
  reviewer:
    'You are acting as a delegated REVIEWER / MONITOR sub-agent for another AI (Claude) that is ' +
    'running the primary session. You only have read_file/list_dir tools — you cannot edit files. ' +
    'Inspect what is described below and reply with a concise findings report (plain text, no tool ' +
    'call): issues found (ranked by severity), what looks correct, and concrete suggested fixes. If ' +
    'nothing is wrong, say so briefly.',
};

function resolveSandboxed(root, relPath) {
  const resolved = path.resolve(root, relPath || '.');
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path "${relPath}" escapes the sandboxed working directory.`);
  }
  return resolved;
}

function buildTools(role) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file relative to the working directory.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path relative to the working directory.' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List entries of a directory relative to the working directory.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path relative to the working directory (default ".").' } },
          required: [],
        },
      },
    },
  ];
  if (role === 'executor') {
    tools.push({
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write (overwrite) a UTF-8 text file relative to the working directory. Creates parent directories as needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to the working directory.' },
            content: { type: 'string', description: 'Full new file content.' },
          },
          required: ['path', 'content'],
        },
      },
    });
  }
  return tools;
}

async function executeTool(root, name, args) {
  if (name === 'read_file') {
    const full = resolveSandboxed(root, args.path);
    const buf = await fs.readFile(full);
    const truncated = buf.length > MAX_FILE_BYTES;
    const text = buf.subarray(0, MAX_FILE_BYTES).toString('utf8');
    return truncated ? `${text}\n\n[...truncated, file is ${buf.length} bytes...]` : text;
  }
  if (name === 'list_dir') {
    const full = resolveSandboxed(root, args.path || '.');
    const entries = await fs.readdir(full, { withFileTypes: true });
    return entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n') || '(empty directory)';
  }
  if (name === 'write_file') {
    const full = resolveSandboxed(root, args.path);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, args.content, 'utf8');
    return `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${args.path}`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function runOpenAIDelegate({ prompt, role, cwd, model, timeoutMs }) {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: 'OPENAI_API_KEY is not set in this MCP server\'s environment.' };
  }
  const effectiveModel = model || OPENAI_MODEL;
  if (!effectiveModel) {
    return {
      ok: false,
      error:
        'No model specified. Set the OPENAI_MODEL environment variable (or pass `model`) to a ' +
        'coding-capable model ID available on your OpenAI account.',
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const root = path.resolve(cwd || process.cwd());
  const tools = buildTools(role);

  const messages = [
    { role: 'system', content: ROLE_PREAMBLE[role] },
    { role: 'user', content: prompt },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15 * 60 * 1000);

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.chat.completions.create(
        { model: effectiveModel, messages, tools },
        { signal: controller.signal }
      );
      const choice = response.choices[0];
      const msg = choice.message;

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return { ok: true, text: msg.content?.trim() || '(model returned no text)' };
      }

      messages.push(msg);
      for (const call of msg.tool_calls) {
        let result;
        try {
          const args = JSON.parse(call.function.arguments || '{}');
          result = await executeTool(root, call.function.name, args);
        } catch (err) {
          result = `Error: ${err.message}`;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: String(result).slice(0, 50_000) });
      }
    }
    return { ok: false, error: `Reached max iterations (${MAX_ITERATIONS}) without a final answer.` };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: `OpenAI delegate timed out after ${(timeoutMs || 900000) / 1000}s.` };
    }
    return { ok: false, error: `OpenAI API error: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

const server = new McpServer({
  name: 'openai-bridge',
  version: '0.1.0',
});

server.registerTool(
  'delegate_to_openai',
  {
    title: 'Delegate to OpenAI (direct API)',
    description:
      'Hand off a self-contained subtask directly to the OpenAI API and get back only the ' +
      'compressed final report. Unlike delegate_to_codex, this does NOT require a locally-installed ' +
      'Codex CLI — use this specifically when running in Cowork / Claude Code on the web / any ' +
      'sandboxed remote session where a local Codex CLI is not reachable. On your own machine ' +
      '(Desktop app or terminal) with Codex CLI installed and logged in, prefer delegate_to_codex ' +
      'instead — it gets the full Codex agent rather than this minimal read_file/list_dir/write_file ' +
      'tool loop. The prompt must be fully self-contained.',
    inputSchema: {
      prompt: z.string().describe(
        'Full, self-contained instructions. Include all necessary context, file paths, and what ' +
        'kind of report to return.'
      ),
      role: z.enum(['executor', 'reviewer']).default('executor').describe(
        'executor: may read AND write files under the working directory, reports what it did. ' +
        'reviewer: read-only (no write_file tool available), reports findings only.'
      ),
      cwd: z.string().optional().describe(
        'Working directory the model\'s file tools are sandboxed to (defaults to this server\'s cwd). ' +
        'All file paths the model uses are resolved relative to this and cannot escape it.'
      ),
      model: z.string().optional().describe(
        'OpenAI model ID to use (defaults to the OPENAI_MODEL environment variable).'
      ),
      timeoutSeconds: z.number().int().positive().optional().describe(
        'Max seconds to wait before aborting (default 900).'
      ),
    },
  },
  async ({ prompt, role, cwd, model, timeoutSeconds }) => {
    const result = await runOpenAIDelegate({
      prompt,
      role: role || 'executor',
      cwd,
      model,
      timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
    });

    if (!result.ok) {
      return { isError: true, content: [{ type: 'text', text: result.error }] };
    }
    return { content: [{ type: 'text', text: result.text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
