# PMBus Protocol Calculator

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

A fully client-side PMBus data-format calculator with no backend that runs entirely in the browser.<br>
It supports **LINEAR11 (L11)**, **LINEAR16 / VOUT (L16)**, **DIRECT**, and **IEEE 754 Half-Precision (HALF)** encoding schemes as defined in the PMBus 1.3 specification.

---

## Table of Contents

- [Features](#features)
- [Supported Formats](#supported-formats)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [PMBus Command Dictionary](#pmbus-command-dictionary)
- [Tech Stack](#tech-stack)
- [Browser Compatibility](#browser-compatibility)
- [License](#license)

---

## Features

- 🔁 **Bidirectional conversion** — L11 and L16 are fully bidirectional; DIRECT/HALF decode is available and their encode loops are the next milestones.
- 📐 **Four encoding modes** — LINEAR11, LINEAR16 (VOUT), DIRECT, and IEEE 754 Half-Precision.
- 🔲 **Interactive bit-field viewer** — a 16-bit clickable register view with nibble-level grouping and live hex preview per nibble.
- 📋 **One-click copy** — copy the raw hex value, the decoded physical value, or a ready-to-paste C macro.
- 📦 **PMBus command dictionary** — standard command definitions (code, transaction, units, spec, encoding rule) for 13 PMBus 1.3 commands; optional `project-demo` presets are applied only on explicit request.
- ♾️ **Optimal N auto-selection** — for LINEAR11 mode, the tool automatically finds the N exponent that minimises representation error.
- 🌙 **Light / Dark mode** — respects `prefers-color-scheme` and supports a manual toggle.
- 📱 **Fully responsive** — sticky result panel, adaptive grid, and touch-optimised controls for mobile.
- 🔒 **N-lock toggle** — lock the exponent to a fixed value when fine-tuning firmware registers.
- ⚙️ **VOUT_MODE support** — configure the `VOUT_MODE (0x20)` byte to set the LINEAR16 exponent.
- 🔢 **Byte-order control** — switch between little-endian (PMBus standard) and big-endian byte display.
- 🔐 **Content Security Policy** — production build injects a strict CSP meta tag; no external requests, no tracking.

---

## Supported Formats

| Mode                | Description                                                     | Formula                       |
| ------------------- | --------------------------------------------------------------- | ----------------------------- |
| **LINEAR11**        | 11-bit mantissa + 5-bit signed exponent                         | `X = Y × 2^N`                 |
| **LINEAR16 (VOUT)** | 16-bit unsigned mantissa, exponent from `VOUT_MODE`             | `X = V × 2^N`                 |
| **DIRECT**          | Linear transform with three device-specific coefficients        | `X = (1/m) × (Y × 10^−R − b)` |
| **IEEE Half**       | IEEE 754 binary16 (1-bit sign, 5-bit exponent, 10-bit mantissa) | standard half-precision float |

---

## Usage

### Legacy single-file (read-only fallback)

`pmbus-calculator.html` is a single self-contained HTML file — no build step, no server required.
It remains in the repository root as a **read-only legacy fallback** for existing URLs and
offline single-file use. It is no longer under active feature development; the new web app is the primary tool.

**Option A — open locally:**

1. Clone or download the repository.
2. Open `pmbus-calculator.html` directly in any modern browser.

**Option B — GitHub Pages / any static host:**

Deploy `pmbus-calculator.html` to any static hosting service (GitHub Pages, Netlify, etc.) and access it via URL.

### New web app (primary)

```bash
npm install
npm run dev      # starts Vite dev server at http://localhost:5173
npm run build    # production build to dist/
npm test         # runs Vitest
```

**Workflow:**

1. Select an encoding mode tab (LINEAR11 / LINEAR16 / DIRECT / IEEE Half).
2. Enter a raw hex value **or** a physical value — the other fields update automatically.
3. Click individual bits in the register view to toggle them and observe the effect.
4. Use the **PMBus command dictionary** dropdown to inspect a standard command definition; if a `project-demo` preset is available, click **Apply project-demo preset** to explicitly load it.
5. Click **📋 Hex**, **📋 值**, or **C 代码** to copy the result in your preferred format.

---

## Keyboard Shortcuts

| Shortcut   | Action                             |
| ---------- | ---------------------------------- |
| `Ctrl + 1` | Switch to LINEAR11 mode            |
| `Ctrl + 2` | Switch to LINEAR16 (VOUT) mode     |
| `Ctrl + 3` | Switch to DIRECT mode              |
| `Ctrl + 4` | Switch to IEEE Half-Precision mode |

---

## PMBus Command Dictionary

The built-in dictionary records what PMBus specifies for 13 standard commands. Selecting a command only shows its definition; it does not auto-apply parameters. Optional `project-demo` presets must be applied explicitly and are never standard defaults.

| Command               | Code   | Encoding rule                  |
| --------------------- | ------ | ------------------------------ |
| `VOUT_COMMAND`        | `0x21` | follows VOUT_MODE              |
| `VOUT_OV_FAULT_LIMIT` | `0x40` | follows VOUT_MODE              |
| `READ_VOUT`           | `0x8B` | follows VOUT_MODE              |
| `READ_VIN`            | `0x88` | device-defined (datasheet)     |
| `READ_IOUT`           | `0x8C` | device-defined (datasheet)     |
| `READ_TEMPERATURE_1`  | `0x8D` | device-defined (datasheet)     |
| `VIN_OV_FAULT_LIMIT`  | `0x55` | device-defined (datasheet)     |
| `OT_FAULT_LIMIT`      | `0x4F` | device-defined (datasheet)     |
| `FAN_COMMAND_1`       | `0x3B` | device-defined (datasheet)     |
| `READ_POUT`           | `0x96` | device-defined (datasheet)     |
| `READ_FAN_SPEED_1`    | `0x90` | device-defined (datasheet)     |
| `STATUS_WORD`         | `0x79` | status bit field               |
| `READ_EIN`            | `0x86` | block read (more than 16 bits) |

---

## Tech Stack

### Legacy (single-file, still works)

- **Pure HTML + CSS + Vanilla JavaScript** — no frameworks, no dependencies.
- CSS custom properties for full light/dark theming.
- Strict Content Security Policy.

### New Web App (under construction)

- **Vite** + **React 19** + **TypeScript** — modern component-based architecture.
- **Tailwind CSS** + CSS variables — design-token-driven theming.
- **Vitest** — unit testing for PMBus math core and reducer/view-model.
- **Playwright** — real-user E2E flows across desktop and mobile Chromium projects.
- See [`AGENTS.md`](AGENTS.md), [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/WEB_REFACTOR_PLAN.md`](docs/WEB_REFACTOR_PLAN.md) for the full refactor plan.

> **Current status:** The new web app has L11 / L16 / DIRECT / HALF fully bidirectional and is the primary tool. The legacy `pmbus-calculator.html` remains at the repository root as a read-only fallback for old URLs and offline single-file use.

---

## Browser Compatibility

Current versions of Chrome, Edge, Firefox, and Safari. The E2E suite runs against desktop and mobile Chromium (Pixel 7); other browsers are not yet covered by automated tests.

---

## License

This project is licensed under the [MIT License](LICENSE).
