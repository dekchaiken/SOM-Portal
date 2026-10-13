/* ══════════════════════════════════════════════════
   api.js  |  SOM-Portal API wrapper
   ══════════════════════════════════════════════════ */

// Resolve API root from the location of this script itself — works no matter
// what the deploy folder is called (centralize-som, SOM-Portal, root, etc.)
// and no matter how deep the current page is (/, /admin/, /admin/foo/).
//
// Falls back to a relative-path heuristic if the script tag can't be found
// (e.g. loaded via importmap or bundled), so it still works in dev.
const API_BASE = (() => {
  // Prefer the currently-executing script tag (guaranteed on initial sync load)
  let src = (document.currentScript && document.currentScript.src) || '';
  if (!src) {
    const el = document.querySelector('script[src*="assets/js/api.js"]');
    if (el) src = el.src;
  }
  if (src) {
    // Strip everything from "/assets/js/api.js…" onward → app root
    const m = src.match(/^(.*?)\/assets\/js\/api\.js/i);
    if (m) return m[1] + '/api';
  }
  // Fallback: derive from window.location (strip trailing filename + optional
  // /admin/ segment so both /foo.html and /admin/foo.html resolve the same).
  const path = window.location.pathname
    .replace(/\/admin\/[^\/]*$/, '')
    .replace(/\/[^\/]*\.html?$/, '')
    .replace(/\/$/, '');
  return path + '/api';
})();

const API = {
  // ── Team context for super_admin ──────────────────────────────────────────
  // When super_admin selects a team context in the admin panel, this is set
  // and injected as X-Admin-Team header so PHP uses that team's data path.
  _adminTeam: (() => {
    try { return sessionStorage.getItem('_admin_team_ctx') || null; } catch { return null; }
  })(),

  setAdminTeam(slug) {
    this._adminTeam = slug || null;
    try {
      if (slug) sessionStorage.setItem('_admin_team_ctx', slug);
      else sessionStorage.removeItem('_admin_team_ctx');
    } catch {}
  },

  getAdminTeam() { return this._adminTeam; },

  _csrfReadCookie() {
    return document.cookie.split('; ').find(r => r.startsWith('csrf_token='))?.split('=')[1] || null;
  },

  async _ensureCsrf() {
    if (this._csrfReadCookie()) return;
    const token = Auth.getToken?.();
    if (!token) return;
    try {
      await fetch(`${API_BASE}/auth/csrf.php`, { headers: { 'Authorization': `Bearer ${token}` } });
    } catch (_) { /* ignore */ }
  },

  // silent=true → 401 does NOT trigger global logout (for background polling calls)
  // signal (optional AbortSignal) → cancel the in-flight fetch. When the caller
  // aborts, this returns null (matches the shape callers already handle for
  // network errors) — the AbortError itself is swallowed so hot-path callers
  // (e.g. rapid service switching on service-performance.html) don't need to
  // add per-call try/catch just to filter this one error class.
  async request(method, path, body = null, isForm = false, silent = false, signal = null) {
    const _preTk = Auth.getToken?.();
    if (_preTk && Auth.isTokenExpired?.(_preTk)) return null;

    const token = Auth.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Inject team context header for super_admin / super_viewer (global-read roles).
    if (this._adminTeam && ['super_admin', 'super_viewer'].includes(Auth.getUser?.()?.role)) {
      headers['X-Admin-Team'] = this._adminTeam;
    }

    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await this._ensureCsrf();
      const csrfToken = this._csrfReadCookie();
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }

    const opts = { method, headers };
    if (body && !isForm) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body && isForm) {
      opts.body = body; // FormData
    }
    if (signal) opts.signal = signal;

    try {
      const res = await fetch(`${API_BASE}${path}`, opts);
      const data = await res.json();

      // Password expired or admin-forced reset: redirect to change-password page
      if (res.status === 403 && (data.code === 'PASSWORD_EXPIRED' || data.code === 'MUST_RESET_PASSWORD')) {
        if (!window.location.pathname.includes('change-password')) {
          const reason = data.code === 'PASSWORD_EXPIRED' ? 'expired' : 'admin_reset';
          // API_BASE is "…/{app-root}/api" — strip "/api" to get the app root.
          const root = API_BASE.replace(/\/api$/, '');
          window.location.href = root + '/change-password.html?reason=' + reason;
        }
        return null;
      }

      if (res.status === 401 && Auth.getToken() && !silent) {
        const _tk = Auth.getToken();
        if (!_tk || Auth.isTokenExpired?.(_tk)) {
          // Token is expired client-side too — genuine session expiry
          console.warn('[API] 401 on', method, path, '— token expired, triggering logout');
          Auth._doLogout();
        } else {
          // Token is still valid client-side but server rejected it.
          // This is a server-side config issue (e.g. JWT_SECRET mismatch after restart).
          // Do NOT force logout — the token will expire naturally via the expiry watcher.
          console.warn('[API] 401 on', method, path, '— server rejected valid token (config issue?), skipping logout');
        }
        return null;
      }

      // Log non-401 HTTP errors so admins can see them in the logs viewer.
      // Skip client-error endpoints themselves to avoid recursive logging loops.
      const isCEPath = path === '/log/client-error.php' || path === '/log/client-error-public.php';
      if (!res.ok && res.status !== 401 && !isCEPath) {
        const errMsg = data?.message || data?.error?.message || `HTTP ${res.status}`;
        ErrorLogger?.report('api_error', `${method} ${path} → ${res.status}: ${errMsg}`, {
          method, path, status: res.status,
          response: typeof data === 'object' ? data : {},
        });
      }

      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      // Caller cancelled via AbortSignal — not an actual failure. Return null so
      // callers can bail without a bogus error toast; skip ErrorLogger too.
      if (err?.name === 'AbortError') return null;
      console.error('API error:', err);
      const isCEPath = path === '/log/client-error.php' || path === '/log/client-error-public.php';
      if (!isCEPath) {
        ErrorLogger?.report('api_error', `${method} ${path} → network error: ${err.message}`, { method, path, status: 0 });
      }
      return { ok: false, status: 0, data: { message: 'Network error. Is the server running?' } };
    }
  },

  // opts.signal (optional AbortSignal) — see request() docstring.
  get: (path, opts = {}) => {
    // If token is already expired client-side, skip the request entirely.
    // Let the expiry watcher (runs every 15s) handle the graceful logout.
    const _tk = Auth.getToken?.();
    if (_tk && Auth.isTokenExpired?.(_tk)) return Promise.resolve(null);
    return API.request('GET', path, null, false, false, opts.signal || null);
  },
  post:   (path, body)     => API.request('POST',   path, body),
  put:    (path, body)     => API.request('PUT',    path, body),
  patch:  (path, body)     => API.request('PATCH',  path, body),
  delete: (path, body)     => API.request('DELETE', path, body),
  upload: (path, formData) => API.request('POST',   path, formData, true),

  // ─── Auth endpoints
  auth: {
    login:          (data)           => API.post('/auth/login.php', data),
    logout:         ()               => API.post('/auth/logout.php', {}),
    me:             ()               => API.get('/auth/me.php'),
    changePassword: (data)           => API.post('/auth/change-password.php', data),
    getProfile:     ()               => API.get('/auth/profile.php'),
    updateProfile:  (data)           => API.request('PATCH', '/auth/profile.php', data),
    myActivity:     (params = {})    => {
      const qs = new URLSearchParams(params).toString();
      return API.get(`/auth/my-activity.php${qs ? '?' + qs : ''}`);
    },
  },

  // ─── Teams (super_admin CRUD)
  // ─── About SOM Page
  aboutPage: {
    get:    ()     => API.get('/about-page/index.php'),
    update: (data) => API.request('PUT', '/about-page/index.php', data),
  },

  // ─── Dev Sub-teams
  devSubteams: {
    list:   ()           => API.get('/dev-subteams/index.php'),
    add:    (name)       => API.post('/dev-subteams/index.php', { name }),
    remove: (name)       => API.request('DELETE', `/dev-subteams/index.php?name=${encodeURIComponent(name)}`),
    save:   (list)       => API.request('PUT', '/dev-subteams/index.php', { list }),
  },

  teams: {
    list:       (teamSlug)       => API.get(teamSlug ? `/teams/index.php?team=${teamSlug}` : '/teams/index.php'),
    create:     (data)           => API.post('/teams/index.php', data),
    update:     (id, data)       => API.patch(`/teams/index.php?id=${id}`, data),
    deactivate: (id)             => API.delete(`/teams/index.php?id=${id}`),
    hardDelete: (id)             => API.delete(`/teams/index.php?id=${id}&force=true`),
  },

  // ─── My Team (team roster, filtered by schedule_include)
  myTeam: {
    list: () => API.get('/my-team/index.php'),
  },

  // ─── Users
  users: {
    list:          (teamSlug)    => API.get(teamSlug ? `/users/index.php?team=${teamSlug}` : '/users/index.php'),
    create:        (data)        => API.post('/users/index.php', data),
    update:        (id, data)    => API.request('PUT', `/users/index.php?id=${id}`, data),
    delete:        (id)          => API.request('DELETE', `/users/index.php?id=${id}`),
    resetPassword: (id)          => API.request('PATCH', `/users/index.php?id=${id}`),
    forceReset:    (id)          => API.request('PUT', `/users/index.php?id=${id}`, { must_reset_password: true }),
    resetLoginBlock: (username)  => API.post('/users/reset-login-block.php', { username }),
    avatars:       ()         => API.get('/users/avatars.php')
  },

  // ─── GenZ Team (SM-only)
  genzTeam: {
    list:   ()             => API.get('/genz-team/index.php'),
    toggle: (id, isGenz)   => API.request('PATCH', `/genz-team/index.php?id=${id}`, { is_genz: !!isGenz }),
  },

  // ─── GenZ Case Notes (SM · GenZ only)
  genzNotes: {
    list:   (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return API.get('/genz-notes/index.php' + (qs ? '?' + qs : ''));
    },
    get:    (id)          => API.get(`/genz-notes/index.php?id=${encodeURIComponent(id)}`),
    create: (data)        => API.post('/genz-notes/index.php', data),
    update: (id, data)    => API.request('PUT',    `/genz-notes/index.php?id=${encodeURIComponent(id)}`, data),
    delete: (id)          => API.request('DELETE', `/genz-notes/index.php?id=${encodeURIComponent(id)}`),
  },

  // ─── Feature Requests
  featureRequests: {
    list:    (status)               => API.get(status ? `/feature-requests/index.php?status=${status}` : '/feature-requests/index.php'),
    submit:  (data)                 => API.post('/feature-requests/index.php', data),
    // grantedPages: null = approve all default pages; { user_pages:[], admin_pages:[] } = custom selection
    resolve: (id, action, note, grantedPages) => API.patch(
      `/feature-requests/index.php?id=${id}`,
      { action, note: note || '', granted_pages: grantedPages ?? null }
    ),
  },

  // ─── Board
  board: {
    list:    (search = '', boardType = '', status = '', limit = 12, offset = 0, starred = false) => {
      const params = new URLSearchParams();
      if (search)    params.set('search', search);
      if (boardType) params.set('board_type', boardType);
      if (status)    params.set('status', status);
      if (starred)   params.set('starred', '1');
      params.set('limit',  limit);
      params.set('offset', offset);
      return API.get(`/board/index.php?${params.toString()}`);
    },
    myPosts: (authorId, limit = 5) => API.get(`/board/index.php?author_id=${encodeURIComponent(authorId)}&limit=${limit}&offset=0`),
    poll:       (since)     => API.get(`/board/index.php?since=${encodeURIComponent(since)}`),
    create:     (data)      => API.post('/board/index.php', data),
    update:     (id, data)  => API.request('PUT', `/board/index.php?id=${id}`, data),
    pin:        (id)        => API.request('PATCH', `/board/index.php?id=${id}`),
    delete:     (id)        => API.request('DELETE', `/board/index.php?id=${id}`),
    upload:     (fd)        => API.upload('/upload.php', fd),
    // Trash (admin/lead)
    trash:      (entity = 'post') => API.get(`/board/trash.php?entity=${entity}`),
    restore:    (id, entity = 'post') => API.post(`/board/trash.php?action=restore&id=${id}&entity=${entity}`, {}),
    hardDelete: (id, entity = 'post') => API.request('DELETE', `/board/trash.php?id=${id}&entity=${entity}`),
    purgeTrash: ()          => API.request('DELETE', '/board/trash.php?purge=1'),
  },

  // ─── Board Config (categories/tabs + service types)
  boardConfig: {
    get:              ()               => API.get('/board-config/index.php'),
    addCategory:      (data)           => API.post('/board-config/index.php?kind=category', data),
    addServiceType:   (data)           => API.post('/board-config/index.php?kind=service_type', data),
    addSubtype:       (parentId, data) => API.post(`/board-config/index.php?kind=subtype&parent=${parentId}`, data),
    rename:           (id, data)       => API.request('PUT', `/board-config/index.php?id=${id}`, data),
    delete:           (id)             => API.request('DELETE', `/board-config/index.php?id=${id}`)
  },

  // ─── Templates
  templates: {
    list:   ()          => API.get('/templates/index.php'),
    create: (data)      => API.post('/templates/index.php', data),
    update: (id, data)  => API.request('PUT', `/templates/index.php?id=${id}`, data),
    delete: (id)        => API.request('DELETE', `/templates/index.php?id=${id}`)
  },

  // ─── Courses (learning path / training)
  courses: {
    // Courses
    listCourses:  ()                  => API.get('/courses/courses.php'),
    getCourse:    (id)                => API.get(`/courses/courses.php?id=${encodeURIComponent(id)}`),
    createCourse: (data)              => API.post('/courses/courses.php', data),
    updateCourse: (id, data)          => API.request('PUT',    `/courses/courses.php?id=${id}`, data),
    deleteCourse: (id)                => API.request('DELETE', `/courses/courses.php?id=${id}`),

    // Phases
    listPhases:   (courseId)          => API.get(`/courses/phases.php${courseId ? '?course_id=' + encodeURIComponent(courseId) : ''}`),
    createPhase:  (data)              => API.post('/courses/phases.php', data),
    updatePhase:  (id, data)          => API.request('PUT',    `/courses/phases.php?id=${id}`, data),
    deletePhase:  (id)                => API.request('DELETE', `/courses/phases.php?id=${id}`),

    // Lessons
    listLessons:  (phaseId)           => API.get(`/courses/lessons.php${phaseId ? '?phase_id=' + encodeURIComponent(phaseId) : ''}`),
    createLesson: (data)              => API.post('/courses/lessons.php', data),
    updateLesson: (id, data)          => API.request('PUT',    `/courses/lessons.php?id=${id}`, data),
    deleteLesson: (id)                => API.request('DELETE', `/courses/lessons.php?id=${id}`),

    // Quizzes (one per phase)
    getQuiz:      (phaseId)           => API.get(`/courses/quizzes.php?phase_id=${encodeURIComponent(phaseId)}`),
    saveQuiz:     (data)              => API.post('/courses/quizzes.php', data),
    deleteQuiz:   (id)                => API.request('DELETE', `/courses/quizzes.php?id=${id}`),
    submitQuiz:   (data)              => API.post('/courses/quizzes.php?action=submit', data),

    // Mark phase complete by button (for phases without quiz)
    completePhase: (phaseId)          => API.post('/courses/complete-phase.php', { phase_id: phaseId }),

    // Progress
    myProgress:   ()                  => API.get('/courses/progress.php'),
    allProgress:  (courseId)          => API.get(`/courses/progress.php?scope=all${courseId ? '&course_id=' + encodeURIComponent(courseId) : ''}`),
    userProgress: (userId)            => API.get(`/courses/progress.php?user_id=${encodeURIComponent(userId)}`),
    resetUser:    (userId, courseId = '') => API.request('DELETE', `/courses/progress.php?user_id=${encodeURIComponent(userId)}${courseId ? '&course_id=' + encodeURIComponent(courseId) : ''}`),
    resetAll:     (courseId = '')     => API.request('DELETE', `/courses/progress.php?scope=all${courseId ? '&course_id=' + encodeURIComponent(courseId) : ''}`),

    // Learn page UI config (admin-editable)
    getPageConfig:    ()      => API.get('/courses/page-config.php'),
    updatePageConfig: (data)  => API.request('PUT', '/courses/page-config.php', data),
  },

  // ─── Onboarding (Team Onboarding portal — gate before learn)
  onboarding: {
    // Config (any authed)
    getConfig:    ()             => API.get('/onboarding/config.php'),
    saveConfig:   (data)         => API.request('PUT', '/onboarding/config.php', data),

    // My progress
    myProgress:   ()             => API.get('/onboarding/progress.php'),
    toggleTask:   (chapterId, taskId) =>
                                    API.post('/onboarding/progress.php?action=toggle_task',
                                             { chapter_id: chapterId, task_id: taskId }),
    saveNotebook: (chapterId, text)   =>
                                    API.post('/onboarding/progress.php?action=notebook',
                                             { chapter_id: chapterId, text }),
    saveQuiz:     (chapterId, questionId, text) =>
                                    API.post('/onboarding/progress.php?action=quiz',
                                             { chapter_id: chapterId, question_id: questionId, text }),
    submitExam:   (chapterId, answers) =>
                                    API.post('/onboarding/progress.php?action=exam_submit',
                                             { chapter_id: chapterId, answers }),
    finish:       ()             => API.post('/onboarding/progress.php?action=finish', {}),

    // Admin
    adminList:       ()             => API.get('/onboarding/admin.php'),
    adminDetail:     (userId)       => API.get(`/onboarding/admin.php?user_id=${encodeURIComponent(userId)}`),
    adminReset:      (userId)       => API.post(`/onboarding/admin.php?action=reset&user_id=${encodeURIComponent(userId)}`, {}),

    // PDFs
    listPdfs:     ()             => API.get('/onboarding/upload.php'),
    uploadPdf:    (formData)     => API.upload('/onboarding/upload.php', formData),
    deletePdf:    (filename)     => API.request('DELETE', `/onboarding/upload.php?filename=${encodeURIComponent(filename)}`),
  },

  // ─── Exams (annual / certification — separate from courses)
  exams: {
    // Catalog
    list:        ()         => API.get('/exams/exams.php'),
    get:         (id)       => API.get(`/exams/exams.php?id=${encodeURIComponent(id)}`),
    create:      (data)     => API.post('/exams/exams.php', data),
    update:      (id, data) => API.request('PUT',    `/exams/exams.php?id=${id}`, data),
    delete:      (id)       => API.request('DELETE', `/exams/exams.php?id=${id}`),
    preset:      (name)     => API.get(`/exams/exams.php?action=preset&name=${encodeURIComponent(name)}`),

    // Attempts (taking)
    start:       (examId)   => API.post('/exams/attempts.php?action=start',     { exam_id: examId }),
    getAttempt:  (id)       => API.get(`/exams/attempts.php?id=${encodeURIComponent(id)}`),
    myAttempts:  (examId)   => API.get(`/exams/attempts.php?action=mine&exam_id=${encodeURIComponent(examId)}`),
    submit:      (data)     => API.post('/exams/attempts.php?action=submit',    data),
    event:       (data)     => API.post('/exams/attempts.php?action=event',     data),
    heartbeat:   (id)       => API.post('/exams/attempts.php?action=heartbeat', { attempt_id: id }),

    // Admin attempts list + audit timeline
    listAttempts: (examId)   => API.get(`/exams/attempts.php?exam_id=${encodeURIComponent(examId)}`),
    attemptEvents:(attemptId)=> API.get(`/exams/attempts.php?action=events&attempt_id=${encodeURIComponent(attemptId)}`),
    resetAttempt: (id)       => API.request('DELETE', `/exams/attempts.php?id=${encodeURIComponent(id)}`),
    resetExamAttempts: (examId, userId = '') => API.request('DELETE', `/exams/attempts.php?exam_id=${encodeURIComponent(examId)}${userId ? '&user_id=' + encodeURIComponent(userId) : ''}`),

    // Admin report (aggregated stats — overview, leaderboard, question analytics)
    report:       (examId)   => API.get(`/exams/report.php?exam_id=${encodeURIComponent(examId)}`),
  },

  // ─── Achievements (gamification — courses + exams + onboarding)
  achievements: {
    me:   ()       => API.get('/achievements/index.php'),
    user: (userId) => API.get(`/achievements/index.php?user_id=${encodeURIComponent(userId)}`),
  },

  // ─── Links
  links: {
    list:   (section = '') => API.get(`/links/index.php${section ? `?section=${encodeURIComponent(section)}` : ''}`),
    create: (data)         => API.post('/links/index.php', data),
    update: (id, data)     => API.request('PUT', `/links/index.php?id=${id}`, data),
    delete: (id)           => API.request('DELETE', `/links/index.php?id=${id}`)
  },

  // ─── Service Types (tree categories — 3 levels: type > subtype > service)
  serviceTypes: {
    list:          ()                    => API.get('/service-types/index.php'),
    createType:    (data)                => API.post('/service-types/index.php', data),
    createSubtype: (parentId, data)      => API.post(`/service-types/index.php?parent=${parentId}`, data),
    createService: (subtypeId, data)     => API.post(`/service-types/index.php?parent=${subtypeId}`, data),
    rename:        (id, data)            => API.request('PUT', `/service-types/index.php?id=${id}`, data),
    updateService: (id, data)            => API.request('PUT', `/service-types/index.php?id=${id}`, data),
    delete:        (id)                  => API.request('DELETE', `/service-types/index.php?id=${id}`)
  },

  // ─── Batch Records
  batchRecords: {
    submit: (data) => API.post('/batch-records.php?action=submit', data),
    list:   ()     => API.get('/batch-records.php?action=list'),
  },

  // ─── Jira Config (categories, issue types)
  jiraConfig: {
    get:    ()          => API.get('/jira-config/index.php'),
    add:    (data)      => API.post('/jira-config/index.php', data),
    update: (id, data)  => API.request('PUT', `/jira-config/index.php?id=${id}`, data),
    delete: (id)        => API.request('DELETE', `/jira-config/index.php?id=${id}`)
  },

  // ─── Jira
  jira: {
    createTicket:  (data) => API.post('/jira/create.php', data),
    fieldOptions:  ()     => API.get('/jira/field-options.php'),
    issueTypes:    ()     => API.get('/jira/issue-types.php'),
    batchFields:   ()     => API.get('/jira/batch-fields.php'),
  },

  // ─── Jenkins Servers config (admin CRUD)
  grafanaAlerts: {
    paused: ()          => API.get('/grafana-alerts/paused.php'),
    resume: (slug, id)  => API.post('/grafana-alerts/resume.php', { slug, id }),
  },

  grafanaSources: {
    list:   ()            => API.get('/grafana-sources/index.php'),
    create: (data)        => API.post('/grafana-sources/index.php', data),
    update: (slug, data)  => API.request('PUT',    `/grafana-sources/index.php?slug=${encodeURIComponent(slug)}`, data),
    delete: (slug)        => API.request('DELETE', `/grafana-sources/index.php?slug=${encodeURIComponent(slug)}`),
    test:   (data)        => API.post('/grafana-sources/index.php?action=test', data),
  },

  // ─── Service Inventory (CSV catalog of all official services, admin-managed)
  serviceInventory: {
    list:     (q = '', runway = '') => API.get(
      `/service-inventory/index.php${(q || runway) ? '?' : ''}${q ? 'q=' + encodeURIComponent(q) : ''}${q && runway ? '&' : ''}${runway ? 'runway=' + encodeURIComponent(runway) : ''}`
    ),
    // Upload uses API.upload() so multipart FormData is built for us.
    // dryRun=true runs validation only + returns the preview counts.
    upload:   (file, dryRun = false) => {
      const fd = new FormData();
      fd.append('file', file);
      return API.upload(`/service-inventory/upload.php${dryRun ? '?dryRun=1' : ''}`, fd);
    },
    history:  ()        => API.get('/service-inventory/history.php'),
    restore:  (name)    => API.post(`/service-inventory/history.php?restore=${encodeURIComponent(name)}`, {}),
    downloadUrl:        () => `${API_BASE}/service-inventory/download.php`,
    downloadBackupUrl:  (name) => `${API_BASE}/service-inventory/history.php?download=${encodeURIComponent(name)}`,
  },

  // ─── Begin Grafana — endpoint discovery + PromQL generator (SM-only)
  beginGrafana: {
    endpoints: (service, opts = {}) => {
      const p = new URLSearchParams();
      p.set('service', service);
      if (opts.window)  p.set('window',  String(opts.window));
      if (opts.cluster) p.set('cluster', opts.cluster);
      return API.get(`/begin-grafana/endpoints.php?${p.toString()}`);
    },
    series: (service, method, uri, metric = 'rps', opts = {}) => {
      const p = new URLSearchParams();
      p.set('service', service);
      p.set('method',  method);
      p.set('uri',     uri);
      p.set('metric',  metric);
      if (opts.window)  p.set('window',  String(opts.window));
      if (opts.cluster) p.set('cluster', opts.cluster);
      return API.get(`/begin-grafana/series.php?${p.toString()}`);
    },
    promql: (service, method, uri, cluster = '') => {
      const p = new URLSearchParams();
      p.set('service', service);
      p.set('method',  method);
      p.set('uri',     uri);
      if (cluster) p.set('cluster', cluster);
      return API.get(`/begin-grafana/promql.php?${p.toString()}`);
    },
    // Custom business-counter metrics matching `<service>_*_total`
    customList: (service) => API.get(`/begin-grafana/custom-list.php?service=${encodeURIComponent(service)}`),
    customSeries: (service, metric, mode = 'success', window = 30, narrowSel = '') => {
      const p = new URLSearchParams();
      p.set('service', service);
      p.set('metric', metric);
      p.set('mode',   mode);
      p.set('window', String(window));
      if (narrowSel) p.set('narrowSel', narrowSel);
      else p.set('scoped', '0');
      return API.get(`/begin-grafana/custom-series.php?${p.toString()}`);
    },
  },

  // ─── Downstream Health — outbound (http_client) error breakdown (SM-only)
  //
  // Both breakdown() and timeseries() accept `opts.start` / `opts.end`
  // (unix seconds). When present, `range` is ignored and the query runs
  // against the absolute window — matches SP2's Custom picker semantics.
  downstreamHealth: {
    services: (q = '') => API.get(`/downstream-health/services.php${q ? '?q=' + encodeURIComponent(q) : ''}`),
    breakdown: (service, range = '1h', opts = {}) => {
      const p = new URLSearchParams();
      p.set('service', service);
      if (opts.start && opts.end) {
        p.set('start', String(opts.start));
        p.set('end',   String(opts.end));
      } else {
        p.set('range', String(range));
      }
      return API.get(`/downstream-health/breakdown.php?${p.toString()}`);
    },
    timeseries: (service, endpoint, range = '1h', opts = {}) => {
      const p = new URLSearchParams();
      p.set('service',  service);
      p.set('endpoint', endpoint);
      if (opts.start && opts.end) {
        p.set('start', String(opts.start));
        p.set('end',   String(opts.end));
      } else {
        p.set('range', String(range));
      }
      return API.get(`/downstream-health/timeseries.php?${p.toString()}`);
    },
  },

  // ─── Service Performance dashboard (CPU/MEM/Pod live from Grafana Thanos)
  servicePerformance: {
    // Search-first workflow (default): suggestions from CSV, then detail per service.
    suggest: (q = '', limit = 20) => API.get(
      `/service-performance/suggestions.php?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
    // opts: { windowMin } for relative "last N minutes", or { start, end } for
    // an absolute Unix-second range. Absolute takes precedence when both given.
    // opts.cluster (optional) pins a source that covers >1 cluster (OCP TH
    // regex "a-th2p|b-th1p") to a single cluster so pod counts don't sum.
    detail:  (service, runway = '', opts = 30) => {
      // Back-compat: previously called with a raw minutes number as the 3rd arg.
      if (typeof opts === 'number') opts = { windowMin: opts };
      const p = new URLSearchParams();
      if (runway)       p.set('runway',  runway);
      if (opts.cluster) p.set('cluster', opts.cluster);
      if (opts.start && opts.end && opts.end > opts.start) {
        p.set('start', String(opts.start));
        p.set('end',   String(opts.end));
      } else {
        p.set('window', String(opts.windowMin || 30));
      }
      return API.get(`/service-performance/detail.php?service=${encodeURIComponent(service)}&${p.toString()}`, { signal: opts.signal });
    },
    // Legacy bulk-list endpoints — kept for backward compat, not used by the
    // default search-first UI.
    list:    (runway = 'all', showAll = false) => API.get(
      `/service-performance/index.php?runway=${encodeURIComponent(runway)}${showAll ? '&showAll=1' : ''}`
    ),
    refresh: (runway = 'all') => API.post(`/service-performance/refresh.php?runway=${encodeURIComponent(runway)}`, {}),
    pods:    (runway, namespace, service) => API.get(
      `/service-performance/pods.php?runway=${encodeURIComponent(runway)}&namespace=${encodeURIComponent(namespace || '')}&service=${encodeURIComponent(service)}`
    ),
    // Dependency drill-down: per-URI breakdown of one edge (caller → target)
    // in the Dependencies graph. `kind` = "upstream" (someone-calls-us) or
    // "downstream" (we-call-someone). Returns rows with method/uri/status
    // breakdown suitable for the slide-in panel.
    depDrill: (kind, caller, target) => API.get(
      `/service-performance/dep-drill.php?kind=${encodeURIComponent(kind)}&caller=${encodeURIComponent(caller)}&target=${encodeURIComponent(target)}`
    ),
    // Lazy per-tab subsystem fetch (Hikari / Tomcat / JVM Runtime / Transaction
    // peaks / health chips). `sections` = comma-separated list, e.g.
    // 'hikari' or 'jvm,txn'. Same range semantics as detail().
    subsystems: (service, runway, sections, opts = {}) => {
      if (typeof opts === 'number') opts = { windowMin: opts };
      const p = new URLSearchParams();
      p.set('runway', runway);
      p.set('sections', sections);
      if (opts.cluster) p.set('cluster', opts.cluster);
      if (opts.start && opts.end && opts.end > opts.start) {
        p.set('start', String(opts.start));
        p.set('end',   String(opts.end));
      } else {
        p.set('window', String(opts.windowMin || 30));
      }
      return API.get(`/service-performance/subsystems.php?service=${encodeURIComponent(service)}&${p.toString()}`, { signal: opts.signal });
    },
    // Auto-detect deploy events for a service — used by the Deep Analysis
    // modal to build the deploy timeline + by chart annotations to draw a
    // 🚀 marker (vs a plain restart R marker).
    deploys: (service, windowMin = 720, cluster = '') => {
      const p = new URLSearchParams();
      p.set('service', service);
      p.set('window', String(windowMin));
      if (cluster) p.set('cluster', cluster);
      return API.get(`/service-performance/deploys.php?${p.toString()}`);
    },
  },

  // ─── Custom Alerts (per-service threshold alarms) ───────────────────
  // Rules created from the service-performance page: "CPU > 80% for 60s"
  // → Google Chat notification when threshold breached. Evaluated every
  // ~30s from any open browser tab via AlertsWatcher in noti-scheduler.js
  // (server-side mutex + throttle dedupe concurrent tabs).
  alerts: {
    list:          (service)    => API.get(`/alerts/list.php${service ? '?service=' + encodeURIComponent(service) : ''}`),
    save:          (rule)       => API.post('/alerts/save.php', rule),
    del:           (id)         => API.delete('/alerts/delete.php', { id }),
    tick:          ()           => API.post('/alerts/tick.php', {}),
    test:          (id)         => API.post('/alerts/test.php', { id }),
    preview:       (qs)         => API.get('/alerts/preview.php?' + qs),
    notifyConfig: {
      get:  ()    => API.get('/alerts/notify-config.php'),
      save: (cfg) => API.post('/alerts/notify-config.php', cfg),
    },
  },

  // Restart Analyzer — auto-diagnose why a service's pods restarted.
  // Runs the same forensic checklist a human ops engineer would (OOM /
  // crash / deploy / eviction / SIGTERM) and returns a verdict.
  restartAnalyzer: {
    // opts: { range: '1h'|'6h'|'24h'|'7d' } for preset windows, OR
    //       { start: <unix>, end: <unix> } for a custom absolute range.
    analyze: (service, opts = '1h') => {
      // Back-compat: string opts = range shortcut.
      if (typeof opts === 'string') opts = { range: opts };
      const p = new URLSearchParams();
      if (opts.start && opts.end && opts.end > opts.start) {
        p.set('start', String(opts.start));
        p.set('end',   String(opts.end));
      } else {
        p.set('range', String(opts.range || '1h'));
      }
      return API.get(`/restart-analyzer/index.php?service=${encodeURIComponent(service)}&${p.toString()}`);
    },
    // Zoom-in on ONE pod's restart moment. Returns per-pod mem/cpu curve
    // centered on `restartedAt` (unix seconds), so drill-down can show
    // exactly what that pod looked like right up to its death.
    podDetail: (pod, namespace, restartedAt, windowSec = 600) => API.get(
      `/restart-analyzer/pod-detail.php?pod=${encodeURIComponent(pod)}&namespace=${encodeURIComponent(namespace || '')}&restartedAt=${encodeURIComponent(restartedAt)}&window=${encodeURIComponent(windowSec)}`
    ),
  },

  jenkinsServers: {
    list:   ()          => API.get('/jenkins-servers/index.php'),
    create: (data)      => API.post('/jenkins-servers/index.php', data),
    update: (id, data)  => API.request('PUT', `/jenkins-servers/index.php?id=${id}`, data),
    delete: (id)        => API.request('DELETE', `/jenkins-servers/index.php?id=${id}`),
  },

  // ─── OpenSearch (SM-only log viewer + admin config)
  opensearch: {
    // Admin config CRUD (sm_admin)
    config: {
      list:    ()             => API.get('/opensearch-config/index.php'),
      create:  (data)         => API.post('/opensearch-config/index.php', data),
      update:  (id, data)     => API.request('PUT',    `/opensearch-config/index.php?id=${id}`, data),
      delete:  (id)           => API.request('DELETE', `/opensearch-config/index.php?id=${id}`),
      updateDefaults: (data)  => API.request('PATCH',  '/opensearch-config/index.php', data),
      test:    (payload)      => API.post('/opensearch-config/index.php?action=test', payload),
    },
    // Runtime proxy (any SM user)
    endpoints:  () => API.get('/opensearch-proxy/index.php?action=list-endpoints'),
    testCreds:  (data) => API.post('/opensearch-proxy/index.php?action=test-creds', data),
    // params: { endpoint_id, index_pattern?, module?, log_level?, correlation_id?, q?, range?|start+end, size?, from? }
    search:   (params) => API.post('/opensearch-proxy/index.php?action=search',   params),
    trace:    (params) => API.post('/opensearch-proxy/index.php?action=trace',    params),
    deeplink: (params) => API.post('/opensearch-proxy/index.php?action=deeplink', params),
    // Per-user credentials (stored encrypted server-side, never returned to browser)
    userCreds: {
      list:   ()              => API.get('/opensearch-user-creds/index.php'),
      save:   (data)          => API.post('/opensearch-user-creds/index.php', data),
      remove: (endpointId)    => API.request('DELETE', `/opensearch-user-creds/index.php?endpoint_id=${encodeURIComponent(endpointId)}`),
    },
    // Team-shared saved searches (all SM users see + can add)
    savedSearches: {
      list:   ()          => API.get('/opensearch-saved-searches/index.php'),
      create: (data)      => API.post('/opensearch-saved-searches/index.php', data),
      update: (id, data)  => API.request('PUT', `/opensearch-saved-searches/index.php?id=${encodeURIComponent(id)}`, data),
      remove: (id)        => API.request('DELETE', `/opensearch-saved-searches/index.php?id=${encodeURIComponent(id)}`),
    },
    // Folders that group saved searches — SM-shared, all members can CRUD
    savedFolders: {
      list:   ()          => API.get('/opensearch-saved-folders/index.php'),
      create: (data)      => API.post('/opensearch-saved-folders/index.php', data),
      update: (id, data)  => API.request('PUT', `/opensearch-saved-folders/index.php?id=${encodeURIComponent(id)}`, data),
      remove: (id)        => API.request('DELETE', `/opensearch-saved-folders/index.php?id=${encodeURIComponent(id)}`),
    },
  },

  // ─── Jenkins Proxy
  jenkins: {
    servers:   ()                       => API.get('/jenkins-proxy/index.php?list=1'),
    jobs:      (server, tree = '')      => API.get(`/jenkins-proxy/index.php?server=${encodeURIComponent(server)}&path=/api/json${tree ? '&tree=' + encodeURIComponent(tree) : ''}`),
    folder:    (server, path, tree)     => API.get(`/jenkins-proxy/index.php?server=${encodeURIComponent(server)}&path=${encodeURIComponent(path)}${tree ? '&tree=' + encodeURIComponent(tree) : ''}`),
    jobDetail: (server, jobPath, tree)  => API.get(`/jenkins-proxy/index.php?server=${encodeURIComponent(server)}&path=${encodeURIComponent(jobPath + '/api/json')}${tree ? '&tree=' + encodeURIComponent(tree) : ''}`),
    build:     (server, jobPath, params = null) => API.post(`/jenkins-proxy/index.php?action=build`, { server, path: jobPath, ...(params ? { params } : {}) }),
  },

  // ─── Sidebar Tools (external tool links)
  sidebarTools: {
    list:   ()          => API.get('/sidebar-tools/index.php'),
    create: (data)      => API.post('/sidebar-tools/index.php', data),
    update: (id, data)  => API.request('PUT', `/sidebar-tools/index.php?id=${id}`, data),
    delete: (id)        => API.request('DELETE', `/sidebar-tools/index.php?id=${id}`)
  },

  // ─── System Logs (admin only)
  logs: {
    query: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return API.get(`/log/index.php${qs ? '?' + qs : ''}`);
    },
    clientError: (data) => API.request('POST', '/log/client-error.php', data, false, true),
  },

  // ─── System Settings
  systemSettings: {
    get:  ()     => API.get('/system-settings/index.php'),
    save: (data) => API.request('PUT', '/system-settings/index.php', data),
  },

  // ─── Menu Permissions (role-based sidebar access)
  menuPermissions: {
    resolve: ()     => API.get('/menu-permissions/index.php?resolve=1'),
    get:     ()     => API.get('/menu-permissions/index.php'),
    save:    (data) => API.request('PUT', '/menu-permissions/index.php', data),
  },

  // ─── Notifications
  notifications: {
    list:       ()    => API.request('GET',    '/notifications/index.php', null, false, true),
    markRead:   (id)  => API.request('PATCH',  '/notifications/index.php', { id }),
    markAllRead:()    => API.request('PATCH',  '/notifications/index.php', { id: 'all' }),
    clear:      ()    => API.request('DELETE', '/notifications/index.php'),
  },

  // ─── Board Comments
  comments: {
    list:   (postId)  => API.get(`/board-comments/index.php?post_id=${encodeURIComponent(postId)}`),
    counts: (ids)     => API.get(`/board-comments/index.php?counts=${ids.map(encodeURIComponent).join(',')}`),
    create: (data)    => API.post('/board-comments/index.php', data),
    update: (id, data) => API.request('PATCH', `/board-comments/index.php?id=${id}`, data),
    delete: (id)      => API.request('DELETE', `/board-comments/index.php?id=${id}`),
  },

  // ─── Stars (personal bookmarks)
  stars: {
    list:   ()       => API.get('/stars/index.php'),
    star:   (postId) => API.post('/stars/index.php', { post_id: postId }),
    unstar: (postId) => API.request('DELETE', `/stars/index.php?post_id=${encodeURIComponent(postId)}`),
  },

  // ─── Presence (who's online + on which page — powers Office 3D)
  presence: {
    list:      ()     => API.get('/presence/list.php'),
    heartbeat: (page) => API.request('POST', '/presence/heartbeat.php', { page }, false, true),
  },

  // ─── Integration Health
  health: {
    check: (fresh = false) => API.get(`/health/index.php${fresh ? '?fresh=1' : ''}`),
  },

  // ─── Alert Monitor (JSM Ops alerts summary)
  alertMonitor: {
    stats:            (from, to, top = 10) => API.get(`/alert-monitor/stats.php?from=${from}&to=${to}&top=${top}`),
    state:            ()                   => API.get('/alert-monitor/state.php'),
    availableMonths:  ()                   => API.get('/alert-monitor/available-months.php'),
    compare:          (a, b)               => API.get(`/alert-monitor/compare.php?a=${a}&b=${b}`),
    sync:             (mode = '')          => API.post(`/alert-monitor/sync.php${mode ? '?' + mode : ''}`, {}),
    getConfig:        ()                   => API.get('/alert-monitor/config.php'),
    saveConfig:       (data)               => API.request('PATCH', '/alert-monitor/config.php', data),
    testJsm:          (qs = '')            => API.get(`/alert-monitor/test-jsm.php${qs ? '?' + qs : ''}`),
  },

  // ─── Global Search
  search: {
    query: (q, offset = 0) => API.get(`/search/index.php?q=${encodeURIComponent(q)}&offset=${offset}`),
  },

  // ─── Scheduled Notifications
  scheduledNoti: {
    list:     (all = false) => API.request('GET', `/scheduled-noti/index.php${all ? '?all=1' : ''}`, null, false, true),
    create:   (data)        => API.post('/scheduled-noti/index.php', data),
    update:   (id, data)    => API.request('PUT',    `/scheduled-noti/index.php?id=${id}`, data),
    delete:   (id)          => API.request('DELETE', `/scheduled-noti/index.php?id=${id}`),
    sendChat:         (id)           => API.post('/scheduled-noti/send-chat.php',          { id }),
    testChat:         (id)           => API.post('/scheduled-noti/send-chat.php',          { id, test: true }),
    sendShiftSummary: (id)           => API.post('/scheduled-noti/send-shift-summary.php', { id }),
    testShiftSummary: (id, webhook)  => API.post('/scheduled-noti/send-shift-summary.php', { id, test: true, webhook_url: webhook }),
    sendGrafanaPaused: (id)          => API.post('/scheduled-noti/send-grafana-paused.php', { id }),
    testGrafanaPaused: (id, webhook) => API.post('/scheduled-noti/send-grafana-paused.php', { id, test: true, webhook_url: webhook }),
  },

  // ─── Restart Monitor Webhooks (per-runway Google Chat noti kill-switch)
  restartMonitorWebhooks: {
    list:       ()                  => API.get('/restart-monitor-webhooks/index.php'),
    setEnabled: (slug, enabled)     => API.request('PATCH', `/restart-monitor-webhooks/index.php?slug=${encodeURIComponent(slug)}`, { enabled: !!enabled }),
  },

  // ─── Restart Monitor (per-runway daily fetch + reports)
  restartMonitor: {
    // Lightweight runway roster used by RestartFetchScheduler to fire per-runway
    // POSTs in parallel — avoids the sequential fetch.php loop that used to die
    // mid-way (leaving EKS NANO / OCP silently unfetched).
    runways:    ()                  => API.get('/restart-monitor/index.php?action=runways'),
    fetch:      (runway)            => API.post('/restart-monitor/fetch.php' + (runway ? '?runway=' + encodeURIComponent(runway) : ''), {}),
  },

  // ─── Batch Monitor Noti (Jenkins state-transition alerts to Google Chat)
  batchMonitorNoti: {
    list:   ()                     => API.get('/batch-monitor-noti/index.php'),
    save:   (serverId, data)       => API.request('PUT',    `/batch-monitor-noti/index.php?server=${encodeURIComponent(serverId)}`, data),
    delete: (serverId)             => API.request('DELETE', `/batch-monitor-noti/index.php?server=${encodeURIComponent(serverId)}`),
    test:   (serverId, url)        => API.post(`/batch-monitor-noti/index.php?action=test&server=${encodeURIComponent(serverId)}`, url ? { url } : {}),
    tick:   ()                     => API.request('POST', '/batch-monitor-noti/tick.php', {}, false, true),
  },

  // ─── PW Schedule (Planned Work — overnight shift summary)
  pwSchedule: {
    listRounds: ()          => API.get('/pw-schedule/index.php?list_rounds=1'),
    active:     ()          => API.get('/pw-schedule/index.php?active=1'),
    round:      (round)     => API.get(`/pw-schedule/index.php?round=${encodeURIComponent(round)}`),
    create:     (data)      => API.post('/pw-schedule/index.php', data),
    update:     (id, data)  => API.request('PUT',    `/pw-schedule/index.php?id=${id}`, data),
    toggle:     (id)        => API.request('PATCH',  `/pw-schedule/index.php?id=${id}&action=toggle`),
    setDone:    (id, done)  => API.request('PATCH',  `/pw-schedule/index.php?id=${id}&action=set`, { completed: !!done }),
    delete:     (id)        => API.request('DELETE', `/pw-schedule/index.php?id=${id}`),
    notify:     (round)     => API.post('/pw-schedule/notify.php', { round }),
    testNotify: (round, webhookUrl) => API.post('/pw-schedule/notify.php', { round, test: true, webhook_url: webhookUrl }),
    sync:       (round, dryRun = false) => API.post('/pw-schedule/sync.php', { round, dry_run: dryRun }),
    getConfig:  ()          => API.get('/pw-schedule-config/index.php'),
    saveConfig: (data)      => API.request('PUT', '/pw-schedule-config/index.php', data),
    // Template: build a "แจ้งเพื่อทราบ" chat message for one PW (pulls MA
    // list from the linked Jira ticket) and send arbitrary text to the
    // configured Google Chat webhook.
    buildTemplate: (itemId) => API.get(`/pw-schedule/template.php?item_id=${encodeURIComponent(itemId)}`),
    notifyText:    (msg, itemId = '') => API.post('/pw-schedule/notify-text.php', { message: msg, item_id: itemId }),
    // Teamup calendar proxy: fetches events for [start,end] window (YYYY-MM-DD).
    // Server-side cached 5min per team + window; pass force=true to bust.
    teamup: (start, end, force = false) => {
      const q = new URLSearchParams({ start, end });
      if (force) q.set('force', '1');
      return API.get(`/pw-schedule/teamup.php?${q.toString()}`);
    },
  },

  // ─── Mail Config (admin)
  mailConfig: {
    get:  ()     => API.get('/mail-config/index.php'),
    save: (data) => API.request('PUT', '/mail-config/index.php', data),
  },

  // ─── Email Templates (super_admin only, per-team overrides)
  emailTemplates: {
    get:  ()     => API.get('/email-templates/index.php'),
    save: (data) => API.request('PUT', '/email-templates/index.php', data),
  },

  // ─── Mail Send
  mail: {
    send:           (data)   => API.post('/mail/send.php', data),
    testConnection: ()       => API.post('/mail/test-connection.php', {}),
    getLogs:        (params) => API.get('/mail/logs.php?' + new URLSearchParams(params || {}).toString()),
  },

  // ─── Team Inbox (stream-socket IMAP, no ext required)
  inbox: {
    folders:     ()                => API.get('/inbox/folders.php'),
    list:        (params = {})     => {
      const qs = new URLSearchParams(params).toString();
      return API.get(`/inbox/list.php${qs ? '?' + qs : ''}`);
    },
    message:     (folder, uid)     => API.get(`/inbox/message.php?folder=${encodeURIComponent(folder)}&uid=${uid}`),
    unreadCount: ()                => API.request('GET', '/inbox/unread-count.php', null, false, true),
    flag:        (data)            => API.post('/inbox/flag.php', data),
    move:        (data)            => API.post('/inbox/move.php', data),
    send:        (data)            => API.post('/inbox/send.php', data),
  },

  // ─── Backup
  backup: {
    list:   ()     => API.get('/backup/index.php'),
    create: ()     => API.post('/backup/index.php', {}),
    delete: (file) => API.request('DELETE', `/backup/index.php?file=${encodeURIComponent(file)}`),
  },

  // ─── Team Docs (Google Sheets / Docs)
  sheets: {
    list:             (category = '') => API.get(`/sheets/index.php${category ? '?category=' + encodeURIComponent(category) : ''}`),
    create:           (data)          => API.post('/sheets/index.php', data),
    update:           (id, data)      => API.request('PUT', `/sheets/index.php?id=${id}`, data),
    delete:           (id)            => API.request('DELETE', `/sheets/index.php?id=${id}`),
    getCategories:    ()              => API.get('/sheets/index.php?categories=1'),
    addCategory:      (data)          => API.post('/sheets/index.php?kind=category', data),
    deleteCategory:   (id)            => API.request('DELETE', `/sheets/index.php?kind=category&id=${id}`),
    star:             (id)            => API.post(`/sheets/index.php?kind=star&id=${encodeURIComponent(id)}`, {}),
    unstar:           (id)            => API.request('DELETE', `/sheets/index.php?kind=star&id=${encodeURIComponent(id)}`),
  },

  // ─── SMS Gateway Switch Log
  smsGateway: {
    list:         (project)             => API.get(`/sms-gateway/index.php?project=${project}`),
    sync:         (project)             => API.post(`/sms-gateway/sync.php?project=${project}`, {}),
    syncAll:      ()                    => API.post('/sms-gateway/sync-all.php', {}),
    updateRemark: (id, project, remark) => API.request('PATCH', `/sms-gateway/index.php?id=${id}&project=${project}`, { remark }),
  },

  // ─── Firt-hop Email Config (admin)
  fhEmailConfig: {
    get:  ()     => API.get('/fh-email-config/index.php'),
    save: (data) => API.request('PUT', '/fh-email-config/index.php', data),
  },

  // ─── Maintenance Mode (admin)
  maintenance: {
    get:    ()      => API.request('GET',  '/maintenance/index.php', null, false, true),
    update: (data)  => API.request('PUT',  '/maintenance/index.php', data),
  },

  // ─── Announcements
  announcements: {
    list:   (all = false) => API.get(`/announcements/index.php${all ? '?all=1' : ''}`),
    create: (data)        => API.post('/announcements/index.php', data),
    update: (id, data)    => API.request('PUT',    `/announcements/index.php?id=${id}`, data),
    delete: (id)          => API.request('DELETE', `/announcements/index.php?id=${id}`),
  },

  // ─── Schedule (team roster)
  schedule: {
    get:      (year, month) => API.get(`/schedule/index.php?year=${year}&month=${month}`),
    setSlot:  (data)        => API.post('/schedule/index.php', data),
    clearDay: (date)        => API.request('DELETE', `/schedule/index.php?date=${encodeURIComponent(date)}`),
  },

  // ─── Holidays
  holidays: {
    list:   (year)      => API.get(`/schedule/holidays.php${year ? '?year=' + year : ''}`),
    add:    (data)      => API.post('/schedule/holidays.php', data),
    update: (id, data)  => API.request('PUT',    `/schedule/holidays.php?id=${encodeURIComponent(id)}`, data),
    delete: (id)        => API.request('DELETE', `/schedule/holidays.php?id=${encodeURIComponent(id)}`),
  },

  // ─── Leave Requests
  leave: {
    list:   (opts = {}) => {
      const params = new URLSearchParams();
      if (opts.admin) params.set('admin', '1');
      if (opts.status) params.set('status', opts.status);
      return API.get(`/schedule/leave.php${params.toString() ? '?' + params.toString() : ''}`);
    },
    submit: (data) => API.post('/schedule/leave.php', data),
    review: (id, data) => API.request('PUT', `/schedule/leave.php?id=${id}`, data),
    edit:   (id, data) => API.request('PATCH', `/schedule/leave.php?id=${id}`, data),
    cancel: (id, data) => API.request('DELETE', `/schedule/leave.php?id=${id}&cancel=true`, data),
    delete: (id) => API.request('DELETE', `/schedule/leave.php?id=${id}`),
  },

  // ─── Vacation Quotas
  vacation: {
    getQuotas: () => API.get('/schedule/vacation-quota.php'),
    getUserQuota: (userId) => API.get(`/schedule/vacation-quota.php?user_id=${encodeURIComponent(userId)}`),
    setQuotas: (data) => API.post('/schedule/vacation-quota.php', data),
  },

  // ─── User Schedule Colors
  userColors: {
    get: () => API.get('/schedule/user-colors.php'),
    set: (data) => API.post('/schedule/user-colors.php', data),
  },

  // ─── Holiday Plans
  holidayPlans: {
    get:   (year, month) => API.get(`/holiday-plans/index.php?year=${year}${month != null ? '&month=' + month : ''}`),
    save:  (data)        => API.post('/holiday-plans/index.php', data),
    clear: (year, month, userId) => API.request('DELETE', `/holiday-plans/index.php?year=${year}&month=${month}${userId ? '&user_id=' + encodeURIComponent(userId) : ''}`),
  },

  // ─── Knowledge Base
  knowledgeBase: {
    list:           ()              => API.get('/knowledge-base/list.php'),
    save:           (data)          => API.post('/knowledge-base/save.php', data),
    delete:         (data)          => API.post('/knowledge-base/delete.php', data),
    addCategory:    (data)          => API.post('/knowledge-base/add-category.php', data),
    updateCategory: (data)          => API.post('/knowledge-base/update-category.php', data),
  },

  // ─── Daily Sync-up
  syncup: {
    getRecord:    (date)       => API.get(`/syncup/index.php${date ? '?date=' + encodeURIComponent(date) : ''}`),
    getRange:     (n = 14)     => API.get(`/syncup/index.php?range=${n}`),
    getConfig:    ()           => API.get('/syncup/index.php?config=1'),
    saveConfig:   (data)       => API.request('PUT', '/syncup/index.php?config=1', data),
    deleteRecord: (date, shift)=> API.request('DELETE', `/syncup/index.php?date=${encodeURIComponent(date)}&shift=${shift}`),
    upload:       (fd)         => API.upload('/syncup/upload.php', fd),
    notify:       (shift)      => API.post('/syncup/notify.php', { shift }),
    testNotify:   (shift)      => API.post('/syncup/notify.php', { shift, test: true }),
  },

  batchMeta: {
    get:        ()         => API.get('/batch-meta/index.php'),
    create:     (data)     => API.post('/batch-meta/index.php', data),
    update:     (id, data) => API.request('PUT',    `/batch-meta/index.php?id=${id}`, data),
    delete:     (id)       => API.request('DELETE', `/batch-meta/index.php?id=${id}`),
    sync:         (id)           => API.post(`/batch-meta/index.php?action=sync&id=${id}`, {}),
    fetchSheet:   (data)         => API.post('/batch-meta/index.php?action=fetch-sheet', data),
    syncEntries:  (id, entries)  => API.post(`/batch-meta/index.php?action=sync-entries&id=${id}`, { entries }),
    upsertEntry:  (data)         => API.post('/batch-meta/index.php?action=upsert-entry', data),
  },

  batchFileIndex: {
    getCatalog:  ()                       => API.get('/batch-file-index/crawl.php'),
    crawl:       (serverId)               => API.post(`/batch-file-index/crawl.php?server=${encodeURIComponent(serverId)}`, {}),
    indexStatus:   (serverId)             => API.get(`/batch-file-index/index_logs.php?server=${encodeURIComponent(serverId)}`),
    indexProgress: (serverId)             => API.get(`/batch-file-index/index_logs.php?server=${encodeURIComponent(serverId)}&progress=1`),
    indexLogs:   (serverId, opts = {})    => {
      const qs = new URLSearchParams({ server: serverId });
      if (opts.job_path)       qs.set('job_path',       opts.job_path);
      if (opts.job_name_query) qs.set('job_name_query', opts.job_name_query);
      if (opts.dry_run)        qs.set('dry_run', '1');
      if (opts.force)          qs.set('force', '1');
      return API.post(`/batch-file-index/index_logs.php?${qs.toString()}`, {});
    },
    lookup:      (filename)               => API.post('/batch-file-index/lookup.php', { filename }),
  },

  // Manual upstream/downstream mapping for batch jobs (v2 chain view).
  // Complements Jenkins-native upstreamProjects/downstreamProjects which
  // often isn't populated because pipelines aren't chained in Jenkins config.
  batchDeps: {
    get:    ()                              => API.get('/batch-deps/index.php'),
    set:    (job, upstream, downstream, note = '') =>
      API.post('/batch-deps/index.php?action=set',    { job, upstream, downstream, note }),
    remove: (job)                           =>
      API.post('/batch-deps/index.php?action=delete', { job }),
  },

  // ─── Dev Tools (dev_sm only)
  dev: {
    stats:    ()     => API.get('/dev/'),
    readFile: (name) => API.get(`/dev/?action=file&name=${encodeURIComponent(name)}`),
  },

  // ─── Tummeng AI
  ai: {
    chat: (message) => API.post('/ai/index.php', { message }),
  },

  // ─── MA Test (Result Test MA Pages — SM only) ──────────────────────────────
  // Admin manages a Catalog of services; per-month Plans pick from catalog;
  // Users file Results (with screenshots) against plan items. See api/ma-test/.
  maTest: {
    // Catalog CRUD
    catalog: {
      list:    (params = {}) => {
        const qs = new URLSearchParams(params).toString();
        return API.get('/ma-test/catalog.php' + (qs ? '?' + qs : ''));
      },
      get:     (id)          => API.get('/ma-test/catalog.php?id=' + encodeURIComponent(id)),
      create:  (data)        => API.post('/ma-test/catalog.php', data),
      update:  (id, data)    => API.request('PUT',    `/ma-test/catalog.php?id=${encodeURIComponent(id)}`, data),
      remove:  (id, hard = false) =>
                                API.request('DELETE', `/ma-test/catalog.php?id=${encodeURIComponent(id)}${hard ? '&hard=1' : ''}`),
      importFile: (fd)       => API.upload('/ma-test/catalog-import.php', fd),
      bootstrap: ()          => API.post('/ma-test/catalog-import.php?bootstrap=1', {}),
    },
    // Monthly plans (each month = a JSON file)
    plans: {
      months:  ()             => API.get('/ma-test/plans.php?months=1'),
      list:    (month)        => API.get('/ma-test/plans.php?month=' + encodeURIComponent(month)),
      add:     (month, catalog_ids, extra = {}) =>
                                 API.post(`/ma-test/plans.php?month=${encodeURIComponent(month)}`,
                                          { catalog_ids, ...extra }),
      remove:  (month, id)    => API.request('DELETE',
                                 `/ma-test/plans.php?month=${encodeURIComponent(month)}&id=${encodeURIComponent(id)}`),
    },
    // Test results
    results: {
      list:    (month, planId = null) => {
        let u = '/ma-test/results.php?month=' + encodeURIComponent(month);
        if (planId) u += '&plan_id=' + encodeURIComponent(planId);
        return API.get(u);
      },
      create:  (month, data)  => API.post(`/ma-test/results.php?month=${encodeURIComponent(month)}`, data),
      update:  (month, id, data) =>
                                 API.request('PUT',
                                 `/ma-test/results.php?month=${encodeURIComponent(month)}&id=${encodeURIComponent(id)}`, data),
      remove:  (month, id)    => API.request('DELETE',
                                 `/ma-test/results.php?month=${encodeURIComponent(month)}&id=${encodeURIComponent(id)}`),
    },
  },
};

// ── Client-side Error Logger ──────────────────────────────────────────────────
// Captures JS exceptions, unhandled promise rejections, and API errors,
// then ships them to /api/log/client-error.php so admins can see them.
const ErrorLogger = (() => {
  let _count  = 0;
  let _resetAt = 0;
  const MAX_PER_MIN = 15;

  function _rateOk() {
    const now = Date.now();
    if (now > _resetAt) { _count = 0; _resetAt = now + 60_000; }
    return ++_count <= MAX_PER_MIN;
  }

  function _send(type, message, detail, stack) {
    if (!_rateOk()) return;
    const token     = Auth.getToken?.();
    const expired   = token && Auth.isTokenExpired?.(token);
    const anon      = !token || expired;
    // Anonymous errors go to the public endpoint (login page, expired token).
    // Public path is IP-rate-limited server-side.
    const path      = anon ? '/log/client-error-public.php' : '/log/client-error.php';
    const headers   = { 'Content-Type': 'application/json' };
    if (!anon) headers['Authorization'] = `Bearer ${token}`;
    fetch(`${API_BASE}${path}`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        type,
        message: String(message).slice(0, 500),
        page:    window.location.href.slice(0, 300),
        stack:   String(stack || '').slice(0, 3000),
        detail:  detail || {},
      }),
    }).catch(() => {});
  }

  return {
    report(type, message, detail = {}, stack = '') {
      _send(type, message, detail, stack);
    },
  };
})();

// Global JS error → server log
window.addEventListener('error', (e) => {
  if (!e.message) return;
  ErrorLogger.report('js_error', e.message, {
    filename: e.filename || '',
    lineno:   e.lineno   || 0,
    colno:    e.colno    || 0,
  }, e.error?.stack || '');
});

// Unhandled promise rejection → server log
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason) || 'Unhandled promise rejection';
  ErrorLogger.report('unhandled_rejection', msg, {}, e.reason?.stack || '');
});
