/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {getStealthInitScript} from './init-scripts/index.js';
import {logger} from './logger.js';
import type {
  Browser,
  ChromeReleaseChannel,
  LaunchOptions,
  Page,
  Target,
} from './third_party/index.js';
import {puppeteer} from './third_party/index.js';

let browser: Browser | undefined;
const internalExtensions = new WeakMap<Browser, Set<string>>();

export function registerInternalExtension(browser: Browser, id: string): void {
  internalExtensions.get(browser)?.add(`chrome-extension://${id}/`);
}

export function unregisterInternalExtension(
  browser: Browser,
  id: string,
): void {
  internalExtensions.get(browser)?.delete(`chrome-extension://${id}/`);
}

function makeTargetFilter(allowedExtensions: Set<string>) {
  const ignoredPrefixes = new Set([
    'chrome://',
    'chrome-untrusted://',
    'chrome-extension://',
  ]);

  return function targetFilter(target: Target): boolean {
    if (target.type() === 'service_worker') {
      for (const prefix of allowedExtensions) {
        if (target.url().startsWith(prefix)) {
          return true;
        }
      }
    }
    if (target.url() === 'chrome://newtab/') {
      return true;
    }
    // Could be the only page opened in the browser.
    if (target.url().startsWith('chrome://inspect')) {
      return true;
    }
    for (const prefix of ignoredPrefixes) {
      if (target.url().startsWith(prefix)) {
        return false;
      }
    }
    return true;
  };
}

interface McpLaunchOptions {
  acceptInsecureCerts?: boolean;
  executablePath?: string;
  channel?: Channel;
  userDataDir?: string;
  headless: boolean;
  isolated: boolean;
  logFile?: fs.WriteStream;
  viewport?: {
    width: number;
    height: number;
  };
  chromeArgs?: string[];
  ignoreDefaultChromeArgs?: string[];
  viaCli?: boolean;
  proxyUsername?: string;
  proxyPassword?: string;
}

export function detectDisplay(): void {
  // Only detect display on Linux/UNIX.
  if (os.platform() === 'win32' || os.platform() === 'darwin') {
    return;
  }
  if (!process.env['DISPLAY']) {
    try {
      // Read only this process tree's own session, with a hard timeout, rather
      // than scanning every user process's environment.
      const result = execSync(
        `ps -u $(id -u) -o pid= | head -40 | xargs -I{} cat /proc/{}/environ 2>/dev/null | tr '\\0' '\\n' | grep -m1 '^DISPLAY=' | cut -d= -f2`,
        {timeout: 2000},
      );
      const display = result.toString('utf8').trim();
      if (display) {
        process.env['DISPLAY'] = display;
      }
    } catch {
      // no-op
    }
  }
}

/** Installs the main-world stealth script before future documents load. */
export async function installStealthOnPage(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(getStealthInitScript());
}

/** Sends a UA override on the page's primary CDP session, as emulate() does. */
async function overrideUserAgent(page: Page, userAgent: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (page as any)._client() as {
    send: (method: string, params?: unknown) => Promise<unknown>;
  };
  await client.send('Emulation.setUserAgentOverride', {userAgent});
}

/** Replaces Chrome's first tab, which carries the unsupported-flag banner. */
async function closeInitialTab(browser: Browser): Promise<void> {
  try {
    const initial = await browser.pages();
    const replacement = await browser.newPage();
    await Promise.all(
      initial.map(async page => {
        if (page !== replacement && page.url() === 'about:blank') {
          await page.close();
        }
      }),
    );
  } catch (err) {
    logger('Failed to replace the initial tab', err);
  }
}

const stealthInstalledBrowsers = new WeakSet<Browser>();

/** Applies the stealth script and a headed UA to current and future pages. */
export async function installStealthInitScript(
  browser: Browser,
): Promise<void> {
  if (stealthInstalledBrowsers.has(browser)) {
    return;
  }
  stealthInstalledBrowsers.add(browser);

  // Headless Chrome reports HeadlessChrome/<ver> on the very first request,
  // before any emulate call can scrub it.
  const launchUserAgent = await browser.userAgent();
  const headedUserAgent = launchUserAgent.includes('Headless')
    ? launchUserAgent.replace('HeadlessChrome', 'Chrome')
    : undefined;

  const prepare = async (page: Page): Promise<void> => {
    await installStealthOnPage(page);
    if (headedUserAgent) {
      await overrideUserAgent(page, headedUserAgent);
    }
  };

  const inject = async (target: Target): Promise<void> => {
    try {
      const page = await target.page();
      if (!page) {
        return;
      }
      await prepare(page);
    } catch (err) {
      logger('Failed to install stealth init script', err);
    }
  };
  browser.on('targetcreated', target => {
    void inject(target);
  });
  for (const page of await browser.pages()) {
    try {
      await prepare(page);
    } catch (err) {
      logger('Failed to install stealth init script on existing page', err);
    }
  }
}

export async function launch(options: McpLaunchOptions): Promise<Browser> {
  const {channel, executablePath, headless, isolated} = options;
  const profileDirName =
    channel && channel !== 'stable'
      ? `chrome-profile-${channel}`
      : 'chrome-profile';

  let userDataDir = options.userDataDir;
  if (!isolated && !userDataDir) {
    userDataDir = path.join(
      os.homedir(),
      '.cache',
      // Distinct from upstream chrome-devtools-mcp's default
      // ($HOME/.cache/chrome-devtools-mcp/...) so this fork can be installed
      // alongside the upstream package without contending for the same Chrome
      // profile or fighting over the user-data-dir lock.
      options.viaCli ? 'ghostframe-cli' : 'ghostframe-mcp',
      profileDirName,
    );
    await fs.promises.mkdir(userDataDir, {
      recursive: true,
    });
  }

  const args: LaunchOptions['args'] = [
    ...(options.chromeArgs ?? []),
    '--hide-crash-restore-bubble',
    // Load-bearing: without it navigator.webdriver reads true, even with
    // --enable-automation stripped. Chrome labels it unsupported and paints a
    // banner on its first tab; closeInitialTab() drops that tab instead.
    '--disable-blink-features=AutomationControlled',
  ];
  const ignoreDefaultArgs: LaunchOptions['ignoreDefaultArgs'] = [
    ...(options.ignoreDefaultChromeArgs ?? []),
    '--enable-automation',
  ];
  let puppeteerChannel: ChromeReleaseChannel | undefined;
  if (!executablePath) {
    puppeteerChannel =
      channel && channel !== 'stable'
        ? (`chrome-${channel}` as ChromeReleaseChannel)
        : 'chrome';
  }

  if (!headless) {
    detectDisplay();
  }

  try {
    const allowedExtensions = new Set<string>();
    const browser = await puppeteer.launch({
      // The MCP entry point awaits Browser.close() to flush persistent state.
      // Puppeteer's signal handlers would kill Chrome concurrently.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      channel: puppeteerChannel,
      targetFilter: makeTargetFilter(allowedExtensions),
      enableExtensions: true,
      executablePath,
      defaultViewport: null,
      userDataDir,
      pipe: true,
      headless,
      args,
      ignoreDefaultArgs: ignoreDefaultArgs,
      acceptInsecureCerts: options.acceptInsecureCerts,
      handleDevToolsAsPage: true,
    });
    internalExtensions.set(browser, allowedExtensions);
    // A crashed daemon can leave a controller and its regular-profile proxy
    // setting installed. Remove only our controllers before opening pages.
    try {
      for (const [id, extension] of await browser.extensions()) {
        if (
          extension.name === 'Ghostframe proxy controller' &&
          path.basename(extension.path).startsWith('ghostframe-proxy-')
        ) {
          await browser.uninstallExtension(id);
        }
      }
    } catch (error) {
      // Older Chrome builds lack Extensions.getExtensions. Runtime proxy tools
      // will report unsupported extension control when invoked on those builds.
      logger('Could not inspect leftover proxy controllers', error);
    }
    if (options.logFile) {
      // FIXME: we are probably subscribing too late to catch startup logs. We
      // should expose the process earlier or expose the getRecentLogs() getter.
      browser.process()?.stderr?.pipe(options.logFile);
      browser.process()?.stdout?.pipe(options.logFile);
    }
    await installStealthInitScript(browser);
    await closeInitialTab(browser);
    if (options.viewport) {
      const [page] = await browser.pages();
      await page?.resize({
        contentWidth: options.viewport.width,
        contentHeight: options.viewport.height,
      });
    }
    return browser;
  } catch (error) {
    if (
      userDataDir &&
      (error as Error).message.includes('The browser is already running')
    ) {
      throw new Error(
        `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<Browser> {
  if (browser?.connected) {
    return browser;
  }
  browser = await launch(options);
  return browser;
}

export type Channel = 'stable' | 'canary' | 'beta' | 'dev';
