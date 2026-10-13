# Learning and Exams: v1 behavioural spec (for the Next.js v2 rebuild)

Source of truth: the v1 PHP and JS listed below, read on 2026-10-13. Nothing under the repo was modified. No personal data values are recorded here; only field names, counts and ids.

Sources read in full:
- API: api/courses/{_lib,courses,phases,lessons,quizzes,progress,complete-phase,page-config}.php, api/exams/{_lib,exams,attempts,reminder,report}.php
- helpers: api/helpers.php (roles, requireAuth, requireRole, requireCsrf, team path resolution, requireTeamFeature, respond envelope, genId, logActivity)
- Frontend HTML: learn.html, learn-course.html, learn-phase.html, learn-reports.html, exam.html, exam-reports.html, admin/courses.html, admin/exams.html
- Frontend JS: assets/pages/{learn,learn-course,learn-phase,learn-reports,exam,exam-reports,admin/courses,admin/exams}/*.js, plus the courses and exams blocks of assets/js/api.js
- Migration scripts: data/courses/_migrate.php, data/exams/_migrate.php
- Dependencies checked, not spec'd in depth: api/onboarding (NOT called by courses or exams code; only the frontend gates on it), api/upload.php (scope exam-images), api/email-noti/_chat_cards.php (chat card builder), api/security/CsrfProtector.php (CSRF token check)
- CSS files were skipped (no behaviour).

---

## 0. Response conventions (all endpoints)

- Envelope: `{ success: bool, message: string, data: any }`. Errors: `{ success:false, message }` with HTTP status.
- Auth: `Authorization: Bearer <JWT>`. Missing or bad token: 401 ("Unauthorized" / "Token invalid or expired").
- requireAuth also returns 403 `PASSWORD_EXPIRED` or `MUST_RESET_PASSWORD` for accounts with those states (not specific to this feature).
- Team context: from JWT `team` claim. super_admin and super_viewer may override with header `X-Admin-Team` (slug regex `^[a-z0-9_-]+$`).
- CSRF: POST, PUT, DELETE require a valid CSRF token (CsrfProtector: header X-CSRF-Token, cookie csrf_token, or form field csrf_token). GET is exempt.
- Request body: JSON; parsed with `json_decode(..., true) ?? []`.
- IDs: generated as `<prefix>_<12 hex>`. Prefixes in v1: course, phase, lesson, quiz, prog, att, exam. Question ids: admin UI client-generates `q_<random>`; server fallback `q_<12 hex>` (exams only).

---

## 1. Data model

### 1.1 Storage root (the rule)

- Team-scoped root for courses: `data/{team}/courses/`. For exams: `data/{team}/exams/`.
- `{team}` = current team context. If the context is empty, the sentinel `__no_team__` is used (never `sm`; this was an explicit fix for a cross-team leak).
- SM has no special case in this code. `data/sm/courses/` and `data/sm/exams/` are simply SM's team folders.
- Other teams use `data/<slug>/...` the same way. Courses and exams are NOT in the SM-shared-files list in helpers.php, so every team has its own catalog.
- Team features seeded with the `learning` feature create empty files: `courses/courses.json`, `courses/progress.json`, `exams/exams.json`, `exams/attempts.json`.
- Root-level `data/courses/` and `data/exams/` (no team folder) are LEGACY copies. No current code path reads them.
- `_coursesRoot()` and `_examsRoot()` resolve the team folder; `readJson`/`writeJson` are NOT used for course/exam data (they use `coursesReadJson`, `coursesWriteCourseFile`, `examsReadJson`, etc., which do flock-based writes).

### 1.2 Cross-team shared catalog

- A course or exam is shared when its index entry has `shared: true`. `owner_team` is the folder team that created it.
- Other active teams (from global `teams.json`, `active: true`) see shared entries in their lists.
- Local id wins over a shared id with the same value (the shared one is hidden for that team).
- Two teams cannot share the same id (409).
- Content location:
  - Owner's folder holds the course structure: phases, lessons, quizzes (for courses), and the question pool and events.json audit log (for exams).
  - Learner's own folder holds progress (`courses/progress.json`) and attempts (`exams/attempts.json`).
- Writes to shared content: only the owner team's admin (guard: `owner_team === current team`). Others get 403 "managed by team ...".
- Shared course prerequisites must themselves be shared (400 otherwise). Shared exam course prerequisites must be shared courses (400).

### 1.3 Per-team layout (v1 as shipped)

| Path (under data/{team}/) | Role | Authoritative? |
|---|---|---|
| courses/courses.json | course index (metadata, prerequisites, published, shared) | Yes, for course metadata |
| courses/progress.json | per learner x phase progress rows | Yes, for progress |
| courses/page-config.json | learn page UI config (accent, density, etc.) | Yes, if present; defaults used otherwise |
| courses/course_<id>/phases.json | phases of that course | Yes |
| courses/course_<id>/lessons.json | lessons of all phases in that course | Yes |
| courses/course_<id>/quizzes.json | quizzes of all phases in that course (one per phase) | Yes |
| courses/phases.json, lessons.json, quizzes.json (root, monolithic) | pre-split legacy files | NO. Ignored by code. Present in data/sm/courses (47 phases, 145 lessons, 47 quizzes) with .bak siblings. Treat as dead data. |
| exams/exams.json | exam index (metadata, config, prerequisites) — no questions | Yes, for exam metadata |
| exams/attempts.json | all attempts made by this team's learners (incl. attempts on shared exams from other teams) | Yes |
| exams/<exam_id>/questions.json | question pool for that exam | Yes |
| exams/<exam_id>/events.json | append-only audit log for the exam | Yes (for timelines) |

Folder counts in the current data (for migration planning): sm has 12 course index entries, 13 course folders (one orphan folder `course_grafana_101` is not in courses.json; two index entries are unpublished drafts). sm exams: 6 index entries, 6 exam folders, 121 attempts (120 submitted, 1 in progress). ss has progress rows only (12) and an attempts file (1 attempt). fas has 1 exam (shared) with 3 in-progress attempts.

### 1.4 Entity fields

**course (courses.json entry)**
- id (course_<12hex>), order (int, default max+1), title (required on create), subtitle, description, icon (default emoji book), cover_color (hex, default #f26419), prerequisites (course id list), published (bool, default true), is_popular (bool), shared (bool), owner_team (slug), created_at, created_by (user id)

**phase (course folder phases.json)**
- id (phase_...), course_id, order (int, default max+1), title (required), subtitle, description, icon, pass_score (int, default 70, no range check), estimated_minutes (int, default 20), created_at, created_by

**lesson (course folder lessons.json)**
- id (lesson_...), phase_id, order (int, default max+1 within phase), title (required), content_html (raw HTML string, NOT sanitized server-side), created_at, created_by

**quiz (course folder quizzes.json; one per phase)**
- id (quiz_...), phase_id, title (default "Quiz"), description, questions (array), created_at, updated_at (only set on replace)

**quiz question (inside quiz.questions)**
- id (client-generated, e.g. q_xxxxxx; server does not assign)
- type: single (default) | multi | truefalse | short
- question (text)
- choices (array of strings; absent for truefalse and short)
- answer: single = int index; multi = int[] (sorted on save); truefalse = bool; short = string or string[] (accepted answers)
- match_mode (short only): exact (default) | contains | regex
- case_sensitive (short only, bool)
- explain (text; never shown to learners in v1)
- Observed data mix: single 90, multi 27, truefalse 22, short 0 (no short questions exist in data).

**progress row (courses/progress.json)**
- id (prog_...), user_id, phase_id, status (STORED values: in_progress | passed only), score (best percent, int), last_score (latest percent), attempts (int, counts every submit and button-complete), completed_at (ISO or null), created_at, updated_at
- Computed (never stored): `unlocked` and `locked`. Stored `in_progress` is also written when the lessons endpoint opens an unlocked phase.
- Data snapshot: sm 730 rows (722 passed, 8 in_progress); ss 12 rows (all passed).

**page-config (courses/page-config.json)**
- hero_title (string), hero_subtitle (string), accent_color (#rrggbb, default #f26419), layout_density (compact | comfortable (default) | spacious), show_tab_badge (bool, default true)
- Only accent_color and layout_density are applied on the learn pages. See section 9 (hero and badge are stored but unused).

**exam (exams.json index entry)**
- id (exam_...), title (required), subtitle, description, icon (default memo emoji), cover_color, status (draft default | published | archived), preset (basic | standard | strict | custom), pass_score (int, clamped 0-100, default 70), course_prerequisites (course id list), is_popular, shared, owner_team, config (object; see section 6.4 and 7.2), created_by, created_at, updated_at
- `flags` (e.g. flags.bypass_onboarding) is READ by the frontend and returned by the list, but no v1 API writes it. Effectively unsettable.

**exam question (exams/<id>/questions.json)**
- id (q_...), type (single | multi | truefalse | short), prompt (text), choices (array), answer (same shapes as quiz), explain, category (string, for stratified pools), image (URL string from upload, optional), match_mode, case_sensitive

**exam attempt (exams/attempts.json entry)**
- id (att_...), exam_id, user_id, user_name (snapshot), question_ids (ordered snapshot of the attempt's pool, after shuffle), choice_orders (map qid -> array of original indices, for single and multi with more than 1 choice; present for all questions in the pool at start, identity order when shuffle_choices is off), answers (map qid -> value in SHUFFLED index space, saved at submit), score (final percent after penalty), raw_score (percent before penalty), penalty (points deducted), passed (bool), status (in_progress | submitted), started_at, submitted_at, auto_submitted (bool), violations {tab_switch, blur, fullscreen_exit, paste, copy}
- Data snapshot: sm attempts have `answers` and `choice_orders` as objects.

**exam event (exams/<id>/events.json, array)**
- ts, type, label (Thai), attempt_id (optional), user_id, user_name, ip, user_agent, violation_count (counted types only), data (object, free-form meta)
- Never rotated. Admin archives manually.

### 1.5 Migration scripts and dead data

- `data/courses/_migrate.php`: one-shot split of monolithic phases.json, lessons.json, quizzes.json into course_<id>/ folders. Run from CLI (preferred) or web with `?confirm=yes`.
  - Behaviour: reads courses.json, phases.json, lessons.json, quizzes.json in its own folder; creates a folder for every course in courses.json (even if empty); routes rows by phase -> course; orphans are skipped and counted; renames each monolithic file to `<file>.bak` (deleting an older .bak first). Does not modify courses.json.
  - Idempotent only by absence: when source files are gone it prints "Nothing to migrate".
  - Note: .htaccess only blocks `.env`. There is no rule blocking data/*.php from the web. Treat the script as web-reachable.
- `data/exams/_migrate.php`: one-shot split of inline `questions[]` out of exams.json into `<id>/questions.json`; creates `events.json` if missing; copies exams.json to exams.json.bak once; rewrites exams.json as an index. Re-run: if an exam has inline questions it overwrites questions.json (not fully idempotent).
- `.bak` files (courses and exams, in data/sm and root): not read by code. Safe to drop in the v2 import, but keep for audit if required.
- Root `data/courses/` and `data/exams/` trees: legacy, not read. Do not import.

---

## 2. Permissions

### 2.1 Roles (helpers.php)

| Constant | Roles | Used for |
|---|---|---|
| ADMIN_ROLES | super_admin, sm_admin, dev_sm | All course/exam mutations, progress reset, exam admin list, attempt admin list and reset, reminder, page-config PUT, exam-image upload |
| REPORT_READ_ROLES | ADMIN_ROLES + super_viewer | Course progress reports (scope=all, user drill-down), exam report, full exam catalog (drafts, counts) |
| GLOBAL_READ_ROLES | super_admin, super_viewer | Team switch via X-Admin-Team; All-Teams aggregation when no team context |
| (learners) | sm_user, sm_lead, dev_user, external, others | Learn and exam taking |

- requireRole: super_admin always passes; otherwise 403 "Forbidden: insufficient permissions" and a security log.
- super_viewer: read-only. requireAuth rejects every non-GET method for super_viewer with 403 (no endpoint in this feature opts out).
- requireTeamFeature (feature gate `learning`): NOT called by any courses or exams endpoint. The gate exists only in the sidebar (layout.js: `feature: 'learning'`). A team without the feature can still call the API. Teams with `learning` today: sm, ss, ts, fas, im, cmt, smart, wealth, jenkins, sojenkins. Team `dev` has none.

### 2.2 Who can do what

| Capability | Who | Notes |
|---|---|---|
| List courses | Any authenticated user | Non-admin: published only. Admin: all (incl. drafts). Plus shared courses from other teams (published-only applies). |
| Open a course by id | Any authenticated user | No published check in v1 (see section 9). |
| List phases | Any authenticated user | With course_id: non-admin gets 403 if course is locked. No published check. |
| Open lesson content | Any authenticated user | Phase lock and course lock enforced for non-admin. |
| Open quiz (for taking) | Any authenticated user | Answers stripped for non-admin. |
| Submit quiz | Any authenticated user | Course lock skipped for admin; phase lock applies to admin too (inconsistent). |
| Complete a quiz-less phase | Any authenticated user | Course lock and phase lock skipped for admin. |
| View own progress | Any authenticated user | scope=me |
| View all users' progress | REPORT_READ_ROLES | Lists team members (all teams in All-Teams mode). Includes email field (see 9). |
| Reset progress | ADMIN_ROLES | Per user or scope=all, optionally per course. |
| Edit page config | ADMIN_ROLES | Validates accent and density silently. |
| Create/edit/delete courses, phases, lessons, quizzes | ADMIN_ROLES and owner team (for shared) | Non-owner gets 403. |
| List exams | Any authenticated user (published only); REPORT_READ_ROLES see all + counts | Non-admin list omits drafts. |
| Open exam (for taking) | Any authenticated user; published only | Admin sees full row including questions. |
| Start exam attempt | Any authenticated user for published exams; admins may start drafts | Course prerequisite lock applies to everyone, admins included. Window and attempt limit: admins bypass window only. |
| Heartbeat, event, submit | Owner of the attempt | 403 otherwise. |
| View attempt timeline | Owner or admin | Admin list of attempts: ADMIN_ROLES only. |
| Exam report | REPORT_READ_ROLES | Read-only for super_viewer. |
| Exam reminder (Google Chat) | ADMIN_ROLES | |
| Reset attempts | ADMIN_ROLES | |
| Upload question image | ADMIN_ROLES (api/upload.php, scope exam-images) | 5 MB limit, image MIME only |

### 2.3 Prerequisites (gating rules)

- Course prerequisites: a course is locked for a user until EVERY course in its `prerequisites` list is "completed". A course is completed when every one of its phases has status `passed`. A course with zero phases is never completed, so it blocks dependents forever.
- Phase prerequisite: a phase with order N is locked until the phase with order N-1 in the same course is passed. The first phase (order <= 1) is open when the course is open. If no phase with order N-1 exists (gap in ordering), the phase is treated as open.
- Exam course prerequisites: same completion rule as course prerequisites. Applies to admins too.
- Onboarding gate (frontend only, not in any API): on learn.html and exam.html, a non-admin user whose scope team is `sm` must have finished Team Onboarding (`finished_at`) or is redirected to onboarding.html. Skipped for flags.bypass_onboarding (exam) and `?skip_ob=1` (learn). Admin roles (super_admin, sm_admin, dev_sm) bypass. super_admin scope team is the view-as team.

### 2.4 Shared content and oversight

- super_viewer, no X-Admin-Team: course list merges published courses from every active team (each marked with team slug, name and color; progress fields stubbed; sorted by team then order).
- super_viewer or super_admin with no team context on progress or exam reports: All-Teams aggregation (rows badged with team).
- Owners see only their own team's attempts in exam lists and reports, unless in All-Teams mode. Learners' attempts on a shared exam stay in the learner's team file.

---

## 3. Endpoint contract

Legend: [A] = ADMIN_ROLES; [R] = REPORT_READ_ROLES; [O] = owner-team guard; [C] = requireCsrf. Activity = logActivity action names (written to activity log).

### 3.1 Courses

**GET courses.php** (any auth)
- Query: id (optional)
- List response: array of course objects, each with: all index fields, prerequisites (default []), phases_count, my_passed, my_percent (0-100 int), my_current ({id,title,order} or null), my_locked (bool), unmet_prereqs ([{id,title}]), my_status (locked | completed | in_progress | not_started). Sorted by order.
- Non-admin list: published only. Admin: all.
- Shared courses from other teams merged in (local wins).
- Single (id): annotated course; 404 "Course not found". No published filter.
- super_viewer, no team context: merged published courses from all active teams (see 2.4).

**POST courses.php** [A][C]
- Body: title (required, trimmed; 400 "Title is required"), subtitle, description, icon (default book emoji), cover_color (default #f26419), order (default max+1), prerequisites (strings, non-empty; not filtered against existing ids), published (default true), is_popular (default false), shared (default false)
- If shared: validates shared transition (409 if id collides with another team's shared id, 400 if a prerequisite is not shared).
- Side effects: writes courses.json; creates course folder with empty phases.json, lessons.json, quizzes.json; activity course_create (and course_share_enabled if shared).
- Response: created course object, message "Course created".

**PUT courses.php?id=** [A][C][O]
- 400 "Course ID required"; 403 if shared and not owner; 404 "Course not found".
- Body (all optional, applied only if key present): title, subtitle, description, icon, cover_color (trimmed), order (int), published (bool), is_popular (bool), prerequisites (array; self-reference removed), shared (bool).
- Shared transition validated only when the `shared` key is present in the body.
- Side effects: writes courses.json; activity course_update; course_share_enabled or course_share_disabled on flip.
- Response: null, message "Course updated".
- Note: title is NOT validated on PUT (can be emptied).

**DELETE courses.php?id=** [A][C][O]
- 400 if no id; 403 if shared and not owner; 404 if missing.
- Side effects: removes course from index; removes folder files (phases.json, lessons.json, quizzes.json) and the folder if empty; prunes progress rows whose phase_id belonged to this course. Does NOT touch other courses' or exams' prerequisite references.
- Activity course_delete. Response null, "Course deleted".

**GET phases.php[?course_id=]** (any auth)
- With course_id, non-admin: course lock check; 403 "Course locked — ต้องเรียน "..." ให้จบก่อน" (Thai: must complete X first).
- Response: array sorted by order. Each phase has all fields plus my_status (passed | in_progress | unlocked | locked), my_score (best or null), my_attempts (int), my_completed_at.
- Without course_id: all reachable phases, no lock check.

**POST phases.php** [A][C][O]
- Body: title (required, 400 "Title is required"), course_id (required, 400 "course_id is required"; NOT checked for existence), order (default max+1), subtitle, description, icon, pass_score (int, default 70, no range check), estimated_minutes (int, default 20)
- Side effects: writes into course folder (creates folder if course_id unknown; see section 9); activity course_phase_create. Response: created phase, "Phase created".

**PUT phases.php?id=** [A][C][O]
- 400 "Phase ID required"; 404 "Phase not found" if no phase with id in any reachable folder.
- Body (optional keys): title, subtitle, description, icon, course_id (strings, trimmed); order, pass_score, estimated_minutes (int).
- If course_id changes: guard on destination course too; phase moves with its lessons and quiz.
- Activity course_phase_update. Response null, "Phase updated".

**DELETE phases.php?id=** [A][C][O]
- 404 if missing; 403 for shared non-owner.
- Side effects: removes phase, all its lessons, its quiz, and progress rows for it (all users). Activity course_phase_delete. Response null, "Phase deleted".

**GET lessons.php?phase_id=** (any auth)
- 404 "Phase not found". Non-admin: course lock (403), phase lock (403 "Phase is locked").
- SIDE EFFECT: if phase status is `unlocked`, upserts progress row with status `in_progress`.
- Response: lessons of the phase sorted by order (id, phase_id, order, title, content_html, created_at, created_by).
- Without phase_id: returns ALL lessons of all reachable courses to any authenticated user (see section 9).

**POST lessons.php** [A][C][O]
- Body: phase_id (required, 400 "phase_id is required"), title (required, 400 "title is required"), order (default max+1 in phase), content_html (string; stored raw).
- 404 "Phase not found". Activity course_lesson_create. Response created lesson, "Lesson created".

**PUT lessons.php?id=** [A][C][O]
- 400 "Lesson ID required"; 404 "Lesson not found" (scans all reachable folders); 403 for non-owner (origin and destination).
- Body (optional): title (trim), content_html (raw), order (int), phase_id (moves lesson to that phase's course folder when the course differs).
- Activity course_lesson_update. Response null, "Lesson updated".

**DELETE lessons.php?id=** [A][C][O]
- Guard runs before write. Activity course_lesson_delete. Response null, "Lesson deleted".

**GET quizzes.php?phase_id=** (any auth)
- 404 "Phase not found"; 404 "Quiz not found" if phase has no quiz row.
- Non-admin: course lock 403; phase lock 403; questions returned with answer, explain, match_mode, case_sensitive removed.
- Admin: full quiz including answers.
- Without phase_id: returns ALL quizzes (with answers) from all reachable folders to any authenticated user (see section 9).

**POST quizzes.php** [A][C][O] (save)
- Body: phase_id (required, 400 "phase_id is required"), title (default "Quiz"), description, questions (must be an array, 400 "questions must be an array").
- 404 "Phase not found". Replaces the phase's quiz (one per phase) or creates it with id quiz_...
- Questions are stored as sent. No per-question validation on the server.
- Activity course_quiz_save (with count). Response saved quiz, "Quiz saved".

**POST quizzes.php?action=submit** (any auth, [C])
- Body: phase_id (required, 400), answers (object keyed by question id; 400 "answers must be an object" if not an array).
- 404 "Phase not found" or "Quiz not found for this phase". Non-admin: course lock (403). Phase lock (403 "Phase is locked") applies to all roles.
- Scoring (see section 5). percent = round(correct / total * 100).
- passed = percent >= phase.pass_score (default 70).
- best score = max(previous best, percent). attempts = previous + 1. last_score = percent.
- Status: passed -> `passed` and completed_at set; NOT passed -> `in_progress` (this overwrites a previously passed status; see section 9).
- Activity course_phase_passed or course_phase_attempt (score, attempts, titles).
- Response: score, best_score, pass_score, passed, attempts, correct_count, total_count, summary [{q_id, correct}] only (no answers, no explanations). Message "Passed!" or "Not yet — try again".

**DELETE quizzes.php?id=** [A][C][O]
- 404 "Quiz not found" if missing. Activity course_quiz_delete. Response null, "Quiz deleted".

**POST complete-phase.php** (any auth, [C])
- Body: phase_id (required, 400 "phase_id is required").
- 404 "Phase not found". Non-admin: course lock (403) and phase lock (403).
- 400 "Phase มีแบบฝึกหัด — ต้องส่งคำตอบ quiz ก่อน" if the phase has a quiz with at least one question.
- Upserts progress: status passed, score 100, last_score 100, attempts +1, completed_at now. No guard against re-completion.
- Activity course_phase_completed_by_button. Response {phase_id, status, attempts}, "จบ Phase เรียบร้อย".

**GET progress.php** (scope=me, default; any auth)
- Response: phases_total, phases_passed, percent, current_phase (first non-passed phase or null), progress (my rows), status_map {phase_id: status}.

**GET progress.php?scope=all[&course_id=]** [R]
- Response: stats {users_total, users_completed, users_in_progress, users_not_started, avg_percent}; users: array of {user_id, name, username, role, email, team, phases_total, phases_passed, percent, total_attempts (sum of attempts), last_active (max updated_at), status_bucket (no_course | not_started | completed | in_progress), courses: [{course_id, course_title, phases_passed, phases_total, percent}]}.
- Users are the team's users from users.json. All-Teams mode: every user with a team.
- Bucket rule: no phases -> no_course; zero passed and zero attempts -> not_started; all passed -> completed; else in_progress.

**GET progress.php?user_id=** [R]
- 404 "User not found" if not in the current team (any team in All-Teams mode).
- Response: user {id, name, username, role, email, team}, courses: [{course_id, course_title, course_icon, phases_total, phases_passed, percent, phases: [{phase_id, order, title, icon, pass_score, status, score, last_score, attempts, completed_at, updated_at}]}].

**DELETE progress.php?user_id=[&course_id=]** or **?scope=all[&course_id=]** [A][C]
- 400 "Provide user_id or scope=all" if neither.
- For user_id: 404 "User not found" if not in team.
- Removes matching progress rows. Activity course_progress_reset (target, course, removed). Response {removed: n}, "Reset n progress record(s)".

**GET page-config.php** (any auth) returns defaults merged with saved file.

**PUT page-config.php** [A][C]
- Fields: hero_title, hero_subtitle (trimmed strings), accent_color (applied only if matches #rrggbb, otherwise silently ignored), layout_density (applied only if compact | comfortable | spacious, otherwise ignored), show_tab_badge (bool).
- Never returns 400. Activity learn_page_config_update (keys list). Response merged config, "Saved".

### 3.2 Exams

**GET exams.php?action=preset&name=basic|standard|strict|custom** (any auth)
- 400 "Unknown preset" otherwise. Returns {preset, config}. custom returns the basic default config.

**GET exams.php** (list; any auth)
- Non-admin, non-report role: published only. Row fields: id, title, subtitle, description, icon, cover_color, status, preset, pass_score, flags, max_attempts (config.attempts.max, default 1; NOT checked against attempts.enabled), course_prerequisites, is_popular, questions_count, pool_enabled, pool_total_show, created_at, updated_at, my_course_locked, unmet_course_prereqs ([{id,title}]), my_attempts (submitted count), my_best_score, my_passed, exam_window (only if enabled).
- Report roles also get: attempts_submitted, attempts_in_progress, exam_window (always, may be null), and drafts/archived.
- The list rows do NOT include `shared` or `owner_team` (see section 9).
- All-Teams mode: every active team's catalog merged (first team wins on duplicate id).
- Shared exams from other teams merged in (local wins).

**GET exams.php?id=** (any auth)
- Admin: full exam including questions (from questions.json) and my_course_locked, unmet_course_prereqs.
- Non-admin: 403 "Exam not available" if not published. Otherwise sanitized: questions removed; config included (includes policy content); adds my_attempts, my_best_score, my_passed, questions_count, pool_enabled, pool_total_show, my_course_locked, unmet_course_prereqs.
- 404 "Exam not found".

**POST exams.php** [A][C]
- Body: title (required, 400 "title is required"), preset (basic | standard | strict | custom; other values map to custom), config (deep-merged over the preset defaults), questions (array; ids assigned as q_... if missing), status (draft | published | archived; other values -> draft), pass_score (clamped 0-100), subtitle, description, icon (default memo emoji), cover_color, is_popular, shared, course_prerequisites (strings).
- Config validation (examsValidateConfig; Thai messages): pool.total_show must be >= 0; total_show must not exceed number of questions; when stratified and total_show > 0, sum of category counts must equal total_show; time_limit.mode must be total | per_question | both; total_minutes > 0 for total or both; per_question_seconds > 0 for per_question or both; exam_window needs start and end, end after start. If anomaly_detection enabled, tab_detection is auto-enabled silently.
- Side effects: creates exams/<id>/ with questions.json and events.json; appends to exams.json (questions NOT inline); activity exam_create (exam_share_enabled if shared); events.json row exam_create.
- Response: exam (with questions), "Exam created".

**PUT exams.php?id=** [A][C][O]
- 400 "Exam ID required"; 403 for shared non-owner; 404 "Exam not found".
- Updates: title, subtitle, description, icon, cover_color, status (invalid -> draft), preset (stored as sent, not validated), pass_score (clamped), course_prerequisites (strings), is_popular, shared (transition validation when set to true).
- questions (if present): REPLACES the whole pool, ids assigned if missing.
- config (if present): rebuilt from the preset base (examsPresetConfig of current preset, custom uses basic) then merged with body config. Keys absent from the body fall back to preset defaults.
- Validation runs against current questions.json count.
- Side effects: writes questions.json (if sent) and exams.json; activity exam_update (questions_touched) and exam_share_enabled/disabled on flip; events.json row exam_update.
- Response: exam (with questions), "Exam updated". Note: title is not validated on PUT.

**DELETE exams.php?id=** [A][C][O]
- 403 for shared non-owner; 404 if missing.
- Side effects: removes index entry; removes exams/<id>/questions.json and events.json; attempts.json is NOT changed (orphaned attempts remain). Activity exam_delete. Response null, "Exam deleted".

**POST attempts.php?action=start** [C] body {exam_id}
- 400 "exam_id is required"; 404 "Exam not found"; 403 "Exam not available" (non-admin, not published).
- Course prerequisite check (403, applies to admin too): "ต้องเรียนคอร์ส ... ให้จบก่อน".
- Window check (non-admin only): 403 with reason (not yet open / closed).
- Resume: if an in_progress attempt exists, returns it. If its total time has already expired, it is auto-submitted first (silent) and a new attempt is created.
- Attempt limit (if attempts.enabled and max > 0; counts submitted attempts only): 403 "คุณทำข้อสอบครบจำนวนครั้งสูงสุดแล้ว (N ครั้ง)". Applies to admins as well.
- Cooldown (if cooldown_minutes > 0): 403 "ต้องรออีก N นาทีก่อนทำใหม่" (since last submitted_at).
- Builds the pool (section 6.2), shuffles questions if shuffle_questions, builds choice_orders.
- Side effects: appends attempt to attempts.json; activity exam_attempt_start; events.json rows attempt_start (with meta) and policy_consent (when policy enabled and require_consent).
- Response: attempt view (section 6.3), "Attempt started" or "Resumed in-progress attempt".

**GET attempts.php?id=** (owner or admin)
- 403 "Forbidden" for others; 404 "Attempt not found"; 404 "Exam missing".
- Response: attempt view (section 6.3).

**GET attempts.php?action=mine&exam_id=** (any auth)
- Own attempts for the exam, newest first: id, status, score, passed, started_at, submitted_at, auto_submitted. (No v1 page calls this; api.js only.)

**GET attempts.php?action=events&attempt_id=** (owner or admin)
- Response: attempt summary (id, exam_id, user_id, user_name, status, score, passed, started_at, submitted_at, auto_submitted, violations) and events (filtered by attempt_id from the exam's events.json, oldest first), total.

**GET attempts.php?exam_id=** [A] (admin list)
- Rows: id, user_id, user_name, status, score, passed, started_at, submitted_at, auto_submitted, violations, question_count. Newest first.

**POST attempts.php?action=event** [C] body {attempt_id, type, meta}
- 400 "attempt_id & type required"; 400 "Unknown event type" (allowed: tab_switch, blur, focus, fullscreen_exit, paste, copy, devtools, rejoin, answer_change, flag, unflag, view_question, time_warning, question_skipped).
- 404 "Attempt not found"; 403 "Forbidden" if not owner; 400 "Attempt already submitted" if not in_progress.
- Counted types (tab_switch, blur, fullscreen_exit, paste, copy) increment violations[type].
- Side effects: writes attempts.json (counted types only); appends events row (label in Thai, violation_count for counted types, data = meta).
- Response {violations}.

**POST attempts.php?action=heartbeat** [C] body {attempt_id}
- Ownership and status checks as above; if not in_progress: {expired:false, status}.
- If time limit applies (total or both): remaining = started_at + total_minutes - now. If 0, auto-submits (section 6.5) and returns {expired:true, remaining:0}. Else {expired:false, remaining}.
- Does NOT check the exam window or per-question timers.

**POST attempts.php?action=submit** [C] body {attempt_id, answers (object), auto (bool)}
- 400 "attempt_id required"; 404; 403; 400 "Attempt already submitted"; 404 "Exam missing".
- Scoring (section 6.5). Penalty (section 6.5). passed = final score >= exam.pass_score.
- No check of deadline or window. No check that answers refer to pool questions.
- Writes: answers (as sent), score (final), raw_score, penalty, passed, status submitted, submitted_at, auto_submitted (the client-supplied `auto` flag).
- Activity exam_attempt_passed or exam_attempt_failed (score, auto, penalty); events.json row attempt_submit or attempt_auto_submit (score, raw_score, penalty, passed, pass_score, duration_sec, correct_count, total_count, violations).
- Response depends on show_results.mode (section 6.6).

**DELETE attempts.php** [A][C]
- One of: ?id= (one attempt), ?exam_id= (all for exam), ?exam_id=&user_id= , ?user_id=. 400 "Provide id, exam_id or user_id" if none.
- Removes matching attempts.json rows. events.json is NOT changed.
- Activity exam_attempts_reset (plus events.json row admin_reset when exam_id is given). Response {removed}, "Reset n attempt(s)".
- The 400 check runs inside the loop, so with an empty attempts file no error is returned.

**POST reminder.php?action=send** [A][C] (and GET ?action=preview, [A])
- Preview (GET): query exam_id (400 "exam_id required"), target, user_ids (comma list for custom), extra_message, deadline. 404 "Exam not found". Response: card (Google Chat card JSON), resolved_names, resolved_count, eligible_count, default_webhooks (from system-settings exam_reminder_chat_webhooks), exam_url (APP_BASE_URL + /exam.html?id=...), not_attempted_list, failed_list (each {user_id, name, nickname, email, avatar_url, role}), not_attempted_count, failed_count.
- Send (POST): body exam_id (400), target (not_attempted | failed | custom; else 400), user_ids (custom only), extra_message, deadline, chat_webhook_urls (overrides defaults).
- Target resolution: section 6.7. 400 "ไม่มีผู้รับ reminder — ..." if no recipients. 400 "ยังไม่ได้ตั้งค่า Google Chat webhook — ..." if no webhook.
- Sends the card to each webhook (see section 6.7 for transport).
- Activity exam_reminder_sent (exam, target, name_count, webhook_count, sent, failed).
- Response {sent, failed, errors[], resolved_names[], webhook_count}, message "ส่ง reminder เข้า Google Chat สำเร็จ (sent/total webhook)" or the failure text.

**GET report.php?exam_id=** [R]
- 400 "exam_id required"; 404 "Exam not found" (All-Teams mode searches every team).
- Response: exam {id, title, subtitle, icon, cover_color, pass_score, questions_count, status, preset}; overview {total_attempts, submitted, in_progress, unique_users, passed, failed, pass_rate (1dp %), avg_score (1dp), median_score, min_score, max_score, avg_duration_sec, total_violations, first_attempt_at, last_attempt_at, eligible_users, not_attempted_count}; distribution (5 buckets: 0-19, 20-39, 40-59, 60-79, 80-100; submitted only); timeline (last 30 days by submitted date); leaderboard (per user: user_id, user_name, team, avatar_url, attempts, submitted_count, best_score, latest_score, best_passed, total_duration_sec, last_attempted_at, has_in_progress, violations_total, status = passed | failed | in_progress | never; sorted passed, failed, in_progress, never; then best desc); questions (per question: id, prompt (first 120 chars), category, type, asked, correct, correct_rate; hardest first; unasked last); not_attempted (eligible team users with no attempt record: user_id, name, nickname, email, avatar_url, role, team); generated_at.

### 3.3 Activity log action names (for the v2 audit trail)

course_create, course_share_enabled, course_share_disabled, course_update, course_delete, course_phase_create, course_phase_update, course_phase_delete, course_lesson_create, course_lesson_update, course_lesson_delete, course_quiz_save, course_quiz_delete, course_phase_passed, course_phase_attempt, course_phase_completed_by_button, course_progress_reset, learn_page_config_update, exam_create, exam_update, exam_delete, exam_share_enabled, exam_share_disabled, exam_attempt_start, exam_attempt_passed, exam_attempt_failed, exam_attempts_reset, exam_reminder_sent, file_upload (upload endpoint).

---

## 4. Learner flow

### 4.1 Learning hub (learn.html)

- Split chooser: left "Course" panel (orange) and right "Exam" panel (indigo). Click animates into a mode bar; hash `#learns` or `#exams` deep-links directly. Back button returns to chooser and clears hash.
- Course pane stats: total courses, completed count (`my_status = completed`), to-do count, percent. Course panel progress bar = completed/total.
- Course cards (from GET courses.php): ring showing my_percent; phase dots (first MAX 6, then "+N"), each passed, current, or pending; header "Phase passed / total"; chips: Done (completed), New (created within 30 days), Popular ribbon, SM ribbon (if featured), "Phase N" (in progress), "not started", Reference, Locked (prereqs unmet, shows which titles). Locked cards are not clickable and show a toast.
- Team Onboarding tile: SM members see a synthetic course tile (front-end only) pointing at onboarding.html; SM-scoped admins see a "Reference" version.
- Exam pane stats: total exams, passed count, percent passed. Urgent pill shown if an exam with a window ends within 7 days and is not passed.
- Exam cards: ring shows best % (or pass threshold when passed); attempt dots (pass slot, failed "x", current, pending) up to max_attempts (or current+1 / 3 when unlimited); chips: question count (shows "N ข้อ (สุ่ม)" when pool total_show is less than the total), "pass N%" (or "no threshold"), exhausted ("หมดสิทธิ์"), last attempt warning ("เหลือครั้งสุดท้าย"), "attempted N times", "not attempted", upcoming, Locked (course prereq). Window notes: upcoming (opens date), open (closes date), closed.
- Clicking an open exam opens exam.html in a popup window sized to screen (falls back to same tab if popups are blocked).
- Refresh: on bfcache restore (pageshow persisted) and when the tab becomes visible again after more than 60 seconds.

### 4.2 Course page (learn-course.html?id=)

- Loads course (annotated) and phases in parallel.
- If course is locked: toast listing unmet course titles and redirect to learn.html after 1.2 seconds.
- Hero: title, description, icon, progress percent, passed / total phases, progress bar with shimmer when partly done.
- Phase timeline: each node shows order, cleaned title (leading "Phase N -" stripped), status pill (locked "ล็อก", unlocked "เริ่มได้", in progress "กำลังเรียน", passed "ผ่านแล้ว"), best score chip (my_score), attempts count, subtitle, estimated minutes, pass threshold. Locked nodes are not links.
- Empty course: "คอร์สนี้ยังไม่มี phase".

### 4.3 Phase page (learn-phase.html?id=)

- Loads all phases to find the course, then course phases, lessons, course (accent colour), and a quiz probe (`has quiz` means a quiz with at least one question).
- If phase status is `locked`: toast and redirect back to course page.
- Header: "Phase N — title", status badge (unlocked "เริ่มได้", in progress, passed with best score).
- Lessons: left nav list of lesson titles (scroll-spy highlights the one in view) plus right column of lesson sections (eyebrow "บทเรียนที่ N", title, body rendered from content_html as raw HTML). No lessons: message that the phase has no content and the quiz can be taken.
- Sidebar CTA:
  - Phase has quiz: "ทำแบบฝึกหัด" (or "ทำแบบฝึกหัดอีกครั้ง" when already passed).
  - Phase has no quiz, not passed: "จบเนื้อหา Phase นี้" (confirm dialog) -> complete-phase -> success toast -> go to next phase (by order in course) or back to course page after 900 ms.
  - Phase has no quiz, passed: disabled "จบ Phase นี้แล้ว".

### 4.4 Quiz (in-phase view)

- Questions render in server order (no shuffle), choices in stored order.
  - single: radio buttons; multi: checkboxes ("เลือกหลายข้อ"); truefalse: two radios with values true/false ("True (ถูก)" / "False (ผิด)"); short: textarea ("เขียนตอบ").
- Submit collects answers: missing answers counted; if any, confirm "ยังไม่ได้ตอบ N ข้อ ส่งต่อเลยไหม?" before sending.
- Result view: ring with score, banner (passed green or failed accent), status text, detail (passed: best score and correct / total; failed: pass threshold and points short), stats (score, best, correct x/y, attempts), per-question summary list showing only check or cross and "ข้อ N" (no question correct answers and no explanations).
- Failed: tip "คะแนนสูงสุดจะถูกบันทึกไว้"; "ลองทำใหม่" button (re-fetches quiz, unlimited).
- Passed: "Next phase" button if one exists.

### 4.5 Progress and unlocking

- Phase status is recomputed on every request. Unlocking follows section 2.3.
- Course "completed" (for other courses' prerequisites) = every phase passed.
- Progress percent for a course = passed phases / total phases.
- Learner's team progress file holds rows even for courses shared from another team.

### 4.6 Page config effect

- accent_color: overrides --accent and derived colours on learn, learn-course, learn-phase, exam pages.
- layout_density: adds body class compact or spacious on learn.html.
- hero_title, hero_subtitle, show_tab_badge: stored and editable, NOT applied anywhere in v1 pages.

---

## 5. Quiz rules (courses)

- Question types: single, multi, truefalse, short (see section 1.4).
- Scoring per question (coursesScoreQuiz):
  - single: correct when user index equals answer index (unanswered = wrong).
  - multi: correct when the sorted set of user indices equals the sorted set of correct indices (exact match, no partial credit; unanswered gives an empty set).
  - truefalse: correct when (bool) user equals (bool) answer. DEFECT: unanswered is treated as false, so an unanswered question whose correct answer is false scores correct (section 9).
  - short: user string trimmed; empty = wrong. Each accepted string is tried:
    - exact: lowercased compare (unless case_sensitive).
    - contains: user contains accepted string (case rules apply).
    - regex: preg_match with the accepted string as pattern (slashes escaped, flag i unless case-sensitive). An invalid regex matches nothing.
  - Empty accepted strings are skipped.
- percent = round(correct / total_questions * 100). total_questions counts all quiz questions, not just answered ones. Zero questions gives 0.
- Pass threshold: phase.pass_score (default 70). Passed when percent >= threshold.
- Best score kept (max over attempts). last_score is the latest percent. attempts counts every submit.
- Retry: unlimited, no cooldown, no shuffle, no reveal. Learners see per-question correct flags only. explain is never returned to learners in v1.
- Admin quiz GET includes answers and explanations.
- Quiz with zero questions: complete-phase is allowed (button completion), and the quiz step is skipped in the UI.

---

## 6. Exam flow

### 6.1 Entry and start screen (exam.html)

- Opened from learn.html exam cards (popup). Loads exam (GET exams.php?id=).
- Gate checks on load: my_course_locked -> toast and redirect to learn.html#exams; onboarding gate (frontend).
- Start screen content:
  - Hero: icon, title, subtitle/description. Tier chips: TEST EXAM (if flags.bypass_onboarding), Anti-cheat (any of one-at-a-time, tab detection, watermark, lazy fetch), Strict (fullscreen, copy-paste block, anomaly), minutes (if time limit).
  - Stats: question count (or "N / total" when pool), pass threshold, time limit or unlimited, quota (remaining / max or infinity), best score (if any attempts).
  - Window banner (upcoming, open, closed) with dates.
  - Rules list (generated from config): one-at-a-time (allow back or not), tab detection (max, action), per-question tab rule (only if one-at-a-time and per_question_max set), fullscreen required, copy/paste/right-click blocked, watermark, lazy fetch text, shuffle text, result visibility text.
  - Policy card (when enabled): title, HTML content, consent checkbox (required when require_consent); Start disabled until ticked.
  - Start button: "เริ่มทำข้อสอบ" / "ทำใหม่" / "ทำใหม่อีกครั้ง" (when passed). Disabled if window closed or quota exhausted and not passed. Close button closes the popup (or hints Cmd/Ctrl+W if close is blocked).

### 6.2 Attempt pool and order

- Pool (examsBuildAttemptPool): all questions unless pool.enabled and 0 < total_show < total.
  - Stratified (pool.stratified and categories): for each category, take up to count random questions with matching category (order of categories kept).
  - Plain: random sample of total_show.
  - Note: if stratified is on with no categories, falls back to plain random.
- shuffle_questions: shuffles the pool order.
- shuffle_choices: per single or multi question with more than one choice, a random permutation is stored in choice_orders. Off gives identity order. truefalse and short have no choice order.

### 6.3 Attempt view (returned by start, resume, and GET attempt)

- id, exam_id, exam_title, pass_score, status, started_at, submitted_at.
- questions: ALL pool questions in attempt order, with choices re-ordered, and answer, explain, match_mode, case_sensitive removed (prompt, type, choices, category and image are kept).
- answers: saved answers in shuffled index space (for resume).
- violations, remaining_sec (only for total or both time modes, in_progress only), score, passed, auto_submitted.
- config (client subset): one_at_a_time, tab_detection, watermark, fullscreen_lock, disable_copy_paste, time_limit, lazy_fetch, show_results.
- Note: lazy_fetch does not reduce what is sent. All questions are sent at start.

### 6.4 Exam config (default and presets)

Default config (exams/_lib.php examsDefaultConfig):
- pool: enabled true; total_show 20; stratified false; categories []
- shuffle_questions: enabled true
- shuffle_choices: enabled true
- attempts: enabled true; max 1 (0 = unlimited); cooldown_minutes 0
- time_limit: enabled true; mode total; total_minutes 60; per_question_seconds 0
- one_at_a_time: enabled false; allow_back true
- tab_detection: enabled false; max_violations 3; action log (log | warn | penalty | force_submit); penalty_pct 10
- watermark: enabled false; opacity 0.15; text "{username} • {email}"
- exam_window: enabled false; start null; end null; synchronized false
- lazy_fetch: enabled false
- fullscreen_lock: enabled false; max_violations 2; action log
- disable_copy_paste: enabled false
- anomaly_detection: enabled false; speed_threshold_seconds 5; similarity_threshold 0.95
- show_results: mode after_submit (after_submit | after_window | never); show_answers false; show_explains false
- policy: enabled false; title (Thai default); content ""; require_consent true; consent_label (Thai default)

Presets:
- basic: default.
- standard: one_at_a_time on (allow_back true); tab_detection on (action log); watermark on; lazy_fetch on; exam_window stays off.
- strict: one_at_a_time on with allow_back false; tab_detection on with action penalty; watermark on; lazy_fetch on; fullscreen_lock on; disable_copy_paste on; anomaly_detection on.

### 6.5 Timer, auto-submit, scoring, penalty

- Timer: only for time_limit.enabled with mode total or both. Remaining computed from server started_at + total_minutes. Client counts down from remaining_sec; warn class at <= 300 s and > 60 s; danger at <= 60 s; submit(auto) at 0.
- Per-question mode: not implemented in the client timer and not enforced by the server.
- Heartbeat: every 30 s. Server returns expired when time is up; client then submits with auto.
- Auto-submit (server) happens on heartbeat expiry or on start when the old attempt has expired. It scores the saved answers, applies NO penalty, sets auto_submitted true, and logs attempt_auto_submit with reason time_expired.
- Scoring (examsScoreAttempt): for each question id in attempt order:
  - user answer is unmapped from shuffled index to original index (single: via choice order; multi: each index mapped; short and truefalse unchanged).
  - examsCheckAnswer: null answer is always wrong. single: index equality. truefalse: must be a real bool equal to answer. multi: non-empty array; exact set equality. short: trimmed non-empty string; exact, contains, or regex match against accepted list (same rules as course quiz).
  - Missing question (deleted from pool) counts as wrong but stays in the total.
  - percent = round(correct / total * 100), total = count of attempt question_ids.
- Penalty (submit only): for tab_detection and fullscreen_lock, when action is penalty and max_violations > 0 and the matching violation count exceeds max_violations, subtract penalty_pct (tab_detection uses violations.tab_switch; fullscreen_lock uses violations.fullscreen_exit). Penalties are summed, final score = max(0, percent - penalty).
- passed = final score >= exam.pass_score (pass_score 0 means any submitted attempt passes).
- Violations counted for penalty: tab_switch and fullscreen_exit only. Blur is shown and counted in the client total, but not for penalty (see section 9).

### 6.6 Result visibility (show_results)

- after_submit (default): response includes score, raw_score, penalty, pass_score, passed, auto, show_mode, summary (per question {q_id, correct}, plus correct_answer if show_answers, plus explain if show_explains), correct_count, total_count. Client shows score, pass or fail, penalty and raw if any, and per-question correct or wrong rows. The client does NOT render correct_answer or explain even when returned.
- never: response has attempt_id, pass_score, auto, show_mode, hidden true; no score, passed, penalty, raw_score or summary. Client shows "ส่งข้อสอบเรียบร้อย" and no score.
- after_window: NOT IMPLEMENTED. Response is the same as after_submit (score shown immediately). The start screen still promises a delay.

### 6.7 Monitoring and anti-cheat (client)

- Watermark: fixed overlay of 18 repeated labels from the template; placeholders {username}, {email}, {id}; opacity clamped 0 to 1; removed on result screen.
- Tab detection: listens for visibilitychange (hidden) and window blur. Debounced 800 ms (paired events collapse to one). Each event posts tab_switch or blur (counted). Displayed total = tab_switch + blur. action warn shows a 3-second toast; action force_submit submits (auto) when total > max_violations (client-side only). Other actions (log, penalty) are silent.
- Per-question tab quota (client-only; needs one_at_a_time and per_question_max): per-question switch counter; when it exceeds the quota the question is locked (answer deleted, disabled inputs, skipped marker, question_skipped event with reason tab_switch_limit), and navigation moves to the next unlocked question. Locked questions cannot be revisited.
- Fullscreen lock: requests fullscreen at start. On exit, posts fullscreen_exit; action warn shows a toast; re-requests fullscreen after 500 ms. action force_submit is NOT implemented (client does nothing extra; server only applies penalty).
- Copy/paste lock: blocks copy, cut, paste and right-click (except paste into short-answer textarea); posts copy or paste events (right-click logged as copy). Adds no-select body class.
- One at a time: body lazy class; with allow_back false the Prev button is hidden and past dots are locked; unreached questions show as blank dots and cannot be jumped to.
- Flags: flag and unflag events (client-only state; shown in nav).
- Answer change: answer_change event on each change (not counted); short answers debounced 1.5 s.
- Beforeunload prompt while the attempt is in progress.
- Question images: rendered with resolveAssetUrl; click zooms to a full-screen overlay (watermark still applies).

### 6.8 Submit and retake

- Submit: confirm dialog shows unanswered count. Posts answers and auto flag (true for timer, heartbeat or force submit).
- Retake limits: attempts.max counts submitted attempts only (in_progress does not count); 0 = unlimited. Cooldown measured from the latest submitted_at.
- An in_progress attempt is always resumed (no new attempt until submitted or expired).
- Admin reset (DELETE attempts) lets the learner start again. Reset does not delete events.

### 6.9 Reminder (reminder.php, admin)

- Eligible users: users of the current team (all teams in All-Teams mode), excluding role `external` and users with `exam_include === false`.
- not_attempted: eligible users with NO attempt record for the exam (in_progress-only users are excluded).
- failed: eligible users with at least one submitted attempt and no passed submitted attempt.
- Passed users appear in neither list.
- Targets: not_attempted, failed (uses the failed list), custom (user_ids chosen from the union of the two lists; users not in the union are ignored).
- Webhooks: request chat_webhook_urls overrides; otherwise system-settings `exam_reminder_chat_webhooks`. No webhook configured -> 400.
- Card: built by buildExamReminderChatCard (Google Chat card format: exam title, pass score chip, optional deadline chip, exam link, target label, up to 15 names with overflow count, optional admin message).
- Transport: one HTTP POST per webhook with JSON body, 10-second timeout, Content-Type JSON. SSL peer verification is DISABLED in v1 (see section 9). Failures are logged per webhook.
- Admin UI: reminder modal with three tabs (not attempted, failed, custom), target list, message and deadline fields (live preview), webhook textarea (defaults from settings), send button and result line. Opened from the report modal or the attempts modal.

---

## 7. Admin authoring

### 7.1 Courses (admin/courses.html)

Tabs: Courses, Phases, Lessons, Quiz, Progress, Page Settings.

- Courses tab: card grid with title, subtitle, Published or Draft pill, Shared pill (owner or "from <team>"), phase count, order. Edit and Delete buttons (disabled read-only "ดู" for shared courses owned by another team). Create button.
- Course modal: icon (free text; default is an HTML icon snippet in the UI), order (default count+1), title (client-required), subtitle, description, prerequisites checklist (all other courses; disabled for shared-foreign courses in pickers), cover_color (color input, default #f26419), published (select), is_popular checkbox, shared checkbox (disabled for non-owners on edit).
- Delete: confirm. Cascades to phases, lessons, quizzes and progress.
- Phases tab: course filter (defaults to first owned course); card list with order, title, subtitle, minutes, pass threshold; Add/Edit modal: course select (create picker disables foreign shared courses), icon, order, title (required), subtitle, description, pass_score (default 70), estimated minutes (default 20). Delete with confirm (cascade lessons, quiz, progress).
- Lessons tab: course select, then phase select; list (order, title, plain-text excerpt). Add/Edit modal: phase, order, title (required), rich text editor. Editor tools: bold, italic, underline, H2, H3, paragraph, bullet list, numbered list, align left/center/right, link (prompt; target _blank), table template, code block template, horizontal rule, five callout blocks (tip, warning, danger, success, note), paste as plain text. Body saved as raw innerHTML.
- Quiz tab: course select then phase select; quiz title (default "Quiz") and description. Question builder:
  - Add question (default single with 2 empty choices, answer 0).
  - Type select: single (radio marks correct; add/remove choices), multi (checkbox marks correct), truefalse (select true or false), short (list of accepted answers with add/remove, match mode select exact | contains | regex, case-sensitive checkbox).
  - Question text, explain (not shown to learners).
  - Remove question. Save replaces the whole quiz (empty list allowed).
- Progress tab: course filter (all or one), stats tiles (team learners, completed, in progress, not started, average), table (name, username, role, percent bar, passed / total, attempts, status, last active, detail, reset). Export CSV. Reset all (confirm). Per-user reset (confirm). Detail modal shows per-course percent and phase pills with status, score and attempts.
- Page Settings tab: hero title (max 80), hero subtitle (max 200), accent (color picker and hex field, validated), layout density (compact | comfortable | spacious), show tab badge checkbox. Live preview card. Save.

### 7.2 Exams (admin/exams.html)

- Page: stat tiles (total, published, drafts, submissions), grid of exam cards (icon, title, subtitle or description, status pill, shared pill, preset pill, question count, pass %, submitted count, active count). Actions: Edit (disabled "ดู" for non-owner shared), Attempts (ผลสอบ), Report, Delete (owner only).
- Editor modal, three tabs:

Info tab:
- title (required, client and server), subtitle, description, icon (default memo emoji), cover color, pass_score (0-100, default 70; empty sends 0), status (draft, published, archived), popular checkbox, shared checkbox (owner only).

Security and Config tab:
- Preset chips: basic, standard, strict, custom. Choosing a preset loads its config from the server. Editing any control switches to custom.
- Tier 1 (Foundation):
  - Question pool: enabled; total_show (0 = all); stratified (no | yes) with category rows (name and count; sum must equal total_show when stratified and total_show > 0).
  - Shuffle questions (on/off). Shuffle choices (on/off).
  - Attempt limit: enabled; max attempts (0 = unlimited); cooldown minutes.
  - Time limit: enabled; mode (total | per_question | both); total minutes; per-question seconds.
- Policy and Consent: enabled; title; content (HTML, rendered raw to learners); require consent (yes/no); consent label.
- Tier 2 (Deterrents):
  - One at a time: enabled; allow back (yes/no).
  - Tab detection: enabled; max violations (0 = log only); action (log | warn | penalty | force_submit); penalty percent; per-question max switches (client-only). Live preview text describes the effect, including warning when per-question is set without one-at-a-time.
  - Watermark: enabled; opacity (0-1); text template.
  - Exam window: enabled; start and end (datetime-local); synchronized (yes/no) (stored, NOT enforced).
  - Lazy fetch: enabled (cosmetic).
  - Course prerequisites: checklist of courses; ids that no longer exist show as a warning row (untick to remove).
- Tier 3 (Strict):
  - Fullscreen lock: enabled; allowed exits (max); action (log | warn | penalty | force_submit; force_submit not implemented).
  - Disable copy/paste/right-click: enabled.
  - Anomaly detection: enabled; speed threshold seconds; similarity threshold (stored, not implemented).
- Result visibility: mode (after_submit | after_window | never; after_window not implemented), show answers (yes/no; returned by API, not rendered), show explanations (yes/no; returned by API, not rendered).

Questions tab:
- Add question buttons: single, multi, truefalse, short.
- Per question card: type select (changing keeps prompt, category and explain; choices carried over when sensible), category text (used by stratified pool), prompt textarea, image upload (JPG, PNG, GIF, WEBP, max 5 MB, uploaded with scope exam-images, admin only) with remove, answer area (see below), explain field.
- Answer area: single and multi: list of choices with correct marker (radio for single, checkbox for multi), letter label, text, remove, add choice. truefalse: two radios. short: one text field for accepted answers separated by pipe characters, match mode (exact, contains, regex), case-sensitive (yes/no).
- Save: client requires title and at least one question. Sends config (read from UI), questions, pass score, status, preset, popular, shared, course prerequisites. Server validation messages shown as toast.

- Attempts modal ("ผลสอบ"):
  - Overview: eligible users, users who attempted, not-attempted users, in-progress count, pass rate, average.
  - Filters: all attempts, passed, failed, in progress, not attempted (lists not-attempted users with a Reminder button).
  - Attempt cards: avatar initials, name, started, submitted, duration, auto-submitted tag, score or dash, status tag, violation chips (tab switch, blur, fullscreen exit, copy, paste). Timeline toggle (inline list of events with labels, times and data summary) and expand to full-screen timeline with summary chips by category. Delete attempt (confirm). Reset all attempts for the exam (confirm).
- Report modal (same data as report.php): hero, KPI tiles (users, pass, fail, average with median and max, average duration, in progress, violations), score distribution bars, 30-day activity sparkline, leaderboard table (rank, name, attempts, best, latest, time, violations, status), question analytics (hardest first, correct rate bars), not-attempted chips with reminder button. Actions: Reminder, CSV, Print, Copy summary (Markdown).

- Delete exam: confirm. Dialog text says learners' attempts are deleted with the exam; in v1 they are NOT (section 9).

---

## 8. Reports

### 8.1 Course progress (learn-reports.html; super_viewer and super_admin in the page guard; API allows REPORT_READ_ROLES)

- Source: GET progress.php?scope=all[&course_id=]; drill-down GET progress.php?user_id=.
- Filters: course select (all or one). Team pills in All-Teams mode (team colours from sessionStorage).
- Tiles: users total, completed (all phases passed), in progress, not started, average percent.
- Table: name and username, team, role, percent bar, passed / total phases, attempts total, status pill (completed, in progress, not started, no course), last active. Detail modal: per course percent and phase pills (status, score, attempts).
- Export CSV: name, username, team, role, percent, phases_passed, phases_total, attempts, status, last_active.

### 8.2 Exam reports (exam-reports.html; same page guard)

- Source: GET exams.php (list, report roles see drafts and counts) and GET report.php?exam_id=.
- Exam cards: icon, title, subtitle, status pill, question count, pass %, submitted count, in-progress count (owner team pill never renders; see section 9). Search by title or subtitle.
- Report modal: same layout as the admin report modal, read-only (no reminder, no reset). Actions: CSV, Print, Copy summary (Markdown).

### 8.3 Metric definitions

- Course: percent = passed phases / total phases (per user, per course, and overall in the progress report). status bucket per section 3.2.
- Exam: pass rate = passed submitted / submitted (1 decimal). average and median over submitted scores (final, post-penalty). distribution over submitted scores in five buckets. duration = submitted_at minus started_at (submitted only, positive only). violations = sum of all violation counters.
- Question analytics: asked = submitted attempts that included the question; correct = re-scored with the same checker after unmapping the answer. correct_rate = correct / asked (1 decimal). Ordered hardest first.

---

## 9. Unfinished, stubbed, and defective behaviour

### 9.1 TODO markers

- No TODO, FIXME, or "not implemented" comments in the reviewed files. The unfinished items are the stubs below.

### 9.2 Stubbed or not enforced (documented in UI or config but not implemented)

- anomaly_detection (enabled, speed threshold, similarity threshold): config and UI only. No detection anywhere. The similarity threshold is hidden from non-admin exam responses but nothing uses it.
- exam_window.synchronized: stored, not enforced.
- show_results.mode = after_window: not enforced. Score is returned and shown immediately. Start screen text claims a delay.
- show_results.show_answers and show_explains: API returns correct_answer and explain when enabled, but exam.js result view does not render them.
- lazy_fetch: UI says questions load one at a time; API sends all questions at start.
- one_at_a_time with allow_back false: enforced only in the browser. The server accepts answers to any question.
- time_limit mode per_question and per_question_seconds: not enforced (no client timer, no server check). Config validation accepts it.
- fullscreen_lock action force_submit: not implemented on the client. Server applies penalty only.
- exam_window: checked only at start. Not re-checked during the attempt, at heartbeat, or at submit.
- Heartbeat checks only the total time limit, and submit does not check time at all. A late submit (for example after the heartbeat stopped) is accepted and scored normally.
- Penalty counts tab_switch and fullscreen_exit only. The client's force_submit threshold counts tab_switch plus blur. Mismatch.
- Auto-submit by timer (heartbeat or start) never applies penalty, even when violation thresholds were exceeded.
- flags.bypass_onboarding: read by exam.js and the learn list, but no API accepts `flags` on create or update.
- Page config hero_title, hero_subtitle and show_tab_badge: stored and editable, not applied on any learn page.
- Exam list max_attempts reads config.attempts.max even when attempts.enabled is false. The UI then shows a quota that the server does not enforce.
- GET attempts.php?action=mine and GET progress.php?scope=me are implemented, but no v1 page calls them. There is no learner-facing attempt history screen.

### 9.3 Defects (fix in v2; do not copy)

Security and data exposure
- GET quizzes.php without phase_id returns every quiz of every reachable course with answers and explanations to any authenticated user (any role, any phase lock).
- GET lessons.php without phase_id returns the content_html of every lesson in every reachable course (including locked phases and drafts) to any authenticated user.
- GET courses.php?id=, phases.php?course_id=, lessons.php?phase_id= and quizzes.php?phase_id= do not check published on the course. Draft courses are hidden from lists only. The unfiltered phases list also includes phases of draft courses.
- Learners' emails are returned by progress.php scope=all and user drill-down, and exam report not_attempted list, to super_viewer. helpers.php has a denySuperViewer helper that is not used here. Policy check needed.
- Outbound webhook calls disable TLS peer verification (CURLOPT_SSL_VERIFYPEER off in sendGoogleChatCard). The reminder endpoint accepts arbitrary webhook URLs from the admin body (no host allow-list).
- lessons content_html and exam policy content are stored and rendered as raw HTML (XSS surface, admin-authored).
- The learning feature gate is not enforced on the API (requireTeamFeature is not called).
- The onboarding gate is frontend-only.

Logic defects
- Quiz retake regression: submitting a failed attempt on an already-passed phase sets status back to in_progress. The phase re-locks the next phase and the course can drop from completed. Best score is kept, status is not.
- Course quiz truefalse: an unanswered question whose correct answer is false is scored correct, because (bool) of a missing answer is false. Exams handle this correctly.
- Quiz submit applies the phase lock to admins (lessons and complete-phase skip it for admins). Inconsistent.
- complete-phase can be repeated indefinitely and resets score to 100 and increments attempts each time.
- phases.php POST does not check that course_id exists. An unknown id creates an orphan course folder with a phase inside it. Phases of unknown courses still show in the aggregated phases list.
- Course DELETE does not clear prerequisites referring to it (in courses or exams). A course with zero phases never counts as completed, so a dependent course or exam is locked forever. Circular prerequisites are not detected.
- Prerequisite shared-only check runs only when a PUT includes the shared key. Editing prerequisites of an already-shared course without sending shared skips validation.
- Course and exam PUT do not validate title. Exam PUT does not validate preset.
- Exam PUT rebuilds config from the preset base, so any config key not sent falls back to preset defaults (not to the stored value).
- Exam DELETE does not remove attempts.json rows (orphans). The admin UI confirm text says learners' attempts are deleted too, which is false.
- Exam list rows omit `shared` and `owner_team`. The admin list cannot show ownership: foreign shared exams show an enabled Edit button (save returns 403). The exam-reports owner pill never renders.
- Exam question replace (PUT with questions) changes the pool under in-progress attempts. Removed questions still count in the total, so they score as wrong.
- Threshold 0 means no threshold: penalty never applies, and tab detection with action force_submit and max_violations 0 never fires. The admin UI allows both combinations without a warning.
- Attempt DELETE validation runs inside the loop (no 400 on an empty file).
- Admin attempts modal reset passes a mangled title back into the reopen call (cosmetic duplicate prefix).
- Admin exam editor: short-answer answers use the pipe separator. A literal pipe in an accepted answer cannot be entered.

Shared content and cross-team
- Owner team sees only its own team's attempts in exam list and report (unless All-Teams). Learners from other teams on a shared exam are invisible to the owner.
- Learners from other teams write audit events (events.json) into the owner team's exam folder (cross-team write, by design, but undocumented in UI).

Data hygiene
- Root data/courses and data/exams trees are legacy and unread. sm still has monolithic phases.json (47), lessons.json (145), quizzes.json (47) at its courses root, unread.
- Orphan folder courses/course_grafana_101 not present in courses.json.
- Exam ea29a6faed2e in sm has no owner_team (non-shared, so harmless, but shared-catalog code would default it).
- admin/courses.html header text still says the data path is data/courses/<id>/ (actual: data/{team}/courses/).

---

## 10. Checklist (user-visible capabilities; verify v2 against each)

Learner: learning hub and courses
1. Open the learning hub and see the split chooser with Course and Exam panels and their stats.
2. Deep-link to the course or exam pane with #learns or #exams, and return to the chooser.
3. See the course grid with published courses plus shared courses from other teams (local wins on id clash).
4. Read each course card: progress ring, phase dots, passed / total, and status chips (Done, New, Popular, SM featured, Phase N, not started, reference).
5. See a locked course card with the unmet prerequisite titles, and get a toast instead of opening it.
6. See the Team Onboarding tile for SM members (front-end gate; opens onboarding).
7. Open a course page with hero, description, percent, and passed / total phases.
8. Redirect away from a locked course with a message naming the unmet courses.
9. See the phase list with locked, unlocked, in progress and passed states, best score, attempts, pass threshold and minutes.
10. Open an unlocked phase; a locked phase redirects back to the course.
11. Read lessons in order with a side nav that highlights the lesson in view.
12. See the "no content" message for a phase with no lessons.
13. Take a phase quiz: single, multi, true or false, and short-answer questions.
14. Get a confirmation when submitting with unanswered questions.
15. See quiz results: score ring, pass or fail, best score, correct count, attempts, and per-question correct or wrong rows (no answers).
16. Retry a failed quiz without limit.
17. Retake a passed quiz from the sidebar.
18. Complete a quiz-less phase with the "finish content" button (with confirmation).
19. Move on to the next phase after passing, or back to the course after the last phase.
20. Phase N+1 unlocks when phase N is passed; a course unlocks when its prerequisite courses are fully passed.
21. Apply the course cover colour as accent on course, phase and exam pages.
22. Apply the page config accent and density on the learn hub.
23. Refresh the hub after returning from another page or after a minute away from the tab.

Learner: exams
24. See exam cards: question count (or pool size), pass threshold, attempt dots, best score, and chips for status.
25. See window states on exam cards: upcoming (opens date), open (closes date), closed, and urgent when ending within 7 days.
26. See "exhausted" and "last attempt" states on exam cards.
27. See the exam chooser stats: number passed and percent passed.
28. Open an exam in a popup window (falls back to same tab).
29. See the exam start screen: hero, tier chips, stats, window banner, generated rules list.
30. Read and accept the policy and consent text before starting (start is disabled until ticked, when required).
31. Start a new attempt or resume an in-progress attempt (time continues from the original start).
32. Get a course-prerequisite block on exam start, with the unmet course names.
33. Get a window block (not yet open or closed) on exam start.
34. Get an attempt-limit block and a cooldown block with minutes remaining.
35. Answer shuffled questions with shuffled choices, including question images.
36. Zoom a question image to full screen.
37. Flag and unflag questions; see answered, flagged and current states in the nav map.
38. Use one-at-a-time navigation, with back navigation allowed or blocked.
39. See a countdown timer (warning at 5 min, danger at 1 min) and auto-submit at zero.
40. Have the attempt auto-submitted when the server sees the time expired (heartbeat or restart).
41. See the watermark overlay with name, email or id.
42. See the violation counter and get warnings or forced submit from tab or window switches.
43. Have a question locked after too many tab switches on it (per-question quota).
44. Be prompted to return to fullscreen when fullscreen is required, and have exits logged.
45. Have copy, paste and right-click blocked (paste into short answers allowed), with events logged.
46. See a leave-page warning while an attempt is open.
47. Submit with an unanswered-count confirmation.
48. See the result: score ring, pass or fail, penalty and raw score if any, correct count, per-question rows.
49. See the hidden-results message when results are set to never.

Admin: courses
50. Browse course cards with published, draft, shared and phase-count info, with edit and delete (owner only).
51. Create a course (title, icon, subtitle, description, order, colour, published, popular, prerequisites, shared).
52. Edit a course and change its prerequisites and share status.
53. Delete a course with confirmation (removes its phases, lessons, quizzes and progress).
54. Add, edit and delete phases in a chosen course (title, icon, order, subtitle, description, pass threshold, minutes), and move a phase to another course.
55. Add, edit and delete lessons in a phase (order, title, rich text).
56. Use the rich text editor: bold, italic, underline, headings, lists, alignment, link, table, code, horizontal rule, five callouts, plain-text paste.
57. Build a quiz per phase with a title, description, and any mix of single, multi, true or false and short-answer questions, each with correct answers, short-answer matching mode and case rule, and an explanation.
58. Save the quiz (replaces the whole quiz).
59. View course progress for all team learners (or all teams), filter by course, and see stats.
60. Open a learner's per-course, per-phase progress detail.
61. Reset one learner's progress (optionally for one course) and reset all progress (optionally for one course), each with confirmation.
62. Export the course progress table to CSV.
63. Edit the learn page settings (accent, density; hero and badge fields exist but do not render) with live preview.

Admin: exams
64. Browse exam cards with status, preset, question count, pass threshold, submissions and in-progress counts.
65. Create an exam: title, subtitle, description, icon, colour, pass threshold, status, popular, shared.
66. Apply a preset (basic, standard, strict) or custom settings, with preset switching to custom on edit.
67. Configure the question pool (total shown, stratified categories with count check).
68. Toggle shuffle of questions and of choices.
69. Set the attempt limit and cooldown.
70. Set the time limit (total mode is enforced; per-question mode is not).
71. Configure policy and consent (HTML text, require consent, consent label).
72. Configure one-at-a-time and back navigation.
73. Configure tab detection (max, action, penalty, per-question max) with live preview.
74. Configure the watermark (opacity and text).
75. Configure an exam window (start, end; synchronized stored only).
76. Toggle lazy fetch (cosmetic).
77. Choose course prerequisites (with warning for removed courses).
78. Configure fullscreen lock (max, action), copy and paste block, and anomaly detection (config only).
79. Configure result visibility (mode, show answers, show explanations).
80. Add questions of four types, set prompt, category, explanation and correct answers, and attach a question image (5 MB, image only).
81. Save an exam with server validation messages (title, pool size, stratified sum, time values, window dates).
82. Delete an exam (removes its questions and events; attempts remain).
83. View attempts for an exam with filters (all, passed, failed, in progress, not attempted).
84. Read attempt cards with violation chips, auto-submit tag, duration and score.
85. Open an attempt timeline inline and in a full-screen view with category counts.
86. Delete one attempt, and reset all attempts for an exam (each with confirmation).
87. Open the exam report: KPIs, score distribution, 30-day activity, leaderboard, question analytics, not-attempted list.
88. Export the exam report leaderboard to CSV, print it, and copy a Markdown summary.
89. Send an exam reminder to not-attempted users, failed users, or a custom selection, with optional message and deadline, and a Google Chat webhook override.
90. Preview the reminder card before sending.

Oversight and cross-team
91. Open the course reports page (super_viewer and super_admin): stats, table, drill-down, CSV export.
92. Open the exam reports page (super_viewer and super_admin): catalog search and read-only exam reports with CSV, print and copy.
93. Switch team context (X-Admin-Team) for super_admin and super_viewer, including the All-Teams view.
94. See published courses merged across all teams for super_viewer when no team is selected.
95. See the exam catalog and reports across all teams in All-Teams mode.
96. Share a course or exam to other teams (owner-only), with the id-clash and shared-prerequisite rules.
97. Keep learner progress and attempts in the learner's own team while viewing shared content.
98. Read-only view of shared content owned by another team (edit and delete blocked).
99. Record an audit trail for each mutation in the activity log (see 3.3).
100. Record exam reminder sends in the activity log (counts only, no names).
