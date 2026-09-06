# PMBus Numeric-Format Calculator

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

A fully client-side **PMBus numeric-format calculator** with no backend that runs entirely in the browser.
It supports bidirectional conversion for **LINEAR11 (L11)**, **LINEAR16 / VOUT (L16)**, **DIRECT**, and **IEEE 754 Half-Precision (HALF / binary16)** encoding schemes.

> **Scope:** this tool converts numeric formats; it is **not** a PMBus/SMBus controller, bus-transport implementation, command executor, device-profile engine, or conformance test suite. It covers the common numeric-format semantics across multiple PMBus revisions and does **not** claim full PMBus 1.5 protocol compliance (including the 1.5 security extensions).
>
> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys `v3.2.0`)
>
> **Stable version:** [`v3.2.0`](https://github.com/laipeng101/pmbus-calculator/releases/tag/v3.2.0) · [Releases](https://github.com/laipeng101/pmbus-calculator/releases) · [SHA256SUMS.txt](https://github.com/laipeng101/pmbus-calculator/releases/download/v3.2.0/SHA256SUMS.txt)

---

## Table of Contents

- [Features](#features)
- [Supported Formats](#supported-formats)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [PMBus Command Reference](#pmbus-command-reference)
- [Tech Stack](#tech-stack)
- [Browser Compatibility](#browser-compatibility)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Features

- 🔁 **Bidirectional conversion** — L11, L16, DIRECT, and HALF are fully bidirectional (encode/decode loops are implemented).
- 📐 **Four encoding modes with a unified calculation walkthrough** — each mode shows fields → generic formula → numeric substitution → intermediate values → result; L16 exposes the VOUT_MODE bit layout and refuses to fabricate a LINEAR16 voltage for relative/non-LINEAR modes.
- 🔲 **Interactive bit mappings** — the 16-bit panel sits directly below Raw Word, with clickable bits, nibble hex values and field legends. Both it and the VOUT_MODE 8-bit panel open by default; each remembers its collapsed state across mode changes and reloads. Hex and parameter editing remain available when collapsed.
- 🧭 **Result context** — the result shows its raw word, format and parameter source, including L16 reference availability and the current DIRECT coefficients.
- 📋 **One-click copy** — copy the raw hex value, the decoded physical value, or a ready-to-paste C macro.
- 📖 **Read-only PMBus command reference** — a collapsed reference panel listing command code, transactions, data type, units, format source and spec section for 13 PMBus 1.3 commands. It never switches mode, injects parameters, or rewrites raw; no demo presets are shipped.
- ♾️ **Optimal N auto-selection** — for LINEAR11 mode, the tool automatically finds the N exponent that minimises representation error.
- 🌙 **Light / Dark mode** — respects `prefers-color-scheme` and supports a manual toggle.
- 📱 **Fully responsive** — sticky result panel, adaptive grid, and touch-optimised controls for mobile.
- 🔒 **N-lock toggle** — lock the exponent to a fixed value when fine-tuning firmware registers.
- ⚙️ **VOUT_MODE support** — configure the `VOUT_MODE (0x20)` byte; bit7 (absolute/relative), bits[6:5] (mode) and bits[4:0] (parameter) are decoded per PMBus Part II §8.3.
- 🔢 **Canonical Raw Word & wire bytes** — the main Raw Word hex always means the numeric 16-bit word (`3412` is `0x3412`, never reinterpreted); SMBus/PMBus wire bytes (low byte first, SMBus 3.0 §6.5.4) and an MSB-first representation are shown and copied separately.
- ✨ **Hex +1/−1 steppers** — the Raw Word (16-bit) and VOUT_MODE (8-bit) hex fields carry in-field stepper buttons that step by exactly 1, disable at `0000`/`FFFF` and `00`/`FF` respectively (never wrap), and drive the same canonical raw state as typed edits; every editable field is visually distinct from read-only displays at rest in both themes.
- 🔐 **Content Security Policy** — production build injects a CSP meta tag that restricts runtime resource origins; no external requests, no tracking. Inline styles are still allowed by `style-src` (Tailwind/runtime styles require `unsafe-inline`).

---

## Supported Formats

| Mode                | Description                                                                | Formula                                                                          |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **LINEAR11**        | 11-bit mantissa + 5-bit signed exponent                                    | $X = Y \times 2^N$                                                               |
| **LINEAR16 (VOUT)** | 16-bit unsigned mantissa, exponent from `VOUT_MODE` (absolute LINEAR only) | $X = V \times 2^N$                                                               |
| **DIRECT**          | Linear transform with three device-specific coefficients                   | $X = \frac{1}{m}\left(Y \times 10^{-R} - b\right)$                               |
| **IEEE Half**       | IEEE 754 binary16 (1-bit sign, 5-bit exponent, 10-bit mantissa)            | IEEE 754 binary16 piecewise decode (zero / subnormal / normal / ±Infinity / NaN) |

> These four tabs are four independent converters; this page does not claim any device capability. Which format(s) a device uses is decided by its datasheet — and under PMBus Rev. 1.3 Part II §7.2 that choice is device-wide, not per command: a device that uses IEEE Half for numerical data must use **only** IEEE Half for all of its numerical commands, and a device that uses any LINEAR or DIRECT format for any numerical data must **not** use IEEE Half for any command. The datasheet determines format adoption only — it does not change the binary16 value-decoding formula, so HALF conversion never needs device coefficients (only DIRECT needs device-specific m/b/R per §7.4). The DIRECT tab encodes Y as a generic signed 16-bit integer per §7.4; PMBus Part II §8.1.1/§8.4.3 restrict output-voltage command data to unsigned positive values — that VOUT output context requires command/device data and is not silently reinterpreted on the DIRECT tab.

---

## Usage

### Legacy single-file (repository-internal offline archive)

`pmbus-calculator.html` is a self-contained single HTML file — no build step, no server required.
It remains in the repository root for **repository-internal offline compatibility purposes**: only necessary corrections are accepted, and it is no longer the Pages product entry point. GitHub Pages serves the React web app at the root (HTTP 200); only the legacy `/pmbus-calculator.html` path returns 404.

> Known numeric deviations in this archive (epsilon-based L11 tie handling without the modern full-range saturation contract, and `Math.round` half-up mantissa rounding in `encodeHalf` instead of IEEE 754 round-to-nearest-even) are documented in [docs/MIGRATION_MATRIX.md](docs/MIGRATION_MATRIX.md); the React app is the numeric authority.

**Open locally:**

1. Clone or download the repository.
2. Open `pmbus-calculator.html` directly in any modern browser.

### New web app (primary)

**Source development:**

```bash
npm ci
npm run dev      # starts Vite dev server at http://localhost:5173
npm run build    # production build to dist/
npm test         # runs Vitest
```

**Static build package:** the production build in `dist/` is a static bundle and must be used through an HTTP static server (for example `npm run preview` or any static hosting service). Directly double-clicking `dist/index.html` via `file://` is not supported.

**Production deployment:** the official site at https://laipeng101.github.io/pmbus-calculator/ deploys immutable Release assets. This source version is `v3.2.0`; GitHub Release and Pages are the authoritative publication and deployment records. See [docs/DEPLOYING.md](docs/DEPLOYING.md).

**Workflow:**

1. Select an encoding mode tab (LINEAR11 / LINEAR16 / DIRECT / IEEE Half).
2. Enter a raw hex value **or** a physical value — the other fields update automatically.
3. Click individual bits in the expanded bit mapping to toggle them and observe the effect. Use its heading to collapse or expand it; your preference is remembered in this browser.
4. Optionally expand the **PMBus command reference** to look up a command's code, transactions, data type, units, format source and spec section. The reference is read-only and never affects the calculation.
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

## PMBus Command Reference

The built-in reference records what PMBus specifies for 13 standard commands (command code, transaction, data type, units, format source, spec section). It is deliberately **read-only**: selecting a command cannot reliably derive the payload format — the device datasheet or `VOUT_MODE` decides — so the panel never switches mode, injects parameters, or rewrites raw, and no demo presets are shipped.

| Command               | Code   | Encoding rule                                                                  |
| --------------------- | ------ | ------------------------------------------------------------------------------ |
| `VOUT_COMMAND`        | `0x21` | follows VOUT_MODE                                                              |
| `VOUT_OV_FAULT_LIMIT` | `0x40` | follows VOUT_MODE                                                              |
| `READ_VOUT`           | `0x8B` | follows VOUT_MODE                                                              |
| `READ_VIN`            | `0x88` | device-defined (datasheet)                                                     |
| `READ_IOUT`           | `0x8C` | device-defined (datasheet)                                                     |
| `READ_TEMPERATURE_1`  | `0x8D` | device-defined (datasheet)                                                     |
| `VIN_OV_FAULT_LIMIT`  | `0x55` | device-defined (datasheet)                                                     |
| `OT_FAULT_LIMIT`      | `0x4F` | device-defined (datasheet)                                                     |
| `FAN_COMMAND_1`       | `0x3B` | device-defined (datasheet)                                                     |
| `READ_POUT`           | `0x96` | device-defined (datasheet)                                                     |
| `READ_FAN_SPEED_1`    | `0x90` | device-defined (datasheet)                                                     |
| `STATUS_WORD`         | `0x79` | status bit field (read word; special write clears UNKNOWN bits only)           |
| `READ_EIN`            | `0x86` | block read (more than 16 bits; spec-internal byte-count conflict shown in-app) |

---

## Tech Stack

### Legacy (single-file archive)

- **Pure HTML + CSS + Vanilla JavaScript** — no frameworks, no dependencies.
- CSS custom properties for full light/dark theming.
- Static CSP in the single-file page.
- Kept as a repository-internal historical archive; not deployed on Pages.

### New Web App (primary)

- **Vite** + **React 19** + **TypeScript** — modern component-based architecture.
- **Tailwind CSS** + CSS variables — design-token-driven theming.
- **Vitest** — unit testing for PMBus math core and reducer/view-model.
- **Playwright** — real-user E2E flows across desktop and mobile Chromium projects.
- Live roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md) · domain rules: [`docs/DOMAIN_MODEL.md`](docs/DOMAIN_MODEL.md) · architecture decisions: [`docs/adr/`](docs/adr/) · frozen full plan: [`docs/archive/web-refactor-m0-m10.1/WEB_REFACTOR_PLAN_FULL.md`](docs/archive/web-refactor-m0-m10.1/WEB_REFACTOR_PLAN_FULL.md).

> **Current status:** The new web app has L11 / L16 / DIRECT / HALF fully bidirectional and is the primary tool. The legacy `pmbus-calculator.html` is retained for repository-internal offline compatibility only (necessary corrections only); it is no longer the Pages product entry point.

---

## Browser Compatibility

Automated verification evidence, by scope:

- **Desktop Chromium** — full coverage: the complete desktop semantic E2E suite runs on the production build in CI (`e2e` job).
- **Mobile Chromium** — automated device-emulation contract suite (Pixel 7 emulation, same CI `e2e` job).
- **Firefox & WebKit** — automated cross-engine core smoke (CI `browser-compat` job, production build): a deliberately small suite covering the core user contracts — app boot & mode switching, encode/decode journeys in all four numeric modes, L16 non-LINEAR fail-closed behavior, canonical raw ↔ bit grid ↔ wire-byte synchronization, hex stepper pointer & keyboard activation, terminology popover, and the copy path. It does not rerun the full semantic suite, so deeper automated coverage remains Chromium-only by design.
- Playwright's WebKit build is **not** Safari: no macOS Safari conformance or support claim is made. Other browsers remain best effort.

---

## Known Limitations

- Numeric-format subset only: no bus transport, command execution, device profiles, PMBus 1.5 security extensions, or Part IV.
- `DIRECT` coefficients are device-specific; the tool never guesses them — it prompts for the device datasheet.
- `READ_EIN` is a block read with a spec-internal byte-count conflict; the app shows both sources instead of picking an authority.
- See [docs/releases/v1.0.0.md#known-limitations](docs/releases/v1.0.0.md#known-limitations).

## License

The project source code is licensed under the [MIT License](LICENSE).

Third-party PMBus/SMBus specification documents are **not** covered by this
project's MIT License. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
and [`document/README.md`](document/README.md) for the specification provenance
and distribution boundary.
