#!/usr/bin/env python3
"""Create a diyflasher-compatible catalog from PlatformIO CI artifacts."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path


ENVIRONMENTS = [
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
]


def firmware_version() -> str:
    ref = os.environ.get("GITHUB_REF_NAME", "dev")
    return ref if ref.startswith("v") else f"dev-{os.environ.get('GITHUB_SHA', 'local')[:7]}"


def brand_for(environment: str) -> str:
    if "-blox" in environment:
        return "BLOX"
    if environment.endswith("-officinebitcoin"):
        return "OfficineBitcoin"
    if environment.endswith("-satoshispritz"):
        return "Satoshi Spritz"
    return "EasyMiner"


def board_for(environment: str) -> str:
    if environment.startswith("esp32s3-mini"):
        return "ESP32-S3 Mini"
    if environment.startswith("esp32s3"):
        return "ESP32-S3 DevKitC-1"
    if environment.endswith("-led") or "-led-" in environment:
        return "ESP32 DevKit V1 (LED)"
    return "ESP32 DevKit V1"


def variant_for(environment: str) -> str:
    if "-blox" in environment:
        return "BLOX"
    if environment.endswith("-officinebitcoin"):
        return "OfficineBitcoin"
    if environment.endswith("-satoshispritz"):
        return "Satoshi Spritz"
    if "-led" in environment:
        return "LED"
    return "Standard"


def addresses_for(environment: str) -> dict[str, int]:
    if environment.startswith("esp32s3"):
        return {"bootloader": 0x0, "partitions": 0x8000, "firmware": 0x10000}
    return {
        "bootloader": 0x1000,
        "partitions": 0x8000,
        "boot_app0": 0xE000,
        "firmware": 0x10000,
    }


def make_factory(source: Path, destination: Path, environment: str) -> None:
    addresses = addresses_for(environment)
    image = bytearray([0xFF] * 0x400000)
    end = 0
    for component, address in addresses.items():
        path = source / f"{component}.bin"
        if not path.exists():
            if component == "boot_app0":
                continue
            raise FileNotFoundError(path)
        data = path.read_bytes()
        image[address : address + len(data)] = data
        end = max(end, address + len(data))
    destination.write_bytes(image[: ((end + 0xFFF) // 0x1000) * 0x1000])


def main() -> None:
    input_root = Path(os.environ.get("DIYFLASHER_INPUT", "artifacts"))
    output_root = Path(os.environ.get("DIYFLASHER_OUTPUT", "diyflasher"))
    assets_root = output_root / "assets" / "easyminer"
    shutil.rmtree(output_root, ignore_errors=True)
    assets_root.mkdir(parents=True)

    version = firmware_version()
    catalog = []
    for environment in ENVIRONMENTS:
        source = input_root / f"firmware-{environment}" / "raw"
        if not source.exists():
            raise FileNotFoundError(f"Missing artifact directory: {source}")

        value = f"easyminer-{version}-{environment}"
        folder = assets_root / value
        folder.mkdir(parents=True)
        files = []
        addresses = addresses_for(environment)
        for component, address in addresses.items():
            source_file = source / f"{component}.bin"
            if not source_file.exists():
                if component == "boot_app0":
                    continue
                raise FileNotFoundError(source_file)
            name = f"{component}.bin"
            shutil.copy2(source_file, folder / name)
            files.append({
                "address": hex(address),
                "url": f"assets/easyminer/{value}/{name}",
                "name": name,
            })

        factory_name = f"{environment}_factory.bin"
        make_factory(source, folder / factory_name, environment)
        files.insert(0, {
            "address": "0x0",
            "url": f"assets/easyminer/{value}/{factory_name}",
            "name": factory_name,
        })
        catalog.append({
            "value": value,
            "label": f"{brand_for(environment)} — {board_for(environment)} ({version})",
            "firmwareVersion": version,
            "board": board_for(environment),
            "variants": [variant_for(environment), "Factory image", "Component images"],
            "baudrate": 115200,
            "files": files,
        })

    (output_root / "firmwares-easyminer.json").write_text(
        json.dumps(catalog, indent=2) + "\n", encoding="utf-8"
    )
    (output_root / "README.txt").write_text(
        "EasyMiner firmware catalog for diyflasher.\n"
        "Copy firmwares-easyminer.json and assets/easyminer/ into the diyflasher repository.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
