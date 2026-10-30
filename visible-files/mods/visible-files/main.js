// Files named on the focused terminal's screen. Enter opens one in the tab's
// nvim when that nvim listens (see RECIPE.md), else in $EDITOR in a new pane.
import { appHome, exec, focused, home, notify, panes, run, spaces } from "herdr";
import { QuickList } from "./list.js";

// Where a Herdr-aware nvim listens, by terminal address. See RECIPE.md.
const server = (terminal) => `${home()}/.local/state/nvim/herdr-${terminal}.sock`;

async function inEditor(path, line) {
  const editor = (await exec("sh", ["-c", 'printf %s "${EDITOR:-vi}"'])).stdout;
  const argv = [...editor.split(" "), ...(line ? [`+${line}`] : []), path];
  run("pane.split", { direction: "right", argv });
}

async function open(path, line) {
  const f = focused(), tabs = spaces().find((s) => s.active)?.tabs.map((t) => t.id) ?? [];
  const nvims = panes().filter((p) => p.program?.key === "nvim" && p.terminal && !p.terminal.includes("/"));
  const pane = nvims.find((p) => p.tab === f?.tab) ?? nvims.find((p) => tabs.includes(p.tab));
  if (!pane) return inEditor(path, line);
  const quoted = path.replace(/'/g, "''");
  const r = await exec("nvim", ["--server", server(pane.terminal), "--remote-expr", `v:lua.herdr_open('${quoted}', ${line ?? 0})`]).catch(() => null);
  if (r?.code !== 0) return inEditor(path, line);
  if (pane.tab !== f?.tab) run("tab.select", { id: pane.tab });
  run("pane.focus", { pane: pane.pane });
}

export default class VisibleFiles extends QuickList {
  config() {
    return {
      title: "Visible files",
      placeholder: "Open a file on screen…",
      empty: "No existing files on screen",
      async load() {
        const { terminal, cwd } = focused() ?? {};
        if (!terminal) throw new Error("No terminal has focus");
        const r = await exec(`${appHome()}/mods/visible-files/visible-paths.py`, [terminal, cwd ?? home()]);
        if (r.code !== 0) throw new Error(r.stderr.trim());
        return JSON.parse(r.stdout).map((p) => ({ title: p.shown, detail: p.line ? `line ${p.line}` : "", path: p.path, line: p.line }));
      },
      choose: (item) => open(item.path, item.line).catch((e) => notify({ title: "Couldn't open that", body: String(e), level: "error" })),
    };
  }
}
