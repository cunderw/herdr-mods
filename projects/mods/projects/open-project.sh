#!/usr/bin/env bash
#
# A new space on a repo, laid out by a script of yours if you have one.
#
#   usage: open-project.sh <folder> <layout script>

set -euo pipefail

folder=$1 layout=$2
space=$(herdr-app do space.new --name "$(basename "$folder")" --folder "$folder")
pane=$(herdr-app status | jq -r .focused_pane)

if [ -x "$layout" ]; then
  exec "$layout" "$pane" "$(jq -r .terminal <<<"$space")" "$(jq -r .tab <<<"$space")" "$(jq -r .space <<<"$space")" "$folder"
fi
