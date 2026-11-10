#!/usr/bin/env node
/**
 * fact — current official library documentation for agents.
 *
 * Two tools, no local database:
 *   search  resolve a library and return the passages that answer a query
 *   get     fetch one page or one symbol at full fidelity
 *
 * Every call reads the official source through a stateless proxy. A process
 * local cache with a short TTL avoids re-downloading within a session; nothing
 * is written to disk and nothing survives a restart.
 *
 * This file is the process entry point and nothing else: it starts the stdio
 * transport and prints the startup banner. The server and its two tools are
 * built in `server.ts`, sectioning lives in `sections.ts`, ranking in `rank.ts`,
 * response assembly in `render.ts`, and the two tool bodies in
 * `tools-search.ts` and `tools-get.ts`, so that logic is testable with a
 * fixture instead of a live pkg.go.dev call.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { cacheStats } from "./cache.ts";
import { mode } from "./go.ts";
import { createServer } from "./server.ts";

const stats = cacheStats();
console.error(
  `fact ready (mode ${mode()}, ttl ${Math.round(stats.ttlMs / 1000)}s, max ${stats.max} entries)`,
);

void serveStdio(createServer);
