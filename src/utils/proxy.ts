/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedProxy {
  /** The `--proxy-server=` value to hand to Chrome (no embedded credentials). */
  server: string;
  username?: string;
  password?: string;
}

/**
 * Parse a proxy spec into the value Chrome accepts on `--proxy-server` plus
 * any embedded credentials. Chrome strips inline user:pass@ from the
 * `--proxy-server` flag for security, so credentials must be answered on the
 * 407 challenge via Puppeteer's `page.authenticate()`. Supported input forms:
 *
 *   host:port                         no auth
 *   host:port:user:pass               with auth (popular proxy-list format)
 *   http://host:port                  no auth, scheme passed through
 *   https://host:port                 no auth, scheme passed through
 *   socks5://host:port                no auth, scheme passed through
 *   http://user:pass@host:port        with auth, scheme passed through
 *   socks5://user:pass@host:port      with auth, scheme passed through
 *
 * Anything that does not match a recognised shape is returned as-is in
 * `server` with no credentials, preserving upstream `--proxy-server` behavior
 * for free-form Chrome proxy strings (e.g. `pac+http://...`,
 * `direct://`, multi-rule `http=...;https=...` strings).
 */
export function parseProxy(input: string | undefined): ParsedProxy | undefined {
  if (!input) {
    return undefined;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  // URL form (scheme://...). Use URL parser to extract embedded auth, if any.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (u.username) {
        // Strip credentials for the Chrome flag; keep path/query for forms
        // like pac+http://host/proxy.pac that carry meaningful URL data.
        return {
          server: `${u.protocol}//${u.host}${u.pathname === '/' && !u.search ? '' : u.pathname}${u.search}`,
          username: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
        };
      }
      // No auth: pass the original through unchanged so we never round-trip
      // away path/query/scheme details Chrome cares about.
      return {server: trimmed};
    } catch {
      return {server: trimmed};
    }
  }

  // Bare host:port:user:pass — common proxy-list format. Four colon-separated
  // parts, exactly. user/pass may legitimately contain non-colon characters.
  // The `:` count for IPv6 is always > 4, so this branch is IPv4/hostname only.
  const parts = trimmed.split(':');
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (host && /^\d+$/.test(port)) {
      return {
        server: `http://${host}:${port}`,
        username: user,
        password: pass,
      };
    }
  }

  // Bare host:port (no auth, no scheme). Promote to http:// so Chrome accepts
  // it consistently.
  if (/^[^:\s]+:\d+$/.test(trimmed)) {
    return {server: `http://${trimmed}`};
  }

  // Anything else: pass through unchanged. Lets users hand Chrome opaque
  // proxy expressions if they need to.
  return {server: trimmed};
}
