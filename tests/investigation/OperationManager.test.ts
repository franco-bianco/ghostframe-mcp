/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {setTimeout} from 'node:timers/promises';

import {OperationManager} from '../../src/investigation/OperationManager.js';
import {withBrowser} from '../utils.js';

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred fixture was not initialized.');
  };
  let reject: (reason: Error) => void = () => {
    throw new Error('Deferred fixture was not initialized.');
  };
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return {promise, resolve, reject};
}

describe('operation lifecycle', () => {
  it('distinguishes observation expiry from browser completion and locks the canonical target', async () => {
    await withBrowser(async (_browser, page) => {
      const manager = new OperationManager();
      const action = deferred<number>();
      try {
        const operation = manager.start(
          page,
          'fixture',
          () => action.promise,
          async () => undefined,
          10,
        );
        assert.throws(
          () => manager.assertAvailable(page.target()),
          /unfinished action/,
        );
        await setTimeout(25);
        assert.equal(manager.get(operation.operationId).status, 'timed_out');
        assert.equal(
          manager.get(operation.operationId).executionMayContinue,
          true,
        );
        assert.throws(() => manager.assertAvailable(page), /unfinished action/);
        action.resolve(42);
        await setTimeout(0);
        const completed = manager.get(operation.operationId);
        assert.equal(completed.status, 'timed_out');
        assert.equal(completed.executionMayContinue, false);
        assert.equal(completed.result, 42);
        manager.assertAvailable(page.target());
      } finally {
        await manager.dispose();
      }
    });
  });

  it('cancels active execution during explicit cancellation and disposal', async () => {
    await withBrowser(async (_browser, page) => {
      const manager = new OperationManager();
      const action = deferred<void>();
      const operation = manager.start(
        page.target(),
        'fixture',
        () => action.promise,
        async () => action.reject(new Error('cancelled by fixture')),
      );
      await manager.cancel(operation.operationId);
      await setTimeout(0);
      assert.equal(manager.get(operation.operationId).status, 'cancelled');
      assert.equal(
        manager.get(operation.operationId).executionMayContinue,
        false,
      );
      const next = deferred<void>();
      let cleanupCalled = false;
      manager.start(
        page,
        'cleanup',
        () => next.promise,
        async () => {
          cleanupCalled = true;
          next.resolve();
        },
      );
      await manager.dispose();
      assert.equal(cleanupCalled, true);
      assert.throws(
        () =>
          manager.start(
            page,
            'after disposal',
            async () => undefined,
            async () => undefined,
          ),
        /disposed/,
      );
    });
  });
});
