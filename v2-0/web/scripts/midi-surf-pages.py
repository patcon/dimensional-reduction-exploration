# /// script
# dependencies = ["qrcode[pil]"]
# ///
"""
Writes three MIDI Surf (https://github.com/patcon/midi-surf) pages that match the
setups in src/midiSurf.ts: each page's JSON and a QR code of its import link into
public/midi-surf/, and the links into src/midiSurfLinks.ts.

    uv run scripts/midi-surf-pages.py

A MIDI Surf link carries the whole page: gzipped, base64'd JSON in ?page=.
"""
import base64
import gzip
import json
import urllib.parse
from pathlib import Path

import qrcode

APP = "https://patcon.github.io/midi-surf/"
WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "public" / "midi-surf"

T = lambda tag, *args: {"tag": tag, "args": list(args)}
channel = lambda n: T(f"Ch{n}")
FORCES = [("nbrs", "Blue"), ("midnear", "Green"), ("far", "Red")]


def fader(label, colour, cc, percent):
    return T("Fader", {"status": None, "label": label, "labelSize": T("Medium"), "colour": T(colour),
                       "channel": channel(1), "ccNumber": cc, "valuePercent": percent, "valueMin": 0, "valueMax": 127})


def toggle(label, colour, cc):
    # MIDI Surf has no toggle; a two-step Sequence alternates 0 and 127. Signs start positive,
    # so the first press sends 0 and flips to negative.
    msg = lambda v: T("ControllerChange", {"channel": 0, "controller": cc, "value": v})
    return T("Sequence", {"status": None, "label": label, "labelSize": T("Small"), "colour": T(colour),
                          "midiMsgs": [msg(0), msg(127)], "index": 0})


def bend(label, colour, n):
    return T("PitchBend", {"status": None, "label": label, "labelSize": T("Medium"), "colour": T(colour),
                           "channel": channel(n), "bendValue": 8192})


def page(label, controller):
    return {"label": label, "controller": controller, "config": {"gapSize": 2, "debug": False}}


# Keys match the setup ids in src/midiSurf.ts; CC numbers and channels must match too.
PAGES = {
    "centre-faders": page("PaCMAP 🎚️", T("Row", [fader(n, c, 20 + i, 50) for i, (n, c) in enumerate(FORCES)])),
    "bottom-faders": page("PaCMAP 🎚️±", T("Row", [
        T("SizedColumn", [[5, fader(n, c, 23 + i, 0)], [1, toggle("🧲±", c, 26 + i)]])
        for i, (n, c) in enumerate(FORCES)])),
    "pitch-bends": page("PaCMAP 🎯", T("Row", [bend(n, c, i + 1) for i, (n, c) in enumerate(FORCES)])),
}

OUT.mkdir(parents=True, exist_ok=True)
links = {}
for name, p in PAGES.items():
    (OUT / f"{name}.json").write_text(json.dumps(p, indent=2, ensure_ascii=False) + "\n")
    packed = base64.b64encode(gzip.compress(json.dumps(p, separators=(",", ":")).encode(), mtime=0)).decode()
    links[name] = APP + "?" + urllib.parse.urlencode({"page": packed})
    qrcode.make(links[name], error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=6, border=2).save(OUT / f"{name}.png")
(WEB / "src" / "midiSurfLinks.ts").write_text(
    "// Written by scripts/midi-surf-pages.py: each MIDI Surf page's import link.\n"
    f"export const MIDI_SURF_LINKS = {json.dumps(links, indent=2)} as const\n"
)
print("\n".join(f"{k}: {v}" for k, v in links.items()))
