// WebSockets uses esp_sha(SHA1) for its handshake. Mining writes directly to
// the same SHA registers, bypassing the SDK locks. Hash SHA-1 in software so
// opening a dashboard cannot corrupt either the handshake or mining work.
#include <sha/sha_parallel_engine.h>
#include <stdint.h>
#include <string.h>

static uint32_t rotateLeft(uint32_t value, unsigned bits) {
    return (value << bits) | (value >> (32 - bits));
}

static void softwareSha1(const unsigned char *input, size_t length, unsigned char *output) {
    uint32_t digest[5] = {0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0};
    const size_t blocks = length / 64 + (length % 64 < 56 ? 1 : 2);
    const uint64_t bitLength = static_cast<uint64_t>(length) * 8;
    for (size_t block = 0; block < blocks; ++block) {
        uint8_t bytes[64] = {};
        const size_t offset = block * 64;
        if (offset < length) {
            const size_t remaining = length - offset;
            memcpy(bytes, input + offset, remaining < 64 ? remaining : 64);
        }
        if (length >= offset && length - offset < 64) bytes[length - offset] = 0x80;
        if (block == blocks - 1) {
            for (unsigned i = 0; i < 8; ++i) bytes[63 - i] = bitLength >> (i * 8);
        }
        uint32_t words[80];
        for (unsigned i = 0; i < 16; ++i) {
            words[i] = (uint32_t(bytes[4 * i]) << 24) | (uint32_t(bytes[4 * i + 1]) << 16)
                | (uint32_t(bytes[4 * i + 2]) << 8) | bytes[4 * i + 3];
        }
        for (unsigned i = 16; i < 80; ++i) {
            words[i] = rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
        }
        uint32_t a = digest[0], b = digest[1], c = digest[2], d = digest[3], e = digest[4];
        for (unsigned i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
            else { f = b ^ c ^ d; k = 0xca62c1d6; }
            const uint32_t next = rotateLeft(a, 5) + f + e + k + words[i];
            e = d; d = c; c = rotateLeft(b, 30); b = a; a = next;
        }
        digest[0] += a; digest[1] += b; digest[2] += c; digest[3] += d; digest[4] += e;
    }
    for (unsigned i = 0; i < 20; ++i) output[i] = digest[i / 4] >> (24 - (i % 4) * 8);
}

extern "C" void __real_esp_sha(esp_sha_type type, const unsigned char *input, size_t length, unsigned char *output);
extern "C" void __wrap_esp_sha(esp_sha_type type, const unsigned char *input, size_t length, unsigned char *output) {
    if (type == SHA1) softwareSha1(input, length, output);
    else __real_esp_sha(type, input, length, output);
}
