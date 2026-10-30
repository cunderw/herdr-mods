#!/usr/bin/env python3
"""Files named on a terminal's screen, newest first, as JSON.

  usage: visible-paths.py <terminal> <cwd>

A candidate counts only if it exists, tried against the cwd and then its git root.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HISTORY_LINES = "200"
CANDIDATE = re.compile(r"(?:~/|\.{1,2}/|/)?[\w@.+-]+(?:/[\w@.+-]+)*(?::(\d+))?")

terminal, cwd = sys.argv[1], Path(sys.argv[2])
text = subprocess.run(["hc", "read", terminal, "--lines", HISTORY_LINES], capture_output=True, text=True, check=True).stdout
top = subprocess.run(["git", "-C", str(cwd), "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
roots = [cwd] + ([Path(top)] if top else [])

found = {}
for match in reversed(list(CANDIDATE.finditer(text))):
    shown = match[0].split(":")[0].rstrip(".,")
    if "/" not in shown and "." not in shown:
        continue
    expanded = Path(shown).expanduser()
    for path in [expanded] if expanded.is_absolute() else [r / expanded for r in roots]:
        if path.is_file():
            key = str(path.resolve())
            if key not in found:
                found[key] = {"path": key, "shown": shown, "line": int(match[1]) if match[1] else None}
            break
print(json.dumps(list(found.values())))
