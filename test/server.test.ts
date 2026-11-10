/**
 * The server's identity, observed the way a client sees it.
 *
 * A client reads `serverInfo` during initialization, so this connects a real
 * client to the real server over a linked in-memory transport and checks what
 * the handshake reports. No network and no subprocess.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createServer } from "../src/server.ts";

/** The manifest, read here on its own rather than through the source under test. */
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("server identity", () => {
  test("serverInfo reports the version in the package manifest", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "fact-test", version: "0.0.0" });
    const server = createServer();

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    expect(client.getServerVersion()).toEqual({
      name: "fact",
      version: manifest.version,
    });

    await client.close();
    await server.close();
  });

  test("no source file hand-writes the version the server reports", () => {
    // The stale literal shipped once: the manifest said 0.1.1 while the server
    // said 0.1.0. A manifest bump must move the reported version without a
    // second edit, so this fails if a literal reappears anywhere under src/,
    // not only in the two files the version is known to live in today.
    const literal = /version:\s*"\d+\.\d+\.\d+"/;
    const srcDir = new URL("../src/", import.meta.url);
    const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(new URL(file, srcDir), "utf8");
      expect(`${file} has a literal version: ${literal.test(source)}`).toBe(
        `${file} has a literal version: false`,
      );
    }
  });
});
