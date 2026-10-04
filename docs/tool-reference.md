<!-- AUTO GENERATED DO NOT EDIT - run 'npm run gen' to update-->

# ghostframe-mcp Tool Reference (~13639 cl100k_base tokens)

- **[Input automation](#input-automation)** (9 tools)
  - [`click`](#click)
  - [`drag`](#drag)
  - [`fill`](#fill)
  - [`fill_form`](#fill_form)
  - [`handle_dialog`](#handle_dialog)
  - [`hover`](#hover)
  - [`press_key`](#press_key)
  - [`type_text`](#type_text)
  - [`upload_file`](#upload_file)
- **[Navigation automation](#navigation-automation)** (6 tools)
  - [`close_page`](#close_page)
  - [`list_pages`](#list_pages)
  - [`navigate_page`](#navigate_page)
  - [`new_page`](#new_page)
  - [`select_page`](#select_page)
  - [`wait_for`](#wait_for)
- **[Emulation](#emulation)** (2 tools)
  - [`emulate`](#emulate)
  - [`resize_page`](#resize_page)
- **[Network](#network)** (13 tools)
  - [`arm_interception`](#arm_interception)
  - [`arm_network_wait`](#arm_network_wait)
  - [`get_network_request`](#get_network_request)
  - [`get_proxy`](#get_proxy)
  - [`list_network_requests`](#list_network_requests)
  - [`read_capture`](#read_capture)
  - [`read_interception`](#read_interception)
  - [`read_network_wait`](#read_network_wait)
  - [`resolve_interception`](#resolve_interception)
  - [`set_blocked_urls`](#set_blocked_urls)
  - [`set_proxy`](#set_proxy)
  - [`start_capture`](#start_capture)
  - [`stop_capture`](#stop_capture)
- **[Debugging](#debugging)** (17 tools)
  - [`call_handle`](#call_handle)
  - [`cancel_operation`](#cancel_operation)
  - [`debugger_control`](#debugger_control)
  - [`evaluate_script`](#evaluate_script)
  - [`get_console_message`](#get_console_message)
  - [`get_event_listeners`](#get_event_listeners)
  - [`get_operation`](#get_operation)
  - [`inspect_handle`](#inspect_handle)
  - [`inspect_storage`](#inspect_storage)
  - [`list_console_messages`](#list_console_messages)
  - [`list_targets`](#list_targets)
  - [`release_handles`](#release_handles)
  - [`runtime_evaluate`](#runtime_evaluate)
  - [`session_cookies`](#session_cookies)
  - [`start_action`](#start_action)
  - [`take_screenshot`](#take_screenshot)
  - [`take_snapshot`](#take_snapshot)

## Input automation

### `click`

**Description:** Clicks on the provided element

**Parameters:**

- **uid** (string) **(required)**: The uid of an element on the page from the page content snapshot
- **dblClick** (boolean) _(optional)_: Set to true for double clicks. Default is false.
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `drag`

**Description:** [`Drag`](#drag) an element onto another element

**Parameters:**

- **from_uid** (string) **(required)**: The uid of the element to [`drag`](#drag)
- **to_uid** (string) **(required)**: The uid of the element to drop into
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `fill`

**Description:** Type text into an input, text area or select an option from a &lt;select&gt; element.

**Parameters:**

- **uid** (string) **(required)**: The uid of an element on the page from the page content snapshot
- **value** (string) **(required)**: The value to [`fill`](#fill) in
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `fill_form`

**Description:** [`Fill`](#fill) out multiple form elements at once

**Parameters:**

- **elements** (array) **(required)**: Elements from snapshot to [`fill`](#fill) out.
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `handle_dialog`

**Description:** If a browser dialog was opened, use this command to handle it

**Parameters:**

- **action** (enum: `"accept"`, `"dismiss"`) **(required)**: Whether to dismiss or accept the dialog
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **promptText** (string) _(optional)_: Optional prompt text to enter into the dialog.

---

### `hover`

**Description:** [`Hover`](#hover) over the provided element

**Parameters:**

- **uid** (string) **(required)**: The uid of an element on the page from the page content snapshot
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `press_key`

**Description:** Press a key or key combination. Use this when other input methods like [`fill`](#fill)() cannot be used (e.g., keyboard shortcuts, navigation keys, or special key combinations).

**Parameters:**

- **key** (string) **(required)**: A key or a combination (e.g., "Enter", "Control+A", "Control++", "Control+Shift+R"). Modifiers: Control, Shift, Alt, Meta
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `type_text`

**Description:** Type text using keyboard into a previously focused input

**Parameters:**

- **text** (string) **(required)**: The text to type
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **submitKey** (string) _(optional)_: Optional key to press after typing. E.g., "Enter", "Tab", "Escape"

---

### `upload_file`

**Description:** Upload a file through a provided element.

**Parameters:**

- **filePath** (string) **(required)**: The local path of the file to upload
- **uid** (string) **(required)**: The uid of the file input element or an element that will open file chooser on the page from the page content snapshot
- **includeSnapshot** (boolean) _(optional)_: Whether to include a snapshot in the response. Default is false.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

## Navigation automation

### `close_page`

**Description:** Closes the page by its index. The last open page cannot be closed.

**Parameters:**

- **pageId** (number) **(required)**: The ID of the page to close. Call [`list_pages`](#list_pages) to list pages.

---

### `list_pages`

**Description:** Get a list of pages open in the browser.

**Parameters:** None

---

### `navigate_page`

**Description:** Go to a URL, or back, forward, or reload. Use project URL if not specified otherwise.

**Parameters:**

- **allowList** (string) _(optional)_: Optional comma-separated list of URL patterns to allow. If provided, all other navigations will be blocked.
- **handleBeforeUnload** (enum: `"accept"`, `"decline"`) _(optional)_: Whether to auto accept or beforeunload dialogs triggered by this navigation. Default is accept.
- **ignoreCache** (boolean) _(optional)_: Whether to ignore cache on reload.
- **initScript** (string) _(optional)_: A JavaScript script to be executed on each new document before any other scripts for the next navigation.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **timeout** (integer) _(optional)_: Maximum wait time in milliseconds. If set to 0, the default timeout will be used.
- **type** (enum: `"url"`, `"back"`, `"forward"`, `"reload"`) _(optional)_: Navigate the page by URL, back or forward in history, or reload.
- **url** (string) _(optional)_: Target URL (only type=url)

---

### `new_page`

**Description:** Open a new tab and load a URL. Use project URL if not specified otherwise.

**Parameters:**

- **url** (string) **(required)**: URL to load in a new page.
- **allowList** (string) _(optional)_: Optional comma-separated list of URL patterns to allow. If provided, all other navigations will be blocked.
- **background** (boolean) _(optional)_: Whether to open the page in the background without bringing it to the front. Default is false (foreground).
- **isolatedContext** (string) _(optional)_: If specified, the page is created in an isolated browser context with the given name. Pages in the same browser context share cookies and storage. Pages in different browser contexts are fully isolated.
- **timeout** (integer) _(optional)_: Maximum wait time in milliseconds. If set to 0, the default timeout will be used.

---

### `select_page`

**Description:** Select a page as a context for future tool calls.

**Parameters:**

- **pageId** (number) **(required)**: The ID of the page to select. Call [`list_pages`](#list_pages) to get available pages.
- **bringToFront** (boolean) _(optional)_: Whether to focus the page and bring it to the top.

---

### `wait_for`

**Description:** Wait for the specified text to appear on the selected page.

**Parameters:**

- **text** (array) **(required)**: Non-empty list of texts. Resolves when any value appears on the page.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **timeout** (integer) _(optional)_: Maximum wait time in milliseconds. If set to 0, the default timeout will be used.

---

## Emulation

### `emulate`

**Description:** Emulates various features on the selected page.

**Parameters:**

- **colorScheme** (enum: `"dark"`, `"light"`, `"auto"`) _(optional)_: [`Emulate`](#emulate) the dark or the light mode. Set to "auto" to reset to the default.
- **cpuThrottlingRate** (number) _(optional)_: Represents the CPU slowdown factor. Omit or set the rate to 1 to disable throttling
- **geolocation** (string) _(optional)_: Geolocation (`&lt;latitude&gt;x&lt;longitude&gt;`) to [`emulate`](#emulate). Latitude between -90 and 90. Longitude between -180 and 180. Omit to clear the geolocation override.
- **locale** (string) _(optional)_: Locale (e.g. `en-US`, `de-DE`) to use for `navigator.language`, `Intl` APIs, and the `Accept-Language` header. Omit to clear the locale override.
- **networkConditions** (enum: `"Offline"`, `"Slow 3G"`, `"Fast 3G"`, `"Slow 4G"`, `"Fast 4G"`) _(optional)_: Throttle network. Omit to disable throttling.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **timezone** (string) _(optional)_: IANA timezone identifier (e.g. `America/Los_Angeles`) used to override the page's timezone. Omit to clear the timezone override.
- **userAgent** (string) _(optional)_: User agent to [`emulate`](#emulate). Set to empty string to clear the user agent override.
- **userAgentMetadata** (string) _(optional)_: User-Agent Client Hints metadata sent alongside the UA override, encoded as a JSON object string. Recognized keys: brands (array of {brand, version}), fullVersionList (array of {brand, version}), fullVersion, platform, platformVersion, architecture, model, mobile (bool), bitness, wow64 (bool). Used to keep `navigator.userAgent` and `Sec-CH-UA-*` headers in sync. Omit to clear when no userAgent is provided.
- **viewport** (string) _(optional)_: [`Emulate`](#emulate) device viewports as 'WIDTHxHEIGHTxDPR' optionally followed by ',mobile', ',touch', and/or ',landscape' (e.g. '1280x720x1', '412x823x1.75,mobile,touch'). 'touch' and 'mobile' [`emulate`](#emulate) mobile devices; 'landscape' emulates landscape mode.

---

### `resize_page`

**Description:** Resizes the selected page's window so that the page has specified dimension

**Parameters:**

- **height** (number) **(required)**: Page height
- **width** (number) **(required)**: Page width
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

## Network

### `arm_interception`

**Description:** Arm a one-shot request or response pause. Returns immediately. Trigger traffic with [`start_action`](#start_action), [`read_interception`](#read_interception), then [`resolve_interception`](#resolve_interception). The deadline continues unchanged traffic unless body consumption has begun: complete bodies are reconstructed, incomplete bodies abort.

**Parameters:**

- **urlPattern** (string) **(required)**: CDP URL wildcard pattern, for example _/api/orders_. Use a narrow pattern.
- **method** (string) _(optional)_: Optional HTTP method filter.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **stage** (enum: `"request"`, `"response"`) _(optional)_: Pause before sending a request, or before delivering its response. Default: request.
- **timeout** (integer) _(optional)_: Deadline in milliseconds for triggering and resolving the pause. Default: 30000.

---

### `arm_network_wait`

**Description:** Arm a network observation before triggering an action. Returns immediately so it does not hold the browser tool queue. Then perform the action and inspect [`read_network_wait`](#read_network_wait). Only future page traffic can match.

**Parameters:**

- **method** (string) _(optional)_
- **pageId** (integer) _(optional)_
- **phase** (enum: `"request"`, `"response"`, `"finished"`) _(optional)_
- **timeout** (integer) _(optional)_: Expiry in milliseconds. Default 30000.
- **url** (string) _(optional)_: URL substring to match.

---

### `get_network_request`

**Description:** Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.

**Parameters:**

- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **reqid** (number) _(optional)_: The reqid of the network request. If omitted returns the currently selected request in the DevTools Network panel.
- **requestFilePath** (string) _(optional)_: The absolute or relative path to a .network-request file to save the request body to. If omitted, the body is returned inline.
- **responseFilePath** (string) _(optional)_: The absolute or relative path to a .network-response file to save the response body to. If omitted, the body is returned inline.

---

### `get_proxy`

**Description:** Get effective native Chrome proxy settings, scope and connection switching limitations. Proxy credentials are omitted.

**Parameters:** None

---

### `list_network_requests`

**Description:** List all requests for the currently selected page since the last navigation.

**Parameters:**

- **includePreservedRequests** (boolean) _(optional)_: Set to true to return the preserved requests over the last 3 navigations.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **pageIdx** (integer) _(optional)_: Page number to return (0-based). When omitted, returns the first page.
- **pageSize** (integer) _(optional)_: Maximum number of requests to return. When omitted, returns all requests.
- **resourceTypes** (array) _(optional)_: Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.

---

### `read_capture`

**Description:** Read capture journal records using a cursor. Bodies are immutable file references. Raw extra-info events preserve ordering and explicitly report unresolved redirect-hop associations. Filtering advances the cursor over scanned records.

**Parameters:**

- **captureId** (string) **(required)**
- **cursor** (integer) _(optional)_
- **kind** (string) _(optional)_: Journal event kind, such as request, response, response_body, websocket_message or action.
- **limit** (integer) _(optional)_
- **method** (string) _(optional)_
- **url** (string) _(optional)_: URL substring filter.

---

### `read_interception`

**Description:** Read the actual paused request or response. Header output reflects Fetch events; use capture extra-info for missing cookie headers. includeBody starts a bounded background stream read and returns immediately; poll again for completion. Consuming the body requires fulfillment or abort. Continue, cancel and expiry reconstruct a complete captured original; incomplete consumed bodies abort on cancel or expiry.

**Parameters:**

- **interceptionId** (string) **(required)**: ID from [`arm_interception`](#arm_interception).
- **includeBody** (boolean) _(optional)_: Start or poll a bounded response body stream read. A complete result contains base64 bytes. Default: false.
- **maxBodyBytes** (integer) _(optional)_: Maximum retained body bytes. Set on the first read; later polls preserve that limit. Default and maximum: 1048576.

---

### `read_network_wait`

**Description:** Read the nonblocking network observation status: pending, matched, timed_out or cancelled. A matched observation includes the event metadata without header/body values.

**Parameters:**

- **observationId** (string) **(required)**

---

### `resolve_interception`

**Description:** Continue or mutate a paused request, replace its actual response, abort it, or cancel the rule. This acts on browser traffic without replaying a new request.

**Parameters:**

- **action** (enum: `"continue"`, `"fulfill"`, `"abort"`, `"cancel"`) **(required)**: How to release the pause. cancel removes the rule and continues untouched traffic or reconstructs a complete consumed body; incomplete consumed bodies abort.
- **interceptionId** (string) **(required)**: ID from [`arm_interception`](#arm_interception).
- **body** (string) _(optional)_: Replacement response body, required for fulfill.
- **bodyEncoding** (enum: `"utf8"`, `"base64"`) _(optional)_: Encoding of replacement body. Default: utf8.
- **headers** (array) _(optional)_: Complete replacement headers in Header-Name: value format. Duplicate names are supported.
- **method** (string) _(optional)_: Replacement request method, for continue at request stage.
- **postData** (string) _(optional)_: Replacement UTF-8 request body, for continue at request stage.
- **status** (integer) _(optional)_: Replacement response status, for fulfill. Defaults to the original status or 200.
- **url** (string) _(optional)_: Replacement request URL, for continue at request stage.

---

### `set_blocked_urls`

**Description:** Block requests for URLs matching any of the given patterns. Patterns may include the \* wildcard. Pass an empty array to clear all blocks. Useful for blocking trackers, ad networks, or fingerprint-collection endpoints during stealth runs.

**Parameters:**

- **patterns** (array) **(required)**: URL patterns to block. Wildcard `*` matches any character sequence. Examples: `*.doubleclick.net*`, `https://example.com/track/*`. Pass an empty array to clear.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `set_proxy`

**Description:** Change the regular Chrome profile proxy after launch while preserving tabs and page state. Existing connections and streams may continue on their old route. Explicit context proxy overrides may differ. Changing previously configured credentials on the same host/port is unsupported because Chrome may cache authentication. Does not verify connectivity or route UDP/WebRTC traffic.

**Parameters:**

- **mode** (enum: `"direct"`, `"proxy"`) **(required)**: Choose direct access or a single upstream proxy.
- **bypassList** (array) _(optional)_: Chrome proxy bypass rules. Chrome also bypasses loopback/link-local hosts implicitly.
- **connectionPolicy** (enum: `"new_connections"`, `"disconnect_existing"`) _(optional)_: Only new_connections is supported. disconnect_existing fails without changing settings because native Chrome exposes no explicit socket close control here.
- **password** (string) _(optional)_: HTTP/HTTPS proxy password.
- **server** (string) _(optional)_: Proxy URL (http, https, socks4 or socks5), or host:port. Required in proxy mode. Supply credentials separately.
- **username** (string) _(optional)_: HTTP/HTTPS proxy username.

---

### `start_capture`

**Description:** Start durable passive network capture. Saves metadata and eager bodies across navigations and page closure. Covers page primary sessions; independent workers and browser background traffic are excluded. Collected header values and body contents are saved unchanged. Optional fetch streaming uses experimental CDP support and reports gaps.

**Parameters:**

- **directory** (string) _(optional)_: Parent directory for a unique capture folder. Defaults to a temporary directory.
- **maxBodyBytes** (integer) _(optional)_: Maximum size of each body/chunk. Default 5 MiB.
- **maxTotalBytes** (integer) _(optional)_: Capture byte budget. Default 100 MiB; terminal gap records can exceed it slightly.
- **pageId** (integer) _(optional)_: Capture only this page. Omit to capture all pages and future tabs.
- **streaming** (boolean) _(optional)_: Capture fetch/EventSource response chunks using experimental streamResourceContent. Default false. WebSocket and EventSource messages are always captured.

---

### `stop_capture`

**Description:** Stop a network capture and flush pending bodies and its journal. Artifacts remain readable after stopping.

**Parameters:**

- **captureId** (string) **(required)**

---

## Debugging

### `call_handle`

**Description:** Invoke an actual retained function with its original closure. Optional thisHandle sets the receiver. Execution may change page state; a source string does not replace the retained closure.

**Parameters:**

- **handle** (string) **(required)**
- **args** (string) _(optional)_: JSON array of {value: JSON} or {handle: ID} arguments.
- **returnMode** (enum: `"value"`, `"handle"`) _(optional)_
- **thisHandle** (string) _(optional)_

---

### `cancel_operation`

**Description:** Stop loading for a navigation, or terminate JavaScript execution on the action page. JavaScript termination can also stop unrelated scripts in that page.

**Parameters:**

- **operationId** (string) **(required)**: Operation ID to cancel.

---

### `debugger_control`

**Description:** Manage an explicit bounded debugger investigation: start/status/stop/resume, source/function/XHR/event breakpoints, scripts/source, or paused-frame evaluation. Enabling Debugger changes runtime behavior and timing; it is not guaranteed stealth-safe. Session automatically resumes/stops at its deadline. Use [`start_action`](#start_action) to trigger actions that can pause.

**Parameters:**

- **action** (enum: `"start"`, `"status"`, `"stop"`, `"resume"`, `"breakpoint"`, `"remove_breakpoint"`, `"scripts"`, `"source"`, `"evaluate"`) **(required)**
- **breakpointId** (string) _(optional)_
- **callFrameId** (string) _(optional)_
- **columnNumber** (integer) _(optional)_
- **condition** (string) _(optional)_
- **eventName** (string) _(optional)_
- **expression** (string) _(optional)_
- **frameId** (string) _(optional)_: Frame ID from [`list_targets`](#list_targets); defaults to the main frame.
- **handle** (string) _(optional)_
- **kind** (enum: `"source"`, `"function"`, `"xhr"`, `"event"`) _(optional)_
- **lineNumber** (integer) _(optional)_
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **returnMode** (enum: `"value"`, `"handle"`) _(optional)_
- **scriptId** (string) _(optional)_
- **targetId** (string) _(optional)_: Target ID from [`list_targets`](#list_targets). Specify targetId or pageId.
- **timeoutMs** (integer) _(optional)_: Session deadline; default 60000, maximum 300000ms.
- **url** (string) _(optional)_
- **world** (enum: `"isolated"`, `"main"`) _(optional)_: Isolated by default for pages; workers have only main world.

---

### `evaluate_script`

**Description:** Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON,
so returned values have to be JSON-serializable.

**Parameters:**

- **function** (string) **(required)**: A JavaScript function declaration to be executed by the tool in the currently selected page.
  Example without arguments: `() => {
  return document.title
}` or `async () => {
  return await fetch("example.com")
}`.
  Example with arguments: `(el) => {
  return el.innerText;
}`

- **args** (array) _(optional)_: An optional list of arguments to pass to the function.
- **dialogAction** (string) _(optional)_: Handle dialogs while execution. "accept", "dismiss", or string for response of window.prompt. Defaults to accept.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **world** (enum: `"isolated"`, `"main"`) _(optional)_: Execution world. "isolated" (default when no args/element UIDs are passed; recommended for stealth) runs in a fresh isolated context invisible to page scripts and to Function.prototype.toString patching detection. "main" runs in the same realm as page scripts. Defaults to "main" when args contain element UIDs, since element handles can only be evaluated in the realm that created them. Has no effect when evaluating in a service worker.

---

### `get_console_message`

**Description:** Gets a console message by its ID. You can get all messages by calling [`list_console_messages`](#list_console_messages).

**Parameters:**

- **msgid** (number) **(required)**: The msgid of a console message on the page from the listed console messages
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `get_event_listeners`

**Description:** Inspect currently registered listeners on a snapshot element and, optionally, its ancestors/document/window. Returns function handles and source coordinates without enabling Debugger. Framework delegation may expose a dispatcher rather than the application callback.

**Parameters:**

- **uid** (string) **(required)**: Element UID from a current snapshot.
- **includeAncestors** (boolean) _(optional)_: Default true, to include delegated handlers.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `get_operation`

**Description:** Read the state and result of an action. This call does not wait for completion.

**Parameters:**

- **operationId** (string) **(required)**: Operation ID from [`start_action`](#start_action).

---

### `inspect_handle`

**Description:** Inspect remote properties, getter/setter handles and available engine internal/private properties including function scopes. Does not invoke getters. Engine visibility is version-dependent; optimized variables may be unavailable.

**Parameters:**

- **handle** (string) **(required)**
- **ownProperties** (boolean) _(optional)_: Default true; false includes inherited properties.

---

### `inspect_storage`

**Description:** Inspect local/session storage, IndexedDB database/store entries, or CacheStorage in an explicit frame storage key. Defaults to the frame storage key so partitioned storage is addressed correctly. IndexedDB object values can be retained handles.

**Parameters:**

- **kind** (enum: `"local"`, `"session"`, `"indexeddb"`, `"cache"`) **(required)**
- **cacheId** (string) _(optional)_
- **databaseName** (string) _(optional)_
- **frameId** (string) _(optional)_: Frame ID from [`list_targets`](#list_targets); defaults to the main frame.
- **objectStoreName** (string) _(optional)_
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **pageSize** (integer) _(optional)_
- **requestURL** (string) _(optional)_
- **skipCount** (integer) _(optional)_
- **storageKey** (string) _(optional)_
- **targetId** (string) _(optional)_: Target ID from [`list_targets`](#list_targets). Specify targetId or pageId.
- **world** (enum: `"isolated"`, `"main"`) _(optional)_: Isolated by default for pages; workers have only main world.

---

### `list_console_messages`

**Description:** List all console messages for the currently selected page since the last navigation.

**Parameters:**

- **includePreservedMessages** (boolean) _(optional)_: Set to true to return the preserved messages over the last 3 navigations.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **pageIdx** (integer) _(optional)_: Page number to return (0-based). When omitted, returns the first page.
- **pageSize** (integer) _(optional)_: Maximum number of messages to return. When omitted, returns all messages.
- **types** (array) _(optional)_: Filter messages to only return messages of the specified resource types. When omitted or empty, returns all messages.

---

### `list_targets`

**Description:** List live page/worker targets and frame IDs for explicit runtime investigation. Does not enable the debugger or global auto-attachment.

**Parameters:** None

---

### `release_handles`

**Description:** Release retained remote handles. Omit handles to release all investigation handles.

**Parameters:**

- **handles** (array) _(optional)_

---

### `runtime_evaluate`

**Description:** Execute a JavaScript function in an explicit page frame or worker. Return a value or retain a remote handle for non-JSON objects and functions. Handles expire on navigation/target destruction. For actions that may pause on a breakpoint, use [`start_action`](#start_action).

**Parameters:**

- **function** (string) **(required)**: JavaScript function declaration to invoke.
- **args** (string) _(optional)_: JSON array of {value: JSON} or {handle: ID}; handles must share the target/frame/world.
- **frameId** (string) _(optional)_: Frame ID from [`list_targets`](#list_targets); defaults to the main frame.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **returnMode** (enum: `"value"`, `"handle"`) _(optional)_
- **targetId** (string) _(optional)_: Target ID from [`list_targets`](#list_targets). Specify targetId or pageId.
- **world** (enum: `"isolated"`, `"main"`) _(optional)_: Isolated by default for pages; workers have only main world.

---

### `session_cookies`

**Description:** Read, set or remove cookies in a page browser context, including HttpOnly cookies. Cookie mutations require explicit set/remove action and exact cookie scope.

**Parameters:**

- **action** (enum: `"list"`, `"set"`, `"remove"`) **(required)**
- **cookies** (string) _(optional)_: JSON array of cookies: name/domain, value for set, optional path/secure/httpOnly/expires/sameSite/partitionKey. Remove matches exact name/domain/path/partition.
- **pageId** (number) _(optional)_: Targets a specific page by ID.

---

### `start_action`

**Description:** Start an action and return an operation ID immediately. Use this before a breakpoint or request interception. Read progress with [`get_operation`](#get_operation).

**Parameters:**

- **action** (enum: `"navigate"`, `"click"`, `"fill"`, `"type_text"`, `"press_key"`, `"evaluate"`, `"call_handle"`) **(required)**: Browser action to start.
- **args** (string) _(optional)_: JSON array of {value: JSON} or {handle: ID} arguments for evaluation or a handle call.
- **frameId** (string) _(optional)_: Explicit frame for evaluation. Get IDs from [`list_targets`](#list_targets).
- **function** (string) _(optional)_: JavaScript function for an evaluate action, for example () => fetch("/api").then(r => r.json()).
- **handle** (string) _(optional)_: Retained function handle for a [`call_handle`](#call_handle) action.
- **key** (string) _(optional)_: Key or combination for a [`press_key`](#press_key) action, for example Enter or Control+A.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **returnMode** (enum: `"value"`, `"handle"`) _(optional)_: Return a JSON value or retain a remote handle. Default: value.
- **targetId** (string) _(optional)_: Explicit runtime target for evaluation. Get IDs from [`list_targets`](#list_targets).
- **text** (string) _(optional)_: Text to type into the focused input for a [`type_text`](#type_text) action.
- **thisHandle** (string) _(optional)_: Retained receiver for a [`call_handle`](#call_handle) action.
- **timeout** (integer) _(optional)_: Observation deadline in milliseconds. Default: 30000. Expiry does not stop JavaScript.
- **uid** (string) _(optional)_: Snapshot element UID for a [`click`](#click) action.
- **url** (string) _(optional)_: URL for a navigate action.
- **value** (string) _(optional)_: Replacement field value for a [`fill`](#fill) action.
- **world** (enum: `"main"`, `"isolated"`) _(optional)_: Evaluation world. Default: main.

---

### `take_screenshot`

**Description:** Take a screenshot of the page or element.

**Parameters:**

- **filePath** (string) _(optional)_: The absolute path, or a path relative to the current working directory, to save the screenshot to instead of attaching it to the response.
- **format** (enum: `"png"`, `"jpeg"`, `"webp"`) _(optional)_: Type of format to save the screenshot as. Default is "png"
- **fullPage** (boolean) _(optional)_: If set to true takes a screenshot of the full page instead of the currently visible viewport. Incompatible with uid.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **quality** (number) _(optional)_: Compression quality for JPEG and WebP formats (0-100). Higher values mean better quality but larger file sizes. Ignored for PNG format.
- **uid** (string) _(optional)_: The uid of an element on the page from the page content snapshot. If omitted, takes a page screenshot.

---

### `take_snapshot`

**Description:** Take a text snapshot of the currently selected page based on the a11y tree. The snapshot lists page elements along with a unique
identifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot. The snapshot indicates the element selected
in the DevTools Elements panel (if any).

**Parameters:**

- **filePath** (string) _(optional)_: The absolute path, or a path relative to the current working directory, to save the snapshot to instead of attaching it to the response.
- **pageId** (number) _(optional)_: Targets a specific page by ID.
- **verbose** (boolean) _(optional)_: Whether to include all possible information available in the full a11y tree. Default is false.

---
