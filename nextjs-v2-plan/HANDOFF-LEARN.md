# HANDOFF: Learn and Exams for SOM Portal v2

Status: rounds 1, 2 and 3 done (see below). Rounds 4 and 5 not started. Read this file, then `LEARN-EXAM-SPEC.md` (v1 behaviour, 100-item checklist in section 10).

## What exists in v1 (to rebuild)

- Learner: course list, course page, phase page with lessons, in-phase quiz, progress and unlocking by prerequisites.
- Exams: list, start screen, timed attempt with anti-cheat monitoring, scoring, results, retake limits.
- Admin: create and edit courses, phases, lessons (rich text), quizzes (single, multi, true/false, short), exams and question pools.
- Reports: course progress per user and team, exam report with leaderboard and question difficulty, reminders to Google Chat.
- Data: per team under `data/<team>/courses/` and `data/<team>/exams/`. Real data exists for `sm` (12 courses, 47 phases, 145 lessons, 6 exams, 121 attempts, 730 progress rows). Team `ss`, `fas` have some rows.
- Legacy: root `data/courses/` and `data/exams/` and the `*.bak` files are not read by v1 code. Do not import them.

## Defects in v1 that v2 must NOT copy

1. `lessons.php` without `phase_id` and `quizzes.php` without `phase_id` return all lesson content and all quizzes with answers to any signed-in user. Guard every read with the same phase and course locks as the per-phase read, and never send answers to learners.
2. A failed quiz retake overwrites `status` from `passed` to `in_progress`. Keep the best score and never un-pass a phase.
3. True/false scoring: an unanswered question counts as `false`, so it is correct when the answer is false. Unanswered must be wrong.
4. Exam `show_results.mode = after_window` is not implemented (returns immediate results). Implement it or remove the option.
5. Exam penalty for blur is shown but not applied. Decide and document.
6. Reminder sends with SSL peer verification disabled. Keep verification on.
7. Course and phase endpoints do not check that the course is published for learners.
8. No feature gate (`learning`) on any learn API. Add the gate.

## Done

- Round 1, learner read path: course list, course page, phase page with lessons. Locks per spec 2.3. Defects 1, 2 (rule level), 7 fixed. Lesson HTML sanitized (`src/learn/sanitize.ts`, no new dependency).
- Round 2, quiz and progress: quiz read without answers, quiz submit with scoring (`src/learn/quiz.ts`, defect 3 fixed), best score kept and no un-pass (`src/learn/progress.ts`, defect 2 fixed), complete button for quiz-less phases, opening an unlocked phase marks it in progress (v1 side effect kept).
- Round 3, exams learner side: `src/learn/exam-service.ts` (list, detail, start, take view, autosave, events, submit, result), `exam-logic.ts` and `exam-schema.ts` (pool, shuffle, scoring, window, timer, `show_results` incl. `after_window`, defect 4 fixed). Routes under `app/api/v1/learn/exams/`. Pages `/learn/exams`, `/learn/exams/[examId]` (start), `/learn/exams/[examId]/attempt/[attemptId]` (take and result). Course and exam cards redesigned (cover band, SVG progress ring, chips).
- Writes go through `DataAdapter.update` (one lock per file), so progress and attempts no longer lose rows under concurrent requests. Round 2's lock gap is closed.
- Start checks, in order: course prerequisites (applies to admins too), exam window (learners only), attempt limit and cooldown (count submitted attempts; applies to admins too). An open attempt is resumed, not duplicated.
- Real data: `data/<team>/exams/exams.json` and `exam_<id>/questions.json` are read in place (same paths as v1). 5 of 121 v1 attempts do not match the v2 schema (`answers` stored as an array). They are not counted, and writes carry them through untouched (`src/learn/rows.ts`). Any write to a learn file must keep unreadable rows.
- Tests: `playwright/exam.spec.ts` (10 tests, against the copy, including a UI run that saves screenshots when `SHOT_DIR` is set). The copy gets a fixture exam `exam_qa_smoke` (one attempt) and a draft `exam_qa_draft`, plus QA user `qa.exam`. Rebuild the copy before each run, because submitting uses up the one attempt.
- Known gaps in round 3:
  - Fullscreen lock and copy/paste blocking are client-side. The server records the events and applies penalty or forced submit, but cannot stop a determined learner. No watermark.
  - Per-question timer (`mode: per_question`) is client-side only. The server enforces total time.
  - Blur is recorded but never penalised (defect 5, decision pending).
  - Not built: anomaly detection, policy consent, one-at-a-time rule, exam `events.json` admin audit, shared catalog across teams.
  - Exam titles and icons in v1 data contain emoji. They are shown as stored. Only the card badge uses SVG icons.
- Round 2 notes still apply: no CSRF on POST routes, same as the rest of v2.

## Plan (one step per PR, each with Playwright tests against the data copy)

1. (done) **Read model and access.** Team-scoped storage for courses and exams with the same file layout as v1. Learner list, course, phase and lessons, with the locks in spec section 2.3 and the defects 1 and 7 fixed. Pages: `/learn`, `/learn/[courseId]`, `/learn/[courseId]/[phaseId]`.
2. (done) **Learner quiz and progress.** Quiz submit with the correct scoring (defect 3), best score kept (defect 2), complete-phase for phases without quiz, progress page.
3. (done) **Exams: learner side.** Exam list, start screen, attempt with timer, answer saving, heartbeat, submit, results with `show_results` modes (defect 4), retake limits and cooldown.
4. **Admin authoring.** Course, phase and lesson editors, quiz builder, exam builder with preset config, question pool and validation (spec section 7). Shared-content owner guard.
5. **Reports and reminders.** Course progress report, exam report (overview, distribution, leaderboard, question difficulty), reminder with Chat webhook (defect 6).

## Decisions still needed from the owner

- Fix defects 1 to 3 in v2 (recommended, done) or copy v1 behaviour.
- Anti-cheat: keep as in v1 (client-side signals) or make server-side penalties authoritative. Current: server records events and applies the configured penalty or forced submit.
- Blur penalty: recorded only (defect 5). Decide whether it should count.

## How to resume

- Branch `claude/inspiring-edison-xz9wno`. Test copy: `node playwright/fixtures/build-data-copy.mjs <data dir> <copy dir>`, then run Playwright with `DATA_DIR=<copy>`.
- Add QA users for learn in the fixture (learner, admin, another team) so the locks can be tested.
- Keep UI on the Liquid Glass classes in `src/theme/liquid.css`.
