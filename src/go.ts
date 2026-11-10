/**
 * Where the Go bundle comes from.
 *
 * Two modes, chosen at call time:
 *
 *   direct  build the bundle in this process. Works with no setup at all; the
 *           only cost is the network distance to pkg.go.dev.
 *   proxy   ask a fact-proxy to build it. One request on a slow link instead
 *           of several, because the proxy sits next to pkg.go.dev.
 *
 * Proxy is opt-in. Set FACT_PROXY_URL to use it; leave it unset for direct.
 */

import { cacheGet, cacheSet } from "./cache.ts";
import {
  buildBundle,
  type GoBundle,
  type BundleRequest,
} from "./orchestrator.ts";
import { proxyJSON } from "./proxy.ts";

export type { GoBundle, BundleRequest } from "./orchestrator.ts";
export type { GoModule, GoVersion, GoPackageInfo } from "./orchestrator.ts";

/** Whether a proxy endpoint is configured. */
export function proxyConfigured(): boolean {
  return Boolean(process.env.FACT_PROXY_URL?.trim());
}

/** Which mode a call will use, for the startup banner and diagnostics. */
export function mode(): "proxy" | "direct" {
  return proxyConfigured() ? "proxy" : "direct";
}

/**
 * Fetch a bundle for one library.
 *
 * Cached in process memory for a short TTL so repeat queries in a session cost
 * nothing; a restart starts clean. Nothing is written to disk.
 */
export async function goBundle(req: BundleRequest): Promise<GoBundle> {
  const key = ["go:bundle", req.name, req.version, req.page, req.want]
    .filter(Boolean)
    .join("|");
  const hit = cacheGet<GoBundle>(key);
  if (hit) return hit;

  const bundle = proxyConfigured()
    ? await fromProxy(req)
    : await buildBundle(req);
  cacheSet(key, bundle);
  return bundle;
}

async function fromProxy(req: BundleRequest): Promise<GoBundle> {
  const url = new URLSearchParams();
  url.set("name", req.name);
  url.set("want", req.want);
  if (req.version) url.set("version", req.version);
  if (req.page) url.set("page", req.page);
  return proxyJSON<GoBundle>(`/go/bundle?${url.toString()}`);
}

/** Turn a bundle's candidates into the lines a caller chooses from. */
export function candidateLines(bundle: GoBundle): string[] {
  return (bundle.candidates ?? []).map((c) => {
    const stars = c.stars !== undefined ? `, ★${c.stars}` : "";
    const description = c.description ? ` — ${c.description}` : "";
    return `- ${c.path} (latest ${c.version}${stars})${description}`;
  });
}
