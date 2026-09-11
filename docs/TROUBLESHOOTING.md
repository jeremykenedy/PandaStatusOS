# Troubleshooting

The page tells you most of this itself; the Logs page tells you the rest. Every symptom
below names the page and the field that shows it.

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
