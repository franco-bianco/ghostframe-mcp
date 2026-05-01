<!-- AUTO GENERATED DO NOT EDIT - run 'npm run gen' to update-->

# Chrome DevTools MCP Slim Tool Reference (~444 cl100k_base tokens)

- **[Navigation automation](#navigation-automation)** (1 tools)
  - [`navigate`](#navigate)
- **[Debugging](#debugging)** (2 tools)
  - [`evaluate`](#evaluate)
  - [`screenshot`](#screenshot)

## Navigation automation

### `navigate`

**Description:** Loads a URL

**Parameters:**

- **url** (string) **(required)**: URL to [`navigate`](#navigate) to

---

## Debugging

### `evaluate`

**Description:** Evaluates a JavaScript script

**Parameters:**

- **script** (string) **(required)**: JS script to run on the page
- **world** (enum: "isolated", "main") _(optional)_: Execution world. "isolated" (default, recommended for stealth) runs in a fresh isolated context invisible to page scripts; "main" runs in the same realm as page scripts. Use "main" only when same-realm access is required.

---

### `screenshot`

**Description:** Takes a [`screenshot`](#screenshot)

**Parameters:** None

---
