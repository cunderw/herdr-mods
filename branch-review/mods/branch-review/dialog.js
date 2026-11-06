// The send dialog: branch-review opened as an overlay of itself. main.js hands this copy to Dialog when
// props().dialog is set, so it never runs git. It shows who gets the message, an optional note, and the
// message itself (read-only, copyable); Send pastes note + message into the agent with `hc send`.
//
// props: { dialog: "review" | "ask", title, context, target (address to preselect), root, space,
//          sendId (review only: set as shared "branch-review.sent" once delivered), outdated (count) }
//
// Delivery: an idle or working agent gets `hc send --if <that status>`, so the core refuses if the agent
// changed state in between; a "done" agent gets a plain send (hc's --if knows only idle and working);
// a blocked one isn't sent to at all. Nothing retries by itself, and Send is off while one is in flight.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Popover } from "gpui-base";
import { agents, terminals, hc, run, notify, props, closeOverlay, theme, settings, setShared } from "herdr";

export const SENT_KEY = "branch-review.sent";
const ICON = (name) => `mods/branch-review/${name}.svg`;
const BIG = 8000;

const nameOf = (a) => a.program?.name ?? a.app ?? a.address;

// Every agent, best guesses first: the one asked for, then this repo's, then this space's, newest first.
export function rankAgents({ target, root, space }) {
  const cwd = new Map(terminals().map((t) => [t.address, t.cwd ?? ""]));
  const rank = (a) => (a.address === target ? 0 : root && (cwd.get(a.address) ?? "").startsWith(root) ? 1 : a.space === space ? 2 : 3);
  return [...agents()].sort((a, b) => rank(a) - rank(b) || b.seq - a.seq);
}

export class Dialog {
  init(_props, cx) {
    const p = props() ?? {};
    this.p = p;
    this.pick = null; this.error = null; this.sending = false; this.choosing = false; this.copied = false; this.closed = false;
    const ask = p.dialog === "ask";
    this.input = TextareaState.new({ placeholder: ask ? "Your question…" : "A note before the comments (optional)…", rows: ask ? 3 : 2 });
    this.input.set_auto_grow(ask ? 3 : 2, ask ? 8 : 5);
    this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.input.on("submit", (e, cx) => { if (!e?.shift) this.send(cx); });
    this.handle = cx.focus_handle();
    this.input.focus();
    cx.timer.after(300, () => { if (!this.closed) this.input.focus(); });
  }

  close() { this.closed = true; closeOverlay(this.p.overlay); }

  list() { return rankAgents(this.p); }
  target() {
    const list = this.list();
    return list.find((a) => a.address === this.pick) ?? list[0] ?? null;
  }
  cycle(delta, cx) {
    const list = this.list(), i = list.findIndex((a) => a.address === this.target()?.address);
    if (list.length > 1) { this.pick = list[(i + delta + list.length) % list.length].address; this.error = null; cx.notify(); }
  }
  text() { return [this.input.value().trim(), String(this.p.context ?? "").trim()].filter(Boolean).join("\n\n"); }

  // Why Send is off right now, or null when it's on.
  blocker(agent) {
    if (this.sending) return "Sending…";
    if (!agent) return "No agent is running. Start one, then send.";
    if (agent.status === "blocked") return `${nameOf(agent)} is waiting on a prompt. Answer it there, then send.`;
    if (this.p.dialog === "ask" && !this.input.value().trim()) return "Type a question first.";
    return null;
  }

  send(cx) {
    const agent = this.target(), why = this.blocker(agent);
    if (why) { if (!this.sending) { this.error = why; cx.notify(); } return; }
    const status = agent.status, text = this.text();
    const guard = status === "idle" || status === "working" ? ["--if", status] : [];
    this.sending = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["send", ...guard, agent.address, text]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
      this.sending = false;
      if (r.code === 0) {
        if (this.p.sendId) setShared(SENT_KEY, { id: this.p.sendId, at: Date.now() });
        notify({ title: `Sent to ${nameOf(agent)}`, body: this.p.title ?? "", level: "success", timeout: 4000 });
        this.close();
        run("pane.focus", { terminal: agent.address });
        return;
      }
      const now = agents().find((a) => a.address === agent.address);
      const why = (r.stderr || r.stdout).trim().split("\n")[0];
      this.error = now && now.status !== status
        ? `${nameOf(agent)} went from ${status} to ${now.status} before the message was typed, so nothing was sent. Check it, then send again.`
        : `Not sent: ${why || "hc send failed"}`;
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = this.p, list = this.list(), agent = this.target(), why = this.blocker(agent);
    const ask = p.dialog === "ask", context = String(p.context ?? ""), lines = context.split("\n");
    const dot = (a) => div().size(7).flex_none().rounded(4).bg(t[a.status] ?? t.unknown);
    const where = (a) => `${a.space_name} / ${a.tab_name}`;
    const button = (id, label, primary, action, off) => h_flex().id(id).h(30).px(14).items_center().rounded(8).text_size(12.5).font_medium()
      .bg(primary && !off ? t.solid : t.raised).text_color(primary && !off ? t.solid_foreground : off ? t.dim : t.foreground)
      .border_1().border_color(primary && !off ? t.solid : t.input)
      .when(!off, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action)).child(label);
    const box = (a) => h_flex().id("to-box").h(30).px(10).gap(8).items_center().rounded(8).border_1().min_w(0)
      .border_color(this.choosing ? t.accent : t.input).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
      .child(dot(a)).child(div().text_size(12.5).font_medium().child(nameOf(a)))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${where(a)} · ${a.status}`))
      .child(svg(ICON("chevron-down")).size(12).flex_none().text_color(t.dim));
    const stateNote = !agent ? null
      : agent.status === "working" ? `${nameOf(agent)} is working; it reads this as its next message.`
      : agent.status === "done" ? `${nameOf(agent)} finished a turn you haven't looked at yet.` : null;

    return v_flex().id("br-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (e.key === "enter" && (m.platform || m.control)) { cx.stop_propagation(); this.send(cx); }
        else if ((m.control && e.key === "n") || (m.control && e.key === "j")) { cx.stop_propagation(); this.cycle(1, cx); }
        else if ((m.control && e.key === "p") || (m.control && e.key === "k")) { cx.stop_propagation(); this.cycle(-1, cx); }
      })
      // Title
      .child(h_flex().items_center().gap(8)
        .child(div().text_size(15).font_semibold().child(ask ? "Ask the agent" : "Send review"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(p.title ?? ""))
        .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.dim).child("Esc")))
      // Recipient
      .child(h_flex().gap(10).items_center()
        .child(div().w(22).text_size(11.5).text_color(t.dim).child("To"))
        .child(!agent
          ? div().text_size(12).text_color(t.muted).child("No agent is running in Herdr.")
          : Popover.new("br-to").open(this.choosing).on_open_change((open, cx) => { this.choosing = open; cx.notify(); })
            .trigger(box(agent))
            .content(v_flex().id("br-to-list").mt(4).min_w(340).max_h(300).overflow_y_scrollbar().p(4).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_md()
              .children(list.map((a) => h_flex().id(`to-${a.address}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => { this.pick = a.address; this.choosing = false; this.error = null; cx.notify(); })
                .child(dot(a)).child(div().text_size(12).font_medium().child(nameOf(a)))
                .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${where(a)} · ${a.status}`))
                .child(a.address === agent.address ? svg(ICON("check")).size(12).text_color(t.accent) : div().w(12))))))
        .child(div().flex_1())
        .when(list.length > 1, (e) => e.child(div().text_size(10.5).text_color(t.dim).child("ctrl-n / ctrl-p"))))
      // Note or question
      .child(Textarea.new(this.input).w_full().px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5))
      // What is sent after the note
      .when(Boolean(context), (el) => el.child(v_flex().flex_1().min_h(80).gap(6)
        .child(h_flex().items_center().gap(6)
          .child(div().text_size(11).text_color(t.dim).child(`${ask ? "Asked about" : "The review"} · ${lines.length} lines · sent after your ${ask ? "question" : "note"}`))
          .child(div().flex_1())
          .child(h_flex().id("br-copy").h(22).px(6).gap(4).items_center().rounded(5).text_size(11).text_color(this.copied ? t.accent : t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.write_to_clipboard(this.text()); this.copied = true; cx.notify(); cx.timer.after(1500, (cx) => { this.copied = false; cx.notify(); }); })
            .child(svg(ICON(this.copied ? "check" : "copy")).size(12)).child(this.copied ? "Copied" : "Copy")))
        .child(div().id("br-context").flex_1().min_h(0).rounded(8).border_1().border_color(t.border).bg(t.background).overflow_y_scrollbar().p(10)
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted)
          .children(lines.slice(0, 800).map((l) => div().w_full().child(l || " ")))
          .when(lines.length > 800, (el) => el.child(div().text_color(t.dim).child(`… ${lines.length - 800} more lines are sent too`))))))
      .when(p.outdated > 0, (el) => el.child(div().text_size(11.5).text_color(t.blocked)
        .child(`${p.outdated} ${p.outdated === 1 ? "comment's lines have" : "comments' lines have"} changed since you wrote ${p.outdated === 1 ? "it" : "them"}. They're sent with the code you saw, marked as changed.`)))
      .when(context.length > BIG, (el) => el.child(div().text_size(11.5).text_color(t.blocked)
        .child(`This pastes ${(context.length / 1024).toFixed(0)} KB into the agent's input. Some agents are slow with that much, or cut it short.`)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      // Footer
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(why && !this.sending ? t.blocked : t.dim)
          .child(why && !this.sending ? why : stateNote ?? "⌘-Enter sends · Shift-Enter for a new line"))
        .child(button("br-cancel", "Cancel", false, () => this.close(), false))
        .child(button("br-send", this.sending ? "Sending…" : "Send", true, (_e, cx) => this.send(cx), Boolean(why))));
  }
}
