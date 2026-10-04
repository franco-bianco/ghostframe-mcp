/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {CdpFrame} from '../third_party/index.js';
import type {
  Browser,
  CDPEvents,
  CDPSession,
  CookieData,
  ElementHandle,
  Page,
  Protocol,
  Target,
} from '../third_party/index.js';

export interface RuntimeLocation {
  pageId?: number;
  targetId?: string;
  frameId?: string;
  world?: 'main' | 'isolated';
}

export type RuntimeArgument = {value: unknown} | {handle: string};

export function parseRuntimeArguments(
  value?: string,
): RuntimeArgument[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 1000) {
    throw new Error(
      'args must be a JSON array containing at most 1000 value/handle arguments.',
    );
  }
  const args: RuntimeArgument[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') {
      throw new Error('Each argument must be {value: JSON} or {handle: ID}.');
    }
    if (
      'handle' in item &&
      typeof item.handle === 'string' &&
      !('value' in item)
    ) {
      args.push({handle: item.handle});
    } else if ('value' in item && !('handle' in item)) {
      args.push({value: item.value});
    } else {
      throw new Error(
        'Each argument must specify exactly one value or handle.',
      );
    }
  }
  return args;
}

export function parseCookieData(
  value?: string,
  requireValue = true,
): CookieData[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 1000) {
    throw new Error('cookies must be a JSON array with at most 1000 entries.');
  }
  const result: CookieData[] = [];
  for (const item of parsed) {
    if (
      item === null ||
      typeof item !== 'object' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('domain' in item) ||
      typeof item.domain !== 'string'
    ) {
      throw new Error('Every cookie requires string name and domain fields.');
    }
    if (
      requireValue &&
      (!('value' in item) || typeof item.value !== 'string')
    ) {
      throw new Error('Every cookie to set requires a string value.');
    }
    const cookie: CookieData = {
      name: item.name,
      domain: item.domain,
      value:
        'value' in item && typeof item.value === 'string' ? item.value : '',
    };
    if ('path' in item) {
      if (typeof item.path !== 'string') {
        throw new Error('Cookie path must be a string.');
      }
      cookie.path = item.path;
    }
    for (const key of ['secure', 'httpOnly']) {
      if (key in item) {
        const field: unknown = Reflect.get(item, key);
        if (typeof field !== 'boolean') {
          throw new Error(`Cookie ${key} must be a boolean.`);
        }
        if (key === 'secure') {
          cookie.secure = field;
        } else {
          cookie.httpOnly = field;
        }
      }
    }
    if ('expires' in item) {
      if (typeof item.expires !== 'number' || !Number.isFinite(item.expires)) {
        throw new Error('Cookie expires must be a finite number.');
      }
      cookie.expires = item.expires;
    }
    if ('sameSite' in item) {
      if (
        item.sameSite !== 'Strict' &&
        item.sameSite !== 'Lax' &&
        item.sameSite !== 'None'
      ) {
        throw new Error('Cookie sameSite must be Strict, Lax or None.');
      }
      cookie.sameSite = item.sameSite;
    }
    if ('partitionKey' in item) {
      const partition = item.partitionKey;
      if (typeof partition === 'string') {
        cookie.partitionKey = partition;
      } else if (
        partition !== null &&
        typeof partition === 'object' &&
        'sourceOrigin' in partition &&
        typeof partition.sourceOrigin === 'string'
      ) {
        const ancestor =
          'hasCrossSiteAncestor' in partition
            ? partition.hasCrossSiteAncestor
            : undefined;
        if (ancestor !== undefined && typeof ancestor !== 'boolean') {
          throw new Error(
            'Cookie partition hasCrossSiteAncestor must be boolean.',
          );
        }
        cookie.partitionKey = {
          sourceOrigin: partition.sourceOrigin,
          hasCrossSiteAncestor: ancestor,
        };
      } else {
        throw new Error(
          'Cookie partitionKey must be a string or {sourceOrigin, hasCrossSiteAncestor?}.',
        );
      }
    }
    result.push(cookie);
  }
  return result;
}

export interface RuntimeEvaluation extends RuntimeLocation {
  function: string;
  args?: RuntimeArgument[];
  returnMode?: 'value' | 'handle';
}

// The internal CdpFrame declarations and Puppeteer's rolled-up public types
// have distinct nominal CDPSession identities. Use the actual protocol surface.
type RuntimeClient = Pick<CDPSession, 'send' | 'id' | 'detached' | 'detach'> & {
  on<Event extends keyof CDPEvents>(
    event: Event,
    listener: (value: CDPEvents[Event]) => void,
  ): void;
  off<Event extends keyof CDPEvents>(
    event: Event,
    listener: (value: CDPEvents[Event]) => void,
  ): void;
};

interface RealmSession {
  client: RuntimeClient;
  targetId: string;
  contextId?: number;
  frame?: CdpFrame;
  world: 'main' | 'isolated';
  globalObjectId?: string;
}

interface RetainedHandle {
  realm: RealmSession;
  object: Protocol.Runtime.RemoteObject;
}

interface SessionRecord {
  client: RuntimeClient;
  targetId: string;
  owned: boolean;
  onClear: () => void;
  onDestroyed: (event: Protocol.Runtime.ExecutionContextDestroyedEvent) => void;
}

interface DebuggerSession {
  realm: RealmSession;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
  scripts: Map<string, Protocol.Debugger.ScriptParsedEvent>;
  sources: Map<
    string,
    Promise<Protocol.Debugger.GetScriptSourceResponse | {unavailable: string}>
  >;
  paused?: Protocol.Debugger.PausedEvent;
  breakpoints: Map<string, () => Promise<unknown>>;
  onScript: (event: Protocol.Debugger.ScriptParsedEvent) => void;
  onPause: (event: Protocol.Debugger.PausedEvent) => void;
  onResume: () => void;
}

export interface DebuggerCommand extends RuntimeLocation {
  action:
    | 'start'
    | 'status'
    | 'stop'
    | 'resume'
    | 'breakpoint'
    | 'remove_breakpoint'
    | 'scripts'
    | 'source'
    | 'evaluate';
  timeoutMs?: number;
  kind?: 'source' | 'function' | 'xhr' | 'event';
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  condition?: string;
  handle?: string;
  eventName?: string;
  breakpointId?: string;
  scriptId?: string;
  callFrameId?: string;
  expression?: string;
  returnMode?: 'value' | 'handle';
}

export interface StorageQuery extends RuntimeLocation {
  kind: 'local' | 'session' | 'indexeddb' | 'cache';
  storageKey?: string;
  databaseName?: string;
  objectStoreName?: string;
  cacheId?: string;
  requestURL?: string;
  skipCount?: number;
  pageSize?: number;
}

/** Retains objects on existing page sessions; debugging is explicitly scoped. */
export class RuntimeInspector {
  #browser: Browser;
  #pageById: (pageId: number) => Page;
  #selectedPage: () => Page;
  #targets = new Map<string, Target>();
  #targetIds = new WeakMap<Target, string>();
  #sessions = new Map<string, SessionRecord>();
  #workerSessions = new Map<string, RuntimeClient>();
  #workerRealms = new Map<string, RealmSession>();
  #handles = new Map<string, RetainedHandle>();
  #debuggers = new Map<string, DebuggerSession>();
  #nextTarget = 1;
  #nextHandle = 1;
  #nextBreakpoint = 1;
  #disposed = false;

  constructor(
    browser: Browser,
    getPageById: (pageId: number) => Page,
    selectedPage: () => Page,
  ) {
    this.#browser = browser;
    this.#pageById = getPageById;
    this.#selectedPage = selectedPage;
    browser.on('targetdestroyed', this.#onTargetDestroyed);
  }

  #onTargetDestroyed = (target: Target): void => {
    const id = this.#targetIds.get(target);
    if (!id) {
      return;
    }
    this.#targets.delete(id);
    for (const [sessionId, record] of this.#sessions) {
      if (record.targetId === id) {
        record.client.off('Runtime.executionContextsCleared', record.onClear);
        record.client.off(
          'Runtime.executionContextDestroyed',
          record.onDestroyed,
        );
        this.#sessions.delete(sessionId);
      }
    }
    const workerSession = this.#workerSessions.get(id);
    if (workerSession) {
      this.#workerSessions.delete(id);
      this.#workerRealms.delete(id);
      void workerSession.detach().catch(() => {
        // Target destruction may already have detached the session.
      });
    }
    for (const [handle, value] of this.#handles) {
      if (value.realm.targetId === id) {
        this.#handles.delete(handle);
      }
    }
    const debug = this.#debuggers.get(id);
    if (debug) {
      void this.#stop(debug).catch(() => {
        // A destroyed target cannot acknowledge debugger cleanup.
      });
    }
  };

  #targetId(target: Target): string {
    let id = this.#targetIds.get(target);
    if (!id) {
      id = `target-${this.#nextTarget++}`;
      this.#targetIds.set(target, id);
    }
    this.#targets.set(id, target);
    return id;
  }

  async listTargets() {
    this.#assertActive();
    const result = [];
    for (const target of this.#browser.targets()) {
      const type = target.type();
      if (
        /^(chrome-extension|chrome|chrome-untrusted|devtools):/.test(
          target.url(),
        )
      ) {
        continue;
      }
      if (
        ![
          'page',
          'iframe',
          'service_worker',
          'shared_worker',
          'other',
        ].includes(type)
      ) {
        continue;
      }
      const id = this.#targetId(target);
      const page = type === 'page' ? await target.page() : null;
      const frames = page?.frames().map(frame => {
        if (!(frame instanceof CdpFrame)) {
          throw new Error('Runtime investigation requires a CDP browser.');
        }
        const parent = frame.parentFrame();
        return {
          frameId: frame._id,
          parentFrameId: parent instanceof CdpFrame ? parent._id : undefined,
          url: frame.url(),
          worlds: ['main', 'isolated'],
        };
      });
      result.push({targetId: id, type, url: target.url(), frames});
    }
    return {
      targets: result,
      limitations:
        'Targets are currently live Puppeteer targets. Workers must be explicitly selected; worklets and already-terminated targets may be unavailable. No global auto-attachment is enabled.',
    };
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('Runtime inspector has been disposed.');
    }
  }

  #observe(client: RuntimeClient, owned: boolean, targetId: string): void {
    if (this.#sessions.has(client.id())) {
      return;
    }
    const onClear = () => {
      for (const [id, handle] of this.#handles) {
        if (handle.realm.client === client) {
          this.#handles.delete(id);
        }
      }
    };
    const onDestroyed = (
      event: Protocol.Runtime.ExecutionContextDestroyedEvent,
    ) => {
      for (const [id, handle] of this.#handles) {
        if (
          handle.realm.client === client &&
          handle.realm.contextId === event.executionContextId
        ) {
          this.#handles.delete(id);
        }
      }
    };
    client.on('Runtime.executionContextsCleared', onClear);
    client.on('Runtime.executionContextDestroyed', onDestroyed);
    this.#sessions.set(client.id(), {
      client,
      targetId,
      owned,
      onClear,
      onDestroyed,
    });
  }

  async #realm(location: RuntimeLocation): Promise<RealmSession> {
    this.#assertActive();
    if (location.pageId !== undefined && location.targetId !== undefined) {
      throw new Error('Specify pageId or targetId, not both.');
    }
    let target: Target;
    let page: Page | null;
    if (location.targetId) {
      await this.listTargets();
      const found = this.#targets.get(location.targetId);
      if (!found) {
        throw new Error(
          'Target is unavailable; call list_targets for current IDs.',
        );
      }
      target = found;
      page = target.type() === 'page' ? await target.page() : null;
    } else {
      page =
        location.pageId === undefined
          ? this.#selectedPage()
          : this.#pageById(location.pageId);
      target = page.target();
    }
    const targetId = this.#targetId(target);
    if (
      /^(chrome-extension|chrome|chrome-untrusted|devtools):/.test(target.url())
    ) {
      throw new Error(
        'Browser internal and extension targets are not available for website investigation.',
      );
    }
    if (page) {
      const frame = location.frameId
        ? page
            .frames()
            .find(
              frame =>
                frame instanceof CdpFrame && frame._id === location.frameId,
            )
        : page.mainFrame();
      if (!(frame instanceof CdpFrame)) {
        throw new Error(
          'Frame unavailable; call list_targets for current frame IDs.',
        );
      }
      const world = location.world ?? 'isolated';
      const realm =
        world === 'main' ? frame.mainRealm() : frame.isolatedRealm();
      if (!realm.context) {
        const probe = await realm.evaluateHandle(() => undefined);
        await probe.dispose();
      }
      const contextId = realm.context?.id;
      if (contextId === undefined) {
        throw new Error('Execution context is unavailable.');
      }
      const client = frame._client();
      this.#observe(client, false, targetId);
      return {client, contextId, targetId, frame, world};
    }
    if (location.frameId || location.world === 'isolated') {
      throw new Error(
        'Worker targets have a single realm; frameId/isolated world do not apply.',
      );
    }
    if (!['service_worker', 'shared_worker', 'other'].includes(target.type())) {
      throw new Error('Select a page or worker target from list_targets.');
    }
    const existingRealm = this.#workerRealms.get(targetId);
    if (existingRealm && !existingRealm.client.detached) {
      return existingRealm;
    }
    let client = this.#workerSessions.get(targetId);
    if (!client || client.detached) {
      client = await target.createCDPSession();
      this.#workerSessions.set(targetId, client);
      this.#observe(client, true, targetId);
    }
    const global = await client.send('Runtime.evaluate', {
      expression: 'globalThis',
      objectGroup: 'ghostframe-investigation',
      generatePreview: false,
    });
    const workerRealm: RealmSession = {
      client,
      targetId,
      world: 'main',
      globalObjectId: global.result.objectId,
    };
    this.#workerRealms.set(targetId, workerRealm);
    return workerRealm;
  }

  #retain(object: Protocol.Runtime.RemoteObject, realm: RealmSession) {
    if (!object.objectId) {
      return {
        type: object.type,
        value: object.value,
        unserializableValue: object.unserializableValue,
        description: object.description,
      };
    }
    if (this.#handles.size >= 1000) {
      void realm.client
        .send('Runtime.releaseObject', {objectId: object.objectId})
        .catch(() => {
          // The realm may have disappeared while enforcing the handle limit.
        });
      throw new Error(
        'Retained handle limit reached (1000); release_handles before continuing.',
      );
    }
    const handle = `handle-${this.#nextHandle++}`;
    this.#handles.set(handle, {object, realm});
    return {
      handle,
      type: object.type,
      subtype: object.subtype,
      description: object.description,
    };
  }

  #handle(id: string): RetainedHandle {
    this.#assertActive();
    const handle = this.#handles.get(id);
    if (!handle || handle.realm.client.detached) {
      throw new Error(
        `Handle ${id} expired or was released. Re-evaluate in the current target.`,
      );
    }
    const frame = handle.realm.frame;
    if (frame) {
      const realm =
        handle.realm.world === 'main'
          ? frame.mainRealm()
          : frame.isolatedRealm();
      if (frame.detached || realm.context?.id !== handle.realm.contextId) {
        this.#handles.delete(id);
        throw new Error(
          `Handle ${id} expired after navigation or frame replacement.`,
        );
      }
    }
    return handle;
  }

  #arguments(
    args: RuntimeArgument[],
    realm: RealmSession,
  ): Protocol.Runtime.CallArgument[] {
    return args.map(arg => {
      if ('value' in arg) {
        return {value: arg.value};
      }
      const retained = this.#handle(arg.handle);
      if (
        retained.realm.client !== realm.client ||
        retained.realm.contextId !== realm.contextId ||
        retained.realm.world !== realm.world
      ) {
        throw new Error(
          'Handle arguments must belong to the same target, frame and world.',
        );
      }
      return {objectId: retained.object.objectId};
    });
  }

  #result(
    result: Protocol.Runtime.RemoteObject,
    realm: RealmSession,
    error?: Protocol.Runtime.ExceptionDetails,
  ) {
    if (error) {
      throw new Error(error.exception?.description ?? error.text);
    }
    return this.#retain(result, realm);
  }

  async evaluate(options: RuntimeEvaluation) {
    const realm = await this.#realm(options);
    if (this.#debuggers.get(realm.targetId)?.paused) {
      throw new Error(
        'Target is paused. Use debugger_control evaluate with callFrameId, or resume first.',
      );
    }
    const result = await realm.client.send('Runtime.callFunctionOn', {
      functionDeclaration: `function (...args) { return (${options.function})(...args); }`,
      executionContextId: realm.contextId,
      objectId: realm.globalObjectId,
      arguments: this.#arguments(options.args ?? [], realm),
      awaitPromise: true,
      returnByValue: options.returnMode !== 'handle',
      objectGroup: 'ghostframe-investigation',
      silent: true,
      generatePreview: false,
    });
    return this.#result(result.result, realm, result.exceptionDetails);
  }

  async inspectHandle(id: string, ownProperties = true) {
    const retained = this.#handle(id);
    if (!retained.object.objectId) {
      throw new Error('This value has no inspectable object identity.');
    }
    const properties = await retained.realm.client.send(
      'Runtime.getProperties',
      {
        objectId: retained.object.objectId,
        ownProperties,
        generatePreview: false,
      },
    );
    const encode = (value: Protocol.Runtime.RemoteObject | undefined) =>
      value ? this.#retain(value, retained.realm) : undefined;
    return {
      properties: properties.result.map(property => ({
        name: property.name,
        enumerable: property.enumerable,
        configurable: property.configurable,
        writable: property.writable,
        value: encode(property.value),
        getter: encode(property.get),
        setter: encode(property.set),
        symbol: encode(property.symbol),
      })),
      internalProperties: properties.internalProperties?.map(property => ({
        name: property.name,
        value: encode(property.value),
      })),
      privateProperties: properties.privateProperties?.map(property => ({
        name: property.name,
        value: encode(property.value),
        getter: encode(property.get),
        setter: encode(property.set),
      })),
      limitations:
        'Getters are returned as handles, not invoked. Engine internal scopes/private properties are version-dependent; optimized-out values may be unavailable. Retention and inspection can affect timing/garbage collection.',
    };
  }

  async callHandle(options: {
    handle: string;
    args?: RuntimeArgument[];
    thisHandle?: string;
    returnMode?: 'value' | 'handle';
  }) {
    const retained = this.#handle(options.handle);
    if (this.#debuggers.get(retained.realm.targetId)?.paused) {
      throw new Error(
        'Target is paused; resume before invoking a function handle.',
      );
    }
    if (retained.object.type !== 'function' || !retained.object.objectId) {
      throw new Error('call_handle requires a function handle.');
    }
    const args = this.#arguments(options.args ?? [], retained.realm);
    const receiver = options.thisHandle
      ? this.#arguments([{handle: options.thisHandle}], retained.realm)[0]
      : {};
    const result = await retained.realm.client.send('Runtime.callFunctionOn', {
      objectId: retained.object.objectId,
      functionDeclaration:
        'function (receiver, ...args) { return Reflect.apply(this, receiver, args); }',
      arguments: [receiver, ...args],
      awaitPromise: true,
      returnByValue: options.returnMode !== 'handle',
      silent: true,
      generatePreview: false,
    });
    return this.#result(result.result, retained.realm, result.exceptionDetails);
  }

  async releaseHandles(ids?: string[]) {
    let released = 0;
    for (const id of ids ?? [...this.#handles.keys()]) {
      const retained = this.#handles.get(id);
      if (!retained) {
        continue;
      }
      this.#handles.delete(id);
      if (retained.object.objectId) {
        await retained.realm.client
          .send('Runtime.releaseObject', {objectId: retained.object.objectId})
          .catch(() => {
            // Released or expired backend objects need no further cleanup.
          });
      }
      released++;
    }
    return {released, remaining: this.#handles.size};
  }

  async eventListeners(
    page: Page,
    element: ElementHandle<Element>,
    includeAncestors = true,
  ) {
    const frame = element.frame;
    if (!(frame instanceof CdpFrame)) {
      throw new Error('Event listener inspection requires a CDP frame.');
    }
    const targetId = this.#targetId(page.target());
    const realm = await this.#realm({
      targetId,
      frameId: frame._id,
      world: 'main',
    });
    const remote = element.remoteObject();
    if (!remote.objectId) {
      throw new Error('Element handle expired; take a fresh snapshot.');
    }
    const objects = await realm.client.send('Runtime.callFunctionOn', {
      objectId: remote.objectId,
      functionDeclaration: includeAncestors
        ? 'function () { const nodes = [this]; let node = this; while (node) { node = node.parentNode || node.host; if (node) nodes.push(node); } nodes.push(this.ownerDocument.defaultView); return nodes; }'
        : 'function () { return [this]; }',
      objectGroup: 'ghostframe-investigation',
      returnByValue: false,
      generatePreview: false,
    });
    if (!objects.result.objectId) {
      throw new Error('Could not resolve listener targets.');
    }
    const results = [];
    try {
      const nodes = await realm.client.send('Runtime.getProperties', {
        objectId: objects.result.objectId,
        ownProperties: true,
        generatePreview: false,
      });
      for (const node of nodes.result) {
        if (!/^\d+$/.test(node.name) || !node.value?.objectId) {
          continue;
        }
        const listeners = await realm.client.send(
          'DOMDebugger.getEventListeners',
          {objectId: node.value.objectId, depth: 1, pierce: false},
        );
        results.push({
          ancestorIndex: Number(node.name),
          target: this.#retain(node.value, realm),
          listeners: listeners.listeners.map(listener => ({
            type: listener.type,
            useCapture: listener.useCapture,
            passive: listener.passive,
            once: listener.once,
            scriptId: listener.scriptId,
            lineNumber: listener.lineNumber,
            columnNumber: listener.columnNumber,
            handler: listener.handler
              ? this.#retain(listener.handler, realm)
              : undefined,
            originalHandler: listener.originalHandler
              ? this.#retain(listener.originalHandler, realm)
              : undefined,
          })),
        });
      }
    } finally {
      await realm.client
        .send('Runtime.releaseObject', {objectId: objects.result.objectId})
        .catch(() => {
          // Navigation can dispose the temporary listener-target array.
        });
    }
    return {
      targets: results,
      limitations:
        'Debugger is not enabled by this operation. Delegated listeners may be framework dispatchers; application callbacks and engine scopes are not guaranteed to be exposed.',
    };
  }

  async cookies(options: {
    pageId?: number;
    action: 'list' | 'set' | 'remove';
    cookies?: CookieData[];
  }) {
    this.#assertActive();
    const page =
      options.pageId === undefined
        ? this.#selectedPage()
        : this.#pageById(options.pageId);
    const context = page.browserContext();
    if (options.action === 'set') {
      if (!options.cookies?.length) {
        throw new Error('Provide cookies to set.');
      }
      await context.setCookie(...options.cookies);
    } else if (options.action === 'remove') {
      if (!options.cookies?.length) {
        throw new Error('Provide exact cookie name/domain/path to remove.');
      }
      const current = await context.cookies();
      const matches = current.filter(cookie =>
        options.cookies?.some(
          request =>
            request.name === cookie.name &&
            request.domain === cookie.domain &&
            (request.path ?? '/') === cookie.path &&
            JSON.stringify(request.partitionKey) ===
              JSON.stringify(cookie.partitionKey),
        ),
      );
      await context.deleteCookie(...matches);
    }
    return {
      cookies: await context.cookies(),
      scope:
        'Selected page browser context; includes HttpOnly cookies and partition metadata returned by Chrome.',
    };
  }

  async storage(options: StorageQuery) {
    const realm = await this.#realm({...options, world: 'main'});
    if (!realm.frame) {
      throw new Error('Storage inspection requires a page/frame target.');
    }
    const storageKey =
      options.storageKey ??
      (
        await realm.client.send('Storage.getStorageKeyForFrame', {
          frameId: realm.frame._id,
        })
      ).storageKey;
    if (options.kind === 'local' || options.kind === 'session') {
      return {
        storageKey,
        ...(await realm.client.send('DOMStorage.getDOMStorageItems', {
          storageId: {storageKey, isLocalStorage: options.kind === 'local'},
        })),
      };
    }
    if (options.kind === 'indexeddb') {
      if (!options.databaseName) {
        return {
          storageKey,
          ...(await realm.client.send('IndexedDB.requestDatabaseNames', {
            storageKey,
          })),
        };
      }
      if (!options.objectStoreName) {
        return {
          storageKey,
          ...(await realm.client.send('IndexedDB.requestDatabase', {
            storageKey,
            databaseName: options.databaseName,
          })),
        };
      }
      const result = await realm.client.send('IndexedDB.requestData', {
        storageKey,
        databaseName: options.databaseName,
        objectStoreName: options.objectStoreName,
        skipCount: options.skipCount ?? 0,
        pageSize: options.pageSize ?? 100,
      });
      return {
        storageKey,
        hasMore: result.hasMore,
        entries: result.objectStoreDataEntries.map(entry => ({
          key: this.#retain(entry.key, realm),
          primaryKey: this.#retain(entry.primaryKey, realm),
          value: this.#retain(entry.value, realm),
        })),
      };
    }
    if (!options.cacheId) {
      return {
        storageKey,
        ...(await realm.client.send('CacheStorage.requestCacheNames', {
          storageKey,
        })),
      };
    }
    const caches = await realm.client.send('CacheStorage.requestCacheNames', {
      storageKey,
    });
    if (!caches.caches.some(cache => cache.cacheId === options.cacheId)) {
      throw new Error(
        'cacheId does not belong to this storage key. List caches for the selected frame/storageKey first.',
      );
    }
    if (options.requestURL) {
      return {
        storageKey,
        ...(await realm.client.send('CacheStorage.requestCachedResponse', {
          cacheId: options.cacheId,
          requestURL: options.requestURL,
          requestHeaders: [],
        })),
      };
    }
    return {
      storageKey,
      ...(await realm.client.send('CacheStorage.requestEntries', {
        cacheId: options.cacheId,
        skipCount: options.skipCount ?? 0,
        pageSize: options.pageSize ?? 100,
      })),
    };
  }

  isPaused(page: Page): boolean {
    const id = this.#targetIds.get(page.target());
    return id !== undefined && this.#debuggers.get(id)?.paused !== undefined;
  }

  hasDebugger(page: Page): boolean {
    const id = this.#targetIds.get(page.target());
    return id !== undefined && this.#debuggers.has(id);
  }

  hasDebuggerAt(location: RuntimeLocation): boolean {
    if (location.targetId) {
      return this.#debuggers.has(location.targetId);
    }
    return this.hasDebugger(
      location.pageId === undefined
        ? this.#selectedPage()
        : this.#pageById(location.pageId),
    );
  }

  handleHasDebugger(id: string): boolean {
    return this.#debuggers.has(this.#handle(id).realm.targetId);
  }

  prepareHandleTermination(id: string): () => Promise<void> {
    const realm = this.#handle(id).realm;
    // Releasing a remote object must not invalidate cancellation of its action.
    return () => this.#terminateClient(realm.client, realm.targetId);
  }

  async terminate(
    location: RuntimeLocation & {handle?: string},
  ): Promise<void> {
    this.#assertActive();
    if (location.handle) {
      const realm = this.#handle(location.handle).realm;
      await this.#terminateClient(realm.client, realm.targetId);
      return;
    }
    const target = await this.operationTarget(location);
    const page = target.type() === 'page' ? await target.page() : null;
    if (page) {
      const frame = location.frameId
        ? page
            .frames()
            .find(
              frame =>
                frame instanceof CdpFrame && frame._id === location.frameId,
            )
        : page.mainFrame();
      if (!(frame instanceof CdpFrame)) {
        throw new Error('Execution frame is no longer available.');
      }
      // Cancellation must not create or evaluate a realm while JavaScript is paused.
      await this.#terminateClient(frame.client, this.#targetId(target));
      return;
    }
    const client = this.#workerSessions.get(this.#targetId(target));
    if (!client) {
      throw new Error(
        'Worker execution has not started or its target has closed.',
      );
    }
    await this.#terminateClient(client, this.#targetId(target));
  }

  async #terminateClient(
    client: RuntimeClient,
    targetId: string,
  ): Promise<void> {
    const state = this.#debuggers.get(targetId);
    const termination = client.send('Runtime.terminateExecution');
    // V8 cannot finish termination until the paused execution resumes. Send
    // both commands before awaiting either, so cancellation releases the tool.
    if (state?.paused) {
      await Promise.all([termination, client.send('Debugger.resume')]);
      state.paused = undefined;
    } else {
      await termination;
    }
  }

  async operationTarget(
    location: RuntimeLocation & {handle?: string},
  ): Promise<Target> {
    if (location.handle) {
      const target = this.#targets.get(
        this.#handle(location.handle).realm.targetId,
      );
      if (!target) {
        throw new Error('Handle target expired.');
      }
      return target;
    }
    if (location.targetId) {
      await this.listTargets();
      const target = this.#targets.get(location.targetId);
      if (
        !target ||
        /^(chrome-extension|chrome|chrome-untrusted|devtools):/.test(
          target.url(),
        )
      ) {
        throw new Error(
          'Target unavailable; select a website target from list_targets.',
        );
      }
      return target;
    }
    return (
      location.pageId === undefined
        ? this.#selectedPage()
        : this.#pageById(location.pageId)
    ).target();
  }

  async debugger(options: DebuggerCommand) {
    const realm = await this.#realm({...options, world: 'main'});
    let state = this.#debuggers.get(realm.targetId);
    if (options.action === 'start') {
      if (state) {
        throw new Error(
          'Debugger already active; stop it before starting another session.',
        );
      }
      const timeoutMs = Math.min(
        Math.max(options.timeoutMs ?? 60000, 1000),
        300000,
      );
      const scripts = new Map<string, Protocol.Debugger.ScriptParsedEvent>();
      const sources = new Map<
        string,
        Promise<
          Protocol.Debugger.GetScriptSourceResponse | {unavailable: string}
        >
      >();
      let sourceBytes = 0;
      const onScript = (event: Protocol.Debugger.ScriptParsedEvent) => {
        if (scripts.size < 10000) {
          scripts.set(event.scriptId, event);
          sources.set(
            event.scriptId,
            realm.client
              .send('Debugger.getScriptSource', {scriptId: event.scriptId})
              .then(source => {
                const size =
                  Buffer.byteLength(source.scriptSource) +
                  (source.bytecode?.length ?? 0);
                if (sourceBytes + size > 10000000) {
                  return {
                    unavailable:
                      'Source cache byte limit reached (10MB). Fetch source while target is still live.',
                  };
                }
                sourceBytes += size;
                return source;
              })
              .catch(error => ({
                unavailable:
                  error instanceof Error ? error.message : String(error),
              })),
          );
        }
      };
      const onPause = (event: Protocol.Debugger.PausedEvent) => {
        const current = this.#debuggers.get(realm.targetId);
        if (current) {
          current.paused = event;
        }
      };
      const onResume = () => {
        const current = this.#debuggers.get(realm.targetId);
        if (current) {
          current.paused = undefined;
        }
      };
      const timer = setTimeout(() => {
        const current = this.#debuggers.get(realm.targetId);
        if (current) {
          void this.#stop(current).catch(() => {
            // Deadline cleanup also runs after target disconnection.
          });
        }
      }, timeoutMs);
      timer.unref();
      state = {
        realm,
        scripts,
        sources,
        onScript,
        onPause,
        onResume,
        timer,
        deadline: Date.now() + timeoutMs,
        breakpoints: new Map(),
      };
      this.#debuggers.set(realm.targetId, state);
      realm.client.on('Debugger.scriptParsed', onScript);
      realm.client.on('Debugger.paused', onPause);
      realm.client.on('Debugger.resumed', onResume);
      try {
        await realm.client.send('Debugger.enable', {
          maxScriptsCacheSize: 10000000,
        });
        await realm.client.send('Debugger.setPauseOnExceptions', {
          state: 'none',
        });
      } catch (error) {
        await this.#stop(state);
        throw error;
      }
    }
    if (!state) {
      if (options.action === 'status') {
        return {active: false, targetId: realm.targetId};
      }
      throw new Error('Start a scoped debugger session first.');
    }
    if (options.action === 'stop') {
      await this.#stop(state);
      return {active: false, targetId: realm.targetId};
    }
    if (options.action === 'resume') {
      await realm.client.send('Debugger.resume');
      state.paused = undefined;
    }
    if (options.action === 'scripts') {
      return {
        scripts: [...state.scripts.values()],
        limit: 10000,
        sourceCacheByteLimit: 10000000,
        limitations:
          'Only known/uncollected scripts at attachment and scripts parsed afterward are available. Source is eagerly retained up to 10MB during this debugger session; transient earlier code may be lost.',
      };
    }
    if (options.action === 'source') {
      if (!options.scriptId) {
        throw new Error('Provide scriptId from debugger scripts/status.');
      }
      const cached = await state.sources.get(options.scriptId);
      if (cached && !('unavailable' in cached)) {
        return cached;
      }
      return await realm.client
        .send('Debugger.getScriptSource', {scriptId: options.scriptId})
        .catch(
          () =>
            cached ?? {
              unavailable:
                'Source unavailable; script may have been collected or its target destroyed.',
            },
        );
    }
    if (options.action === 'evaluate') {
      if (
        !options.callFrameId ||
        !options.expression ||
        !state.paused?.callFrames.some(
          frame => frame.callFrameId === options.callFrameId,
        )
      ) {
        throw new Error('Provide expression and a current paused callFrameId.');
      }
      const result = await realm.client.send('Debugger.evaluateOnCallFrame', {
        callFrameId: options.callFrameId,
        expression: options.expression,
        objectGroup: 'ghostframe-investigation',
        returnByValue: options.returnMode !== 'handle',
        silent: true,
        generatePreview: false,
        timeout: 1000,
      });
      return this.#result(result.result, realm, result.exceptionDetails);
    }
    if (options.action === 'breakpoint') {
      const id = `breakpoint-${this.#nextBreakpoint++}`;
      if (options.kind === 'source') {
        if (!options.url || options.lineNumber === undefined) {
          throw new Error(
            'Source breakpoints require url and zero-based lineNumber.',
          );
        }
        const result = await realm.client.send('Debugger.setBreakpointByUrl', {
          url: options.url,
          lineNumber: options.lineNumber,
          columnNumber: options.columnNumber,
          condition: options.condition,
        });
        state.breakpoints.set(id, () =>
          realm.client.send('Debugger.removeBreakpoint', {
            breakpointId: result.breakpointId,
          }),
        );
      } else if (options.kind === 'function') {
        if (!options.handle) {
          throw new Error('Function breakpoints require a function handle.');
        }
        const fn = this.#handle(options.handle);
        if (
          fn.realm.client !== realm.client ||
          fn.object.type !== 'function' ||
          !fn.object.objectId
        ) {
          throw new Error(
            'Function must belong to this debugger target/session.',
          );
        }
        const result = await realm.client.send(
          'Debugger.setBreakpointOnFunctionCall',
          {objectId: fn.object.objectId, condition: options.condition},
        );
        state.breakpoints.set(id, () =>
          realm.client.send('Debugger.removeBreakpoint', {
            breakpointId: result.breakpointId,
          }),
        );
      } else if (options.kind === 'xhr') {
        if (options.url === undefined) {
          throw new Error(
            'XHR/fetch breakpoints require a URL substring (empty matches all).',
          );
        }
        const url = options.url;
        await realm.client.send('DOMDebugger.setXHRBreakpoint', {url});
        state.breakpoints.set(id, () =>
          realm.client.send('DOMDebugger.removeXHRBreakpoint', {url}),
        );
      } else if (options.kind === 'event') {
        if (!options.eventName) {
          throw new Error('Event breakpoints require eventName.');
        }
        const eventName = options.eventName;
        await realm.client.send('DOMDebugger.setEventListenerBreakpoint', {
          eventName,
        });
        state.breakpoints.set(id, () =>
          realm.client.send('DOMDebugger.removeEventListenerBreakpoint', {
            eventName,
          }),
        );
      } else {
        throw new Error(
          'Choose source, function, xhr or event breakpoint kind.',
        );
      }
      return {breakpointId: id, targetId: realm.targetId};
    }
    if (options.action === 'remove_breakpoint') {
      const remove = options.breakpointId
        ? state.breakpoints.get(options.breakpointId)
        : undefined;
      if (!remove || !options.breakpointId) {
        throw new Error('Unknown breakpointId.');
      }
      await remove();
      state.breakpoints.delete(options.breakpointId);
    }
    return {
      active: true,
      targetId: realm.targetId,
      deadline: state.deadline,
      breakpoints: [...state.breakpoints.keys()],
      paused: state.paused
        ? {
            reason: state.paused.reason,
            callFrames: state.paused.callFrames.map(frame => ({
              callFrameId: frame.callFrameId,
              functionName: frame.functionName,
              location: frame.location,
              this: this.#retain(frame.this, realm),
              scopes: frame.scopeChain.map(scope => ({
                type: scope.type,
                name: scope.name,
                object: this.#retain(scope.object, realm),
              })),
            })),
          }
        : undefined,
      limitations:
        'Debugger.enable changes runtime behavior and timing. This is an explicit bounded investigation session, not a guarantee of stealth. Trigger actions must return pending operation IDs while paused; regular waiting actions can block.',
    };
  }

  async #stop(state: DebuggerSession): Promise<void> {
    clearTimeout(state.timer);
    this.#debuggers.delete(state.realm.targetId);
    for (const remove of state.breakpoints.values()) {
      await remove().catch(() => {
        // Browser reloads or target shutdown may already remove breakpoints.
      });
    }
    if (state.paused) {
      await state.realm.client.send('Debugger.resume').catch(() => {
        // Resume is unnecessary if the target resumed or disappeared.
      });
    }
    await state.realm.client.send('Debugger.disable').catch(() => {
      // Detached sessions cannot acknowledge disable requests.
    });
    state.realm.client.off('Debugger.scriptParsed', state.onScript);
    state.realm.client.off('Debugger.paused', state.onPause);
    state.realm.client.off('Debugger.resumed', state.onResume);
  }

  async stopDebuggers(): Promise<void> {
    for (const state of this.#debuggers.values()) {
      await this.#stop(state).catch(() => {
        // A destroyed target can no longer hold a browser action paused.
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#browser.off('targetdestroyed', this.#onTargetDestroyed);
    await this.stopDebuggers();
    for (const record of this.#sessions.values()) {
      record.client.off('Runtime.executionContextsCleared', record.onClear);
      record.client.off(
        'Runtime.executionContextDestroyed',
        record.onDestroyed,
      );
      await record.client
        .send('Runtime.releaseObjectGroup', {
          objectGroup: 'ghostframe-investigation',
        })
        .catch(() => {
          // A closed target has already released its remote objects.
        });
      if (record.owned) {
        await record.client.detach().catch(() => {
          // Owned worker sessions may already be detached during shutdown.
        });
      }
    }
    this.#handles.clear();
    this.#targets.clear();
    this.#sessions.clear();
    this.#workerSessions.clear();
    this.#workerRealms.clear();
  }
}
