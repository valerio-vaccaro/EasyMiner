# ⛏️ EasyMiner

![EasyMiner](https://img.shields.io/badge/firmware-ESP32%20%7C%20ESP32--S3-f7931a?style=for-the-badge&logo=espressif)
[![Build firmware](../../actions/workflows/firmware.yml/badge.svg)](../../actions/workflows/firmware.yml)
[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-22272e?style=for-the-badge&logo=github)](docs/)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg?style=for-the-badge)](LICENSE)

**EasyMiner is an open-source Bitcoin solo-mining firmware for ESP32 boards.** This project is based on [SparkMiner](https://github.com/SneezeGUI/SparkMiner) and [NerdMiner V2](https://github.com/BitMaker-hub/NerdMiner_v2), with their mining and Stratum concepts adapted for a headless web-managed firmware. EasyMiner combines hardware-accelerated SHA-256 mining, Stratum pool support, Wi-Fi provisioning, persistent configuration, and a live web dashboard in a small PlatformIO project.

> ⚠️ Solo mining is a lottery with extremely small odds. EasyMiner is intended for experimentation, education, and learning about embedded Bitcoin mining.

## ✨ Features

- ⚡ Dual-core SHA-256 mining on ESP32 and ESP32-S3
- 🌐 Captive-portal Wi-Fi and pool configuration
- 💾 Persistent settings stored in NVS
- 📡 Stratum subscription, template handling, share submission, and pool failover
- 📊 Browser dashboard with live WebSocket statistics
- 🧰 Factory and OTA-style firmware binaries generated after each build
- 📦 Reproducible GitHub Actions builds with downloadable artifacts

## 🧩 Supported CI build targets

The project supports four hardware profiles and five branding families: EasyMiner, BLOXMiner, OfficineBitcoinMiner, SatoshiSpritzMiner, and SBAMminer. This produces twenty CI build targets.

Each brand is available on every hardware profile:

| Hardware profile | Standard | BLOXMiner | OfficineBitcoinMiner | SatoshiSpritzMiner | SBAMminer |
| --- | --- | --- | --- | --- | --- |
| Classic ESP32, onboard LED | `esp32-headless` | `esp32-headless-blox` | `esp32-headless-officinebitcoin` | `esp32-headless-satoshispritz` | `esp32-headless-sbamminer` |
| ESP32-S3 DevKit, onboard LED | `esp32s3-headless` | `esp32s3-headless-blox` | `esp32s3-headless-officinebitcoin` | `esp32s3-headless-satoshispritz` | `esp32s3-headless-sbamminer` |
| Classic ESP32, external RGB LED | `esp32-headless-led` | `esp32-headless-led-blox` | `esp32-headless-led-officinebitcoin` | `esp32-headless-led-satoshispritz` | `esp32-headless-led-sbamminer` |
| ESP32-S3 Mini, external RGB LED | `esp32s3-mini-headless` | `esp32s3-mini-headless-blox` | `esp32s3-mini-headless-officinebitcoin` | `esp32s3-mini-headless-satoshispritz` | `esp32s3-mini-headless-sbamminer` |

Brand defaults are `EasyMiner`, `BLOXMiner`, `OfficineBitcoinMiner`, `SatoshiSpritzMiner`, and `SBAMminer`; the repository attribution remains the common EasyMiner project.

| Brand family | Default worker | Provisioning SSID prefix | Firmware logo |
| --- | --- | --- | --- |
| EasyMiner | `EasyMiner` | `EasyMiner_` | — |
| BLOXMiner | `BLOXMiner` | `BLOXMiner_` | [BLOX.space](https://blox.space/) |
| OfficineBitcoinMiner | `OfficineBitcoinMiner` | `OfficineBitcoinMiner_` | [OfficineBitcoin](https://officinebitcoin.it/) |
| SatoshiSpritzMiner | `SatoshiSpritzMiner` | `SatoshiSpritzMiner_` | [Satoshi Spritz](https://satoshispritz.it/) |
| SBAMminer | `SBAMminer` | `SBAMminer_` | SBAMminer |

All variants are maintained in this repository: [github.com/valerio-vaccaro/EasyMiner](https://github.com/valerio-vaccaro/EasyMiner).

The active board profiles and pin definitions live in [`include/board_config.h`](include/board_config.h). Only the profiles listed above are currently exposed by `platformio.ini`.

> **BLOX attribution:** The BLOX logo and brand are registered to [BLOX.space](https://blox.space/), the innovative Bitcoin Hub in Turin.

## 🚀 Quick start

Install [PlatformIO](https://platformio.org/install) and build one target:

```bash
pio run -e esp32-headless
# Example branded targets:
pio run -e esp32-headless-blox
pio run -e esp32-headless-officinebitcoin
pio run -e esp32-headless-satoshispritz
```

To flash a connected board:

```bash
pio run -e esp32-headless -t upload
# or
pio run -e esp32s3-headless -t upload
```

Use the same command with any environment from the matrix, for example:

```bash
pio run -e esp32-headless-officinebitcoin -t upload
pio run -e esp32-headless-satoshispritz -t upload
```

If more than one board is connected, add `--upload-port /dev/ttyUSB0` (or the appropriate serial port).

On first boot, connect to the access point for the selected brand: `EasyMiner_XXXX`, `BLOXMiner_XXXX`, `OfficineBitcoinMiner_XXXX`, `SatoshiSpritzMiner_XXXX`, or `SBAMminer_XXXX`. Use the captive portal to set Wi-Fi, wallet, worker, and pool settings. Once connected, open `http://easyminer.local/` from a device on the same network. If mDNS is unavailable, use the device IP shown in the serial log or router DHCP list. The dashboard uses HTTP port `80` and WebSocket port `81`.

The default pool is `solo.homeminingitalia.org:3340` with password `x`. The default worker is the firmware brand name; custom worker names are preserved.

## 📥 Firmware files

Every successful build produces files in the CI artifact named `firmware-<environment>`:

- `firmware.bin` — update image
- `<board>_firmware.bin` — named update image
- `<board>_factory.bin` — merged factory image containing bootloader, partitions, and application
- `bootloader.bin`, `partitions.bin` — component images for advanced flashing

Use the **Actions → Build firmware → Artifacts** page to download binaries for a commit or release.

The same workflow includes a `firmware-export` artifact after all twenty targets finish. It contains an `index.json` and one version-prefixed folder per board/variant, for example `v1.0.0_esp32-headless` and `v1.0.0_esp32-headless-blox`. Each folder contains address-prefixed component images and a factory image, with SHA-256 metadata in the index.

## 🛠️ Project layout

```text
src/                  Firmware, miner, Stratum, configuration, and dashboard code
web/                  Shared readable HTML, CSS, and JavaScript for every brand
include/              Board profiles and shared compile-time configuration
scripts/              Version injection and factory-image generation
docs/                 Static GitHub Pages documentation site
.github/workflows/    Firmware and Pages automation
```

The web server and brand palettes live in `src/web_dashboard.cpp`. The build script `scripts/embed_web_assets.py` embeds `web/` and the selected logo into flash; no filesystem upload is required. Styles and scripts are streamed from flash inside the HTML response, while logos are served separately. This keeps page-generation memory small and avoids extra concurrent browser requests. WebSocket handshakes use software SHA-1 so mining can keep using the SHA-256 hardware.

To check the currently installed SBAM firmware with headless Chrome (Node 22+):

```bash
node scripts/check_web_pages.mjs --brand sbamminer --url http://easyminer.local
```

For an attached classic ESP32, this command builds and flashes all five versions, checks each page at 1280, 390, and 320 pixels, and leaves SBAM installed:

```bash
node scripts/check_web_pages.mjs --flash-all --port /dev/ttyUSB0 --url http://easyminer.local --restore sbamminer
```

Use the board IP in `--url` if mDNS is slow. The script uses `venv/bin/pio`; use `--pio` to select another executable. Screenshots are written to `docs/screenshot/<brand>/`; machine-only reports, diagnostics, and upload logs stay in the ignored `.pio/web-checks/` directory. Checks cover navigation, branding, image loading, live statistics, charts, HTTP fallback, reduced motion, and pool presets. Save, delete, and reboot forms are inspected without submitting them.

Browse the [firmware screenshots](docs/screenshots.html) for all five versions. Regenerate this image-only documentation page with `node scripts/screenshot_gallery.mjs`; no reports are needed. If a sweep is interrupted, add `--start satoshispritz` (or another brand) to resume from that version using the private earlier reports. Resume only when the firmware sources have not changed since those reports were generated.

The handshake hash regression check runs with `venv/bin/python scripts/test_websocket_sha.py` and requires a host `g++` compiler.

## 🤝 Contributing

Issues and focused pull requests are welcome. When reporting a hardware problem, include the board name, PlatformIO environment, serial output, and the commit or firmware artifact used. Never commit Wi-Fi credentials, wallet secrets, or pool passwords.

## 📜 License

EasyMiner is distributed under the [GNU General Public License v3.0](LICENSE). It is based in part on ideas and mining/Stratum work from [SparkMiner](https://github.com/SneezeGUI/SparkMiner) and [NerdMiner V2](https://github.com/BitMaker-hub/NerdMiner_v2).
