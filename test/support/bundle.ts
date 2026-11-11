/**
 * A GoBundle built by hand, so the presentation suites need no network.
 *
 * The Markdown is the committed fixture; everything else is the smallest set
 * of fields the response assembly reads.
 */

import { readFileSync } from "node:fs";

import type { GoModule } from "../../src/orchestrator.ts";
import type { ResolvedBundle } from "../../src/render.ts";

export const FIXTURE_MARKDOWN = readFileSync(
  new URL("../fixtures/mygo.md", import.meta.url),
  "utf8",
);

/**
 * A trimmed excerpt of a real pkg.go.dev response whose godoc prose is
 * Chinese: `pkg.go.dev/v1/package/github.com/twgh/xcgui/window?doc=markdown`.
 * Used wherever a query in a script without word breaks is measured.
 */
export const ZH_FIXTURE_MARKDOWN = readFileSync(
  new URL("../fixtures/xcgui-window-zh.md", import.meta.url),
  "utf8",
);

/** The module every fixture bundle resolves to. */
export const MYGO_MODULE: GoModule = {
  path: "github.com/egoist/mygo",
  version: "v0.8.3",
  commitTime: "2025-03-04T10:00:00Z",
  isLatest: true,
  repoUrl: "https://github.com/egoist/mygo",
};

/** A resolved mygo bundle carrying the fixture Markdown. */
export function mygoBundle(
  overrides: Partial<ResolvedBundle> = {},
): ResolvedBundle {
  return {
    module: MYGO_MODULE,
    via: "module-path",
    versions: [
      { version: "v0.8.3", commitTime: "2025-03-04T10:00:00Z", isLatest: true },
      {
        version: "v0.8.0",
        commitTime: "2025-01-02T00:00:00Z",
        deprecated: true,
        retracted: true,
      },
    ],
    packages: [
      {
        path: "github.com/egoist/mygo",
        name: "mygo",
        synopsis: "Desktop application framework.",
      },
      // No synopsis: the overview and the "available packages" list skip it.
      { path: "github.com/egoist/mygo/ui", name: "ui", synopsis: "" },
    ],
    primaryPackage: "github.com/egoist/mygo",
    docs: {
      path: "github.com/egoist/mygo",
      version: "v0.8.3",
      synopsis: "Desktop application framework.",
      markdown: FIXTURE_MARKDOWN,
    },
    ...overrides,
  };
}

/**
 * A resolved standard-library package.
 *
 * Resolution reports the pseudo-module `std`, so the bundle carries
 * `via: "stdlib"`; pkg.go.dev addresses such a package by its import path with
 * no version at all.
 */
export function stdlibBundle(
  overrides: Partial<ResolvedBundle> = {},
): ResolvedBundle {
  return {
    module: {
      path: "std",
      version: "v1.27.4",
      commitTime: "2025-12-01T00:00:00Z",
      isLatest: true,
    },
    via: "stdlib",
    versions: [
      { version: "v1.27.4", commitTime: "2025-12-01T00:00:00Z", isLatest: true },
    ],
    packages: [
      {
        path: "encoding/json",
        name: "json",
        synopsis: "Package json implements encoding and decoding of JSON.",
      },
    ],
    primaryPackage: "encoding/json",
    docs: {
      path: "encoding/json",
      version: "v1.27.4",
      synopsis: "Package json implements encoding and decoding of JSON.",
      markdown: "## package json\n\n```go\npackage json\n```\n",
    },
    ...overrides,
  };
}

/** A bundle for a package that has no godoc text at all. */
export function bundleWithoutDocs(
  overrides: Partial<ResolvedBundle> = {},
): ResolvedBundle {
  return mygoBundle({ docs: undefined, ...overrides });
}
