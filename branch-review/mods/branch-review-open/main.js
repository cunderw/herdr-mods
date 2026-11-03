// ctrl-b shift-v: opens branch-review in a pane to the right, for the focused pane's repo.
// A key can't pass props to pane.split, so this popup does it and closes.
import { View, div } from "gpui-kit";
import { closeOverlay, focused, panes, props, run, spaces } from "herdr";

export default class BranchReviewOpen extends View {
  init(_props, cx) {
    const f = focused(), space = spaces().find((s) => s.active);
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const folder = pane?.cwd || f?.cwd || space?.folder;
    cx.spawn(async () => {
      // Closing this popup hands focus back to the pane it was opened from, so close it first
      // and split after: the split then leaves the new pane focused.
      closeOverlay(props().overlay);
      run("pane.split", { direction: "right", ...(f?.pane ? { pane: f.pane } : {}), mod: "branch-review", props: { folder, on: space?.machine ?? null, space: f?.space ?? space?.id } });
    });
  }

  render() {
    return div();
  }
}
