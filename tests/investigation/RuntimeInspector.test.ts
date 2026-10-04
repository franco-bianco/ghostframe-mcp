/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {
  parseCookieData,
  parseRuntimeArguments,
  RuntimeInspector,
} from '../../src/investigation/RuntimeInspector.js';
import {CdpFrame} from '../../src/third_party/index.js';
import {serverHooks} from '../server.js';
import {withBrowser} from '../utils.js';

function handleId(value: unknown): string {
  assert(
    value !== null &&
      typeof value === 'object' &&
      'handle' in value &&
      typeof value.handle === 'string',
  );
  return value.handle;
}

describe('RuntimeInspector', () => {
  const server = serverHooks();

  it('validates structured arguments and exact cookie scopes without type casts', () => {
    assert.deepEqual(
      parseRuntimeArguments('[{"value":{"x":1}},{"handle":"handle-1"}]'),
      [{value: {x: 1}}, {handle: 'handle-1'}],
    );
    assert.throws(
      () => parseRuntimeArguments('[{"handle":"a","value":1}]'),
      /exactly one/,
    );
    assert.throws(
      () => parseCookieData('[{"name":"x","domain":"localhost"}]'),
      /string value/,
    );
    assert.deepEqual(
      parseCookieData('[{"name":"x","domain":"localhost"}]', false),
      [{name: 'x', domain: 'localhost', value: ''}],
    );
  });

  it('finds existing listeners and invokes a closure signer without enabling Debugger', async () => {
    await withBrowser(async (browser, page) => {
      const inspector = new RuntimeInspector(
        browser,
        () => page,
        () => page,
      );
      const frame = page.mainFrame();
      assert(frame instanceof CdpFrame);
      const spy = sinon.spy(frame._client(), 'send');
      try {
        await page.setContent(`<button id="invoke">sign</button><script>
          (() => { const signer = payload => 'signed:' + payload;
            document.querySelector('#invoke').addEventListener('click', function onClick() { this.textContent = signer('browser'); });
          })();
        </script>`);
        const element = await page.$('#invoke');
        assert(element);
        const listeners = await inspector.eventListeners(page, element);
        await element.dispose();
        const handler = listeners.targets
          .flatMap(target => target.listeners)
          .find(listener => listener.type === 'click')?.handler;
        const properties = await inspector.inspectHandle(handleId(handler));
        const scopes = properties.internalProperties?.find(
          property => property.name === '[[Scopes]]',
        )?.value;
        assert(
          scopes,
          'Engine should expose closure scopes for an existing listener',
        );
        const scopeList = await inspector.inspectHandle(handleId(scopes));
        let signer: string | undefined;
        for (const property of scopeList.properties) {
          if (
            !/^\d+$/.test(property.name) ||
            !property.value ||
            !('handle' in property.value)
          ) {
            continue;
          }
          const scope = await inspector.inspectHandle(handleId(property.value));
          signer = scope.properties.find(item => item.name === 'signer')?.value
            ? handleId(
                scope.properties.find(item => item.name === 'signer')?.value,
              )
            : undefined;
          if (signer) {
            break;
          }
          // Recent V8 versions wrap scope values in a {description, object} pair.
          const object = scope.properties.find(
            item => item.name === 'object',
          )?.value;
          if (object && 'handle' in object) {
            const variables = await inspector.inspectHandle(handleId(object));
            const fn = variables.properties.find(
              item => item.name === 'signer',
            )?.value;
            if (fn) {
              signer = handleId(fn);
              break;
            }
          }
        }
        assert(signer, 'Should retain the actual private signing function');
        assert.equal(
          (
            await inspector.callHandle({
              handle: signer,
              args: [{value: 'agent'}],
            })
          ).value,
          'signed:agent',
        );
        assert.equal(
          spy.getCalls().some(call => call.args[0] === 'Debugger.enable'),
          false,
        );
      } finally {
        spy.restore();
        await inspector.dispose();
      }
    });
  });

  it('preserves cyclic identities, avoids getters, rejects cross-world handles and expires after navigation', async () => {
    await withBrowser(async (browser, page) => {
      const inspector = new RuntimeInspector(
        browser,
        () => page,
        () => page,
      );
      try {
        const result = await inspector.evaluate({
          world: 'main',
          returnMode: 'handle',
          function: `() => {
          globalThis.getterCalls = 0;
          const obj = {get secret() { globalThis.getterCalls++; return 42; }};
          obj.self = obj; return obj;
        }`,
        });
        const handle = handleId(result);
        const properties = await inspector.inspectHandle(handle);
        assert(
          properties.properties.some(
            property =>
              property.name === 'self' &&
              property.value &&
              'handle' in property.value,
          ),
        );
        assert(
          properties.properties.some(
            property => property.name === 'secret' && property.getter,
          ),
        );
        assert.equal(
          (
            await inspector.evaluate({
              world: 'main',
              function: '() => globalThis.getterCalls',
            })
          ).value,
          0,
        );
        const privateObject = await inspector.evaluate({
          world: 'main',
          returnMode: 'handle',
          function:
            '() => new (class { #token = "private-state"; read() { return this.#token; } })()',
        });
        const privateProperties = await inspector.inspectHandle(
          handleId(privateObject),
        );
        assert(
          privateProperties.privateProperties?.some(
            property =>
              property.name === '#token' &&
              property.value &&
              'value' in property.value &&
              property.value.value === 'private-state',
          ),
        );
        await assert.rejects(
          inspector.evaluate({
            world: 'isolated',
            function: '(arg) => arg',
            args: [{handle}],
          }),
          /same target, frame and world/,
        );
        await page.goto('about:blank');
        await assert.rejects(
          inspector.inspectHandle(handle),
          /expired|released/,
        );
      } finally {
        await inspector.dispose();
      }
    });
  });

  it('evaluates explicitly selected frames and dedicated workers', async () => {
    await withBrowser(async (browser, page) => {
      const inspector = new RuntimeInspector(
        browser,
        () => page,
        () => page,
      );
      try {
        await page.setContent(
          `<iframe srcdoc="<title>Child frame</title>"></iframe>`,
        );
        const targets = await inspector.listTargets();
        const child = targets.targets
          .flatMap(target => target.frames ?? [])
          .find(frame => frame.parentFrameId);
        assert(child);
        assert.equal(
          (
            await inspector.evaluate({
              frameId: child.frameId,
              function: '() => document.title',
            })
          ).value,
          'Child frame',
        );
        const wait = browser.waitForTarget(
          target =>
            target.type() === 'other' && target.url().startsWith('blob:'),
        );
        await page.evaluate(async () => {
          await new Promise<void>(resolve => {
            const worker = new Worker(
              URL.createObjectURL(
                new Blob(
                  ['self.marker = "worker realm"; self.postMessage("ready");'],
                  {type: 'text/javascript'},
                ),
              ),
            );
            worker.onmessage = () => resolve();
          });
        });
        const worker = await wait;
        const updated = await inspector.listTargets();
        const target = updated.targets.find(
          target => target.url === worker.url(),
        );
        assert(target);
        assert.equal(
          (
            await inspector.evaluate({
              targetId: target.targetId,
              function: '() => self.marker',
            })
          ).value,
          'worker realm',
        );
      } finally {
        await inspector.dispose();
      }
    });
  });

  it('reads HttpOnly cookies and partition-aware storage through privileged APIs', async () => {
    server.addRoute('/runtime-storage', (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.setHeader(
        'Set-Cookie',
        'runtime-secret=hidden; HttpOnly; Path=/',
      );
      response.end('<title>Storage fixture</title>');
    });
    await withBrowser(async (browser, page) => {
      const inspector = new RuntimeInspector(
        browser,
        () => page,
        () => page,
      );
      try {
        await page.goto(server.getRoute('/runtime-storage'));
        assert.equal(
          await page.evaluate(() => document.cookie.includes('runtime-secret')),
          false,
        );
        const cookies = await inspector.cookies({action: 'list'});
        assert(
          cookies.cookies.some(
            cookie =>
              cookie.name === 'runtime-secret' &&
              cookie.httpOnly &&
              cookie.value === 'hidden',
          ),
        );
        await inspector.cookies({
          action: 'set',
          cookies: [
            {
              name: 'runtime-edit',
              domain: 'localhost',
              path: '/',
              value: 'new',
              httpOnly: true,
            },
          ],
        });
        await inspector.cookies({
          action: 'remove',
          cookies: [
            {name: 'runtime-edit', domain: 'localhost', path: '/', value: ''},
          ],
        });
        assert.equal(
          (await inspector.cookies({action: 'list'})).cookies.some(
            cookie => cookie.name === 'runtime-edit',
          ),
          false,
        );
        await page.evaluate(async () => {
          localStorage.setItem('runtime-token', 'storage-value');
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('runtime-db', 1);
            request.onupgradeneeded = () => {
              request.result.createObjectStore('tokens');
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const transaction = request.result.transaction(
                'tokens',
                'readwrite',
              );
              transaction.objectStore('tokens').put({token: 'db-value'}, 'key');
              transaction.oncomplete = () => {
                request.result.close();
                resolve();
              };
            };
          });
          const cache = await caches.open('runtime-cache');
          await cache.put('/cached-runtime', new Response('cache-body'));
        });
        const local = await inspector.storage({kind: 'local'});
        assert('entries' in local);
        assert.deepEqual(local.entries, [['runtime-token', 'storage-value']]);
        const db = await inspector.storage({kind: 'indexeddb'});
        assert(
          'databaseNames' in db && db.databaseNames.includes('runtime-db'),
        );
        const data = await inspector.storage({
          kind: 'indexeddb',
          databaseName: 'runtime-db',
          objectStoreName: 'tokens',
        });
        assert('entries' in data && data.entries?.length === 1);
        const cache = await inspector.storage({kind: 'cache'});
        assert(
          'caches' in cache &&
            cache.caches.some(item => item.cacheName === 'runtime-cache'),
        );
      } finally {
        await inspector.dispose();
      }
    });
  });

  it('captures dynamic scripts, pauses and inspects locals, then resumes at the deadline', async () => {
    await withBrowser(async (browser, page) => {
      const inspector = new RuntimeInspector(
        browser,
        () => page,
        () => page,
      );
      try {
        await inspector.debugger({action: 'start', timeoutMs: 2000});
        assert(inspector.hasDebugger(page));
        await inspector.debugger({
          action: 'breakpoint',
          kind: 'source',
          url: 'runtime-dynamic.js',
          lineNumber: 0,
          condition: 'false',
        });
        const frame = page.mainFrame();
        assert(frame instanceof CdpFrame);
        const pause = new Promise<void>(resolve =>
          frame._client().once('Debugger.paused', () => resolve()),
        );
        const operation = inspector.evaluate({
          world: 'main',
          function:
            '() => eval("(() => { const privateValue = 41; debugger; return privateValue + 1; })();\\n//# sourceURL=runtime-dynamic.js")',
        });
        await pause;
        const status = await inspector.debugger({action: 'status'});
        assert('paused' in status && status.paused);
        assert(inspector.isPaused(page));
        const callFrame = status.paused.callFrames[0];
        assert(callFrame);
        const inspected = await inspector.debugger({
          action: 'evaluate',
          callFrameId: callFrame.callFrameId,
          expression: 'privateValue',
        });
        assert('value' in inspected && inspected.value === 41);
        await assert.rejects(
          inspector.evaluate({function: '() => 1'}),
          /paused/,
        );
        await inspector.debugger({action: 'resume'});
        const value = await operation;
        assert.equal(value.value, 42);
        const scripts = await inspector.debugger({action: 'scripts'});
        assert('scripts' in scripts && scripts.scripts);
        const script = scripts.scripts.find(
          script => script.url === 'runtime-dynamic.js',
        );
        assert(script);
        await page.goto('about:blank');
        const source = await inspector.debugger({
          action: 'source',
          scriptId: script.scriptId,
        });
        assert(
          'scriptSource' in source &&
            source.scriptSource?.includes('privateValue'),
        );
        const pausedAgain = new Promise<void>(resolve =>
          frame._client().once('Debugger.paused', () => resolve()),
        );
        const resumedAtDeadline = inspector.evaluate({
          world: 'main',
          function: '() => { debugger; return 43; }',
        });
        await pausedAgain;
        assert(inspector.isPaused(page));
        assert.equal((await resumedAtDeadline).value, 43);
        assert.equal(inspector.hasDebugger(page), false);
      } finally {
        await inspector.dispose();
      }
    });
  });
});
