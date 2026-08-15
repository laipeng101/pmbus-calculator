# PMBus Protocol Calculator

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

A fully client-side, zero-dependency PMBus data-format calculator that runs entirely in the browser.  
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
- 📦 **PMBus command dictionary** — quick-load typical parameters for 13 standard PMBus 1.3 commands (e.g. `VOUT_COMMAND`, `READ_IOUT`, `STATUS_WORD`).
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

### Legacy single-file (works today)

The calculator is a single self-contained HTML file — no build step, no server required.

**Option A — open locally:**

1. Clone or download the repository.
2. Open `pmbus-calculator.html` directly in any modern browser.

**Option B — GitHub Pages / any static host:**

Deploy `pmbus-calculator.html` to any static hosting service (GitHub Pages, Netlify, etc.) and access it via URL.

### New web app (work in progress)

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
4. Use the **PMBus command dictionary** dropdown to pre-load typical parameters for a known command.
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

The built-in dictionary covers the following PMBus 1.3 commands with pre-filled typical parameters:

| Command               | Code   | Format                  |
| --------------------- | ------ | ----------------------- |
| `VOUT_COMMAND`        | `0x21` | LINEAR16                |
| `VOUT_OV_FAULT_LIMIT` | `0x40` | LINEAR16                |
| `READ_VOUT`           | `0x8B` | LINEAR16                |
| `READ_VIN`            | `0x88` | LINEAR11                |
| `READ_IOUT`           | `0x8C` | LINEAR11                |
| `READ_TEMPERATURE_1`  | `0x8D` | LINEAR11                |
| `VIN_OV_FAULT_LIMIT`  | `0x55` | LINEAR11                |
| `OT_FAULT_LIMIT`      | `0x4F` | LINEAR11                |
| `FAN_COMMAND`         | `0x3B` | LINEAR11                |
| `READ_POUT`           | `0x96` | LINEAR11                |
| `READ_FAN_SPEED_1`    | `0x90` | LINEAR11                |
| `STATUS_WORD`         | `0x79` | Status bits             |
| `READ_EIN`            | `0x86` | BLOCK (block read note) |

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

> **Current status:** The legacy `pmbus-calculator.html` remains fully functional. The new web app has L11 and L16 fully bidirectional, with DIRECT and HALF decode available; the M4.5 stabilisation gate (quality gates, E2E, docs) is the current focus before continuing DIRECT.

---

## Browser Compatibility

Any modern browser that supports ES6+ (Chrome 60+, Firefox 55+, Safari 12+, Edge 79+).

---

## License

This project is licensed under the [MIT License](LICENSE).
