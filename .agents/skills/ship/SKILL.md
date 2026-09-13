---
name: ship
description: Ship the current changes end-to-end for ActiveCAMT. Branch off main, commit, push, open a PR, merge it into main, delete the branch (local + remote), tag the merge with a semver version + description, cut a GitHub release, and record the day's entry in updates/. Use when the user says "ship this", "commit + PR + merge", "open a PR and merge", or otherwise wants the full feature-branch → PR → merge → tag → release → cleanup flow in one go. For deploys that touch the DB schema or read a new column, run /safe-deploy first.
---

# Ship (ActiveCAMT)

Takes working-tree changes from "done on `main`'s worktree" to "merged into `main`,
tagged, and released" without ever pushing to `main` directly. The merge happens
through a PR, and that is the only sanctioned path to `main` (see CLAUDE.md: **never
push to `main`**). Every ship ends with a new `vX.Y.Z` tag and a matching GitHub
release. That's not optional, it's the last two steps of the flow, same as the
changelog entry.

## When to use
- The user asks to "ship", "commit and open a PR and merge", or lists the full
  branch → PR → merge → delete-branch sequence.
- The change is already implemented and reviewed enough to land.

## When NOT to use (or do something first)
- **Schema / new-column changes:** run **/safe-deploy** first. Prod must be
  migrated before code that reads a new column merges. This skill does not migrate.
- **Unreviewed or risky diffs:** run **/recheck** first.
- The user only wants a commit, or only a PR (no merge): just do that step.

## Preconditions (verify before branching)
1. **Build + lint pass.** Run `npm run build` and `npm run lint`. Pre-existing
   warnings/errors in files you didn't touch are fine; do not let *new* ones land.
2. Know what's staged. `git status --short`, and commit only the intended files.

## Steps

1. **Branch off main.** Pick a descriptive name: `feat/...`, `fix/...`, `chore/...`.
   ```bash
   git checkout -b feat/<short-description>
   ```

2. **Stage + commit.** Quote any path containing `[` `]`. This repo has routes like
   `src/app/api/events/[id]/register/route.ts`, and **zsh glob-expands the brackets**
   (`no matches found`) unless the path is single-quoted.
   ```bash
   git add 'src/app/api/events/[id]/.../route.ts' 'src/app/...'
   ```
   Commit with a clear subject + body, ending with the trailer:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

3. **Push** and set upstream:
   ```bash
   git push -u origin feat/<short-description>
   ```

4. **Open the PR** against `main` with `gh`. End the body with:
   ```
   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```
   ```bash
   gh pr create --base main --head feat/<short-description> \
     --title "<conventional commit title>" --body "<summary>"
   ```

5. **Merge + delete the branch** (deletes both remote and local, returns you to
   `main`):
   ```bash
   gh pr merge <PR#> --merge --delete-branch
   ```
   Use `--merge` (a real merge commit, matching this repo's history) unless the user
   asks for `--squash` or `--rebase`.

6. **Confirm clean state:**
   ```bash
   git branch --show-current   # -> main
   git branch                  # the feature branch is gone
   git log --oneline -1        # -> the merge commit
   ```

7. **Tag the release (always).** This repo tags every ship with an annotated
   semver tag and a matching GitHub release. Check `git tag -l | sort -V | tail`
   and `gh release list --limit 5` for the current pattern before assuming. The
   tag points at the merge commit already sitting on `main`; nothing here pushes
   new code to `main`. (If you also want `package.json`'s `"version"` field to
   match the tag, bump it inside the feature branch back in step 2 so it rides
   through the normal PR, never as a separate direct commit to `main`.)

   - **Pick the version.** Bump from the latest tag (`git describe --tags
     --abbrev=0`), following semver: patch (`x.y.Z`) for fixes/small UX changes,
     minor (`x.Y.0`) for new features/modules, major (`X.0.0`) only if the user
     says so or it's a breaking change. When unsure, default to a patch/minor
     bump matching the size of what just shipped; don't ask unless it's
     genuinely ambiguous.
   - **No em dashes (—) anywhere in the tag message or release notes.** Write
     natural, human sentences (Thai and English) instead of dash-stitched
     fragments. Join clauses with "เพราะ"/"ซึ่ง"/"โดย", a comma, or split into
     two sentences, whichever reads most naturally.
   - **Write the tag message.** Follow the existing style: `Release vX.Y.Z:
     <short description>` (same format for a date-range cycle too, just a
     colon, not a dash), then a blank line and a few bullet highlights pulled
     from the PR(s) since the last tag (`git log <last-tag>..HEAD --oneline`).
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

8. **Record the changelog (always, as the last step, done inline, no subagent).**
   After the merge lands, write/extend today's entry in `updates/` yourself, in
   the established Thai house style (ฝั่งนักศึกษา + ฝั่งทีม, plus ฝั่งแอดมิน/
   ทีมงาน when relevant, see below). This is not optional and not automatic
   anywhere else: shipping without a changelog entry is incomplete. This step
   only touches Markdown under `updates/`, never code or `main` history.
   **Commit and push this directly to `main`**, with no separate branch/PR for
   it (CLAUDE.md's documented exception for docs-only `updates/*.md` entries).
   Don't repeat the full branch → PR → merge cycle just to land the changelog
   file.
   - **Find the date.** `date +%Y-%m-%d`. Buddhist year for the header =
     Gregorian year + 543, shown as last two digits (2026 → "69"). Thai month
     abbreviations: ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.
   - **Read the existing log.** `ls updates/` and read the latest 1–2 files to
     copy their structure, heading wording, date format, and bullet style
     exactly.
   - **Derive content from what actually shipped**: the commit(s)/PR just
     merged in step 5, not guesswork. Never invent a bullet that doesn't trace
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
     using the tag just created in step 7 (this is the natural source of truth
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
- If branch protection blocks `gh pr merge` (required reviews/checks), stop and tell
  the user; do not try to bypass it or push to `main`.
- If the merge is not a fast-forward and conflicts arise, stop and surface the
  conflict rather than force-anything.
- This skill is git mechanics only. It does **not** deploy or migrate. Vercel
  deploys on merge to `main`, so make sure prod is already migrated (via
  /safe-deploy) for any schema-dependent change *before* you run step 5 (the merge).
- Tagging (step 7) always happens after the merge (step 5) lands, never before:
  the tag must point at a commit that's actually on `main`.
