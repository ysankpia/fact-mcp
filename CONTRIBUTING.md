# Contributing

Thanks for taking the time to contribute. This project is small and the process
is short.

## Development setup

```sh
git clone https://github.com/ysankpia/fact-mcp
cd fact-mcp
bun install
```

Requires [Bun](https://bun.sh) 1.1+ for development. The published package runs
on Node.js 20+, and the build must stay compatible with that.

## Before you open a pull request

Run the same three checks CI runs:

```sh
bun run typecheck
bun run build
bun run test-matrix --delay=6500
```

`test-matrix` needs network access. The `--delay` flag spaces the calls out
because bare-name resolution spends one GitHub search per new name, and the
unauthenticated limit is 10 a minute. Set `GITHUB_TOKEN` to raise it to 30.

If a test fails because a library changed upstream rather than because your
change broke something, say so in the pull request and update the assertion.

## What makes a good change

**Adding a language.** This is the most useful contribution. Create an adapter
next to `src/orchestrator.ts` that exposes the same shape:

```ts
buildBundle({ name, version, page, want }): Promise<Bundle>
```

Then route to it by ecosystem. The tools, caching and resolution logic are
already ecosystem-neutral, so nothing else needs to change.

**Improving resolution.** If a library resolves to the wrong module, the useful
report includes the name you typed, what came back, and what you expected.

**Improving extraction.** pkg.go.dev emits Markdown with `##` groups and one
fenced Go block per declaration. Section splitting lives in `src/index.ts`.

## What to avoid

- A prebuilt index. The whole point is that answers come from the source at
  request time.
- Writing anything to disk. Caching is in process memory and expires.
- Silent fallbacks. If a lookup fails, say why and give a next step; never answer
  from a guess.

## Commit messages

Conventional commits are preferred but not enforced:

```
feat: support crates.io
fix: resolve owner/repo before searching
docs: explain direct and proxy modes
```

## Reporting bugs

Open an issue with the library name you asked about, the response you got, and
what you expected. If the response includes a `source:` line, include it — it
names the exact API call that produced the answer.

## License

By contributing you agree that your contributions are licensed under the MIT
License.
