import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ClaudeCodeOptions {
  /** Directory holding AGENT.md; the CLI runs here with only project settings. */
  agentDir: string;
  stateDir: string;
  role: string;
  mcpUrl: string;
  toolToken: string;
  allowedTools: string[];
  model: string | null;
  timeoutMs: number;
}

export interface ClaudeCodeResult {
  text: string;
  costUsd: number | null;
  durationMs: number;
  turns: number | null;
}

/**
 * Runs one headless Claude Code turn for a specialist role. The session sees only the Reissue
 * MCP server (with the role's scoped token) and no built-in tools, so it cannot read files,
 * run commands or reach anything the token does not allow.
 */
export async function runClaudeCode(prompt: string, options: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  await mkdir(options.stateDir, { recursive: true });
  const mcpConfig = join(options.stateDir, `${options.role}-mcp.json`);
  await writeFile(
    mcpConfig,
    JSON.stringify({ mcpServers: { reissue: { type: "http", url: options.mcpUrl, headers: { Authorization: `Bearer ${options.toolToken}` } } } }),
    { mode: 0o600 },
  );
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--max-turns",
    "12",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--tools",
    "",
    "--allowedTools",
    ...options.allowedTools,
    "--append-system-prompt-file",
    join(options.agentDir, "AGENT.md"),
    "--no-session-persistence",
  ];
  if (options.model) args.push("--model", options.model);

  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_CODE_BIN ?? "claude", args, { cwd: options.agentDir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Claude Code timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Claude Code exited with ${code}: ${(err || out).slice(0, 400)}`));
    });
  });
  const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number; num_turns?: number };
  if (parsed.is_error || typeof parsed.result !== "string") throw new Error(`Claude Code returned an error: ${stdout.slice(0, 400)}`);
  return { text: parsed.result, costUsd: parsed.total_cost_usd ?? null, durationMs: Date.now() - started, turns: parsed.num_turns ?? null };
}

/** Pulls the first JSON object out of a model reply that may wrap it in prose or a code fence. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}
