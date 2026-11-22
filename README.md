# PMBus Numeric-Format Calculator

English · [简体中文](README_zh-CN.md)

Convert PMBus data words and physical values in your browser, inspect individual bits, and look up standard commands.

[Open the calculator](https://laipeng101.github.io/pmbus-calculator/) · [Download the latest release](https://github.com/laipeng101/pmbus-calculator/releases/latest) · [Release history](https://github.com/laipeng101/pmbus-calculator/releases)

## Using the calculator

1. Choose the format from your device datasheet. Enter a hexadecimal word to see the result, or enter a physical value in modes that support encoding. Click bits in the grid to see how each change affects the result.
2. Read the result and its calculation. Open the command reference to look up a command code, transaction, or format source. Looking up a command leaves the calculation unchanged.
3. Use the buttons to copy the raw word, wire bytes, MSB-first bytes, physical value, or C macro. To compare with a bus capture, copy the wire bytes, which put the low byte first.

| Page      | Use                                                                                                                              | Shortcut   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| LINEAR11  | Convert between a data word and a physical value. Set N manually or let the calculator find the exponent with the smallest error | `Ctrl + 1` |
| LINEAR16  | Use the exponent from `VOUT_MODE` to convert an absolute voltage, read a relative ratio, or convert a signed voltage offset      | `Ctrl + 2` |
| DIRECT    | Convert using the m, b, and R coefficients from the device datasheet                                                             | `Ctrl + 3` |
| IEEE Half | Convert IEEE 754 binary16 values, including infinities and NaN                                                                   | `Ctrl + 4` |
| VOUT_MODE | Edit the configuration byte and inspect the absolute or relative setting, format, and parameter                                  | `Ctrl + 5` |

When reading a LINEAR16 relative ratio, enter the nominal voltage from `VOUT_COMMAND` to calculate the actual voltage. The mode shortcuts are disabled while you edit an input. See the [domain model](docs/DOMAIN_MODEL.md) for formulas, valid format combinations, and mode limits.

## Self-hosted and offline use

Download the Web ZIP and `SHA256SUMS.txt` from the [latest release](https://github.com/laipeng101/pmbus-calculator/releases/latest). Extract the ZIP and serve its contents over HTTP. If you need to open a file directly in the browser, download the [legacy single-file calculator](pmbus-calculator.html) and review its [known numeric differences](docs/LEGACY_COMPATIBILITY.md).

## Privacy

Calculations run in your browser. The official site uses Cloudflare Web Analytics for page-level statistics. The self-hosted release comes without analytics. Calculator inputs and results are excluded from analytics events. [Deployment and privacy details](docs/DEPLOYING.md)

## Development and licensing

[Contributing](CONTRIBUTING.md) · [Architecture decisions](docs/adr/) · [MIT license](LICENSE) · [Third-party specification notices](THIRD_PARTY_NOTICES.md)
