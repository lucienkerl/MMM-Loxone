# MMM-Loxone — Ground-Up Rebuild Design

**Date:** 2026-06-06
**Status:** Approved — spec reviewed; control bindings confirmed from the Structure File doc v17.0
**Author:** Lucien Kerl (with Claude)

---

## 1. Summary

Replace the existing `MMM-Loxone` module — which depends on the deprecated
[`LxCommunicator`](https://github.com/Loxone/LxCommunicator) library — with a from-scratch
implementation that:

1. Speaks the **current official Loxone Miniserver protocol** (token-based authentication,
   RSA/AES command encryption, RFC6455 WebSocket, binary event tables), per the Loxone documents
   *"Communicating with the Miniserver"* v16.0 (2025-06-03) and *"Structure File"* v17.0 (2026-03-31).
2. Renders **generic Loxone controls** plus **rich graphical renderers** for the **Wallbox** and
   the **Energy Flow Monitor** (Energieflussmonitor).
3. Is **read-only** in v1 (a command/write path is designed into the architecture but not exposed
   as UI).

The module replaces the current implementation **in place** in this repository, keeping the name
`MMM-Loxone`. The prior implementation remains available through git history as reference.

---

## 2. Context & Motivation

- The current module connects via `lxcommunicator`, which is deprecated and no longer maintained.
- The repository is kept by the user **only as reference**; the new module is a clean rewrite.
- Deployment target: **Raspberry Pi** running [MagicMirror²](https://github.com/MichMich/MagicMirror/).
- The user operates a real Miniserver with a Wallbox and Energy Flow Monitor and can provide an
  anonymized `LoxAPP3.json` structure file as a test fixture.

---

## 3. Design Decisions

| Topic | Decision |
|---|---|
| **Scope (v1)** | Broad generic control support + Wallbox & Energy Flow Monitor as special rich renderers |
| **Location** | Replace existing module in place (keep name `MMM-Loxone`); old code preserved via git history |
| **Connection / crypto** | Full token auth + RSA key exchange + AES command encryption over plain `ws` — universal across Miniserver Gen1 & Gen2, local & remote, no TLS certificate handling |
| **Interactivity** | Read-only display in v1; write/command path designed in but not surfaced |
| **Configuration** | Controls referenced by **name or UUID**; room/category by name; names may be room-qualified; ambiguity/not-found produce visible warnings |
| **Visual style** | "Hybrid": dark MagicMirror base + thin typography, with semantic color where it carries meaning (PV green, grid import red, storage blue) |
| **Energy Flow layout** | Radial — house-centric with animated directional flow arrows |
| **Icons** | Loxone's own SVG icons (fetched from the Miniserver, recolored to `currentColor`), with a built-in fallback |
| **Architecture** | Isolated, MagicMirror-independent protocol library + thin `node_helper` wrapper + frontend renderer registry |
| **Test data** | Anonymized `LoxAPP3.json` from the user's Miniserver, stored under `sample-data/` |

---

## 4. Scope

### In scope (v1)

- WebSocket connection, token authentication, RSA/AES command encryption, salt rotation.
- Structure-file (`LoxAPP3.json`) download, caching, parsing, and indexing.
- Binary message-header parsing and **Value** + **Text** event-table decoding.
- Generic renderers: `InfoOnlyAnalog`, `InfoOnlyDigital`, `TextState`, `Switch`, `Pushbutton`,
  `Dimmer`/slider, and optionally `IRoomControllerV2` (room temperature).
- Rich renderers: **Wallbox** and **Energy Flow Monitor** (radial).
- Name-based (and UUID-based) configuration with room/category selection and warning handling.
- Hybrid dark + semantic-color theme.
- Keepalive, reconnect with backoff, out-of-service handling, token refresh/persistence.

### Out of scope (v1) — explicit non-goals

- Interactive control (toggling switches, starting/stopping charging) and the visualization-password
  flow for secured commands. The command path is *designed* (see §7.4, §8.1) but **not** wired to UI.
- Rendering of **Daytimer** and **Weather** event tables. These frames are decoded safely and ignored.
- A dedicated WSS/TLS transport. The universal `ws` + app-layer encryption path is used instead;
  WSS may be added later behind the same `Transport` interface.
- A general third-party notification API for other MagicMirror modules (the old module's
  `LOXONE_STATE` / `allow3rdParty` broadcast). Can be reconsidered in a later milestone.
- Statistics / history charts (the `statistic` / `statisticV2` data and `StatisticV2` graphs). v1
  shows live state only.

---

## 5. Architecture

Three layers with strict boundaries. The protocol library has **no MagicMirror dependency** and is
unit-testable in isolation.

```
┌─ Frontend (Browser · Module.register) ───────────────────┐
│  MMM-Loxone.js   · lifecycle, config, DOM mount          │
│  renderers/      · registry, one renderer per control    │
│                    type (read-only tiles · Hybrid theme) │
└───────────▲──────────────────────────────────────────────┘
            │  MagicMirror socketNotification bridge
            │  (control meta · semantic state · status)
┌───────────┴─ node_helper.js  (thin wrapper) ─────────────┐
│  instantiates LoxoneClient, relays events ↔ MagicMirror  │
└───────────▲──────────────────────────────────────────────┘
            │  plain JS API + EventEmitter (no MM imports)
┌───────────┴─ lib/loxone/  (isolated client library) ─────┐
│  LoxoneClient   · state machine connect→auth→subscribe   │
│  transport/     · WebSocket, binary frame handling       │
│  auth/          · apiKey, getPublicKey, keyexchange,     │
│                   token acquire/auth/refresh/kill, store │
│  crypto/        · RSA, AES-CBC, HMAC, hashing            │
│  protocol/      · message header, event decoders, cmds   │
│  structure/     · LoxAPP3.json parse, index, name→uuid   │
│  model/         · Control / Room / Category              │
└───────────────────────────────────────────────────────────┘
```

**Rationale:** isolating the protocol into a pure-Node library with a small, explicit surface keeps
the hard parts (crypto, binary decoding, auth) independently testable and reasoned about, and keeps
the MagicMirror glue trivial.

---

## 6. Project Structure

The new layout (replacing the old `MMM-Loxone.js` / `node_helper.js` content and the
`scripts/`, `shared/` vendored files):

```
MMM-Loxone.js                  # frontend module
node_helper.js                 # thin wrapper: LoxoneClient ↔ MagicMirror
MMM-Loxone.css                 # Hybrid theme (dark, semantic color variables)
lib/loxone/
  index.js                     # exports LoxoneClient + public types
  LoxoneClient.js              # connection state machine, public API, EventEmitter
  transport/WebSocketTransport.js
  auth/Authenticator.js        # keyexchange + token lifecycle
  auth/TokenStore.js           # persist token per host+user to disk
  crypto/LoxoneCrypto.js       # RSA/AES/HMAC/hash via Node 'crypto'
  protocol/MessageHeader.js    # 8-byte header parser
  protocol/EventParser.js      # value/text/daytimer/weather table decoders
  protocol/commands.js         # command-string builders + salt rotation
  structure/Structure.js       # parse LoxAPP3.json, index, name/room resolution
  model/Control.js             # control + state-uuid↔name mapping
  IconCache.js                 # fetch icon SVG over WS, recolor to currentColor, cache
renderers/
  index.js                     # registry: control.type → Renderer
  BaseRenderer.js              # shared tile chrome (title, icon, color)
  GenericInfoRenderer.js       # InfoOnlyAnalog/Digital, TextState, Switch, Pushbutton, Dimmer
  RoomControllerRenderer.js    # optional: IRoomControllerV2 temperature
  WallboxRenderer.js
  EnergyFlowRenderer.js
  icons.js                     # frontend: inject provided SVG; built-in fallback icon map
translations/                  # en.json, de.json, nl.json, sv.json
sample-data/                   # anonymized LoxAPP3.json + synthetic binary fixtures
test/                          # unit tests + fixtures
package.json                   # deps: ws; devDeps: test runner, eslint
```

---

## 7. Protocol Library (`lib/loxone/`)

### 7.1 `LoxoneClient` — state machine & public API

Connection states proceed in order; failures route to `RECONNECT`:

```
INIT → API_KEY → PUBLIC_KEY → WS_OPEN → KEY_EXCHANGE → AUTH
     → STRUCTURE → SUBSCRIBE → LIVE
                         ↘ (close / OOS / error) → RECONNECT → WS_OPEN …
```

| State | Action |
|---|---|
| `API_KEY` | HTTP GET `http(s)://{host}/jdev/cfg/apiKey` → parse `snr`, `version`, `httpsStatus`, `local`, `hasEventSlots`. `hasEventSlots` gates a visible "no free live-update slots" warning (the Miniserver serves live updates to a limited number of concurrent clients); `local`/`httpsStatus` are recorded for diagnostics |
| `PUBLIC_KEY` | `jdev/sys/getPublicKey` → store RSA public key (normalize PEM `BEGIN/END` headers + line wrapping) |
| `WS_OPEN` | open `ws://{host}/ws/rfc6455`, WebSocket sub-protocol **`remotecontrol`** |
| `KEY_EXCHANGE` | generate AES-256 session key + IV; RSA-encrypt `"{keyHex}:{ivHex}"`; send `jdev/sys/keyexchange/{base64}` |
| `AUTH` | if a stored token is valid → authenticate with token; else acquire a new JWT (§7.3) |
| `STRUCTURE` | compare `jdev/sys/LoxAPPversion3` with cached `lastModified`; download `data/LoxAPP3.json` if stale; parse & index (§7.6); resolve configured names → UUIDs |
| `SUBSCRIBE` | `jdev/sps/enablebinstatusupdate` → receive initial event tables, then deltas |
| `LIVE` | decode binary frames → update state map → emit per-control semantic state |

**Constructor:** `new LoxoneClient({ host, user, password, permission = 'app', clientUuid, clientInfo, tokenStorePath, reconnectMaxBackoffMs = 60000 })`.

**Public methods:** `connect()`, `stop()` (kills token, closes socket), `getControl(idOrName)`,
`resolve(nameOrUuid)`.

**Emitted events:**

| Event | Payload | Meaning |
|---|---|---|
| `status` | `{ state, message }` | `connecting` \| `online` \| `offline` \| `oos` \| `error` |
| `structure` | `Structure` | parsed structure ready; includes resolved display controls |
| `controlState` | `(controlId, namedStates)` | one control's semantic state changed |
| `oos` | `boolean` | Miniserver out of service (reboot) toggled |
| `error` | `Error` | non-fatal error (logged; connection may continue) |
| `close` | `{ code }` | socket closed (triggers reconnect unless `stop()`ed) |

### 7.2 `WebSocketTransport`

- Wraps the `ws` client. Exposes `open(url, subprotocol)`, `sendText(str)`, `onText`, `onBinary`,
  `onClose`, `close()`.
- Maintains the **binary frame state machine**: each binary message is either an 8-byte
  **message header** or the **payload** announced by the most recent header. The transport pairs
  them and emits `(messageType, payloadBuffer)` to the protocol layer.
- Handles the *estimated* header flag: an estimated header is always followed by an exact header for
  the same payload; the transport waits for the exact header before reading the payload.

### 7.3 `Authenticator` & `TokenStore`

**Acquiring a JWT** (encrypted via command encryption, §7.4; permission `app` = long-lived):

1. `jdev/sys/getkey2/{user}` → `{ key (hex), salt (userSalt), hashAlg }` (`SHA1` or `SHA256`).
2. `pwHash = UPPERCASE( HASH( "{password}:{userSalt}", hashAlg ) )` (hex).
3. `hash = HMAC( hashAlg, key = hexToBytes(key), message = "{user}:{pwHash}" )` (hex, **case left
   unchanged**).
4. `jdev/sys/getjwt/{hash}/{user}/{permissionId}/{clientUuid}/{clientInfo}` (sent encrypted) →
   `{ token, validUntil, tokenRights, unsecurePass, key }`. `permissionId`: web=2, **app=4**.
5. Persist `{ token, validUntil, key }` via `TokenStore`.

**Authenticating with a stored token:**

1. `jdev/sys/getkey` → `{ key }`.
2. `hash = HMAC( hashAlg, key = hexToBytes(key), message = token )`.
3. WebSocket: `authwithtoken/{hash}/{user}`. (Since protocol 11.2 the token may be sent in plaintext;
   the hashed form is used for robustness.)

**Token lifecycle:**

- `refreshjwt/{tokenHash}/{user}` proactively before `validUntil` (refresh when remaining lifespan
  drops below a threshold, e.g. 20%). `validUntil` is **seconds since 2009-01-01 UTC**.
- `checktoken/{tokenHash}/{user}` to validate without renewing.
- `killtoken/{tokenHash}/{user}` on clean `stop()`.

**`TokenStore`:** persists one token record per `host+user` to a JSON file under `tokenStorePath`
(default: the module directory). Enables fast reconnect across restarts and avoids re-hammering the
Miniserver with logins. A failed token auth (401) clears the record and triggers a single
re-acquisition.

### 7.4 `LoxoneCrypto`

Implemented with Node's built-in `crypto` (no `node-forge`):

- **RSA:** `crypto.publicEncrypt({ key: publicKey, padding: RSA_PKCS1_PADDING }, payload)` → Base64.
  (ECB / PKCS1, no line wrapping.) Payload for key exchange is `"{keyHex}:{ivHex}"` — ~97 ASCII bytes
  (64 + 1 + 32), well within the RSA-2048 PKCS#1 v1.5 limit (≤245 bytes); the hex form is deliberate
  (the session key is *not* sent as raw bytes).
- **AES:** `aes-256-cbc`, 32-byte key, 16-byte IV, **Zero-byte padding** (manual: pad plaintext with
  `0x00` to a 16-byte boundary and disable Node's PKCS#7 padding via `cipher.setAutoPadding(false)`).
  Output Base64, then `encodeURIComponent`.
- **Command encryption:** plaintext = `"salt/{salt}/{cmd}"`; cipher = `encURI( base64( AES(plaintext) ) )`;
  request = `jdev/sys/enc/{cipher}` (response plain) or `jdev/sys/fenc/{cipher}` (response also AES,
  Base64). **Salt rotation:** periodically use `"nextSalt/{prevSalt}/{nextSalt}/{cmd}"` to defeat
  replay on the encrypted channel.
- **Hash / HMAC:** `SHA1` or `SHA256` strictly per the `hashAlg` returned by the relevant
  `getkey2`/`getvisusalt` request.

### 7.5 Binary Protocol (`MessageHeader`, `EventParser`)

**Message header (8 bytes):**

| Byte | Meaning |
|---|---|
| 0 | fixed `0x03` |
| 1 | message type (see below) |
| 2 | info flags; **bit 0 = estimated** |
| 3 | reserved |
| 4–7 | `uint32` little-endian payload length |

**Message types (byte 1):** `0` text, `1` binary file, `2` value-state table, `3` text-state table,
`4` daytimer table, `5` out-of-service indicator, `6` keepalive response, `7` weather table.

**Value-state record (24 bytes):** `uuid` (16) + `double` value (`float64` LE, 8).

**Text-state record:** `uuid` (16) + `iconUuid` (16) + `textLength` (`uint32` LE) + `text`
(`textLength` bytes) + zero-padding to the next multiple of 4.

**UUID (16 bytes):** `Data1` (`uint32` LE), `Data2` (`uint16` LE), `Data3` (`uint16` LE),
`Data4` (8 bytes). String form: `%08x-%04x-%04x-%02x%02x%02x%02x%02x%02x%02x%02x`
(e.g. `0d12f989-0060-c82f-ffff2083eaf2523c`).

**Daytimer / Weather:** decoded into well-formed objects per the documented structs but **not used**
in v1 (skipped after decoding). Type `5` toggles out-of-service; type `6` confirms keepalive.

### 7.6 `Structure`

- Parses `LoxAPP3.json`; indexes `controls` by UUID, `rooms` and `cats` by UUID and by (normalized)
  name. Exposes `globalStates` (e.g. notifications).
- For each control, builds a **state-uuid ↔ state-name** map from `control.states` so the live layer
  can translate raw state UUIDs into named, per-control semantic state.
- **Name resolution** (`resolve(entry)`): an entry is treated as a UUID if it matches the UUID format,
  otherwise as a name. Names may be room-qualified (`"Room/Name"` or `"Room: Name"`). Matching is
  case-insensitive and whitespace-trimmed. Results:
  - unique match → resolved control;
  - multiple matches → `AmbiguousNameError` carrying the candidates (with room names);
  - no match → `NotFoundError`.
- Controls with an **empty `type`** (per the doc, "should not be visualized") are excluded from name
  resolution and from room/category listings.
- A control's states arrive as either **value events** (numbers) or **text events** (strings — e.g.
  the Wallbox `session` JSON, `TextState.textAndIcon`, `iconAndColor`); `namedStates` returns whatever
  was last seen for each state UUID, regardless of kind.
- Caches the structure file + `lastModified` to disk for version checks.

### 7.7 State model

The library keeps an in-memory `Map<stateUuid, value>`. On each decoded event it updates the map and,
for any control that owns the changed state UUID, emits `controlState(controlId, namedStates)` where
`namedStates` is the control's full current semantic state (e.g. `{ active: true, value: 12.4 }`).
Only controls selected for display are tracked and emitted, to minimize traffic to the frontend.

---

## 8. MagicMirror Integration

### 8.1 `node_helper.js` (thin wrapper) & socket protocol

The helper instantiates `LoxoneClient`, subscribes to its events, and bridges to the frontend. It
performs **no protocol logic itself**. The command/write path exists here (the client can send
commands) but is not invoked by v1 UI.

**Socket notifications:**

| Direction | Notification | Payload |
|---|---|---|
| frontend → helper | `LOXONE_CONFIG` | the module `config` (sent once the DOM is ready) |
| helper → frontend | `LOXONE_CONTROLS` | array of display controls: `{ id, type, name, room, category, iconSvg, initialStates }` (the helper pre-fetches & recolors each icon node-side; `iconSvg` is a ready-to-inject SVG string, or `null` for the fallback) |
| helper → frontend | `LOXONE_STATE` | batched array of `{ id, states }` (semantic), coalesced every `updateThrottleMs` |
| helper → frontend | `LOXONE_STATUS` | `{ state, message }` (connection status) |
| helper → frontend | `LOXONE_WARNINGS` | array of `{ entry, reason, candidates? }` for unresolved config entries |

State updates are coalesced on the node side (default 250 ms) so the frontend re-renders at most a few
times per second regardless of Miniserver event volume.

### 8.2 Frontend module (`MMM-Loxone.js`)

- `defaults`, `getStyles()` (`MMM-Loxone.css`), `getTranslations()` (en/de/nl/sv), `requiresVersion`
  ≈ `2.25.0`.
- On `start()`/DOM ready: send `LOXONE_CONFIG`.
- On `LOXONE_CONTROLS`: build a view-model and instantiate the matching renderer per control via the
  registry; render the grid/list.
- On `LOXONE_STATE`: dispatch each `{ id, states }` to the owning renderer's `update(states)`; only
  affected tiles re-render.
- On `LOXONE_STATUS` / `LOXONE_WARNINGS`: update the status indicator and per-control warning tiles.
- No jQuery; plain DOM APIs.

---

## 9. Rendering

### 9.1 Registry & `BaseRenderer`

- `renderers/index.js`: `register(type, RendererClass)` and `resolve(control)`. `resolve` returns the
  registered special renderer for `control.type`; otherwise the `GenericInfoRenderer` chosen by the
  control's state shape.
- `BaseRenderer` provides the shared tile chrome (title, optional room label, icon slot, semantic
  color hooks) and the lifecycle: `render(control, initialStates) → HTMLElement` and
  `update(states) → void`. Renderer errors are caught by the frontend so one failing tile never
  breaks the module.

### 9.2 Generic renderers

| Control type | State(s) / details (confirmed) → rendering |
|---|---|
| `InfoOnlyAnalog` | state `value`; `details.format` (printf) → formatted value |
| `InfoOnlyDigital` | state `active` (0/1); `details.text.on/off`, `details.color.on/off`, optional `details.image.on/off` → on/off text in color |
| `InfoOnlyText` | state `text` (+ optional `details.format`) → the text |
| `TextState` | state `textAndIcon` (text); optional `iconAndColor` (JSON `{icon,color}`) → text |
| `Switch` / `Pushbutton` | state `active` (+ `lockedOn`) → label + on/off indicator (read-only) |
| `Dimmer` | states `position`, `min`, `max` → percentage + thin bar |
| `IRoomControllerV2` (optional) | `details.format` + temperature state (e.g. `tempActual`) → current temp; exact key bound from the fixture |

Number formatting reimplements the small printf subset Loxone uses (replacing the old `sprintf-js`
dependency) — sufficient for `details.format` strings such as `"%.1f°C"`.

### 9.3 Wallbox renderer — input contract

Control type **`Wallbox2`** (it embeds a **`Meter`**, so it also carries the Meter states).
`WallboxRenderer.update(states)` consumes a normalized object mapped from these **confirmed** states
(§15):

- `power` — current charging power (kW) ← Meter `actual` (fallback `session.power`) → headline + progress bar
- `connected` — vehicle plugged in ← state `connected`
- `active` — currently charging ← state `active` → status word, colored when active
- `enabled` — charging allowed ← state `enabled`
- `sessionEnergy` — energy this session (kWh) ← `session.energy`
- `totalEnergy` — cumulative energy (kWh) ← Meter `total`
- `limit` / `maxPower` — current limit (kW) ← state `limit`; max ← `details.max` (for the bar)

Note: `session` is a **text state** carrying a JSON object (`{ connect, disconnect, start, energy,
power, user, price }`) — the renderer `JSON.parse`s it. `connected`/`active`/`enabled`/`limit`/`actual`
are numeric value states.

### 9.4 Energy Flow renderer — radial, input contract

`EnergyFlowRenderer` draws an SVG radial diagram: **house at center**, sources around it, with
animated dashed flow lines whose direction encodes energy flow. Color semantics: production green,
grid-import red / grid-export green, storage blue, consumers neutral/green.

Input contract — mapped from the **`EnergyFlowMonitor`** control's **confirmed** top-level states (§15):

- `production` (kW) ← state `Ppwr`
- `grid` (kW, signed: **+ import / − export**) ← state `Gpwr`
- `storage` (kW, signed: **+ discharge / − charge**) ← state `Spwr`
- `consumption` (kW) ← **computed** as `Ppwr + Gpwr + Spwr` (energy balance: production + grid-import +
  storage-discharge − exports − charging = house load)
- `priceImport` / `priceExport` ← states `Pri` / `Pre`; `co2` ← state `CO2`
- `soc` (battery %, optional) ← a co-located `EnergyManager2` `Ssoc` if present (the EFM has no
  top-level SOC state)
- formats ← `details.actualFormat` (e.g. `"%.3f kW"`), `details.totalFormat`

The sign conventions come straight from the EFM `nodeType` definitions (Grid/Storage/Production), so
flow direction and arrowheads derive directly from the signs; the animation is paused when a flow is ~0.

**`efmLayout: "compact"`** is an alternative, space-minimal rendering of the *same* input contract:
one row per node (PV, grid, storage, house, extra consumers) with a directional arrow and value, no
diagram. Both layouts share the data mapping; only the DOM output differs.

### 9.5 Icons

Icon fetching lives on the **node side** (`lib/loxone/IconCache.js`), because the authenticated
WebSocket lives there — the frontend never opens the Miniserver connection. The helper fetches each
display control's icon by UUID over the WebSocket (`{iconUuid}.svg`), rewrites it to use
`fill="currentColor"`, caches it per UUID, and delivers the ready SVG string inline in
`LOXONE_CONTROLS` (`iconSvg`). The frontend simply injects that string into the tile, where it
inherits the tile's semantic color via CSS. When no SVG is available, `iconSvg` is `null` and the
frontend falls back to a small built-in icon map (`renderers/icons.js`) or a neutral default.

### 9.6 Visual theme (Hybrid)

`MMM-Loxone.css` defines CSS custom properties so colors are centrally tunable:

```
--lox-bg: transparent;          /* sits on the mirror's black */
--lox-fg: #ffffff;
--lox-muted: #888888;
--lox-production: #7bd06a;       /* PV / generation */
--lox-import: #ff6b6b;           /* grid import */
--lox-export: #7bd06a;           /* grid export */
--lox-storage: #5aa9ff;          /* battery */
--lox-consume: #9fe08a;          /* consumers / wallbox */
```

Typography is thin/light; chrome is minimal; color appears only on values, indicators, and flow
arrows. Tiles arrange in a `grid` (configurable `columns`) or `list`.

---

## 10. Configuration

```js
{
  module: "MMM-Loxone",
  position: "top_right",
  config: {
    host: "192.168.1.50",        // IP or CloudDNS address
    user: "mirror",
    password: "…",

    // What to show — name OR UUID; names may be room-qualified:
    controls: ["Wallbox", "Technik/Energieflussmonitor", "0d12f989-0060-c82f-ffff2083eaf2523c"],
    rooms: ["Wohnzimmer"],       // optional: all supported controls in these rooms
    categories: [],              // optional: all supported controls in these categories

    // Display
    layout: "grid",              // "grid" | "list"
    columns: 2,
    showRoomLabels: true,
    efmLayout: "radial",         // "radial" | "compact"
    updateThrottleMs: 250,

    // Behaviour
    permission: "app",           // token lifespan: "app" (long) | "web" (short)
    reconnectMaxBackoffMs: 60000
  }
}
```

Required: `host`, `user`, `password`, and at least one of `controls` / `rooms` / `categories`.
Missing required fields produce a clear configuration-error tile (mirroring the old module's behavior).

---

## 11. Error Handling

Guiding principle: **one failure must never take down the whole module.**

| Situation | Behaviour |
|---|---|
| Connection fails / WS close | Status tile "Connecting… / Offline"; auto-reconnect with exponential backoff (cap `reconnectMaxBackoffMs`) |
| Auth `401` (initial `getjwt` **or** `authwithtoken` with a stored token the Miniserver forgot, e.g. across its own reboot) | Invalidate the `TokenStore` record; re-acquire a fresh JWT **once**; if still `401`, show a configuration-error tile and stop hammering |
| Out-of-service / reboot (header type 5; close code 4007) | "Miniserver restarting…"; reconnect polling |
| Token near expiry | Proactive `refreshjwt`; on failure, fall back to full re-auth |
| Auth timeout (close code 4003 / response 420) | Treated as connection failure → backoff reconnect |
| User changed/disabled (close codes 4004–4006) | Surface status message; stop auto-retry for `4006` (user disabled) |
| Structure parse error / unresolved name | Per-control warning tile + log listing candidates (for ambiguity); other tiles keep working |
| Renderer throws | Caught by the frontend; only that tile shows an error |
| Binary decode error | Skip the frame and log; the connection continues |

A discreet status indicator (online / connecting / offline) is shown, and logging follows
MagicMirror's `Log` conventions.

---

## 12. Testing Strategy

Test-driven, concentrated on the isolated library (which needs no MagicMirror runtime):

- **Crypto:** known-answer vectors for AES-256-CBC with zero-byte padding, HMAC-SHA1/SHA256, the
  password hash, and the token hash.
- **Protocol:** `MessageHeader` parsing and `EventParser` decoding against **hand-built binary
  fixtures** for value and text tables, including estimated-header pairing and text padding; UUID
  byte→string conversion.
- **Structure:** parsing, indexing, and name/room resolution (unique / ambiguous / not-found) against
  the anonymized `LoxAPP3.json` fixture.
- **Auth flow:** the full `keyexchange → getkey2 → getjwt → authwithtoken` sequence against a **mock
  transport** (no real connection), asserting the exact command strings and that `getjwt` is
  encrypted.
- **Renderers:** state→DOM snapshot tests where practical (generic renderers and the Wallbox/EFM
  contract mapping).
- **Manual:** validation against the user's real Miniserver.

A lightweight test runner (e.g. Node's built-in `node:test`) is used to avoid heavy dependencies.

---

## 13. Dependencies & Target Environment

- **Runtime dependency:** `ws` (WebSocket client). Cryptography uses Node's built-in `crypto`.
- **Removed:** `lxcommunicator`, `jquery`, `q`, `when`, `sprintf-js`, `detect-rpi`, and the vendored
  `scripts/q.js` / `scripts/jquery.min.js` / `shared/lxEnums.js`.
- **Frontend:** vanilla JS + CSS (no jQuery).
- **Target:** Node 20+; MagicMirror `requiresVersion` ≈ `2.25.0`.

---

## 14. In-place Replacement / Migration

The new module overwrites the current implementation in this repository under the same name. The old
`lxcommunicator`-based implementation remains accessible through git history. The old files are **not**
copied into a `legacy/` directory by default (kept clean); this can be added on request.

`package.json` `version` is bumped to `2.0.0` to reflect the breaking rewrite. The README and
`CLAUDE.md` are updated to reflect the new architecture, configuration, and supported controls.

---

## 15. Confirmed control bindings (from the Structure File doc v17.0)

The special-renderer bindings are **confirmed** from the official *Structure File* doc — they are no
longer open questions:

| Renderer | Control `type` | Key states |
|---|---|---|
| `EnergyFlowRenderer` | `EnergyFlowMonitor` | `Ppwr`, `Gpwr`, `Spwr`, `Pri`, `Pre`, `CO2` (+ `details.actualFormat` / `totalFormat`) |
| `WallboxRenderer` | `Wallbox2` | `connected`, `enabled`, `active`, `mode`, `limit`, `session` (JSON text), + Meter `actual` / `total`; `details.min` / `max` |

`Meter` states (also embedded in `Wallbox2`): `actual` (current power), `total` (cumulative energy),
`totalNeg` (export, bidirectional), `storage` (battery type). Related types the registry may also map
in later milestones: `EnergyManager2` (carries `Ppwr/Gpwr/Spwr/Ssoc`), `PowerUnit`, `WallboxManager`.
The registry maps `type → renderer`, so adding aliases is a one-line change.

The anonymized `sample-data/LoxAPP3.json` remains the **end-to-end test fixture** (structure parsing,
name resolution, renderer snapshots) and confirms the concrete `states` UUIDs for the user's specific
install. If a control's `type` has no registered renderer, it falls back to the `GenericInfoRenderer`
(its raw states still display) rather than failing.

### Confirmed against the real install (`sample-data/LoxAPP3.json`, 278 controls)

Real `type` strings and state keys verified directly (note: the energy-flow control's real `type` is
**`EFM`**, not `EnergyFlowMonitor` — the latter is only the doc's section title):

| Renderer | `type`(s) | Confirmed state keys / details |
|---|---|---|
| EnergyFlow (radial) | `EFM`, `EnergyManager2` | EFM: `Ppwr`,`Gpwr`,`Spwr`,`Pre`,`Pri`,`CO2`,`selfConsumption`,`actual0..n`; `details.nodes[]` (title/icon/nodeType). EnergyManager2: `Ppwr`,`Gpwr`,`Spwr`,`Ssoc` (battery %), `MinSoc`,`MaxSpwr` |
| Wallbox | `Wallbox2` | `actual`,`total`,`connected`,`enabled`,`active`,`mode`,`limit`,`session`(JSON text),`pricePerkWh`; `details.min/max`,`actualFormat`,`totalFormat` |
| Meter (×34) | `Meter` | `actual`,`total`,`totalDay/Week/Month/Year`,`totalNeg*`(bi),`storage`(storage type); `details.type`(uni/bi/storage),`actualFormat`,`totalFormat`,`storageFormat`,`storageMax` |
| RoomController | `IRoomControllerV2` (×8) | `tempActual`,`tempTarget`,`comfortTemperature`,`currentMode`,`activeMode`; `details.format` |
| Generic | `InfoOnlyAnalog`(×81) `value`+`details.format`; `InfoOnlyDigital`(×12) `active`+`details.text/color`; `TextState`(×11) `textAndIcon`/`iconAndColor`; `Switch`(×31)/`Pushbutton`(×13) `active`; `Slider`(×10) `value`+`details.min/max/step` |

Every control may also carry a `jLocked` text status (ignored for display). Types without a renderer
(e.g. `LightControllerV2`, `Jalousie`, `AudioZoneV2`) fall back to the generic renderer in v1.

---

## 16. Implementation Sequence (milestones)

A suggested build order, each step independently testable:

1. **Crypto core** — `LoxoneCrypto` (RSA, AES-CBC/zero-pad, HMAC, hashing) + vectors.
2. **Binary protocol** — `MessageHeader` + `EventParser` + UUID conversion, against fixtures.
3. **Transport** — `WebSocketTransport` (text + binary frame state machine).
4. **Auth** — `Authenticator` + `TokenStore` against a mock transport.
5. **Structure** — `Structure` parsing/indexing/name resolution against the real fixture.
6. **LoxoneClient** — wire the state machine end to end; integrate live decode + state emission.
7. **node_helper bridge** — socket protocol + state coalescing.
8. **Frontend shell + registry + generic renderers** — render tiles, status, warnings.
9. **Wallbox renderer** — `Wallbox2` + Meter states (§15); parse the `session` JSON text state.
10. **Energy Flow renderer** — radial SVG + animation; `EnergyFlowMonitor` states `Ppwr/Gpwr/Spwr` (§15).
11. **Theme, translations, README/CLAUDE.md, package.json bump.**

---

## 17. Deferred hardening backlog (from Plan 1 review)

The Plan 1 library is correct and tested for the happy path. These spec-stated behaviors were
consciously deferred (tracked here, not silently dropped) — to be picked up during Plan 2 / live
testing against the real Miniserver:

- **Encrypt post-auth commands** over the enc channel (e.g. `enablebinstatusupdate`) to fully honor
  the "encrypted over ws" decision. Plain works once authenticated; confirm against a live server.
- **`killtoken` on clean `stop()`** (§7.3) so tokens don't accumulate on the Miniserver.
- **`LoxAPPversion3` version check + structure disk caching** (§7.1/§7.6) to avoid re-downloading the
  ~290 KB `LoxAPP3.json` on every connect.
- **`hasEventSlots` warning** (§7.1) when no free live-update slots are available.
- **Lifecycle test coverage**: reconnect/backoff path, keepalive timer, text-state → `controlState`
  end-to-end, and the stored-token-401 → clear → re-acquire branch.

Fixed immediately after the review (not deferred): the `npm run lint` scope, handshake response-code
checks, `Requester` rejecting in-flight requests on disconnect, and a `room`/`cat` null-match guard.
