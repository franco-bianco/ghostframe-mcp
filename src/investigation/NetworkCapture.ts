/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {CdpFrame} from '../third_party/index.js';
import type {Browser, Page, Protocol, Target} from '../third_party/index.js';

export interface CaptureOptions {
  directory?: string;
  page?: Page;
  maxBodyBytes?: number;
  maxTotalBytes?: number;
  streaming?: boolean;
}

export interface CaptureFilters {
  url?: string;
  method?: string;
  kind?: string;
}

export interface NetworkWaitOptions {
  page?: Page;
  url?: string;
  method?: string;
  phase?: 'request' | 'response' | 'finished';
  timeout?: number;
}

interface CaptureState {
  id: string;
  directory: string;
  page?: Page;
  active: boolean;
  streaming: boolean;
  maxBodyBytes: number;
  maxTotalBytes: number;
  totalBytes: number;
  records: number;
  nextRequestId: number;
  nextBodyId: number;
  requestIds: Map<string, number>;
  pending: Set<Promise<void>>;
  writes: Promise<void>;
  quotaReported: boolean;
  error?: string;
}

interface PageSubscription {
  session: PassiveClient;
  sessionId: string;
  targetId?: string;
  cleanup: Array<() => void>;
  hops: Map<string, number>;
  requests: Map<string, {url: string; method: string; frameId?: string}>;
  streamingRequests: Set<string>;
  streamingSupported?: boolean;
}

interface NetworkObservation {
  observationId: string;
  status: 'pending' | 'matched' | 'timed_out' | 'cancelled';
  options: NetworkWaitOptions;
  timer: ReturnType<typeof setTimeout>;
  match?: Record<string, unknown>;
}

type PassiveClient = CdpFrame['client'];

function primarySession(page: Page): PassiveClient {
  const frame = page.mainFrame();
  if (!(frame instanceof CdpFrame)) {
    throw new Error('Passive capture requires a CDP page.');
  }
  return frame.client;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Passive, file-backed evidence collection. Never enables Runtime or Debugger. */
export class NetworkCapture {
  #browser: Browser;
  #pageId: (page: Page) => number | undefined;
  #validatePath: (path?: string) => Promise<void>;
  #captures = new Map<string, CaptureState>();
  #pages = new Map<Page, PageSubscription>();
  #observations = new Map<string, NetworkObservation>();
  #nextCaptureId = 1;
  #nextObservationId = 1;
  #nextActionId = 1;
  #nextMessageId = 1;
  #disposed = false;

  constructor(
    browser: Browser,
    pageId: (page: Page) => number | undefined,
    validatePath: (path?: string) => Promise<void>,
  ) {
    this.#browser = browser;
    this.#pageId = pageId;
    this.#validatePath = validatePath;
    browser.on('targetcreated', this.#targetCreated);
  }

  #targetCreated = async (target: Target): Promise<void> => {
    if (!this.#hasActivity()) {
      return;
    }
    try {
      const page = await target.page();
      if (page && !this.#disposed && this.#hasActivity()) {
        this.addPage(page);
      } else if (!page) {
        this.#all({
          kind: 'coverage_gap',
          reason: 'non_page_target_not_attached',
          targetType: target.type(),
        });
      }
    } catch (error) {
      this.#all({
        kind: 'coverage_gap',
        reason: 'target_attachment_failed',
        error: String(error),
      });
    }
  };

  #hasActivity(): boolean {
    return (
      [...this.#captures.values()].some(capture => capture.active) ||
      [...this.#observations.values()].some(
        observation => observation.status === 'pending',
      )
    );
  }

  async start(
    options: CaptureOptions = {},
  ): Promise<{captureId: string; directory: string}> {
    if (this.#disposed) {
      throw new Error('Network capture has been disposed.');
    }
    await this.#validatePath(options.directory);
    const directory = options.directory
      ? await mkdtemp(
          join(await this.#prepareDirectory(options.directory), 'capture-'),
        )
      : await mkdtemp(join(tmpdir(), 'ghostframe-capture-'));
    const id = `capture-${this.#nextCaptureId++}`;
    const capture: CaptureState = {
      id,
      directory,
      page: options.page,
      active: true,
      streaming: options.streaming ?? false,
      maxBodyBytes: options.maxBodyBytes ?? 5 * 1024 * 1024,
      maxTotalBytes: options.maxTotalBytes ?? 100 * 1024 * 1024,
      totalBytes: 0,
      records: 0,
      nextRequestId: 1,
      nextBodyId: 1,
      requestIds: new Map(),
      pending: new Set(),
      writes: Promise.resolve(),
      quotaReported: false,
    };
    if (capture.maxBodyBytes < 0 || capture.maxTotalBytes <= 0) {
      throw new Error(
        'Capture byte limits must be nonnegative; total limit must be positive.',
      );
    }
    await mkdir(join(directory, 'bodies'));
    await writeFile(join(directory, 'events.jsonl'), '', {flag: 'wx'});
    this.#captures.set(id, capture);
    this.#append(capture, {
      kind: 'capture_started',
      captureId: id,
      maxBodyBytes: capture.maxBodyBytes,
      maxTotalBytes: capture.maxTotalBytes,
      coverage:
        'page primary sessions only; out-of-process frames, independent workers and browser background traffic may be absent',
      bodyRepresentation:
        'CDP decoded bodies; multipart file data may be unavailable',
      headerRepresentation:
        'CDP header maps; duplicates may be combined; wire order unavailable',
      streaming: capture.streaming,
      startedLate: true,
    });
    const pages = options.page ? [options.page] : await this.#browser.pages();
    for (const page of pages) {
      this.addPage(page);
    }
    await capture.writes;
    return {captureId: id, directory};
  }

  async #prepareDirectory(directory: string): Promise<string> {
    const path = resolve(directory);
    await mkdir(path, {recursive: true});
    return path;
  }

  addPage(page: Page): void {
    if (this.#disposed || this.#pages.has(page) || !this.#hasActivity()) {
      return;
    }
    const session = primarySession(page);
    const subscription: PageSubscription = {
      session,
      sessionId: session.id(),
      cleanup: [],
      hops: new Map(),
      requests: new Map(),
      streamingRequests: new Set(),
    };
    this.#pages.set(page, subscription);
    const listen = <K extends keyof ProtocolMapping>(
      event: K,
      handler: (value: ProtocolMapping[K]) => void,
    ): void => {
      session.on(event, handler);
      subscription.cleanup.push(() => session.off(event, handler));
    };
    listen('Network.requestWillBeSent', event => {
      if (event.redirectResponse) {
        this.#emit(
          page,
          subscription,
          event.requestId,
          {
            kind: 'redirect_response',
            cdpRequestId: event.requestId,
            hop: subscription.hops.get(event.requestId),
            url: event.redirectResponse.url,
            status: event.redirectResponse.status,
            timestamp: event.timestamp,
            protocol: event.redirectResponse.protocol,
            bodyStatus: 'unavailable_redirect',
            headersSource: 'redirectResponse',
          },
          event.redirectResponse.headers,
        );
      }
      const hop = (subscription.hops.get(event.requestId) ?? -1) + 1;
      subscription.hops.set(event.requestId, hop);
      subscription.requests.set(event.requestId, {
        url: event.request.url,
        method: event.request.method,
        frameId: event.frameId,
      });
      const record = {
        kind: 'request',
        cdpRequestId: event.requestId,
        hop,
        url: event.request.url,
        method: event.request.method,
        frameId: event.frameId,
        loaderId: event.loaderId,
        timestamp: event.timestamp,
        wallTime: event.wallTime,
        resourceType: event.type,
        initiator: event.initiator,
        hasUserGesture: event.hasUserGesture,
        redirectResponse: event.redirectResponse
          ? {
              url: event.redirectResponse.url,
              status: event.redirectResponse.status,
              protocol: event.redirectResponse.protocol,
            }
          : undefined,
        redirectHasExtraInfo: event.redirectHasExtraInfo,
        headersSource: 'requestWillBeSent',
        hasPostData: event.request.hasPostData,
      };
      this.#emit(
        page,
        subscription,
        event.requestId,
        record,
        event.request.headers,
      );
      this.#match(page, 'request', record);
      const entries = event.request.postDataEntries;
      if (entries && entries.every(entry => entry.bytes !== undefined)) {
        const bytes = entries.map(entry =>
          Buffer.from(entry.bytes ?? '', 'base64'),
        );
        this.#body(
          page,
          subscription,
          event.requestId,
          'request_body',
          Buffer.concat(bytes),
        );
      } else if (event.request.postData !== undefined) {
        this.#body(
          page,
          subscription,
          event.requestId,
          'request_body',
          Buffer.from(event.request.postData),
        );
      } else if (event.request.hasPostData) {
        const key = this.#key(subscription, event.requestId);
        this.#taskForPage(page, capture =>
          this.#fetchBody(
            capture,
            subscription,
            event.requestId,
            key,
            'request_body',
          ),
        );
      }
    });
    listen('Network.requestWillBeSentExtraInfo', event => {
      // Preserve unpaired events: redirect extra-info ordering cannot be inferred from arrival order.
      this.#emit(
        page,
        subscription,
        undefined,
        {
          kind: 'request_extra_info',
          cdpRequestId: event.requestId,
          hopAssociation:
            'unresolved; join using companion events and redirectHasExtraInfo',
          connectTiming: event.connectTiming,
          associatedCookies: event.associatedCookies.map(cookie => ({
            name: cookie.cookie.name,
            domain: cookie.cookie.domain,
            path: cookie.cookie.path,
            blockedReasons: cookie.blockedReasons,
            exemptionReason: cookie.exemptionReason,
          })),
        },
        event.headers,
      );
    });
    listen('Network.responseReceived', event => {
      const request = subscription.requests.get(event.requestId);
      const record = {
        kind: 'response',
        cdpRequestId: event.requestId,
        url: event.response.url,
        method: request?.method,
        timestamp: event.timestamp,
        frameId: event.frameId,
        status: event.response.status,
        mimeType: event.response.mimeType,
        protocol: event.response.protocol,
        timing: event.response.timing,
        remoteIPAddress: event.response.remoteIPAddress,
        remotePort: event.response.remotePort,
        connectionId: event.response.connectionId,
        connectionReused: event.response.connectionReused,
        fromDiskCache: event.response.fromDiskCache,
        fromServiceWorker: event.response.fromServiceWorker,
        hasExtraInfo: event.hasExtraInfo,
        headersSource: 'responseReceived',
      };
      this.#emit(
        page,
        subscription,
        event.requestId,
        record,
        event.response.headers,
      );
      this.#match(page, 'response', record);
      if (
        this.#capturesForPage(page).some(capture => capture.streaming) &&
        (event.type === 'Fetch' || event.type === 'EventSource')
      ) {
        this.#startStream(page, subscription, event.requestId);
      }
    });
    listen('Network.responseReceivedExtraInfo', event => {
      this.#emit(
        page,
        subscription,
        undefined,
        {
          kind: 'response_extra_info',
          cdpRequestId: event.requestId,
          hopAssociation:
            'unresolved; extra-info can arrive before or after response',
          status: event.statusCode,
          blockedCookies: event.blockedCookies.map(cookie => ({
            blockedReasons: cookie.blockedReasons,
            name: cookie.cookie?.name,
          })),
          cookiePartitionKey: event.cookiePartitionKey,
          // Preserve raw HTTP/1 header text when Chrome provides it.
        },
        event.headers,
        event.headersText,
      );
    });
    listen('Network.loadingFinished', event => {
      const request = subscription.requests.get(event.requestId);
      const record = {
        kind: 'finished',
        cdpRequestId: event.requestId,
        timestamp: event.timestamp,
        encodedDataLength: event.encodedDataLength,
        ...request,
      };
      this.#emit(page, subscription, event.requestId, record);
      this.#match(page, 'finished', record);
      const key = this.#key(subscription, event.requestId);
      this.#taskForPage(page, capture =>
        this.#fetchBody(
          capture,
          subscription,
          event.requestId,
          key,
          'response_body',
        ),
      );
      subscription.streamingRequests.delete(event.requestId);
      subscription.requests.delete(event.requestId);
      subscription.hops.delete(event.requestId);
    });
    listen('Network.loadingFailed', event => {
      this.#emit(page, subscription, event.requestId, {
        kind: 'failed',
        cdpRequestId: event.requestId,
        timestamp: event.timestamp,
        errorText: event.errorText,
        blockedReason: event.blockedReason,
        corsErrorStatus: event.corsErrorStatus,
        ...subscription.requests.get(event.requestId),
      });
      subscription.streamingRequests.delete(event.requestId);
      subscription.requests.delete(event.requestId);
      subscription.hops.delete(event.requestId);
    });
    listen('Network.webSocketCreated', event => {
      subscription.hops.set(event.requestId, 0);
      subscription.requests.set(event.requestId, {
        url: event.url,
        method: 'GET',
      });
      this.#emit(page, subscription, event.requestId, {
        kind: 'websocket_created',
        cdpRequestId: event.requestId,
        url: event.url,
        initiator: event.initiator,
      });
    });
    listen('Network.webSocketWillSendHandshakeRequest', event => {
      this.#emit(
        page,
        subscription,
        event.requestId,
        {
          kind: 'websocket_request',
          cdpRequestId: event.requestId,
          timestamp: event.timestamp,
          wallTime: event.wallTime,
        },
        event.request.headers,
      );
    });
    listen('Network.webSocketHandshakeResponseReceived', event => {
      this.#emit(
        page,
        subscription,
        event.requestId,
        {
          kind: 'websocket_response',
          cdpRequestId: event.requestId,
          timestamp: event.timestamp,
          status: event.response.status,
        },
        event.response.headers,
        event.response.headersText,
      );
    });
    const frameEvents: Array<
      'Network.webSocketFrameReceived' | 'Network.webSocketFrameSent'
    > = ['Network.webSocketFrameReceived', 'Network.webSocketFrameSent'];
    for (const eventName of frameEvents) {
      const handler = (
        event: Protocol.Network.WebSocketFrameReceivedEvent,
      ): void => {
        const messageId = this.#nextMessageId++;
        const direction = eventName.endsWith('Sent') ? 'sent' : 'received';
        this.#emit(page, subscription, event.requestId, {
          kind: 'websocket_message',
          messageId,
          cdpRequestId: event.requestId,
          timestamp: event.timestamp,
          direction,
          opcode: event.response.opcode,
        });
        this.#body(
          page,
          subscription,
          event.requestId,
          'websocket_payload',
          Buffer.from(
            event.response.payloadData,
            event.response.opcode === 1 ? 'utf8' : 'base64',
          ),
          false,
          {messageId, direction},
        );
      };
      session.on(eventName, handler);
      subscription.cleanup.push(() => session.off(eventName, handler));
    }
    listen('Network.webSocketClosed', event =>
      this.#emit(page, subscription, event.requestId, {
        kind: 'websocket_closed',
        cdpRequestId: event.requestId,
        timestamp: event.timestamp,
      }),
    );
    listen('Network.webSocketFrameError', event =>
      this.#emit(page, subscription, event.requestId, {
        kind: 'websocket_error',
        cdpRequestId: event.requestId,
        timestamp: event.timestamp,
        error: event.errorMessage,
      }),
    );
    listen('Network.eventSourceMessageReceived', event => {
      const messageId = this.#nextMessageId++;
      this.#emit(page, subscription, event.requestId, {
        kind: 'eventsource_message',
        messageId,
        cdpRequestId: event.requestId,
        timestamp: event.timestamp,
        eventName: event.eventName,
        eventId: event.eventId,
      });
      this.#body(
        page,
        subscription,
        event.requestId,
        'eventsource_payload',
        Buffer.from(event.data),
        false,
        {messageId},
      );
    });
    listen('Network.dataReceived', event => {
      if (event.data && subscription.streamingRequests.has(event.requestId)) {
        this.#body(
          page,
          subscription,
          event.requestId,
          'stream_chunk',
          Buffer.from(event.data, 'base64'),
          true,
          {timestamp: event.timestamp},
        );
      }
    });
    const close = (): void => {
      this.#emit(page, subscription, undefined, {kind: 'page_closed'});
      for (const cleanup of subscription.cleanup) {
        cleanup();
      }
      this.#pages.delete(page);
      for (const observation of this.#observations.values()) {
        if (
          observation.status === 'pending' &&
          observation.options.page === page
        ) {
          observation.status = 'cancelled';
          clearTimeout(observation.timer);
        }
      }
    };
    page.on('close', close);
    subscription.cleanup.push(() => page.off('close', close));
    void session
      .send('Target.getTargetInfo')
      .then(result => {
        subscription.targetId = result.targetInfo.targetId;
        this.#emit(page, subscription, undefined, {
          kind: 'page_attached',
          startedLate: true,
        });
      })
      .catch(error =>
        this.#emit(page, subscription, undefined, {
          kind: 'coverage_gap',
          reason: 'target_identity_unavailable',
          error: String(error),
        }),
      );
  }

  #key(subscription: PageSubscription, requestId: string): string {
    return `${subscription.sessionId}:${requestId}:${subscription.hops.get(requestId) ?? 0}`;
  }

  #requestId(capture: CaptureState, key: string): number {
    const existing = capture.requestIds.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = capture.nextRequestId++;
    capture.requestIds.set(key, id);
    return id;
  }

  #capturesForPage(page: Page): CaptureState[] {
    return [...this.#captures.values()].filter(
      capture =>
        capture.active &&
        !capture.quotaReported &&
        (!capture.page || capture.page === page),
    );
  }

  #emit(
    page: Page,
    subscription: PageSubscription,
    requestId: string | undefined,
    record: Record<string, unknown>,
    headers?: Protocol.Network.Headers,
    headersText?: string,
  ): void {
    for (const capture of this.#capturesForPage(page)) {
      const headerEntries = headers
        ? Object.entries(headers).map(([name, value]) => ({
            name,
            value: String(value),
          }))
        : undefined;
      this.#append(capture, {
        ...record,
        captureId: capture.id,
        pageId: this.#pageId(page),
        targetId: subscription.targetId,
        sessionId: subscription.sessionId,
        requestId: requestId
          ? this.#requestId(capture, this.#key(subscription, requestId))
          : undefined,
        headers: headerEntries,
        headersText,
      });
    }
  }

  #append(
    capture: CaptureState,
    record: Record<string, unknown>,
    force = false,
  ): void {
    const line =
      JSON.stringify({
        sequence: capture.records,
        recordedAt: new Date().toISOString(),
        ...record,
      }) + '\n';
    const bytes = Buffer.byteLength(line);
    if (!force && capture.totalBytes + bytes > capture.maxTotalBytes) {
      if (!capture.quotaReported) {
        capture.quotaReported = true;
        this.#append(
          capture,
          {kind: 'coverage_gap', reason: 'capture_byte_limit_exceeded'},
          true,
        );
      }
      return;
    }
    capture.totalBytes += bytes;
    capture.records++;
    capture.writes = capture.writes
      .then(() => appendFile(join(capture.directory, 'events.jsonl'), line))
      .catch(error => {
        capture.error = String(error);
      });
  }

  #taskForPage(
    page: Page,
    task: (capture: CaptureState) => Promise<void>,
  ): void {
    for (const capture of this.#capturesForPage(page)) {
      const pending = task(capture).catch(error => {
        this.#append(capture, {
          kind: 'coverage_gap',
          reason: 'capture_task_failed',
          error: String(error),
        });
      });
      capture.pending.add(pending);
      void pending.finally(() => capture.pending.delete(pending));
    }
  }

  #body(
    page: Page,
    subscription: PageSubscription,
    requestId: string,
    kind: string,
    bytes: Buffer,
    streamingOnly = false,
    metadata: Record<string, unknown> = {},
  ): void {
    const key = this.#key(subscription, requestId);
    this.#taskForPage(page, capture =>
      streamingOnly && !capture.streaming
        ? Promise.resolve()
        : this.#saveBody(capture, key, kind, bytes, metadata),
    );
  }

  async #saveBody(
    capture: CaptureState,
    key: string,
    kind: string,
    bytes: Buffer,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const requestId = this.#requestId(capture, key);
    if (
      bytes.length > capture.maxBodyBytes ||
      capture.totalBytes + bytes.length > capture.maxTotalBytes
    ) {
      this.#append(capture, {
        kind,
        requestId,
        ...metadata,
        bodyStatus: 'omitted_limit',
        byteLength: bytes.length,
      });
      return;
    }
    capture.totalBytes += bytes.length;
    const filename = join(
      capture.directory,
      'bodies',
      `${requestId}-${kind}-${capture.nextBodyId++}.bin`,
    );
    await writeFile(filename, bytes, {flag: 'wx'});
    this.#append(capture, {
      kind,
      requestId,
      ...metadata,
      bodyStatus: 'saved',
      byteLength: bytes.length,
      bodyFilePath: filename,
    });
  }

  async #fetchBody(
    capture: CaptureState,
    subscription: PageSubscription,
    cdpId: string,
    key: string,
    kind: 'request_body' | 'response_body',
  ): Promise<void> {
    try {
      if (kind === 'request_body') {
        const result = await subscription.session.send(
          'Network.getRequestPostData',
          {requestId: cdpId},
        );
        const encoded =
          'base64Encoded' in result && result.base64Encoded === true;
        await this.#saveBody(
          capture,
          key,
          kind,
          Buffer.from(result.postData, encoded ? 'base64' : 'utf8'),
        );
      } else {
        const result = await subscription.session.send(
          'Network.getResponseBody',
          {requestId: cdpId},
        );
        await this.#saveBody(
          capture,
          key,
          kind,
          Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8'),
        );
      }
    } catch (error) {
      this.#append(capture, {
        kind,
        requestId: this.#requestId(capture, key),
        bodyStatus: 'unavailable',
        error: String(error),
      });
    }
  }

  #startStream(
    page: Page,
    subscription: PageSubscription,
    cdpId: string,
  ): void {
    if (subscription.streamingSupported === false) {
      this.#emit(page, subscription, cdpId, {
        kind: 'coverage_gap',
        reason: 'streamResourceContent_unsupported',
      });
      return;
    }
    subscription.streamingRequests.add(cdpId);
    const key = this.#key(subscription, cdpId);
    const captures = this.#capturesForPage(page).filter(
      capture => capture.streaming,
    );
    const task = subscription.session
      .send('Network.streamResourceContent', {requestId: cdpId})
      .then(async result => {
        subscription.streamingSupported = true;
        for (const capture of captures) {
          await this.#saveBody(
            capture,
            key,
            'stream_buffered',
            Buffer.from(result.bufferedData, 'base64'),
          );
        }
      })
      .catch(error => {
        const message = String(error);
        if (
          message.includes("wasn't found") ||
          message.includes('Method not found')
        ) {
          subscription.streamingSupported = false;
        }
        subscription.streamingRequests.delete(cdpId);
        for (const capture of captures) {
          this.#append(capture, {
            kind: 'coverage_gap',
            reason: 'streamResourceContent_failed',
            cdpRequestId: cdpId,
            error: message,
          });
        }
      });
    for (const capture of captures) {
      capture.pending.add(task);
      void task.finally(() => capture.pending.delete(task));
    }
  }

  #all(record: Record<string, unknown>): void {
    for (const capture of this.#captures.values()) {
      if (capture.active) {
        this.#append(capture, record);
      }
    }
  }

  markAction(action: {
    tool: string;
    phase: 'start' | 'end';
    pageId?: number;
    actionId?: number;
  }): number {
    const actionId = action.actionId ?? this.#nextActionId++;
    for (const capture of this.#captures.values()) {
      if (
        capture.active &&
        (!capture.page || action.pageId === this.#pageId(capture.page))
      ) {
        this.#append(capture, {
          kind: 'action',
          ...action,
          actionId,
          association: 'temporal; no causal claim',
        });
      }
    }
    return actionId;
  }

  async armNetworkWait(
    options: NetworkWaitOptions = {},
  ): Promise<{observationId: string}> {
    if (this.#disposed) {
      throw new Error('Network capture has been disposed.');
    }
    const observationId = `observation-${this.#nextObservationId++}`;
    const timeout = options.timeout ?? 30000;
    const observation: NetworkObservation = {
      observationId,
      status: 'pending',
      options,
      timer: setTimeout(() => {
        observation.status = 'timed_out';
        this.#cleanupIdlePages();
      }, timeout),
    };
    observation.timer.unref();
    this.#observations.set(observationId, observation);
    const pages = options.page ? [options.page] : await this.#browser.pages();
    for (const page of pages) {
      this.addPage(page);
    }
    return {observationId};
  }

  #match(
    page: Page,
    phase: 'request' | 'response' | 'finished',
    record: Record<string, unknown>,
  ): void {
    for (const observation of this.#observations.values()) {
      const options = observation.options;
      if (
        observation.status !== 'pending' ||
        (options.page && options.page !== page) ||
        (options.phase ?? 'response') !== phase ||
        (options.url &&
          (typeof record.url !== 'string' ||
            !record.url.includes(options.url))) ||
        (options.method && options.method.toUpperCase() !== record.method)
      ) {
        continue;
      }
      observation.status = 'matched';
      observation.match = {...record, pageId: this.#pageId(page)};
      clearTimeout(observation.timer);
    }
    this.#cleanupIdlePages();
  }

  getNetworkWait(observationId: string): {
    observationId: string;
    status: string;
    match?: Record<string, unknown>;
  } {
    const observation = this.#observations.get(observationId);
    if (!observation) {
      throw new Error(`Unknown network observation ${observationId}`);
    }
    return {
      observationId,
      status: observation.status,
      match: observation.match ? structuredClone(observation.match) : undefined,
    };
  }

  async stop(captureId: string): Promise<{
    captureId: string;
    directory: string;
    records: number;
    totalBytes: number;
    error?: string;
  }> {
    const capture = this.#get(captureId);
    if (capture.active) {
      capture.active = false;
      await Promise.allSettled([...capture.pending]);
      this.#append(capture, {kind: 'capture_stopped'}, true);
    }
    await capture.writes;
    this.#cleanupIdlePages();
    return {
      captureId,
      directory: capture.directory,
      records: capture.records,
      totalBytes: capture.totalBytes,
      error: capture.error,
    };
  }

  #get(captureId: string): CaptureState {
    const capture = this.#captures.get(captureId);
    if (!capture) {
      throw new Error(`Unknown capture ${captureId}`);
    }
    return capture;
  }

  async read(
    captureId: string,
    cursor = 0,
    limit = 100,
    filters: CaptureFilters = {},
  ): Promise<{
    records: Array<Record<string, unknown>>;
    nextCursor: number;
    active: boolean;
    directory: string;
    error?: string;
  }> {
    const capture = this.#get(captureId);
    if (
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new Error(
        'Cursor must be nonnegative and limit must be between 1 and 1000.',
      );
    }
    await capture.writes;
    const lines = (
      await readFile(join(capture.directory, 'events.jsonl'), 'utf8')
    )
      .split('\n')
      .filter(Boolean);
    const records: Array<Record<string, unknown>> = [];
    let nextCursor = cursor;
    for (
      let index = cursor;
      index < lines.length && records.length < limit;
      index++
    ) {
      nextCursor = index + 1;
      const value: unknown = JSON.parse(lines[index]);
      if (
        !isRecord(value) ||
        (filters.url &&
          (typeof value.url !== 'string' ||
            !value.url.includes(filters.url))) ||
        (filters.method && value.method !== filters.method.toUpperCase()) ||
        (filters.kind && value.kind !== filters.kind)
      ) {
        continue;
      }
      records.push(value);
    }
    return {
      records,
      nextCursor,
      active: capture.active,
      directory: capture.directory,
      error: capture.error,
    };
  }

  #cleanupIdlePages(): void {
    if (this.#hasActivity()) {
      return;
    }
    for (const subscription of this.#pages.values()) {
      for (const cleanup of subscription.cleanup) {
        cleanup();
      }
    }
    this.#pages.clear();
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#browser.off('targetcreated', this.#targetCreated);
    for (const observation of this.#observations.values()) {
      if (observation.status === 'pending') {
        observation.status = 'cancelled';
      }
      clearTimeout(observation.timer);
    }
    for (const capture of this.#captures.values()) {
      await this.stop(capture.id);
    }
    this.#cleanupIdlePages();
  }
}

interface ProtocolMapping {
  'Network.requestWillBeSent': Protocol.Network.RequestWillBeSentEvent;
  'Network.requestWillBeSentExtraInfo': Protocol.Network.RequestWillBeSentExtraInfoEvent;
  'Network.responseReceived': Protocol.Network.ResponseReceivedEvent;
  'Network.responseReceivedExtraInfo': Protocol.Network.ResponseReceivedExtraInfoEvent;
  'Network.loadingFinished': Protocol.Network.LoadingFinishedEvent;
  'Network.loadingFailed': Protocol.Network.LoadingFailedEvent;
  'Network.webSocketCreated': Protocol.Network.WebSocketCreatedEvent;
  'Network.webSocketWillSendHandshakeRequest': Protocol.Network.WebSocketWillSendHandshakeRequestEvent;
  'Network.webSocketHandshakeResponseReceived': Protocol.Network.WebSocketHandshakeResponseReceivedEvent;
  'Network.webSocketClosed': Protocol.Network.WebSocketClosedEvent;
  'Network.webSocketFrameError': Protocol.Network.WebSocketFrameErrorEvent;
  'Network.eventSourceMessageReceived': Protocol.Network.EventSourceMessageReceivedEvent;
  'Network.dataReceived': Protocol.Network.DataReceivedEvent;
}
