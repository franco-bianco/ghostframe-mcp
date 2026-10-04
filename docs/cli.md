# Ghostframe CLI

The `ghostframe` CLI runs MCP tools from a terminal.
Commands share a background daemon and its Chrome instance.
Use it to inspect website flows, save traffic, and perform controlled API experiments.

Follow the [Documentation guidelines](documentation-guidelines.md) when you change this guide.
See the [Investigation guide](investigation.md) for complete browser procedures and capability limits.

## Requirements

Build the local repository before you use the CLI:

```sh
npm run build
```

The package is private.
It is not available from npm.
Run the local executable directly:

```sh
node /absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe.js status
```

For the examples below, put `ghostframe` on your PATH with `npm link`:

```sh
npm link
ghostframe --help
```

The executable names differ from upstream.
You can install Ghostframe and `chrome-devtools-mcp` on the same machine.

## Start and stop the daemon

1. Run `ghostframe status` to inspect the daemon state.
2. Run a browser tool to start the daemon if needed.

   ```sh
   ghostframe new_page "https://example.com"
   ```

3. Run further commands against the same browser.
4. Run `ghostframe stop` when the session is complete.

The CLI uses a local socket on Linux and macOS.
It uses a named pipe on Windows.
The daemon remains active between commands.
Open pages and browser state remain available while it runs.

Use `ghostframe start` to select launch settings.
This command restarts an existing daemon in the selected session.
A restart closes its browser and removes live handles, operations, and capture IDs.
Saved capture files remain on disk.

The CLI starts headless Chrome by default.
The direct MCP server starts headed Chrome by default.
Use `--headless=false` on `start` when you need a visible browser.

## Select a profile

The CLI uses a temporary profile by default.
That profile is removed when Chrome closes.
Use `--userDataDir` to keep cookies and storage between runs:

```sh
ghostframe start --userDataDir "$HOME/.cache/ghostframe-personas/research"
```

To use the standard persistent CLI profile, pass `--isolated=false`:

```sh
ghostframe start --isolated=false
```

Its path is `$HOME/.cache/ghostframe-cli/chrome-profile`.
Non-stable channels add a channel suffix.
The direct MCP server uses a separate `ghostframe-mcp` directory.

A daemon session and a browser profile are different scopes.
The session ID selects which daemon receives commands.
The profile directory selects persisted Chrome state.
Chrome permits one browser process per profile directory.

For concurrent browsers, use distinct session IDs and profile directories:

```sh
ghostframe start --sessionId research-a --userDataDir "$HOME/.cache/ghostframe-personas/a"
ghostframe start --sessionId research-b --userDataDir "$HOME/.cache/ghostframe-personas/b"
ghostframe list_pages --sessionId research-a
ghostframe stop --sessionId research-a
ghostframe stop --sessionId research-b
```

Use the same session ID on each command for that browser.
Omitting `--sessionId` selects the default daemon.

## Use tool arguments

The command form is:

```sh
ghostframe <tool> <required arguments> --optionalName value
```

Required arguments are positional.
Optional arguments use flags with the schema's exact name.
Tool flags use names such as `--pageId`, `--filePath`, and `--returnMode`.
Run `ghostframe <tool> --help` to check argument order and values.

Quote JavaScript and JSON strings.
The shell must pass them as one argument.

```sh
ghostframe take_snapshot
ghostframe click "1_4"
ghostframe fill "1_8" "search query"
ghostframe runtime_evaluate '() => window.appClient' --world main --returnMode handle
```

Take a current snapshot before you use an element UID.
Handles from runtime inspection have a different lifetime and scope.
See [Runtime objects and functions](investigation.md#inspect-runtime-objects-and-functions).

## Change the proxy during a run

1. Read the current route.

   ```sh
   ghostframe get_proxy
   ```

2. Select the new proxy.

   ```sh
   ghostframe set_proxy proxy --server "http://proxy.example.com:8888"
   ```

3. Inspect the effective settings.

   ```sh
   ghostframe get_proxy
   ```

4. Select direct access when required.

   ```sh
   ghostframe set_proxy direct
   ```

These commands preserve the running browser.
Use them to change the regular profile route after launch.
Existing tunnels and sockets can keep their earlier route.

Supply HTTP credentials with `--username` and `--password` when required.
CLI arguments can appear in process listings.
Use MCP tool calls when credentials must stay out of those listings.

Chrome can cache authentication for a proxy host and port.
Changed or removed credentials for the same endpoint are rejected.
See [Proxy changes](investigation.md#change-the-proxy-after-launch) for scope and connection limits.

Launch-time proxy selection is still available:

```sh
ghostframe start --proxyServer "http://proxy.example.com:8888"
```

Use `GHOSTFRAME_PROXY_USERNAME` and `GHOSTFRAME_PROXY_PASSWORD` for launch-time HTTP authentication.
Both variables are required together.
Authenticated SOCKS proxies are unsupported.

## Capture a flow

1. Start capture before the interaction.

   ```sh
   ghostframe start_capture --maxBodyBytes 5242880 --maxTotalBytes 104857600
   ```

2. Save the returned capture ID and directory.
3. Perform the browser interaction.
4. Read the capture records.

   ```sh
   ghostframe read_capture capture-1 --cursor 0 --limit 100
   ```

5. Stop capture after the flow.

   ```sh
   ghostframe stop_capture capture-1
   ```

Use the actual returned capture ID in later commands.
Capture headers are redacted by default.
Bodies are saved unchanged.
The journal reports known gaps and size limits.

For paused requests or breakpoints, use `start_action`.
It returns an operation ID immediately.
You can then inspect and release the pause with another command.
See [Request experiments](investigation.md#change-a-real-request) and
[Scoped debugger](investigation.md#use-a-scoped-debugger).

## Read output and save files

Tool output defaults to Markdown.
Use `--output-format=json` for machine-readable output:

```sh
ghostframe list_pages --output-format=json
```

The CLI returns structured content when the tool supplies it.
Otherwise, it serializes the content entries.
Image output is saved to a temporary file.

The daemon does not advertise workspace roots to the MCP server.
With default file access, tool outputs must use the system temporary directory.
Use a tool's default temporary output when available.
See [File access](../README.md#file-access) before you select other paths.

## Launch settings and troubleshooting

Launch settings apply through `ghostframe start`.
Tool parameters apply to the running browser.
Changing a tool parameter does not restart Chrome.

Common launch settings are `--userDataDir`, `--isolated`, `--headless`, and `--channel`.
Use `ghostframe start --help` for the supported CLI launch settings.
The CLI does not expose the server's startup `viewport` option.

For connection failures, inspect `ghostframe status`.
Stop the selected daemon before you start a replacement.

To record debug logs, start the daemon with logging enabled:

```sh
DEBUG='mcp:*' ghostframe start --logFile /tmp/ghostframe-debug.log
```

This command restarts the default daemon.
Changing `DEBUG` for a later client command does not change an existing daemon's environment.
See [Troubleshooting](troubleshooting.md) for browser and setup failures.

## Regenerate CLI commands

The generator reads the current MCP tool metadata.
It writes `src/bin/ghostframe-cli-options.ts`.
Do not edit that file manually.

After a tool schema changes:

1. Run `npm run build`.
2. Run `npm run cli:generate`.
3. Run `npm run format`.

The CLI omits `fill_form` and `wait_for`.
Use their MCP tools when the flow requires them.
