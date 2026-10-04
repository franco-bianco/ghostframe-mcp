/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ElementHandle,
  KeyInput,
  Page,
  Point,
} from '../third_party/index.js';

import {parseKey} from './keyboard.js';

let random = Math.random;
let sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export function setHumanInputTestHooks(hooks: {
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): () => void {
  const previousRandom = random;
  const previousSleep = sleep;
  random = hooks.random ?? Math.random;
  sleep = hooks.sleep ?? previousSleep;
  return () => {
    random = previousRandom;
    sleep = previousSleep;
  };
}

/** Returns a uniformly distributed integer in the inclusive range. */
export function jitter(min: number, max: number): number {
  if (max < min) {
    [min, max] = [max, min];
  }
  return Math.floor(min + random() * (max - min + 1));
}

/** Samples a bounded lognormal delay. */
export function lognormal(mean: number, p10: number, p90: number): number {
  const ratio = Math.max(p90, 1) / Math.max(p10, 1);
  const sigma = Math.max(Math.log(ratio) / (2 * 1.2816), 0.05);
  const median = Math.sqrt(Math.max(p10, 1) * Math.max(p90, 1));
  const mu = Math.log((median + mean) / 2);

  const u1 = Math.max(random(), 1e-9);
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const value = Math.exp(mu + sigma * z);
  return Math.max(p10 / 2, Math.min(p90 * 2, value));
}

/** Generates a jittered cubic Bezier path. */
export function bezierPath(from: Point, to: Point, steps: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  const norm = distance > 0 ? distance : 1;
  const nx = -dy / norm;
  const ny = dx / norm;

  const maxOffset = Math.min(80, Math.max(8, distance * 0.15));
  const offset1 = (random() - 0.5) * 2 * maxOffset;
  const offset2 = (random() - 0.5) * 2 * maxOffset;

  const t1 = 0.25 + random() * 0.2;
  const t2 = 0.55 + random() * 0.2;

  const c1: Point = {
    x: from.x + dx * t1 + nx * offset1,
    y: from.y + dy * t1 + ny * offset1,
  };
  const c2: Point = {
    x: from.x + dx * t2 + nx * offset2,
    y: from.y + dy * t2 + ny * offset2,
  };

  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * from.x +
      3 * mt * mt * t * c1.x +
      3 * mt * t * t * c2.x +
      t * t * t * to.x;
    const y =
      mt * mt * mt * from.y +
      3 * mt * mt * t * c1.y +
      3 * mt * t * t * c2.y +
      t * t * t * to.y;
    points.push({x, y});
  }
  return points;
}

interface HumanInputState {
  x: number;
  y: number;
}

const pageState = new WeakMap<Page, HumanInputState>();

function getState(page: Page): HumanInputState {
  let s = pageState.get(page);
  if (!s) {
    s = {x: 0, y: 0};
    pageState.set(page, s);
  }
  return s;
}

/** Moves the cursor along a Bezier path and updates its cached position. */
async function bezierMoveTo(page: Page, x: number, y: number): Promise<void> {
  const state = getState(page);
  const from: Point = {x: state.x, y: state.y};
  const to: Point = {x, y};

  const steps = jitter(8, 24);
  const path = bezierPath(from, to, steps);
  for (const p of path) {
    await page.mouse.move(p.x, p.y, {steps: 1});
    await sleep(jitter(8, 30));
  }
  state.x = x;
  state.y = y;
}

interface HumanizedClickOptions {
  count?: number;
  disabled?: boolean;
  signal?: AbortSignal;
}

interface ClickTargetXY {
  type: 'xy';
  x: number;
  y: number;
}

interface ClickTargetHandle {
  type: 'handle';
  handle: ElementHandle<Element>;
}

export type ClickTarget = ClickTargetXY | ClickTargetHandle;

async function getTargetPoint(handle: ElementHandle<Element>): Promise<Point> {
  await handle.scrollIntoView();
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error('Element is not visible');
  }
  const jitterX = Math.floor(Math.min(3, box.width / 4));
  const jitterY = Math.floor(Math.min(3, box.height / 4));
  return {
    x: box.x + box.width / 2 + jitter(-jitterX, jitterX),
    y: box.y + box.height / 2 + jitter(-jitterY, jitterY),
  };
}

/** Presses or releases the left button with the pressure a real mouse reports. */
async function dispatchMouseButton(
  page: Page,
  type: 'mousePressed' | 'mouseReleased',
  point: Point,
  clickCount: number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (page as any)._client() as {
    send: (method: string, params?: unknown) => Promise<unknown>;
  };
  await client.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: type === 'mousePressed' ? 1 : 0,
    clickCount,
    pointerType: 'mouse',
    force: type === 'mousePressed' ? 0.5 : 0,
  });
}

/** Clicks after a Bezier move and randomized dwell. */
export async function humanizedClick(
  page: Page,
  target: ClickTarget,
  options: HumanizedClickOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  const count = options.count ?? 1;
  if (options.disabled) {
    if (target.type === 'handle') {
      await target.handle.asLocator().click({count, signal: options.signal});
    } else {
      await page.mouse.click(target.x, target.y, {count});
    }
    return;
  }

  const point =
    target.type === 'handle'
      ? await getTargetPoint(target.handle)
      : {x: target.x, y: target.y};
  await bezierMoveTo(page, point.x, point.y);
  await sleep(jitter(80, 250));
  options.signal?.throwIfAborted();

  // Press at the jittered point rather than delegating to Locator.click,
  // which would re-derive the element centre and teleport there first.
  for (let i = 0; i < count; i++) {
    options.signal?.throwIfAborted();
    if (i > 0) {
      await sleep(jitter(60, 140));
    }
    await dispatchMouseButton(page, 'mousePressed', point, i + 1);
    await sleep(jitter(40, 180));
    // Release a pressed button even when cancellation arrives during dwell.
    await dispatchMouseButton(page, 'mouseReleased', point, i + 1);
  }
}

/** Hovers after a Bezier move to the element. */
export async function humanizedHover(
  page: Page,
  handle: ElementHandle<Element>,
  options: {disabled?: boolean} = {},
): Promise<void> {
  if (options.disabled) {
    await handle.asLocator().hover();
    return;
  }
  const point = await getTargetPoint(handle);
  await bezierMoveTo(page, point.x, point.y);
}

export async function humanizedFill(
  page: Page,
  handle: ElementHandle<Element>,
  text: string,
  options: {disabled?: boolean; signal?: AbortSignal} = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  if (options.disabled) {
    await handle.asLocator().fill(text, {signal: options.signal});
    return;
  }
  await humanizedClick(page, {type: 'handle', handle}, options);
  options.signal?.throwIfAborted();
  await handle.evaluate(element => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      element.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  options.signal?.throwIfAborted();
  await page.keyboard.press('Backspace');
  await humanizedType(page, text, options);
}

/** Types with per-key dwell, flight time, and occasional pauses. */
export async function humanizedType(
  page: Page,
  text: string,
  options: {disabled?: boolean; signal?: AbortSignal} = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  if (options.disabled && !options.signal) {
    await page.keyboard.type(text);
    return;
  }

  let charsSinceThink = 0;
  let nextThinkAt = jitter(8, 25);
  for (const ch of text) {
    options.signal?.throwIfAborted();
    if (options.disabled) {
      await page.keyboard.type(ch);
      continue;
    }
    const dwell = Math.round(lognormal(85, 50, 150));
    await page.keyboard.type(ch, {delay: dwell});
    const flight = Math.round(lognormal(110, 55, 220));
    await sleep(flight);
    charsSinceThink++;
    if (charsSinceThink >= nextThinkAt) {
      await sleep(jitter(350, 600));
      charsSinceThink = 0;
      nextThinkAt = jitter(8, 25);
    }
  }
}

/** Presses a key with modifier dwell. */
export async function humanizedKeyPress(
  page: Page,
  keyInput: string,
  options: {disabled?: boolean; signal?: AbortSignal} = {},
): Promise<void> {
  const [key, ...modifiers] = parseKey(keyInput);
  const pressed: KeyInput[] = [];
  try {
    for (const modifier of modifiers) {
      options.signal?.throwIfAborted();
      await page.keyboard.down(modifier);
      pressed.push(modifier);
      if (!options.disabled) {
        await sleep(jitter(30, 80));
      }
    }
    options.signal?.throwIfAborted();
    await page.keyboard.press(
      key,
      options.disabled ? undefined : {delay: jitter(40, 120)},
    );
  } finally {
    for (const modifier of pressed.toReversed()) {
      if (!options.disabled) {
        await sleep(jitter(30, 80));
      }
      await page.keyboard.up(modifier);
    }
  }
}

/** Waits between drag steps. */
export async function humanizedDragStep(
  _page: Page,
  options: {disabled?: boolean} = {},
): Promise<void> {
  if (options.disabled) {
    await sleep(50);
    return;
  }
  await sleep(jitter(80, 280));
}
