/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createHash, generateKeyPairSync} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  registerInternalExtension,
  unregisterInternalExtension,
} from '../browser.js';
import {Mutex} from '../Mutex.js';
import type {Browser, WebWorker} from '../third_party/index.js';
import {zod} from '../third_party/index.js';
import type {ParsedProxy} from '../utils/proxy.js';

export interface ProxySettings {
  mode: 'direct' | 'proxy';
  server?: string;
  username?: string;
  password?: string;
  bypassList?: string[];
  connectionPolicy?: 'new_connections' | 'disconnect_existing';
}

const resultSchema = zod.object({
  value: zod.unknown(),
  levelOfControl: zod.string(),
  credentialsConfigured: zod.boolean(),
});

interface NativeProxy {
  scheme: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
}

const credentialHistory = new WeakMap<Browser, Map<string, string>>();

function parseServer(server: string): NativeProxy {
  let url: URL;
  try {
    url = new URL(server.includes('://') ? server : `http://${server}`);
  } catch {
    throw new Error(
      'Invalid proxy server. Use a single proxy URL or host:port.',
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw new Error(
      'Use separate username and password fields for proxy credentials.',
    );
  }
  let scheme: NativeProxy['scheme'];
  switch (url.protocol) {
    case 'http:':
      scheme = 'http';
      break;
    case 'https:':
      scheme = 'https';
      break;
    case 'socks4:':
      scheme = 'socks4';
      break;
    case 'socks:':
    case 'socks5:':
      scheme = 'socks5';
      break;
    default:
      throw new Error(
        'Supported proxy schemes: http, https, socks4 and socks5.',
      );
  }
  return {
    scheme,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(
      url.port || (scheme === 'https' ? 443 : scheme === 'http' ? 80 : 1080),
    ),
  };
}

// Runs entirely inside our extension worker. Credentials never enter a webpage
// or the manifest; only matching proxy challenges can receive them.
const workerSource = `
const attempts = new Set();
const forgetAttempt = details => attempts.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(forgetAttempt, {urls: ['<all_urls>']});
chrome.webRequest.onErrorOccurred.addListener(forgetAttempt, {urls: ['<all_urls>']});
chrome.webRequest.onAuthRequired.addListener(async (details, callback) => {
  const {credentials} = await chrome.storage.session.get('credentials');
  if (details.isProxy && credentials &&
      details.challenger.host === credentials.host &&
      details.challenger.port === credentials.port) {
    if (attempts.has(details.requestId)) {
      callback({cancel: true});
      return;
    }
    attempts.add(details.requestId);
    callback({authCredentials: {username: credentials.username, password: credentials.password}});
  } else {
    callback({});
  }
}, {urls: ['<all_urls>']}, ['asyncBlocking']);
globalThis.ghostframeProxy = {
  async get() {
    const {credentials} = await chrome.storage.session.get('credentials');
    const result = await chrome.proxy.settings.get({incognito: false});
    return {...result, credentialsConfigured: Boolean(credentials)};
  },
  async set(config, nextCredentials) {
    const current = await chrome.proxy.settings.get({incognito: false});
    if (current.levelOfControl !== 'controllable_by_this_extension' &&
        current.levelOfControl !== 'controlled_by_this_extension') {
      throw new Error('Proxy settings are controlled by policy or another extension.');
    }
    const {credentials: previousCredentials} = await chrome.storage.session.get('credentials');
    await chrome.storage.session.set({credentials: nextCredentials || null});
    try {
      await chrome.proxy.settings.set({value: config, scope: 'regular'});
      const result = await this.get();
      if (result.levelOfControl !== 'controlled_by_this_extension') {
        throw new Error('Chrome did not apply the requested proxy setting.');
      }
      return result;
    } catch (error) {
      await chrome.storage.session.set({credentials: previousCredentials || null});
      throw error;
    }
  }
};
`;

/** Native profile proxy configuration; does not promise socket migration. */
export class ProxyController {
  readonly #browser: Browser;
  readonly #startupProxy?: ParsedProxy;
  readonly #mutex = new Mutex();
  #directory?: string;
  #extensionId?: string;
  #worker?: WebWorker;
  #initialization?: Promise<void>;
  #revision = 0;

  constructor(browser: Browser, startupProxy?: ParsedProxy) {
    this.#browser = browser;
    this.#startupProxy = startupProxy;
  }

  initialize(): Promise<void> {
    this.#initialization ??= this.#initialize();
    return this.#initialization;
  }

  async #initialize(): Promise<void> {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'ghostframe-proxy-'),
    );
    this.#directory = directory;
    const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
    const key = publicKey.export({type: 'spki', format: 'der'});
    const alphabet = 'abcdefghijklmnop';
    const id = Array.from(
      createHash('sha256').update(key).digest().subarray(0, 16),
    )
      .map(byte => `${alphabet[byte >> 4]}${alphabet[byte & 15]}`)
      .join('');
    registerInternalExtension(this.#browser, id);
    try {
      await Promise.all([
        writeFile(
          path.join(directory, 'manifest.json'),
          JSON.stringify({
            manifest_version: 3,
            name: 'Ghostframe proxy controller',
            version: '1.0.0',
            key: key.toString('base64'),
            permissions: [
              'proxy',
              'webRequest',
              'webRequestAuthProvider',
              'storage',
            ],
            host_permissions: ['<all_urls>'],
            background: {service_worker: 'controller.js'},
          }),
        ),
        writeFile(path.join(directory, 'controller.js'), workerSource),
      ]);
      this.#extensionId = await this.#browser.installExtension(directory);
      const target = await this.#browser.waitForTarget(
        target =>
          target.type() === 'service_worker' &&
          target.url() === `chrome-extension://${id}/controller.js`,
        {timeout: 10000},
      );
      const worker = await target.worker();
      if (!worker) {
        throw new Error('Proxy controller worker is unavailable.');
      }
      this.#worker = worker;
      if (this.#startupProxy?.username !== undefined) {
        const proxy = parseServer(this.#startupProxy.server);
        this.#checkCredentials(
          proxy,
          this.#startupProxy.username,
          this.#startupProxy.password,
        );
        const config = {mode: 'fixed_servers', rules: {singleProxy: proxy}};
        const credentials = {
          ...proxy,
          username: this.#startupProxy.username,
          password: this.#startupProxy.password,
        };
        await worker.evaluate(
          `globalThis.ghostframeProxy.set(${JSON.stringify(config)}, ${JSON.stringify(credentials)})`,
        );
        this.#rememberCredentials(
          proxy,
          this.#startupProxy.username,
          this.#startupProxy.password,
        );
      }
    } catch (error) {
      await this.dispose();
      unregisterInternalExtension(this.#browser, id);
      throw new Error(
        'Could not initialize native proxy switching. Chrome must support extensions over its debugging pipe.',
        {cause: error},
      );
    }
  }

  async get() {
    await this.initialize();
    if (!this.#worker) {
      throw new Error('Proxy controller is not initialized.');
    }
    const result = resultSchema.parse(
      await this.#worker.evaluate('globalThis.ghostframeProxy.get()'),
    );
    return {
      backend: 'chrome_extension',
      scope: 'regular_profile',
      revision: this.#revision,
      connectionPolicy: 'new_connections',
      existingConnections:
        'May continue using their previous route; not migrated or forcibly closed.',
      contextCoverage:
        'Regular profile; isolated contexts with explicit proxy overrides may use a different route.',
      credentialRotation:
        'Changing or removing previously configured credentials on the same proxy host/port is unsupported because Chrome may cache proxy authentication. Use a different endpoint or restart Chrome.',
      ...result,
    };
  }

  async set(settings: ProxySettings) {
    if (settings.connectionPolicy === 'disconnect_existing') {
      throw new Error(
        'Native proxy switching cannot explicitly close existing connections. Use new_connections; active requests and streams may keep their previous route.',
      );
    }
    if (
      (settings.username === undefined) !==
      (settings.password === undefined)
    ) {
      throw new Error('Proxy username and password must be supplied together.');
    }
    if (
      settings.mode === 'direct' &&
      (settings.server ||
        settings.username !== undefined ||
        settings.bypassList?.length)
    ) {
      throw new Error(
        'Direct mode does not accept a proxy server, credentials or bypass list.',
      );
    }
    const proxy =
      settings.mode === 'proxy' && settings.server
        ? parseServer(settings.server)
        : undefined;
    if (settings.mode === 'proxy' && !proxy) {
      throw new Error('Proxy mode requires a server.');
    }
    if (
      proxy &&
      settings.username !== undefined &&
      (proxy.scheme === 'socks4' || proxy.scheme === 'socks5')
    ) {
      throw new Error('Chrome does not support authenticated SOCKS proxies.');
    }
    const config = proxy
      ? {
          mode: 'fixed_servers',
          rules: {singleProxy: proxy, bypassList: settings.bypassList ?? []},
        }
      : {mode: 'direct'};
    const credentials =
      proxy && settings.username !== undefined
        ? {...proxy, username: settings.username, password: settings.password}
        : undefined;
    await this.initialize();
    const guard = await this.#mutex.acquire();
    try {
      if (!this.#worker) {
        throw new Error('Proxy controller is not initialized.');
      }
      if (proxy) {
        this.#checkCredentials(proxy, settings.username, settings.password);
      }
      await this.#worker.evaluate(
        `globalThis.ghostframeProxy.set(${JSON.stringify(config)}, ${JSON.stringify(credentials)})`,
      );
      if (proxy) {
        this.#rememberCredentials(proxy, settings.username, settings.password);
      }
      this.#revision++;
      return await this.get();
    } finally {
      guard.dispose();
    }
  }

  #checkCredentials(
    proxy: NativeProxy,
    username?: string,
    password?: string,
  ): void {
    const previous = credentialHistory
      .get(this.#browser)
      ?.get(`${proxy.host}:${proxy.port}`);
    if (
      previous !== undefined &&
      previous !== JSON.stringify([username, password])
    ) {
      throw new Error(
        'Changing or removing credentials for the same proxy endpoint is unsupported: Chrome may reuse cached authentication. Use a different host/port or restart Chrome.',
      );
    }
  }

  #rememberCredentials(
    proxy: NativeProxy,
    username?: string,
    password?: string,
  ): void {
    if (username === undefined) {
      return;
    }
    let history = credentialHistory.get(this.#browser);
    if (!history) {
      history = new Map();
      credentialHistory.set(this.#browser, history);
    }
    history.set(
      `${proxy.host}:${proxy.port}`,
      JSON.stringify([username, password]),
    );
  }

  async dispose(): Promise<void> {
    const id = this.#extensionId;
    this.#extensionId = undefined;
    this.#worker = undefined;
    try {
      if (id && this.#browser.connected) {
        await this.#browser.uninstallExtension(id);
      }
    } finally {
      if (id) {
        unregisterInternalExtension(this.#browser, id);
      }
      if (this.#directory) {
        await rm(this.#directory, {recursive: true, force: true});
        this.#directory = undefined;
      }
    }
  }
}
