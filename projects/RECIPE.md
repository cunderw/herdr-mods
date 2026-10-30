# Projects

A popup listing your git repos. Pick one to jump to its space, or to open a new space there.

![Projects](preview.png)

## What you see

- A popup near the top of the window, 720px wide and 560px high, 40px from the top.
- A heading, "Projects", with a count on the right, and a filter box under it.
- Up to 12 rows: the repo's name, and its path on the right. Repos with an open space come first, with a dot.

## How it behaves

- Typing filters by name or path. Up and Down move, Enter opens, Escape closes, and a click opens a row.
- A repo with a space goes to that space. A space matches by its folder or its name, so two repos with one name both show as open.
- Any other repo gets a new space named after it, in that folder.
- If `scripts/dev-layout.sh` exists in your Herdr home and can run, it lays out the new space.

## Built from

- One mod, `mods/projects/`: `main.js`, `list.js`, `mod.json`, `projects.py` and `open-project.sh`. `mod.json` has `place: "none"` and the popup overlay, so nothing changes in your layout.
- Roots come from `projects.json` in your Herdr home, normally `~/.config/herdr-app/projects.json`. It looks like `{"roots": ["Dev", "Dev/work"]}`, with folders relative to your home.
- Without that file, the root is `Dev`. Each root is searched two levels down. The file is read each time the popup opens.
- `LAYOUT_SCRIPT` at the top of `main.js` sets the layout script.
- The layout script gets `<pane> <terminal> <tab> <space> <folder>`.
- `keys.json` binds `ctrl-b o`. Change it if you use that key. It also binds `ctrl-j`/`ctrl-k` to move through the list while the popup has the keyboard.

The mod runs programs (`python3`, `herdr-app`, `jq`, and your layout script if you have one) and reads `projects.json` and folder names under its roots.

## Watch out

- `_ARCHIVE`, `node_modules`, `target` and `vendor` are skipped, in `projects.py`.
- Repos deeper than two levels under a root aren't found. Add a deeper root for them.
- A broken `projects.json` shows its error in the popup.
- `jq` and `python3` must be on your PATH.

## Done when

- `herdr-app check mods/projects` passes.
- The popup lists your repos, open ones first.
- Enter on an open repo goes to its space, and on a closed one makes a space in that folder.
