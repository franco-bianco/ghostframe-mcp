/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 */

import {zod, PredefinedNetworkConditions} from '../third_party/index.js';
import type {UserAgentMetadata} from '../types.js';

import {ToolCategory} from './categories.js';
import {
  definePageTool,
  geolocationTransform,
  viewportTransform,
} from './ToolDefinition.js';

const throttlingOptions: [string, ...string[]] = [
  'Offline',
  ...Object.keys(PredefinedNetworkConditions),
];

function userAgentMetadataTransform(
  arg: string | undefined,
): UserAgentMetadata | undefined {
  if (!arg) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(arg);
  } catch (err) {
    throw new Error(
      `userAgentMetadata must be valid JSON: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('userAgentMetadata must be a JSON object');
  }
  // The shape is intentionally loose; CDP rejects unknown keys, which we
  // surface to the caller verbatim rather than silently filtering.
  return parsed as UserAgentMetadata;
}

export const emulate = definePageTool({
  name: 'emulate',
  description: `Emulates various features on the selected page.`,
  annotations: {
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
  },
  schema: {
    networkConditions: zod
      .enum(throttlingOptions)
      .optional()
      .describe(`Throttle network. Omit to disable throttling.`),
    cpuThrottlingRate: zod
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe(
        'Represents the CPU slowdown factor. Omit or set the rate to 1 to disable throttling',
      ),
    geolocation: zod
      .string()
      .optional()
      .transform(geolocationTransform)
      .describe(
        'Geolocation (`<latitude>x<longitude>`) to emulate. Latitude between -90 and 90. Longitude between -180 and 180. Omit to clear the geolocation override.',
      ),
    userAgent: zod
      .string()
      .optional()
      .describe(
        'User agent to emulate. Set to empty string to clear the user agent override.',
      ),
    userAgentMetadata: zod
      .string()
      .optional()
      .transform(userAgentMetadataTransform)
      .describe(
        'User-Agent Client Hints metadata sent alongside the UA override, encoded as a JSON object string. Recognized keys: brands (array of {brand, version}), fullVersionList (array of {brand, version}), fullVersion, platform, platformVersion, architecture, model, mobile (bool), bitness, wow64 (bool). Used to keep `navigator.userAgent` and `Sec-CH-UA-*` headers in sync. Omit to clear when no userAgent is provided.',
      ),
    locale: zod
      .string()
      .optional()
      .describe(
        'Locale (e.g. `en-US`, `de-DE`) to use for `navigator.language`, `Intl` APIs, and the `Accept-Language` header. Omit to clear the locale override.',
      ),
    timezone: zod
      .string()
      .optional()
      .describe(
        'IANA timezone identifier (e.g. `America/Los_Angeles`) used to override the page\'s timezone. Omit to clear the timezone override.',
      ),
    colorScheme: zod
      .enum(['dark', 'light', 'auto'])
      .optional()
      .describe(
        'Emulate the dark or the light mode. Set to "auto" to reset to the default.',
      ),
    viewport: zod
      .string()
      .optional()
      .transform(viewportTransform)
      .describe(
        `Emulate device viewports as 'WIDTHxHEIGHTxDPR' optionally followed by ',mobile', ',touch', and/or ',landscape' (e.g. '1280x720x1', '412x823x1.75,mobile,touch'). 'touch' and 'mobile' emulate mobile devices; 'landscape' emulates landscape mode.`,
      ),
  },
  blockedByDialog: true,
  handler: async (request, _response, context) => {
    const page = request.page;
    await context.emulate(request.params, page.pptrPage);
  },
});
