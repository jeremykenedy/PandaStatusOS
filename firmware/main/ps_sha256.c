/* SHA-256, from FIPS 180-4, sections 4.1.2, 4.2.2, 5.1.1, 5.3.3 and 6.2.
 *
 * The chip has a SHA accelerator and mbedtls drives it, so why this? Because the bridge's
 * pairing arithmetic (docs/PANDAVENT-BRIDGE.md) has to be checked on the host against the
 * same numbers the mocks and the harness compute, and a host test that links the IDF's
 * mbedtls is a host test that needs a configured IDF to build. This compiles with plain gcc
 * like every other host test here, and the dozen hashes a pairing takes cost nothing in
 * software.
 *
 * bridge_test.c holds it to the four FIPS example vectors, including the million-'a' one
 * that walks the length encoding across many blocks. */
#include <string.h>
#include "ps.h"

static const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void block(uint32_t h[8], const uint8_t *p)
{
    uint32_t w[64];
    for (int t = 0; t < 16; t++)
        w[t] = (uint32_t)p[4 * t] << 24 | (uint32_t)p[4 * t + 1] << 16 | (uint32_t)p[4 * t + 2] << 8 | p[4 * t + 3];
    for (int t = 16; t < 64; t++) {
        uint32_t s0 = ROTR(w[t - 15], 7) ^ ROTR(w[t - 15], 18) ^ (w[t - 15] >> 3);
        uint32_t s1 = ROTR(w[t - 2], 17) ^ ROTR(w[t - 2], 19) ^ (w[t - 2] >> 10);
        w[t] = w[t - 16] + s0 + w[t - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (int t = 0; t < 64; t++) {
        uint32_t S1 = ROTR(e, 6) ^ ROTR(e, 11) ^ ROTR(e, 25);
        uint32_t ch = (e & f) ^ (~e & g);
        uint32_t t1 = k + S1 + ch + K[t] + w[t];
        uint32_t S0 = ROTR(a, 2) ^ ROTR(a, 13) ^ ROTR(a, 22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        uint32_t t2 = S0 + maj;
        k = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
}

void ps_sha256_init(ps_sha256_t *c)
{
    static const uint32_t H0[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
    memcpy(c->h, H0, sizeof H0);
    c->len = 0;
    c->n = 0;
}

void ps_sha256_update(ps_sha256_t *c, const void *data, size_t len)
{
    const uint8_t *p = data;
    c->len += len;
    while (len) {
        size_t take = 64 - c->n;
        if (take > len) take = len;
        memcpy(c->buf + c->n, p, take);
        c->n += take; p += take; len -= take;
        if (c->n == 64) { block(c->h, c->buf); c->n = 0; }
    }
}

void ps_sha256_final(ps_sha256_t *c, uint8_t out[32])
{
    uint64_t bits = c->len * 8u;
    uint8_t pad = 0x80;
    ps_sha256_update(c, &pad, 1);
    uint8_t zero = 0;
    while (c->n != 56) ps_sha256_update(c, &zero, 1);
    uint8_t lenbe[8];
    for (int i = 0; i < 8; i++) lenbe[i] = (uint8_t)(bits >> (56 - 8 * i));
    ps_sha256_update(c, lenbe, 8);
    for (int i = 0; i < 8; i++) {
        out[4 * i] = (uint8_t)(c->h[i] >> 24); out[4 * i + 1] = (uint8_t)(c->h[i] >> 16);
        out[4 * i + 2] = (uint8_t)(c->h[i] >> 8); out[4 * i + 3] = (uint8_t)c->h[i];
    }
}

void ps_sha256(const void *data, size_t len, uint8_t out[32])
{
    ps_sha256_t c;
    ps_sha256_init(&c);
    ps_sha256_update(&c, data, len);
    ps_sha256_final(&c, out);
}

void ps_hex(const uint8_t *in, size_t n, char *out)
{
    static const char D[] = "0123456789abcdef";
    for (size_t i = 0; i < n; i++) { out[2 * i] = D[in[i] >> 4]; out[2 * i + 1] = D[in[i] & 15]; }
    out[2 * n] = 0;
}
