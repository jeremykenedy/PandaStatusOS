# Screenshots

Taken from a running device over Wi-Fi on 2026-09-11, not from the mock. The Printer page
is a real scan finding two real printers.

**Every identifier is replaced before the shutter**, by a sanitiser that runs in the page
just before the capture: the maintainer's own forbidden-strings list is swept first, then
network names become `your-network`, every address becomes a distinct one in 192.0.2.0/24
(the range reserved for documentation), the hotspot name loses the MAC it is built from, and
serials become `EXAMPLESERIAL01`. The hotspot's own 192.168.4.1 is kept, because it is
published in the README and is the same on every device. Nothing else is altered: the layout,
the state and the wording are what the device served.

The capture script is not in this repository. It belongs to the working area, like the
harnesses, because it drives a browser and because it reads the forbidden-strings list. To
retake these, run it against a device and copy the results here, then check every image by
eye before committing: a sanitiser can only replace what it has been told about, and the
first run of it published a network name because the name was in a text node and matched no
pattern.

The older set was taken by the page harnesses against the mock. `tools/ui/harness/sweep.sh`
followed by `tools/ui/harness/readme-shots.sh` still produces that set, which is the right
source when there is no hardware to hand.

| File | What |
|---|---|
| `dashboard-light.png`, `dashboard-dark.png` | the dashboard, desktop, both themes |
| `lighting-light.png` | lighting, desktop |
| `lighting-dark-phone.png` | lighting on a phone, dark |
| `images-dark.png` | the fifteen stage slots |
| `printer-light.png` | printer binding |
| `network-dark.png` | Wi-Fi, hostname, hotspot |
| `system-light.png` | versions, language, theme, updates, the three resets |
| `logs-dark.png` | the event log after a few frames, credentials as lengths |
| `setup-light-phone.png` | the first-run page on a phone |
