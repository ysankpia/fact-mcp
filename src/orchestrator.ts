/**
 * The Go documentation orchestrator.
 *
 * One place that knows how to turn a library name into documentation. It runs
 * in two places:
 *
 *   - in the client, for direct mode (no server needed)
 *   - on a remote host, when a proxy is configured to skip a slow link
 *
 * It holds no state on disk. The only memory is a short-lived memo of name
 * resolutions, which exists because GitHub's unauthenticated search allows 10
 * requests a minute and a repeated question should not spend one.
 */

const PKG_GO_DEV = "https://pkg.go.dev/v1";
const GITHUB_API = "https://api.github.com";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "fact-mcp/0.1";

/** Upstream failure carrying the status, so callers can react to 429. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function githubToken(): string {
  return process.env.GITHUB_TOKEN ?? "";
}

/**
 * Fetch JSON from an upstream API.
 *
 * pkg.go.dev answers 429 under bursts; one retry after its `Retry-After`
 * clears almost every occurrence.
 */
async function getJSON<T>(url: string, attempt = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    // A dropped connection or timeout is the network, not the answer. One
    // retry is enough to separate the two; without it a transient failure
    // looks like "this module does not exist" to every caller.
    if (attempt <= 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return getJSON<T>(url, attempt + 1);
    }
    throw error;
  }

  if (res.status === 429 && attempt <= 2) {
    const header = Number(res.headers.get("retry-after") ?? 0);
    const wait =
      Number.isFinite(header) && header > 0 ? header * 1000 : 800 * attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5000)));
    return getJSON<T>(url, attempt + 1);
  }

  // A 5xx is upstream being briefly unavailable, not a missing module.
  if (res.status >= 500 && attempt <= 2) {
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    return getJSON<T>(url, attempt + 1);
  }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    throw new UpstreamError(
      `HTTP ${res.status} for ${url}`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : undefined,
    );
  }
  return (await res.json()) as T;
}

export interface GoModule {
  path: string;
  version: string;
  commitTime: string;
  isLatest: boolean;
  repoUrl?: string;
}

export interface GoVersion {
  version: string;
  commitTime: string;
  isLatest?: boolean;
  deprecated?: boolean;
  retracted?: boolean;
}

export interface GoPackageInfo {
  path: string;
  name: string;
  synopsis: string;
}

interface PackageDoc {
  modulePath: string;
  version: string;
  path: string;
  name: string;
  synopsis: string;
  docs?: string;
}

interface Repo {
  fullName: string;
  stars: number;
  description: string;
}

export interface Candidate {
  path: string;
  version: string;
  stars?: number;
  description: string;
}

export interface GoBundle {
  module?: GoModule;
  via: string;
  versions: GoVersion[];
  packages: GoPackageInfo[];
  primaryPackage?: string;
  docs?: {
    path: string;
    version: string;
    synopsis: string;
    markdown: string;
  };
  docsError?: string;
  candidates?: Candidate[];
}

export interface BundleRequest {
  name: string;
  version?: string;
  page?: string;
  /** "overview" skips the Markdown body; "docs" fetches it. */
  want: "overview" | "docs";
}

const isGoPath = (name: string) =>
  name.includes("/") && /^[a-z0-9-]+\.[a-z]{2,}\//i.test(name);

/**
 * "owner/repo" with no host. People write these constantly ("gorilla/websocket",
 * "gin-gonic/gin"), and they are a GitHub module path once prefixed.
 */
const isOwnerRepo = (name: string) =>
  /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name);

/**
 * Standard library packages have no module path of their own: pkg.go.dev
 * reports them under the pseudo-module "std". "encoding/json" must not be
 * sent to /v1/module, which answers 400 for it.
 */
const STDLIB_ROOTS = new Set([
  "archive",
  "bufio",
  "bytes",
  "cmp",
  "compress",
  "container",
  "context",
  "crypto",
  "database",
  "debug",
  "embed",
  "encoding",
  "errors",
  "expvar",
  "flag",
  "fmt",
  "go",
  "hash",
  "html",
  "image",
  "index",
  "io",
  "iter",
  "log",
  "maps",
  "math",
  "mime",
  "net",
  "os",
  "path",
  "plugin",
  "reflect",
  "regexp",
  "runtime",
  "slices",
  "sort",
  "strconv",
  "strings",
  "structs",
  "sync",
  "syscall",
  "testing",
  "text",
  "time",
  "unicode",
  "unique",
  "unsafe",
  "weak",
]);

const isStdlib = (name: string) => {
  if (name.includes(".")) return false;
  return STDLIB_ROOTS.has(name.split("/")[0]);
};

const getModule = (path: string, version?: string) => {
  const url = new URL(`${PKG_GO_DEV}/module/${path}`);
  if (version) url.searchParams.set("version", version);
  return getJSON<GoModule>(url.toString());
};

const getVersions = async (path: string, limit = 10) => {
  const url = new URL(`${PKG_GO_DEV}/versions/${path}`);
  url.searchParams.set("limit", String(limit));
  const data = await getJSON<{ items?: GoVersion[] }>(url.toString());
  return data.items ?? [];
};

const getPackages = async (path: string, limit = 100) => {
  const url = new URL(`${PKG_GO_DEV}/packages/${path}`);
  url.searchParams.set("limit", String(limit));
  const data = await getJSON<{ packages?: { items?: GoPackageInfo[] } }>(
    url.toString(),
  );
  return data.packages?.items ?? [];
};

const getPackageDoc = (path: string, version?: string) => {
  const url = new URL(`${PKG_GO_DEV}/package/${path}`);
  url.searchParams.set("doc", "markdown");
  url.searchParams.set("examples", "true");
  if (version) url.searchParams.set("version", version);
  return getJSON<PackageDoc>(url.toString());
};

/** GitHub repository search ranked by stars. */
async function searchRepos(name: string, limit = 8): Promise<Repo[]> {
  const url = new URL(`${GITHUB_API}/search/repositories`);
  url.searchParams.set("q", `${name} in:name language:go`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(Math.max(limit, 10)));

  const token = githubToken();
  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    throw new UpstreamError(
      `GitHub HTTP ${res.status}`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : undefined,
    );
  }

  const data = (await res.json()) as {
    items?: {
      full_name: string;
      stargazers_count: number;
      description: string | null;
      fork: boolean;
      archived: boolean;
    }[];
  };

  return (data.items ?? [])
    .filter((i) => !i.fork && !i.archived)
    .map((i) => ({
      fullName: i.full_name,
      stars: i.stargazers_count,
      description: i.description ?? "",
    }))
    .slice(0, limit);
}

/** Fallback index when GitHub yields nothing usable. */
async function searchGoIndex(q: string) {
  const url = new URL(`${PKG_GO_DEV}/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");
  const data = await getJSON<{
    items?: { modulePath: string; version: string; synopsis: string }[];
  }>(url.toString());
  return data.items ?? [];
}

interface ResolveResult {
  module?: GoModule;
  via: string;
  candidates?: Candidate[];
}

/**
 * Bare-name lookups are the only thing that costs a GitHub search, and the
 * unauthenticated limit is 10 a minute. A short in-memory memo means repeated
 * questions about the same library never spend another one. It holds no
 * document content and disappears when the process restarts.
 */
const NAME_MEMO_TTL_MS = 30 * 60_000;
const nameMemo = new Map<string, { at: number; result: ResolveResult }>();

function memoGet(key: string): ResolveResult | undefined {
  const hit = nameMemo.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > NAME_MEMO_TTL_MS) {
    nameMemo.delete(key);
    return undefined;
  }
  return hit.result;
}

function memoSet(key: string, result: ResolveResult): void {
  if (nameMemo.size > 500) nameMemo.clear();
  nameMemo.set(key, { at: Date.now(), result });
}

/**
 * Resolve a name to a Go module.
 *
 * GitHub's star order beats pkg.go.dev's own ranking, which buries a popular
 * module under same-named forks. Candidate modules are verified in parallel.
 */
async function resolve(name: string, version?: string): Promise<ResolveResult> {
  const memoKey = `${name.toLowerCase()}|${version ?? ""}`;
  const memoized = memoGet(memoKey);
  if (memoized) return memoized;

  const result = await resolveUncached(name, version);
  // Only cache a real answer: a rate limit is transient and must not stick.
  if (result.module || result.via === "ambiguous") memoSet(memoKey, result);
  return result;
}

async function resolveUncached(
  name: string,
  version?: string,
): Promise<ResolveResult> {
  if (isGoPath(name)) {
    return { module: await getModule(name, version), via: "path" };
  }

  if (isStdlib(name)) {
    return { module: await getModule("std"), via: "stdlib" };
  }

  // "owner/repo" is a GitHub path in all but the host. Try it directly before
  // searching: it costs one request and avoids the search rate limit entirely.
  if (isOwnerRepo(name)) {
    try {
      return {
        module: await getModule(`github.com/${name}`, version),
        via: "owner-repo",
      };
    } catch {
      // Not a module, or no tagged version: fall through to a name search.
    }
  }

  let repos: Repo[] = [];
  let githubRateLimited = false;
  try {
    repos = await searchRepos(name, 8);
  } catch (error) {
    // Rate limiting is not "no results": falling through to the pkg.go.dev
    // index would answer with the wrong library. Report it instead.
    if (
      error instanceof UpstreamError &&
      (error.status === 429 || error.status === 403)
    ) {
      githubRateLimited = true;
    }
    repos = [];
  }

  const exact = repos.filter(
    (r) =>
      (r.fullName.split("/").pop() ?? "").toLowerCase() === name.toLowerCase(),
  );
  const pool = exact.length > 0 ? exact : repos;

  if (pool.length > 0) {
    const verified = await Promise.all(
      pool.slice(0, 5).map(async (repo) => {
        try {
          const module = await getModule(
            `github.com/${repo.fullName}`,
            version,
          );
          return { repo, module };
        } catch (error) {
          // A 400 or 404 means this repository is not a Go module at that
          // path: it is not a candidate, and dropping it is correct.
          if (
            error instanceof UpstreamError &&
            (error.status === 404 || error.status === 400)
          ) {
            return null;
          }
          // Anything else means the candidate could not be checked. Dropping
          // it would leave an incomplete set, and the leader rule would then
          // answer with a worse module as if the better one did not exist —
          // a wrong answer presented as fact. Fail instead, and let the
          // caller retry.
          throw error;
        }
      }),
    );
    const confirmed = verified.filter(
      (v): v is { repo: Repo; module: GoModule } => v !== null,
    );

    if (confirmed.length === 1) {
      return { module: confirmed[0].module, via: "github" };
    }
    if (confirmed.length > 1) {
      const ranked = [...confirmed].sort((a, b) => b.repo.stars - a.repo.stars);
      // A runaway leader is the library people mean; forks rarely come close.
      if (ranked[0].repo.stars >= 10 * Math.max(ranked[1].repo.stars, 1)) {
        return { module: ranked[0].module, via: "github-leader" };
      }
      return {
        via: "ambiguous",
        candidates: ranked.map(({ repo, module }) => ({
          path: module.path,
          version: module.version,
          stars: repo.stars,
          description: repo.description,
        })),
      };
    }
  }

  const hits = await searchGoIndex(name);
  const seen = new Map<string, Candidate>();
  for (const hit of hits) {
    if (!seen.has(hit.modulePath)) {
      seen.set(hit.modulePath, {
        path: hit.modulePath,
        version: hit.version,
        description: hit.synopsis,
      });
    }
  }

  const entries = [...seen.values()];
  if (entries.length === 0) {
    return githubRateLimited ? { via: "github-rate-limited" } : { via: "none" };
  }
  if (entries.length === 1) {
    return {
      module: await getModule(entries[0].path, version),
      via: "pkgsearch",
    };
  }
  return {
    via: githubRateLimited ? "github-rate-limited" : "ambiguous",
    candidates: entries,
  };
}

/** Pick the package a reader most likely means inside a module. */
function pickPrimary(module: GoModule, packages: GoPackageInfo[]): string {
  const root = packages.find((p) => p.path === module.path);
  if (root?.synopsis) return module.path;

  const usable = packages.filter((p) => p.name !== "main" && p.synopsis);
  const short = module.path.split("/").pop() ?? "";
  const named = usable.find((p) => p.name === short);
  if (named) return named.path;

  if (usable.length > 0) {
    usable.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    return usable[0].path;
  }
  return module.path;
}

/**
 * Resolve a library and fetch everything a caller needs, in one round trip.
 * Versions and packages run in parallel; the doc page follows once the
 * primary package is known.
 */
export async function buildBundle(req: BundleRequest): Promise<GoBundle> {
  const name = req.name.trim();
  if (!name) throw new UpstreamError("missing name", 400);

  const resolved = await resolve(name, req.version);
  if (!resolved.module) {
    return {
      via: resolved.via,
      versions: [],
      packages: [],
      candidates: resolved.candidates ?? [],
    };
  }

  const module = resolved.module;
  const [versions, packages] = await Promise.all([
    getVersions(module.path, 10).catch(() => []),
    getPackages(module.path, 100).catch(() => []),
  ]);

  // For the standard library the module is "std" but the package the caller
  // named is the real path, so it wins over any guess.
  const primary =
    req.page ??
    (resolved.via === "stdlib" ? name : pickPrimary(module, packages));

  const base: GoBundle = {
    module,
    via: resolved.via,
    versions,
    packages: packages.filter((p) => p.name !== "main").slice(0, 60),
    primaryPackage: primary,
  };

  if (req.want === "overview") return base;

  try {
    const doc = await getPackageDoc(primary, req.version);
    return {
      ...base,
      docs: {
        path: doc.path,
        version: doc.version,
        synopsis: doc.synopsis,
        markdown: doc.docs ?? "",
      },
    };
  } catch (error) {
    return { ...base, docsError: String(error) };
  }
}

/** Test hook: clear the name memo between cases. */
export function clearNameMemo(): void {
  nameMemo.clear();
}
