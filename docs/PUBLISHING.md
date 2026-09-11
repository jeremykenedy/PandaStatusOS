# Publishing PandaStatusOS

A checklist, not a recovery plan. This repository has been clean from its first commit:
the history was reset before commit one, every commit since was made through the
pre-commit hook, and nothing here has ever needed rewriting. The checklist proves that
again on the day, then the remote is added and the push is made. Two commands, written
out at the end, and nothing runs them but the maintainer.

## Where the repository stands

- No `git push` has ever been made by this project's tooling, and nothing in it can.
  Whether the checkout already has a remote is checked in step 7, not assumed: on
  2026-09-10 the maintainer's own checkout had `origin` set to the repository below
  and one push recorded, made by hand.
- The GitHub repository `jeremykenedy/PandaStatusOS` exists and is **private** as of
  2026-09-10 (`gh repo view`, unauthenticated API 404).
- Every commit is authored and committed by Jeremy Kenedy, one identity.

## 1. Back up, twice

```
cd ~/sites && TS=$(date +%Y%m%d-%H%M%S) \
  && tar czf ~/backups/PandaStatus-publish-$TS.tgz --exclude='private/uiwork/node_modules' PandaStatus \
  && shasum -a 256 ~/backups/PandaStatus-publish-$TS.tgz
```

Record the sha256. Then the same command to a second file; the two must match.

## 2. The residue sweep, every category, zero

```
make residue
```

Every category reads ZERO and the last line reads CLEAN. Anything else stops the
publish: fix the finding, never the check.

## 3. The secret scan: every tracked file, inside the gzip, inside the binary

The hook scans what is staged. The publish scans everything:

```
# every tracked file, the hook's patterns, plus the gzip the device serves
git ls-files | grep -v -x -e .githooks/pre-commit -e tools/test-hook.sh -e tools/residue-sweep.sh \
  | xargs grep -nE '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{16,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{16,}|\b0[0-9A-Z]{2}[A-Z]{2}[0-9A-Z]{10,}\b' \
  ; echo "exit $? (1 means no match, which is the answer wanted)"
gzip -9 -n -c firmware/main/ui.html | gzip -cd | grep -cE 'password|access_code' | xargs echo "credential words in the page (field names only, expected):"
# the built binary: its strings
cd firmware && idf.py build >/dev/null && strings -n 8 build/pandastatusos.bin \
  | grep -nE '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|Bearer |PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_' ; echo "exit $?"; cd ..
```

Then the literal scan against the real values:

```
test -s .claude/work/secrets/forbidden-strings.txt && \
  git grep -n -F -f .claude/work/secrets/forbidden-strings.txt -- . ':!.claude' ; echo "exit $? (1 wanted)"
```

## 4. The licence audit

```
python3 tools/ui/build/build.py --check     # every vendored file's sha256 matches its README row
python3 tools/art/gen_marks.py --check      # the marks are exactly what the generator produces
for d in firmware/main/vendor/*/; do echo "$d"; grep -E '^\| (version|licence)' "$d/README.md"; done
git grep -nwE 'MPL|Mozilla Public License' -- . ':!docs/DECISIONS.md' ':!firmware/main/vendor/coloris/README.md' ':!firmware/main/vendor/README.md'
```

Every dependency has a row; every row states a version and a licence; the MPL search
finds nothing but the prose that explains why iro.js was excluded. Provenance: the marks
are generated from primitives (D-010, D-011); the icons are Heroicons 2.2.0 hashed one
by one; nothing else is artwork.

## 5. The history: who, and what, ever

```
# one identity, author and committer, every commit
git log --all --format='%an <%ae> | %cn <%ce>' | sort | uniq -c
# zero attribution in any message
git log --all --format=%B | grep -ciE 'co-authored|anthropic|generated with|claude code' ; echo "(0 wanted)"
# every path that ever existed in any commit, checked for dumps, snapshots, secrets, working areas
git rev-list --all | while read c; do git ls-tree -r --name-only "$c"; done | sort -u \
  | grep -iE '\.(bin|dump|img|nvs|hex|elf)$|nvs|secret|dump|snapshot|\.claude/work|^private/|xindex|index\.raw|stock-ui' \
  | grep -vE '\.(c|h)$' ; echo "exit $? (1 wanted; the host tests' stub headers are C, not artifacts)"
# the hook's credential patterns over every added line in all history
git log -p --all -- . ':!tools/test-hook.sh' ':!.githooks/pre-commit' ':!tools/residue-sweep.sh' \
  | grep -E '^\+' | grep -nE '(password|passwd|psk|pwd|secret|token|api[_-]?key|access[_-]?code|ssid|serial)["'"'"'`]?[[:space:]]*[:=][[:space:]]*["'"'"'`]?[A-Za-z0-9._~+/-]{6,}(["'"'"'`;,)}[:space:]]|$)' \
  | grep -vE 'ps_[a-z0-9_]+' ; echo "exit $? (1 wanted)"
# BIQU material: the vendor tokens over every version of every file, ever
git rev-list --all | while read c; do git ls-tree -r --name-only "$c" \
  | grep -v -x -e .githooks/pre-commit -e tools/test-hook.sh -e tools/residue-sweep.sh \
  | while read f; do git show "$c:$f"; done; done 2>/dev/null \
  | grep -acE '\bid_[a-z][a-zA-Z0-9_]*\b|\bc_[a-z][a-zA-Z0-9_]*\b' ; echo "(0 wanted; the three pattern-definition files carry the tokens by definition)"
```

The expected answers: one identity line; 0; exit 1; exit 1; 0. Anything else stops the
publish. The repository was reset before commit one precisely so this section is a
formality (`docs/DECISIONS.md`, D-001 to D-007).

## 6. Public or private: a decision, not a default

The repository is private today. Making it public is the maintainer's decision, made
on the day, after steps 2 to 5 have been run that day and read. It is not implied by
the push and not made by any command below. When it is made, it is made on GitHub by
hand, and the first thing checked afterwards is the repository's own file list.

## 7. The remote and the push, ready to run

Check first whether the checkout already has a remote:

```
git remote -v
git status -sb | head -1
```

If it does not, add it. The URL is the SSH form, as PandaVentOS uses:

```
git remote add origin git@github.com:jeremykenedy/PandaStatusOS.git
```

Then, on the day the maintainer says push, and not before:

```
git push -u origin main
```

Nothing in this repository runs either command. `make` has no target for them, the
harnesses never touch git, and the hook does not know the remote exists.

## 8. Verify after the push

```
git fetch origin && git status -sb | head -1        # main...origin/main, nothing ahead or behind
git ls-remote --heads origin                        # exactly one branch, main
gh repo view jeremykenedy/PandaStatusOS --json visibility,pushedAt
```

Then open the repository in a browser as a signed-out user (a private window) and
confirm it is what step 6 decided. Read the README as a stranger would: the restore
path comes first, the disclaimer draws the line, no screenshot shows a real value.
