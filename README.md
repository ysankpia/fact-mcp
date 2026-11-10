# fact

**Fact, not memory.** Up-to-date library documentation for AI agents, over MCP.

[![npm](https://img.shields.io/npm/v/@sankpia/fact-mcp?color=cb3837)](https://www.npmjs.com/package/@sankpia/fact-mcp)
[![license](https://img.shields.io/npm/l/@sankpia/fact-mcp)](LICENSE)
[![CI](https://github.com/ysankpia/fact-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ysankpia/fact-mcp/actions/workflows/ci.yml)

Your AI guesses. `fact` makes it check.

```text
How do I create a native window in mygo? use fact
```

`fact` fetches the current official documentation for the library you ask
about, at the version that exists right now, and returns the passages that
answer the question.

---

## Why

An assistant answers library questions from what it read during training. That
is months old, and it shows:

- APIs that were renamed or removed
- Examples written for a version you are not using
- Methods that never existed

A central documentation index fixes some of this, but it lags too: it has to
crawl, and it is always behind the release. `fact` has no index. It reads the
library's own documentation API at the moment you ask.

## Install

```sh
npm install -g @sankpia/fact-mcp
```

Requires Node.js 20 or newer. Nothing else — the server is a single file with no
runtime dependencies.

## Connect

Add to your MCP client's configuration:

```json
{
  "mcpServers": {
    "fact": {
      "type": "stdio",
      "command": "fact-mcp",
      "args": []
    }
  }
}
```

That is the whole setup. It works with Factory, Claude Code, Cursor, VS Code and
any other MCP host.

<details>
<summary>Other clients</summary>

**Claude Code**

```sh
claude mcp add fact fact-mcp
```

**Cursor / VS Code**

Use the JSON above in the client's MCP settings file.

</details>

## Tools

### `search`

Ask a question about a library. Returns the passages that answer it.

| Argument     | Purpose                                     |
| ------------ | ------------------------------------------- |
| `query`      | What you need, in words or API names.       |
| `library`    | Library name, module path, or `owner/repo`. |
| `version`    | Pin a version. Default: latest.             |
| `topic`      | Narrow to one area or symbol.               |
| `max_tokens` | Response budget. Default 6000.              |

Leave `query` out and pass only `library` to get a version list and package
overview instead of documentation.

### `get`

Fetch one page or one declaration at full fidelity. Use it once `search` has
told you what to look at.

| Argument     | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `library`    | Library name or module path.                               |
| `symbol`     | `WindowOptions`, or `Window.Title` for a method.           |
| `page`       | Package path, e.g. `github.com/egoist/mygo/ui`.            |
| `version`    | Pin a version.                                             |
| `max_tokens` | Response budget. Default 8000.                             |

A qualified `symbol` selects by receiver and name together, so `Page.Window` is
the `Window` method of `Page` and nothing else. Type parameters may be left in
(`Document[T].Window`) or out (`Document.Window`). A bare name that matches
several declarations, or a receiver that has no such method, comes back as the
candidates to choose from rather than as one arbitrary declaration.

## How names resolve

You can name a library the way you would say it:

| You write                | Resolved as                                         |
| ------------------------ | --------------------------------------------------- |
| `mygo`                   | searched by GitHub stars, then verified as a module |
| `github.com/egoist/mygo` | used directly, no search                            |
| `gorilla/websocket`      | tried as `github.com/gorilla/websocket`             |
| `encoding/json`          | the standard library                                |

When two libraries share a name and neither clearly wins, `fact` returns the
candidates with star counts instead of picking one. Ask again with the module
path to disambiguate.

## Optional: run a proxy

Direct mode is fine when your network reaches `pkg.go.dev` quickly. On a slow or
lossy route, one query means several round trips and the delay adds up.

A `fact-proxy` sits next to `pkg.go.dev`, performs every upstream fetch itself,
and returns the material in one response. Set two variables and the client uses
it:

```sh
export FACT_PROXY_URL=https://your-proxy.example.com
export FACT_PROXY_TOKEN=your-token
```

To run one, see [`server/`](server/) and `scripts/setup-server.sh`. The proxy is
stateless: no cache, no database, no files.

## Configuration

| Variable                | Default  | Meaning                                        |
| ----------------------- | -------- | ---------------------------------------------- |
| `FACT_PROXY_URL`        | unset    | Proxy endpoint. Unset means direct mode.       |
| `FACT_PROXY_TOKEN`      | unset    | Bearer token for the proxy.                    |
| `GITHUB_TOKEN`          | unset    | Raises GitHub search from 10 to 30 per minute. |
| `FACT_TTL_MS`           | `300000` | In-process cache TTL. `0` disables it.         |
| `FACT_CACHE_MAX`        | `200`    | Max cached entries.                            |
| `FACT_PROXY_TIMEOUT_MS` | `45000`  | Per-attempt timeout in proxy mode.             |
| `FACT_PROXY_ATTEMPTS`   | `3`      | Retries for a flaky route.                     |

A `GITHUB_TOKEN` is optional and only affects bare-name lookups. A fine-grained
token with no permissions at all is enough, because repository search on public
repositories requires none.

## Design notes

**No index, nothing on disk.** Answers come from the source at request time. The
only cache is in process memory, expires after five minutes, and dies with the
process.

**One tool call, not three.** Resolving a library is part of `search`, not a
separate step you have to chain.

**Markdown, not HTML.** pkg.go.dev returns Markdown directly, so the response
is what an agent reads best.

**Failures are explicit.** A miss, an ambiguous name and a rate limit each
produce a different message with a next step. None of them is silently answered
from stale data.

## Development

```sh
bun install
bun run typecheck
bun run test-matrix          # 31 cases, every tool argument
bun run inspect              # MCP Inspector
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

MIT
