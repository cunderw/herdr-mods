// Diff parsing and the review message. No herdr imports, so node can test it.

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// One row per diff line, numbered on both sides so a comment can name its line.
export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: line }; }
    const kind = line[0], text = line.slice(1) || " ";
    if (kind === "-") return { kind, old: old++, text };
    if (kind === "+") return { kind, next: next++, text };
    if (kind === " ") return { kind, old: old++, next: next++, text };
    return { kind: "", text: line };
  });
}

// Where a row's comment points: the new file's line, or the old one for a removed line.
export function anchorOf(row) {
  if (row.kind === "-") return { side: "old", line: row.old };
  if (row.kind === "+" || row.kind === " ") return { side: "new", line: row.next };
  return null;
}

export const sameAnchor = (c, path, a) => c.path === path && c.side === a.side && c.line === a.line;

// The two refs `git diff` compares for a scope. `to` null means the working tree.
export function diffRefs(scope, mergeBase, commits) {
  if (scope.kind === "uncommitted") return { from: "HEAD", to: null };
  if (scope.kind === "commits") {
    const picked = commits.filter((c) => scope.shas.includes(c.sha));
    if (!picked.length) return null;
    const newest = picked[0], oldest = picked[picked.length - 1];
    return { from: oldest.parent || EMPTY_TREE, to: newest.sha };
  }
  return { from: mergeBase, to: "HEAD" };
}

// git log is newest first; a range is every commit between two clicked ones.
export function rangeBetween(commits, a, b) {
  const i = commits.findIndex((c) => c.sha === a), j = commits.findIndex((c) => c.sha === b);
  if (i < 0 || j < 0) return [b];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return commits.slice(lo, hi + 1).map((c) => c.sha);
}

export function scopeLabel(scope, base, commits) {
  if (scope.kind === "uncommitted") return "uncommitted changes";
  if (scope.kind === "commits") {
    const picked = commits.filter((c) => scope.shas.includes(c.sha));
    if (picked.length === 1) return `commit ${picked[0].short} (${picked[0].subject})`;
    return `commits ${picked[picked.length - 1]?.short}..${picked[0]?.short} (${picked.length} commits)`;
  }
  return `the whole branch compared to ${base}`;
}

// Each comment keeps the label of the view it was made in, because line numbers
// in one commit's diff can differ from the branch's.
export function reviewMessage({ branch, comments }) {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const labels = [...new Set(sorted.map((c) => c.label))];
  const items = sorted.map((c, i) => {
    const where = c.side === "old" ? `${c.path}:${c.line} (removed line, old numbering)` : `${c.path}:${c.line}`;
    const from = labels.length > 1 ? ` [in ${c.label}]` : "";
    return `${i + 1}. ${where}${from}\n   > ${c.code.trim()}\n   ${c.text.trim()}`;
  });
  const scope = labels.length === 1 ? `, ${labels[0]}` : "";
  return [`Review comments on branch ${branch}${scope}. Please address each one:`, "", ...items].join("\n");
}
