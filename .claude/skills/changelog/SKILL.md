---
name: changelog
description: Generate the next period update file in updates/ for ActiveCAMT, in the established Thai house style (date-range filename, ฝั่งนักศึกษา + ฝั่งทีม sections, Discord/funding framing). Summarizes the git commits since the last update file. Use when the user wants to write the period changelog, Discord update, or funding progress notes.
---

# Changelog / Period Update (ActiveCAMT)

Produces the next `updates/<range>.md` file: a Thai-language period summary that gets
posted to Discord, read by the team, and feeds the funding paper trail
(`project_proposal_th.md` / `srs_document_th.md`). It is written **from the git
commits in the period**, never invented.

## Output contract: match the house style exactly

Existing files (`updates/2026-06-13_to_06-14.md`, etc.) define the format. Reproduce it precisely:

- **No em dashes (—), anywhere in the output.** Write natural, human sentences in both Thai and English instead of dash-stitched fragments. Join clauses with "เพราะ", "ซึ่ง", "โดย", a comma, or just split into two sentences, whichever reads most naturally. This applies to every bullet, not just the title/subtitle. (An en-dash `–` used for a numeric date range, e.g. `14–16`, is a different character and stays fine.)
- **Filename:** `updates/YYYY-MM-DD_to_MM-DD.md`, using Gregorian dates: start as `YYYY-MM-DD`, end as `MM-DD` (same year). e.g. `updates/2026-06-14_to_06-16.md`.
- **Title line:** `# อัปเดต ActiveCAMT ช่วง <D–D เดือน ปีพ.ศ.-2หลัก>` using Thai month abbreviation and **2-digit Buddhist year** (2026 → `69`). e.g. `# อัปเดต ActiveCAMT ช่วง 14–16 มิ.ย. 69`.
- **Subtitle:** one flowing sentence, not a dot-separated fragment. e.g. `สรุปสำหรับช่วง <same Thai range> เอาไว้ลง Discord และให้ทีมที่เกี่ยวข้องอ่านกัน`.
- `---` separator, then:
- `## ฝั่งนักศึกษา (สิ่งที่ user จะเห็น)`: **user-visible changes only**, plain Thai, friendly tone, each bullet led by a **bold** phrase. No code, no file paths.
- `---`, then `## ฝั่งแอดมิน/ทีมงาน (สิ่งที่ staff จะเห็น)` (include only when the period actually shipped an admin/staff-facing UI or workflow change): same benefit-first, plain-Thai treatment as the student section, but for what admin/staff roles specifically will notice. Don't let a staff-facing feature fall through to the technical section below just because it isn't student-visible; staff deserve a plain-language summary too.
- `---`, then `## ฝั่งทีม (technical changelog)`: grouped into `###` subsections **by domain** (e.g. PDPA, สิทธิ์เข้าถึง/roles, บ้าน (Houses), Registration, Mobile/UI, Security & Performance, plus a "แก้ตามหลัง" group for follow-up fixes). Technical but concise; file/column names and rationale are welcome here.
- `---`, then footer: a flowing sentence naming each PR/commit covered, not a dot-separated data dump. e.g. `สรุปจาก commit ช่วง <Thai range>` extended with `รวม PR #X (…) และ PR #Y (…)` when there are specific PRs worth naming.
- **Language: Thai only.** (The app is 4-language EN/TH/MM/CN, but these update docs are Thai.)

### Date conversion
- Buddhist year = Gregorian + 543; 2-digit form = last two digits (2569 → `69`).
- Thai month abbreviations: ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.
- Range uses an en-dash between days: `14–16 มิ.ย. 69`.

## Workflow
1. **Determine the range.** List `updates/` and take the latest file's **end date** as the new start; the new end is today (use today's date from context). If the gap is large or ambiguous, confirm the range with the user before writing.
2. **Gather the commits.** `git log --since=<start> --until=<end> --no-merges --pretty=...` (and skim diffstats where a message is terse). Read enough to tell **user-visible** changes from internal ones. Ignore pure merge/chore noise unless it's user-relevant.
3. **Classify & group.** Each change → ฝั่งนักศึกษา (would a student notice?), ฝั่งแอดมิน/ทีมงาน (would only admin/staff notice, as a real UI/workflow change?), or ฝั่งทีม (grouped by domain, for the technical writeup everything still gets). When unsure whether something is user-visible, put it under ฝั่งทีม.
4. **Write in Thai** matching the tone of prior files: concise bold-led bullets for students and staff, precise grouped notes for the team. Reuse the house's existing terminology (e.g. บ้านมอม/โต/ลวง/มกร, "scanner-only", PDPA สัญญาณ vs รายละเอียด).
5. **Write the file** to `updates/<range>.md`, then show it to the user for a phrasing pass.
6. **Once the phrasing is approved, commit and push directly to `main`.** No feature branch, no PR: this is the CLAUDE.md-documented exception for changelog-only `updates/*.md` entries (docs-only, no code/schema risk). Don't run the full branch → PR → merge cycle just for this file.

## Rules
- **Never fabricate.** Every line must trace to a commit/diff in the range. If a feature isn't in the commits, it doesn't go in.
- **Don't leak secrets or PDPA detail.** Describe medical/PDPA work at the level the existing files do ("เห็นแค่สัญญาณ ไม่เห็นรายละเอียด"); never include actual student data, tokens, or credentials.
- **Push straight to `main` after approval** (see step 6). Don't open a branch/PR for this file alone, and don't bundle it into an unrelated feature branch.
- Keep section headers **verbatim** so every file in `updates/` stays consistent and greppable.
