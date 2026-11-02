// Review a branch's diff (whole branch vs its base, picked commits, or uncommitted), comment on
// lines, and send the comments to a Claude Code session with `hc send`. Sent comments are cleared.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { agents, terminals, spaces, panes, focused, exec, hc, theme, settings, props, notify } from "herdr";
import { diffRows, anchorOf, sameAnchor, diffRefs, rangeBetween, scopeLabel, reviewMessage } from "./review.js";

// Reads write nothing under .git (no index refresh or lock), as in the changes mod.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const BASES = ["origin/main", "main", "origin/master", "master"];
const MAX_LINES = 3000;

// The folder this pane reviews: its props from the opener, else the focused pane's.
function startFolder() {
  const p = props() ?? {};
  if (p.folder) return { cwd: p.folder, on: p.on ?? null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on: space?.machine ?? null };
}

export default class BranchReview extends View {
  init(_props, cx) {
    Object.assign(this, startFolder());
    this.scope = { kind: "branch" };
    this.commits = []; this.files = []; this.rows = []; this.comments = [];
    this.open = null; this.editing = null; this.target = null; this.gen = 0;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Click a diff line to comment on it" });
    this.input.on("submit", (_e, cx) => this.saveComment(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  git(args) {
    return exec("git", [...READ, ...args], { cwd: this.root, on: this.on });
  }

  async out(args) {
    const r = await this.git(args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
    return r.stdout;
  }

  storeKey() { return `comments:${this.root}:${this.branch}`; }
  loadComments() { try { this.comments = JSON.parse(localStorage.getItem(this.storeKey()) ?? "[]"); } catch { this.comments = []; } }
  saveComments() { localStorage.setItem(this.storeKey(), JSON.stringify(this.comments)); }

  label() { return scopeLabel(this.scope, this.base, this.commits); }

  refresh(cx) {
    if (this.loading || !this.cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd, on: this.on });
        if (top.code !== 0) { this.error = "Not a git repository"; return; }
        const root = top.stdout.trim();
        const branchOut = await exec("git", ["branch", "--show-current"], { cwd: root, on: this.on });
        const branch = branchOut.stdout.trim() || "HEAD";
        if (root !== this.root || branch !== this.branch) {
          this.root = root; this.branch = branch; this.base = null;
          this.scope = { kind: "branch" }; this.open = null; this.editing = null;
          this.loadComments();
        }
        if (!this.base) this.base = await this.findBase();
        this.mergeBase = (await this.out(["merge-base", "HEAD", this.base])).trim();
        const log = await this.out(["log", "--format=%H%x1f%h%x1f%P%x1f%s%x1f%ar", "-n", "200", `${this.mergeBase}..HEAD`]);
        this.commits = log.split("\n").filter(Boolean).map((l) => {
          const [sha, short, parents, subject, ago] = l.split("\x1f");
          return { sha, short, parent: parents.split(" ")[0] ?? "", subject, ago };
        });
        if (this.scope.kind === "commits") {
          const shas = this.scope.shas.filter((s) => this.commits.some((c) => c.sha === s));
          this.scope = shas.length ? { kind: "commits", shas } : { kind: "branch" };
        }
        this.error = null;
        await this.loadFiles();
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async findBase() {
    const head = await this.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
    for (const b of BASES) if ((await this.git(["rev-parse", "--verify", "--quiet", b])).code === 0) return b;
    throw new Error("No origin/main, main, origin/master or master to compare with");
  }

  refArgs() {
    const r = diffRefs(this.scope, this.mergeBase, this.commits);
    return r ? [r.from, ...(r.to ? [r.to] : [])] : null;
  }

  async loadFiles() {
    const gen = ++this.gen, refs = this.refArgs();
    if (!refs) { this.files = []; this.rows = []; return; }
    const stat = await this.out(["diff", ...refs, "--numstat", "-z", "--no-renames"]);
    if (gen !== this.gen) return;
    this.files = stat.split("\0").filter(Boolean).map((entry) => {
      const [a, d, ...rest] = entry.split("\t");
      return { path: rest.join("\t"), add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
    }).filter((f) => f.path);
    if (!this.files.some((f) => f.path === this.open)) this.open = this.files[0]?.path ?? null;
    await this.loadDiff(gen);
  }

  async loadDiff(gen = this.gen) {
    const path = this.open, refs = this.refArgs();
    if (!path || !refs) { this.rows = []; return; }
    const text = await this.out(["diff", ...refs, "--no-ext-diff", "--no-textconv", "--no-color", "--", path]);
    if (gen !== this.gen || path !== this.open) return;
    const all = text.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
    const lines = first < 0 ? ["No text diff (binary or mode change)"] : all.slice(first, first + MAX_LINES);
    this.rows = diffRows(lines.map((l) => (l.length > 2000 ? l.slice(0, 2000) + "…" : l)));
    this.diffWidth = Math.max(300, ...lines.map((l) => Math.min(l.length, 2000) * 7 + 90));
  }

  reload(cx) {
    this.editing = null; this.input.set_value("");
    cx.spawn(async (cx) => {
      try { await this.loadFiles(); this.error = null; } catch (e) { this.error = String(e.message ?? e); }
      cx.notify();
    });
    cx.notify();
  }

  setScope(scope, cx) { this.scope = scope; this.open = null; this.reload(cx); }

  clickCommit(sha, e, cx) {
    const current = this.scope.kind === "commits" ? this.scope.shas : [];
    if (e?.modifiers?.shift && this.anchor) this.setScope({ kind: "commits", shas: rangeBetween(this.commits, this.anchor, sha) }, cx);
    else if (current.length === 1 && current[0] === sha) { this.anchor = null; this.setScope({ kind: "branch" }, cx); }
    else { this.anchor = sha; this.setScope({ kind: "commits", shas: [sha] }, cx); }
  }

  pickFile(path, cx) {
    if (path === this.open) return;
    this.open = path; this.rows = []; this.editing = null; this.input.set_value("");
    cx.spawn(async (cx) => {
      try { await this.loadDiff(); } catch (e) { this.error = String(e.message ?? e); }
      cx.notify();
    });
    cx.notify();
  }

  // Virtual list rows can't take on_click, so the list reports the clicked row's key (its index).
  clickRow(key, cx) {
    const item = this.display?.[Number(key)];
    if (item?.row) this.startComment(item.row, cx);
    else if (item?.comment) this.editComment(item.comment, cx);
  }

  editComment(c, cx) {
    this.editing = { path: c.path, side: c.side, line: c.line, code: c.code, label: c.label };
    this.input.set_value(c.text);
    this.input.focus();
    cx.notify();
  }

  findComment(path, anchor, label) {
    return this.comments.find((c) => sameAnchor(c, path, anchor) && c.label === label);
  }

  startComment(row, cx) {
    const anchor = anchorOf(row);
    if (!anchor || !this.open) return;
    const label = this.label(), existing = this.findComment(this.open, anchor, label);
    this.editing = { path: this.open, ...anchor, code: row.text, label };
    this.input.set_value(existing?.text ?? "");
    this.input.focus();
    cx.notify();
  }

  saveComment(cx) {
    const ed = this.editing;
    if (!ed) return;
    const text = this.input.value().trim();
    this.comments = this.comments.filter((c) => !(sameAnchor(c, ed.path, ed) && c.label === ed.label));
    if (text) this.comments.push({ ...ed, text });
    this.saveComments();
    this.editing = null; this.input.set_value(""); this.handle.focus();
    cx.notify();
  }

  cancelComment(cx) {
    this.editing = null; this.input.set_value(""); this.handle.focus();
    cx.notify();
  }

  // Claude Code sessions, the ones working in this repo first.
  claudes() {
    const cwd = new Map(terminals().map((t) => [t.address, t.cwd ?? ""]));
    const here = (a) => (this.root && (cwd.get(a.address) ?? "").startsWith(this.root) ? 0 : 1);
    return agents().filter((a) => a.app === "claude-code").sort((a, b) => here(a) - here(b) || b.seq - a.seq);
  }

  send(cx) {
    const target = this.target ?? this.claudes()[0]?.address;
    if (!target || !this.comments.length || this.sending) return;
    const sent = [...this.comments], message = reviewMessage({ branch: this.branch, comments: sent });
    this.sending = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", target, message]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "hc send failed");
        this.comments = this.comments.filter((c) => !sent.includes(c));
        this.saveComments();
        notify({ title: "Review sent", body: `${sent.length} comments to ${target}`, level: "success", timeout: 4000 });
      } catch (e) { this.note = `Send failed: ${e.message ?? e}`; }
      finally { this.sending = false; cx.notify(); }
    });
    cx.notify();
  }

  chip(id, text, active, t, onClick) {
    return div().id(id).h(24).px(10).flex().flex_none().items_center().rounded(6).cursor_pointer().text_size(11)
      .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click(onClick).child(text);
  }

  // Diff rows with each saved comment drawn under its line.
  displayRows() {
    const label = this.label(), out = [];
    for (const row of this.rows) {
      out.push({ row });
      const anchor = anchorOf(row);
      const c = anchor && this.findComment(this.open, anchor, label);
      if (c) out.push({ comment: c });
    }
    return out;
  }

  diffRow(item, t) {
    if (item.comment) {
      const c = item.comment;
      return h_flex().id(`c-${c.path}-${c.side}-${c.line}`).cursor_pointer().w_full().h(20).flex_none().px(10).gap(8).items_center().bg(t.accent + "22")
        .child(div().w(88).flex_none().text_color(t.accent).child("comment"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.text));
    }
    const { row } = item;
    if (row.kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(row.text);
    const ed = this.editing, anchor = anchorOf(row);
    const editing = ed && anchor && ed.path === this.open && ed.side === anchor.side && ed.line === anchor.line;
    return h_flex().id(`r-${row.kind}-${row.old ?? ""}-${row.next ?? ""}`).w_full().h(20).flex_none().gap(8).cursor_pointer()
      .when(row.kind === "+", (e) => e.bg(t.ansi2 + "18")).when(row.kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .when(Boolean(editing), (e) => e.bg(t.accent + "33"))
      .hover((s) => s.bg(t.hover))
      .child(div().w(36).flex_none().text_right().text_color(t.dim).child(row.old === undefined ? "" : String(row.old)))
      .child(div().w(36).flex_none().text_right().text_color(t.dim).child(row.next === undefined ? "" : String(row.next)))
      .child(div().w(10).flex_none().text_color(row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.dim).child(row.kind.trim()))
      .child(div().flex_1().min_w(0).truncate().child(row.text));
  }

  render() {
    const t = theme(), label = this.label(), claudes = this.claudes();
    const target = claudes.some((a) => a.address === this.target) ? this.target : claudes[0]?.address ?? null;
    const shas = this.scope.kind === "commits" ? this.scope.shas : [];
    const perFile = (p) => this.comments.filter((c) => c.path === p && c.label === label).length;
    const elsewhere = this.comments.filter((c) => c.label !== label).length;
    const rows = (this.display = this.displayRows());
    const canSend = Boolean(target && this.comments.length && !this.sending);

    return v_flex().id("branch-review").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape" && this.editing) { cx.stop_propagation(); this.cancelComment(cx); } })
      // Header
      .child(h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Review"))
        .child(div().min_w(0).truncate().text_color(t.muted).child(this.branch ? `${this.branch} → ${this.base ?? "?"}` : ""))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "Loading…" : `${this.comments.length} comments`))
        .child(div().id("br-refresh").h(24).px(10).flex().items_center().rounded(6).cursor_pointer().bg(t.raised).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.refresh(cx)).child("Refresh")))
      .when(Boolean(this.error), (e) => e.child(div().px(12).py(6).text_size(11).text_color(t.blocked).child(this.error)))
      // Scope and commits
      .child(v_flex().flex_none().p(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(this.chip("scope-branch", `Branch vs ${this.base ?? "base"}`, this.scope.kind === "branch", t, (_e, cx) => { this.anchor = null; this.setScope({ kind: "branch" }, cx); }))
          .child(this.chip("scope-uncommitted", "Uncommitted", this.scope.kind === "uncommitted", t, (_e, cx) => { this.anchor = null; this.setScope({ kind: "uncommitted" }, cx); }))
          .child(div().text_size(11).text_color(t.dim).child("Click a commit, shift-click for a range")))
        .child(v_flex().id("br-commits").h(Math.min(132, Math.max(22, this.commits.length * 22))).overflow_y_scrollbar()
          .children(this.commits.map((c) => h_flex().id(`commit-${c.sha}`).h(22).flex_none().px(6).gap(8).items_center().rounded(5).cursor_pointer()
            .when(shas.includes(c.sha), (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((e, cx) => this.clickCommit(c.sha, e, cx))
            .child(div().w(60).flex_none().text_color(t.accent).child(c.short))
            .child(div().flex_1().min_w(0).truncate().child(c.subject))
            .child(div().flex_none().text_size(10).text_color(t.dim).child(c.ago))))
          .when(!this.commits.length, (e) => e.child(div().px(6).text_color(t.dim).child(this.loading ? "Loading commits…" : "No commits on this branch")))))
      // Files
      .child(v_flex().id("br-files").flex_none().h(Math.min(150, Math.max(36, this.files.length * 24 + 12))).overflow_y_scrollbar().p(6).border_b(1).border_color(t.border)
        .children(this.files.map((f) => {
          const n = perFile(f.path);
          return h_flex().id(`file-${f.path}`).h(24).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
            .when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.pickFile(f.path, cx))
            .child(div().flex_1().min_w(0).truncate().child(f.path))
            .when(n > 0, (e) => e.child(div().text_size(10).text_color(t.accent).child(`${n} 💬`)))
            .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
            .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
        }))
        .when(!this.files.length, (e) => e.child(div().p(6).text_color(t.dim).child(this.loading ? "Loading files…" : "No changes in this view"))))
      // Diff
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("br-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth ?? 300).h_full().child(v_virtual_list("br-diff", rows.length, 20, (i) => String(i),
            (range) => rows.slice(range.start, range.end).map((item) => this.diffRow(item, t))).on_item_click((key, cx) => this.clickRow(key, cx)).size_full())))
        .child(Scrollbar.vertical("br-diff").viewport_from_layout().absolute().inset_0()))
      .when(elsewhere > 0, (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.dim).child(`${elsewhere} more comments in other views (they are sent too)`)))
      .when(Boolean(this.note), (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.blocked).child(this.note)))
      // Comment editor
      .child(h_flex().flex_none().px(10).pt(8).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().w(150).flex_none().truncate().text_size(11).text_color(this.editing ? t.accent : t.dim)
          .child(this.editing ? `${this.editing.path.split("/").pop()}:${this.editing.line}` : "No line picked"))
        .child(div().id("br-comment").flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(8).border_1()
          .border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .when(Boolean(this.editing), (e) => e
          .child(div().id("br-save").h(30).px(12).flex().flex_none().items_center().rounded(8).cursor_pointer().bg(t.raised).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.saveComment(cx)).child("Save"))
          .child(div().id("br-delete").h(30).px(12).flex().flex_none().items_center().rounded(8).cursor_pointer().text_color(t.blocked).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.input.set_value(""); this.saveComment(cx); }).child("Delete"))))
      // Send
      .child(h_flex().flex_none().p(10).gap(6).items_center()
        .child(div().text_size(11).text_color(t.dim).flex_none().child("Send to"))
        .child(h_flex().id("br-targets").flex_1().min_w(0).gap(6).overflow_x_scrollbar()
          .children(claudes.map((a) => this.chip(`target-${a.address}`, `${a.address} · ${a.space_name}/${a.tab_name}`, a.address === target, t,
            (_e, cx) => { this.target = a.address; cx.notify(); })))
          .when(!claudes.length, (e) => e.child(div().text_size(11).text_color(t.dim).child("No Claude Code sessions running"))))
        .child(div().id("br-send").h(30).px(14).flex().flex_none().items_center().rounded(8)
          .bg(canSend ? t.solid : t.raised).text_color(canSend ? t.solid_foreground : t.dim)
          .when(canSend, (e) => e.cursor_pointer()).on_click((_e, cx) => this.send(cx))
          .child(this.sending ? "Sending…" : `Send ${this.comments.length}`)));
  }
}
