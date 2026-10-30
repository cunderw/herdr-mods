// A filterable popup list. A mod extends QuickList and returns its setup from
// source(): title, placeholder, empty, footer?, load(), choose(row), and
// optionally typed(text) to take the input itself and review() for Ctrl+R.
// Rows are { title, detail?, mark?, markColor? }.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, props, theme } from "herdr";

const WINDOW = 12; // rows on screen; the list is a slice around the selection
const ROW = 34;

export class QuickList extends View {
  init(_props, cx) {
    this.source = this.config();
    this.filter = "";
    this.at = 0;
    this.items = null;
    this.error = null;
    this.input = InputState.new({ placeholder: this.source.placeholder });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    cx.spawn(async (cx) => {
      try { this.items = await this.source.load(); }
      catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  // What a mod provides.
  config() {
    return { title: "", placeholder: "", empty: "", load: async () => [], choose() {} };
  }

  close() {
    closeOverlay(props().overlay);
  }

  shown() {
    const f = this.filter.toLowerCase();
    return (this.items ?? []).filter((i) => !f || `${i.title} ${i.detail ?? ""}`.toLowerCase().includes(f));
  }

  submit(cx) {
    const raw = this.input.value();
    if (this.source.typed?.(raw)) return this.close();
    const item = this.shown()[this.at];
    if (!item) return;
    this.close();
    this.source.choose(item);
  }

  key(e, cx) {
    const count = this.shown().length;
    if (e.key === "escape") return this.close();
    if (e.key === "down" && count) this.at = (this.at + 1) % count;
    else if (e.key === "up" && count) this.at = (this.at + count - 1) % count;
    else if (e.key === "r" && e.modifiers.control && this.source.review) { this.close(); return this.source.review(); }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const items = this.shown();
    const first = Math.max(0, Math.min(this.at - Math.floor(WINDOW / 2), items.length - WINDOW));
    const rows = items.slice(first, first + WINDOW);
    const status = this.error ?? (this.items === null ? "Loading…" : items.length ? null : this.source.empty);
    return v_flex().id("quick-list").size_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child(this.source.title))
        .child(div().text_size(12).text_color(t.muted).child(items.length ? `${items.length}` : "")))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.raised)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().flex_1().min_h(0).gap(2)
        .when(Boolean(status), (el) => el.child(div().p(8).text_color(this.error ? t.blocked : t.muted).child(status ?? "")))
        .children(rows.map((item, i) => {
          const index = first + i;
          return h_flex().id(`row-${index}`).h(ROW).flex_none().px(10).gap(10).items_center().rounded(7).cursor_pointer()
            .when(index === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.at = index; this.submit(cx); })
            .when(Boolean(item.mark), (el) => el.child(div().flex_none().text_color(item.markColor ? t[item.markColor] : t.accent).child(item.mark ?? "")))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(item.title))
            .child(div().flex_none().max_w(240).truncate().text_size(12).text_color(t.muted).child(item.detail ?? ""));
        })))
      .when(Boolean(this.source.footer), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(this.source.footer ?? "")));
  }
}
