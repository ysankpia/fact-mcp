/**
 * fact-proxy — an optional accelerator for fact-mcp.
 *
 * Runs where pkg.go.dev answers in milliseconds. The client makes one request;
 * this process performs every upstream fetch and returns the raw material.
 * Presentation (sections, ranking, truncation) stays on the client.
 *
 * It stores nothing: no cache, no database, no files.
 *
 * Endpoints:
 *   GET /health
 *   GET /go/bundle?name=&version=&page=&want=     resolve + fetch Go docs
 *
 * The orchestration itself lives in src/orchestrator.ts, shared with the
 * client's direct mode, so the two can never disagree.
 */

import { buildBundle, UpstreamError } from "../src/orchestrator.ts";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.FACT_PROXY_TOKEN ?? "";

const json = (status: number, body: unknown) => Response.json(body, { status });

/** JSON response, gzipped when the client accepts it. */
function compressed(body: unknown, req: Request): Response {
  const payload = JSON.stringify(body);
  const accepts = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  if (!accepts || payload.length < 1024) {
    return new Response(payload, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(Bun.gzipSync(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "cache-control": "no-store",
    },
  });
}

async function route(req: Request): Promise<Response> {
  const u = new URL(req.url);

  if (u.pathname === "/health") {
    return json(200, { ok: true, service: "fact-proxy", version: "0.1" });
  }

  if (TOKEN) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${TOKEN}`) return json(401, { error: "unauthorized" });
  }

  if (u.pathname === "/go/bundle") {
    const params = u.searchParams;
    const name = (params.get("name") ?? "").trim();
    if (!name) return json(400, { error: "missing name" });

    const bundle = await buildBundle({
      name,
      version: params.get("version")?.trim() || undefined,
      page: params.get("page")?.trim() || undefined,
      want: params.get("want") === "overview" ? "overview" : "docs",
    });
    return compressed(bundle, req);
  }

  return json(404, { error: "not found" });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    try {
      return await route(req);
    } catch (error) {
      // Never let an exception escape: a thrown handler becomes an HTML 500,
      // which the client cannot read as a reason.
      if (error instanceof UpstreamError) {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (error.retryAfterMs) {
          headers["retry-after"] = String(Math.ceil(error.retryAfterMs / 1000));
        }
        return new Response(
          JSON.stringify({
            error: error.message,
            upstreamStatus: error.status,
            retryable: error.status === 429,
          }),
          { status: error.status === 429 ? 429 : 502, headers },
        );
      }
      console.error(`${new Date().toISOString()} unhandled: ${error}`);
      return json(500, { error: `internal error: ${String(error)}` });
    }
  },
});

console.error(`fact-proxy listening on 127.0.0.1:${server.port}`);
