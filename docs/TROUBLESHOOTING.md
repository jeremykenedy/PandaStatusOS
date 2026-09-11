# Troubleshooting

The page tells you most of this itself; the Logs page tells you the rest. Every symptom
below names the page and the field that shows it.


## Fault codes on the bar

Off by default. Turn on **Fault codes on the bar** on the System page (feature bit 19,
[FEATURES.md](FEATURES.md)) and the bar stops showing the printer's state while it cannot
reach something, and blinks a code instead: a colour for the area, a count of blinks for
the reason, then a pause, repeating. The network outranks the printer, because a printer
cannot be reached without it. Nothing blinking means nothing is wrong with either.

| Colour | Blinks | What it means | What to do |
|---|---:|---|---|
| amber | 1 | no network configured | open the device's hotspot and set the Wi-Fi on the setup page |
| amber | 2 | joining the network | wait; if it stays here, the network is not answering |
| amber | 3 | rejoining after losing the network | wait; if it stays here, the signal is marginal |
| amber | 4 | the Wi-Fi password was refused | retype it on the Network page |
| blue | 1 | no printer bound | bind one on the Printer page |
| blue | 2 | connecting to the printer | wait |
| blue | 3 | nothing answers at the printer's address | check the address; a printer that moved is found again by serial with bit 18 on |
| blue | 4 | the printer refused the access code | retype it from the printer's own screen |
| blue | 5 | the printer refused the serial number | check it against the printer's own screen |
| blue | 6 | the printer failed in a way this build does not name | the device log has the raw reason |

The brightness of a code is its own, not the bar's: a bar turned down or off still shows
its codes, which is the point.

## The page says "Waiting for the device to send its state" and never moves

The socket opened but no document arrived. The device pushes all six roots the moment a
socket connects, so a wait of more than a few seconds means the firmware is up but not
answering, or a proxy sits between you and it. Reload; if it persists, power-cycle the
device. The Logs page shows "socket open" with nothing after it.

## "Connection lost" with a Reload button

The device closed the socket. It does that when it restarts, which it does by itself
after a hostname change, a hotspot address change and a firmware update, and after a
factory reset. Wait for it to come back and reload. If the address changed, find the
device at its new address or on its hotspot.

A control used while the socket is down sends nothing and brings this dialog back; that
is by design. Escape closes it without reloading.

## Wi-Fi

| Network page says | Meaning | Do |
|---|---|---|
| No network configured | the device has no Wi-Fi name stored | the setup page, or Connect to a network |
| Connecting | the device is trying | wait; it retries every five seconds |
| Reconnecting, with a reason code | the network dropped it; the code is what the radio reported | check the network; the code is shown as the device sends it, its meaning is not documented |
| Wrong password | authentication failed | retype the password; the reason code says which handshake step failed |

The device keeps its hotspot up while it joins a network (when the hotspot is on), so
a failed join does not strand you.

## Printer

| Printer page says | Meaning | Do |
|---|---|---|
| Not bound | no printer serial number or address stored | scan, or type them; both are on the printer's own screen |
| Connecting | the MQTT client is trying | wait; it retries by itself |
| Address error | no route to the address, or no TLS on it | check the printer's address; it moves when DHCP hands out a new one |
| Serial does not match | the device answered with a different serial | the serial belongs to another printer on the network |
| Access code rejected | the broker refused the credentials | retype the access code from the printer's screen |
| Unknown error | something else | the Logs page; then unbind and bind again |

The printer's certificate is self-signed and is not verified; the access code is the
secret. Do not put a printer on a network you do not trust.

A scan finishes with no printers found: no discovery mechanism is documented yet, so
the scan cannot find anything. Type the serial number and address.

## Uploads

| Status line says | Meaning |
|---|---|
| Too big. The limit is ... | refused in the browser before any request; the caps are 1.5 MB per animation, 4.5 MB for firmware, 6.875 MB for the image pack |
| Refused by the device | the device answered `ok: 0`; for an animation that means the slot's region is smaller than the file (the images partition is divided into fifteen equal parts) |
| Upload failed (code) | the HTTP request itself failed; 0 means the connection dropped |
| Sent. Waiting for the device to confirm. | the bytes arrived and the device has not answered yet |

An animation you uploaded is not shown back to you because the device has no route
that serves it; the preview is the file you chose, in this browser only.

## Lighting

The Reset button does nothing in Music mode and says so: the factory page never sends
the reset in that mode. Switch to H2D first.

Speed is disabled in Music mode; that is the factory behaviour. The slider keeps the
value you set even when the device does not echo it back.

## The bar itself

Until Phase 1 recovers the factory's animation math, the bar shows the state colour,
solid, at the set brightness, in both modes. That is a placeholder and the source says
so. The LED count and the GPIO are build-time PROVISIONAL numbers; a bar that lights the
wrong number of LEDs, or none, means those numbers are wrong for your unit.

## Language and theme

The language is stored on the device and applies to every browser. The theme is stored
in the browser you set it in. A language switch repaints the page in place; Arabic and
Hebrew flip the layout.

## Reading the Logs page

Newest first. "device sent state:" lines list the roots of a push; "page sent:" lines
show the exact frame the page sent, with passwords and access codes replaced by their
length; "device answered:" lines are the device's verdicts. Copy puts the list on the
clipboard for a bug report; nothing on it is a secret.

## Installing and backing up

**The upload said 200 and nothing changed.** That is the factory's `/ota`: it answers 200
whether the image landed or not. `tools/fw/ota-install.sh` is the only install path that
reports a verdict, and NOT LANDED is the honest one. Rebuild (the build id changes with
every build) and run it again; if it stays NOT LANDED, the device refused the image silently
and the Logs page of the running firmware, if it is the clone, says why.

**After the first install the device never came back at its address.** Expected. The clone
has no Wi-Fi credentials yet, so it is on its own hotspot (placeholder name `PandaStatus`,
open, 192.168.4.1) showing the setup card. Join it, set up Wi-Fi, and from the network run
`tools/fw/ota-install.sh verify <new address>` for the verdict.

**`GET /backup` answers 403.** The request arrived over the hotspot. The backup carries the
Wi-Fi password inside NVS, and the hotspot is open by default, so the endpoint serves the
station interface only. Take the backup from the network the device is on.

**`golden.sh` says SHORT READ.** The device promised more bytes in `X-Flash-Size` than it
sent; the connection dropped mid-transfer. Nothing was kept. Run it again; a golden is
whole or it is not a golden.

**`preflight.sh` refuses.** Read the line that says FAIL. There is no override; the check
that failed is the thing to fix, and `firmware/SAFETY.md` explains why each one exists.

