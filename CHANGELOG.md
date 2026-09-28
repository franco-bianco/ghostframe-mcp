# Changelog

## 0.23.0-stealth.0

Private stealth fork of chrome-devtools-mcp.

- Default-on stealth posture: Patchright-shape DOM polyfills, humanized input,
  session-wide persona emulation, headed user-agent on headless launches.
- Removed telemetry, connect mode, slim mode, extension tooling, in-page and
  WebMCP tool protocols, and the flags that gated them.
- Console capture, network capture and navigation allowlists are always on.
- Removed network header redaction and `--redactNetworkHeaders`; request and
  response headers are always returned in full.

Upstream history before the fork is available in the chrome-devtools-mcp
repository.
