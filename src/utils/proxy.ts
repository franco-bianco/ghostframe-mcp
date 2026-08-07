/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedProxy {
  server: string;
  username?: string;
  password?: string;
}

interface ParseProxyOptions {
  username?: string;
  password?: string;
  allowLegacyCredentials?: boolean;
}

export function parseProxy(
  input: string | undefined,
  options: ParseProxyOptions = {},
): ParsedProxy | undefined {
  if (!input?.trim()) {
    return undefined;
  }
  if ((options.username === undefined) !== (options.password === undefined)) {
    throw new Error(
      'GHOSTFRAME_PROXY_USERNAME and GHOSTFRAME_PROXY_PASSWORD must be set together.',
    );
  }

  const trimmed = input.trim();
  let server = trimmed;
  let embeddedUsername: string | undefined;
  let embeddedPassword: string | undefined;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.username || url.password) {
        embeddedUsername = decodeURIComponent(url.username);
        embeddedPassword = decodeURIComponent(url.password);
        url.username = '';
        url.password = '';
        server = url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
      }
    } catch (error) {
      throw new Error('Invalid proxy URL.', {cause: error});
    }
  } else {
    const parts = trimmed.split(':');
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      if (host && /^\d+$/.test(port)) {
        server = `http://${host}:${port}`;
        embeddedUsername = username;
        embeddedPassword = password;
      }
    } else if (/^[^:\s]+:\d+$/.test(trimmed)) {
      server = `http://${trimmed}`;
    }
  }

  if (embeddedUsername !== undefined || embeddedPassword !== undefined) {
    if (!options.allowLegacyCredentials) {
      throw new Error(
        'Proxy credentials in --proxy-server are disabled. Use GHOSTFRAME_PROXY_USERNAME and GHOSTFRAME_PROXY_PASSWORD, or opt in with --allow-legacy-proxy-credentials.',
      );
    }
    if (options.username !== undefined || options.password !== undefined) {
      throw new Error(
        'Proxy credentials must be provided through either environment variables or --proxy-server, not both.',
      );
    }
  }

  const username = options.username ?? embeddedUsername;
  const password = options.password ?? embeddedPassword;
  if (username !== undefined || password !== undefined) {
    if (username === undefined || password === undefined) {
      throw new Error('Proxy username and password must be provided together.');
    }
    const protocol = new URL(server).protocol;
    if (protocol === 'socks:' || protocol === 'socks5:') {
      throw new Error('Chrome does not support authenticated SOCKS proxies.');
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(
        'Proxy authentication is supported only for HTTP proxies.',
      );
    }
    return {server, username, password};
  }

  return {server};
}
