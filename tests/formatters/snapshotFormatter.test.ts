/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {ElementHandle} from 'puppeteer-core';

import {SnapshotFormatter} from '../../src/formatters/SnapshotFormatter.js';
import {TextSnapshot} from '../../src/TextSnapshot.js';
import type {TextSnapshotNode} from '../../src/types.js';

function snapshotWithRoot(root: TextSnapshotNode): TextSnapshot {
  return new TextSnapshot({
    root,
    snapshotId: '1',
    idToNode: new Map(),
    hasSelectedElement: false,
    verbose: false,
  });
}

describe('snapshotFormatter', () => {
  it('formats a snapshot with value properties', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'textbox',
      name: 'textbox',
      value: 'value',
      live: 'polite',
      relevant: 'additions',
      errormessage: 'error-id',
      details: 'details-id',
      children: [
        {
          id: '1_2',
          role: 'statictext',
          name: 'text',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter(snapshotWithRoot(node));
    const formatted = formatter.toString();
    assert.strictEqual(
      formatted,
      `uid=1_1 textbox "textbox" details="details-id" errormessage="error-id" live="polite" relevant="additions" value="value"
  uid=1_2 statictext "text"
`,
    );
  });

  it('formats a snapshot with boolean properties', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'button',
      name: 'button',
      disabled: true,
      busy: true,
      atomic: true,
      children: [
        {
          id: '1_2',
          role: 'statictext',
          name: 'text',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter(snapshotWithRoot(node));
    const formatted = formatter.toString();
    assert.strictEqual(
      formatted,
      `uid=1_1 button "button" atomic busy disableable disabled
  uid=1_2 statictext "text"
`,
    );
  });

  it('formats a snapshot with checked properties', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'checkbox',
      name: 'checkbox',
      checked: true,
      children: [
        {
          id: '1_2',
          role: 'statictext',
          name: 'text',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter(snapshotWithRoot(node));
    const formatted = formatter.toString();
    assert.strictEqual(
      formatted,
      `uid=1_1 checkbox "checkbox" checked
  uid=1_2 statictext "text"
`,
    );
  });

  it('formats a snapshot with multiple different type attributes', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'root',
      name: 'root',
      children: [
        {
          id: '1_2',
          role: 'button',
          name: 'button',
          focused: true,
          disabled: true,
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
        {
          id: '1_3',
          role: 'textbox',
          name: 'textbox',
          value: 'value',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter(snapshotWithRoot(node));
    const formatted = formatter.toString();
    assert.strictEqual(
      formatted,
      `uid=1_1 root "root"
  uid=1_2 button "button" disableable disabled focusable focused
  uid=1_3 textbox "textbox" value="value"
`,
    );
  });

  it('guides the caller to verbose mode when the selected element is absent', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'checkbox',
      name: 'checkbox',
      checked: true,
      children: [
        {
          id: '1_2',
          role: 'statictext',
          name: 'text',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter({
      snapshotId: '1',
      root: node,
      idToNode: new Map(),
      hasSelectedElement: true,
      verbose: false,
    });
    const formatted = formatter.toString();

    assert.match(formatted, /selected element/i);
    assert.match(formatted, /verbose snapshot/i);
    assert.match(formatted, /uid=1_1 checkbox/);
    assert.match(formatted, /uid=1_2 statictext/);
    assert.doesNotMatch(formatted, /\[selected in/);
  });

  it('does not include a note if the snapshot is already verbose', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'checkbox',
      name: 'checkbox',
      checked: true,
      children: [
        {
          id: '1_2',
          role: 'statictext',
          name: 'text',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter({
      snapshotId: '1',
      root: node,
      idToNode: new Map(),
      hasSelectedElement: true,
      verbose: true,
    });
    const formatted = formatter.toString();

    assert.match(formatted, /^uid=1_1 checkbox/);
    assert.match(formatted, /uid=1_2 statictext/);
    assert.doesNotMatch(formatted, /Note:|verbose snapshot/i);
  });

  it('marks only the selected element in the snapshot', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'checkbox',
      name: 'checkbox',
      checked: true,
      children: [
        {
          id: '1_2',
          role: 'statictext',
          name: 'text',
          children: [],
          elementHandle: async (): Promise<ElementHandle<Element> | null> => {
            return null;
          },
        },
      ],
      elementHandle: async (): Promise<ElementHandle<Element> | null> => {
        return null;
      },
    };

    const formatter = new SnapshotFormatter({
      snapshotId: '1',
      root: node,
      idToNode: new Map(),
      hasSelectedElement: true,
      selectedElementUid: '1_1',
      verbose: false,
    });
    const formatted = formatter.toString();

    const lines = formatted.trimEnd().split('\n');
    assert.match(
      lines[0],
      /uid=1_1.*\[selected in the DevTools Elements panel\]/,
    );
    assert.match(lines[1], /uid=1_2 statictext/);
    assert.doesNotMatch(lines[1], /\[selected in/);
    assert.doesNotMatch(formatted, /Note:|verbose snapshot/i);
  });

  it('toJSON returns expected structure', () => {
    const node: TextSnapshotNode = {
      id: '1_1',
      role: 'root',
      name: 'root',
      busy: true,
      live: 'polite',
      children: [
        {
          id: '1_2',
          role: 'button',
          name: 'button',
          disabled: true,
          children: [],
          elementHandle: async () => null,
        },
      ],
      elementHandle: async () => null,
    };

    const formatter = new SnapshotFormatter(snapshotWithRoot(node));
    const json = formatter.toJSON();

    assert.deepStrictEqual(json, {
      id: '1_1',
      role: 'root',
      name: 'root',
      busy: true,
      live: 'polite',
      children: [
        {
          id: '1_2',
          role: 'button',
          name: 'button',
          disableable: true,
          disabled: true,
        },
      ],
    });
  });
});
