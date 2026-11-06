// A stand-in for gpui-kit/gpui-base: every builder call is accepted and checked. Numeric
// arguments must be finite numbers (or length strings), as the real runtime insists.
const NUMERIC = new Set("bottom flex_basis flex_grow flex_shrink font_weight gap gap_x gap_y h inset left m max_h max_w mb min_h min_w ml mr mt mx my opacity p pb pl pr pt px py right size top w text_size rounded".split(" "));
const COLOR = new Set(["bg", "text_color", "border_color"]);
export const calls = { lists: [], texts: [] };
function check(name, args) {
  if (NUMERIC.has(name)) {
    const v = args[0];
    if (!(typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) throw new Error(`${name}(${v}): expected a number`);
  }
  if (COLOR.has(name) && !/^#[0-9a-f]{3,8}$/i.test(String(args[0]))) throw new Error(`${name}(${args[0]}): not a color`);
  if (name === "line_height" && typeof args[0] === "number" && args[0] > 4) throw new Error(`line_height(${args[0]}) is a multiplier`);
  if (name === "child") { if (typeof args[0] === "string") calls.texts.push(args[0]); else if (args[0] === undefined) throw new Error("child(undefined)"); }
}
function el() {
  const p = new Proxy(function () {}, {
    get(_t, name) {
      if (name === "then") return undefined;
      return (...args) => {
        check(name, args);
        if (name === "when") { if (args[0]) args[1](p); return p; }
        if (name === "children") { if (!Array.isArray(args[0])) throw new Error("children() needs an array"); return p; }
        if (["hover", "focus_visible"].includes(name) && typeof args[0] === "function") args[0](p);
        if (name === "trigger" || name === "content") return p;
        return p;
      };
    },
  });
  return p;
}
export class View {}
export const div = el, svg = (path) => { if (!path) throw new Error("svg(path)"); return el(); };
export const h_flex = el, v_flex = el;
export function v_virtual_list(id, n, sizes, key, render) {
  if (Array.isArray(sizes)) {
    if (sizes.length !== n) throw new Error(`${id}: ${sizes.length} sizes for ${n} items`);
    sizes.forEach((s, i) => { if (!Number.isFinite(s) || s <= 0) throw new Error(`${id}: size[${i}] = ${s}`); });
  } else if (!Number.isFinite(sizes)) throw new Error(`${id}: size ${sizes}`);
  for (let i = 0; i < n; i++) if (typeof key(i) !== "string") throw new Error(`${id}: key(${i}) not a string`);
  const items = render({ start: 0, end: n }, {});
  if (items.length !== n) throw new Error(`${id}: rendered ${items.length} of ${n}`);
  calls.lists.push({ id, n });
  return el();
}
export const Scrollbar = { vertical: () => el() };
export const TextView = { markdown: () => el(), html: () => el() };
export const Popover = { new: () => el() };
export const VirtualListScrollHandle = { new: () => ({ scroll_to_item() {}, scroll_to_bottom() {} }) };
function state(opts = {}) {
  const h = {};
  const s = { value: opts.value ?? "", focused: false,
    value() { return this._v ?? ""; }, set_value(v) { this._v = v; }, on(ev, fn) { h[ev] = fn; return true; },
    set_rows() {}, set_auto_grow() {}, set_soft_wrap() {}, focus() { this.focused = true; h.focus?.({}, globalThis.__cx); }, release() {},
    emit(ev, e = {}) { h[ev]?.(e, globalThis.__cx); },
  };
  s._v = opts.value ?? "";
  return s;
}
export const TextareaState = { new: state }, InputState = { new: state };
export const Textarea = { new: () => el() }, Input = { new: () => el() };
