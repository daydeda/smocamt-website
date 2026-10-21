# ActiveCAMT Scoring Rules — Houses & Individuals
# กติกาการให้คะแนน — บ้านและรายบุคคล

**Purpose / วัตถุประสงค์:** Make every point traceable to a written rule, so no score can be fairly disputed. If a student or staff member asks *"why did this house/person get these points?"*, the answer is always in this document plus the audit log — never a personal opinion.

> These rules describe exactly what the system does today and add a fixed rubric for the two places where a human chooses the number. Numbers here match the code; if the code changes, update this file in the same pull request.

---

## 1. Core principles / หลักการ

1. **Transparency (โปร่งใส).** Every point change is recorded in `score_history` (house) and the audit log (individual), with a reason and timestamp. Nothing is awarded off the record.
2. **Consistency (เสมอภาค).** The same action earns the same points for everyone. Staff do not invent amounts; they apply the rubric in §4.
3. **Objectivity first (ใช้เกณฑ์อัตโนมัติก่อน).** Wherever possible, points are computed by the system from attendance and form data — not by human judgment.
4. **Auditability (ตรวจสอบได้).** Manual changes require a written reason and are attributed to the staff member who made them.
5. **No silent edits (ห้ามแก้คะแนนเงียบ ๆ).** Corrections are made by a new, reasoned adjustment — never by quietly editing a past total.

---

## 2. Two separate scoreboards / คะแนนสองประเภท

| | **Individual points** (คะแนนบุคคล) | **House points** (คะแนนบ้าน) |
|---|---|---|
| Belongs to | one student (`users.points`) | one house (`houses.points`) |
| Who earns | the student, by taking part | the house, by collective result |
| Source | staff award at an event (§4) | automatic + milestone + manual (§3) |
| Affects house score? | only via the 100-point milestone (§3.3) | yes, directly |

A student's individual points and their house's points are **not the same pool**. Earning individual points does not subtract from anyone.

---

## 3. House points — how a house scores / คะแนนบ้านมาจากไหน

House points come from **exactly four sources**, and nowhere else.

### 3.1 Event-winner bonus (โบนัสบ้านชนะกิจกรรม) — automatic
- When an event's end time passes, the system counts check-ins with status **`attended`**, grouped by house.
- The house with the **most attendees** receives that event's configured `pointsAwarded`.
- **Tie rule:** if two or more houses tie for the most attendees, **each tied house receives the full bonus** (the bonus is not divided). This is intentional — no house is penalised for a tie.
- Awarded once per event (guarded by `winnerAwardedAt`); it can never be paid twice.
- If no one attends, or all attendees are unassigned to a house, a 0-point record is logged and no bonus is given.

> Fairness note: this rule rewards **turnout**, which every house can influence equally. The metric (attended check-ins) is the same for all houses and is not subject to opinion.

### 3.2 Form-contest bonus (โบนัสแบบประเมิน) — automatic
- When an evaluation form's scheduled `closesAt` passes, the system counts **submissions** per house.
- The house with the **most submissions** receives that form's `pointsAwarded`.
- **Tie rule:** same as §3.1 — every tied house gets the full bonus.
- Awarded once per form (guarded by `isAwarded`).

> Fairness note: rewards **participation in evaluation**, measured identically for every house.

### 3.3 Individual milestone bonus (โบนัสหลักร้อย) — automatic
- Every time a student's **individual** total crosses a multiple of **100** (100, 200, 300, …), their house receives **+2 points** for each 100-mark crossed in that award.
- Example: a student on 90 points is awarded 120 → they cross **100** once → house gets **+2**. A student on 80 awarded 250 → crosses **100, 200, 300** … (here 100 and 200) → house gets **+4**.

> Fairness note: this ties house success to broad individual participation, so a house benefits from *many* active members, not just a few.

### 3.4 Manual adjustment (การปรับคะแนนด้วยมือ) — staff, by rule only
A staff member may add or subtract house points directly **only** for a reason listed in §5. Every manual adjustment **must** include a written reason and is logged with the staff member's identity.

---

## 4. Individual points — the fixed award rubric / เกณฑ์ให้คะแนนบุคคล

This is the **only** place a staff member chooses a number for a student, so it is governed by a fixed rubric. Staff award an **integer from 1 to 500** by scanning the student at an event.

**Rule 4.1 — Use the rubric, not opinion.** Pick the band below that matches what the student did. Do not improvise amounts.

| Band | Points | When it applies / ใช้เมื่อ |
|---|---|---|
| **Attendance** (เข้าร่วม) | **10** | Student checks in and takes part for the core of the activity. |
| **Active participation** (มีส่วนร่วม) | **20** | Attends **and** contributes — answers, joins a group task, completes the activity's main task. |
| **Role / responsibility** (รับหน้าที่) | **30** | Takes a defined role: helper, group leader, presenter, set-up/clean-up crew. |
| **Achievement** (ผลงานเด่น) | **50** | Wins a game/round, top submission, or a judged standout result. |
| **Special / event-defined** (กรณีพิเศษ) | up to **500** | Reserved for large flagship events where the **point value is published in advance** as part of the event rules (e.g. a competition final). Must be written in the event description before the event starts. |

**Rule 4.2 — One award per student per activity, per reason.** A student is scored once for a given contribution. Do not scan the same student repeatedly to inflate points.

**Rule 4.3 — Equal opportunity.** Every registered participant is eligible for the same bands under the same conditions. A student is never given more because of who they are; only because of what the rubric says they did.

**Rule 4.4 — Always write the reason** when the award is above the Attendance band, so the audit log explains it. (The "reason" field exists for this.)

**Rule 4.5 — The 500 ceiling is a guardrail, not a target.** Day-to-day awards live in the 10–50 range. Anything approaching the ceiling must be a pre-published special-event value (Rule 4.1, Special band).

**Rule 4.6 — Published values win.** If an event publishes its own point values in its description before it starts, those override the default bands for that event — because students were told the rules in advance.

---

## 5. When manual house adjustments are allowed / ปรับคะแนนบ้านได้เมื่อใด

A direct house adjustment (§3.4) is permitted **only** for these reasons, each requiring a written note:

1. **Correcting a logged error** — e.g. an event was misconfigured and the wrong bonus was paid. Fix it with a reasoned reverse/replacement entry; never silently edit history.
2. **A house-level event result the system can't measure automatically** — e.g. a live inter-house competition judged on the day. The point value **must be announced before** the competition begins.
3. **Pre-announced penalties** — only for conduct rules published to all houses in advance (see §6).

Adjustments **outside** these reasons are not permitted, regardless of seniority.

---

## 6. Penalties / การหักคะแนน

1. Points are deducted **only** for conduct rules that were **written and shared with all houses before** the activity.
2. The deduction amount for each violation is fixed and published in advance — staff do not decide it on the spot. (No-show strike-out, item 5 below, is the one deliberate exception: the applying staff member picks the amount within a published range, and the audit log stands in for pre-publication.)
3. Every deduction is logged with the rule it enforces and the staff member who applied it.
4. No retroactive penalties: you cannot deduct for behaviour against a rule that did not exist when it happened.

5. **No-show strike-out** (US-STRI-15a/b/c, `docs/agile/01-product-backlog.md`): a student who pre-registers for an event but never checks in loses individual points per confirmed no-show, floored at 0 (`GREATEST(0, ...)`, `deductIndividualPoints` in `src/lib/points/award-individual-points.ts`) — unlike every other individual-points award, this one IS a clawback, by design. Detection is **organizer-confirmed, not automatic**: a super_admin/admin/organizer must click "Strike No-shows" on the ended event (`POST /api/admin/events/[id]/apply-strikes`), so a missed/late scan never silently strikes someone who actually attended. **Exception to Rule 6.2 (fixed amount published in advance):** whoever applies the strike chooses the points deducted at that moment, defaulting to **10** (`NO_SHOW_PENALTY_POINTS`) and bounded to **1–50** (`NO_SHOW_PENALTY_MIN`/`MAX`, `src/lib/points/strikes.ts`) server-side — the API rejects anything outside that range. This is a deliberate departure from "no on-the-spot amounts": the audit log (below) is the transparency mechanism instead of pre-publication. At **3 strikes** (`NO_SHOW_STRIKE_THRESHOLD`), `users.registrationBlocked` flips true and new pre-registration is refused (403) until a super_admin/admin resets it (`POST /api/admin/students/[id]/strikes/reset`) — narrower than who can apply strikes, since a reset erases the deterrent. A reset does **not** refund already-deducted points. Every strike and reset writes an audit log with `targetId` = the student and the actual points deducted.

---

## 7. Tie-breaking & ranking / การจัดอันดับและเสมอกัน

1. **House bonus ties** (§3.1, §3.2): every tied house receives the full bonus — ties are not split.
2. **Leaderboard display ties:** when two houses or two students have equal points, the board orders them deterministically by internal id, so the display never shuffles randomly. This ordering is **for display only** and confers no advantage.
3. The official standing is whatever `houses.points` / `users.points` holds, as built up from the logged entries in this document.

---

## 8. Disputes & corrections / การทักท้วงและแก้ไข

1. Any student or staff member may ask for the reason behind a point change. The answer is the matching `score_history` row (house) or audit-log entry (individual).
2. If an entry is wrong, it is corrected by a **new reasoned adjustment** (§5.1), citing the original entry — the history is never erased.
3. Disputes are resolved against **this document as written at the time of the activity**. If a rule was unclear, fix the wording here for next time rather than changing past scores.

---

## 9. Changing these rules / การแก้ไขกติกา

- These rules and the code must always agree. Any change to point amounts, bands, or mechanisms is made **in the same pull request** that changes the code (or vice-versa).
- Rule changes take effect **going forward only**; they are never applied retroactively to past events.
- The numbers currently encoded in code: individual award range **1–500**, milestone bonus **+2 per 100 points**, event/form bonuses set per-event via `pointsAwarded`.

---

*Last aligned with code: `src/modules/events/scanner.service.ts` (MAX_SCORE_AWARD = 500, milestone ×2 per 100) and `src/lib/points/award-points.ts` (event-winner & form-contest bonuses).*
