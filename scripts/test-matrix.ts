#!/usr/bin/env bun
/**
 * Full parameter and scenario coverage for fact.
 *
 * Runs every tool argument, every boundary, and a spread of real-world
 * questions. Prints a pass/fail line per case with latency and a short
 * excerpt, then a summary.
 *
 *   bun run scripts/test-matrix.ts              # all cases
 *   bun run scripts/test-matrix.ts --filter=zh  # name filter
 *   bun run scripts/test-matrix.ts --verbose
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const args = process.argv.slice(2);
const filter = args.find((a) => a.startsWith("--filter="))?.split("=")[1];
const verbose = args.includes("--verbose");
/**
 * GitHub's unauthenticated search allows 10 requests a minute. A full run
 * resolves many bare names, so space the calls out unless told otherwise.
 * Cases that pass a module path or owner/repo skip search entirely and are
 * unaffected by this delay.
 */
const DELAY_MS = Number(
  args.find((a) => a.startsWith("--delay="))?.split("=")[1] ??
    process.env.TEST_DELAY_MS ??
    0,
);
const COMMAND = process.env.FACT_BIN ?? "fact-mcp";

interface Case {
  name: string;
  tool: "search" | "get";
  args: Record<string, unknown>;
  /** Assertions over the returned text. */
  expect?: (text: string) => string | null;
  /** Expected MCP-level error result. */
  expectError?: boolean;
  /**
   * Set when the case resolves a bare name, which spends one GitHub search.
   * Only those cases wait between calls; a module path or owner/repo resolves
   * without touching the search API, so it needs no pacing.
   */
  spendsSearch?: boolean;
}

const has = (text: string, needle: string) => text.includes(needle);

/** The four characters per token the `max_tokens` contract is measured in. */
const CHARS_PER_TOKEN = 4;

/**
 * The ceiling check: `max_tokens` is a contract an agent budgets against, so
 * the whole response — header and truncation footer included — must fit.
 */
const underBudget = (text: string, maxTokens: number) =>
  text.length <= maxTokens * CHARS_PER_TOKEN
    ? null
    : `${text.length} characters over a ${maxTokens * CHARS_PER_TOKEN} budget`;

/** An odd number of ``` markers means a truncated response is invalid Markdown. */
const evenFences = (text: string) => {
  const markers = text.split("```").length - 1;
  return markers % 2 === 0 ? null : `${markers} fence markers, which is odd`;
};

/** Both properties a truncated response must have. */
const truncatedWell = (text: string, maxTokens: number) =>
  underBudget(text, maxTokens) ?? evenFences(text);

const cases: Case[] = [
  // ---- search: library only (overview) ----
  // Only a few cases use a bare name: each one spends a GitHub search, and the
  // unauthenticated limit is 10 a minute. Everything else passes a module path
  // or owner/repo, which resolves without any search at all.
  {
    name: "search/overview-bare-name",
    tool: "search",
    args: { library: "mygo" },
    spendsSearch: true,
    expect: (t) =>
      has(t, "github.com/egoist/mygo") &&
      has(t, "## Versions") &&
      has(t, "## Packages")
        ? null
        : "missing module, versions or packages section",
  },
  {
    name: "search/overview-full-path",
    tool: "search",
    args: { library: "github.com/egoist/mygo" },
    expect: (t) =>
      has(t, "github.com/egoist/mygo") && has(t, "v0.8")
        ? null
        : "wrong module",
  },
  {
    name: "search/overview-viva",
    tool: "search",
    args: { library: "github.com/vivaui/viva" },
    expect: (t) => (has(t, "github.com/vivaui/viva") ? null : "wrong module"),
  },
  {
    name: "search/overview-pinned-version",
    tool: "search",
    args: { library: "github.com/egoist/mygo", version: "v0.8.0" },
    expect: (t) => (has(t, "v0.8.0") ? null : "pinned version not honoured"),
  },
  {
    name: "search/overview-max-tokens-min",
    tool: "search",
    args: { library: "github.com/egoist/mygo", max_tokens: 500 },
    expect: (t) => (t.length > 0 ? null : "empty"),
  },

  // ---- search: query ----
  {
    name: "search/query-native-window",
    tool: "search",
    args: {
      library: "github.com/egoist/mygo",
      query: "create a native window",
    },
    expect: (t) =>
      has(t, "WindowOptions") ? null : "WindowOptions not in results",
  },
  {
    name: "search/query-api-symbol",
    tool: "search",
    args: { library: "github.com/egoist/mygo", query: "Bind" },
    expect: (t) => (t.length > 200 ? null : "too little content"),
  },
  {
    name: "search/query-chinese",
    tool: "search",
    args: { library: "github.com/egoist/mygo", query: "创建窗口" },
    expect: (t) => (t.length > 0 ? null : "empty for Chinese query"),
  },
  {
    name: "search/query-topic-narrow",
    tool: "search",
    args: {
      library: "github.com/egoist/mygo",
      query: "window",
      topic: "TitleBarStyle",
    },
    expect: (t) =>
      has(t, "TitleBar") ? null : "topic did not narrow to TitleBar",
  },
  {
    name: "search/query-no-library",
    tool: "search",
    args: { query: "gin" },
    expect: (t) =>
      has(t, "gin-gonic") || has(t, "ambiguous") || has(t, "Choose one")
        ? null
        : "gin not resolved or offered as candidate",
  },
  {
    name: "search/query-max-tokens-large",
    tool: "search",
    args: {
      library: "github.com/egoist/mygo",
      query: "window",
      max_tokens: 20000,
    },
    expect: (t) =>
      t.length > 2000
        ? (underBudget(t, 20000) ?? evenFences(t))
        : "large budget returned little",
  },
  {
    name: "search/query-max-tokens-small",
    tool: "search",
    args: {
      library: "github.com/egoist/mygo",
      query: "window",
      max_tokens: 500,
    },
    // The declared defect: 2135 characters against a 2000 budget, ending with
    // one unclosed ``` marker. Both must fail the case now.
    expect: (t) =>
      has(t, "more matching section(s) not shown")
        ? truncatedWell(t, 500)
        : "no truncation footer for a small budget",
  },
  {
    name: "search/query-max-tokens-mid",
    tool: "search",
    args: {
      library: "github.com/egoist/mygo",
      query: "window",
      max_tokens: 2000,
    },
    expect: (t) =>
      has(t, "more matching section(s) not shown")
        ? truncatedWell(t, 2000)
        : "no truncation footer for a mid budget",
  },

  // ---- search: ambiguity and misses ----
  {
    name: "search/ambiguous-name",
    tool: "search",
    args: { library: "zap" },
    spendsSearch: true,
    // zap has two module paths (github.com/uber-go/zap and go.uber.org/zap).
    expect: (t) =>
      has(t, "zap") &&
      (has(t, "github.com/uber-go/zap") || has(t, "go.uber.org/zap"))
        ? null
        : "zap not resolved",
  },
  {
    name: "search/nonexistent",
    tool: "search",
    args: { library: "this-library-does-not-exist-xyz-9999" },
    spendsSearch: true,
    // A miss is a normal answer with guidance, not a tool error.
    expect: (t) =>
      has(t, "No Go module") || has(t, "Choose one") || has(t, "rate-limited")
        ? null
        : "unclear miss",
  },
  {
    name: "search/no-args",
    tool: "search",
    args: {},
    expectError: true,
    expect: (t) =>
      has(t, "Provide a query") ? null : "no guidance on empty input",
  },
  {
    name: "search/bad-version",
    tool: "search",
    args: { library: "github.com/egoist/mygo", version: "v999.999.999" },
    // A version that does not exist is the caller's mistake, so it comes back
    // as an error — but the message must name the cause and the next step.
    expectError: true,
    expect: (t) =>
      has(t, "no such module or version") && has(t, "Check the version")
        ? null
        : "bad version not reported clearly",
  },

  // ---- get ----
  {
    name: "get/symbol-type",
    tool: "get",
    args: { library: "github.com/egoist/mygo", symbol: "WindowOptions" },
    expect: (t) =>
      has(t, "type WindowOptions struct") ? null : "symbol body missing",
  },
  {
    name: "get/symbol-method-qualified",
    tool: "get",
    args: {
      library: "github.com/egoist/mygo",
      symbol: "Application.OnWindowCreated",
    },
    expect: (t) =>
      has(t, "OnWindowCreated") ? null : "qualified method not found",
  },
  {
    name: "get/symbol-missing",
    tool: "get",
    args: { library: "github.com/egoist/mygo", symbol: "NoSuchSymbolXyz" },
    expect: (t) =>
      has(t, "No declaration named") ? null : "missing symbol not reported",
  },
  {
    name: "get/page-subpackage",
    tool: "get",
    args: {
      library: "github.com/egoist/mygo",
      page: "github.com/egoist/mygo/ui",
      max_tokens: 3000,
    },
    expect: (t) =>
      has(t, "package ui") || has(t, "Package ui")
        ? null
        : "ui package not fetched",
  },
  {
    name: "get/page-viva-app",
    tool: "get",
    args: {
      library: "github.com/vivaui/viva",
      page: "github.com/vivaui/viva/app",
      symbol: "Config",
    },
    expect: (t) =>
      has(t, "type Config struct") ? null : "viva Config missing",
  },
  {
    name: "get/pinned-version",
    tool: "get",
    args: {
      library: "github.com/egoist/mygo",
      version: "v0.8.0",
      symbol: "WindowOptions",
    },
    // A full module path skips name lookup entirely, so this isolates pinning.
    expect: (t) =>
      has(t, "v0.8.0") && has(t, "WindowOptions") ? null : "version not pinned",
  },
  {
    name: "get/whole-page-truncation",
    tool: "get",
    args: { library: "github.com/egoist/mygo", max_tokens: 500 },
    // The declared defect: 2250 characters against a 2000 budget. The old
    // check passed either way because of its `||`, so it never noticed.
    expect: (t) =>
      has(t, "Truncated")
        ? truncatedWell(t, 500)
        : "no truncation note for a small budget",
  },
  {
    name: "get/symbol-truncation",
    tool: "get",
    args: {
      library: "github.com/egoist/mygo",
      symbol: "WindowOptions",
      max_tokens: 500,
    },
    // The declared defect: 2212 characters against 2000, and exactly one ```
    // marker, so an agent parsing by fence swallowed the rest.
    expect: (t) =>
      has(t, "Truncated") && has(t, "Raise max_tokens")
        ? truncatedWell(t, 500)
        : "no truncation note or next step",
  },
  {
    name: "get/whole-page-max-tokens-mid",
    tool: "get",
    args: { library: "github.com/egoist/mygo", max_tokens: 2000 },
    expect: (t) =>
      has(t, "Truncated")
        ? truncatedWell(t, 2000)
        : "no truncation note for a mid budget",
  },
  {
    name: "get/bad-library",
    tool: "get",
    args: { library: "definitely-not-a-real-module-xyz" },
    spendsSearch: true,
    expect: (t) =>
      has(t, "No Go module") || has(t, "Choose one") || has(t, "rate-limited")
        ? null
        : "unclear miss",
  },

  // ---- real-world questions ----
  {
    name: "real/file-transfer-library",
    tool: "search",
    args: {
      query: "transfer files over network",
      library: "github.com/pkg/sftp",
    },
    expect: (t) => (t.length > 100 ? null : "no answer"),
  },
  {
    name: "real/websocket",
    tool: "search",
    args: { library: "gorilla/websocket", query: "upgrade connection" },
    expect: (t) =>
      has(t, "Upgrader") || has(t, "upgrade") ? null : "no upgrade docs",
  },
  {
    name: "real/http-framework",
    tool: "search",
    args: { query: "middleware", library: "github.com/gin-gonic/gin" },
    expect: (t) => (has(t, "gin") ? null : "gin not found"),
  },
  {
    name: "real/json",
    tool: "search",
    args: { library: "encoding/json", query: "Marshal" },
    expect: (t) => (has(t, "Marshal") ? null : "Marshal not found"),
  },
  {
    name: "real/stdlib-net-http",
    tool: "get",
    args: { library: "net/http", symbol: "Server", max_tokens: 800 },
    expect: (t) =>
      has(t, "type Server struct") ? null : "net/http Server missing",
  },
  {
    name: "real/owner-repo-shorthand",
    tool: "search",
    args: { library: "gin-gonic/gin", query: "middleware" },
    expect: (t) => (has(t, "gin") ? null : "owner/repo shorthand not resolved"),
  },
  {
    name: "real/cli-framework",
    tool: "search",
    args: { library: "github.com/spf13/cobra", query: "add a command" },
    expect: (t) =>
      has(t, "cobra") || has(t, "Command") ? null : "cobra not resolved",
  },
];

function excerpt(text: string, n = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

const selected = filter ? cases.filter((c) => c.name.includes(filter)) : cases;
if (selected.length === 0) {
  console.error(`no cases match filter "${filter}"`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: COMMAND,
  args: [],
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  ),
});
const client = new Client({ name: "test-matrix", version: "0.0.0" });
await client.connect(transport);

let pass = 0;
const failures: string[] = [];

for (const c of selected) {
  const started = Date.now();
  let ok = true;
  let note = "";
  let text = "";

  try {
    const result = await client.callTool({ name: c.tool, arguments: c.args });
    text = ((result.content as { text?: string }[]) ?? [])
      .map((b) => b.text ?? "")
      .join("\n");
    const isError = result.isError === true;

    if (c.expectError && !isError) {
      ok = false;
      note = "expected an error result";
    } else if (!c.expectError && isError) {
      ok = false;
      note = `unexpected error: ${excerpt(text, 120)}`;
    }

    // An expected error still has a message worth checking: the cause and the
    // next step are the part a caller reads.
    if (ok && c.expect) {
      const problem = c.expect(text);
      if (problem) {
        ok = false;
        note = problem;
      }
    }
  } catch (error) {
    ok = false;
    note = `threw: ${String(error).slice(0, 160)}`;
  }

  const ms = Date.now() - started;
  const mark = ok ? "PASS" : "FAIL";
  console.log(
    `${mark}  ${String(ms).padStart(6)}ms  ${c.name}${note ? `  <- ${note}` : ""}`,
  );
  if (verbose || !ok) console.log(`        ${excerpt(text)}`);

  if (ok) pass++;
  else failures.push(c.name);

  if (DELAY_MS > 0 && c.spendsSearch)
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
}

await client.close();

console.log(`\n${pass}/${selected.length} passed`);
if (failures.length > 0) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
