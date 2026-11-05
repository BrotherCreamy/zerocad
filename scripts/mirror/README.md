# The public mirror

Development happens in this private repository. The public one,
`BrotherCreamy/zerocad`, is a **mirror** of it with the history rewritten:
author and committer identities mapped to a noreply address, a few phrases
in file contents replaced, and the working branch renamed `main`. GitHub
Pages deploys the app from the mirror. Nothing is ever committed to the
mirror directly — a commit made there blocks every sync until it is ported
back here by hand, because the pushes are plain, never forced.

Run after every merge to the working branch:

```sh
MIRROR_MAILMAP=/path/to/mailmap MIRROR_LEAK='<regex>' scripts/mirror/sync.sh   # builds and checks; prints `leaks: 0 0`
scripts/mirror/push.sh                                                         # pushes what differs, one ref at a time
```

Two inputs are **never committed**, because they hold the very things being
removed; they live in the cloud environment's secrets (or your shell):

- `MIRROR_MAILMAP` — the path of a git mailmap mapping each private identity
  to the public one. Three lines today. Format, one per line:
  `Public Name <public@noreply> <private@address>`. Any identity that is not
  listed passes through unchanged, so the leak check is what catches an
  omission.
- `MIRROR_LEAK` — an extended regex (case-insensitive) that nothing public
  may match: the surname and the private addresses' local parts. `sync.sh`
  greps every commit's identities and message and every file on every branch
  with it and refuses to continue on a single hit.

Optional: `MIRROR_DIR` (where the bare mirror is built; a temp directory by
default), `MIRROR_BRANCH` (the working branch that becomes `main`),
`MIRROR_REMOTE` (the mirror's URL).

`replace` is committed: it is `git filter-repo`'s `--replace-text` table,
and the rewrite applies to that file as well, so the mirror's copy of it is
already scrubbed. `git filter-repo` itself is fetched once by pinned release
and sha256 into `MIRROR_DIR` and run with `python3 -I`.

The rewrite is deterministic — the same private history always produces the
same public one — which is why pushes never need forcing, and why the
mirror's branches can be compared to the private ones by content.
