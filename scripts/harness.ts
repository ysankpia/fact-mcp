/**
 * Shared setup for the live scripts: which build to exercise, and a GitHub
 * token for the search that bare-name resolution spends.
 */

import { existsSync } from "node:fs";

const LOCAL_BUILD = new URL("../dist/index.js", import.meta.url).pathname;

/**
 * Which build to exercise.
 *
 * `FACT_BIN` wins. Otherwise the working tree's build, because `fact-mcp` on
 * PATH is the published package: testing it after a code change silently
 * proves the old behaviour, which once produced a false "the fix did not
 * work". A bare checkout with no build still falls back to the installed
 * binary so the scripts run anywhere.
 */
export function buildCommand(): string {
  return (
    process.env.FACT_BIN ??
    (existsSync(LOCAL_BUILD) ? LOCAL_BUILD : "fact-mcp")
  );
}

/**
 * A GitHub token raises search from 10 to 30 requests a minute and is counted
 * per token rather than per shared IP. Without one, bare-name cases fail
 * intermittently and look like real failures. Reuse the `gh` CLI's token when
 * the environment does not already carry one.
 */
export function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (typeof Bun === "undefined") return undefined;
  try {
    const out = Bun.spawnSync(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return out.success ? out.stdout.toString().trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** The environment a child server should see. */
export function harnessEnv(token: string | undefined): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
    ...(token ? { GITHUB_TOKEN: token } : {}),
  };
}
