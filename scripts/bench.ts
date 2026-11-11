#!/usr/bin/env bun
/**
 * The product benchmark: twelve real questions, two numbers.
 *
 *   1. How many answers are present when the caller asks for 1,500 tokens.
 *   2. The median response size at the default budget.
 *
 * Position within the response is deliberately not a number here. The reader
 * is an agent that reads the whole answer, so rank 5 costs what rank 1 costs;
 * what decides the outcome is whether the answer is inside the budget.
 *
 * The baseline in `bench-baseline.json` is a ratchet: the numbers may not get
 * worse. The absolute target (answer present for at least 11 of 12, median at
 * or below 1,500) lands when responses are sliced, not by tuning this file.
 *
 *   bun run scripts/bench.ts
 *   bun run scripts/bench.ts --verbose
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { buildCommand, githubToken, harnessEnv } from "./harness.ts";

/** The budget the answer must fit for the first number. */
const TIGHT_BUDGET = 1500;
/** Median may drift this much above the recorded baseline before failing. */
const MEDIAN_TOLERANCE = 0.05;

interface Question {
  library: string;
  query: string;
  /** The declaration that answers the question, as it appears in the text. */
  expected: string;
}

const QUESTIONS: Question[] = [
  {
    library: "github.com/gin-gonic/gin",
    query: "how do I add middleware",
    expected: "func (engine *Engine) Use",
  },
  {
    library: "github.com/gin-gonic/gin",
    query: "how do I route requests",
    expected: "func (group *RouterGroup) GET",
  },
  {
    library: "github.com/gin-gonic/gin",
    query: "how do I read a JSON body",
    expected: "BindJSON",
  },
  {
    library: "github.com/spf13/cobra",
    query: "how do I add a subcommand",
    expected: "AddCommand",
  },
  {
    library: "github.com/spf13/cobra",
    query: "how do I define a flag",
    expected: "Flags",
  },
  {
    library: "github.com/egoist/mygo",
    query: "how do I create a window",
    expected: "func NewWindow",
  },
  {
    library: "github.com/egoist/mygo",
    query: "how do I make a window transparent",
    expected: "Transparent bool",
  },
  {
    library: "encoding/json",
    query: "how do I pretty print JSON",
    expected: "func MarshalIndent",
  },
  {
    library: "net/http",
    query: "how do I start a server",
    expected: "func ListenAndServe",
  },
  {
    library: "net/http",
    query: "how do I set a timeout",
    expected: "Timeout time.Duration",
  },
  {
    library: "github.com/pkg/sftp",
    query: "how do I upload a file",
    expected: "func (c *Client) Create",
  },
  {
    library: "gorilla/websocket",
    query: "how do I write a message",
    expected: "func (c *Conn) WriteMessage",
  },
];

interface Baseline {
  presentAt1500: number;
  medianTokensDefault: number;
}

const baseline = (await Bun.file(
  new URL("./bench-baseline.json", import.meta.url),
).json()) as Baseline;

const verbose = process.argv.includes("--verbose");
const token = githubToken();
const transport = new StdioClientTransport({
  command: buildCommand(),
  args: [],
  env: harnessEnv(token),
});
const client = new Client({ name: "bench", version: "0.0.0" });
await client.connect(transport);

const isTransient = (text: string) =>
  /fetch failed|ECONNRESET|The lookup failed|HTTP 5\d\d|rate-limited/i.test(text);

async function ask(
  question: Question,
  maxTokens: number | undefined,
): Promise<string> {
  const args: Record<string, unknown> = {
    library: question.library,
    query: question.query,
  };
  if (maxTokens !== undefined) args.max_tokens = maxTokens;

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await client.callTool({ name: "search", arguments: args });
      const text = ((result.content as { text?: string }[]) ?? [])
        .map((b) => b.text ?? "")
        .join("\n");
      if (attempt < 2 && isTransient(text)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      return text;
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

console.log(
  `testing ${buildCommand()}${token ? " (GitHub token from gh)" : ""}`,
);
console.log(
  `\n${"question".padEnd(46)} ${"@1500".padEnd(7)} default`,
);

let present = 0;
const sizes: number[] = [];
for (const question of QUESTIONS) {
  const tight = await ask(question, TIGHT_BUDGET);
  const hit = tight.includes(question.expected);
  if (hit) present++;

  const full = await ask(question, undefined);
  const tokens = Math.ceil(full.length / 4);
  sizes.push(tokens);

  console.log(
    `${question.query.padEnd(46)} ${(hit ? "yes" : "no").padEnd(7)} ~${tokens} tok`,
  );
  if (verbose && !hit) console.log(`        ${tight.slice(0, 200)}`);
}

await client.close();

sizes.sort((a, b) => a - b);
const median = sizes[Math.floor(sizes.length / 2)];

console.log(
  `\nanswer present at ${TIGHT_BUDGET}: ${present}/${QUESTIONS.length} (baseline ${baseline.presentAt1500})`,
);
console.log(
  `median at the default budget: ~${median} tok (baseline ~${baseline.medianTokensDefault})`,
);
console.log(
  JSON.stringify({
    questions: QUESTIONS.length,
    presentAt1500: present,
    medianTokensDefault: median,
  }),
);

const regressions: string[] = [];
if (present < baseline.presentAt1500) {
  regressions.push(
    `answer present dropped from ${baseline.presentAt1500} to ${present}`,
  );
}
if (median > baseline.medianTokensDefault * (1 + MEDIAN_TOLERANCE)) {
  regressions.push(
    `median response grew from ~${baseline.medianTokensDefault} to ~${median} tokens`,
  );
}
if (regressions.length > 0) {
  console.error(`\nregressed: ${regressions.join("; ")}`);
  process.exit(1);
}
