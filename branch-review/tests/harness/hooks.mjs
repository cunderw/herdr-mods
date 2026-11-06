// Resolves the mod's bare imports to the stubs in this folder.
const STUBS = { "gpui-kit": "./gpui.mjs", "gpui-base": "./gpui.mjs", "herdr": "./herdr.mjs" };
export async function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: new URL(STUBS[spec], import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
