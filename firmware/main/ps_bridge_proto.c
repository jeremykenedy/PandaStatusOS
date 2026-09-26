/* The vent bridge's pure parts: the arithmetic of pairing, the framing of the socket, and the
 * reading of a vent report. Nothing here touches the network, the flash or a task, so all of
 * it compiles on the host and bridge_test.c holds it to outside numbers:
 *
 *   - the pairing code, the token and the auth, against the same derivations the mock vent
 *     and the harness compute in node, from the same inputs, so three implementations agree
 *     on one set of numbers rather than each agreeing with itself;
 *   - the framing, against the byte sequences RFC 6455 section 5.7 prints as its examples.
 *
 * The contract is docs/PANDAVENT-BRIDGE.md. Where it was loose, the choice made here is
 * written into it as well, so the vent side can be built to the same reading. */
#include <string.h>
#include <stdio.h>
#include "cJSON.h"
#include "ps.h"

/* ---- the pairing arithmetic ----------------------------------------------------------
 * Every derivation hashes the HEX STRINGS concatenated, not the bytes they spell. That is
 * what the contract's `sha256(nonce_a ‖ nonce_b ‖ …)` came to mean in practice, because both
 * mocks are JavaScript and concatenate strings; the firmware follows them rather than the
 * other way round, since the two ends only have to agree with each other. */

static void sha_hex_of(const char *const *parts, int n, char out[65])
{
    ps_sha256_t c;
    uint8_t d[32];
    ps_sha256_init(&c);
    for (int i = 0; i < n; i++) ps_sha256_update(&c, parts[i], strlen(parts[i]));
    ps_sha256_final(&c, d);
    ps_hex(d, 32, out);
}

void ps_bridge_code(const char *na, const char *nb, const char *ia, const char *ib, char out[7])
{
    /* The whole 256-bit number mod one million, big-endian, one byte at a time: exact, with
       no big-number arithmetic, and the same answer JavaScript's BigInt gives. */
    ps_sha256_t c;
    uint8_t d[32];
    ps_sha256_init(&c);
    ps_sha256_update(&c, na, strlen(na)); ps_sha256_update(&c, nb, strlen(nb));
    ps_sha256_update(&c, ia, strlen(ia)); ps_sha256_update(&c, ib, strlen(ib));
    ps_sha256_final(&c, d);
    uint32_t r = 0;
    for (int i = 0; i < 32; i++) r = (r * 256u + d[i]) % 1000000u;
    snprintf(out, 7, "%06u", (unsigned)r);
}

void ps_bridge_token(const char *na, const char *nb, const char *ia, const char *ib, char out[65])
{
    const char *p[] = { na, nb, ia, ib, "pandabridge" };
    sha_hex_of(p, 5, out);
}

void ps_bridge_auth(const char *token_hex, const char *nonce_hex, char out[65])
{
    const char *p[] = { token_hex, nonce_hex };
    sha_hex_of(p, 2, out);
}

/* The identity: the first eight bytes of sha256 over the six raw bytes of the station MAC.
 * Stable across address changes and across a factory reset of the OTHER device, which is the
 * property the contract asks of it. */
void ps_bridge_identity(const uint8_t mac[6], char out[17])
{
    uint8_t d[32];
    ps_sha256(mac, 6, d);
    ps_hex(d, 8, out);
}

/* ---- RFC 6455 framing, the client side ----------------------------------------------- */

size_t ps_ws_encode(uint8_t opcode, const uint8_t *payload, size_t len, const uint8_t mask[4],
                    uint8_t *out, size_t cap)
{
    size_t hdr = 2 + (len > 65535 ? 8 : len > 125 ? 2 : 0) + 4;
    if (hdr + len > cap) return 0;
    size_t i = 0;
    out[i++] = (uint8_t)(0x80 | (opcode & 0x0f));             /* FIN, one frame per message */
    if (len <= 125) out[i++] = (uint8_t)(0x80 | len);          /* a client always masks (5.3) */
    else if (len <= 65535) { out[i++] = 0x80 | 126; out[i++] = (uint8_t)(len >> 8); out[i++] = (uint8_t)len; }
    else { out[i++] = 0x80 | 127; for (int b = 7; b >= 0; b--) out[i++] = (uint8_t)((uint64_t)len >> (8 * b)); }
    memcpy(out + i, mask, 4); i += 4;
    for (size_t k = 0; k < len; k++) out[i + k] = payload[k] ^ mask[k & 3];
    return i + len;
}

int ps_ws_parse(uint8_t *buf, size_t len, ps_ws_frame_t *f)
{
    if (len < 2) return 0;
    uint8_t b0 = buf[0], b1 = buf[1];
    if (b0 & 0x70) return -1;                                  /* RSV bits: no extension was negotiated */
    f->fin = (b0 & 0x80) != 0;
    f->opcode = b0 & 0x0f;
    f->masked = (b1 & 0x80) != 0;
    uint64_t n = b1 & 0x7f;
    size_t i = 2;
    if (n == 126) {
        if (len < 4) return 0;
        n = (uint64_t)buf[2] << 8 | buf[3]; i = 4;
    } else if (n == 127) {
        if (len < 10) return 0;
        n = 0; for (int b = 0; b < 8; b++) n = n << 8 | buf[2 + b];
        if (n >> 63) return -1;                                /* 5.2: the most significant bit MUST be 0 */
        i = 10;
    }
    /* Control frames are short and never fragmented (5.5). */
    if ((f->opcode & 0x08) && (n > 125 || !f->fin)) return -1;
    if (f->masked) {
        if (len < i + 4) return 0;
        memcpy(f->mask, buf + i, 4); i += 4;
    }
    if (n > (uint64_t)(len - i)) return 0;                     /* not all here yet */
    f->len = n;
    f->header = i;
    f->payload = buf + i;
    if (f->masked) for (uint64_t k = 0; k < n; k++) buf[i + k] ^= f->mask[k & 3];
    return (int)(i + n);
}

/* ---- a vent report ------------------------------------------------------------------- */

static const char *const VENT_STATES[] = { "unknown", "open", "closed", "sealing", "moving" };

const char *ps_vent_state_name(int s)
{
    return (s >= 0 && s < (int)(sizeof VENT_STATES / sizeof VENT_STATES[0])) ? VENT_STATES[s] : "unknown";
}

/* A state this device does not know is kept as unknown rather than refused: a vent a version
 * ahead of this one is still a vent worth showing. What IS refused is a body that is not a
 * report at all. Every other field is optional and carried only when it arrived, because a
 * chamber of nothing is not zero degrees and a policy nobody reported is not "following". */
int ps_bridge_vent_parse(const cJSON *body, ps_vent_report_t *out)
{
    if (!cJSON_IsObject(body)) return -1;
    const cJSON *st = cJSON_GetObjectItemCaseSensitive(body, "state");
    if (!cJSON_IsString(st) || !st->valuestring) return -1;
    memset(out, 0, sizeof *out);
    out->state = PS_VENT_UNKNOWN;
    for (int s = 1; s < (int)(sizeof VENT_STATES / sizeof VENT_STATES[0]); s++)
        if (!strcmp(st->valuestring, VENT_STATES[s])) out->state = (uint8_t)s;

    const cJSON *ch = cJSON_GetObjectItemCaseSensitive(body, "chamber_c");
    if (cJSON_IsNumber(ch) && ch->valuedouble > -273.0 && ch->valuedouble < 1000.0) {
        out->have_chamber = true;
        out->chamber_c = (float)ch->valuedouble;
    }
    const cJSON *pol = cJSON_GetObjectItemCaseSensitive(body, "policy");
    if (cJSON_IsObject(pol)) {
        const cJSON *ov = cJSON_GetObjectItemCaseSensitive(pol, "override");
        if (cJSON_IsBool(ov)) {
            out->have_policy = true;
            out->override = cJSON_IsTrue(ov);
            const cJSON *rs = cJSON_GetObjectItemCaseSensitive(pol, "reason");
            if (cJSON_IsString(rs) && rs->valuestring) {
                strncpy(out->reason, rs->valuestring, sizeof out->reason - 1);
            }
        }
    }
    const cJSON *er = cJSON_GetObjectItemCaseSensitive(body, "error");
    if (cJSON_IsString(er) && er->valuestring) strncpy(out->error, er->valuestring, sizeof out->error - 1);
    return 0;
}
