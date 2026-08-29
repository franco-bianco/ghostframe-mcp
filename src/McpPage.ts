/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from './logger.js';
import type {TextSnapshot} from './TextSnapshot.js';
import type {
  CDPSession,
  Dialog,
  ElementHandle,
  Page,
  Viewport,
} from './third_party/index.js';
import {takeSnapshot} from './tools/snapshot.js';
import type {ContextPage, DevToolsData} from './tools/ToolDefinition.js';
import type {
  EmulationSettings,
  GeolocationOptions,
  TextSnapshotNode,
} from './types.js';
import {
  getNetworkMultiplierFromString,
  WaitForHelper,
} from './WaitForHelper.js';

/**
 * Per-page state wrapper. Consolidates dialog, snapshot, emulation,
 * and metadata that were previously scattered across Maps in McpContext.
 *
 * Internal class consumed only by McpContext. Fields are public for direct
 * read/write access. The dialog field is private because it requires an
 * event listener lifecycle managed by the constructor/dispose pair.
 */
export class McpPage implements ContextPage {
  readonly pptrPage: Page;
  readonly id: number;

  // Snapshot
  textSnapshot: TextSnapshot | null = null;
  uniqueBackendNodeIdToMcpId = new Map<string, string>();
  extraHandles: ElementHandle[] = [];

  // Emulation
  emulationSettings: EmulationSettings = {};

  // Metadata
  isolatedContextName?: string;
  devToolsPage?: Page;

  // Dialog
  #dialog?: Dialog;
  #dialogHandler: (dialog: Dialog) => void;
  #networkSession?: CDPSession;

  constructor(page: Page, id: number) {
    this.pptrPage = page;
    this.id = id;
    this.#dialogHandler = (dialog: Dialog): void => {
      this.#dialog = dialog;
    };
    page.on('dialog', this.#dialogHandler);
  }

  get dialog(): Dialog | undefined {
    return this.#dialog;
  }

  getDialog(): Dialog | undefined {
    return this.dialog;
  }

  clearDialog(): void {
    this.#dialog = undefined;
  }

  throwIfDialogOpen(): void {
    if (this.#dialog) {
      throw new Error(
        `A dialog is open (${this.#dialog.type()}: ${this.#dialog.message()}).`,
      );
    }
  }

  async setBlockedUrls(patterns: string[]): Promise<void> {
    if (!this.#networkSession) {
      this.#networkSession = await this.pptrPage.createCDPSession();
      await this.#networkSession.send('Network.enable');
    }
    await this.#networkSession.send('Network.setBlockedURLs', {urls: patterns});
  }

  get networkConditions(): string | null {
    return this.emulationSettings.networkConditions ?? null;
  }

  get cpuThrottlingRate(): number {
    return this.emulationSettings.cpuThrottlingRate ?? 1;
  }

  get geolocation(): GeolocationOptions | null {
    return this.emulationSettings.geolocation ?? null;
  }

  get viewport(): Viewport | null {
    return this.emulationSettings.viewport ?? null;
  }

  get userAgent(): string | null {
    return this.emulationSettings.userAgent ?? null;
  }

  get colorScheme(): 'dark' | 'light' | null {
    return this.emulationSettings.colorScheme ?? null;
  }

  // Public for testability: tests spy on this method to verify throttle multipliers.
  createWaitForHelper(
    cpuMultiplier: number,
    networkMultiplier: number,
  ): WaitForHelper {
    return new WaitForHelper(this.pptrPage, cpuMultiplier, networkMultiplier);
  }

  waitForEventsAfterAction(
    action: () => Promise<unknown>,
    options?: {timeout?: number; handleDialog?: 'accept' | 'dismiss' | string},
  ): Promise<void> {
    const helper = this.createWaitForHelper(
      this.cpuThrottlingRate,
      getNetworkMultiplierFromString(this.networkConditions),
    );
    return helper.waitForEventsAfterAction(action, options);
  }

  dispose(): void {
    this.pptrPage.off('dialog', this.#dialogHandler);
    try {
      void this.#networkSession?.detach().catch(error => {
        logger('Failed to detach network session', error);
      });
    } catch (error) {
      logger('Failed to detach network session', error);
    }
    this.#networkSession = undefined;
  }

  async getElementByUid(uid: string): Promise<ElementHandle<Element>> {
    if (!this.textSnapshot) {
      throw new Error(
        `No snapshot found for page ${this.id ?? '?'}. Use ${takeSnapshot.name} to capture one.`,
      );
    }
    const node = this.textSnapshot.idToNode.get(uid);
    if (!node) {
      throw new Error(`Element uid "${uid}" not found on page ${this.id}.`);
    }
    return this.#resolveElementHandle(node, uid);
  }

  async #resolveElementHandle(
    node: TextSnapshotNode,
    uid: string,
  ): Promise<ElementHandle<Element>> {
    const message = `Element with uid ${uid} no longer exists on the page.`;
    try {
      const handle = await node.elementHandle();
      if (!handle) {
        throw new Error(message);
      }
      return handle;
    } catch (error) {
      throw new Error(message, {
        cause: error,
      });
    }
  }

  getAXNodeByUid(uid: string) {
    return this.textSnapshot?.idToNode.get(uid);
  }

  resolveCdpElementId(cdpBackendNodeId: number): string | undefined {
    if (!cdpBackendNodeId) {
      logger('no cdpBackendNodeId');
      return;
    }
    const snapshot = this.textSnapshot;
    if (!snapshot) {
      logger('no text snapshot');
      return;
    }
    // TODO: index by backendNodeId instead.
    const queue = [snapshot.root];
    while (queue.length) {
      const current = queue.pop()!;
      if (current.backendNodeId === cdpBackendNodeId) {
        return current.id;
      }
      for (const child of current.children) {
        queue.push(child);
      }
    }
    return;
  }

  async getDevToolsData(): Promise<DevToolsData> {
    try {
      logger('Getting DevTools UI data');
      const devtoolsPage = this.devToolsPage;
      if (!devtoolsPage) {
        logger('No DevTools page detected');
        return {};
      }
      const {cdpRequestId, cdpBackendNodeId} = await devtoolsPage.evaluate(
        async () => {
          // @ts-expect-error no types
          const UI = await import('/bundled/ui/legacy/legacy.js');
          // @ts-expect-error no types
          const SDK = await import('/bundled/core/sdk/sdk.js');
          const request = UI.Context.Context.instance().flavor(
            SDK.NetworkRequest.NetworkRequest,
          );
          const node = UI.Context.Context.instance().flavor(
            SDK.DOMModel.DOMNode,
          );
          return {
            cdpRequestId: request?.requestId(),
            cdpBackendNodeId: node?.backendNodeId(),
          };
        },
      );
      return {cdpBackendNodeId, cdpRequestId};
    } catch (err) {
      logger('error getting devtools data', err);
    }
    return {};
  }
}
