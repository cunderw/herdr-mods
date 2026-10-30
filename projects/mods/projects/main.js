// Git repos under ROOTS; Enter goes to the repo's space or opens a new one.
import { appHome, exec, home, notify, run, spaces } from "herdr";
import { QuickList } from "./list.js";

// Folders holding repos, relative to home. Each is searched two levels down.
const ROOTS = ["Dev"];
// Runs in each new space with <pane> <terminal> <tab> <space> <folder>; skipped if it's missing.
const LAYOUT_SCRIPT = "scripts/dev-layout.sh";

async function load() {
  const r = await exec(`${appHome()}/mods/projects/projects.py`, ROOTS);
  if (r.code !== 0) throw new Error(r.stderr.trim());
  // A space may have started elsewhere, so its name counts as much as its folder.
  const open = new Map(spaces().flatMap((s) => [[s.folder, s], [s.name, s]]));
  return JSON.parse(r.stdout)
    .map((path) => {
      const title = path.split("/").pop(), space = open.get(path) ?? open.get(title);
      return { title, detail: path.replace(`${home()}/`, ""), path, space, mark: space ? "●" : null, markColor: "done" };
    })
    .sort((a, b) => Number(Boolean(b.space)) - Number(Boolean(a.space)));
}

export default class Projects extends QuickList {
  config() {
    return {
      title: "Projects",
      placeholder: "Open a project…",
      empty: "No git repos found",
      load,
      async choose(item) {
        if (item.space) return run("space.select", { id: item.space.id });
        const app = appHome();
        const r = await exec(`${app}/mods/projects/open-project.sh`, [item.path, `${app}/${LAYOUT_SCRIPT}`]);
        if (r.code !== 0) notify({ title: "Couldn't open the project", body: r.stderr.trim(), level: "error" });
      },
    };
  }
}
