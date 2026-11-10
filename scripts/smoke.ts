#!/usr/bin/env bun
/**
 * Exercise the MCP server over stdio exactly as a client does.
 * Usage: bun run scripts/smoke.ts [tool] [json-args]
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const tool = process.argv[2] ?? "search";
const rawArgs = process.argv[3] ?? '{"library":"mygo"}';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["run", new URL("../src/index.ts", import.meta.url).pathname],
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
});

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.error("tools:", tools.tools.map((t) => t.name).join(", "));

const started = Date.now();
const result = await client.callTool({
  name: tool,
  arguments: JSON.parse(rawArgs),
});
const elapsed = Date.now() - started;

for (const block of result.content as { type: string; text?: string }[]) {
  if (block.type === "text") process.stdout.write(block.text ?? "");
}
console.error(
  `\n--- ${tool} in ${elapsed}ms, isError=${result.isError ?? false} ---`,
);

await client.close();
