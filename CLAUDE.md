# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MMM-Loxone is a third-party module for [MagicMirror²](https://github.com/MichMich/MagicMirror/). It connects a MagicMirror to a Loxone Miniserver (home automation) over a WebSocket, subscribes to live control states, and renders them as a tile grid on the mirror. It is **read-only** (no commands sent to the Miniserver). Targets Raspberry Pi / Node 20+. There is no standalone app — it is loaded by a host MagicMirror install from `~/MagicMirror/modules/MMM-Loxone`.

## Commands

```shell
# Node 20+ is required — prefix every node/npm/npx command:
export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH"

npm install            # install runtime + dev deps (ws, eslint)
npm test               # node --test  (requires Node 20+)
npm run lint           # eslint lib test renderers MMM-Loxone.js node_helper.js
node --check MMM-Loxone.js   # syntax only (browser globals — cannot execute)
node --check node_helper.js  # syntax only (requires MM node_helper at runtime)
```

ESLint config (`.eslintrc.json`) enforces **tabs**, **double quotes**, `max-len` 250, mandatory braces, and `"strict": "error"`. Match this style in all JS files.

## Architecture

The module runs in **two separate processes** that communicate through MagicMirror's socket-notification bridge.

```
node_helper.js  ──────────────────────────────  MMM-Loxone.js
  (Node 20+)                                      (browser)
  lib/loxone                                      renderers/viewmodels.js
  lib/bridge                                      renderers/render.js
     │                 LOXONE_CONFIG →
     │                 ← LOXONE_CONTROLS
     │                 ← LOXONE_STATE
     │                 ← LOXONE_STATUS
     │                 ← LOXONE_WARNINGS
```

### `lib/loxone/` — isolated Loxone library (Plan 1, Node only)

Self-contained library with no MagicMirror dependency. Submodules:

- **`crypto/`** — AES-256-CBC + RSA key exchange (Node `crypto`)
- **`protocol/`** — binary WebSocket frame parser (header type, value-event, text-event, keepalive)
- **`auth/`** — HMAC-SHA1/SHA256 token acquisition + refresh + `TokenStore` (JSON file)
- **`structure/`** — `Structure` parses `LoxAPP3.json`; resolves controls by name/UUID, room names, category names, `namedStates()`, `referencedControlUuids()` (an EFM's node/sub-control subtree), `controlsByType()`, `linkState()` (attach another control's state, e.g. SoC, to a control)
- **`transport/`** — `WebSocketTransport` WebSocket wrapper with reconnect and back-off; `open()` is time-bounded
- **`IconCache.js`** — fetches + caches control SVG icons over HTTP
- **`LoxoneClient.js`** — public entry point; EventEmitter emitting `status`, `oos`, `warnings`, `controlState`, `structure`, `error`. `_resolveDisplay()` builds the display set from `controls`/`rooms`/`categories`; with `hideEfmChildren` (default on) it drops the meters an EFM is built from so they don't duplicate as tiles (explicitly listed controls win). `_linkEfmSoc()` feeds a battery SoC (from a lone `EnergyManager2`, or `efmSocControl`) into each displayed EFM so its storage node shows the charge %

Entry point: `lib/loxone/index.js` (exports `{ LoxoneClient }`).

### `lib/bridge/` — MagicMirror glue (Node only, CommonJS)

- **`Coalescer.js`** — batches rapid `controlState` events into a single array flush within a configurable window (default 250 ms)
- **`controlMeta.js`** — `toControlMeta(control, structure)` maps a structure control to the wire meta object (`id/type/name/room/category/iconUuid/details`)
- **`clientId.js`** — `getOrCreateClientId(filePath)` persists a stable UUID for the Loxone token client

### `node_helper.js` — MagicMirror backend (Node only)

`NodeHelper.create` wiring:

1. On `LOXONE_CONFIG`: instantiates `LoxoneClient` + `Coalescer`, attaches event listeners, calls `client.connect()`
2. `structure` event → `publishControls()`: builds meta + pre-fetches SVG icons → sends `LOXONE_CONTROLS`
3. `controlState` → `Coalescer.push()` → batch → sends `LOXONE_STATE`
4. `status` / `oos` → sends `LOXONE_STATUS`
5. `warnings` → sends `LOXONE_WARNINGS`

### `renderers/` — dual-mode view-model + render layer (browser + Node)

Both files are IIFEs that export to `module.exports` under Node (for unit tests) and to `self.LoxRender` in the browser. `getScripts()` loads `viewmodels.js` **before** `render.js`.

- **`viewmodels.js`** — pure functions: `formatLox`, `infoAnalogVM`, `infoDigitalVM`, `infoTextVM`, `textStateVM`, `switchVM`, `sliderVM`, `meterVM`, `roomControllerVM`, `wallboxVM`, `energyFlowVM`. No DOM dependency.
- **`render.js`** — `buildRegistry()` maps control types to `{ render, update, toVM }` renderer objects. DOM builders (tiles, progress bars, radial EFM SVG) are browser-only; registry creation is testable under Node.

### `MMM-Loxone.js` — MagicMirror frontend module (browser only)

`Module.register` using `getStyles`/`getScripts`/`getTranslations`/`start`/`socketNotificationReceived`/`getDom`. On receiving `LOXONE_CONTROLS` it rebuilds the tile grid; `LOXONE_STATE` batches call `renderer.update()` in-place (no full `updateDom()`).

## Testing

Tests live in `test/`. Run with `npm test` (requires Node 20+).

Current suite (110 tests total across Plans 1 + 2), one `test/<name>.test.js` per unit:

- **Protocol library:** `crypto`, `uuid`, `messageHeader`, `frameAssembler`, `eventParser`, `commands`,
  `response`, `tokenStore`, `authenticator`, `structure`, `publicKey`, `apiKey`, `http`, `backoff`,
  `requester`, `webSocketTransport`, `iconCache`, `loxoneClient`, `index`
- **MagicMirror layer:** `viewmodels` (view-model pure functions), `render` (registry completeness),
  `coalescer` (state-update batching), `bridge-helpers` (`toControlMeta` + `getOrCreateClientId`)

DOM builders, `MMM-Loxone.js`, and CSS are validated visually by running the mirror (no jsdom dependency).

## Spec and plan locations

- **Design spec:** `docs/superpowers/specs/2026-06-06-mmm-loxone-rebuild-design.md`
- **Implementation plan (Plan 2):** `docs/superpowers/plans/2026-06-07-loxone-magicmirror-module.md`
- **Plan 1 (lib/loxone):** `docs/superpowers/plans/` (previous plan)

## Runtime artifacts (gitignored)

- `.loxone-tokens.json` — persisted auth tokens
- `.loxone-client-uuid` — stable client UUID
- `sample-data/LoxAPP3.json` — real structure file (may contain credentials)
