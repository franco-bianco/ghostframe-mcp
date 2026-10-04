/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {randomUUID} from 'node:crypto';

import type {CDPSession, Page, Protocol} from '../third_party/index.js';

interface Rule {
  interceptionId: string;
  stage: 'request' | 'response';
  status:
    | 'armed'
    | 'paused'
    | 'resolving'
    | 'resolved'
    | 'timed_out'
    | 'cancelled'
    | 'failed';
  deadline: string;
  error?: string;
  releaseAction?: 'continued' | 'fulfilled' | 'aborted';
}

interface BodyRead {
  status: 'reading' | 'complete' | 'truncated' | 'failed' | 'cancelled';
  maxBytes: number;
  bytesRead: number;
  chunks: Buffer[];
  body?: string;
  error?: string;
  stopRequested: boolean;
  acquisition: Promise<string>;
  stream?: string;
  closing?: Promise<void>;
}

interface Entry {
  rule: Rule;
  page: Page;
  client: CDPSession;
  method?: string;
  paused?: Protocol.Fetch.RequestPausedEvent;
  timer?: ReturnType<typeof setTimeout>;
  listener: (event: Protocol.Fetch.RequestPausedEvent) => void;
  onClose: () => void;
  bodyRead?: BodyRead;
  requestReleased?: boolean;
}

export interface InterceptionResolution {
  action: 'continue' | 'fulfill' | 'abort';
  url?: string;
  method?: string;
  postData?: string;
  headers?: string[];
  status?: number;
  body?: string;
  bodyEncoding?: 'utf8' | 'base64';
}

function parseHeaders(headers: string[]): Protocol.Fetch.HeaderEntry[] {
  return headers.map(header => {
    const colon = header.indexOf(':');
    const name = header.slice(0, colon).trim();
    const value = header.slice(colon + 1).trim();
    if (
      colon < 1 ||
      !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) ||
      /[\r\n]/.test(value)
    ) {
      throw new Error(
        'Use headers in Header-Name: value format without line breaks.',
      );
    }
    return {name, value};
  });
}

/** Owns one bounded Fetch session per page without changing Puppeteer's Fetch configuration. */
export class InterceptionController {
  #entries = new Map<string, Entry>();

  isActive(page: Page): boolean {
    return [...this.#entries.values()].some(
      entry =>
        entry.page === page &&
        ['armed', 'paused', 'resolving'].includes(entry.rule.status),
    );
  }

  assertNavigationAllowed(page: Page, allowList?: string): void {
    if (allowList && this.isActive(page)) {
      throw new Error(
        'Navigation allowList and investigate interception cannot run on the same page. Cancel the interception or omit allowList.',
      );
    }
  }

  async arm(
    page: Page,
    options: {
      urlPattern: string;
      stage?: 'request' | 'response';
      method?: string;
      timeout?: number;
    },
  ) {
    if (this.isActive(page)) {
      throw new Error(
        'Only one active interception is allowed per page. Resolve or cancel it first.',
      );
    }
    if (this.#entries.size >= 64) {
      for (const [id, entry] of this.#entries) {
        if (!['armed', 'paused', 'resolving'].includes(entry.rule.status)) {
          this.#entries.delete(id);
          break;
        }
      }
      if (this.#entries.size >= 64) {
        throw new Error('Too many active interceptions. Cancel one first.');
      }
    }
    const client = await page.createCDPSession();
    const timeout = options.timeout ?? 30000;
    const rule: Rule = {
      interceptionId: randomUUID(),
      stage: options.stage ?? 'request',
      status: 'armed',
      deadline: new Date(Date.now() + timeout).toISOString(),
    };
    const listener = (event: Protocol.Fetch.RequestPausedEvent) => {
      void this.#pause(rule.interceptionId, event).catch(async error => {
        rule.error = error instanceof Error ? error.message : String(error);
        rule.status = 'failed';
        await this.#cleanup(rule.interceptionId);
      });
    };
    const onClose = () => {
      rule.status = 'cancelled';
      void this.#cleanup(rule.interceptionId);
    };
    const entry: Entry = {
      rule,
      page,
      client,
      method: options.method?.toUpperCase(),
      listener,
      onClose,
    };
    this.#entries.set(rule.interceptionId, entry);
    client.on('Fetch.requestPaused', listener);
    page.on('close', onClose);
    entry.timer = setTimeout(() => {
      void this.#release(rule.interceptionId, 'timed_out');
    }, timeout);
    entry.timer.unref();
    try {
      await client.send('Fetch.enable', {
        patterns: [
          {
            urlPattern: options.urlPattern,
            requestStage: rule.stage === 'request' ? 'Request' : 'Response',
          },
        ],
      });
    } catch (error) {
      rule.status = 'failed';
      await this.#cleanup(rule.interceptionId);
      throw error;
    }
    return {...rule};
  }

  async #pause(
    id: string,
    event: Protocol.Fetch.RequestPausedEvent,
  ): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry) {
      return;
    }
    if (
      entry.rule.status !== 'armed' ||
      (entry.method && event.request.method.toUpperCase() !== entry.method)
    ) {
      await entry.client.send('Fetch.continueRequest', {
        requestId: event.requestId,
      });
      return;
    }
    entry.paused = event;
    entry.rule.status = 'paused';
  }

  get(id: string) {
    const entry = this.#get(id);
    const event = entry.paused;
    const requestHeaders = event
      ? Object.entries(event.request.headers).map(([name, value]) => ({
          name,
          value: String(value),
        }))
      : undefined;
    return {
      ...entry.rule,
      request: event
        ? {
            ...event.request,
            headers: requestHeaders,
          }
        : undefined,
      response:
        event &&
        (event.responseStatusCode !== undefined ||
          event.responseErrorReason !== undefined)
          ? {
              status: event.responseStatusCode,
              statusText: event.responseStatusText,
              headers: event.responseHeaders,
              errorReason: event.responseErrorReason,
            }
          : undefined,
      frameId: event?.frameId,
      networkId: event?.networkId,
      headerLimitations:
        'Headers reflect Fetch.requestPaused. Chrome can omit Set-Cookie; use passive capture extra-info events for missing network header evidence.',
      bodyRead: entry.bodyRead
        ? this.#bodyState(entry.bodyRead, false)
        : undefined,
    };
  }

  body(id: string, maxBytes = 1048576) {
    const entry = this.#get(id);
    if (entry.bodyRead) {
      return this.#bodyState(entry.bodyRead, true);
    }
    if (
      entry.rule.status !== 'paused' ||
      !entry.paused ||
      entry.paused.responseStatusCode === undefined
    ) {
      throw new Error(
        'Response body requires a request paused at response stage.',
      );
    }
    const capture: BodyRead = {
      status: 'reading',
      maxBytes,
      bytesRead: 0,
      chunks: [],
      stopRequested: false,
      acquisition: entry.client
        .send('Fetch.takeResponseBodyAsStream', {
          requestId: entry.paused.requestId,
        })
        .then(result => result.stream),
    };
    entry.bodyRead = capture;
    // Acquisition and every IO.read run outside the foreground tool promise.
    void this.#readBody(entry, capture);
    return this.#bodyState(capture, true);
  }

  #bodyState(capture: BodyRead, includeBody: boolean) {
    return {
      status: capture.status,
      body: includeBody ? capture.body : undefined,
      bodyEncoding: 'base64',
      bytesRead: capture.bytesRead,
      totalBytes: capture.status === 'complete' ? capture.bytesRead : undefined,
      maxBytes: capture.maxBytes,
      truncated: capture.status === 'truncated',
      error: capture.error,
    };
  }

  async #readBody(entry: Entry, capture: BodyRead): Promise<void> {
    try {
      capture.stream = await capture.acquisition;
      while (!capture.stopRequested) {
        const result = await entry.client.send('IO.read', {
          handle: capture.stream,
          // One additional byte detects overflow without buffering the rest.
          size: Math.min(65536, capture.maxBytes - capture.bytesRead + 1),
        });
        if (capture.stopRequested) {
          break;
        }
        const bytes = Buffer.from(
          result.data,
          result.base64Encoded ? 'base64' : 'utf8',
        );
        const remaining = capture.maxBytes - capture.bytesRead;
        capture.bytesRead += bytes.length;
        capture.chunks.push(bytes.subarray(0, remaining));
        if (bytes.length > remaining) {
          capture.status = 'truncated';
          capture.error =
            'Body exceeded its byte limit. Fulfill a replacement or abort; the consumed original cannot be continued.';
          break;
        }
        if (result.eof) {
          capture.status = 'complete';
          break;
        }
      }
      if (capture.status === 'complete' || capture.status === 'truncated') {
        capture.body = Buffer.concat(capture.chunks).toString('base64');
      }
    } catch (error) {
      if (!capture.stopRequested) {
        capture.status = 'failed';
        capture.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      capture.chunks = [];
      await this.#closeBodyStream(entry, capture);
    }
  }

  async #closeBodyStream(entry: Entry, capture: BodyRead): Promise<void> {
    if (!capture.closing) {
      capture.closing = (async () => {
        try {
          // Wait only for the stream handle, never for an unfinished IO.read.
          const stream = await capture.acquisition;
          await entry.client.send('IO.close', {handle: stream});
        } catch {
          // Acquisition failure, target closure, or an already closed stream
          // requires no further stream cleanup.
        }
      })();
    }
    await capture.closing;
  }

  async #stopBodyRead(entry: Entry): Promise<void> {
    const capture = entry.bodyRead;
    if (!capture) {
      return;
    }
    capture.stopRequested = true;
    if (capture.status === 'reading') {
      capture.status = 'cancelled';
    }
    await this.#closeBodyStream(entry, capture);
  }

  async #fulfillOriginal(entry: Entry): Promise<void> {
    const event = entry.paused;
    const capture = entry.bodyRead;
    if (
      !event ||
      capture?.status !== 'complete' ||
      capture.body === undefined
    ) {
      throw new Error(
        'A complete captured body is required to continue this response.',
      );
    }
    await this.#stopBodyRead(entry);
    await entry.client.send('Fetch.fulfillRequest', {
      requestId: event.requestId,
      responseCode: event.responseStatusCode ?? 200,
      responsePhrase: event.responseStatusText,
      responseHeaders: (event.responseHeaders ?? []).filter(
        header =>
          !/^(content-length|content-encoding|transfer-encoding)$/i.test(
            header.name,
          ),
      ),
      body: capture.body,
    });
    entry.requestReleased = true;
    entry.rule.releaseAction = 'fulfilled';
  }

  async resolve(id: string, options: InterceptionResolution) {
    const entry = this.#get(id);
    const event = entry.paused;
    if (entry.rule.status !== 'paused' || !event) {
      throw new Error(
        'The interception is not paused. Read its state after triggering the action.',
      );
    }
    const headers = options.headers ? parseHeaders(options.headers) : undefined;
    if (
      options.action === 'continue' &&
      entry.rule.stage === 'response' &&
      (options.url ||
        options.method ||
        options.postData !== undefined ||
        headers)
    ) {
      throw new Error(
        'Request mutation requires request stage. Use fulfill to replace a response.',
      );
    }
    if (options.action === 'fulfill' && options.body === undefined) {
      throw new Error(
        'A replacement response requires body, including an empty string for an empty body.',
      );
    }
    if (
      options.action === 'continue' &&
      entry.bodyRead &&
      entry.bodyRead.status !== 'complete'
    ) {
      throw new Error(
        'Body reading has consumed the response. Continue requires a complete body; fulfill a replacement or abort instead.',
      );
    }
    entry.rule.status = 'resolving';
    try {
      if (options.action === 'abort') {
        await this.#stopBodyRead(entry);
        await entry.client.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Aborted',
        });
        entry.requestReleased = true;
        entry.rule.releaseAction = 'aborted';
      } else if (options.action === 'fulfill') {
        await this.#stopBodyRead(entry);
        const originalHeaders =
          headers ??
          (event.responseHeaders ?? []).filter(
            header =>
              !/^(content-length|content-encoding|transfer-encoding)$/i.test(
                header.name,
              ),
          );
        await entry.client.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: options.status ?? event.responseStatusCode ?? 200,
          responseHeaders: originalHeaders,
          body: Buffer.from(
            options.body ?? '',
            options.bodyEncoding === 'base64' ? 'base64' : 'utf8',
          ).toString('base64'),
        });
        entry.requestReleased = true;
        entry.rule.releaseAction = 'fulfilled';
      } else if (entry.bodyRead) {
        await this.#fulfillOriginal(entry);
      } else {
        await entry.client.send('Fetch.continueRequest', {
          requestId: event.requestId,
          url: options.url,
          method: options.method,
          headers,
          postData:
            options.postData === undefined
              ? undefined
              : Buffer.from(options.postData).toString('base64'),
        });
        entry.requestReleased = true;
        entry.rule.releaseAction = 'continued';
      }
      entry.rule.status = 'resolved';
    } catch (error) {
      entry.rule.status = 'failed';
      entry.rule.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await this.#cleanup(id);
    }
    return this.get(id);
  }

  async cancel(id: string) {
    await this.#release(id, 'cancelled');
    return this.get(id);
  }

  async #release(id: string, status: 'cancelled' | 'timed_out'): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry) {
      return;
    }
    if (!['armed', 'paused'].includes(entry.rule.status)) {
      return;
    }
    entry.rule.status = status;
    try {
      if (entry.paused) {
        if (entry.bodyRead?.status === 'complete') {
          await this.#fulfillOriginal(entry);
        } else if (entry.bodyRead) {
          await this.#stopBodyRead(entry);
          await entry.client.send('Fetch.failRequest', {
            requestId: entry.paused.requestId,
            errorReason: 'Aborted',
          });
          entry.requestReleased = true;
          entry.rule.releaseAction = 'aborted';
          entry.rule.error =
            'The consumed response body is incomplete. Cancellation or expiry aborted the request instead of continuing partial data.';
        } else {
          await entry.client.send('Fetch.continueRequest', {
            requestId: entry.paused.requestId,
          });
          entry.requestReleased = true;
          entry.rule.releaseAction = 'continued';
        }
      }
    } catch (error) {
      entry.rule.error = error instanceof Error ? error.message : String(error);
    } finally {
      await this.#cleanup(id);
    }
  }

  async #cleanup(id: string): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    entry.client.off('Fetch.requestPaused', entry.listener);
    entry.page.off('close', entry.onClose);
    await this.#stopBodyRead(entry);
    if (entry.bodyRead && entry.paused && !entry.requestReleased) {
      await entry.client
        .send('Fetch.failRequest', {
          requestId: entry.paused.requestId,
          errorReason: 'Aborted',
        })
        .catch(() => {
          // A closed target or a previous resolution can already release it.
        });
    }
    await entry.client.send('Fetch.disable').catch(() => {
      // A closed page or disconnected session has already released its pauses.
    });
    await entry.client.detach().catch(() => {
      // Session detachment can race page closure.
    });
  }

  #get(id: string): Entry {
    const entry = this.#entries.get(id);
    if (!entry) {
      throw new Error(
        'Unknown interception ID. Completed interceptions can be evicted after 64 rules.',
      );
    }
    return entry;
  }

  async dispose(): Promise<void> {
    for (const id of this.#entries.keys()) {
      await this.#release(id, 'cancelled');
    }
    this.#entries.clear();
  }
}
