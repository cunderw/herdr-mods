// GitHub pull request review threads through the person's signed-in `gh`. No herdr imports:
// the caller passes `gh(args)` resolving { code, stdout, stderr }, so node can test this with a fake.
// Reads only, except replyToThread, which posts as the person and runs only on their click.

const THREADS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine startLine diffSide
          comments(first: 50) { nodes { id body createdAt url author { login } } }
        }
      }
    }
  }
}`;

const REPLY = `mutation($thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id url } }
}`;

const MAX_PAGES = 10;

// "https://github.example.com/owner/repo/pull/12" -> { host, owner, name, number }
export function parsePrUrl(url) {
  const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url ?? "");
  return m ? { host: m[1], owner: m[2], name: m[3], number: Number(m[4]) } : null;
}

const fail = (r, what) => new Error((r.stderr || r.stdout || "").trim().split("\n")[0] || `${what} failed`);

// The open PR for the checked-out branch, or null when there is none.
export async function findPr(gh) {
  const r = await gh(["pr", "view", "--json", "number,url,title,state,headRefName"]);
  if (r.code !== 0) {
    const text = `${r.stderr}${r.stdout}`;
    if (/no pull requests? found|could not find|no open pull|no git remotes|none of the git remotes|not a git repository/i.test(text)) return null;
    throw fail(r, "gh pr view");
  }
  const pr = JSON.parse(r.stdout);
  const where = parsePrUrl(pr.url);
  return where ? { ...where, url: pr.url, title: pr.title, state: pr.state } : null;
}

export function toThread(n) {
  const comments = (n.comments?.nodes ?? []).map((c) => ({ id: c.id, author: c.author?.login ?? "ghost", body: c.body ?? "", at: c.createdAt, url: c.url }));
  return {
    id: n.id, path: n.path, line: n.line ?? n.originalLine ?? null, startLine: n.startLine ?? null,
    side: n.diffSide === "LEFT" ? "old" : "new", isResolved: Boolean(n.isResolved), isOutdated: Boolean(n.isOutdated),
    url: comments[0]?.url ?? null, comments,
    // Changes whenever a reply arrives, so a seen thread with new replies shows as new again.
    version: `${comments.length}:${comments[comments.length - 1]?.id ?? ""}`,
  };
}

export async function fetchThreads(gh, pr) {
  const out = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ["api", "graphql", "--hostname", pr.host, "-f", `query=${THREADS}`, "-f", `owner=${pr.owner}`, "-f", `name=${pr.name}`, "-F", `number=${pr.number}`];
    if (after) args.push("-f", `after=${after}`);
    const r = await gh(args);
    if (r.code !== 0) throw fail(r, "gh api graphql");
    const data = JSON.parse(r.stdout);
    if (data.errors?.length) throw new Error(data.errors[0].message);
    const conn = data.data?.repository?.pullRequest?.reviewThreads;
    if (!conn) break;
    out.push(...conn.nodes.map(toThread));
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

// Posts a reply. Resolves the new comment's url. On failure the caller can't know whether
// it posted, so it must never retry by itself.
export async function replyToThread(gh, pr, threadId, body) {
  const r = await gh(["api", "graphql", "--hostname", pr.host, "-f", `query=${REPLY}`, "-f", `thread=${threadId}`, "-f", `body=${body}`]);
  if (r.code !== 0) throw fail(r, "posting the reply");
  const data = JSON.parse(r.stdout);
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data?.addPullRequestReviewThreadReply?.comment?.url ?? null;
}

// Threads to show: open ones first, by file and line; resolved ones only when asked for.
export function visibleThreads(threads, { showResolved }) {
  return threads.filter((t) => showResolved || !t.isResolved)
    .sort((a, b) => Number(a.isResolved) - Number(b.isResolved) || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
}
