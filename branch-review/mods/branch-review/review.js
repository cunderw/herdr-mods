// Diff parsing, comment anchoring and the messages sent to an agent. No herdr imports, so node can test it.

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Lines kept around a comment's own lines, to tell repeated code apart when it moves.
const AROUND = 2;

// One row per diff line, numbered on both sides. Hunk headers are "@" rows, and a "more" row
// marks unchanged lines git left out: before a hunk that starts past line 1, and after the last.
export function diffRows(lines, { more = false, end = null } = {}) {
  let old = 0, next = 0, hunks = 0;
  const out = [];
  for (const line of lines) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?/.exec(line);
    if (m) {
      const start = +m[3];
      if (more && (hunks > 0 || start > 1)) out.push({ kind: "more", text: "", at: hunks === 0 ? "top" : "between" });
      old = +m[1]; next = start; hunks++;
      out.push({ kind: "@", text: line });
      continue;
    }
    const kind = line[0], text = line.slice(1);
    if (kind === "-") out.push({ kind, old: old++, text });
    else if (kind === "+") out.push({ kind, next: next++, text });
    else if (kind === " ") out.push({ kind, old: old++, next: next++, text });
    else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    else out.push({ kind: "", text: line });
  }
  // The last hunk stops before the file's end: more lines below.
  if (more && hunks > 0 && (end == null || next <= end)) out.push({ kind: "more", text: "", at: "bottom" });
  return out;
}

// Rows a comment can sit on: code lines, not headers or "more" rows.
export const isCode = (row) => row && (row.kind === "+" || row.kind === "-" || row.kind === " ");

// Where a row is: the new file's line, or the old one for a removed line.
export function anchorOf(row) {
  if (row?.kind === "-") return { side: "old", line: row.old };
  if (row?.kind === "+" || row?.kind === " ") return { side: "new", line: row.next };
  return null;
}

const pick = (row) => ({ kind: row.kind, text: row.text, old: row.old, next: row.next });

let counter = 0;
export const newId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

// A comment on the code rows a..b (indexes into rows, either order): it keeps those lines and a few around them.
export function rangeComment(rows, a, b, { path, label, text, id = newId() }) {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const code = rows.map((r, i) => [r, i]).filter(([r, i]) => i >= lo && i <= hi && isCode(r));
  if (!code.length) return null;
  const first = code[0][1], last = code[code.length - 1][1];
  const before = rows.slice(0, first).filter(isCode).slice(-AROUND).map((r) => r.text);
  const after = rows.slice(last + 1).filter(isCode).slice(0, AROUND).map((r) => r.text);
  return { id, kind: "range", path, label, text, lines: code.map(([r]) => pick(r)), before, after };
}

export const fileComment = ({ path, label, text, id = newId() }) => ({ id, kind: "file", path, label, text });

// Old comments were one line: { path, side, line, code, label, text }.
export function migrate(c) {
  if (c.kind) return c;
  const row = c.side === "old" ? { kind: "-", old: c.line, text: c.code ?? "" } : { kind: " ", next: c.line, text: c.code ?? "" };
  return { id: newId(), kind: "range", path: c.path, label: c.label, text: c.text, lines: [row], before: [], after: [] };
}

// Where a range comment's lines are in these rows now: { from, to } row indexes, or null when they
// can't be found once and only once. The lines must match exactly, kind and text; when they match in
// several places, the lines around them decide, and a tie leaves it unplaced.
export function locate(rows, c) {
  if (c.kind !== "range" || !c.lines?.length) return null;
  const code = rows.map((r, i) => [r, i]).filter(([r]) => isCode(r));
  const n = c.lines.length, hits = [];
  for (let s = 0; s + n <= code.length; s++) {
    let ok = true;
    for (let k = 0; k < n && ok; k++) ok = code[s + k][0].kind === c.lines[k].kind && code[s + k][0].text === c.lines[k].text;
    if (ok) hits.push(s);
  }
  if (!hits.length) return null;
  const score = (s) => {
    let v = 0;
    const before = c.before ?? [], after = c.after ?? [];
    for (let k = 1; k <= before.length; k++) if (code[s - k]?.[0].text === before[before.length - k]) v++;
    for (let k = 0; k < after.length; k++) if (code[s + n + k]?.[0].text === after[k]) v++;
    return v;
  };
  let best = hits;
  if (hits.length > 1) {
    const top = Math.max(...hits.map(score));
    best = hits.filter((s) => score(s) === top);
  }
  if (best.length !== 1) return null;
  return { from: code[best[0]][1], to: code[best[0] + n - 1][1] };
}

// Placement of every comment on this file's rows: id -> { from, to } for the ones found,
// and the ids of range comments that aren't (outdated). Whole-file comments always fit.
export function placeAll(rows, comments) {
  const at = new Map(), outdated = new Set();
  for (const c of comments) {
    if (c.kind !== "range") continue;
    const p = locate(rows, c);
    if (p) at.set(c.id, p); else outdated.add(c.id);
  }
  return { at, outdated };
}

// A comment with its lines' numbers taken from where it was found now (same text, maybe moved).
export function refreshed(rows, c, place) {
  if (!place) return c;
  const code = rows.slice(place.from, place.to + 1).filter(isCode);
  return { ...c, lines: code.map(pick) };
}

// "line 14", "lines 5–7", "removed lines 3–4", across both sides "lines 5–9 (new) / 3 (old)".
export function linesLabel(c) {
  if (c.kind === "file") return "whole file";
  if (c.kind === "github") return c.thread?.line ? `line ${c.thread.line}` : "file";
  const nums = (side) => c.lines.map((l) => (side === "new" ? l.next : l.old)).filter((n) => n != null);
  const span = (ns) => (ns.length ? (ns[0] === ns[ns.length - 1] ? `${ns[0]}` : `${ns[0]}–${ns[ns.length - 1]}`) : "");
  const nw = nums("new"), od = nums("old"), many = c.lines.length > 1 ? "lines" : "line";
  if (c.lines.every((l) => l.kind === "-")) return `removed ${many} ${span(od)} (old numbering)`;
  return `${many} ${span(nw)}`;
}

// The two refs `git diff` compares for a scope. `to` null means the working tree.
export function diffRefs(scope, { mergeBase, commits, headParent }) {
  if (scope.kind === "uncommitted") return { from: "HEAD", to: null };
  if (scope.kind === "last") return { from: headParent || EMPTY_TREE, to: null };
  if (scope.kind === "commits") {
    const picked = commits.filter((c) => scope.shas.includes(c.sha));
    if (!picked.length) return null;
    const newest = picked[0], oldest = picked[picked.length - 1];
    return { from: oldest.parent || EMPTY_TREE, to: newest.sha };
  }
  return { from: mergeBase, to: "HEAD" };
}

// Untracked files appear in the scopes that reach the working tree.
export const withUntracked = (scope) => scope.kind === "uncommitted" || scope.kind === "last";

// git log is newest first; a range is every commit between two clicked ones.
export function rangeBetween(commits, a, b) {
  const i = commits.findIndex((c) => c.sha === a), j = commits.findIndex((c) => c.sha === b);
  if (i < 0 || j < 0) return [b];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return commits.slice(lo, hi + 1).map((c) => c.sha);
}

export function scopeLabel(scope, base, commits, last) {
  if (scope.kind === "uncommitted") return "uncommitted changes";
  if (scope.kind === "last") return last ? `the last commit (${last.short}, "${last.subject}") plus uncommitted changes` : "the last commit plus uncommitted changes";
  if (scope.kind === "commits") {
    const picked = commits.filter((c) => scope.shas.includes(c.sha));
    if (picked.length === 1) return `commit ${picked[0].short} (${picked[0].subject})`;
    return `commits ${picked[picked.length - 1]?.short}..${picked[0]?.short} (${picked.length} commits)`;
  }
  return `the whole branch compared to ${base}`;
}

// The quoted lines of a range comment, as the reader saw them: number, sign, text.
function quote(c) {
  const width = Math.max(...c.lines.map((l) => String(l.next ?? l.old ?? "").length));
  return c.lines.map((l) => `${String(l.kind === "-" ? l.old : l.next).padStart(width)} ${l.kind === " " ? " " : l.kind} ${l.text}`);
}

export function threadText(t) {
  const where = t.line ? `${t.path}:${t.line}` : t.path;
  const state = [t.isOutdated && "outdated", t.isResolved && "resolved"].filter(Boolean).join(", ");
  const head = `GitHub review thread on ${where}${state ? ` (${state})` : ""}${t.url ? ` — ${t.url}` : ""}`;
  return [head, ...t.comments.map((m) => `> ${m.author}: ${m.body.trim().replace(/\n/g, "\n> ")}`)].join("\n");
}

const order = (a, b) => a.path.localeCompare(b.path)
  || (a.kind === "file" ? -1 : b.kind === "file" ? 1 : 0)
  || ((a.lines?.[0]?.next ?? a.lines?.[0]?.old ?? a.thread?.line ?? 0) - (b.lines?.[0]?.next ?? b.lines?.[0]?.old ?? b.thread?.line ?? 0));

// One message with every comment, sorted by file and line. Each comment keeps the label of the view
// it was made in, because line numbers in one commit's diff can differ from the branch's.
// `outdated` holds ids whose lines changed since the comment was made: they're sent with what was seen.
export function reviewMessage({ branch, repo, comments, outdated = new Set() }) {
  const sorted = [...comments].sort(order);
  const labels = [...new Set(sorted.filter((c) => c.kind !== "github").map((c) => c.label))];
  const blocks = sorted.map((c) => {
    if (c.kind === "github") return [`### ${c.path}, GitHub thread`, threadText(c.thread), ...(c.text?.trim() ? [`Comment: ${c.text.trim()}`] : [])].join("\n");
    const from = labels.length > 1 ? ` [in ${c.label}]` : "";
    if (c.kind === "file") return `### ${c.path}, whole file${from}\nComment: ${c.text.trim()}`;
    const stale = outdated.has(c.id) ? " (these lines have changed since; this is what was reviewed)" : "";
    return [`### ${c.path}, ${linesLabel(c)}${from}${stale}`, "```", ...quote(c), "```", `Comment: ${c.text.trim()}`].join("\n");
  });
  const scope = labels.length === 1 ? ` (${labels[0]})` : "";
  const where = repo ? ` in ${repo}` : "";
  return [`Review of branch ${branch}${where}${scope}. Please address each comment:`, "", blocks.join("\n\n")].join("\n");
}

// A question about some lines or a whole diff; nothing is saved.
export function questionContext({ path, rows, title }) {
  const code = rows.filter(isCode);
  const width = Math.max(1, ...code.map((l) => String(l.next ?? l.old ?? "").length));
  const body = rows.filter((r) => isCode(r) || r.kind === "@")
    .map((r) => (r.kind === "@" ? r.text : `${String(r.kind === "-" ? r.old : r.next).padStart(width)} ${r.kind === " " ? " " : r.kind} ${r.text}`));
  return [`${path}, ${title}`, "```", ...body, "```"].join("\n");
}

// How many lines a comment's text takes at this many characters per line.
export function wrappedLines(text, perLine) {
  const per = Math.max(10, Math.floor(perLine));
  return String(text).split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / per)), 0);
}
