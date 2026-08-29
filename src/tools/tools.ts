/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ParsedArguments} from '../bin/ghostframe-mcp-cli-options.js';

import * as consoleTools from './console.js';
import * as emulationTools from './emulation.js';
import * as inputTools from './input.js';
import * as networkTools from './network.js';
import * as pagesTools from './pages.js';
import * as screencastTools from './screencast.js';
import * as screenshotTools from './screenshot.js';
import * as scriptTools from './script.js';
import * as snapshotTools from './snapshot.js';
import type {ToolDefinition} from './ToolDefinition.js';

export const createTools = (args: ParsedArguments) => {
  const rawTools = [
    ...Object.values(consoleTools),
    ...Object.values(emulationTools),
    ...Object.values(inputTools),
    ...Object.values(networkTools),
    ...Object.values(pagesTools),
    ...Object.values(screencastTools),
    ...Object.values(screenshotTools),
    ...Object.values(scriptTools),
    ...Object.values(snapshotTools),
  ];

  const tools = [];
  for (const tool of rawTools) {
    if (typeof tool === 'function') {
      tools.push(tool(args) as unknown as ToolDefinition);
    } else {
      tools.push(tool as unknown as ToolDefinition);
    }
  }

  tools.sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  return tools;
};
