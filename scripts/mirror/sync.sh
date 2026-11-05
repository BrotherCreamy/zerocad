#!/bin/bash
# Re-derive the public mirror's history from this repository's origin branches,
# deterministically, and refuse to go on if anything in it would leak.
#
# Development happens in this private repository; the public one is a mirror
# of it with the history rewritten (TODO.md, "Development stays here"). This
# script builds that rewritten history into a bare repository under
# $MIRROR_DIR from `refs/remotes/origin/*`, with:
#   - author and committer identities mapped through a mailmap that is NEVER
#     committed (it holds the very addresses being removed): $MIRROR_MAILMAP;
#   - a few phrases in file contents replaced (./replace, committed: the
#     rewrite applies to that file too, so the mirror's copy is harmless);
#   - the working branch ($MIRROR_BRANCH) becoming the mirror's `main`.
# It then checks every commit's identities and message, and every file on
# every branch, against $MIRROR_LEAK (a regex, also never committed, for the
# same reason) and prints `leaks: 0 0`. Anything else exits non-zero and
# nothing is pushed. push.sh pushes what this built.
#
# git-filter-repo is fetched once, by pinned release and sha256, into
# $MIRROR_DIR; it is a single Python file and runs with `python3 -I`.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
: "${MIRROR_DIR:=${TMPDIR:-/tmp}/zerocad-mirror}"
: "${MIRROR_BRANCH:=claude/resume-tasks-o7q02e}"
: "${MIRROR_MAILMAP:?set MIRROR_MAILMAP to the path of the mailmap file (see README.md; never commit it)}"
: "${MIRROR_LEAK:?set MIRROR_LEAK to the regex nothing public may match (see README.md; never commit it)}"
GFR_URL=https://raw.githubusercontent.com/newren/git-filter-repo/v2.47.0/git-filter-repo
GFR_SHA=67447413e273fc76809289111748870b6f6072f08b17efe94863a92d810b7d94

mkdir -p "$MIRROR_DIR"
gfr="$MIRROR_DIR/git-filter-repo-v2.47.0.py"
if [ ! -f "$gfr" ]; then
  curl -sSL --max-time 120 -o "$gfr.part" "$GFR_URL"
  echo "$GFR_SHA  $gfr.part" | sha256sum -c --quiet
  mv "$gfr.part" "$gfr"
fi
echo "$GFR_SHA  $gfr" | sha256sum -c --quiet

bare="$MIRROR_DIR/zc.git"
rm -rf "$bare"
git init -q --bare "$bare"
git -C "$repo" push -q "$bare" 'refs/remotes/origin/*:refs/heads/*' 2>/dev/null || true
git -C "$bare" update-ref -d refs/heads/HEAD 2>/dev/null || true
(cd "$bare" && python3 -I "$gfr" --force --quiet --mailmap "$MIRROR_MAILMAP" --replace-text "$here/replace")
git -C "$bare" update-ref refs/heads/main "refs/heads/$MIRROR_BRANCH"
git -C "$bare" symbolic-ref HEAD refs/heads/main

# The leak check: identities and messages of every commit, then every file on
# every branch. Both counts must be zero.
a=$(git -C "$bare" log --all --format='%an %ae %cn %ce %B' | grep -icE "$MIRROR_LEAK" || true)
b=0
for r in $(git -C "$bare" for-each-ref --format='%(refname)'); do
  # git grep exits 1 on a branch with no match, which under pipefail would end the script.
  n=$( (git -C "$bare" grep -ilE "$MIRROR_LEAK" "$r" 2>/dev/null || true) | wc -l)
  b=$((b + n))
done
echo "leaks: $a $b"
if [ "$a" != 0 ] || [ "$b" != 0 ]; then
  echo "the mirror would leak; nothing is pushed" >&2
  exit 1
fi
git -C "$bare" for-each-ref --format='%(refname) %(objectname)'
