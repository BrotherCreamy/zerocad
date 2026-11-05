#!/bin/bash
# Push every rewritten branch that differs from the mirror, one ref per push
# (a many-ref push was refused by the host once; one at a time never has
# been). Run after sync.sh, which built $MIRROR_DIR/zc.git and checked it.
#
# Plain pushes, never forced: the mirror's history is a pure function of the
# private repository's, so a push is refused only if someone committed to the
# mirror directly — which is the one thing never to do (README.md). Port such
# a commit back here by hand, then sync again.
set -uo pipefail
: "${MIRROR_DIR:=${TMPDIR:-/tmp}/zerocad-mirror}"
: "${MIRROR_REMOTE:=https://github.com/BrotherCreamy/zerocad}"
bare="$MIRROR_DIR/zc.git"
cd "$bare"
git ls-remote --heads "$MIRROR_REMOTE" | awk '{print $1 "\t" $2}' | sort -k2 > "$MIRROR_DIR/remote.txt"
git for-each-ref --format='%(objectname)	%(refname)' refs/heads | sort -k2 > "$MIRROR_DIR/local.txt"
join -t $'\t' -1 2 -2 2 -a 1 -e none -o 0,1.1,2.1 "$MIRROR_DIR/local.txt" "$MIRROR_DIR/remote.txt" | while IFS=$'\t' read -r ref mine theirs; do
  [ "$mine" = "$theirs" ] && continue
  if git push -q "$MIRROR_REMOTE" "$ref:$ref" 2> "$MIRROR_DIR/push-err.txt"; then
    echo "pushed $ref"
  else
    echo "FAIL $ref: $(tail -2 "$MIRROR_DIR/push-err.txt" | tr '\n' ' ')"
  fi
done
