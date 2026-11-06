// node --test branch-review/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffRows, rangeComment, fileComment, migrate, locate, placeAll, refreshed, linesLabel,
  diffRefs, scopeLabel, reviewMessage, questionContext, wrappedLines, EMPTY_TREE,
} from "../mods/branch-review/review.js";

const diff = [
  "@@ -1,4 +1,5 @@",
  " a",
  " b",
  "-c",
  "+C",
  "+D",
  " e",
];

test("diffRows numbers both sides", () => {
  const rows = diffRows(diff);
  assert.deepEqual(rows.map((r) => [r.kind, r.old, r.next]), [
    ["@", undefined, undefined], [" ", 1, 1], [" ", 2, 2], ["-", 3, undefined], ["+", undefined, 3], ["+", undefined, 4], [" ", 4, 5],
  ]);
});

test("diffRows adds more rows between hunks and at the ends", () => {
  const rows = diffRows(["@@ -5,1 +5,1 @@", " x", "@@ -20,1 +20,1 @@", " y", "\\ No newline at end of file"], { more: true, end: 40 });
  assert.deepEqual(rows.map((r) => r.kind + (r.at ? ":" + r.at : "")), ["more:top", "@", " ", "more:between", "@", " ", "more:bottom"]);
  const whole = diffRows(["@@ -1,2 +1,2 @@", " x", " y"], { more: true, end: 2 });
  assert.deepEqual(whole.map((r) => r.kind), ["@", " ", " "]);
});

test("a range comment keeps its lines and those around them", () => {
  const rows = diffRows(diff);
  const c = rangeComment(rows, 5, 3, { path: "f.js", label: "L", text: "why" });
  assert.deepEqual(c.lines.map((l) => l.kind + l.text), ["-c", "+C", "+D"]);
  assert.deepEqual(c.before, ["a", "b"]);
  assert.deepEqual(c.after, ["e"]);
  assert.equal(linesLabel(c), "lines 3–4");
  assert.equal(rangeComment(rows, 0, 0, { path: "f", label: "L", text: "x" }), null);
});

test("locate follows moved lines and refuses changed or ambiguous ones", () => {
  const rows = diffRows(diff);
  const c = rangeComment(rows, 4, 5, { path: "f", label: "L", text: "t" });
  const moved = diffRows(["@@ -1,1 +1,3 @@", "+new", "+lines", " z", "@@ -10,4 +12,5 @@", " a", " b", "-c", "+C", "+D", " e"]);
  const p = locate(moved, c);
  assert.deepEqual(p, { from: 8, to: 9 });
  assert.deepEqual(refreshed(moved, c, p).lines.map((l) => l.next), [14, 15]);
  const edited = diffRows(["@@ -1,4 +1,5 @@", " a", " b", "-c", "+C2", "+D", " e"]);
  assert.equal(locate(edited, c), null);
  const twice = diffRows(["@@ -1,2 +1,4 @@", "+C", "+D", " q", "@@ -9,1 +11,3 @@", "+C", "+D", " w"]);
  assert.equal(locate(twice, c), null, "two equal places with no telling context");
  const told = diffRows(["@@ -1,2 +1,4 @@", "+C", "+D", " q", "@@ -9,4 +11,5 @@", " a", " b", "-c", "+C", "+D", " e"]);
  assert.ok(locate(told, c), "context picks one");
});

test("placeAll marks comments it can't find as outdated; whole-file ones always fit", () => {
  const rows = diffRows(diff);
  const ok = rangeComment(rows, 1, 1, { path: "f", label: "L", text: "x" });
  const gone = { ...ok, id: "gone", lines: [{ kind: "+", text: "nope" }] };
  const file = fileComment({ path: "f", label: "L", text: "split it" });
  const { at, outdated } = placeAll(rows, [ok, gone, file]);
  assert.ok(at.has(ok.id));
  assert.deepEqual([...outdated], ["gone"]);
  assert.equal(linesLabel(file), "whole file");
});

test("old one-line comments migrate", () => {
  const c = migrate({ path: "f", side: "new", line: 3, code: "x", label: "L", text: "t" });
  assert.equal(c.kind, "range");
  assert.equal(linesLabel(c), "line 3");
  const r = migrate({ path: "f", side: "old", line: 9, code: "y", label: "L", text: "t" });
  assert.equal(linesLabel(r), "removed line 9 (old numbering)");
});

test("diffRefs for every scope", () => {
  const commits = [{ sha: "b", parent: "a" }, { sha: "a", parent: "" }];
  assert.deepEqual(diffRefs({ kind: "branch" }, { mergeBase: "m", commits }), { from: "m", to: "HEAD" });
  assert.deepEqual(diffRefs({ kind: "uncommitted" }, { commits }), { from: "HEAD", to: null });
  assert.deepEqual(diffRefs({ kind: "last" }, { commits, headParent: "p" }), { from: "p", to: null });
  assert.deepEqual(diffRefs({ kind: "last" }, { commits, headParent: null }), { from: EMPTY_TREE, to: null });
  assert.deepEqual(diffRefs({ kind: "commits", shas: ["a", "b"] }, { commits }), { from: EMPTY_TREE, to: "b" });
  assert.equal(scopeLabel({ kind: "last" }, "main", commits, { short: "b1", subject: "fix" }), 'the last commit (b1, "fix") plus uncommitted changes');
});

test("the review message quotes lines, files, threads and outdated comments", () => {
  const rows = diffRows(diff);
  const a = rangeComment(rows, 3, 4, { path: "src/x.js", label: "L", text: "rename" });
  const f = fileComment({ path: "src/x.js", label: "L", text: "split this file" });
  const g = { id: "g", kind: "github", path: "a.js", label: "GitHub", text: "", thread: { path: "a.js", line: 7, url: "u", comments: [{ author: "kim", body: "nit" }] } };
  const msg = reviewMessage({ branch: "feat", repo: "app", comments: [a, f, g], outdated: new Set([a.id]) });
  assert.match(msg, /^Review of branch feat in app \(L\)/);
  assert.ok(msg.indexOf("### a.js, GitHub thread") < msg.indexOf("### src/x.js, whole file"));
  assert.ok(msg.indexOf("whole file") < msg.indexOf("lines 3"));
  assert.match(msg, /3 - c\n3 \+ C/);
  assert.match(msg, /have changed since/);
  assert.match(msg, /> kim: nit/);
});

test("questionContext and wrappedLines", () => {
  const rows = diffRows(diff);
  assert.match(questionContext({ path: "x", rows, title: "the diff" }), /@@ -1,4 \+1,5 @@\n1   a/);
  assert.equal(wrappedLines("abcdefghijklmnopqrstuvwxyz", 10), 3);
  assert.equal(wrappedLines("a\nb", 40), 2);
});
