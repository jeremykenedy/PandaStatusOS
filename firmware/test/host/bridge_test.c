/* Host test for the vent bridge's pure parts: ps_sha256.c and ps_bridge_proto.c.
 *
 * Every expected value here comes from outside this repository's C:
 *   - the SHA-256 digests are FIPS 180-4's own example vectors;
 *   - the pairing numbers were computed by node's crypto, the same derivation the mock vent
 *     (tools/ui/mock/mockvent.js) and the harness (tools/ui/harness/vent.js) run, from the
 *     same inputs, so the firmware and both mocks are held to one set of numbers;
 *   - the frames are the byte sequences RFC 6455 section 5.7 prints as its examples.
 *
 *   bash firmware/test/host/run.sh      (or: make test-fw) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "ps.h"

static int pass, fail;
static void t(const char *name, int ok, const char *got)
{
    if (ok) { pass++; printf("  ok    %s\n", name); }
    else { fail++; printf("  FAIL  %s   got: %s\n", name, got ? got : "(null)"); }
}

static const char *hex_of(const void *data, size_t n)
{
    static char out[65];
    uint8_t d[32];
    ps_sha256(data, n, d);
    ps_hex(d, 32, out);
    return out;
}

int main(void)
{
    /* ---- SHA-256, FIPS 180-4 ---- */
    t("sha256(\"abc\"), the one-block example",
      !strcmp(hex_of("abc", 3), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"), hex_of("abc", 3));
    t("sha256 of nothing at all",
      !strcmp(hex_of("", 0), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), hex_of("", 0));
    {
        const char *m = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        t("sha256 of the 448-bit example, where the padding spills into a second block",
          !strcmp(hex_of(m, strlen(m)), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"), hex_of(m, strlen(m)));
    }
    {
        /* A million 'a', fed in uneven pieces so the buffering between blocks is exercised
           and the length encoding has to carry past 2^20 bits. */
        ps_sha256_t c; uint8_t d[32]; char h[65];
        char *a = malloc(1000000); memset(a, 'a', 1000000);
        ps_sha256_init(&c);
        size_t off = 0, step = 1;
        while (off < 1000000) { size_t n = step; if (off + n > 1000000) n = 1000000 - off; ps_sha256_update(&c, a + off, n); off += n; step = step * 7 % 997 + 1; }
        ps_sha256_final(&c, d); ps_hex(d, 32, h); free(a);
        t("sha256 of a million 'a', fed in uneven pieces",
          !strcmp(h, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"), h);
    }

    /* ---- the pairing arithmetic, against node's numbers ---- */
    const char *na = "00112233445566778899aabbccddeeff", *nb = "ffeeddccbbaa99887766554433221100";
    const char *ia = "0123456789abcdef", *ib = "fedcba9876543210";
    char code[7], token[65], auth[65], id[17];
    ps_bridge_code(na, nb, ia, ib, code);
    t("the six digits are what the mock vent and the harness compute", !strcmp(code, "385633"), code);
    ps_bridge_token(na, nb, ia, ib, token);
    t("the token too", !strcmp(token, "626e551af59a140a94403e23651cb4fe26abbe6893d619155d64d049a2d6a975"), token);
    ps_bridge_auth(token, na, auth);
    t("and the auth a returning peer proves itself with",
      !strcmp(auth, "bc63c0e864e305760e130e698452f23044f43de3f21255367f5983f6a5fa35d7"), auth);
    {
        const uint8_t mac[6] = { 0x02, 0x00, 0x00, 0x00, 0x00, 0x01 };   /* locally administered: nobody's */
        ps_bridge_identity(mac, id);
        t("an identity is the first eight bytes of sha256 over the six MAC bytes", !strcmp(id, "70a762c644adabb6"), id);
    }
    {
        /* The code is the whole 256-bit number mod a million, so it keeps its leading zeros:
           a code of 42 is shown as 000042, not as 42, or the two devices would disagree about
           what to show. */
        char c2[7]; int zeros_ok = 1;
        for (int i = 0; i < 400; i++) {
            char n1[33]; snprintf(n1, sizeof n1, "%032x", i);
            ps_bridge_code(n1, nb, ia, ib, c2);
            if (strlen(c2) != 6) zeros_ok = 0;
            for (int k = 0; k < 6; k++) if (c2[k] < '0' || c2[k] > '9') zeros_ok = 0;
        }
        t("every code is six digits, leading zeros kept", zeros_ok, NULL);
    }

    /* ---- the effects, by name: what the vent sends and this device reads ---- */
    t("the progress bar is 17 here and named progress on the wire", ps_bridge_fx_id("progress") == PS_FX_PROGRESS && !strcmp(ps_bridge_fx_name(PS_FX_PROGRESS), "progress"), ps_bridge_fx_name(PS_FX_PROGRESS));
    t("the barber pole and the temperature gradient by name", ps_bridge_fx_id("barber") == PS_FX_BARBER && ps_bridge_fx_id("temp_gradient") == PS_FX_TEMP_GRADIENT, NULL);
    t("stock's colour cycle is hue_cycle on the wire", ps_bridge_fx_id("hue_cycle") == PS_FX_HUE_CYCLE, NULL);
    t("the vent's own animation player is a name this device refuses", ps_bridge_fx_id("anim") == -1 && ps_bridge_fx_id(NULL) == -1 && ps_bridge_fx_id("") == -1, NULL);
    {
        int distinct = 1;
        for (int i = 0; i < PS_FX_COUNT && distinct; i++) for (int j = i + 1; j < PS_FX_COUNT; j++) if (!strcmp(ps_bridge_fx_name(i), ps_bridge_fx_name(j))) distinct = 0;
        t("every effect has a name of its own, and each maps back to its id", distinct && ps_bridge_fx_id(ps_bridge_fx_name(PS_FX_PALETTE_SCROLL)) == PS_FX_PALETTE_SCROLL, NULL);
    }

    /* ---- RFC 6455 section 5.7, byte for byte ---- */
    {
        const uint8_t mask[4] = { 0x37, 0xfa, 0x21, 0x3d };
        const uint8_t want[] = { 0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58 };
        uint8_t out[32];
        size_t n = ps_ws_encode(PS_WS_TEXT, (const uint8_t *)"Hello", 5, mask, out, sizeof out);
        t("a masked \"Hello\" is the RFC's own eleven bytes", n == sizeof want && !memcmp(out, want, n), NULL);
        uint8_t tiny[8];
        t("and a frame that does not fit is refused, not truncated",
          ps_ws_encode(PS_WS_TEXT, (const uint8_t *)"Hello", 5, mask, tiny, sizeof tiny) == 0, NULL);
    }
    {
        uint8_t b[] = { 0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f };
        ps_ws_frame_t f;
        int n = ps_ws_parse(b, sizeof b, &f);
        t("an unmasked \"Hello\" from a server parses whole",
          n == 7 && f.fin && f.opcode == PS_WS_TEXT && !f.masked && f.len == 5 && !memcmp(f.payload, "Hello", 5), NULL);
    }
    {
        uint8_t b[] = { 0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58 };
        ps_ws_frame_t f;
        int n = ps_ws_parse(b, sizeof b, &f);
        t("a masked one is unmasked in place", n == 11 && f.masked && f.len == 5 && !memcmp(f.payload, "Hello", 5), NULL);
    }
    {
        uint8_t a[] = { 0x01, 0x03, 0x48, 0x65, 0x6c }, c[] = { 0x80, 0x02, 0x6c, 0x6f };
        ps_ws_frame_t f1, f2;
        int n1 = ps_ws_parse(a, sizeof a, &f1), n2 = ps_ws_parse(c, sizeof c, &f2);
        t("a fragmented \"Hello\": the first frame is text and not final",
          n1 == 5 && !f1.fin && f1.opcode == PS_WS_TEXT && f1.len == 3, NULL);
        t("and the second is a final continuation", n2 == 4 && f2.fin && f2.opcode == PS_WS_CONT && f2.len == 2, NULL);
    }
    {
        uint8_t b[] = { 0x89, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f };
        ps_ws_frame_t f;
        t("a ping carrying \"Hello\"", ps_ws_parse(b, sizeof b, &f) == 7 && f.opcode == PS_WS_PING && f.len == 5, NULL);
    }
    {
        uint8_t *b = calloc(1, 4 + 256);
        b[0] = 0x82; b[1] = 0x7e; b[2] = 0x01; b[3] = 0x00;
        ps_ws_frame_t f;
        int n = ps_ws_parse(b, 4 + 256, &f);
        t("256 bytes in one frame, with the 16-bit length", n == 260 && f.header == 4 && f.len == 256, NULL);
        t("and three bytes short of that is not a frame yet", ps_ws_parse(b, 4 + 253, &f) == 0, NULL);
        free(b);
    }
    {
        size_t total = 10 + 65536;
        uint8_t *b = calloc(1, total);
        b[0] = 0x82; b[1] = 0x7f; b[7] = 0x01;          /* 0x0000000000010000 */
        ps_ws_frame_t f;
        int n = ps_ws_parse(b, total, &f);
        t("64 KiB in one frame, with the 64-bit length", n == (int)total && f.header == 10 && f.len == 65536, NULL);
        free(b);
    }
    {
        ps_ws_frame_t f;
        uint8_t one[] = { 0x81 };
        t("one byte is not enough to know anything", ps_ws_parse(one, 1, &f) == 0, NULL);
        uint8_t rsv[] = { 0xC1, 0x00 };
        t("an extension bit nobody negotiated is refused", ps_ws_parse(rsv, 2, &f) == -1, NULL);
        uint8_t bigping[] = { 0x89, 0x7e, 0x00, 0x80 };
        t("a control frame longer than 125 bytes is refused", ps_ws_parse(bigping, 4, &f) == -1, NULL);
        uint8_t fragping[] = { 0x09, 0x00 };
        t("and so is a fragmented one", ps_ws_parse(fragping, 2, &f) == -1, NULL);
    }
    {
        /* A round trip through both halves at the size where the length changes encoding. */
        uint8_t payload[126], out[160], mask[4] = { 1, 2, 3, 4 };
        for (int i = 0; i < 126; i++) payload[i] = (uint8_t)(i * 7);
        size_t n = ps_ws_encode(PS_WS_TEXT, payload, 126, mask, out, sizeof out);
        ps_ws_frame_t f;
        int m = ps_ws_parse(out, n, &f);
        t("126 bytes cross into the 16-bit length and come back as they went",
          n == 2 + 2 + 4 + 126 && m == (int)n && f.len == 126 && !memcmp(f.payload, payload, 126), NULL);
    }

    /* ---- a vent report ---- */
    {
        ps_vent_report_t r;
        cJSON *j = cJSON_Parse("{\"seq\":7,\"state\":\"sealing\",\"policy\":{\"override\":true,\"reason\":\"material\"},\"chamber_c\":41.5,\"error\":null}");
        int rc = ps_bridge_vent_parse(j, &r);
        t("the contract's own example report is read whole",
          rc == 0 && r.state == PS_VENT_SEALING && r.have_chamber && r.chamber_c > 41.4f && r.chamber_c < 41.6f
          && r.have_policy && r.override && !strcmp(r.reason, "material") && r.error[0] == 0, NULL);
        cJSON_Delete(j);
    }
    {
        ps_vent_report_t r;
        cJSON *j = cJSON_Parse("{\"state\":\"levitating\"}");
        t("a state this device does not know is kept, as unknown", ps_bridge_vent_parse(j, &r) == 0 && r.state == PS_VENT_UNKNOWN, NULL);
        t("with no chamber, no policy and no fault invented for it", !r.have_chamber && !r.have_policy && r.error[0] == 0, NULL);
        cJSON_Delete(j);
    }
    {
        ps_vent_report_t r;
        cJSON *j = cJSON_Parse("{\"state\":\"open\",\"chamber_c\":\"hot\",\"error\":\"E42\"}");
        t("a chamber that is not a number is not a reading", ps_bridge_vent_parse(j, &r) == 0 && !r.have_chamber, NULL);
        t("and a fault is carried in the vent's own code", !strcmp(r.error, "E42"), r.error);
        cJSON_Delete(j);
    }
    {
        ps_vent_report_t r;
        cJSON *a = cJSON_Parse("[1,2]"), *b = cJSON_Parse("{\"chamber_c\":30}");
        t("something that is not a report is refused", ps_bridge_vent_parse(a, &r) == -1 && ps_bridge_vent_parse(b, &r) == -1, NULL);
        cJSON_Delete(a); cJSON_Delete(b);
    }
    {
        ps_vent_report_t r;
        cJSON *j = cJSON_Parse("{\"state\":\"closed\",\"policy\":{\"override\":false,\"reason\":\"a reason much longer than fifteen\"}}");
        t("a long reason is cut to fit, never overrun",
          ps_bridge_vent_parse(j, &r) == 0 && strlen(r.reason) == 15 && r.have_policy && !r.override, r.reason);
        cJSON_Delete(j);
    }
    t("every state name round-trips", !strcmp(ps_vent_state_name(PS_VENT_MOVING), "moving")
      && !strcmp(ps_vent_state_name(99), "unknown"), NULL);

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
