/* ══════════════════════════════════════════════════
   docs-viewer.js  |  SOM-Portal Documentation Viewer
   ══════════════════════════════════════════════════
   Reads Markdown files from docs/user-guide/*.md and
   renders a card-driven landing page plus per-doc
   article view with a section-grouped TOC and search.
   ══════════════════════════════════════════════════ */

// ── Section metadata (icon + title) ────────────────
const SECTIONS = [
  { id: 'home',        title: 'หน้าหลัก',            icon: 'home',     desc: 'Dashboard, Profile, Settings' },
  { id: 'team',        title: 'งานประจำวัน · ทีม',    icon: 'users',    desc: 'Web Board, SABai, Schedule, Inbox' },
  { id: 'ticket',      title: 'Ticket & Report',      icon: 'file-text',desc: 'SMC Ticket, Weekly Report, Analytics' },
  { id: 'ma',          title: 'MA · Service',         icon: 'wrench',   desc: 'MA Services, Test Service, Onboarding' },
  { id: 'monitoring',  title: 'Monitoring',           icon: 'activity', desc: 'Batch, Alert, Uptime, EKS Restart' },
  { id: 'learning',    title: 'Learning · Knowledge', icon: 'book',     desc: 'Learn, Knowledge Base, Ops Runbook' }
];

// ── Docs (matches actual files in docs/user-guide/) ─
const DOCS_INDEX = [
  // Home / Main
  { id: 'index',            title: 'สารบัญคู่มือผู้ใช้',    path: 'docs/user-guide/index.md',            section: 'home',       desc: 'ภาพรวมทั้งหมด · role · feature toggle' },
  { id: 'dashboard',        title: 'Dashboard',             path: 'docs/user-guide/dashboard.md',        section: 'home',       desc: 'หน้าแรกหลัง login · กิจกรรม/ตัวชี้วัด' },
  { id: 'profile',          title: 'Profile',               path: 'docs/user-guide/profile.md',          section: 'home',       desc: 'ข้อมูลส่วนตัว · avatar · พาสเวิร์ด' },
  { id: 'change-password',  title: 'Change Password',       path: 'docs/user-guide/change-password.md',  section: 'home',       desc: 'เปลี่ยนพาสเวิร์ด' },
  { id: 'settings',         title: 'Settings',              path: 'docs/user-guide/settings.md',         section: 'home',       desc: 'ธีม (Glass / Enterprise / Console / Warm) + dark mode' },

  // Team / Daily
  { id: 'board',            title: 'Web Board',             path: 'docs/user-guide/board.md',            section: 'team',       desc: 'บอร์ดโพสต์ประกาศ · ปัญหา · incident' },
  { id: 'sheets',           title: 'Team Docs (Sheets)',    path: 'docs/user-guide/sheets.md',           section: 'team',       desc: 'Google Sheets embed ของทีม' },
  { id: 'sabai',            title: 'SABai',                 path: 'docs/user-guide/sabai.md',            section: 'team',       desc: 'เช็ค mood/สุขภาพจิตประจำวัน' },
  { id: 'schedule',         title: 'Shift Schedule',        path: 'docs/user-guide/schedule.md',         section: 'team',       desc: 'ตารางเวรของทีม' },
  { id: 'pw-schedule',      title: 'PW Schedule',           path: 'docs/user-guide/pw-schedule.md',      section: 'team',       desc: 'ตารางเวร Password (SM only)' },
  { id: 'inbox',            title: 'Team Inbox',            path: 'docs/user-guide/inbox.md',            section: 'team',       desc: 'กล่องแจ้งเตือน notifications' },
  { id: 'syncup',           title: 'Sync Up',               path: 'docs/user-guide/syncup.md',           section: 'team',       desc: 'พื้นที่ sync งานประจำสัปดาห์' },

  // Ticket / Report
  { id: 'send-email',       title: 'SMC Ticket (Send Email)', path: 'docs/user-guide/send-email.md',    section: 'ticket',     desc: 'สร้าง Jira ticket ผ่าน template' },
  { id: 'weekly-report',    title: 'Weekly Report',         path: 'docs/user-guide/weekly-report.md',    section: 'ticket',     desc: 'รายงานสรุปประจำสัปดาห์' },
  { id: 'analytics',        title: 'Analytics',             path: 'docs/user-guide/analytics.md',        section: 'ticket',     desc: 'Dashboard สถิติของทีม' },

  // MA / Service
  { id: 'ma-services',      title: 'MA Services',           path: 'docs/user-guide/ma-services.md',      section: 'ma',         desc: 'Catalog service ที่ทีม MA ดูแล' },
  { id: 'test-service',     title: 'Service Test',          path: 'docs/user-guide/test-service.md',     section: 'ma',         desc: 'ทดสอบ endpoint ของ service' },
  { id: 'onboarding',       title: 'Onboarding',            path: 'docs/user-guide/onboarding.md',       section: 'ma',         desc: 'เอกสาร onboard เข้าทีม' },

  // Monitoring
  { id: 'monitoring',       title: 'Monitoring Hub',        path: 'docs/user-guide/monitoring.md',       section: 'monitoring', desc: 'รวม monitoring links' },
  { id: 'batch-monitor',    title: 'Batch Monitor',         path: 'docs/user-guide/batch-monitor.md',    section: 'monitoring', desc: 'ติดตามสถานะ batch job' },
  { id: 'alert-monitor',    title: 'Alert Monitor',         path: 'docs/user-guide/alert-monitor.md',    section: 'monitoring', desc: 'รวม alert จากทีม' },
  { id: 'uptime',           title: 'Uptime Monitor',        path: 'docs/user-guide/uptime.md',           section: 'monitoring', desc: 'Uptime ของ service' },
  { id: 'restart-monitor',  title: 'EKS Restart Monitor',   path: 'docs/user-guide/restart-monitor.md',  section: 'monitoring', desc: 'ติดตาม restart pod ใน EKS' },

  // Learning / Knowledge
  { id: 'learn',            title: 'Learning',              path: 'docs/user-guide/learn.md',            section: 'learning',   desc: 'Course · Phase · Exam ในทีม' },
  { id: 'knowledge-base',   title: 'Knowledge Base',        path: 'docs/user-guide/knowledge-base.md',   section: 'learning',   desc: 'คลังความรู้ทีม' },
  { id: 'ops-runbook',      title: 'Ops Runbook',           path: 'docs/user-guide/ops-runbook.md',      section: 'learning',   desc: 'Runbook ปฏิบัติการ' }
];

// Compute prev/next once (list order)
DOCS_INDEX.forEach((d, i) => {
  d.prev = i > 0 ? DOCS_INDEX[i - 1].id : null;
  d.next = i < DOCS_INDEX.length - 1 ? DOCS_INDEX[i + 1].id : null;
});

const HOME_ID = '__home__';
const _byId = Object.fromEntries(DOCS_INDEX.map(d => [d.id, d]));
const _sectionMeta = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

// filename → docId  (so [Dashboard](dashboard.md) in markdown works)
const _byFilename = {};
DOCS_INDEX.forEach(d => {
  const file = d.path.split('/').pop();          // dashboard.md
  const stem = file.replace(/\.md$/i, '');       // dashboard
  _byFilename[file] = d.id;
  _byFilename[stem] = d.id;
});

// ── State ────────────────────────────────────────
let currentDocId = HOME_ID;
let searchIndex = [];
let isSearchIndexReady = false;

// ── Init ─────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initViewer, { once: true });
} else {
  initViewer();
}

async function initViewer() {
  generateTOC();

  const params = new URLSearchParams(window.location.search);
  const docParam = params.get('doc');

  if (docParam && _byId[docParam]) {
    currentDocId = docParam;
  } else {
    currentDocId = HOME_ID;
  }

  await navigateTo(currentDocId, false);

  setTimeout(buildSearchIndex, 800);
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('toc-toggle').addEventListener('click', toggleTOC);
  document.getElementById('toc-close').addEventListener('click', closeTOC);
  document.getElementById('prev-btn').addEventListener('click', prevPage);
  document.getElementById('next-btn').addEventListener('click', nextPage);
  document.getElementById('doc-search-btn').addEventListener('click', openSearchModal);
  document.getElementById('search-input').addEventListener('input', handleSearch);
  document.getElementById('bookmarks-btn').addEventListener('click', openBookmarksModal);
  document.getElementById('bookmark-btn').addEventListener('click', toggleBookmark);
  document.getElementById('print-btn').addEventListener('click', printCurrentDoc);
  document.addEventListener('keydown', handleKeyboard);
  window.addEventListener('popstate', handlePopState);
}

function handleKeyboard(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openSearchModal();
    return;
  }
  if (isInputFocused()) return;
  if (document.getElementById('search-modal').style.display === 'flex') return;
  if (e.key === 'ArrowRight') nextPage();
  if (e.key === 'ArrowLeft')  prevPage();
  if (e.key === 'Escape') {
    closeSearchModal();
    closeBookmarksModal();
  }
}

function isInputFocused() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

function handlePopState(e) {
  if (e.state && e.state.docId) {
    navigateTo(e.state.docId, false);
  } else {
    navigateTo(HOME_ID, false);
  }
}

// ══════════════════════════════════════════════════
// TOC
// ══════════════════════════════════════════════════

function generateTOC() {
  const tree = document.getElementById('toc-tree');
  let html = '';

  // Home link
  html += `
    <div class="toc-home" data-id="${HOME_ID}" onclick="navigateTo('${HOME_ID}')">
      <i data-icon="home"></i>
      <span>ภาพรวม · Home</span>
    </div>
  `;

  // Sections
  SECTIONS.forEach(section => {
    const docs = DOCS_INDEX.filter(d => d.section === section.id);
    if (!docs.length) return;
    html += `
      <div class="toc-section">
        <div class="toc-section-title">
          <i data-icon="${section.icon}"></i>
          <span>${escHtml(section.title)}</span>
        </div>
        <div class="toc-section-items">
          ${docs.map(d => `
            <div class="toc-item" data-id="${escHtml(d.id)}" onclick="navigateTo('${escHtml(d.id)}')">
              ${escHtml(d.title)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  tree.innerHTML = html;
  document.getElementById('total-pages').textContent = DOCS_INDEX.length;
  if (window.Icons?.replaceAll) window.Icons.replaceAll(tree);
}

function toggleTOC() {
  document.getElementById('docs-toc').classList.toggle('collapsed');
}

function closeTOC() {
  document.getElementById('docs-toc').classList.add('collapsed');
}

function highlightTOC(docId) {
  document.querySelectorAll('.toc-item, .toc-home').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-id="${cssEsc(docId)}"]`);
  if (el) {
    el.classList.add('active');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ══════════════════════════════════════════════════
// Navigation
// ══════════════════════════════════════════════════

async function navigateTo(docId, pushState = true) {
  currentDocId = docId;
  const pageContent = document.getElementById('page-content');
  const footer = document.getElementById('docs-nav-footer');

  pageContent.classList.add('animating');

  if (docId === HOME_ID) {
    // Landing view
    pageContent.innerHTML = renderHome();
    footer.style.display = 'none';
    updateBreadcrumb(null);
  } else {
    const doc = _byId[docId];
    if (!doc) return;

    const content = await loadMarkdown(doc.path);
    pageContent.innerHTML = content;

    // Convert emojis in markdown content to site SVG icons (site rule: no emoji)
    replaceEmojisInNode(pageContent);

    // Rewrite in-doc [text](file.md) links → internal navigation
    rewriteInternalLinks(pageContent);

    // Syntax highlighting (guard for cases where hljs failed to load)
    if (window.hljs) {
      pageContent.querySelectorAll('pre code').forEach(b => {
        try { hljs.highlightElement(b); } catch (_) {}
      });
    }

    footer.style.display = '';
    updateBreadcrumb(doc);
    updateNavButtons(doc);
    updatePageCounter(docId);
  }

  setTimeout(() => pageContent.classList.remove('animating'), 350);

  highlightTOC(docId);
  updateBookmarkButton();
  scrollToTop();
  if (window.Icons?.replaceAll) window.Icons.replaceAll(pageContent);

  if (pushState) {
    const qs = docId === HOME_ID ? '' : `?doc=${encodeURIComponent(docId)}`;
    history.pushState({ docId }, '', qs || location.pathname);
  }
}

function renderHome() {
  const user = (typeof Auth !== 'undefined') ? Auth.getUser?.() : null;
  const teamName = (user?.team || 'sm').toUpperCase();
  const totalDocs = DOCS_INDEX.length;

  let sectionsHtml = '';
  SECTIONS.forEach(section => {
    const docs = DOCS_INDEX.filter(d => d.section === section.id);
    if (!docs.length) return;
    sectionsHtml += `
      <div class="docs-home-section">
        <div class="docs-home-section-head">
          <span class="icon-badge"><i data-icon="${section.icon}"></i></span>
          <h2>${escHtml(section.title)}</h2>
          <span class="count">${docs.length}</span>
        </div>
        <div class="docs-card-grid">
          ${docs.map(d => `
            <div class="docs-card" onclick="navigateTo('${escHtml(d.id)}')">
              <div class="docs-card-title">
                <i data-icon="file-text"></i>
                <span>${escHtml(d.title)}</span>
              </div>
              <p class="docs-card-desc">${escHtml(d.desc || '')}</p>
              <span class="docs-card-arrow"><i data-icon="arrow-right"></i></span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  return `
    <div class="docs-home">
      <div class="docs-home-hero">
        <span class="docs-home-eyebrow">
          <i data-icon="book"></i>
          <span>SOM-Portal · Multi-Team</span>
        </span>
        <h1 class="docs-home-title">คู่มือการใช้งาน SOM-Portal</h1>
        <p class="docs-home-lead">
          Documentation ครบทุกฟีเจอร์ของ SOM-Portal — internal Service Operations
          dashboard สำหรับทีม Ascend / TrueMoney ที่รองรับหลายทีมในระบบเดียว.
          เลือกหัวข้อจากด้านล่างหรือใช้ <strong>สารบัญ</strong> ทางซ้ายเพื่อไปยังหน้าที่ต้องการ.
        </p>
        <div class="docs-home-meta">
          <div class="docs-home-meta-item">
            <i data-icon="folder"></i>
            <span><strong>${SECTIONS.length}</strong> หมวดหลัก</span>
          </div>
          <div class="docs-home-meta-item">
            <i data-icon="file-text"></i>
            <span><strong>${totalDocs}</strong> เอกสาร</span>
          </div>
          <div class="docs-home-meta-item">
            <i data-icon="users"></i>
            <span>ทีมปัจจุบัน · <strong>${escHtml(teamName)}</strong></span>
          </div>
          <div class="docs-home-meta-item">
            <i data-icon="command"></i>
            <span>ค้นหา · <strong>Ctrl + K</strong></span>
          </div>
        </div>
      </div>
      ${sectionsHtml}
    </div>
  `;
}

function nextPage() {
  if (currentDocId === HOME_ID) return;
  const doc = _byId[currentDocId];
  if (doc?.next) navigateTo(doc.next);
}
function prevPage() {
  if (currentDocId === HOME_ID) return;
  const doc = _byId[currentDocId];
  if (doc?.prev) navigateTo(doc.prev);
}
function scrollToTop() {
  const p = document.getElementById('docs-page');
  if (p) p.scrollTop = 0;
}

// ══════════════════════════════════════════════════
// Markdown loading
// ══════════════════════════════════════════════════

async function loadMarkdown(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();

    if (window.marked?.setOptions) {
      marked.setOptions({ gfm: true, breaks: true, headerIds: true, mangle: false });
    }
    const html = window.marked ? marked.parse(md) : `<pre>${escHtml(md)}</pre>`;
    return window.DOMPurify
      ? DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ALLOW_DATA_ATTR: true })
      : html;
  } catch (err) {
    console.error('Failed to load:', path, err);
    return `
      <div style="padding:40px;text-align:center;color:var(--danger)">
        <h2>ไม่สามารถโหลดเอกสารได้</h2>
        <p style="color:var(--text-muted)">ไฟล์: <code>${escHtml(path)}</code></p>
        <p style="color:var(--text-muted)">${escHtml(err.message)}</p>
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════
// UI updates
// ══════════════════════════════════════════════════

function updateBreadcrumb(doc) {
  const el = document.getElementById('breadcrumb');
  if (!doc) {
    el.textContent = 'SOM-Portal · Multi-Team คู่มือใช้งาน';
    return;
  }
  const sect = _sectionMeta[doc.section];
  el.textContent = `${sect ? sect.title : ''} · ${doc.title}`;
}

function updateNavButtons(doc) {
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const prevTitle = document.getElementById('prev-title');
  const nextTitle = document.getElementById('next-title');

  if (doc.prev) {
    prevBtn.disabled = false;
    prevTitle.textContent = _byId[doc.prev].title;
  } else {
    prevBtn.disabled = true;
    prevTitle.textContent = '—';
  }
  if (doc.next) {
    nextBtn.disabled = false;
    nextTitle.textContent = _byId[doc.next].title;
  } else {
    nextBtn.disabled = true;
    nextTitle.textContent = '—';
  }
}

function updatePageCounter(docId) {
  const idx = DOCS_INDEX.findIndex(d => d.id === docId);
  document.getElementById('current-page').textContent = idx >= 0 ? idx + 1 : '—';
}

// ══════════════════════════════════════════════════
// Search
// ══════════════════════════════════════════════════

async function buildSearchIndex() {
  if (isSearchIndexReady) return;
  for (const doc of DOCS_INDEX) {
    try {
      const html = await loadMarkdown(doc.path);
      searchIndex.push({ doc, content: stripHTML(html).toLowerCase() });
    } catch (err) {
      console.error('Index failed:', doc.path, err);
    }
  }
  isSearchIndexReady = true;
}

function stripHTML(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || '';
}

function openSearchModal() {
  document.getElementById('search-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('search-input').focus(), 30);
}

function closeSearchModal() {
  document.getElementById('search-modal').style.display = 'none';
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML =
    '<p class="text-muted">พิมพ์เพื่อค้นหาในเอกสารทั้งหมด</p>';
}

function handleSearch(e) {
  const q = e.target.value.trim();
  const box = document.getElementById('search-results');
  if (!q) {
    box.innerHTML = '<p class="text-muted">พิมพ์เพื่อค้นหาในเอกสารทั้งหมด</p>';
    return;
  }
  if (!isSearchIndexReady) {
    box.innerHTML = '<p class="text-muted">กำลังสร้าง search index…</p>';
    return;
  }
  displaySearchResults(search(q), q);
}

function search(query) {
  const q = query.toLowerCase();
  const out = [];
  for (const item of searchIndex) {
    const titleMatch = item.doc.title.toLowerCase().includes(q);
    const idx = item.content.indexOf(q);
    if (titleMatch || idx !== -1) {
      out.push({
        doc: item.doc,
        snippet: idx !== -1 ? extractSnippet(item.content, idx, 160) : (item.doc.desc || '')
      });
    }
  }
  return out.slice(0, 20);
}

function extractSnippet(text, idx, len) {
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + len);
  let s = text.substring(start, end);
  if (start > 0) s = '…' + s;
  if (end < text.length) s = s + '…';
  return s;
}

function displaySearchResults(results, query) {
  const box = document.getElementById('search-results');
  if (!results.length) {
    box.innerHTML = '<p class="text-muted">ไม่พบผลลัพธ์</p>';
    return;
  }
  box.innerHTML = results.map(r => `
    <div class="search-result-item" onclick="navigateFromSearch('${escHtml(r.doc.id)}')">
      <div class="search-result-section">${escHtml(_sectionMeta[r.doc.section]?.title || '')}</div>
      <div class="search-result-title">${escHtml(r.doc.title)}</div>
      <div class="search-result-snippet">${highlightQuery(escHtml(r.snippet), query)}</div>
    </div>
  `).join('');
}

function highlightQuery(text, query) {
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
}

function navigateFromSearch(docId) {
  closeSearchModal();
  navigateTo(docId);
}

// ══════════════════════════════════════════════════
// Bookmarks
// ══════════════════════════════════════════════════

function getBookmarks() {
  try { return JSON.parse(localStorage.getItem('som_doc_bookmarks') || '[]'); }
  catch { return []; }
}
function saveBookmarks(bs) {
  localStorage.setItem('som_doc_bookmarks', JSON.stringify(bs));
}
function isBookmarked(id) {
  return getBookmarks().some(b => b.id === id);
}

function toggleBookmark() {
  if (currentDocId === HOME_ID) return;
  if (isBookmarked(currentDocId)) removeBookmark(currentDocId);
  else addBookmark(currentDocId);
}

function addBookmark(id) {
  const doc = _byId[id];
  if (!doc) return;
  const bs = getBookmarks();
  if (bs.find(b => b.id === id)) return;
  bs.push({
    id, title: doc.title, section: doc.section, path: doc.path,
    date: new Date().toISOString()
  });
  saveBookmarks(bs);
  window.Toast?.success?.('เพิ่มบุ๊กมาร์กแล้ว');
  updateBookmarkButton();
}

function removeBookmark(id) {
  saveBookmarks(getBookmarks().filter(b => b.id !== id));
  window.Toast?.success?.('ลบบุ๊กมาร์กแล้ว');
  updateBookmarkButton();
}

function updateBookmarkButton() {
  const btn = document.getElementById('bookmark-btn');
  if (!btn) return;
  if (currentDocId === HOME_ID) {
    btn.classList.remove('active');
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.classList.toggle('active', isBookmarked(currentDocId));
  }
}

function openBookmarksModal() {
  const box = document.getElementById('bookmarks-list');
  const bs = getBookmarks();
  if (!bs.length) {
    box.innerHTML = '<p class="text-muted">ยังไม่มีบุ๊กมาร์ก · คลิกไอคอน bookmark ในหน้าใด ๆ เพื่อบันทึก</p>';
  } else {
    box.innerHTML = bs.map(b => {
      const date = new Date(b.date).toLocaleDateString('th-TH');
      const sect = _sectionMeta[b.section]?.title || b.section;
      return `
        <div class="bookmark-item">
          <div class="bookmark-info" onclick="navigateFromBookmark('${escHtml(b.id)}')">
            <div class="bookmark-title">${escHtml(b.title)}</div>
            <div class="bookmark-date">${escHtml(sect)} · ${escHtml(date)}</div>
          </div>
          <button class="bookmark-remove" onclick="removeBookmarkFromModal('${escHtml(b.id)}')">Remove</button>
        </div>
      `;
    }).join('');
  }
  document.getElementById('bookmarks-modal').style.display = 'flex';
}

function closeBookmarksModal() {
  document.getElementById('bookmarks-modal').style.display = 'none';
}
function navigateFromBookmark(id) {
  closeBookmarksModal();
  navigateTo(id);
}
function removeBookmarkFromModal(id) {
  removeBookmark(id);
  openBookmarksModal();
}

// ══════════════════════════════════════════════════
// Print
// ══════════════════════════════════════════════════

function printCurrentDoc() {
  if (currentDocId === HOME_ID) {
    window.Toast?.warning?.('เลือกเอกสารก่อนพิมพ์');
    return;
  }
  const doc = _byId[currentDocId];
  const content = document.getElementById('page-content').innerHTML;
  const sect = _sectionMeta[doc.section]?.title || '';
  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
    <title>${escHtml(doc.title)} — SOM-Portal Documentation</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.75;color:#222}
      h1{font-size:28px;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid #e5e5e5}
      h2{font-size:22px;margin:32px 0 12px}
      h3{font-size:18px;margin:24px 0 10px}
      p{margin:12px 0}
      code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:13px;font-family:'JetBrains Mono',monospace}
      pre{background:#f5f5f5;padding:16px;border-radius:8px;overflow-x:auto;margin:16px 0}
      pre code{background:none;padding:0}
      table{border-collapse:collapse;width:100%;margin:20px 0}
      th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}
      th{background:#f5f5f5;font-weight:600}
      a{color:#F26419}
      blockquote{border-left:4px solid #F26419;padding:8px 16px;margin:16px 0;background:#fff4ee}
      .print-header{text-align:center;margin-bottom:40px;padding-bottom:20px;border-bottom:1px solid #e5e5e5}
      .print-header h1{border:0;margin:0}
      .print-header p{color:#666;margin:8px 0 0 0;font-size:13px}
      @media print{body{margin:20px}}
    </style></head><body>
      <div class="print-header">
        <h1>${escHtml(doc.title)}</h1>
        <p>${escHtml(sect)} · SOM-Portal Documentation</p>
      </div>
      ${content}
    </body></html>
  `);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ══════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════

// Rewrite in-doc markdown links (`[Dashboard](dashboard.md)`, `[Board](./board.md)`)
// so clicking them stays in the SPA viewer instead of hitting the raw URL.
// External links (http/https/mailto/anchors) are left alone.
function rewriteInternalLinks(root) {
  if (!root) return;
  root.querySelectorAll('a[href]').forEach(a => {
    const raw = a.getAttribute('href') || '';
    // Skip external / mailto / pure fragments — leave them as-is.
    if (/^(https?:|mailto:|tel:|#)/i.test(raw)) return;

    // Split href from any fragment for later re-appending (#section).
    const [pathPart, hashPart] = raw.split('#');
    // Take the last segment (drop ./ or ../ or full sub-path) and strip .md.
    const filename = pathPart.split('/').pop().toLowerCase();
    const stem = filename.replace(/\.md$/i, '');
    const targetId = _byFilename[filename] || _byFilename[stem];

    if (!targetId) return;   // unknown target → leave as-is (will 404 like before)

    a.setAttribute('href', `?doc=${encodeURIComponent(targetId)}${hashPart ? '#' + hashPart : ''}`);
    a.addEventListener('click', ev => {
      // Let the user open in a new tab with Cmd/Ctrl-click as usual.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
      ev.preventDefault();
      navigateTo(targetId);
      if (hashPart) {
        setTimeout(() => {
          const el = document.getElementById(hashPart);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 380);
      }
    });
  });
}

// Walk text nodes and swap emoji chars → SVG icons (site rule: no emoji in HTML).
// Uses window.Icons.emojiMap + Icons.svg from layout.js. Unmapped emojis are
// stripped so section titles like "🏠 หน้าหลัก" render cleanly.
function replaceEmojisInNode(root) {
  if (!root || !window.Icons) return;
  const map = window.Icons.emojiMap || {};
  // Match a broad range of emoji code points (BMP + surrogate pairs + VS16).
  const RE = /(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*️?)/gu;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    // Skip inside <pre>/<code> so code samples are untouched.
    let p = node.parentElement;
    let inCode = false;
    while (p && p !== root) {
      const tag = p.tagName;
      if (tag === 'CODE' || tag === 'PRE') { inCode = true; break; }
      p = p.parentElement;
    }
    if (inCode) continue;
    if (RE.test(node.nodeValue)) { RE.lastIndex = 0; targets.push(node); }
  }

  targets.forEach(textNode => {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(RE, (match, offset) => {
      if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
      const iconName = map[match] || map[match.replace(/️/g, '')];
      if (iconName && Icons.has?.(iconName)) {
        const span = document.createElement('span');
        span.className = 'md-emoji-icon';
        span.innerHTML = Icons.svg(iconName, { w: 16, h: 16 });
        frag.appendChild(span);
      }
      // else: strip silently
      last = offset + match.length;
      return match;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function cssEsc(str) {
  return String(str ?? '').replace(/["\\]/g, '\\$&');
}
