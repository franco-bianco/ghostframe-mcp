/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {YargsOptions} from '../third_party/index.js';
import {yargs, hideBin} from '../third_party/index.js';

export const cliOptions = {
  headless: {
    type: 'boolean',
    description: 'Whether to run in headless (no UI) mode.',
    default: false,
  },
  executablePath: {
    type: 'string',
    description: 'Path to custom Chrome executable.',
    alias: 'e',
  },
  isolated: {
    type: 'boolean',
    description:
      'If specified, creates a temporary user-data-dir that is automatically cleaned up after the browser is closed. Defaults to false.',
  },
  userDataDir: {
    type: 'string',
    description:
      'Path to the user data directory for Chrome. Default is $HOME/.cache/ghostframe-mcp/chrome-profile$CHANNEL_SUFFIX_IF_NON_STABLE.',
    conflicts: ['isolated'],
  },
  channel: {
    type: 'string',
    description:
      'Specify a different Chrome channel that should be used. The default is the stable channel version.',
    choices: ['canary', 'dev', 'beta', 'stable'] as const,
    conflicts: ['executablePath'],
  },
  logFile: {
    type: 'string',
    describe:
      'Path to a file to write debug logs to. Set the env variable `DEBUG` to `*` to enable verbose logs. Useful for submitting bug reports.',
  },
  viewport: {
    type: 'string',
    describe:
      'Initial viewport size for the Chrome instances started by the server. For example, `1280x720`. In headless mode, max size is 3840x2160px.',
    coerce: (arg: string | undefined) => {
      if (arg === undefined) {
        return;
      }
      const [width, height] = arg.split('x').map(Number);
      if (!width || !height || Number.isNaN(width) || Number.isNaN(height)) {
        throw new Error('Invalid viewport. Expected format is `1280x720`.');
      }
      return {
        width,
        height,
      };
    },
  },
  proxyServer: {
    type: 'string',
    description:
      'Proxy server for Chrome. Use GHOSTFRAME_PROXY_USERNAME and GHOSTFRAME_PROXY_PASSWORD for HTTP proxy authentication. SOCKS proxies must be unauthenticated.',
  },
  allowLegacyProxyCredentials: {
    type: 'boolean',
    default: false,
    description:
      'Allow credentials embedded in --proxy-server. This may expose secrets through process listings and is disabled by default.',
  },
  allowUnrestrictedPaths: {
    type: 'boolean',
    default: false,
    description:
      'Allow file access outside client workspace roots and the system temporary directory. Disabled by default.',
  },
  acceptInsecureCerts: {
    type: 'boolean',
    description: `If enabled, ignores errors relative to self-signed and expired certificates. Use with caution.`,
  },
  experimentalScreencast: {
    type: 'boolean',
    describe:
      'Exposes experimental screencast tools (requires ffmpeg). Install ffmpeg from <https://www.ffmpeg.org/download.html> and ensure it is on the MCP server PATH.',
  },
  experimentalFfmpegPath: {
    type: 'string',
    describe: 'Path to ffmpeg executable for screencast recording.',
    implies: 'experimentalScreencast',
  },
  chromeArg: {
    type: 'array',
    describe:
      'Additional arguments for Chrome. Only applies when Chrome is launched by ghostframe-mcp.',
  },
  ignoreDefaultChromeArg: {
    type: 'array',
    describe:
      'Explicitly disable default arguments for Chrome. Only applies when Chrome is launched by ghostframe-mcp.',
  },
  categoryEmulation: {
    type: 'boolean',
    default: true,
    describe: 'Set to false to exclude tools related to emulation.',
  },
  categoryNetwork: {
    type: 'boolean',
    default: true,
    describe: 'Set to false to exclude tools related to network.',
  },
  viaCli: {
    type: 'boolean',
    describe:
      'Set by Chrome DevTools CLI if the MCP server is started via the CLI client (this arg exists for usage stats)',
    hidden: true,
  },
} satisfies Record<string, YargsOptions>;

export type ParsedArguments = ReturnType<typeof parseArguments>;

export function parseArguments(version: string, argv = process.argv) {
  const yargsInstance = yargs(hideBin(argv))
    .scriptName('ghostframe-mcp')
    .options(cliOptions)
    .check(args => {
      if (!args.channel && !args.executablePath) {
        args.channel = 'stable';
      }
      return true;
    })
    .example([
      ['$0 --channel beta', 'Use Chrome Beta installed on this system'],
      ['$0 --channel canary', 'Use Chrome Canary installed on this system'],
      ['$0 --channel dev', 'Use Chrome Dev installed on this system'],
      ['$0 --channel stable', 'Use stable Chrome installed on this system'],
      ['$0 --logFile /tmp/log.txt', 'Save logs to a file'],
      ['$0 --help', 'Print CLI options'],
      [
        '$0 --viewport 1280x720',
        'Launch Chrome with the initial viewport size of 1280x720px',
      ],
      [
        `$0 --chrome-arg='--no-sandbox' --chrome-arg='--disable-setuid-sandbox'`,
        'Launch Chrome without sandboxes. Use with caution.',
      ],
      [
        `$0 --ignore-default-chrome-arg='--disable-extensions'`,
        'Disable the default arguments provided by Puppeteer. Use with caution.',
      ],
      ['$0 --no-category-emulation', 'Disable tools in the emulation category'],
      ['$0 --no-category-network', 'Disable tools in the network category'],
      [
        '$0 --user-data-dir=/tmp/user-data-dir',
        'Use a custom user data directory',
      ],
      [
        '$0 --auto-connect',
        'Connect to a stable Chrome instance (Chrome 144+) running instead of launching a new instance',
      ],
    ]);

  return yargsInstance
    .wrap(Math.min(120, yargsInstance.terminalWidth()))
    .help()
    .version(version)
    .parseSync();
}
