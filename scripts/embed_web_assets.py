"""Embed readable web sources and the selected brand logo into firmware flash."""

from pathlib import Path

Import("env")

project_dir = Path(env.subst("$PROJECT_DIR"))
output = Path(env.subst("$BUILD_DIR")) / "generated_web_assets.h"
output.parent.mkdir(parents=True, exist_ok=True)
env.Append(CPPPATH=[str(output.parent)])

web_files = {
    "WEB_LAYOUT": "layout.html",
    "WEB_HOME": "home.html",
    "WEB_CONFIG": "config.html",
    "WEB_ABOUT": "about.html",
    "WEB_STYLE": "style.css",
    "WEB_DASHBOARD_JS": "dashboard.js",
    "WEB_CONFIG_JS": "config.js",
    "WEB_FAVICON": "favicon.svg",
}
logos = {
    "blox": "assets/blox/BLOX_SPACE_01_reduced.png",
    "officinebitcoin": "assets/officine/OBorange.png",
    "satoshispritz": "assets/satoshispritz/SSLogo.png",
    "sbamminer": "assets/sbamminer/sbamminer_logo.png",
}

parts = ["#pragma once\n#include <Arduino.h>\n"]
for symbol, filename in web_files.items():
    source = (project_dir / "web" / filename).read_text(encoding="utf-8")
    if ')WEBASSET"' in source:
        raise ValueError(f"Raw string delimiter occurs in {filename}")
    parts.append(f'static const char {symbol}[] PROGMEM = R"WEBASSET({source})WEBASSET";\n')

brand = env.subst("$PIOENV").rsplit("-", 1)[-1]
if brand in logos:
    data = (project_dir / logos[brand]).read_bytes()
    rows = [data[index:index + 16] for index in range(0, len(data), 16)]
    parts.append("static const uint8_t WEB_LOGO[] PROGMEM = {\n")
    parts.extend("    " + ",".join(f"0x{byte:02x}" for byte in row) + ",\n" for row in rows)
    parts.append("};\n")

content = "".join(parts)
# Leave the timestamp untouched when assets have not changed.
if not output.exists() or output.read_text(encoding="utf-8") != content:
    output.write_text(content, encoding="utf-8")
print(f"[WEB] Embedded shared pages and {brand if brand in logos else 'base'} theme assets")
