/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS =
  /authorization|cookie|password|secret|token|proxy|headers/i;

export function redactCommandLineArgs(args: string[]): string[] {
  const result: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      result.push(REDACTED);
      redactNext = false;
      continue;
    }
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    if (SENSITIVE_KEYS.test(name)) {
      if (separator === -1) {
        result.push(name);
        redactNext = true;
      } else {
        result.push(`${name}=${REDACTED}`);
      }
      continue;
    }
    result.push(arg);
  }
  return result;
}

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValues);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEYS.test(key)
      ? REDACTED
      : redactSensitiveValues(item);
  }
  return redacted;
}
