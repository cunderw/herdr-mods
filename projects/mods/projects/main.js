// Git repos under the roots in projects.json; Enter goes to the repo's space or opens a new one.
import { appHome, exec, home, notify, readTextFile, run, spaces } from "herdr";
import { QuickList } from "./list.js";

// Used without a projects.json. Folders holding repos, relative to home; each is searched two levels down.
const DEFAULT_ROOTS = ["Dev"];
// Runs in each new space with <pane> <terminal> <tab> <space> <folder>; skipped if it's missing.
const LAYOUT_SCRIPT = "scripts/dev-layout.sh";

async function roots() {
  const file = `${appHome()}/projects.json`;
  const text = await readTextFile(file);
  if (text === null) return DEFAULT_ROOTS;
  let list;
  try {
    list = JSON.parse(text)?.roots;
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
  if (!Array.isArray(list) || !list.every((root) => typeof root === "string")) throw new Error(`${file}: roots must be an array of strings`);
  return list;
}

async function load() {
  const r = await exec(`${appHome()}/mods/projects/projects.py`, await roots());
  if (r.code !== 0) throw new Error(r.stderr.trim());
  // A space may have started elsewhere, so its name counts as much as its folder.
  const open = new Map(spaces().flatMap((s) => [[s.folder, s], [s.name, s]]));
  // Nested roots find the same repo twice.
  return [...new Set(JSON.parse(r.stdout))]
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
