"""Embed BLOXMiner artwork into the firmware web pages at build time."""

import base64
from pathlib import Path

Import("env")

project_dir = Path(env.subst("$PROJECT_DIR"))
logo_asset = project_dir / "assets" / "blox" / "BLOX_SPACE_01_reduced.png"
output = project_dir / "include" / "generated_blox_logo.h"

if logo_asset.exists():
    encoded = base64.b64encode(logo_asset.read_bytes()).decode("ascii")
    chunks = [encoded[i:i + 120] for i in range(0, len(encoded), 120)]
    output.write_text(
        "#pragma once\n"
        "static const char BLOX_LOGO_DATA[] =\n"
        + "".join(f'    \"{chunk}\"\n' for chunk in chunks)
        + ";\n"
        'static const char BLOX_BACKGROUND_DATA[] = "";\n',
        encoding="ascii",
    )
    print(f"[BLOX] Embedded logo: {logo_asset.name}")
else:
    output.write_text(
        '#pragma once\nstatic const char BLOX_LOGO_DATA[] = \"\";\nstatic const char BLOX_BACKGROUND_DATA[] = \"\";\n',
        encoding="ascii",
    )
    print(f"[BLOX] Warning: BLOXMiner artwork not found in {project_dir / 'assets' / 'blox'}")
