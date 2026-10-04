/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {installStealthOnPage} from './browser.js';
import {InterceptionController} from './investigation/InterceptionController.js';
import {NetworkCapture} from './investigation/NetworkCapture.js';
import {OperationManager} from './investigation/OperationManager.js';
import {ProxyController} from './investigation/ProxyController.js';
import {RuntimeInspector} from './investigation/RuntimeInspector.js';
import {McpPage} from './McpPage.js';
import {
  NetworkCollector,
  ConsoleCollector,
  type ListenerMap,
  type UncaughtError,
} from './PageCollector.js';
import {
  CdpFrame,
  Locator,
  PredefinedNetworkConditions,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Debugger,
  type HTTPRequest,
  type Page,
  type ScreenRecorder,
  type Viewport,
  type Extension,
  type Root,
  type DevTools,
} from './third_party/index.js';
import {listPages} from './tools/pages.js';
import {CLOSE_PAGE_ERROR} from './tools/ToolDefinition.js';
import type {Context, SupportedExtensions} from './tools/ToolDefinition.js';
import type {
  EmulationSettings,
  GeolocationOptions,
  UserAgentMetadata,
} from './types.js';
import {ensureExtension, getTempFilePath} from './utils/files.js';
import type {ParsedProxy} from './utils/proxy.js';
import {getNetworkMultiplierFromString} from './WaitForHelper.js';

interface McpContextOptions {
  allowUnrestrictedPaths: boolean;
  startupProxy?: ParsedProxy;
  // Test-only escape hatch; production always runs stealthed.
  stealth?: boolean;
}

const DEFAULT_TIMEOUT = 5_000;
const NAVIGATION_TIMEOUT = 10_000;
const TEMP_ROOTS: Root[] = [
  ...new Set(os.platform() === 'win32' ? [os.tmpdir()] : [os.tmpdir(), '/tmp']),
].map((rootPath, index) => {
  return {
    uri: pathToFileURL(rootPath).href,
    name: index === 0 ? 'temp' : 'system-temp',
  };
});

export class McpContext implements Context {
  browser: Browser;
  logger: Debugger;

  // Maps LLM-provided isolatedContext name → Puppeteer BrowserContext.
  #isolatedContexts = new Map<string, BrowserContext>();
  // Auto-generated name counter for when no name is provided.
  #nextIsolatedContextId = 1;

  #pages: Page[] = [];

  #mcpPages = new Map<Page, McpPage>();
  #selectedPage?: McpPage;
  #networkCollector: NetworkCollector;
  #consoleCollector: ConsoleCollector;
  #networkCapture: NetworkCapture;
  #proxyController: ProxyController;
  #runtimeInspector: RuntimeInspector;
  #operationManager = new OperationManager();
  #interceptionController = new InterceptionController();

  #screenRecorderData: {recorder: ScreenRecorder; filePath: string} | null =
    null;

  #nextPageId = 1;
  #sessionEmulation: EmulationSettings = {};

  #options: McpContextOptions;
  #roots: Root[] | undefined = undefined;

  private constructor(
    browser: Browser,
    logger: Debugger,
    options: McpContextOptions,
  ) {
    this.browser = browser;
    this.logger = logger;
    this.#options = options;

    this.#networkCollector = new NetworkCollector(this.browser);
    this.#networkCapture = new NetworkCapture(
      browser,
      page => this.#mcpPages.get(page)?.id,
      filePath => this.validatePath(filePath),
    );
    this.#proxyController = new ProxyController(browser, options.startupProxy);
    this.#runtimeInspector = new RuntimeInspector(
      browser,
      id => this.getPageById(id).pptrPage,
      () => this.getSelectedMcpPage().pptrPage,
    );

    this.#consoleCollector = new ConsoleCollector(this.browser, collect => {
      return {
        console: event => {
          collect(event);
        },
        uncaughtError: event => {
          collect(event);
        },
        devtoolsAggregatedIssue: event => {
          collect(event);
        },
      } as ListenerMap;
    });
  }

  async #init() {
    const pages = await this.createPagesSnapshot();
    await this.#networkCollector.init(pages);
    // Console capture rides the primary CDP session, where puppeteer has
    // already enabled Runtime, so it costs no extra detection surface.
    await this.#consoleCollector.init(pages);
    if (this.#options.startupProxy) {
      await this.#proxyController.initialize();
    }
  }

  getNetworkCapture(): NetworkCapture {
    return this.#networkCapture;
  }

  getProxyController(): ProxyController {
    return this.#proxyController;
  }

  getRuntimeInspector(): RuntimeInspector {
    return this.#runtimeInspector;
  }

  getOperationManager(): OperationManager {
    return this.#operationManager;
  }

  getInterceptionController(): InterceptionController {
    return this.#interceptionController;
  }

  async dispose(options: {closeBrowser?: boolean} = {}): Promise<void> {
    // Release pauses before terminating jobs; keep capture alive for their end markers.
    await this.#interceptionController.dispose();
    await this.#runtimeInspector.stopDebuggers();
    await this.#operationManager.dispose();
    await this.#runtimeInspector.dispose();
    await this.#networkCapture.dispose();
    if (options.closeBrowser) {
      try {
        await this.browser.close();
      } finally {
        await this.#proxyController.dispose();
      }
    } else {
      await this.#proxyController.dispose();
    }
    this.#networkCollector.dispose();
    this.#consoleCollector.dispose();
    for (const mcpPage of this.#mcpPages.values()) {
      mcpPage.dispose();
    }
    this.#mcpPages.clear();
    // Isolated contexts are intentionally not closed here.
    // Either the entire browser will be closed or we disconnect
    // without destroying browser state.
    this.#isolatedContexts.clear();
  }

  static async from(
    browser: Browser,
    logger: Debugger,
    opts: McpContextOptions,
  ) {
    const context = new McpContext(browser, logger, opts);
    await context.#init();
    return context;
  }

  roots(): Root[] | undefined {
    if (this.#roots === undefined) {
      return undefined;
    }
    return [...this.#roots, ...TEMP_ROOTS];
  }

  setRoots(roots: Root[] | undefined): void {
    this.#roots = roots;
  }

  async validatePath(filePath?: string): Promise<void> {
    if (filePath === undefined) {
      return;
    }
    if (this.#options.allowUnrestrictedPaths) {
      return;
    }
    const roots = this.roots() ?? TEMP_ROOTS;
    const absolutePath = await this.#canonicalizePath(filePath);
    for (const root of roots) {
      const rootPath = await this.#canonicalizePath(fileURLToPath(root.uri));
      const relative = path.relative(rootPath, absolutePath);
      if (
        relative === '' ||
        (relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      ) {
        return;
      }
    }
    throw new Error(
      `Access denied: path ${filePath} is not within any of the workspace roots ${JSON.stringify(roots)}.`,
    );
  }

  async #canonicalizePath(filePath: string): Promise<string> {
    let current = path.resolve(filePath);
    const missing: string[] = [];
    while (true) {
      try {
        return path.join(await fs.realpath(current), ...missing.toReversed());
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        ) {
          throw error;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Could not resolve path ${filePath}.`);
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }

  resolveCdpRequestId(page: McpPage, cdpRequestId: string): number | undefined {
    if (!cdpRequestId) {
      this.logger('no network request');
      return;
    }
    const request = this.#networkCollector.find(page.pptrPage, request => {
      // @ts-expect-error id is internal.
      return request.id === cdpRequestId;
    });
    if (!request) {
      this.logger('no network request for ' + cdpRequestId);
      return;
    }
    return this.#networkCollector.getIdForResource(request);
  }

  getNetworkRequests(
    page: McpPage,
    includePreservedRequests?: boolean,
  ): HTTPRequest[] {
    return this.#networkCollector.getData(
      page.pptrPage,
      includePreservedRequests,
    );
  }

  getConsoleData(
    page: McpPage,
    includePreservedMessages?: boolean,
  ): Array<ConsoleMessage | Error | DevTools.AggregatedIssue | UncaughtError> {
    return this.#consoleCollector.getData(
      page.pptrPage,
      includePreservedMessages,
    );
  }

  getConsoleMessageStableId(
    message: ConsoleMessage | Error | DevTools.AggregatedIssue | UncaughtError,
  ): number {
    return this.#consoleCollector.getIdForResource(message);
  }

  getConsoleMessageById(
    page: McpPage,
    id: number,
  ): ConsoleMessage | Error | DevTools.AggregatedIssue | UncaughtError {
    return this.#consoleCollector.getById(page.pptrPage, id);
  }

  async newPage(
    background?: boolean,
    isolatedContextName?: string,
  ): Promise<McpPage> {
    let page: Page;
    if (isolatedContextName !== undefined) {
      let ctx = this.#isolatedContexts.get(isolatedContextName);
      if (!ctx) {
        ctx = await this.browser.createBrowserContext();
        this.#isolatedContexts.set(isolatedContextName, ctx);
      }
      page = await ctx.newPage();
    } else {
      page = await this.browser.newPage({background});
    }
    if (this.getStealth()) {
      await installStealthOnPage(page);
    }
    await this.createPagesSnapshot();
    this.selectPage(this.#getMcpPage(page));
    this.#networkCollector.addPage(page);
    this.#consoleCollector.addPage(page);
    return this.#getMcpPage(page);
  }
  async closePage(pageId: number): Promise<void> {
    if (this.#pages.length === 1) {
      throw new Error(CLOSE_PAGE_ERROR);
    }
    const page = this.getPageById(pageId);
    if (page) {
      page.dispose();
      this.#mcpPages.delete(page.pptrPage);
    }
    await page.pptrPage.close({runBeforeUnload: false});
  }

  getNetworkRequestById(page: McpPage, reqid: number): HTTPRequest {
    return this.#networkCollector.getById(page.pptrPage, reqid);
  }

  /** Applies the session persona to a page that has not been emulated yet. */
  async #applySessionEmulation(page: Page): Promise<void> {
    const persona = this.#sessionEmulation;
    if (!Object.values(persona).some(value => value !== undefined)) {
      return;
    }
    await this.emulate(persona, page);
  }

  async emulate(
    options: {
      networkConditions?: string;
      cpuThrottlingRate?: number;
      geolocation?: GeolocationOptions;
      userAgent?: string;
      userAgentMetadata?: UserAgentMetadata;
      locale?: string;
      timezone?: string;
      colorScheme?: 'dark' | 'light' | 'auto';
      viewport?: Viewport;
    },
    targetPage?: Page,
  ): Promise<void> {
    const page = targetPage ?? this.getSelectedPptrPage();
    const mcpPage = this.#getMcpPage(page);
    const newSettings: EmulationSettings = {...mcpPage.emulationSettings};

    if (!options.networkConditions) {
      await page.emulateNetworkConditions(null);
      delete newSettings.networkConditions;
    } else if (options.networkConditions === 'Offline') {
      await page.emulateNetworkConditions({
        offline: true,
        download: 0,
        upload: 0,
        latency: 0,
      });
      newSettings.networkConditions = 'Offline';
    } else if (options.networkConditions in PredefinedNetworkConditions) {
      const networkCondition =
        PredefinedNetworkConditions[
          options.networkConditions as keyof typeof PredefinedNetworkConditions
        ];
      await page.emulateNetworkConditions(networkCondition);
      newSettings.networkConditions = options.networkConditions;
    }

    if (!options.cpuThrottlingRate) {
      await page.emulateCPUThrottling(1);
      delete newSettings.cpuThrottlingRate;
    } else {
      await page.emulateCPUThrottling(options.cpuThrottlingRate);
      newSettings.cpuThrottlingRate = options.cpuThrottlingRate;
    }

    if (!options.geolocation) {
      // Clear the override entirely instead of forcing {0, 0} (Null Island),
      // which is itself a fingerprintable bot tell. Falls back to the
      // browser's real geolocation behavior.
      const frame = page.mainFrame();
      if (!(frame instanceof CdpFrame)) {
        throw new Error('Emulation requires a CDP page.');
      }
      await frame.client.send('Emulation.clearGeolocationOverride');
      delete newSettings.geolocation;
    } else {
      await page.setGeolocation(options.geolocation);
      newSettings.geolocation = options.geolocation;
    }

    // UA + UA Client-Hints + locale + timezone all ride on the page's primary
    // CDP session so we can carry `userAgentMetadata` and have the overrides
    // apply to the existing connection (puppeteer's `setUserAgent` drops the
    // metadata, which desyncs `navigator.userAgent` from `Sec-CH-UA-*`).
    // CDP overrides are per-session; we must send on the same session
    // puppeteer uses for `Page.evaluate` etc., not a freshly attached one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const primaryClient = (page as any)._client() as {
      send: (method: string, params?: unknown) => Promise<unknown>;
    };
    const send = primaryClient.send.bind(primaryClient) as (
      method: string,
      params?: unknown,
    ) => Promise<unknown>;

    if (!options.userAgent) {
      await send('Emulation.setUserAgentOverride', {userAgent: ''});
      delete newSettings.userAgent;
      delete newSettings.userAgentMetadata;
    } else {
      const uaParams: {
        userAgent: string;
        userAgentMetadata?: UserAgentMetadata;
      } = {userAgent: options.userAgent};
      if (options.userAgentMetadata) {
        uaParams.userAgentMetadata = options.userAgentMetadata;
      }
      await send('Emulation.setUserAgentOverride', uaParams);
      newSettings.userAgent = options.userAgent;
      if (options.userAgentMetadata) {
        newSettings.userAgentMetadata = options.userAgentMetadata;
      } else {
        delete newSettings.userAgentMetadata;
      }
    }

    if (!options.locale) {
      // `Emulation.setLocaleOverride` with no `locale` clears the override.
      await send('Emulation.setLocaleOverride', {});
      await send('Network.setExtraHTTPHeaders', {headers: {}});
      delete newSettings.locale;
    } else {
      await send('Emulation.setLocaleOverride', {locale: options.locale});
      await send('Network.setExtraHTTPHeaders', {
        headers: {'Accept-Language': options.locale},
      });
      newSettings.locale = options.locale;
    }

    if (!options.timezone) {
      // `Emulation.setTimezoneOverride` with empty string clears the override.
      await send('Emulation.setTimezoneOverride', {timezoneId: ''});
      delete newSettings.timezone;
    } else {
      await send('Emulation.setTimezoneOverride', {
        timezoneId: options.timezone,
      });
      newSettings.timezone = options.timezone;
    }

    if (!options.colorScheme || options.colorScheme === 'auto') {
      await page.emulateMediaFeatures([
        {name: 'prefers-color-scheme', value: ''},
      ]);
      delete newSettings.colorScheme;
    } else {
      await page.emulateMediaFeatures([
        {name: 'prefers-color-scheme', value: options.colorScheme},
      ]);
      newSettings.colorScheme = options.colorScheme;
    }

    if (!options.viewport) {
      await page.setViewport(null);
      delete newSettings.viewport;
    } else {
      const defaults = {
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: false,
      };
      const viewport = {...defaults, ...options.viewport};
      await page.setViewport(viewport);
      newSettings.viewport = viewport;
    }

    mcpPage.emulationSettings = Object.keys(newSettings).length
      ? newSettings
      : {};
    // Only persona fields follow a page. Network and CPU throttling are
    // debugging knobs and stay scoped to the page they were set on.
    this.#sessionEmulation = {
      userAgent: newSettings.userAgent,
      userAgentMetadata: newSettings.userAgentMetadata,
      locale: newSettings.locale,
      timezone: newSettings.timezone,
      viewport: newSettings.viewport,
      colorScheme: newSettings.colorScheme,
      geolocation: newSettings.geolocation,
    };

    this.#updateSelectedPageTimeouts();
  }

  getScreenRecorder(): {recorder: ScreenRecorder; filePath: string} | null {
    return this.#screenRecorderData;
  }

  setScreenRecorder(
    data: {recorder: ScreenRecorder; filePath: string} | null,
  ): void {
    this.#screenRecorderData = data;
  }

  getStealth(): boolean {
    return this.#options.stealth ?? true;
  }

  getSelectedPptrPage(): Page {
    const page = this.#selectedPage;
    if (!page) {
      throw new Error('No page selected');
    }
    if (page.pptrPage.isClosed()) {
      throw new Error(
        `The selected page has been closed. Call ${listPages().name} to see open pages.`,
      );
    }
    return page.pptrPage;
  }

  getSelectedMcpPage(): McpPage {
    const page = this.getSelectedPptrPage();
    return this.#getMcpPage(page);
  }

  getPageById(pageId: number): McpPage {
    const page = this.#mcpPages.values().find(mcpPage => mcpPage.id === pageId);
    if (!page) {
      throw new Error('No page found');
    }
    return page;
  }

  getPageId(page: Page): number | undefined {
    return this.#mcpPages.get(page)?.id;
  }

  #getMcpPage(page: Page): McpPage {
    const mcpPage = this.#mcpPages.get(page);
    if (!mcpPage) {
      throw new Error('No McpPage found for the given page.');
    }
    return mcpPage;
  }

  #getSelectedMcpPage(): McpPage {
    return this.#getMcpPage(this.getSelectedPptrPage());
  }

  isPageSelected(page: Page): boolean {
    return this.#selectedPage?.pptrPage === page;
  }

  selectPage(newPage: McpPage): void {
    this.#selectedPage = newPage;
    this.#updateSelectedPageTimeouts();
  }

  #updateSelectedPageTimeouts() {
    const page = this.#getSelectedMcpPage();
    // For waiters 5sec timeout should be sufficient.
    // Increased in case we throttle the CPU
    const cpuMultiplier = page.cpuThrottlingRate;
    page.pptrPage.setDefaultTimeout(DEFAULT_TIMEOUT * cpuMultiplier);
    // 10sec should be enough for the load event to be emitted during
    // navigations.
    // Increased in case we throttle the network requests
    const networkMultiplier = getNetworkMultiplierFromString(
      page.networkConditions,
    );
    page.pptrPage.setDefaultNavigationTimeout(
      NAVIGATION_TIMEOUT * networkMultiplier,
    );
  }

  // Linear scan over per-page snapshots. The page count is small (typically
  // 2-10) so a reverse index isn't worthwhile given the uid-reuse lifecycle
  // complexity it would introduce.
  getAXNodeByUid(uid: string) {
    for (const mcpPage of this.#mcpPages.values()) {
      const node = mcpPage.textSnapshot?.idToNode.get(uid);
      if (node) {
        return node;
      }
    }
    return undefined;
  }

  async createPagesSnapshot(): Promise<Page[]> {
    const {pages: allPages, isolatedContextNames} = await this.#getAllPages();

    for (const page of allPages) {
      let mcpPage = this.#mcpPages.get(page);
      if (!mcpPage) {
        mcpPage = new McpPage(page, this.#nextPageId++);
        this.#mcpPages.set(page, mcpPage);
        this.#networkCapture.addPage(page);
        // We emulate a focused page for all pages to support multi-agent workflows.
        void page.emulateFocusedPage(true).catch(error => {
          this.logger('Error turning on focused page emulation', error);
        });
        try {
          await this.#applySessionEmulation(page);
        } catch (error) {
          this.logger('Error applying session emulation to a new page', error);
        }
      }
      mcpPage.isolatedContextName = isolatedContextNames.get(page);
    }

    // Prune orphaned #mcpPages entries (pages that no longer exist).
    const currentPages = new Set(allPages);
    for (const [page, mcpPage] of this.#mcpPages) {
      if (!currentPages.has(page)) {
        mcpPage.dispose();
        this.#mcpPages.delete(page);
      }
    }

    this.#pages = allPages.filter(page => {
      return !page.url().startsWith('devtools://');
    });

    if (
      (!this.#selectedPage ||
        this.#pages.indexOf(this.#selectedPage.pptrPage) === -1) &&
      this.#pages[0]
    ) {
      this.selectPage(this.#getMcpPage(this.#pages[0]));
    }

    await this.detectOpenDevToolsWindows();

    return this.#pages;
  }

  async #getAllPages(): Promise<{
    pages: Page[];
    isolatedContextNames: Map<Page, string>;
  }> {
    const defaultCtx = this.browser.defaultBrowserContext();
    const allPages = await this.browser.pages();

    // Build a reverse lookup from BrowserContext instance → name.
    const contextToName = new Map<BrowserContext, string>();
    for (const [name, ctx] of this.#isolatedContexts) {
      contextToName.set(ctx, name);
    }

    // Auto-discover BrowserContexts not in our mapping (e.g., externally
    // created incognito contexts) and assign generated names.
    const knownContexts = new Set(this.#isolatedContexts.values());
    for (const ctx of this.browser.browserContexts()) {
      if (ctx !== defaultCtx && !ctx.closed && !knownContexts.has(ctx)) {
        const name = `isolated-context-${this.#nextIsolatedContextId++}`;
        this.#isolatedContexts.set(name, ctx);
        contextToName.set(ctx, name);
      }
    }

    // Map each page to its isolated context name (if any).
    const isolatedContextNames = new Map<Page, string>();
    for (const page of allPages) {
      const ctx = page.browserContext();
      const name = contextToName.get(ctx);
      if (name) {
        isolatedContextNames.set(page, name);
      }
    }

    return {pages: allPages, isolatedContextNames};
  }

  async detectOpenDevToolsWindows() {
    this.logger('Detecting open DevTools windows');
    const {pages} = await this.#getAllPages();

    await Promise.all(
      pages.map(async page => {
        const mcpPage = this.#mcpPages.get(page);
        if (!mcpPage) {
          return;
        }

        // Prior to Chrome 144.0.7559.59, the command fails,
        // Some Electron apps still use older version
        // Fall back to not exposing DevTools at all.
        try {
          if (await page.hasDevTools()) {
            mcpPage.devToolsPage = await page.openDevTools();
          } else {
            mcpPage.devToolsPage = undefined;
          }
        } catch {
          mcpPage.devToolsPage = undefined;
        }
      }),
    );
  }

  getPages(): Page[] {
    return this.#pages;
  }

  getIsolatedContextName(page: Page): string | undefined {
    return this.#mcpPages.get(page)?.isolatedContextName;
  }

  async saveTemporaryFile(
    data: Uint8Array<ArrayBufferLike>,
    filename: string,
  ): Promise<{filepath: string}> {
    const filepath = await getTempFilePath(filename);
    await this.validatePath(filepath);
    try {
      const file = await fs.open(
        filepath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_TRUNC |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(data);
      } finally {
        await file.close();
      }
    } catch (err) {
      throw new Error('Could not save a file', {cause: err});
    }
    return {filepath};
  }

  async saveFile(
    data: Uint8Array<ArrayBufferLike>,
    clientProvidedFilePath: string,
    extension: SupportedExtensions,
  ): Promise<{filename: string}> {
    try {
      const filePath = ensureExtension(
        path.resolve(clientProvidedFilePath),
        extension,
      );
      await this.validatePath(filePath);
      await fs.mkdir(path.dirname(filePath), {recursive: true});
      await this.validatePath(filePath);
      const file = await fs.open(
        filePath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_TRUNC |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(data);
      } finally {
        await file.close();
      }
      return {filename: filePath};
    } catch (err) {
      this.logger(err);
      throw new Error('Could not save a file', {cause: err});
    }
  }

  getNetworkRequestStableId(request: HTTPRequest): number {
    return this.#networkCollector.getIdForResource(request);
  }

  waitForTextOnPage(
    text: string[],
    timeout?: number,
    targetPage?: Page,
  ): Promise<Element> {
    const page = targetPage ?? this.getSelectedPptrPage();
    const frames = page.frames();

    let locator = Locator.race(
      frames.flatMap(frame =>
        text.flatMap(value => [
          frame.locator(`aria/${value}`),
          frame.locator(`text/${value}`),
        ]),
      ),
    );

    if (timeout) {
      locator = locator.setTimeout(timeout);
    }

    return locator.wait();
  }

  /**
   * We need to ignore favicon request as they make our test flaky
   */
  async setUpNetworkCollectorForTesting() {
    this.#networkCollector = new NetworkCollector(this.browser, collect => {
      return {
        request: req => {
          if (req.url().includes('favicon.ico')) {
            return;
          }
          collect(req);
        },
      } as ListenerMap;
    });
    const {pages} = await this.#getAllPages();
    await this.#networkCollector.init(pages);
  }

  async installExtension(extensionPath: string): Promise<string> {
    await this.validatePath(extensionPath);
    const id = await this.browser.installExtension(extensionPath);
    return id;
  }

  async uninstallExtension(id: string): Promise<void> {
    await this.browser.uninstallExtension(id);
  }

  async triggerExtensionAction(id: string): Promise<void> {
    const extensions = await this.browser.extensions();
    const extension = extensions.get(id);
    if (!extension) {
      throw new Error(`Extension with ID ${id} not found.`);
    }
    const page = this.getSelectedPptrPage();
    await extension.triggerAction(page);
  }

  listExtensions(): Promise<Map<string, Extension>> {
    return this.browser.extensions();
  }

  async getExtension(id: string): Promise<Extension | undefined> {
    const pptrExtensions = await this.browser.extensions();
    return pptrExtensions.get(id);
  }
}
