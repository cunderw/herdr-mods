// A small line tokenizer for diff rows: comments, strings, numbers, keywords, types and calls.
// Not a parser. It knows the comment and string forms of common languages by file extension.
// No herdr imports, so node can test it.

const KEYWORDS = new Set(`
abstract actor as assert async await break case catch class const continue def default defer del
do elif else enum export extends extension external factory final finally fn for from func func get
go guard if impl implements import in interface is late let match mixin mod module mut new nil none
not null of operator or override package pass private protected protocol pub public raise required
return self set static struct super switch sync this throw throws trait try type typedef typeof
undefined use val var void when where while with yield true false True False None
`.trim().split(/\s+/));

const STYLES = {
  hash: { line: ["#"], block: null },
  slash: { line: ["//"], block: ["/*", "*/"] },
  sql: { line: ["--"], block: ["/*", "*/"] },
  html: { line: [], block: ["<!--", "-->"] },
};

const BY_EXT = {
  py: "hash", rb: "hash", sh: "hash", bash: "hash", zsh: "hash", yaml: "hash", yml: "hash", toml: "hash",
  dockerfile: "hash", mk: "hash", makefile: "hash", r: "hash", pl: "hash", conf: "hash", ini: "hash",
  sql: "sql", lua: "sql", hs: "sql",
  html: "html", xml: "html", svg: "html", vue: "slash", md: "html",
};

export function styleFor(path) {
  const name = path.split("/").pop().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : name;
  return STYLES[BY_EXT[ext] ?? "slash"];
}

const startsAt = (text, i, s) => text.startsWith(s, i);

// Splits one line into [{text, kind}] with kind one of: plain, comment, string, number, keyword, type, call.
// `state.block` carries an open block comment across lines; pass the same state for consecutive lines.
export function tokenize(text, style, state = {}) {
  const out = [];
  const push = (t, kind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t;
    else out.push({ text: t, kind });
  };
  let i = 0;
  if (state.block) {
    const end = text.indexOf(style.block[1]);
    if (end < 0) return [{ text, kind: "comment" }];
    push(text.slice(0, end + style.block[1].length), "comment");
    i = end + style.block[1].length;
    state.block = false;
  }
  while (i < text.length) {
    const c = text[i];
    if (style.line.some((s) => startsAt(text, i, s))) { push(text.slice(i), "comment"); break; }
    if (style.block && startsAt(text, i, style.block[0])) {
      const end = text.indexOf(style.block[1], i + style.block[0].length);
      if (end < 0) { push(text.slice(i), "comment"); state.block = true; break; }
      push(text.slice(i, end + style.block[1].length), "comment");
      i = end + style.block[1].length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      push(text.slice(i, j + 1), "string");
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) && !/[\w$]/.test(text[i - 1] ?? "")) {
      const m = /^(0x[0-9a-f_]+|[0-9][0-9_]*(\.[0-9_]+)?(e[+-]?[0-9]+)?)/i.exec(text.slice(i));
      push(m[0], "number");
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$@]/.test(c)) {
      const m = /^[@$]?[A-Za-z_$][\w$]*/.exec(text.slice(i));
      const word = m[0], next = text.slice(i + word.length).match(/^\s*\(/);
      const kind = KEYWORDS.has(word) ? "keyword" : /^[A-Z][a-z0-9]/.test(word) ? "type" : next ? "call" : "plain";
      push(word, kind);
      i += word.length;
      continue;
    }
    push(c, "plain");
    i++;
  }
  return out;
}
