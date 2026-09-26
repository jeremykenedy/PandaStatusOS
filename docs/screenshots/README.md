# Screenshots

Taken from a running device over Wi-Fi on 2026-09-25, not from the mock: PandaStatusOS
V2.0.0, build 0742f8326fc5fb50, bound to a printer that was 99% through a job.

**Every identifier is replaced before the shutter**, by a sanitiser that runs in the page
just before the capture: the maintainer's own forbidden-strings list is swept first, then
network names become `your-network`, every address becomes a distinct one in 192.0.2.0/24
(the range reserved for documentation), the hotspot name loses the MAC it is built from, and
serials become `EXAMPLESERIAL01`. The hotspot's own 192.168.4.1 is kept, because it is
published in the README and is the same on every device. Nothing else is altered: the layout,
the state and the wording are what the device served.

The capture script is not in this repository. It belongs to the working area, like the
harnesses, because it drives a browser and because it reads the forbidden-strings list. It
freezes the page first, so a push from the device cannot put a real value back between the
sweep and the shutter, and after sweeping it checks the whole document against the list
again and writes no file at all if one of them survived.

Check every image by eye before committing anyway. A sanitiser can only replace what it has
been told about, and it can also replace it with the wrong thing: the run before this one
labelled the bound printer `your-network`, because the printer's name was on the list and
the generic placeholder was a network's. The page said "Printer: your-network" and passed
every check.

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
