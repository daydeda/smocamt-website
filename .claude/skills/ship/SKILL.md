---
name: ship
description: Ship the current changes end-to-end for ActiveCAMT. Commit straight to main, push, tag the commit with a semver version + description, cut a GitHub release, and record the day's entry in updates/. No feature branch and no PR. Use when the user says "ship this", "commit and push", or otherwise wants the commit → push → tag → release flow in one go. For deploys that touch the DB schema or read a new column, run /safe-deploy first.
---

# Ship (ActiveCAMT)

Takes working-tree changes from "done on `main`" to "pushed to `main`, tagged, and
released". By the user's standing decision (to save tokens and time) there is **no
feature branch and no PR**: commit on `main` and push it directly. Every ship ends
with a new `vX.Y.Z` tag and a matching GitHub release. That's not optional, it's the
last two steps of the flow, same as the changelog entry.

**A push to `main` redeploys production** (the Portainer webhook fires on every main
push). With no PR gate left, the preconditions below are the only safety net, so do
not skip them.

## When to use
- The user asks to "ship", "commit and push", or wants the whole commit → push →
  tag → release sequence.
- The change is already implemented and reviewed enough to land.

## When NOT to use (or do something first)
- **Schema / new-column changes:** run **/safe-deploy** first. Prod must be
  migrated before code that reads a new column is pushed. This skill does not migrate.
- **Unreviewed or risky diffs:** run **/recheck** first.
- The user only wants a commit, or only a PR: just do that step.

## Preconditions (verify before committing)
1. **On `main` and up to date.** `git branch --show-current` is `main`, and
   `git pull --ff-only` succeeds. Stop on any divergence; never force-push.
2. **Build + lint pass.** Run `npm run build` and `npm run lint`. Pre-existing
   warnings/errors in files you didn't touch are fine; do not let *new* ones land.
3. **Schema/new-column changes are migrated on prod first** (see /safe-deploy),
   because the push redeploys immediately.
4. Know what's staged. `git status --short`, and commit only the intended files.
   Unrelated local edits (for example tooling or settings changes that are not part
   of this ship) stay out of the commit.

## Steps

1. **Bump the version** to the next semver (see step 5 for how to pick it), so
   `package.json` matches the tag the same commit gets. Use
   `npm version X.Y.Z --no-git-tag-version` (it updates `package-lock.json` too). If
   `package.json` holds unrelated local edits, commit only the version line, never
   those edits.

2. **Stage + commit on `main`.** Quote any path containing `[` `]`. This repo has
   routes like `src/app/api/events/[id]/register/route.ts`, and **zsh glob-expands
   the brackets** (`no matches found`) unless the path is single-quoted.
   ```bash
   git add 'src/app/api/events/[id]/.../route.ts' 'src/app/...'
   git commit -m "<conventional commit subject>" -m "<body>"
   ```
   Commits use the user's own git identity only. Do not add any `Co-Authored-By`
   trailer, and do not mention the AI tooling in the message.

3. **Scan, then push to `main`.** Before any push, scan the new commits and the
   tracked files you changed for any AI-tool attribution (the words listed in the
   user's global no-attribution rules) and remove what you find. Then:
   ```bash
   git push origin main
   ```
   If the push is rejected because `main` moved, `git pull --rebase`, re-run the
   build, and push again. Never `--force`.

4. **Confirm clean state:**
   ```bash
   git branch --show-current   # -> main
   git status --short          # nothing left that belonged to this ship
   git log --oneline -1        # -> your commit
   ```

5. **Pick the version** (used in step 1, tag, release, and changelog header). Bump
   from the latest tag (`git describe --tags --abbrev=0`): patch (`x.y.Z`) for
   fixes/small UX changes, minor (`x.Y.0`) for new features/modules, major
   (`X.0.0`) only if the user says so or it's a breaking change.

6. **Tag the release (always).** This repo tags every ship with an annotated
   semver tag and a matching GitHub release. Check `git tag -l | sort -V | tail`
   and `gh release list --limit 5` for the current pattern before assuming. The
   tag points at the commit you just pushed to `main`.

   - **Pick the version.** Bump from the latest tag (`git describe --tags
     --abbrev=0`), following semver: patch (`x.y.Z`) for fixes/small UX changes,
     minor (`x.Y.0`) for new features/modules, major (`X.0.0`) only if the user
     says so or it's a breaking change. When unsure, default to a patch/minor
     bump matching the size of what just shipped; don't ask unless it's
     genuinely ambiguous.
   - **The tag message and GitHub release notes are English only, never Thai.**
     This is the opposite language choice from the `updates/` changelog entry
     in step 7, which stays Thai — don't let that house style bleed into the
     tag/release. **No em dashes (—) anywhere in them either.** Write natural,
     human sentences instead of dash-stitched fragments; join clauses with
     "and"/"since"/"which", a comma, or split into two sentences, whichever
     reads most naturally.
   - **Write the tag message.** Follow the existing style: `Release vX.Y.Z:
     <short description>` (same format for a date-range cycle too, just a
     colon, not a dash), then a blank line and a few bullet highlights pulled
     from the commits since the last tag (`git log <last-tag>..HEAD --oneline`).
     Look at recent tags (`git tag -l -n99 <tag>`) to match tone, but write the
     actual sentences as natural prose per the rule above, not terse
     dash-joined fragments.
   - **Create an annotated tag and push it.** Tags are refs, not branch
     commits, so pushing a tag does not touch `main`:
     ```bash
     git tag -a vX.Y.Z -m "Release vX.Y.Z: <description>

     - <highlight 1>
     - <highlight 2>"
     git push origin vX.Y.Z
     ```
   - **Cut the GitHub release** from that tag, reusing the tag message as the
     release body:
     ```bash
     gh release create vX.Y.Z --title "vX.Y.Z: <short description>" \
       --notes "<highlights, same content as the tag message>"
     ```
   - Skip this step only if the user explicitly says not to tag/release this
     ship (e.g. a hotfix bundled into the next release); otherwise it's
     mandatory, same as the changelog entry below.

7. **Record the changelog (always, as the last step, done inline, no subagent).**
   After the push lands, write/extend today's entry in `updates/` yourself, in
   the established Thai house style (ฝั่งนักศึกษา + ฝั่งทีม, plus ฝั่งแอดมิน/
   ทีมงาน when relevant, see below). This is not optional and not automatic
   anywhere else: shipping without a changelog entry is incomplete. This step
   only touches Markdown under `updates/`, never code or `main` history.
   **Commit and push this directly to `main`**, with no separate branch or PR for
   it (CLAUDE.md's documented exception for docs-only `updates/*.md` entries).
   It rides the same direct-to-main flow as the code, as its own small commit.
   - **Find the date.** `date +%Y-%m-%d`. Buddhist year for the header =
     Gregorian year + 543, shown as last two digits (2026 → "69"). Thai month
     abbreviations: ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.
   - **Read the existing log.** `ls updates/` and read the latest 1–2 files to
     copy their structure, heading wording, date format, and bullet style
     exactly.
   - **Derive content from what actually shipped**: the commit(s) just
     pushed in step 3, not guesswork. Never invent a bullet that doesn't trace
     to a real change.
   - **Choose the file.** Default: a new `updates/YYYY-MM-DD.md` for today.
     Only extend the latest existing file instead if it's an open period range
     that clearly continues into today; append, never rewrite or delete prior
     entries.
   - **No em dashes (—) anywhere in the entry.** Write natural, human sentences
     in both the Thai bullets and any English technical terms mixed in,
     instead of dash-stitched fragments. Join clauses with "เพราะ", "ซึ่ง",
     "โดย", a comma, or split into two sentences, whichever reads most
     naturally. Same goes for the closing PR-reference line: write it as
     flowing prose ("อัปเดตรอบนี้รวม PR #X (…) และ PR #Y (…)"), not a
     dot-separated data dump.
   - **Write the entry:** first line is the version header `# ActiveCAMT vX.Y.Z 🎉`
     using the tag just created in step 6 (this is the natural source of truth
     here, since it was just tagged). Then the existing Thai title line
     `# อัปเดต ActiveCAMT ประจำวันที่ <date> 69` below it, a
     one-line subtitle like "สรุปสำหรับวันที่ … เอาไว้ลง Discord และให้ทีมที่
     เกี่ยวข้องอ่านกัน", then:
     - `## ฝั่งนักศึกษา (สิ่งที่ user จะเห็น)`: user-facing, plain Thai,
       benefit-first, no code jargon.
     - `## ฝั่งแอดมิน/ทีมงาน (สิ่งที่ staff จะเห็น)`: same benefit-first, plain
       Thai treatment as the student section, but for changes only admin/staff
       roles see (e.g. an admin-only UI feature). Include this section
       whenever a shipped change is staff-facing but not student-facing.
       Don't let it fall through to the technical section below just because
       it's not student-visible; staff deserve a plain-language summary too,
       not just developer-oriented bullets.
     - `## ฝั่งทีม (technical changelog)`: grouped technical bullets by area
       (PDPA, สิทธิ์เข้าถึง, Houses, Registration, Mobile/UI, DB/migration).
       Always call out anything touching PDPA/medical gating, access control,
       or migrations.
     - Closing PR/commit-reference line, matching the existing files' style
       (see the no-em-dash rule above for how to phrase it).
     Only include sections that have content. Thai is the primary language;
     keep English only for proper nouns/technical terms as the existing files
     do.
   - Report which file you created or extended, plus a short English gloss of
     the bullets so the user can sanity-check before sharing.

## Notes
- If `git push origin main` is refused (branch protection, rejected non-fast-forward
  that a plain rebase cannot resolve), stop and tell the user; do not force-push or
  try to bypass it.
- This skill is git mechanics only. It does **not** deploy or migrate, but pushing
  to `main` triggers the production redeploy, so prod must already be migrated (via
  /safe-deploy) for any schema-dependent change *before* you push in step 3.
- Tagging (step 6) always happens after the push (step 3) lands, never before: the
  tag must point at a commit that's actually on `main`.
