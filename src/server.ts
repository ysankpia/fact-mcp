/**
 * The MCP server: its identity and its two tools.
 *
 * Kept apart from `index.ts` so a test can construct the server and read what a
 * client sees during initialization without starting the stdio transport. The
 * entry point owns only the process lifecycle.
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  candidateLines,
  goBundle,
  type GoModule,
} from "./go.ts";
import type { ResolvedBundle } from "./render.ts";
import { unresolved } from "./render.ts";
import { getDocs } from "./tools-get.ts";
import { missingInput, searchDocs, searchPlan } from "./tools-search.ts";
import { VERSION } from "./version.ts";

/** A library reference resolved to one module and the bundle that describes it. */
interface Resolved {
  ecosystem: "go";
  id: string;
  module: GoModule;
  bundle: ResolvedBundle;
}

/**
 * Resolve a library and fetch its material in one round trip.
 *
 * The proxy owns name resolution (GitHub star order beats pkg.go.dev's own
 * ranking, which buries a popular module under same-named forks) and every
 * upstream fetch. This side only decides what to present.
 */
async function resolveBundle(
  name: string,
  version?: string,
  page?: string,
  want: "overview" | "docs" = "docs",
): Promise<
  | { ok: true; value: Resolved }
  | { ok: false; candidates: string[]; via: string; error?: string }
> {
  let bundle;
  try {
    bundle = await goBundle({ name, version, page, want });
  } catch (error) {
    // An upstream failure — a version that does not exist, a rate limit, a
    // dropped connection — must come back as a readable answer, not an
    // exception the agent cannot interpret.
    return { ok: false, via: "error", candidates: [], error: String(error) };
  }

  if (!bundle.module) {
    return {
      ok: false,
      via: bundle.via,
      candidates: candidateLines(bundle),
    };
  }

  return {
    ok: true,
    value: {
      ecosystem: "go",
      id: bundle.module.path,
      module: bundle.module,
      bundle: bundle as ResolvedBundle,
    },
  };
}

/** The server, with both tools registered and its identity read from the manifest. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "fact", version: VERSION });

  server.registerTool(
    "search",
    {
      description:
        "Find current official documentation for a library and return the passages that answer a query. " +
        "Resolves the library name automatically; when the name is ambiguous it returns the candidates to choose from. " +
        "Call with only `library` to get a version and package overview. Prefer this over guessing an API from memory.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            'What you need, in words or API names, e.g. "create a native window" or "Limiter.Wait".',
          ),
        library: z
          .string()
          .optional()
          .describe(
            'Library name or Go module path, e.g. "mygo" or "github.com/egoist/mygo".',
          ),
        version: z
          .string()
          .optional()
          .describe('Module version such as "v0.8.3". Default: latest.'),
        topic: z
          .string()
          .optional()
          .describe(
            'Narrow the search to one area or symbol, e.g. "ui" or "Column".',
          ),
        max_tokens: z
          .number()
          .int()
          .min(500)
          .max(20000)
          .optional()
          .describe("Response budget. Default 6000."),
      }),
    },
    async ({ query, library, version, topic, max_tokens }) => {
      const args = {
        query,
        library,
        version,
        topic,
        max_tokens: max_tokens ?? 6000,
      };

      const queryText = (query ?? "").trim();
      const libraryName = (library ?? "").trim();

      // Which name to resolve and whether to fetch the docs body are one
      // decision, and it is the tool's, not the entry point's: without a
      // library name the query is the name, and a query always needs the docs.
      const plan = searchPlan(queryText, libraryName);
      // No name to resolve, so answer before any lookup.
      if (!plan) return missingInput();

      const r = await resolveBundle(plan.name, version, undefined, plan.want);
      if (!r.ok) return unresolved(plan.name, r.via, r.candidates, r.error);

      return searchDocs(args, r.value.bundle);
    },
  );

  server.registerTool(
    "get",
    {
      description:
        "Fetch one documentation page or one symbol from the official source, at full fidelity. " +
        "Use after search when you know the exact symbol or package you need.",
      inputSchema: z.object({
        library: z
          .string()
          .describe('Library name or Go module path, e.g. "mygo".'),
        symbol: z
          .string()
          .optional()
          .describe('Symbol to extract, e.g. "Column" or "Limiter.Wait".'),
        page: z
          .string()
          .optional()
          .describe(
            'Package path to read instead of the module default, e.g. "github.com/egoist/mygo/ui".',
          ),
        version: z
          .string()
          .optional()
          .describe("Module version. Default: latest."),
        max_tokens: z
          .number()
          .int()
          .min(500)
          .max(25000)
          .optional()
          .describe("Response budget. Default 8000."),
      }),
    },
    async ({ library, symbol, page, version, max_tokens }) => {
      const args = {
        library,
        symbol,
        page,
        version,
        max_tokens: max_tokens ?? 8000,
      };

      const r = await resolveBundle(library, version, page, "docs");
      if (!r.ok) return unresolved(library, r.via, r.candidates, r.error);

      return getDocs(args, r.value.bundle);
    },
  );

  return server;
}
