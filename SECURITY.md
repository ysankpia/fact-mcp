# Security Policy

## Scope

`fact-mcp` reads public documentation over HTTPS and returns it to an MCP
client. It holds no user data, writes nothing to disk, and stores no
credentials.

The optional `fact-proxy` is a stateless forwarder. It keeps no logs of document
content and no database.

## Reporting a vulnerability

Report privately through GitHub's
[security advisory form](https://github.com/luhui/fact-mcp/security/advisories/new).
Please do not open a public issue for a security problem.

Include what you did, what happened, and what you expected. A proof of concept
helps; a full exploit is not required.

You can expect an initial response within a week.

## What is in scope

- Requests that reach a host outside the allowlist
- Token or credential leakage
- Path traversal or injection through the proxy
- Denial of service through unbounded memory or response size
- Supply chain issues in the published package

## What is out of scope

- The accuracy of documentation returned by an upstream API
- Rate limiting applied by pkg.go.dev or GitHub
- Vulnerabilities in an MCP client or host application
- Anything that requires the attacker to already control the machine running the
  client

## Hardening notes

The proxy is designed to run with least privilege:

- Binds to `127.0.0.1`; it is not reachable from outside the host without a
  tunnel or reverse proxy.
- Requires a bearer token.
- Only makes outbound HTTPS requests, to an allowlist of documentation hosts.
- Runs as a system user with no login shell under a hardened systemd unit
  (`ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`,
  `MemoryMax=384M`).

If you run your own proxy, keep the token out of version control and rotate it
if it is ever exposed.
