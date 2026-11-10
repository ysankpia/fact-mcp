/**
 * Client for an optional fact-proxy.
 *
 * The proxy exists for one reason: on a slow or lossy route to pkg.go.dev,
 * doing every upstream fetch next to pkg.go.dev turns four round trips into
 * one. It is opt-in — with FACT_PROXY_URL unset, the client talks to
 * pkg.go.dev directly and this module is never used.
 *
 * Nothing is persisted on either side.
 */

const TIMEOUT_MS = Number(process.env.FACT_PROXY_TIMEOUT_MS ?? 45_000);
const ATTEMPTS = Number(process.env.FACT_PROXY_ATTEMPTS ?? 3);

export class ProxyError extends Error {}

function baseUrl(): string {
  const base = process.env.FACT_PROXY_URL?.trim();
  if (!base) throw new ProxyError("FACT_PROXY_URL is not set");
  return base;
}

function headers(): Record<string, string> {
  const token = process.env.FACT_PROXY_TOKEN?.trim();
  return {
    accept: "application/json",
    "accept-encoding": "gzip",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * GET a proxy endpoint, retrying transient TLS and connection failures.
 * Every attempt is a fresh request; nothing is persisted.
 */
export async function proxyGet(path: string): Promise<Response> {
  const url = new URL(path, baseUrl());
  let lastError: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // 429 means the upstream is throttling, not that the request is wrong.
      // Wait for its Retry-After and try again; the proxy already retried once.
      if (res.status === 429 && attempt < ATTEMPTS) {
        const header = Number(res.headers.get("retry-after") ?? 0);
        const wait =
          Number.isFinite(header) && header > 0
            ? header * 1000
            : 1500 * attempt;
        lastError = new Error("upstream rate limit");
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(wait, 8000)),
        );
        continue;
      }

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = new Error(`proxy returned ${res.status}`);
      } else {
        return res;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  throw new ProxyError(
    `proxy unreachable after ${ATTEMPTS} attempts: ${String(lastError)}`,
  );
}

/** GET a proxy endpoint and parse JSON. */
export async function proxyJSON<T>(path: string): Promise<T> {
  const res = await proxyGet(path);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProxyError(
      `proxy returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}
