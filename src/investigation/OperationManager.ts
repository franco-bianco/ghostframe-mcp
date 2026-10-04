/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {randomUUID} from 'node:crypto';

import type {Page, Target} from '../third_party/index.js';

interface Operation {
  operationId: string;
  action: string;
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
  startedAt: string;
  deadline: string;
  executionMayContinue: boolean;
  result?: unknown;
  error?: string;
}

interface Entry {
  operation: Operation;
  target: Target;
  timer: ReturnType<typeof setTimeout>;
  cancel: () => Promise<void>;
}

/** Keeps browser actions out of the MCP tool mutex while they are paused. */
export class OperationManager {
  #entries = new Map<string, Entry>();
  #disposed = false;

  assertAvailable(page: Page | Target): void {
    const target = 'target' in page ? page.target() : page;
    for (const {operation, target: owner} of this.#entries.values()) {
      if (owner === target && operation.executionMayContinue) {
        throw new Error(
          `Page has an unfinished action (${operation.operationId}). Use get_operation, debugger_control or resolve_interception first.`,
        );
      }
    }
  }

  start(
    page: Page | Target,
    action: string,
    run: () => Promise<unknown>,
    cancel: () => Promise<void>,
    timeout = 30000,
  ): Operation {
    if (this.#disposed) {
      throw new Error('Operation manager is disposed.');
    }
    this.assertAvailable(page);
    if (this.#entries.size >= 128) {
      for (const [id, entry] of this.#entries) {
        if (!entry.operation.executionMayContinue) {
          this.#entries.delete(id);
          break;
        }
      }
      if (this.#entries.size >= 128) {
        throw new Error(
          'Too many unfinished actions. Cancel an operation first.',
        );
      }
    }
    const operation: Operation = {
      operationId: randomUUID(),
      action,
      status: 'running',
      startedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + timeout).toISOString(),
      executionMayContinue: true,
    };
    const timer = setTimeout(() => {
      if (operation.status === 'running') {
        operation.status = 'timed_out';
        operation.error =
          'The observation deadline expired. The browser action can still be running. Cancel explicitly or release its pause.';
      }
    }, timeout);
    timer.unref();
    const target = 'target' in page ? page.target() : page;
    this.#entries.set(operation.operationId, {
      operation,
      target,
      timer,
      cancel,
    });
    void Promise.resolve()
      .then(run)
      .then(
        result => {
          operation.executionMayContinue = false;
          operation.result = result;
          if (operation.status === 'running') {
            operation.status = 'completed';
          }
          clearTimeout(timer);
        },
        error => {
          operation.executionMayContinue = false;
          operation.error =
            error instanceof Error ? error.message : String(error);
          if (operation.status === 'running') {
            operation.status = 'failed';
          }
          clearTimeout(timer);
        },
      );
    return {...operation};
  }

  get(id: string): Operation {
    return {...this.#get(id).operation};
  }

  async cancel(id: string): Promise<Operation> {
    const entry = this.#get(id);
    if (entry.operation.executionMayContinue) {
      await entry.cancel();
      entry.operation.status = 'cancelled';
      clearTimeout(entry.timer);
    }
    return this.get(id);
  }

  #get(id: string): Entry {
    const entry = this.#entries.get(id);
    if (!entry) {
      throw new Error(
        'Unknown operation ID. Completed operations can be evicted after 128 actions.',
      );
    }
    return entry;
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    const cancellations: Array<Promise<void>> = [];
    for (const entry of this.#entries.values()) {
      clearTimeout(entry.timer);
      if (entry.operation.executionMayContinue) {
        cancellations.push(entry.cancel());
      }
    }
    await Promise.allSettled(cancellations);
    this.#entries.clear();
  }
}
