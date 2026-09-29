#!/usr/bin/env python3
"""Export EasyMiner PlatformIO artifacts as a versioned firmware package.

The package layout matches the ESPinServer firmware export convention:

    <output>/<version>_<platformio-environment>/
        0x1000_bootloader.bin
        ...
    <output>/index.json

Keeping the complete PlatformIO environment in each folder is important here:
the same board exists as the standard build and as the ``-blox``,
``-satoshispritz`` and ``-officinebitcoin`` variants.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from datetime import datetime, timezone


ENVIRONMENTS = (
    "esp32-headless",
    "esp32s3-headless",
    "esp32-headless-led",
    "esp32s3-mini-headless",
    "esp32-headless-blox",
    "esp32s3-headless-blox",
    "esp32-headless-led-blox",
    "esp32s3-mini-headless-blox",
    "esp32-headless-officinebitcoin",
    "esp32s3-headless-officinebitcoin",
    "esp32-headless-led-officinebitcoin",
    "esp32s3-mini-headless-officinebitcoin",
    "esp32-headless-satoshispritz",
    "esp32s3-headless-satoshispritz",
    "esp32-headless-led-satoshispritz",
    "esp32s3-mini-headless-satoshispritz",
)


def firmware_version() -> str:
    ref = os.environ.get("GITHUB_REF_NAME", "dev")
    ref_type = os.environ.get("GITHUB_REF_TYPE", "")
    full_ref = os.environ.get("GITHUB_REF", "")
    if ref_type == "tag" or full_ref.startswith("refs/tags/"):
        return ref
    return f"dev-{os.environ.get('GITHUB_SHA', 'local')[:7]}"


def addresses_for(environment: str) -> dict[str, int]:
    if environment.startswith("esp32s3"):
        return {"bootloader": 0x0, "partitions": 0x8000, "firmware": 0x10000}
    return {
        "bootloader": 0x1000,
        "partitions": 0x8000,
        "boot_app0": 0xE000,
        "firmware": 0x10000,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def boot_app0_source() -> Path | None:
    """Locate Arduino-ESP32's OTA bootstrap image."""
    candidates = (
        Path.home() / ".platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin",
        Path.home() / ".platformio/packages/framework-arduinoespressif32-libs/tools/partitions/boot_app0.bin",
    )
    return next((candidate for candidate in candidates if candidate.exists()), None)


def make_factory(source: Path, destination: Path, environment: str) -> None:
    image = bytearray([0xFF] * 0x400000)
    end = 0
    for component, address in addresses_for(environment).items():
        path = source / f"{component}.bin"
        if component == "boot_app0" and not path.exists():
            packaged = boot_app0_source()
            if packaged is not None:
                path = packaged
        if not path.exists():
            if component == "boot_app0":
                raise FileNotFoundError("boot_app0.bin (install the Arduino-ESP32 PlatformIO framework)")
            raise FileNotFoundError(path)
        data = path.read_bytes()
        if address + len(data) > len(image):
            raise ValueError(f"{path} does not fit in the 4 MiB factory image")
        image[address : address + len(data)] = data
        end = max(end, address + len(data))
    destination.write_bytes(image[: ((end + 0xFFF) // 0x1000) * 0x1000])


def add_file(files: list[dict], path: Path, folder: str, address: int) -> None:
    files.append(
        {
            "address": f"0x{address:X}",
            "file": f"{folder}/{path.name}",
            "sha256": sha256(path),
            "size": path.stat().st_size,
        }
    )


def export_build(input_root: Path, output_root: Path, version: str, environment: str) -> dict:
    source = input_root / f"firmware-{environment}" / "raw"
    if not source.exists():
        raise FileNotFoundError(f"Missing artifact directory: {source}")

    folder = f"{version}_{environment}"
    destination = output_root / folder
    destination.mkdir(parents=True)
    files: list[dict] = []

    for component, address in addresses_for(environment).items():
        source_file = source / f"{component}.bin"
        if component == "boot_app0" and not source_file.exists():
            packaged = boot_app0_source()
            if packaged is not None:
                source_file = packaged
        if not source_file.exists():
            if component == "boot_app0":
                raise FileNotFoundError("boot_app0.bin (install the Arduino-ESP32 PlatformIO framework)")
            raise FileNotFoundError(source_file)
        target = destination / f"0x{address:04X}_{source_file.name}"
        shutil.copyfile(source_file, target)
        add_file(files, target, folder, address)

    factory = destination / f"0x0000_{environment}_factory.bin"
    make_factory(source, factory, environment)
    add_file(files, factory, folder, 0)

    # Keep both spellings for clients that use the canonical and legacy keys.
    return {
        "name": environment,
        "platformio_environment": environment,
        "files": files,
        "flashFiles": files,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path(os.environ.get("DIYFLASHER_INPUT", "artifacts")))
    parser.add_argument("--output", type=Path, default=Path(os.environ.get("DIYFLASHER_OUTPUT", "firmware-export")))
    parser.add_argument("--version", default=firmware_version())
    parser.add_argument("--base-url", default=".")
    args = parser.parse_args()

    shutil.rmtree(args.output, ignore_errors=True)
    args.output.mkdir(parents=True)
    builds = [export_build(args.input, args.output, args.version, environment) for environment in ENVIRONMENTS]

    manifest = {
        "name": "EasyMiner",
        "version": args.version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": args.base_url,
        "builds": builds,
        "versions": [{"version": args.version, "builds": builds}],
    }
    (args.output / "index.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
