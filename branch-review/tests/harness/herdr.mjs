// A stand-in for the herdr module: git and fs are real, the app is recorded.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
export const log = { overlays: [], runs: [], notes: [], hc: [] };
export const world = {
  props: {}, shared: new Map(),
  agents: [
    { address: "t1", status: "idle", app: "claude-code", program: { name: "Claude Code" }, space: "s1", space_name: "fixture", tab: "tb", tab_name: "1", seq: 2, focused: false },
    { address: "t2", status: "working", app: "codex", program: { name: "Codex" }, space: "s2", space_name: "other", tab: "tb2", tab_name: "1", seq: 5, focused: false },
  ],
  terminals: [], hcResult: { code: 0, stdout: "", stderr: "" },
};
export const exec = (cmd, args = [], { cwd } = {}) => new Promise((res, rej) => {
  if (cmd === "gh") return res(world.gh ? world.gh(args) : { code: 1, stdout: "", stderr: "no git remotes found" });
  if (cmd === "open") return res({ code: 0, stdout: "", stderr: "" });
  execFile(cmd, args, { cwd, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== "number") return rej(err);
    res({ code: err ? err.code : 0, stdout, stderr });
  });
});
export const hc = async (args) => { log.hc.push(args); return world.hcResult; };
export const readTextFile = async (p) => readFile(p, "utf8").catch(() => null);
export const watchFolder = () => new Promise(() => {});
export const nextCommand = () => new Promise(() => {});
export const agents = () => world.agents;
export const terminals = () => world.terminals;
export const spaces = () => [{ id: "s1", active: true, machine: null, folder: "/" }];
export const panes = () => [];
export const focused = () => ({ space: "s1", tab: "tb", pane: null });
export const theme = () => new Proxy({}, { get: () => "#336699" });
export const settings = () => ({});
export const props = () => world.props;
export const shared = (k) => world.shared.get(k);
export const setShared = (k, v) => { world.shared.set(k, v); };
export const notify = (n) => { log.notes.push(n); };
export const openOverlay = (spec) => { log.overlays.push(spec); return "ov1"; };
export const closeOverlay = () => {};
export const run = (name, args) => { log.runs.push([name, args]); };
