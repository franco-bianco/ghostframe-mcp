/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import '../polyfill.js';

import process from 'node:process';

import {createMcpServer, logDisclaimers} from '../index.js';
import {logger, saveLogsToFile} from '../logger.js';
import {StdioServerTransport} from '../third_party/index.js';
import {VERSION} from '../version.js';

import {parseArguments} from './ghostframe-mcp-cli-options.js';

export const args = parseArguments(VERSION);

const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;

if (process.env['CHROME_DEVTOOLS_MCP_CRASH_ON_UNCAUGHT'] !== 'true') {
  process.on('unhandledRejection', (reason, promise) => {
    logger('Unhandled promise rejection', promise, reason);
  });
}

logger(`Starting ghostframe-mcp server v${VERSION}`);
const {server, shutdown} = await createMcpServer(args, {
  logFile,
});
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  // Backstop for a hung shutdown. Exiting still makes puppeteer kill Chrome.
  setTimeout(() => {
    logger('Graceful shutdown timed out');
    process.exit(1);
  }, 15_000).unref();
  try {
    await shutdown();
    await server.close();
    process.exit(0);
  } catch (error) {
    logger('Graceful shutdown failed', error);
    process.exit(1);
  }
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    void stop();
  });
}
for (const event of ['end', 'close', 'error']) {
  process.stdin.on(event, () => {
    void stop();
  });
}
// A client can die while another process still holds our stdin open, so
// EOF never arrives. Re-parenting means the client is gone.
const parentPid = process.ppid;
setInterval(() => {
  if (process.ppid !== parentPid) {
    void stop();
  }
}, 2_000).unref();
const transport = new StdioServerTransport();
await server.connect(transport);
logger('ghostframe-mcp server connected');
logDisclaimers();
