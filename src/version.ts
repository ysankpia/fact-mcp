/**
 * The version this server reports in `serverInfo`.
 *
 * Read from the package manifest at build time so it cannot drift from what was
 * published: a hand-written literal already shipped once, claiming `0.1.0`
 * while the package was `0.1.1`. `bun build` inlines the JSON.
 */

import manifest from "../package.json";

export const VERSION: string = manifest.version;
