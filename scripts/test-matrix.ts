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
  /**
   * A first call made in the same run, whose response the assertion compares
   * against. Used where the property under test is about the difference
   * between two calls — a topic narrowing a search, say — rather than about
   * one response on its own.
   */
  baseline?: Record<string, unknown>;
  /** Assertions over the returned text, and the baseline's when there is one. */
  expect?: (text: string, baseline?: string) => string | null;
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

/** The `### ` declaration headings of a response, in the order it sends them. */
const headings = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("### "))
    .map((line) => line.slice(4));

/**
 * Every section a response carries, split the way an agent reads it: one
 * `### ` chunk per section. A heading the response does not render as `###`
 * (a `##` group) has no declaration of its own and is not a section here.
 */
const sectionChunks = (text: string) => text.split("\n### ").slice(1);

/** Each returned section must mention the topic, not merely be near it. */
const everySectionMentions = (text: string, topic: string) => {
  const chunks = sectionChunks(text);
  if (chunks.length === 0) return "no sections returned";
  const off = chunks.filter(
    (chunk) => !chunk.toLowerCase().includes(topic.toLowerCase()),
  );
  return off.length === 0
    ? null
    : `${off.length} returned section(s) do not mention ${topic}`;
};

/**
 * What a topic must do: return a strict subset of the sections the same query
 * returns without it, and drop every section that does not mention it. A
 * reweighted ranking fails the first half; a filter that keeps unrelated
 * sections fails the second.
 */
const narrowsTo = (text: string, baseline: string | undefined, topic: string) => {
  if (baseline === undefined) return "no baseline response to compare against";
  const base = headings(baseline);
  const narrow = headings(text);
  if (narrow.length === 0) return `topic ${topic} returned no sections`;
  const outside = narrow.filter((heading) => !base.includes(heading));
  if (outside.length > 0)
    return `${outside.length} narrowed section(s) the untopiced query did not return: ${outside.join(", ")}`;
  if (narrow.length >= new Set(base).size)
    return `same ${narrow.length} sections with and without the topic`;
  return everySectionMentions(text, topic);
};

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

/**
 * The provenance line a caller cites. A standard-library package's pkg.go.dev
 * address carries no version — `encoding/json@v1.27.4` answers 400 — so an
 * `@` in that link is a dead citation.
 */
const stdlibSource = (text: string, expectedPath: string) => {
  const line = text.split("\n").find((l) => l.startsWith("source: "));
  if (!line) return "no source: line";
  return line === `source: https://pkg.go.dev/${expectedPath}`
    ? null
    : `stdlib source link is "${line}"`;
};

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
    // An overview must still carry its own structure at the smallest budget:
    // "non-empty" would pass on a header alone.
    expect: (t) =>
      has(t, "## Versions") && has(t, "github.com/egoist/mygo")
        ? null
        : "overview lost its sections at a small budget",
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
    // The declaration itself must come back, not merely a long response:
    // "Bind" also appears in BindAs and in unrelated bodies.
    expect: (t) =>
      has(t, "func Bind(") ? null : "Bind declaration not in results",
  },
  {
    name: "search/query-chinese",
    tool: "search",
    // mygo's godoc is English, so a Chinese query there has nothing to match.
    // This package's godoc is Chinese: 登录 (login) is what the Login method
    // documents. Before bigrams, "登录" tokenised to nothing and every type
    // came back in document order instead.
    args: {
      library: "github.com/medivhzhan/weapp/v3",
      query: "登录",
      max_tokens: 4000,
    },
    expect: (t) =>
      has(t, "No section matched")
        ? "Chinese query matched nothing"
        : has(t, "### Login")
          ? null
          : "Login not found for 登录",
  },
  {
    name: "search/query-chinese-no-match",
    tool: "search",
    // A Chinese query for something the package does not document must reach
    // the no-match response, not return every type. None of the bigrams in
    // 量子比特 occur in this godoc.
    args: {
      library: "github.com/medivhzhan/weapp/v3",
      query: "量子比特",
      max_tokens: 4000,
    },
    expect: (t) =>
      has(t, 'No section matched "量子比特"') ? null : "no-match not reported",
  },
  {
    name: "search/query-no-match",
    tool: "search",
    // "zzzz" appears in no godoc. It used to return 153 sections led by
    // AboutPanelOptions, because every type and func scored a flat bonus.
    args: { library: "github.com/egoist/mygo", query: "zzzz", max_tokens: 4000 },
    expect: (t) =>
      has(t, 'No section matched "zzzz"') && has(t, "Document map:")
        ? null
        : "unmatched query still returned sections",
  },
  {
    name: "search/query-topic-narrow",
    tool: "search",
    // The same query without the topic, measured in this same run, is the
    // baseline. The case this replaced asserted the output contained
    // "TitleBar", which the untopiced response already did, so it could never
    // fail; before ticket #8 a topic only reweighted the ranking, and the
    // untopiced answer still led with WindowOptions.
    //
    // "title bar" rather than "window" because both answers then fit inside
    // the 20,000-token budget: "window" returns 147,631 characters and would
    // compare a truncated prefix with a whole list. Here the narrowed sections
    // (6) are a strict subset of the untopiced ones (78), and each mentions
    // the topic.
    args: {
      library: "github.com/egoist/mygo",
      query: "title bar",
      topic: "TitleBarStyle",
      max_tokens: 20000,
    },
    baseline: {
      library: "github.com/egoist/mygo",
      query: "title bar",
      max_tokens: 20000,
    },
    expect: (t, base) => narrowsTo(t, base, "TitleBarStyle"),
  },
  {
    name: "search/query-no-library",
    tool: "search",
    args: { query: "gin" },
    spendsSearch: true,
    // A query-only call resolves the name first. "gin" may come back as
    // candidates; either way the tool must not claim the package has no docs.
    expect: (t) =>
      has(t, "no godoc text")
        ? "claimed the package has no godoc text"
        : has(t, "gin-gonic") || has(t, "ambiguous") || has(t, "Choose one")
          ? null
          : "gin not resolved or offered as candidate",
  },
  {
    name: "search/query-only-searches-docs",
    tool: "search",
    args: { query: "cobra" },
    spendsSearch: true,
    // `cobra` resolves to github.com/spf13/cobra, which has 3,452 characters
    // of godoc. Answering with the no-docs message means the bundle was
    // fetched as an overview and the query was never run against the docs.
    expect: (t) =>
      has(t, "no godoc text")
        ? "claimed the package has no godoc text"
        : has(t, "github.com/spf13/cobra") &&
            has(t, "### Command (type)") &&
            has(t, "pkg.go.dev/github.com/spf13/cobra")
          ? null
          : "query-only search did not return cobra's godoc sections",
  },
  {
    name: "search/query-only-ambiguous",
    tool: "search",
    args: { query: "gin middleware" },
    spendsSearch: true,
    // Resolution happens before any docs fetch: a name that matches several
    // modules must still return the candidates, not a docs search.
    expect: (t) =>
      has(t, "Choose one") && has(t, "gin")
        ? null
        : "query-only ambiguous name did not return candidates",
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
      has(t, "func (a *Application) OnWindowCreated")
        ? null
        : "qualified method not found",
  },
  {
    name: "get/symbol-missing",
    tool: "get",
    args: { library: "github.com/egoist/mygo", symbol: "NoSuchSymbolXyz" },
    expect: (t) =>
      has(t, "No declaration named") ? null : "missing symbol not reported",
  },
  {
    name: "get/symbol-qualified-wrong-receiver",
    tool: "get",
    // Application has no Title; only Window does. Substituting Window.Title
    // here would hand an agent a declaration it never asked for.
    args: { library: "github.com/egoist/mygo", symbol: "Application.Title" },
    expect: (t) =>
      !has(t, "```go") &&
      has(t, 'No declaration named "Application.Title"') &&
      has(t, "Window.Title")
        ? null
        : "receiver ignored: a declaration the caller did not name came back",
  },
  {
    name: "get/symbol-qualified-unknown-receiver",
    tool: "get",
    args: { library: "github.com/egoist/mygo", symbol: "NoSuchType.Window" },
    expect: (t) =>
      !has(t, "```go") && has(t, 'No declaration named "NoSuchType.Window"')
        ? null
        : "unknown receiver returned a Window method",
  },
  {
    name: "get/symbol-qualified-selects-receiver",
    tool: "get",
    // Window is declared on Document, Page and WebView. Only the named one
    // may come back.
    args: { library: "github.com/egoist/mygo", symbol: "Page.Window" },
    expect: (t) =>
      has(t, "func (p *Page) Window() *Window") &&
      !has(t, "func (d *Document[T]) Window() *Window")
        ? null
        : "wrong receiver returned",
  },
  {
    name: "get/symbol-ambiguous-bare-name",
    tool: "get",
    // Close is declared on several types; picking one silently is the defect.
    args: { library: "github.com/egoist/mygo", symbol: "Close" },
    expect: (t) =>
      !has(t, "```go") && has(t, "ambiguous") && has(t, 'symbol="')
        ? null
        : "ambiguous bare name returned one arbitrary declaration",
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
    expect: (t) =>
      // The question is about transferring files; TransferError is what this
      // package documents for it. "Non-empty" passed even on a no-match map.
      has(t, "TransferError") || has(t, "NewServer")
        ? null
        : "no file-transfer API in the answer",
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
    // "gin" appears in the provenance header of every response, so matching it
    // proved nothing. The middleware API is Engine.Use.
    expect: (t) =>
      has(t, "Use (method)") || has(t, "func (engine *Engine) Use(")
        ? null
        : "gin middleware API not in results",
  },
  {
    name: "real/json",
    tool: "search",
    args: { library: "encoding/json", query: "Marshal" },
    expect: (t) =>
      has(t, "Marshal") ? stdlibSource(t, "encoding/json") : "Marshal not found",
  },
  {
    name: "real/stdlib-net-http",
    tool: "get",
    args: { library: "net/http", symbol: "Server", max_tokens: 800 },
    expect: (t) =>
      has(t, "type Server struct")
        ? stdlibSource(t, "net/http")
        : "net/http Server missing",
  },
  {
    name: "real/stdlib-source-link",
    tool: "get",
    args: { library: "encoding/json", symbol: "Marshal" },
    expect: (t) =>
      has(t, "func Marshal")
        ? stdlibSource(t, "encoding/json")
        : "Marshal declaration missing",
  },
  {
    name: "real/owner-repo-shorthand",
    tool: "search",
    args: { library: "gin-gonic/gin", query: "middleware" },
    // The shorthand must resolve to the canonical module path, and the answer
    // must actually contain sections: the provenance header carries the path
    // even when nothing matched, so the path alone proves nothing.
    expect: (t) =>
      has(t, "library: github.com/gin-gonic/gin") && has(t, "### ")
        ? null
        : "owner/repo shorthand not resolved to a documented module",
  },
  {
    name: "real/cli-framework",
    tool: "search",
    args: { library: "github.com/spf13/cobra", query: "add a command" },
    // "cobra" is in the header of any response for this library, so it proved
    // nothing. Adding a command is AddCommand on *Command.
    expect: (t) =>
      has(t, "AddCommand (method)") || has(t, "func (c *Command) AddCommand(")
        ? null
        : "cobra AddCommand not in results",
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
    let baselineText: string | undefined;
    if (c.baseline) {
      const baseResult = await client.callTool({
        name: c.tool,
        arguments: c.baseline,
      });
      baselineText = ((baseResult.content as { text?: string }[]) ?? [])
        .map((b) => b.text ?? "")
        .join("\n");
      if (baseResult.isError) {
        ok = false;
        note = `baseline call failed: ${excerpt(baselineText, 120)}`;
      }
    }

    const result = await client.callTool({ name: c.tool, arguments: c.args });
    text = ((result.content as { text?: string }[]) ?? [])
      .map((b) => b.text ?? "")
      .join("\n");
    const isError = result.isError === true;

    if (ok && c.expectError && !isError) {
      ok = false;
      note = "expected an error result";
    } else if (ok && !c.expectError && isError) {
      ok = false;
      note = `unexpected error: ${excerpt(text, 120)}`;
    }

    // An expected error still has a message worth checking: the cause and the
    // next step are the part a caller reads.
    if (ok && c.expect) {
      const problem = c.expect(text, baselineText);
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
