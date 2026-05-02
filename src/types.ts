/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {SerializedAXNode, Viewport, Target} from './third_party/index.js';

export interface ExtensionServiceWorker {
  url: string;
  target: Target;
  id: string;
}

export interface TextSnapshotNode extends SerializedAXNode {
  id: string;
  backendNodeId?: number;
  loaderId?: string;
  children: TextSnapshotNode[];
}

export interface GeolocationOptions {
  latitude: number;
  longitude: number;
}

/**
 * User-Agent Client Hints metadata, mirroring CDP's
 * `Emulation.UserAgentMetadata`. Bundling this with the UA string keeps
 * `navigator.userAgent` and the `Sec-CH-UA-*` request headers consistent so
 * anti-bot vendors can't trivially spot the desync.
 */
export interface UserAgentMetadata {
  brands?: Array<{brand: string; version: string}>;
  fullVersionList?: Array<{brand: string; version: string}>;
  fullVersion?: string;
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  model?: string;
  mobile?: boolean;
  bitness?: string;
  wow64?: boolean;
}

export interface EmulationSettings {
  networkConditions?: string;
  cpuThrottlingRate?: number;
  geolocation?: GeolocationOptions;
  userAgent?: string;
  userAgentMetadata?: UserAgentMetadata;
  locale?: string;
  timezone?: string;
  colorScheme?: 'dark' | 'light';
  viewport?: Viewport;
}
