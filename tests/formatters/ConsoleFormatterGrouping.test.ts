/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ConsoleFormatter} from '../../src/formatters/ConsoleFormatter.js';
import type {ConsoleMessage} from '../../src/third_party/index.js';

const createMockMessage = (
  type: string,
  text: string,
  argsCount = 0,
): ConsoleMessage => {
  const args = Array.from({length: argsCount}, () => ({
    jsonValue: async () => 'val',
    remoteObject: () => ({type: 'string'}),
  }));
  return {
    type: () => type,
    text: () => text,
    args: () => args,
  } as unknown as ConsoleMessage;
};

const makeFormatter = (id: number, type: string, text: string, argsCount = 0) =>
  ConsoleFormatter.from(createMockMessage(type, text, argsCount), {id});

describe('ConsoleFormatter grouping', () => {
  describe('groupConsecutive', () => {
    it('groups identical consecutive messages', async () => {
      const msgs = await Promise.all([
        makeFormatter(1, 'log', 'hello'),
        makeFormatter(2, 'log', 'hello'),
        makeFormatter(3, 'log', 'hello'),
      ]);
      const grouped = ConsoleFormatter.groupConsecutive(msgs);
      assert.strictEqual(grouped.length, 1);
      assert.deepStrictEqual(grouped[0].toJSON(), {
        id: 1,
        type: 'log',
        text: 'hello',
        argsCount: 0,
        count: 3,
      });
      assert.match(grouped[0].toString(), /msgid=1\b/);
      assert.match(grouped[0].toString(), /\[3 times\]/);
    });

    it('does not group different messages', async () => {
      const msgs = await Promise.all([
        makeFormatter(1, 'log', 'aaa'),
        makeFormatter(2, 'log', 'bbb'),
        makeFormatter(3, 'log', 'ccc'),
      ]);
      const grouped = ConsoleFormatter.groupConsecutive(msgs);
      assert.strictEqual(grouped.length, 3);
      assert.deepStrictEqual(
        grouped.map(message => message.toJSON()),
        [
          {id: 1, type: 'log', text: 'aaa', argsCount: 0},
          {id: 2, type: 'log', text: 'bbb', argsCount: 0},
          {id: 3, type: 'log', text: 'ccc', argsCount: 0},
        ],
      );
    });

    it('groups A,A,B,A,A correctly', async () => {
      const msgs = await Promise.all([
        makeFormatter(1, 'log', 'A'),
        makeFormatter(2, 'log', 'A'),
        makeFormatter(3, 'log', 'B'),
        makeFormatter(4, 'log', 'A'),
        makeFormatter(5, 'log', 'A'),
      ]);
      const grouped = ConsoleFormatter.groupConsecutive(msgs);
      assert.strictEqual(grouped.length, 3);
      assert.deepStrictEqual(
        grouped.map(message => message.toJSON()),
        [
          {id: 1, type: 'log', text: 'A', argsCount: 0, count: 2},
          {id: 3, type: 'log', text: 'B', argsCount: 0},
          {id: 4, type: 'log', text: 'A', argsCount: 0, count: 2},
        ],
      );
    });

    it('does not group messages with different types', async () => {
      const msgs = await Promise.all([
        makeFormatter(1, 'log', 'hello'),
        makeFormatter(2, 'error', 'hello'),
      ]);
      const grouped = ConsoleFormatter.groupConsecutive(msgs);
      assert.strictEqual(grouped.length, 2);
      assert.deepStrictEqual(
        grouped.map(message => message.toJSON()),
        [
          {id: 1, type: 'log', text: 'hello', argsCount: 0},
          {id: 2, type: 'error', text: 'hello', argsCount: 0},
        ],
      );
    });

    it('does not group messages with different argsCount', async () => {
      const msgs = await Promise.all([
        makeFormatter(1, 'log', 'hello', 1),
        makeFormatter(2, 'log', 'hello', 2),
      ]);
      const grouped = ConsoleFormatter.groupConsecutive(msgs);
      assert.strictEqual(grouped.length, 2);
      assert.deepStrictEqual(
        grouped.map(message => message.toJSON()),
        [
          {id: 1, type: 'log', text: 'hello', argsCount: 1},
          {id: 2, type: 'log', text: 'hello', argsCount: 2},
        ],
      );
    });
  });
});
