# Installation

This is a private fork — not published to npm. Install from a local clone.

```sh
git clone <fork-url> ~/Documents/ghostframe-mcp
cd ~/Documents/ghostframe-mcp
npm install
npm run build
```

Then make the `ghostframe` command available on `PATH`:

```sh
npm link            # creates the global symlink
ghostframe status   # check it works
```

Or, if you prefer not to `npm link`, alias the local build in your shell rc:

```sh
alias ghostframe='node /absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe.js'
```

After pulling new commits, run `npm run build` again. The CLI symlink and any aliases keep working without changes.

## Troubleshooting

- **Command not found:** If `ghostframe` is not recognized after `npm link`, ensure your global npm `bin` directory is on your system's `PATH`. Restart your terminal or source your shell configuration file (e.g. `.bashrc`, `.zshrc`).
- **Permission errors during `npm link`:** Avoid `sudo`. Use a Node version manager (`nvm`, `fnm`) or configure npm to use a user-writable global prefix.
- **Old version running:** `ghostframe stop` to terminate the daemon, `git pull && npm run build` to refresh, then `ghostframe start`.
- **Coexisting with upstream:** This fork's bin names (`ghostframe`, `ghostframe-mcp`) are distinct from upstream's (`chrome-devtools`, `chrome-devtools-mcp`), so a global install of either will not shadow the other.
