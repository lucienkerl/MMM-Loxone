# MMM-Loxone

A [MagicMirror²](https://github.com/MichMich/MagicMirror/) module that connects to your Loxone Miniserver, subscribes to live control states, and displays them as a compact tile grid on the mirror. It is **read-only** — it displays state but sends no commands to the Miniserver.

## Features

- Token-based authentication (no permanent credential storage; tokens refreshed automatically)
- Name-or-UUID control selection — identify controls, rooms, or categories by human-readable name or UUID
- Supported control types out of the box: Energy-Flow Manager (EFM / EnergyManager2), Wallbox (Wallbox2), Meter, Intelligent Room Controller (IRoomControllerV2), InfoOnlyAnalog, InfoOnlyDigital, InfoOnlyText, TextState, Switch, Pushbutton, Slider. Unknown types fall back to a generic value renderer
- Hybrid dark theme with semantic color coding (green = production/export, red = import, blue = storage)
- Live state updates coalesced at a configurable throttle (default 250 ms)
- Automatic reconnection with exponential back-off

## Security

Please create a dedicated Loxone user for MagicMirror to keep your personal credentials secure.

## Installation

```shell
cd ~/MagicMirror/modules
git clone https://github.com/lucienkerl/MMM-Loxone
cd MMM-Loxone
npm install
```

## Update

```shell
cd ~/MagicMirror/modules/MMM-Loxone
git pull
npm install
```

## Configuration

Add the module to the `modules` array in `config/config.js`:

```js
{
    module: "MMM-Loxone",
    position: "bottom_left",
    config: {
        host: "192.168.0.46",       // Miniserver IP or CloudDNS address
        user: "mirror",
        password: "secret",

        // Select what to display — names or UUIDs; mix freely
        controls: ["PV-Anlage", "Wallbox Garage", "0d12f989-0060-c82f-ffff2083eaf2523c"],
        rooms: ["Wohnzimmer"],       // show all controls in these rooms
        categories: ["Energie"],    // show all controls in these categories

        // Layout
        layout: "grid",             // "grid" or "list"
        columns: 2,                 // columns when layout = "grid"
        showRoomLabels: true,       // show room name in tile header

        // Energy-Flow (EFM)
        efmLayout: "radial",        // currently only "radial"

        // Advanced
        updateThrottleMs: 250,      // batch state updates over this window
        permission: "app",          // Loxone token permission level
        reconnectMaxBackoffMs: 60000
    }
}
```

### Configuration options

| Option | Required | Default | Description |
|---|---|---|---|
| `host` | Yes | — | Miniserver IP or CloudDNS address |
| `user` | Yes | — | Loxone username |
| `password` | Yes | — | Loxone password |
| `controls` | No | `[]` | Names or UUIDs of specific controls to display |
| `rooms` | No | `[]` | Room names or UUIDs — all controls in these rooms are shown |
| `categories` | No | `[]` | Category names or UUIDs — all controls in these categories are shown |
| `layout` | No | `"grid"` | `"grid"` or `"list"` |
| `columns` | No | `2` | Number of grid columns |
| `showRoomLabels` | No | `true` | Show room name label in each tile header |
| `efmLayout` | No | `"radial"` | Energy-Flow layout; `"radial"` (radial SVG) |
| `updateThrottleMs` | No | `250` | State-update coalesce window in milliseconds |
| `permission` | No | `"app"` | Loxone token permission (`"app"` or `"web"`) |
| `reconnectMaxBackoffMs` | No | `60000` | Maximum reconnect back-off in milliseconds |

## Supported controls

| Loxone type | Display |
|---|---|
| `EFM`, `EnergyManager2` | Energy-flow radial SVG (production, grid, storage, consumption) |
| `Wallbox2` | Charging power, progress bar, session energy, status badge |
| `Meter` | Power, cumulative energy, optional storage bar |
| `IRoomControllerV2` | Current and target temperature |
| `InfoOnlyAnalog` | Formatted numeric value |
| `InfoOnlyDigital` | On/off text with configurable color |
| `InfoOnlyText` | Raw text |
| `TextState` | Text with state color |
| `Switch`, `Pushbutton` | On/Off state |
| `Slider` | Value with progress bar |
| *(unknown)* | First available state value as text |

## License

MIT © David Gölzhäuser / Lucien Kerl
