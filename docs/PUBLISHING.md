# Publishing PandaStatusOS

The repository is on GitHub, private, at `git@github.com:jeremykenedy/PandaStatusOS.git`,
and pushing to it is routine (`CLAUDE.md`, Rule 1 as amended 2026-09-10). The one step
that cannot be taken back is the flip from private to public. This checklist gates that
flip. It is run in full on the day, by the maintainer, and read before the setting is
changed. Nothing in this repository changes the setting: it is done by hand on GitHub,
once, one way.

## What the flip exposes

The day the repository goes public, every commit ever pushed becomes visible, not just
the current tree: every version of every file, every commit message, every author line,
every path that ever existed and was later deleted. Pushed history is never rewritten
(Rule 1), so nothing pushed while private can be taken back before the flip, and nothing
can be hidden after it.

That moves the weight of this checklist. The working-tree checks (steps 2 to 4) prove the
tree as it stands today. The history checks (step 5) prove everything behind it, and they
are the load-bearing part: a secret that was committed, pushed and later deleted passes
every working-tree check and is published the moment the flip is made. The tree is
checked because it is what a visitor reads first; the history is checked because it is
what a visitor can read at all.

While the repository is private a push is contained but not erasable: what is pushed
today is published on the day of the flip. The pre-commit hook is the gate on every
commit; this checklist is the gate on the flip.

## Where the repository stands

- The remote `origin` is the repository above. The maintainer created it and made the
  first push by hand on 2026-09-10 (`be73ce8`). Every push since is verified by step 8.
- The repository is **private** (`gh repo view`; a signed-out request for the repository
  page answers 404). It stays private until this checklist has been run and read on the
  day the maintainer decides.
- Every commit is authored and committed by Jeremy Kenedy, one identity.
- The history was reset before commit one (`docs/DECISIONS.md`, D-001 to D-007), and every
  commit since was made through the pre-commit hook. Step 5 proves that again on the day
  rather than trusting it.

## 1. Back up, twice

```
cd ~/sites && TS=$(date +%Y%m%d-%H%M%S) \
  && tar cf - --exclude='private/uiwork/node_modules' PandaStatus | gzip -9 -n > ~/backups/PandaStatus-publish-$TS.tgz \
  && shasum -a 256 ~/backups/PandaStatus-publish-$TS.tgz
```

Record the sha256. Then the same command to a second file; the two must match. `gzip -n`
leaves the timestamp out of the archive header. `tar czf` writes one, so two archives of
the same tree taken a second apart would never match, and the step could never pass.

## 2. The residue sweep, every category, zero

```
make residue
```

Every category reads ZERO and the last line reads CLEAN. Anything else stops the flip:
fix the finding, never the check.

## 3. The secret scan: every tracked file, inside the gzip, inside the binary

The hook scans what is staged. The flip scans everything:

```
# every tracked file, the hook's patterns, plus the gzip the device serves
git ls-files | grep -v -x -e .githooks/pre-commit -e tools/test-hook.sh -e tools/residue-sweep.sh \
  | xargs grep -cHE '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{16,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{16,}|\b0[0-9A-Z]{2}[A-Z]{2}[0-9A-Z]{10,}\b' \
  | grep -v ':0$' ; echo "exit $? (1 wanted: no file with a count above zero; xargs's own exit code is not a verdict)"
gzip -9 -n -c firmware/main/ui.html | gzip -cd | grep -cE 'password|access_code' | xargs echo "credential words in the page (field names only, expected):"
gzip -9 -n -c firmware/main/ui.html | gzip -cd | grep -oE '[A-Za-z_.-]*(password|access_code)[A-Za-z_.-]*' | sort | uniq -c
# the built binary: its strings (idf.py comes from the IDF shell; a failed build fails the step)
( . ~/esp/esp-idf/export.sh >/dev/null && cd firmware && idf.py build >/dev/null ) || echo "BUILD FAILED: this step fails"
test -f firmware/build/pandastatusos.bin || echo "MISSING BINARY: this step fails"
strings -n 8 firmware/build/pandastatusos.bin \
  | grep -nE '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|Bearer |AKIA[0-9A-Z]{16}|gh[pousr]_' ; echo "exit $? (1 wanted)"
# a private key is a PEM marker followed by a base64 body. mbedtls carries the bare marker
# strings as parser constants, so the marker alone is not a finding; a body after one is.
strings -n 8 firmware/build/pandastatusos.bin | grep -A1 -E 'BEGIN [A-Z ]*PRIVATE KEY' \
  | grep -cE '^[A-Za-z0-9+/=]{40,}$' ; echo "(0 wanted: no key body follows any marker)"
```

The second gzip line lists every word matched by the first: each must be a field name
or a string-table key, never a value.

Then the literal scan against the real values. The file is read the way the hook reads
it: blank lines and `#` comments ignored, values shorter than four characters ignored.
A missing file fails the step; it does not skip it.

```
F=.claude/work/secrets/forbidden-strings.txt; test -s "$F" || echo "MISSING: $F. The literal scan cannot run and this step fails."
grep -vE '^(#|[[:space:]]*$)' "$F" | awk 'length($0) >= 4' > /tmp/ps-forbidden.$$ \
  && git grep -n -F -f /tmp/ps-forbidden.$$ -- . ':!.claude' ; echo "exit $? (1 wanted)"; rm -f /tmp/ps-forbidden.$$
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

This is the load-bearing step. Everything it scans becomes public on the day of the flip.

```
# one identity, author and committer, every commit
git log --all --format='%an <%ae> | %cn <%ce>' | sort | uniq -c
# zero attribution in any message (bracketed so the pattern cannot match itself in the residue sweep; the regex is unchanged)
git log --all --format=%B | grep -ciE 'co-auth[o]red|anthr[o]pic|generated w[i]th|claude c[o]de' ; echo "(0 wanted)"
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
flip, and because pushed history is never rewritten, a finding here is not fixed by a
commit that deletes it: the repository stays private, and what to do next is the
maintainer's decision. The repository was reset before commit one precisely so that this
section is a formality (D-001 to D-007).

## 6. The flip: a decision, not a default

The repository is private today. Making it public is the maintainer's decision, made on
the day, after steps 1 to 5 have been run that day and read. It is not implied by any
push and not made by any command in this repository. When it is made, it is made on
GitHub by hand, once; it is one way; and the first thing checked afterwards is step 8's
signed-out view.

## 7. Pushing, which is routine

The remote exists and pushing `main` to it is authorized. What is never done: a force
push, a rewrite of pushed history by any means, a second remote, a change to the
visibility.

```
git remote -v                      # origin, the SSH URL above, and nothing else
git status -sb | head -1           # main...origin/main, ahead by what is about to go
git push origin main
```

Nothing in this repository runs the push. `make` has no target for it, the harnesses
never touch git, and the hook does not know the remote exists. A push is not gated by
this checklist; the flip is. The hook gates the push, one commit at a time.

## 8. Verify: after a push, and after the flip

After every push:

```
git fetch origin && git status -sb | head -1        # main...origin/main, nothing ahead or behind
git ls-remote --heads origin                        # exactly one branch, main
gh repo view jeremykenedy/PandaStatusOS --json visibility,pushedAt
```

After the flip, and only then: open the repository in a browser as a signed-out user (a
private window), or `curl -s -o /dev/null -w '%{http_code}\n' https://github.com/jeremykenedy/PandaStatusOS`,
which answers 404 while private and 200 once public. Read the README as a stranger would:
the restore path comes first, the disclaimer draws the line, no screenshot shows a real
value. Then open the commit list and read it as a stranger too, because that is what the
flip published.
