"""Embed OfficineBitcoin artwork into the firmware web pages at build time."""

import base64
from pathlib import Path

Import("env")

project_dir = Path(env.subst("$PROJECT_DIR"))
logo_asset = project_dir / "assets" / "officine" / "OBorange.png"
output = project_dir / "include" / "generated_officinebitcoin_logo.h"

if logo_asset.exists():
    encoded = base64.b64encode(logo_asset.read_bytes()).decode("ascii")
    chunks = [encoded[i:i + 120] for i in range(0, len(encoded), 120)]
    output.write_text(
        "#pragma once\n"
        "static const char OFFICINE_BITCOIN_LOGO_DATA[] =\n"
        + "".join(f'    "{chunk}"\n' for chunk in chunks)
        + ";\n",
        encoding="ascii",
    )
    print(f"[OFFICINE] Embedded logo: {logo_asset.name}")
else:
    output.write_text(
        '#pragma once\nstatic const char OFFICINE_BITCOIN_LOGO_DATA[] = "";\n',
        encoding="ascii",
    )
    print(f"[OFFICINE] Warning: logo not found at {logo_asset}")
