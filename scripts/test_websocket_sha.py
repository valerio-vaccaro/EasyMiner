"""Check the WebSocket SHA wrapper against hashlib using a host C++ compiler."""

import hashlib
from pathlib import Path
import subprocess
import tempfile


def main():
    project_dir = Path(__file__).resolve().parents[1]
    vectors = [
        "",
        "abc",
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
        "dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    ]
    vectors += ["a" * length for length in (1, 3, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000000)]
    driver = r'''
#include <cassert>
#include <cstdio>
#include <iostream>
#include <string>
static bool delegated = false;
extern "C" void __real_esp_sha(esp_sha_type, const unsigned char *, size_t, unsigned char *) {
    delegated = true;
}
int main() {
    unsigned char hash[20];
    std::string input;
    while (std::getline(std::cin, input)) {
        __wrap_esp_sha(SHA1, reinterpret_cast<const unsigned char *>(input.data()), input.size(), hash);
        for (unsigned char byte : hash) printf("%02x", byte);
        printf("\n");
    }
    __wrap_esp_sha(SHA2_256, nullptr, 0, hash);
    assert(delegated);
}
'''
    with tempfile.TemporaryDirectory(prefix="easyminer-sha-test-") as directory:
        test_dir = Path(directory)
        header = test_dir / "sha" / "sha_parallel_engine.h"
        header.parent.mkdir()
        header.write_text("#pragma once\n#include <stddef.h>\nenum esp_sha_type { SHA1, SHA2_256 };\n")
        binary = test_dir / "test"
        subprocess.run(
            ["g++", "-std=c++11", "-Wall", "-Wextra", "-Werror", f"-I{test_dir}",
             "-include", str(project_dir / "src" / "websocket_sha.cpp"), "-x", "c++", "-", "-o", str(binary)],
            input=driver, text=True, check=True,
        )
        actual = subprocess.run(
            [str(binary)], input="\n".join(vectors) + "\n", text=True, capture_output=True, check=True,
        ).stdout.splitlines()
    expected = [hashlib.sha1(vector.encode("ascii")).hexdigest() for vector in vectors]
    if actual != expected:
        raise AssertionError("SHA-1 output differs from hashlib")
    print(f"{len(vectors)} SHA-1 vectors passed; SHA-256 delegation passed.")


if __name__ == "__main__":
    main()
