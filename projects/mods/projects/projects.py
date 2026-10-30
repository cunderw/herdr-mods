#!/usr/bin/env python3
"""Git repos in the given folders under home, up to two levels down, as a JSON list."""
import json
import sys
from pathlib import Path

SKIP = {"_ARCHIVE", "node_modules", "target", "vendor"}


def repos(root):
    for first in sorted(p for p in root.iterdir() if p.is_dir() and p.name not in SKIP and not p.name.startswith(".")):
        if (first / ".git").exists():
            yield first
            continue
        for second in sorted(p for p in first.iterdir() if p.is_dir() and p.name not in SKIP):
            if (second / ".git").exists():
                yield second


found = []
for name in sys.argv[1:]:
    root = Path.home() / name
    if root.is_dir():
        found.extend(str(r) for r in repos(root))
print(json.dumps(found))
