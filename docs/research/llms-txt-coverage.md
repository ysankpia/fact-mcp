# llms.txt coverage across documentation sites

Measured 2026-11-12. A site either serves `/llms.txt` at its root or it does
not. A **200 with HTML is a soft-404** and counts as missing: `deno.com` and
`docs.djangoproject.com` both return HTML at that path, so any implementation
must check the content type, not just the status code.

## Result: 20 of 45

| Ecosystem | Sites checked | Serves llms.txt |
| --- | --- | --- |
| Other (vendors, protocols) | 8 | 7 |
| JavaScript / TypeScript | 14 | 11 |
| Java (Kotlin) | 2 | 1 |
| Ruby | 2 | 1 |
| **Python** | **11** | **0** |
| **Rust** | **3** | **0** |
| PHP | 2 | 0 |
| .NET | 1 | 0 |
| Go | 2 | 0 |

## What is actually there

| Site | Size | Notes |
| --- | --- | --- |
| svelte.dev/llms-full.txt | 1.28 MB | the full docs as one file |
| docs.anthropic.com | 100 KB | |
| stripe.com | 99 KB | |
| modelcontextprotocol.io | 51 KB | |
| kotlinlang.org | 50 KB | |
| prisma.io | 37 KB | |
| bun.sh | 34 KB | links to `.md` pages |
| nodejs.org | 15 KB | |
| nextjs.org | 15 KB | |
| react.dev | 15 KB | |
| tanstack.com | 14 KB | |
| ruby-lang.org | 10 KB | |
| trpc.io | 9.5 KB | |
| vuejs.org | 7.4 KB | |
| vercel.com | 5.5 KB | |
| vitejs.dev | 3.5 KB | |
| supabase.com | 3.5 KB | |
| svelte.dev | 1.7 KB | |
| expressjs.com | 1.6 KB | |
| cloudflare.com | 17 KB | |

Absent: TypeScript, Tailwind, Deno (soft-404), every Python project checked,
every Rust project, PHP, .NET, and Go (which does not need it — pkg.go.dev has a
Markdown API).

## Consequence

If a second ecosystem is ever added, **JavaScript is the only one whose sources
are ready**: React, Next, Bun, TanStack and Vite publish `llms.txt` at request
time. Python and Rust have nothing to read, which is consistent with the
prototype results in
[python-docs-sources.md](python-docs-sources.md).

An `llms.txt` reader is small: fetch the file, follow the `.md` links it lists,
split on headings, rank. It is not a reason to build an index.
