# HARDWARE FACTS — recovered from the stock dump. Not guesses.

Extracted 2026-09-17 from `GOLDEN-20260911-160847-full-4MB.bin`
(sha256 `a97c06061233bd98de7df5524c2365342812f40eba12e8d7c6a510e1b6340911`,
three USB reads, all three identical).

Factory app: `panda_status_p2`, version 1, ESP-IDF v5.3.1-dirty,
built 15:19:08 Apr 15 2026, chip id 5 (ESP32-C3).

---

## FLASH IS 4 MB. Partition table read from 0x8000.

    nvs        0x009000    12 KiB
    otadata    0x00c000     8 KiB
    app0       0x010000  1984 KiB   (0x1F0000)
    app1       0x200000  1984 KiB   (0x1F0000)
    coredump   0x3f0000     4 KiB

Every earlier reading of the OTA size caps as evidence of a 16 MB part was wrong.
`0x480000` is a shared framework constant. The real geometry is above.

---

## LED DATA PIN = GPIO 5

From the `rmt_tx_channel_config_t` built on the stack at `0x4200eefa`, immediately
before the call that asserts `rmt_new_tx_channel(&tx_chan_config, &led_chan)`:

    field                offset   value
    gpio_num                  0   5
    clk_src                   4   4
    resolution_hz             8   10000000      (10 MHz, the WS2812 standard)
    mem_block_symbols        12   96
    trans_queue_depth        16   4
    intr_priority            20   0
    flags                    24   0

`led_strip_encoder_config_t.resolution` is the same 10,000,000.

**Stop driving eleven pins. Drive GPIO 5.**

---

## LED COUNT = 25

Confirmed two independent ways in the same code.

**1. The transmit size.** Every call to the `rmt_transmit` wrapper at `0x4200da3a`
passes the same literal:

    4200dc78:  addi a2,zero,75     ->  rmt_transmit(..., buf, 75, ...)
    4200ddd4:  addi a2,zero,75
    4200e028:  addi a2,zero,75
    4200e292:  addi a2,zero,75
    ... identical at all ten call sites

75 bytes ÷ 3 bytes per pixel (GRB) = **25 pixels**.

**2. The render loop bound.** In the effect loops that fill that buffer:

    4200e022:  li  a5,24
    4200e024:  bge a5,s2,<loop top>

s2 runs 0 through 24 inclusive. **25 iterations.**

The value has been 8, then 32. Both were guesses. It is 25.

---

## RENDER TICK = 10 ms

`esp_timer_create` with callback `0x4200e8cc`, then
`esp_timer_start_periodic(handle, 10000)`. 10,000 µs = **100 Hz**.

---

## WHAT TO SET

    CONFIG_PS_LED_GPIO   = 5      (was: fan-out across eleven pins)
    CONFIG_PS_LED_COUNT  = 25     (was: 8, then 32)

Delete the eleven-pin fan-out code in `ps_led.c` entirely. It was a workaround for
not knowing the pin. The pin is known. Driving ten wrong GPIOs is not harmless: on
an ESP32-C3 those pins are wired to something on this board, and the factory
firmware drives exactly one.

Mark all four values above **CONFIRMED**, sourced to this file, in
`docs/CONFIG.md`, `Kconfig.projbuild`, and `docs/ROADMAP.md`. Every roadmap item
marked UNKNOWN because it was gated on the LED count is now unblocked.

---

## HOW THIS WAS FOUND, so it can be repeated for anything else still guessed

    python3  -> parse partition table at 0x8000, extract app0 from 0x10000
             -> parse image header: 5 segments, DROM at 0x3c0e0020, IROM at 0x42000020
    strings  -> find "./main/rgb/app_rgb.c" and the ESP_ERROR_CHECK assert texts
    objdump  -> ~/.espressif/tools/riscv32-esp-elf/esp-13.2.0_20240530/
                riscv32-esp-elf/bin/riscv32-esp-elf-objdump
                -D -b binary -m riscv:rv32 --adjust-vma=0x42000020
    grep     -> find the assert string's address in the disassembly; the config
                struct is built on the stack immediately above it

**The dump has been on disk since 2026-09-11. Nothing else in this project should be
guessed while it sits there unread.** Anything currently marked PROVISIONAL gets
checked against it before another build is flashed.
