# PMBus Numeric-Format Calculator

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

A fully client-side **PMBus numeric-format calculator** with no backend that runs entirely in the browser.
It supports bidirectional conversion for **LINEAR11 (L11)**, **LINEAR16 / VOUT (L16)**, **DIRECT**, and **IEEE 754 Half-Precision (HALF / binary16)** encoding schemes.

> **Scope:** this tool converts numeric formats; it is **not** a PMBus/SMBus controller, bus-transport implementation, command executor, device-profile engine, or conformance test suite. It covers the common numeric-format semantics across multiple PMBus revisions and does **not** claim full PMBus 1.5 protocol compliance (including the 1.5 security extensions).
>
> [Live Demo](https://laipeng101.github.io/pmbus-calculator/)
>
> [Latest stable release](https://github.com/laipeng101/pmbus-calculator/releases/latest) · [Release history](https://github.com/laipeng101/pmbus-calculator/releases) · [SHA256SUMS.txt](https://github.com/laipeng101/pmbus-calculator/releases/latest/download/SHA256SUMS.txt)

---

## Table of Contents

- [Features](#features)
- [Supported Formats](#supported-formats)
- [Usage](#usage)
- [Privacy and official Pages](#privacy-and-official-pages)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [PMBus Command Reference](#pmbus-command-reference)
- [Tech Stack](#tech-stack)
- [Browser Compatibility](#browser-compatibility)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Features

- 🔁 **Bidirectional conversion** — L11, L16, DIRECT, and HALF are fully bidirectional (encode/decode loops are implemented).
- 🎛️ **One result workspace, five gears** — every mode shares the same result card: the physical value anchors the left, and the right keeps two rows for numeric modes (fields/parameters → one complete equation that runs symbolic relation → current values → final result). VOUT_MODE keeps three config rows (fields → bit parse → result). Four stable context slots (Raw / format / parameters / context) plus a decode/encode direction derived only from committed input provenance sit below. The parameters slot is structured label/value data, never string-split in components. Numeric modes typeset real LaTeX through KaTeX (HTML + MathML); VOUT_MODE keeps the same rhythm as a bit-field configuration walkthrough and is never sent to KaTeX.
- 📐 **Four encoding modes with one complete equation** — every numeric mode shows a single fields → substituted values → final result chain on the first screen, so the equation already contains the result; the collapsible calculation-steps panel keeps only supplemental diagnostics (saturation, exact rational/precision rounding, quantization error, nominal reference and overflow/underflow provenance) and is omitted entirely when there is nothing extra. L16 exposes the VOUT_MODE bit layout and refuses to fabricate a LINEAR16 voltage for relative/non-LINEAR modes.
- 🔲 **Interactive bit mappings** — the 16-bit panel sits directly below Raw Word, with clickable bits, nibble hex values and field legends. Both it and the VOUT_MODE 8-bit panel open by default; each remembers its collapsed state across mode changes and reloads. Hex and parameter editing remain available when collapsed.
- 🧭 **Result context** — the result shows its raw word, format and parameter source, including L16 reference availability and the current DIRECT coefficients.
- 📋 **One-click copy** — copy the raw hex value, the decoded physical value, or a ready-to-paste C macro.
- 📖 **Read-only PMBus command reference** — expand the panel to look up standard command definitions without affecting calculations.
- ♾️ **Optimal N auto-selection** — for LINEAR11 mode, the tool automatically finds the N exponent that minimises representation error.
- 🌙 **Light / Dark mode** — respects `prefers-color-scheme` and supports a manual toggle.
- 📱 **Fully responsive** — sticky result panel, adaptive grid, and touch-optimised controls for mobile.
- 🔒 **N-lock toggle** — lock the exponent to a fixed value when fine-tuning firmware registers.
- ⚙️ **VOUT_MODE support** — configure the `VOUT_MODE (0x20)` byte; bit7 (absolute/relative), bits[6:5] (mode) and bits[4:0] (parameter) are decoded per PMBus Part II §8.3.
- 🔢 **Canonical Raw Word & wire bytes** — the main Raw Word hex always means the numeric 16-bit word (`3412` is `0x3412`, never reinterpreted); SMBus/PMBus wire bytes (low byte first, SMBus 3.0 §6.5.4) and an MSB-first representation are shown and copied separately.
- ✨ **Hex +1/−1 steppers** — the Raw Word (16-bit) and VOUT_MODE (8-bit) hex fields carry in-field stepper buttons that step by exactly 1, disable at `0000`/`FFFF` and `00`/`FF` respectively (never wrap), and drive the same canonical raw state as typed edits; every editable field is visually distinct from read-only displays at rest in both themes.
- 🔐 **Content Security Policy** — source, Release and self-host builds retain a strict same-origin runtime policy with no Analytics or external tracking. Only the official Pages deployment adds the exact Cloudflare Web Analytics script/connect exceptions; application JavaScript, CSS and fonts stay same-origin. Inline styles remain allowed by the existing `style-src` policy.

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

Clone or download the repository and open `pmbus-calculator.html` directly in a modern browser for offline use. Use the current web app when you need its numeric behavior and rounding rules. [Known differences and maintenance policy](docs/LEGACY_COMPATIBILITY.md)

### New web app (primary)

Extract the Web ZIP from the latest stable release and serve its contents over HTTP, or serve the source build in `dist/`. For local use, preview a source build with `npm run preview`. [Local development and verification](CONTRIBUTING.md)

**Workflow:**

1. Select an encoding mode tab (LINEAR11 / LINEAR16 / DIRECT / IEEE Half).
2. Enter a raw hex value **or** a physical value — the other fields update automatically.
3. Click individual bits in the expanded bit mapping to toggle them and observe the effect. Use its heading to collapse or expand it; your preference is remembered in this browser.
4. Optionally expand the **PMBus command reference** to look up a command's code, transactions, data type, units, format source and spec section. The reference is read-only and never affects the calculation.
5. Click **📋 Hex**, **📋 值**, or **C 代码** to copy the result in your preferred format.

---

## Privacy and official Pages

Clones, Download source ZIPs, forks, ordinary `npm run build` output, Release Web ZIPs and self-hosted builds default to **no Analytics and no external tracking**. Their default application output contains neither the Cloudflare beacon nor the Pages-only repository link or stylesheet.

The official GitHub Pages deployment uses privacy-oriented, aggregate **Cloudflare Web Analytics** for page-level statistics. It makes the narrowly allowed Cloudflare requests and adds a small source-repository icon link beside the header's theme button, with the accessible name “在 GitHub 查看项目源码”. The calculator keeps its full width on mobile. These additions are applied only to the Pages staging tree; the immutable Release ZIP remains unchanged.

Calculator inputs and results—including PMBus raw words, physical values, DIRECT coefficients, VOUT_MODE values and copied content—are not collected as custom analytics events. No calculator event parameters are added to the standard page-level beacon. [Deployment and verification](docs/DEPLOYING.md)

---

## Keyboard Shortcuts

| Shortcut   | Action                                 |
| ---------- | -------------------------------------- |
| `Ctrl + 1` | Switch to LINEAR11 mode                |
| `Ctrl + 2` | Switch to LINEAR16 (VOUT) mode         |
| `Ctrl + 3` | Switch to DIRECT mode                  |
| `Ctrl + 4` | Switch to IEEE Half-Precision mode     |
| `Ctrl + 5` | Switch to VOUT_MODE configuration mode |

---

## PMBus Command Reference

The built-in reference shows PMBus command codes, transactions, data types, units, format sources and specification sections. The panel is read-only. Use the device datasheet or `VOUT_MODE` to determine the payload format. [Command definitions](src/legacy/command-metadata.ts) · [Domain rules](docs/DOMAIN_MODEL.md)

---

## Tech Stack

Vite, React, TypeScript and Tailwind CSS. [Architecture decisions](docs/adr/) · [Contributing](CONTRIBUTING.md)

---

## Browser Compatibility

Automated browser coverage includes desktop and mobile-emulated Chromium and core flows in Firefox and WebKit. Safari and other browsers are best effort. [Verification commands and scope](CONTRIBUTING.md)

---

## Known Limitations

- Numeric-format subset only: no bus transport, command execution, device profiles, PMBus 1.5 security extensions, or Part IV.
- `DIRECT` coefficients are device-specific; the tool never guesses them — it prompts for the device datasheet.
- `READ_EIN` is a block read with a spec-internal byte-count conflict; the app shows both sources instead of picking an authority.

## License

The project source code is licensed under the [MIT License](LICENSE).

Third-party PMBus/SMBus specification documents are **not** covered by this
project's MIT License. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
and [`document/README.md`](document/README.md) for the specification provenance
and distribution boundary.
