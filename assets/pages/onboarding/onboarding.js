// onboarding — page script, extracted from onboarding.html.
//
// Wrapped in an IIFE on purpose. When this code lived inline it was run through
// Layout's indirect eval, which kept const/let/class LOCAL; as a plain external
// script those would become global lexical bindings and collide with other pages'
// scripts (both stay loaded across SPA navigation). The IIFE restores that scoping.
//
// Top-level function/var declarations DID leak to global under eval, and inline
// on*="" handlers in the HTML call them, so they are re-published on window below
// via accessor bridges (get + set, so later reassignment stays in sync).
(function () {
'use strict';

if (!Auth.requireAuth()) {}
  Layout.render('learn');

  const state = {
    config: null,
    progress: null,
    currentChapterIdx: 0,
    mainView: 'plan',
    flowView: 'arch',
    notebookTimers: {}, // chapter_id → timeout id
    pdfFiles: [],
    slideIdx: {},       // blockId → current slide index
    examDraft: {},      // chapter_id → { question_id → choice_id }
    examLastResult: {}, // chapter_id → last submit result payload
  };

  (async function init() {
    try {
      const [cfgRes, progRes, pdfRes] = await Promise.all([
        API.onboarding.getConfig(),
        API.onboarding.myProgress(),
        API.onboarding.listPdfs(),
      ]);

      if (!cfgRes?.ok || !progRes?.ok) {
        document.getElementById('page').innerHTML =
          '<div class="ob-skel">ไม่สามารถโหลดข้อมูล onboarding ได้</div>';
        return;
      }

      state.config   = cfgRes.data.data;
      state.progress = progRes.data.data;
      state.pdfFiles = (pdfRes?.ok ? pdfRes.data.data : []) || [];

      // If user already finished → go to learn (unless opened in review mode from learn.html)
      const _reviewMode = new URLSearchParams(location.search).get('review') === '1';
      if (state.progress.finished_at && !_reviewMode) {
        window.location.replace('learn.html');
        return;
      }

      // Jump to first non-completed chapter
      const chs = state.config.chapters || [];
      const chState = state.progress.chapter_state || [];
      const firstIncomplete = chState.findIndex(c => !c.completed && (chState[0]?.id === c.id || isUnlocked(c.id)));
      state.currentChapterIdx = Math.max(0, chs.findIndex(c => {
        const cs = chState.find(x => x.id === c.id);
        return cs && !cs.completed && cs.unlocked !== false;
      }));
      if (state.currentChapterIdx < 0) state.currentChapterIdx = 0;

      render();
    } catch (e) {
      console.error(e);
      document.getElementById('page').innerHTML =
        '<div class="ob-skel">เกิดข้อผิดพลาด: ' + escHtml(e.message || e) + '</div>';
    }
  })();

  function isUnlocked(chapterId) {
    const cs = (state.progress.chapter_state || []).find(x => x.id === chapterId);
    return cs ? cs.unlocked : false;
  }

  function isDone(chapterId) {
    const cs = (state.progress.chapter_state || []).find(x => x.id === chapterId);
    return cs ? cs.completed : false;
  }

  function taskChecked(chapterId, taskId) {
    const ct = state.progress.completed_tasks || {};
    const arr = ct[chapterId] || [];
    return arr.includes(taskId);
  }

  function render() {
    const { config, progress } = state;
    const intro = config.intro || {};
    const chapters = config.chapters || [];
    const pct = progress.percent || 0;

    const page = document.getElementById('page');
    page.innerHTML = `
      <div class="ob-hero">
        <div>
          <h1>${escHtml(intro.title || 'ยินดีต้อนรับเข้าทีม 👋')}</h1>
          <p>${escHtml(intro.subtitle || '')}${intro.description ? '<br>' + escHtml(intro.description) : ''}</p>
          <div class="ob-progress"><div style="width:${pct}%"></div></div>
        </div>
        <div class="ob-stats">
          <div class="ob-stat"><div class="ob-stat-n">${chapters.length}</div><div class="ob-stat-l">บท</div></div>
          <div class="ob-stat"><div class="ob-stat-n">${progress.done_tasks || 0}</div><div class="ob-stat-l">งานเสร็จ</div></div>
          <div class="ob-stat"><div class="ob-stat-n">${progress.total_tasks || 0}</div><div class="ob-stat-l">งานทั้งหมด</div></div>
        </div>
      </div>

      <div class="ob-main-tabs">
        <button class="ob-main-tab active" style="cursor:default"><i data-icon="clipboard"></i> แผน ${chapters.length} บท เริ่มต้นการเป็น SM</button>
      </div>

      <div class="ob-view active">${renderPlanView()}</div>
    `;

    bindNotebooks();
    bindQuizzes();
    bindScoredQuizChoices();
  }

  // ─── Plan view ────────────────────────────────────────────
  function renderPlanView() {
    const chapters = state.config.chapters || [];
    const allDone = state.progress.all_done;

    const tabs = chapters.map((ch, i) => {
      const locked = !isUnlocked(ch.id);
      const done = isDone(ch.id);
      const active = i === state.currentChapterIdx;
      const cls = [
        active ? 'active' : (done ? 'done' : ''),
        locked && !active ? 'locked' : '',
      ].filter(Boolean).join(' ');
      return `<button class="ob-chap-tab ${cls}"
                      onclick="${locked ? `Toast.warning('ทำบทก่อนหน้าให้ครบก่อนจึงจะปลดล็อก')` : `switchChapter(${i})`}"
                      title="${locked ? 'ยังล็อกอยู่ — ทำบทก่อนหน้าให้ครบก่อน' : ''}">
        <span class="ob-chap-num">${done ? '✓' : (i + 1)}</span>
        <span>${escHtml(ch.title || ch.label)}</span>
      </button>`;
    }).join('');

    const finishBanner = allDone ? `
      <div class="ob-finish">
        <div class="big"><i data-icon="sparkles"></i></div>
        <h2>ทำครบทุกบทแล้ว!</h2>
        <p>กด "เข้าสู่ Learning" เพื่อเริ่มเรียนคอร์สต่อไป หลังจากนี้จะไม่เห็นหน้า Onboarding อีก</p>
        <button class="ob-btn success" onclick="finishOnboarding()">เข้าสู่ Learning →</button>
      </div>
    ` : '';

    const panels = chapters.map((ch, i) => renderChapterPanel(ch, i)).join('');

    return `
      ${finishBanner}
      <div class="ob-chap-tabs">${tabs}</div>
      ${panels}
    `;
  }

  function renderChapterPanel(ch, idx) {
    const active = idx === state.currentChapterIdx;
    const blocks = (ch.blocks || []).map(b => renderBlock(ch, b)).join('');
    const tasks  = renderTaskChecklist(ch);
    const notebook = renderNotebook(ch);
    const nextLocked = idx < (state.config.chapters.length - 1) && !isDone(ch.id);

    return `
      <div class="ob-chap ${active ? 'active' : ''}" id="chap-${escHtml(ch.id)}">
        <div class="ob-chap-eyebrow">${escHtml(ch.label || ('บทที่ ' + (idx+1)))}</div>
        <div class="ob-chap-title">${escHtml(ch.title || '')}</div>
        <div class="ob-chap-desc">${escHtml(ch.description || '')}</div>

        ${blocks}
        ${tasks}
        ${notebook}

        <div class="ob-nav-row">
          <button class="ob-btn" onclick="switchChapter(${idx - 1})" ${idx === 0 ? 'disabled' : ''}>← บทก่อนหน้า</button>
          <button class="ob-btn primary"
                  onclick="switchChapter(${idx + 1})"
                  ${idx === state.config.chapters.length - 1 || nextLocked ? 'disabled' : ''}
                  title="${nextLocked ? 'ทำ task ให้ครบก่อน' : ''}">
            ${idx === state.config.chapters.length - 1 ? 'บทสุดท้าย' : 'บทถัดไป →'}
          </button>
        </div>
      </div>
    `;
  }

  function renderBlock(ch, block) {
    if (block.id === 'b3_overview_img') return '';
    const t = block.type || '';

    if (t === 'checklist') {
      const items = (block.items || []).map(it => `
        <div class="ob-check" style="cursor:default">
          <div class="ob-check-box"></div>
          <div class="ob-check-text">${escHtml(it)}</div>
        </div>
      `).join('');
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="menu"></i></span>${escHtml(block.title || '')}</div>
        ${items}
      </div>`;
    }

    if (t === 'system_list') {
      const hasCreds = (block.items || []).some(it => it.user || it.pass);
      const rows = (block.items || []).map(it => {
        let credCell = '-';
        if (it.user || it.pass) {
          const uid = 'p' + Math.random().toString(36).slice(2,8);
          const safePass = escHtml(it.pass || '');
          credCell = `<div class="cred-wrap">
            ${it.user ? `<span class="cred-user">👤 ${escHtml(it.user)}</span>` : ''}
            ${it.pass ? `<div class="cred-pass-row">
              <span class="cred-pass" id="${uid}">••••••••</span>
              <button class="cred-copy" data-pass="${safePass}" data-target="${uid}" onclick="sysPassToggle(this)" title="แสดง/ซ่อน" style="display:inline-flex;align-items:center;justify-content:center"><svg style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
              <button class="cred-copy" data-pass="${safePass}" onclick="sysPassCopy(this)" title="คัดลอก">📋</button>
            </div>` : ''}
          </div>`;
        }
        return `<tr>
          <td class="sys">${escHtml(it.system || '')}</td>
          <td>${escHtml(it.process || '')}</td>
          <td class="url">${it.url ? `<a href="${escHtml(it.url)}" target="_blank" rel="noopener">${escHtml(it.url)}</a>` : '-'}</td>
          ${hasCreds ? `<td>${credCell}</td>` : ''}
        </tr>`;
      }).join('');
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="settings"></i></span>${escHtml(block.title || '')}</div>
        <table class="ob-syslist">
          <thead><tr><th>System</th><th>Access Process</th><th>URL</th>${hasCreds ? '<th>User / Pass</th>' : ''}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }

    if (t === 'link_list') {
      const rows = (block.items || []).map(it => `
        <li style="margin-bottom:6px"><a href="${escHtml(it.url || '#')}" target="_blank" rel="noopener"
          style="color:var(--orange);text-decoration:none">${escHtml(it.label || it.url || '')}</a>
          ${it.note ? `<span style="color:var(--text-muted); font-size:11.5px"> — ${escHtml(it.note)}</span>` : ''}</li>
      `).join('');
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="link"></i></span>${escHtml(block.title || '')}</div>
        <ul style="list-style:none; padding-left:0; margin:0; font-size:13px">${rows}</ul>
      </div>`;
    }

    if (t === 'card_list') {
      if (block.id === 'b3_screens') return renderSlideshow(ch, block);
      const items = block.items || [];
      const n = items.length;
      let cols = Math.min(n, 4);
      if (block.id === 'b2_tiers') cols = 3;
      else if (n === 5)            cols = 5;
      const cards = items.map(it => {
        const color = it.color || '#F26419';
        return `
          <div class="ob-dot-card">
            <div class="ob-dot-head">
              <div class="ob-dot" style="background:${escHtml(color)}"></div>
              <div class="ob-dot-title" style="color:${escHtml(color)}">${escHtml(it.title || '')}</div>
            </div>
            ${it.body ? `<div class="ob-dot-text">${escHtml(it.body).replace(/\n/g, '<br>')}</div>` : ''}
          </div>`;
      }).join('');
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico">▤</span>${escHtml(block.title || '')}</div>
        <div class="ob-dot-grid" data-cols="${cols}">${cards}</div>
      </div>`;
    }

    if (t === 'org_chart') {
      const renderItem = (it) => {
        if (typeof it === 'string') {
          return `<li class="ob-org-leaf">${escHtml(it)}</li>`;
        }
        const subs = (it.sub || []).map(s => `<li class="ob-org-leaf">${escHtml(s)}</li>`).join('');
        return `<li class="ob-org-leaf">
          <span class="ob-org-leaf-title">${escHtml(it.title || '')}</span>
          ${subs ? `<ul class="ob-org-sublist">${subs}</ul>` : ''}
        </li>`;
      };
      const renderDiv = (d, extraCls = '') => {
        const items = (d.items || []).map(renderItem).join('');
        return `<div class="ob-org-div ${extraCls}">
          <div class="ob-org-div-title">${escHtml(d.title || '')}</div>
          ${items ? `<ul class="ob-org-list">${items}</ul>` : ''}
        </div>`;
      };
      const root = block.root || {};
      const note = root.note
        ? `<div class="ob-org-note">${escHtml(root.note)}</div>` : '';

      // Top tier: insert central column between primary[1] and primary[2]
      const primary = block.primary || [];
      const central = block.central || [];
      const secondary = block.secondary || [];

      const centralColumn = central.length
        ? `<div class="ob-org-central">
            ${central.map(c => renderDiv(c, 'ob-org-small')).join('')}
          </div>`
        : '';

      // Build top row: PE | IE&O | central | SMC
      const topCells = [];
      primary.forEach((d, i) => {
        topCells.push(renderDiv(d, 'ob-org-large'));
        if (i === 1 && centralColumn) topCells.push(centralColumn);
      });
      const topRow = topCells.join('');

      const bottomRow = secondary.map(d => renderDiv(d, 'ob-org-large')).join('');

      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="building"></i></span>${escHtml(block.title || '')}</div>
        <div class="ob-org">
          <div class="ob-org-top">
            <div class="ob-org-root">${escHtml(root.title || '')}</div>
            ${note}
          </div>
          <div class="ob-org-trunk"></div>
          <div class="ob-org-tier ob-org-tier-primary">${topRow}</div>
          ${secondary.length ? `
            <div class="ob-org-bridge"></div>
            <div class="ob-org-tier ob-org-tier-secondary">${bottomRow}</div>
          ` : ''}
        </div>
      </div>`;
    }

    if (t === 'pdf_list') {
      const pdfs = state.pdfFiles || [];
      const rows = pdfs.length ? pdfs.map(f => `
        <div class="ob-pdf-row">
          <div class="ob-pdf-icon"><i data-icon="file"></i></div>
          <div class="ob-pdf-info">
            <div class="ob-pdf-name">${escHtml(f.filename)}</div>
            <div class="ob-pdf-meta">${formatSize(f.size)} · อัปโหลดเมื่อ ${formatDate(f.uploaded_at)}</div>
          </div>
          <div class="ob-pdf-actions">
            <a href="${escHtml(f.url)}" target="_blank" rel="noopener" class="primary">เปิดอ่าน</a>
            <a href="${escHtml(f.url)}" download>ดาวน์โหลด</a>
          </div>
        </div>
      `).join('') : '<div class="ob-pdf-empty">ยังไม่มีเอกสารอัปโหลด</div>';

      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="file"></i></span>${escHtml(block.title || 'เอกสาร PDF')}</div>
        ${rows}
      </div>`;
    }

    if (t === 'html') {
      // Admin-editable HTML. Since only admins can edit config, and frontend renders it trusted,
      // we still do a light-touch sanitation: strip <script> tags.
      const safe = String(block.html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="pencil"></i></span>${escHtml(block.title || '')}</div>
        <div style="font-size:13px; line-height:1.7; color:var(--text-muted)">${safe}</div>
      </div>`;
    }

    if (t === 'freetext') {
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="pencil"></i></span>${escHtml(block.title || '')}</div>
        <div style="font-size:13px; line-height:1.7; color:var(--text-muted); white-space:pre-wrap">${escHtml(block.text || '')}</div>
      </div>`;
    }

    if (t === 'scored_quiz') {
      return renderScoredQuizBlock(ch, block);
    }

    if (t === 'quiz') {
      const savedQuizzes = (state.progress.quizzes || {})[ch.id] || {};
      const blockId = block.id || '';
      const items = (block.questions || []).map((q, idx) => {
        // Composite key prevents collisions when multiple quiz blocks in the same
        // chapter reuse question ids like q1/q2/q3. Fall back to plain q.id for
        // legacy data saved before this fix.
        const compKey = blockId + '::' + q.id;
        const uid  = 'quiz_' + escHtml(ch.id) + '_' + escHtml(blockId) + '_' + escHtml(q.id);
        const val  = escHtml(savedQuizzes[compKey] ?? savedQuizzes[q.id] ?? '');
        return `<div class="ob-quiz-item">
          <div class="ob-quiz-q">
            <span class="ob-quiz-num">${idx + 1}</span>
            <span>${escHtml(q.text || '')}</span>
          </div>
          <div class="ob-quiz-wrap">
            <textarea class="ob-quiz-ans"
              id="${uid}"
              data-chapter="${escHtml(ch.id)}"
              data-question="${escHtml(compKey)}"
              placeholder="พิมพ์คำตอบของคุณที่นี่…"
            >${val}</textarea>
            <div class="ob-quiz-status" id="${uid}_st">บันทึกแล้ว</div>
          </div>
          <div class="ob-quiz-hint"><i data-icon="clipboard"></i> Lead จะเห็นคำตอบนี้เพื่อ verify ความเข้าใจของคุณ</div>
        </div>`;
      }).join('');
      return `<div class="ob-card">
        <div class="ob-card-head"><span class="ico"><i data-icon="pencil"></i></span>${escHtml(block.title || 'แบบทดสอบความเข้าใจ')}
          <span style="margin-left:auto; font-size:10.5px; color:var(--orange); font-weight:600; text-transform:none">Lead จะ verify</span>
        </div>
        ${items}
      </div>`;
    }

    return '';
  }

  function renderScoredQuizBlock(ch, block) {
    const chState   = (state.progress.chapter_state || []).find(s => s.id === ch.id) || {};
    const examResult = chState.exam_result || null;
    const lastResult = state.examLastResult?.[ch.id] || null; // set after submit

    const passScore  = block.pass_score || 80;
    const questions  = block.questions  || [];
    const blockId    = escHtml(block.id);
    const chId       = escHtml(ch.id);

    // After submit: show result screen instead of questions
    if (lastResult) {
      const passed    = lastResult.exam_passed;
      const newAttempts = (examResult?.attempts ?? lastResult.exam_total) > 0
                          ? (examResult?.attempts ?? 0) : 0;
      const actualAttempts = newAttempts || 1;

      if (passed) {
        // Graduation moment
        return `<div class="ob-card" id="sq-card-${blockId}" style="border-color:rgba(16,185,129,.4)">
          <div class="ob-card-head">
            <span class="ico"><i data-icon="edit"></i></span>${escHtml(block.title || 'แบบทดสอบ')}
            <span style="margin-left:auto; font-size:10.5px; color:#10b981; font-weight:600; text-transform:none">ผ่านแล้ว <i data-icon="check"></i></span>
          </div>
          <div style="text-align:center; padding:36px 24px">
            <div style="font-size:48px; margin-bottom:12px"><i data-icon="sparkles"></i></div>
            <div style="font-size:28px; font-weight:700; color:#10b981; margin-bottom:6px">${lastResult.exam_score}%</div>
            <div style="font-size:15px; font-weight:600; margin-bottom:4px">ผ่านแล้ว! ยินดีด้วย</div>
            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:20px">ตอบถูก ${lastResult.exam_correct}/${lastResult.exam_total} ข้อ · ทำ ${actualAttempts} ครั้ง</div>
            <div style="font-size:13px; color:var(--text-muted); max-width:380px; margin:0 auto; line-height:1.7">
              คุณผ่านการ Onboarding ทั้ง 6 บทเรียบร้อยแล้ว<br>พร้อมเริ่มทำงานกับทีม SM ได้เลย!
            </div>
          </div>
        </div>`;
      } else {
        // Failed — show score + retry
        const bestScore = examResult?.best_score ?? lastResult.exam_score;
        return `<div class="ob-card" id="sq-card-${blockId}">
          <div class="ob-card-head">
            <span class="ico"><i data-icon="edit"></i></span>${escHtml(block.title || 'แบบทดสอบ')}
            <span style="margin-left:auto; font-size:10.5px; color:var(--orange); font-weight:600; text-transform:none">ผ่านเกณฑ์ ${passScore}%</span>
          </div>
          <div style="text-align:center; padding:32px 24px">
            <div style="font-size:42px; font-weight:700; color:var(--orange); margin-bottom:8px">${lastResult.exam_score}%</div>
            <div style="font-size:14px; font-weight:600; margin-bottom:4px">ยังไม่ผ่าน</div>
            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:24px">
              ตอบถูก ${lastResult.exam_correct}/${lastResult.exam_total} ข้อ · ต้องการ ${passScore}% ขึ้นไป · ทำแล้ว ${actualAttempts} ครั้ง
              ${bestScore > lastResult.exam_score ? ` · คะแนนสูงสุด ${bestScore}%` : ''}
            </div>
            <button class="sq-submit-btn" onclick="retryExamBlock('${chId}')">กลับไปทำใหม่</button>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:12px">
              แนะนำให้ทบทวนบทที่ 1–5 ก่อนลองใหม่
            </div>
          </div>
        </div>`;
      }
    }

    // Build question HTML (before submit)
    const qHtml = questions.map((q, idx) => {
      const choicesHtml = (q.choices || []).map(c => {
        const selected = state.examDraft?.[ch.id]?.[q.id] === c.id;
        const cls = 'sq-choice' + (selected ? ' selected' : '');
        return `<label class="${cls}" data-chid="${chId}" data-qid="${escHtml(q.id)}" data-cid="${escHtml(c.id)}">
          <div class="sq-radio"></div>
          <span class="sq-choice-label">${escHtml(c.text || '')}</span>
        </label>`;
      }).join('');

      return `<div class="sq-question">
        <div class="sq-q-text">
          <span class="sq-q-num">${idx + 1}</span>
          <span>${escHtml(q.text || '')}</span>
        </div>
        <div class="sq-choices">${choicesHtml}</div>
      </div>`;
    }).join('');

    // Footer: submit button
    const totalQ   = questions.length;
    const answered = Object.keys(state.examDraft?.[ch.id] || {}).length;
    const attempts = examResult?.attempts ?? 0;

    const footer = `<div class="sq-footer">
      <button class="sq-submit-btn" id="sq-submit-${blockId}"
              onclick="submitExamBlock('${chId}','${blockId}')"
              ${answered < totalQ ? 'disabled' : ''}>
        ส่งคำตอบ
      </button>
      <span class="sq-submit-hint">ตอบ ${answered}/${totalQ} ข้อ${answered < totalQ ? ' — ตอบให้ครบก่อน submit' : ' — พร้อม submit'}</span>
      ${attempts > 0 ? `<span class="sq-attempts-badge">ครั้งที่ ${attempts + 1}</span>` : ''}
    </div>`;

    return `<div class="ob-card" id="sq-card-${blockId}">
      <div class="ob-card-head">
        <span class="ico"><i data-icon="edit"></i></span>${escHtml(block.title || 'แบบทดสอบ')}
        <span style="margin-left:auto; font-size:10.5px; color:var(--orange); font-weight:600; text-transform:none">ผ่านเกณฑ์ ${passScore}%</span>
      </div>
      ${qHtml}
      ${footer}
    </div>`;
  }

  function renderSlideshow(ch, block) {
    const items = block.items || [];
    const n = items.length;
    const idx = Math.max(0, Math.min(state.slideIdx[block.id] || 0, n - 1));
    const item = items[idx] || {};
    const color = item.color || '#F26419';
    const cId = escHtml(ch.id);
    const bId = escHtml(block.id);
    const imgSrc = item.image || 'uploads/onboarding/monitor-overview.jpg';

    const dots = items.map((_, i) =>
      `<button class="ob-slide-dot ${i === idx ? 'active' : ''}"
               onclick="gotoSlide('${cId}','${bId}',${i})"
               title="Screen ${i}"></button>`
    ).join('');

    return `<div class="ob-card" style="padding:0;overflow:hidden" id="slide-${bId}">
      <div style="padding:16px 20px 14px" class="ob-card-head">
        <span class="ico"><i data-icon="monitor"></i></span>${escHtml(block.title || '')}
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:600;text-transform:none;letter-spacing:0">${idx + 1} / ${n}</span>
      </div>
      <div class="ob-slide-layout">
        <div class="ob-slide-img-pane" onclick="showLightbox('${escHtml(imgSrc)}')" title="คลิกเพื่อดูรูปเต็มจอ">
          <img src="${escHtml(imgSrc)}" alt="Screen ${idx}" class="ob-slide-img"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="ob-slide-img-empty"><i data-icon="monitor"></i><span style="font-size:13px;margin-top:6px">ยังไม่มีรูป</span></div>
        </div>
        <div class="ob-slide-content-pane">
          <div class="ob-slide-eyebrow" style="color:${escHtml(color)}">Screen ${idx}</div>
          <div class="ob-slide-title" style="color:${escHtml(color)}">${escHtml(item.title || '')}</div>
          <div class="ob-slide-body">${escHtml(item.body || '').replace(/\n/g, '<br>')}</div>
          <div class="ob-slide-nav">
            <button class="ob-btn" onclick="gotoSlide('${cId}','${bId}',${idx - 1})" ${idx === 0 ? 'disabled' : ''}>← ก่อนหน้า</button>
            <div class="ob-slide-dots">${dots}</div>
            <button class="ob-btn primary" onclick="gotoSlide('${cId}','${bId}',${idx + 1})" ${idx === n - 1 ? 'disabled' : ''}>ถัดไป →</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderExamStatusCard(ch) {
    const chState   = (state.progress.chapter_state || []).find(s => s.id === ch.id) || {};
    const examResult = chState.exam_result || null;
    const passed    = examResult?.passed ?? false;
    const bestScore = examResult?.best_score ?? 0;
    const attempts  = examResult?.attempts  ?? 0;
    const borderColor = passed ? 'rgba(16,185,129,.4)' : 'var(--border)';
    const statusColor = passed ? '#10b981' : 'var(--orange)';

    let content = '';
    if (!attempts) {
      content = `<div class="sq-status-card"><span style="font-size:13px; color:var(--text-muted)">ยังไม่ได้ทำแบบทดสอบ — เลื่อนขึ้นด้านบนเพื่อเริ่ม</span></div>`;
    } else if (passed) {
      content = `<div class="sq-status-card">
        <span class="sq-status-score pass">${bestScore}%</span>
        <div style="flex:1">
          <div style="font-size:13px; font-weight:600; color:#10b981">ผ่านแล้ว <i data-icon="check"></i></div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px">คะแนนสูงสุด ${bestScore}% · ทำ ${attempts} ครั้ง</div>
        </div>
        <span style="font-size:18px"><i data-icon="sparkles"></i></span>
      </div>`;
    } else {
      const block = (ch.blocks || []).find(b => b.type === 'scored_quiz');
      const passScore = block?.pass_score || 80;
      content = `<div class="sq-status-card">
        <span class="sq-status-score fail">${bestScore}%</span>
        <div style="flex:1">
          <div style="font-size:13px; font-weight:600; color:var(--orange)">ยังไม่ผ่าน</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px">ต้องการ ${passScore}% · ทำแล้ว ${attempts} ครั้ง</div>
        </div>
      </div>`;
    }

    return `<div class="ob-card" id="tasklist-${escHtml(ch.id)}" style="border-color:${borderColor}">
      <div class="ob-card-head">
        <span class="ico"><i data-icon="edit"></i></span>ผลการทดสอบ
        <span style="margin-left:auto; font-size:11px; font-weight:600; color:${statusColor}">
          ${passed ? 'ผ่านแล้ว ✓' : (attempts ? `${bestScore}% · ยังไม่ผ่าน` : 'ยังไม่ได้ทำ')}
        </span>
      </div>
      ${content}
    </div>`;
  }

  function renderTaskChecklist(ch) {
    // Chapters with scored_quiz blocks: show exam status card instead
    const hasScoredQuiz = (ch.blocks || []).some(b => b.type === 'scored_quiz');
    if (hasScoredQuiz) return renderExamStatusCard(ch);

    const tasks = ch.tasks || [];
    if (!tasks.length) return '';
    const items = tasks.map(t => {
      const done = taskChecked(ch.id, t.id);
      return `<div class="ob-check" onclick="toggleTask('${escHtml(ch.id)}','${escHtml(t.id)}')">
        <div class="ob-check-box ${done ? 'done' : ''}"></div>
        <div class="ob-check-text ${done ? 'done' : ''}">${escHtml(t.label || '')}</div>
      </div>`;
    }).join('');
    const doneCount   = tasks.filter(t => taskChecked(ch.id, t.id)).length;
    const tasksDone   = doneCount === tasks.length;

    // Quiz progress from server-side chapter_state
    const chState     = (state.progress.chapter_state || []).find(s => s.id === ch.id) || {};
    const quizTotal   = chState.quiz_total || 0;
    const quizDone    = chState.quiz_done  || 0;
    const quizAllDone = quizTotal === 0 || quizDone === quizTotal;
    const chapterDone = tasksDone && quizAllDone;

    const statusColor = chapterDone ? '#10b981' : 'var(--orange)';
    const borderColor = chapterDone ? 'rgba(16,185,129,.4)' : 'var(--border)';

    let statusText = `${doneCount}/${tasks.length}`;
    if (quizTotal > 0) statusText += ` · Quiz ${quizDone}/${quizTotal}`;
    if (chapterDone) statusText += ' · ปลดล็อกบทถัดไปแล้ว <i data-icon="check"></i>';

    const quizWarning = tasksDone && !quizAllDone
      ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(242,100,25,.08); border:1px solid rgba(242,100,25,.25); border-radius:6px; font-size:12px; color:var(--orange)">
           <i data-icon="pencil"></i> ตอบคำถาม "ตรวจสอบความเข้าใจ" ด้านบนให้ครบ (${quizDone}/${quizTotal}) เพื่อปลดล็อกบทถัดไป
         </div>`
      : '';

    return `<div class="ob-card" id="tasklist-${escHtml(ch.id)}" style="border-color:${borderColor}">
      <div class="ob-card-head">
        <span class="ico"><i data-icon="check"></i></span>Checklist บทนี้
        <span style="margin-left:auto; font-size:11px; font-weight:600; color:${statusColor}">
          ${statusText}
        </span>
      </div>
      ${items}
      ${quizWarning}
    </div>`;
  }

  function renderNotebook(ch) {
    const nb = state.progress.notebook || {};
    const text = nb[ch.id] || '';
    return `<div class="ob-card">
      <div class="ob-card-head"><span class="ico"><i data-icon="book"></i></span>Notebook ส่วนตัว <span style="margin-left:auto; font-size:10.5px; color:var(--text-muted); font-weight:400; text-transform:none; letter-spacing:0">เห็นเฉพาะของคุณ</span></div>
      <div class="ob-notebook-wrap">
        <textarea class="ob-notebook"
                  data-chapter="${escHtml(ch.id)}"
                  placeholder="จดสิ่งที่เรียนรู้ ความสงสัย หรือแผนของบทนี้…">${escHtml(text)}</textarea>
        <div class="ob-notebook-status" data-chapter="${escHtml(ch.id)}">บันทึกแล้ว</div>
      </div>
    </div>`;
  }

  // ─── Flow view ────────────────────────────────────────────
  function renderFlowView() {
    const fa = state.config.flow_architecture || {};
    const arch = fa.system_arch || null;
    const wf   = fa.workflow || null;

    return `
      <div class="ob-flow-tabs">
        <button class="ob-flow-tab ${state.flowView === 'arch' ? 'active' : ''}" onclick="switchFlow('arch')">System Architecture</button>
        <button class="ob-flow-tab ${state.flowView === 'workflow' ? 'active' : ''}" onclick="switchFlow('workflow')">Team Workflow</button>
      </div>
      <div class="ob-flow-panel ${state.flowView === 'arch' ? 'active' : ''}">${arch ? renderArch(arch) : emptyFlow()}</div>
      <div class="ob-flow-panel ${state.flowView === 'workflow' ? 'active' : ''}">${wf ? renderWorkflow(wf) : emptyFlow()}</div>
    `;
  }

  function emptyFlow() { return '<div class="ob-skel">ยังไม่มีข้อมูล</div>'; }

  function renderArch(a) {
    const layers = (a.layers || []).map(l => {
      const nodes = (l.nodes || []).map(n => `
        <div class="ob-arch-node" style="background:${hexToBg(l.color)}; color:${l.color}; border:1px solid ${hexToBg(l.color, .5)}">
          ${escHtml(n.title || '')}
          ${n.sub ? `<div class="sub">${escHtml(n.sub)}</div>` : ''}
        </div>
      `).join('');
      return `<div class="ob-arch-layer">
        <div class="ob-layer-head" style="color:${escHtml(l.color || '#F26419')}">${escHtml(l.label || '')}</div>
        ${nodes}
      </div>`;
    }).join('');

    let reqFlow = '';
    if (a.request_flow) {
      const r = a.request_flow;
      const nodes = (r.nodes || []).map((n, i, arr) => {
        const sep = i < arr.length - 1 ? '<span class="ob-flow-arrow">→</span>' : '';
        return `<span class="ob-flow-node" style="background:${escHtml(n.color || '#F26419')}">${escHtml(n.label || '')}</span>${sep}`;
      }).join('');
      reqFlow = `<div class="ob-reqflow">
        <div class="ob-reqflow-title">${escHtml(r.title || '')}</div>
        <div class="ob-reqflow-row">${nodes}</div>
        ${r.note ? `<div class="ob-reqflow-note">${escHtml(r.note)}</div>` : ''}
      </div>`;
    }

    return `
      <div class="ob-chap-title" style="margin-bottom:6px">${escHtml(a.title || '')}</div>
      <div class="ob-chap-desc">${escHtml(a.description || '')}</div>
      <div class="ob-arch-layers">${layers}</div>
      ${reqFlow}
    `;
  }

  function renderWorkflow(wf) {
    const steps = (wf.steps || []).map(s => `
      <div class="ob-wf-step">
        <div class="ob-wf-num" style="background:${escHtml(s.color || '#F26419')}">${escHtml(String(s.num))}</div>
        <div style="flex:1">
          <div class="ob-wf-title">${escHtml(s.title || '')}</div>
          <div class="ob-wf-desc">${escHtml(s.desc || '')}</div>
          <div class="ob-wf-tags">${(s.tags || []).map(t => `<span class="ob-wf-tag">${escHtml(t)}</span>`).join('')}</div>
        </div>
      </div>
    `).join('');
    return `
      <div class="ob-chap-title" style="margin-bottom:6px">${escHtml(wf.title || '')}</div>
      <div class="ob-chap-desc">${escHtml(wf.description || '')}</div>
      <div class="ob-card" style="padding:6px 18px">${steps}</div>
    `;
  }

  // ─── Helpers ──────────────────────────────────────────────
  function hexToBg(hex, alpha = .12) {
    if (!hex) return 'rgba(242,100,25,' + alpha + ')';
    const h = hex.replace('#','');
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const _SVG_EYE_ON  = `<svg style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const _SVG_EYE_OFF = `<svg style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  function sysPassToggle(btn) {
    const el = document.getElementById(btn.dataset.target);
    if (el.dataset.shown) {
      el.innerHTML = '<i data-icon="circle"></i><i data-icon="circle"></i><i data-icon="circle"></i><i data-icon="circle"></i><i data-icon="circle"></i><i data-icon="circle"></i><i data-icon="circle"></i><i data-icon="circle"></i>';
      delete el.dataset.shown;
      btn.innerHTML = _SVG_EYE_ON;
    } else {
      el.textContent = btn.dataset.pass;
      el.dataset.shown = '1';
      btn.innerHTML = _SVG_EYE_OFF;
    }
  }
  function sysPassCopy(btn) {
    const text = btn.dataset.pass;
    const done = () => { btn.innerHTML = '<i data-icon="check"></i>'; setTimeout(() => btn.innerHTML = '<i data-icon="clipboard"></i>', 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); cb(); } catch(e) {}
    document.body.removeChild(ta);
  }
  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }); }
    catch { return iso; }
  }

  // ─── Actions ──────────────────────────────────────────────
  window.switchMain = function (v) {
    state.mainView = v;
    render();
  };
  window.switchFlow = function (v) {
    state.flowView = v;
    render();
  };
  window.switchChapter = function (i) {
    const chapters = state.config.chapters || [];
    if (i < 0 || i >= chapters.length) return;
    if (!isUnlocked(chapters[i].id)) {
      Toast.warning('ทำบทก่อนหน้าให้ครบก่อนจึงจะปลดล็อก');
      return;
    }
    state.currentChapterIdx = i;
    render();
    // Scroll smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.toggleTask = async function (chId, tId) {
    // Optimistic UI
    const ct = { ...(state.progress.completed_tasks || {}) };
    const arr = ct[chId] ? [...ct[chId]] : [];
    const i = arr.indexOf(tId);
    if (i >= 0) arr.splice(i, 1); else arr.push(tId);
    ct[chId] = arr;
    state.progress = { ...state.progress, completed_tasks: ct };
    render();

    const res = await API.onboarding.toggleTask(chId, tId);
    if (!res?.ok) {
      Toast.error('บันทึกไม่สำเร็จ');
      // Reload from server
      const r2 = await API.onboarding.myProgress();
      if (r2?.ok) state.progress = r2.data.data;
      render();
      return;
    }
    state.progress = res.data.data;
    // If newly all done, auto-jump to finish UX but don't auto-redirect
    render();
  };

  // ── Scored Quiz (MCQ) interactions ───────────────────────────
  function bindScoredQuizChoices() {
    document.querySelectorAll('.sq-choice:not(.locked)').forEach(el => {
      el.addEventListener('click', onChoiceClick);
    });
  }

  function onChoiceClick(e) {
    const el    = e.currentTarget;
    const chId  = el.dataset.chid;
    const qId   = el.dataset.qid;
    const cId   = el.dataset.cid;
    if (!chId || !qId || !cId) return;

    if (!state.examDraft[chId]) state.examDraft[chId] = {};
    state.examDraft[chId][qId] = cId;

    // Update UI without full re-render
    const container = el.closest('.sq-choices');
    container.querySelectorAll('.sq-choice').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    // Update submit button state
    const ch = (state.config.chapters || []).find(c => c.id === chId);
    if (!ch) return;
    const block = (ch.blocks || []).find(b => b.type === 'scored_quiz');
    if (!block) return;
    const total    = (block.questions || []).length;
    const answered = Object.keys(state.examDraft[chId] || {}).length;
    const btn      = document.getElementById('sq-submit-' + block.id);
    if (btn) {
      btn.disabled = answered < total;
      const hint = btn.nextElementSibling;
      if (hint) hint.textContent = `ตอบครบ ${answered}/${total} ข้อ${answered < total ? ' — กรุณาตอบให้ครบ' : ' — พร้อม submit'}`;
    }
  }

  window.submitExamBlock = async function (chId, blockId) {
    const ch    = (state.config.chapters || []).find(c => c.id === chId);
    const block = ch?.blocks?.find(b => b.id === blockId);
    if (!block) return;
    const answers = state.examDraft[chId] || {};
    const total   = (block.questions || []).length;
    if (Object.keys(answers).length < total) { Toast.warning('กรุณาตอบให้ครบทุกข้อ'); return; }

    const btn = document.getElementById('sq-submit-' + blockId);
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังตรวจ…'; }

    const res = await API.onboarding.submitExam(chId, answers);
    if (!res?.ok) {
      Toast.error(res?.data?.message || 'ส่งคำตอบไม่สำเร็จ');
      if (btn) { btn.disabled = false; btn.textContent = 'ส่งคำตอบ'; }
      return;
    }
    const data = res.data.data;
    state.progress = data;
    state.examLastResult[chId] = data;
    state.examDraft[chId] = {};

    if (data.exam_passed) Toast.success(`ผ่านแล้ว! คะแนน ${data.exam_score}% <i data-icon="sparkles"></i>`);
    else Toast.warning(`คะแนน ${data.exam_score}% — ยังไม่ผ่าน (เกณฑ์ ${data.exam_pass_score}%)`);
    render();
  };

  window.retryExamBlock = function (chId) {
    state.examLastResult[chId] = null;
    state.examDraft[chId] = {};
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function bindNotebooks() {
    document.querySelectorAll('.ob-notebook').forEach(el => {
      el.addEventListener('input', onNotebookInput);
      el.addEventListener('blur', () => flushNotebook(el.dataset.chapter, el.value));
    });
  }

  function onNotebookInput(e) {
    const chId = e.target.dataset.chapter;
    const val  = e.target.value;
    clearTimeout(state.notebookTimers[chId]);
    state.notebookTimers[chId] = setTimeout(() => flushNotebook(chId, val), 700);
  }

  async function flushNotebook(chId, text) {
    const current = (state.progress.notebook || {})[chId] || '';
    if (current === text) return;
    const res = await API.onboarding.saveNotebook(chId, text);
    if (res?.ok) {
      state.progress = res.data.data;
      const s = document.querySelector(`.ob-notebook-status[data-chapter="${chId}"]`);
      if (s) { s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 1400); }
    }
  }

  // ── Quiz autosave ─────────────────────────────────────────
  const quizTimers = {};

  function bindQuizzes() {
    document.querySelectorAll('.ob-quiz-ans').forEach(el => {
      el.addEventListener('input', onQuizInput);
      el.addEventListener('blur', () => flushQuiz(el.dataset.chapter, el.dataset.question, el.value, el.id + '_st'));
    });
  }

  function onQuizInput(e) {
    const chId = e.target.dataset.chapter;
    const qId  = e.target.dataset.question;
    const key  = chId + '_' + qId;
    clearTimeout(quizTimers[key]);
    quizTimers[key] = setTimeout(() => flushQuiz(chId, qId, e.target.value, e.target.id + '_st'), 800);
  }

  async function flushQuiz(chId, qId, text, statusId) {
    const saved = ((state.progress.quizzes || {})[chId] || {})[qId] || '';
    if (saved === text) return;
    // Optimistic local update
    if (!state.progress.quizzes) state.progress.quizzes = {};
    if (!state.progress.quizzes[chId]) state.progress.quizzes[chId] = {};
    state.progress.quizzes[chId][qId] = text;

    const res = await API.onboarding.saveQuiz(chId, qId, text);
    if (res?.ok) {
      // Update full state (chapter_state now has updated quiz_done counts)
      state.progress = res.data.data;
      // Re-render only the checklist card so quiz-done count + unlock status refresh
      // without disrupting focus on other quiz textareas in the same chapter
      const ch = (state.config.chapters || []).find(c => c.id === chId);
      if (ch) {
        const card = document.getElementById('tasklist-' + chId);
        if (card) card.outerHTML = renderTaskChecklist(ch);
      }
      const s = document.getElementById(statusId);
      if (s) { s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 1400); }
    }
  }

  // ── Lightbox ──────────────────────────────────────────────
  (function() {
    const lb = document.createElement('div');
    lb.className = 'ob-lightbox';
    lb.id = 'ob-lightbox';
    lb.innerHTML = `<button class="ob-lightbox-close" onclick="closeLightbox()">×</button><img id="ob-lightbox-img" onclick="event.stopPropagation()">`;
    lb.addEventListener('click', () => closeLightbox());
    document.body.appendChild(lb);
  })();

  window.showLightbox = function(src) {
    document.getElementById('ob-lightbox-img').src = src;
    document.getElementById('ob-lightbox').classList.add('show');
  };
  window.closeLightbox = function() {
    document.getElementById('ob-lightbox').classList.remove('show');
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  window.gotoSlide = function(chId, blockId, idx) {
    const ch = (state.config.chapters || []).find(c => c.id === chId);
    if (!ch) return;
    const block = (ch.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    const n = (block.items || []).length;
    if (idx < 0 || idx >= n) return;
    state.slideIdx[blockId] = idx;
    const el = document.getElementById('slide-' + blockId);
    if (el) el.outerHTML = renderSlideshow(ch, block);
  };

  window.finishOnboarding = async function () {
    const res = await API.onboarding.finish();
    if (res?.ok) {
      Toast.success('เรียบร้อย! พาไปหน้า Learning');
      setTimeout(() => { window.location.replace('learn.html'); }, 500);
    } else {
      Toast.error(res?.data?.message || 'ไม่สามารถจบ onboarding ได้');
    }
  };

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "bindNotebooks", { configurable: true, get: () => bindNotebooks, set: (v) => { bindNotebooks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bindQuizzes", { configurable: true, get: () => bindQuizzes, set: (v) => { bindQuizzes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bindScoredQuizChoices", { configurable: true, get: () => bindScoredQuizChoices, set: (v) => { bindScoredQuizChoices = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "emptyFlow", { configurable: true, get: () => emptyFlow, set: (v) => { emptyFlow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fallbackCopy", { configurable: true, get: () => fallbackCopy, set: (v) => { fallbackCopy = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "flushNotebook", { configurable: true, get: () => flushNotebook, set: (v) => { flushNotebook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "flushQuiz", { configurable: true, get: () => flushQuiz, set: (v) => { flushQuiz = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatDate", { configurable: true, get: () => formatDate, set: (v) => { formatDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatSize", { configurable: true, get: () => formatSize, set: (v) => { formatSize = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexToBg", { configurable: true, get: () => hexToBg, set: (v) => { hexToBg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isDone", { configurable: true, get: () => isDone, set: (v) => { isDone = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isUnlocked", { configurable: true, get: () => isUnlocked, set: (v) => { isUnlocked = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onChoiceClick", { configurable: true, get: () => onChoiceClick, set: (v) => { onChoiceClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onNotebookInput", { configurable: true, get: () => onNotebookInput, set: (v) => { onNotebookInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onQuizInput", { configurable: true, get: () => onQuizInput, set: (v) => { onQuizInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderArch", { configurable: true, get: () => renderArch, set: (v) => { renderArch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderBlock", { configurable: true, get: () => renderBlock, set: (v) => { renderBlock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderChapterPanel", { configurable: true, get: () => renderChapterPanel, set: (v) => { renderChapterPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderExamStatusCard", { configurable: true, get: () => renderExamStatusCard, set: (v) => { renderExamStatusCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderFlowView", { configurable: true, get: () => renderFlowView, set: (v) => { renderFlowView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderNotebook", { configurable: true, get: () => renderNotebook, set: (v) => { renderNotebook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPlanView", { configurable: true, get: () => renderPlanView, set: (v) => { renderPlanView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderScoredQuizBlock", { configurable: true, get: () => renderScoredQuizBlock, set: (v) => { renderScoredQuizBlock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSlideshow", { configurable: true, get: () => renderSlideshow, set: (v) => { renderSlideshow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTaskChecklist", { configurable: true, get: () => renderTaskChecklist, set: (v) => { renderTaskChecklist = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderWorkflow", { configurable: true, get: () => renderWorkflow, set: (v) => { renderWorkflow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sysPassCopy", { configurable: true, get: () => sysPassCopy, set: (v) => { sysPassCopy = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sysPassToggle", { configurable: true, get: () => sysPassToggle, set: (v) => { sysPassToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "taskChecked", { configurable: true, get: () => taskChecked, set: (v) => { taskChecked = v; } }); } catch (e) {}
})();
