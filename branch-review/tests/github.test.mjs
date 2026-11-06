import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrUrl, findPr, fetchThreads, replyToThread, visibleThreads } from "../mods/branch-review/github.js";

const ok = (obj) => ({ code: 0, stdout: JSON.stringify(obj), stderr: "" });

test("parsePrUrl handles github.com and enterprise hosts", () => {
  assert.deepEqual(parsePrUrl("https://github.com/o/r/pull/12"), { host: "github.com", owner: "o", name: "r", number: 12 });
  assert.equal(parsePrUrl("https://git.corp.example/team/app/pull/3").host, "git.corp.example");
  assert.equal(parsePrUrl("nope"), null);
});

test("findPr: none, one, and a real error", async () => {
  assert.equal(await findPr(async () => ({ code: 1, stdout: "", stderr: 'no pull requests found for branch "x"' })), null);
  assert.equal(await findPr(async () => ({ code: 1, stdout: "", stderr: "no git remotes found" })), null);
  const pr = await findPr(async () => ok({ number: 4, url: "https://github.com/o/r/pull/4", title: "T", state: "OPEN" }));
  assert.equal(pr.number, 4);
  await assert.rejects(findPr(async () => ({ code: 4, stdout: "", stderr: "gh auth login required" })), /auth/);
});

test("fetchThreads pages and maps threads", async () => {
  const calls = [];
  const node = (id, n) => ({ id, path: "a.js", line: n, isResolved: false, isOutdated: false, diffSide: "RIGHT", comments: { nodes: [{ id: id + "c", body: "hi", author: { login: "kim" }, url: "u" + id }] } });
  const pages = [
    { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: "X" }, nodes: [node("t1", 5)] } } } } },
    { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [node("t2", null)] } } } } },
  ];
  const threads = await fetchThreads(async (args) => { calls.push(args); return ok(pages[calls.length - 1]); }, { host: "h", owner: "o", name: "r", number: 1 });
  assert.equal(threads.length, 2);
  assert.equal(threads[0].comments[0].author, "kim");
  assert.ok(calls[1].includes("after=X"));
  assert.ok(calls[0].includes("--hostname") && calls[0].includes("h"));
});

test("replyToThread surfaces graphql errors", async () => {
  await assert.rejects(replyToThread(async () => ok({ errors: [{ message: "Resource not accessible" }] }), { host: "h" }, "t", "b"), /not accessible/);
  assert.equal(await replyToThread(async () => ok({ data: { addPullRequestReviewThreadReply: { comment: { url: "U" } } } }), { host: "h" }, "t", "b"), "U");
});

test("visibleThreads hides resolved unless asked", () => {
  const ts = [{ path: "b", line: 1, isResolved: true }, { path: "a", line: 2, isResolved: false }];
  assert.equal(visibleThreads(ts, { showResolved: false }).length, 1);
  assert.deepEqual(visibleThreads(ts, { showResolved: true }).map((t) => t.path), ["a", "b"]);
});
