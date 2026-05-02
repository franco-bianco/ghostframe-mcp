/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Humanized input helpers used by tools when stealth mode is enabled.
 *
 * Modern bot detectors (Akamai Bot Manager v4, HUMAN, Kasada, etc.) score
 * pointer trajectories and keystroke timings.  CDP's default `Input.*`
 * dispatch produces single-jump cursor moves and zero-delay keystrokes that
 * are trivially fingerprintable.  These helpers introduce small, randomized
 * humanizations:
 *
 *   - Mouse: cubic-Bezier path with control-point jitter, 8-24 mouseMoved
 *     events, non-uniform 8-30ms inter-event gap, optional 80-250ms
 *     pre-press dwell, and 40-180ms down-up dwell.
 *   - Typing: per-key loop sampling a lognormal flight time (mean ~110ms,
 *     p10 55ms, p90 220ms), 50-150ms key dwell, occasional 350-600ms
 *     thinking pause every 8-25 chars.
 *   - Drag: 80-280ms randomized inter-step.
 *   - Modifier dwell on press_key: 30-80ms.
 *
 * Each public helper accepts an optional `disabled` argument; when true, it
 * falls back to the un-humanized Puppeteer call so the existing behavior is
 * preserved when stealth mode is off.
 */

import type {
  ElementHandle,
  KeyInput,
  Page,
  Point,
} from '../third_party/index.js';

import {parseKey} from './keyboard.js';

/** Uniformly distributed integer in `[min, max]`. */
export function jitter(min: number, max: number): number {
  if (max < min) {
    [min, max] = [max, min];
  }
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Sample from a lognormal distribution parameterized by an approximate mean
 * and the 10th and 90th percentiles.  We don't need calibrated statistics
 * here, just plausibly human-looking variability.  The fitted parameters
 * (mu, sigma) are derived from the percentile bracket; the mean argument
 * is used as a small bias term to keep the distribution centered.
 */
export function lognormal(mean: number, p10: number, p90: number): number {
  // ln(p90/p10) ≈ 2 * 1.2816 * sigma  (1.2816 = z-score for 90th percentile)
  const ratio = Math.max(p90, 1) / Math.max(p10, 1);
  const sigma = Math.max(Math.log(ratio) / (2 * 1.2816), 0.05);
  // Use the geometric mean of p10/p90 as the median; bias slightly toward
  // the requested mean.
  const median = Math.sqrt(Math.max(p10, 1) * Math.max(p90, 1));
  const mu = Math.log((median + mean) / 2);

  // Box-Muller for a standard normal sample.
  const u1 = Math.max(Math.random(), 1e-9);
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const value = Math.exp(mu + sigma * z);
  // Clamp into [p10/2, p90*2] to avoid pathological tails.
  return Math.max(p10 / 2, Math.min(p90 * 2, value));
}

/**
 * Generate a sequence of `steps` points along a cubic Bezier curve from
 * `from` to `to` with two jittered control points.  The control points are
 * placed roughly along the straight line with perpendicular offsets.
 */
export function bezierPath(from: Point, to: Point, steps: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  // Perpendicular unit vector for the lateral jitter.
  const norm = distance > 0 ? distance : 1;
  const nx = -dy / norm;
  const ny = dx / norm;

  // Lateral offsets scale with distance but are clamped for short hops.
  const maxOffset = Math.min(80, Math.max(8, distance * 0.15));
  const offset1 = (Math.random() - 0.5) * 2 * maxOffset;
  const offset2 = (Math.random() - 0.5) * 2 * maxOffset;

  // Place control points around the 1/3 and 2/3 marks with small along-path
  // jitter so they aren't co-linear.
  const t1 = 0.25 + Math.random() * 0.2;
  const t2 = 0.55 + Math.random() * 0.2;

  const c1: Point = {
    x: from.x + dx * t1 + nx * offset1,
    y: from.y + dy * t1 + ny * offset1,
  };
  const c2: Point = {
    x: from.x + dx * t2 + nx * offset2,
    y: from.y + dy * t2 + ny * offset2,
  };

  const points: Point[] = [];
  // Skip t=0 (already at from); include t=1 (final position).
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

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/**
 * Move the cursor along a bezier curve toward (x, y).  Updates the cached
 * "current" cursor position so successive moves chain correctly.
 */
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

/**
 * Humanized click.  When `target.type === 'handle'`, falls back to the
 * Locator-based click (which handles scrolling/visibility waiting); when
 * `target.type === 'xy'`, performs a bezier-curve move + dwell + click.
 *
 * If `disabled` is true, runs the un-humanized Puppeteer path.
 */
export async function humanizedClick(
  page: Page,
  target: ClickTarget,
  options: HumanizedClickOptions = {},
): Promise<void> {
  const count = options.count ?? 1;
  if (options.disabled) {
    if (target.type === 'handle') {
      await target.handle.asLocator().click({count});
    } else {
      await page.mouse.click(target.x, target.y, {count});
    }
    return;
  }

  if (target.type === 'handle') {
    // Use the Locator's pre-conditions (scrollIntoView, waiting for the
    // element to be stable).  The locator handles centering inside the
    // element; we add a small randomized down→up dwell to mimic a human
    // press.  We deliberately avoid jittering the click offset because
    // small elements may have offsets that fall outside the box.
    const locator = target.handle.asLocator();
    await locator.click({
      count,
      delay: jitter(40, 180),
    });
    // Update cached cursor state from the element's bounding box if
    // available so subsequent humanized moves start from the right place.
    try {
      const box = await target.handle.boundingBox();
      if (box) {
        const state = getState(page);
        state.x = box.x + box.width / 2;
        state.y = box.y + box.height / 2;
      }
    } catch {
      // Ignore — best-effort cursor tracking only.
    }
    return;
  }

  await bezierMoveTo(page, target.x, target.y);
  await sleep(jitter(80, 250));
  // Delegate to Puppeteer's click() so that browser-internal click-count
  // tracking (needed for dblclick events) stays correct.  The `delay` is
  // the humanized down→up dwell.
  await page.mouse.click(target.x, target.y, {
    count,
    delay: jitter(40, 180),
  });
}

/**
 * Humanized hover.  Moves the cursor along a bezier curve toward the
 * element handle.
 */
export async function humanizedHover(
  page: Page,
  handle: ElementHandle<Element>,
  options: {disabled?: boolean} = {},
): Promise<void> {
  if (options.disabled) {
    await handle.asLocator().hover();
    return;
  }
  // Defer to the Locator for visibility/stability checks, but ask
  // Puppeteer to subdivide the move so the path is non-linear.
  await handle.asLocator().hover();
  try {
    const box = await handle.boundingBox();
    if (box) {
      const targetX = box.x + box.width / 2 + jitter(-3, 3);
      const targetY = box.y + box.height / 2 + jitter(-3, 3);
      // Issue a follow-up bezier move from the current position to a
      // slightly jittered point inside the element.  This produces
      // realistic tail-end mouseMoved events after the locator's
      // straight-line move.
      const state = getState(page);
      // If we don't have a starting point yet, prime it to the box center
      // so we don't get a long synthetic move.
      if (state.x === 0 && state.y === 0) {
        state.x = box.x + box.width / 2;
        state.y = box.y + box.height / 2;
      }
      await bezierMoveTo(page, targetX, targetY);
    }
  } catch {
    // Ignore.
  }
}

/**
 * Humanized typing.  Sends each character as a discrete key press with
 * lognormal flight time and short dwell, with the occasional thinking
 * pause to mimic a human composing text.
 */
export async function humanizedType(
  page: Page,
  text: string,
  options: {disabled?: boolean} = {},
): Promise<void> {
  if (options.disabled) {
    await page.keyboard.type(text);
    return;
  }

  let charsSinceThink = 0;
  let nextThinkAt = jitter(8, 25);
  for (const ch of text) {
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

/**
 * Humanized single-key press with a small modifier dwell.
 */
export async function humanizedKeyPress(
  page: Page,
  keyInput: string,
  options: {disabled?: boolean} = {},
): Promise<void> {
  const tokens = parseKey(keyInput);
  const [key, ...modifiers] = tokens as [KeyInput, ...KeyInput[]];

  if (options.disabled) {
    for (const modifier of modifiers) {
      await page.keyboard.down(modifier);
    }
    await page.keyboard.press(key);
    for (const modifier of modifiers.toReversed()) {
      await page.keyboard.up(modifier);
    }
    return;
  }

  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
    await sleep(jitter(30, 80));
  }
  await page.keyboard.press(key, {delay: jitter(40, 120)});
  for (const modifier of modifiers.toReversed()) {
    await sleep(jitter(30, 80));
    await page.keyboard.up(modifier);
  }
}

/**
 * Small inter-step delay used by the drag handler.  Replaces the
 * hardcoded uniform 50ms `setTimeout` between drag and drop.
 */
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
