// board — page script, extracted from board.html.
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
  Layout.render('board');

  const currentUser = Auth.getUser();
  let allPosts = [];
  let uploadedImageUrl = null;
  let boardConfig = { categories: [], service_types: [] };
  let activeTab = '';  // board_type id, '' = all
  let userAvatarMap = {};  // { userId: avatar_url }
  let allUsers = [];        // [{id,name,username,avatar_url}]
  let postMentions = [];    // [{id,name}] for current post create/edit form
  let cmtMentions  = [];    // [{id,name}] for current comment form
  let cmtCurrentPostId = null;
  let commentCountMap = {}; // { postId: count }
  // Pagination
  let boardOffset = 0;
  let boardTotal  = 0;
  let historyPanelOpen = false;
  const BOARD_PAGE_SIZE = 100;   // Kanban shows all posts across columns

  const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' };
  const STATUS_ORDER  = ['open', 'in_progress', 'resolved'];

  // Drag state
  let _dragPostId = null;
  let _dragFromStatus = null;

  // ── Starred tab ─────────────────────────────────────────
  let isStarredTab = false;

  // ── Real-time poll ──────────────────────────────────────
  let _lastLoadTs  = new Date().toISOString();
  let _pollTimer   = null;
  const POLL_MS    = 30000; // 30 seconds

  // ── Markdown renderer (marked.js + DOMPurify) ───────────
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    DOMPurify.addHook('afterSanitizeAttributes', node => {
      if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    });
  }
  function renderMd(text) {
    if (!text) return '';
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return escHtml(text);
    const raw = marked.parse(String(text));
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['p','br','strong','em','code','pre','ul','ol','li','blockquote',
                     'a','h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tr','th','td','del','s',
                     'img'],
      ALLOWED_ATTR: ['href','target','rel','class','src','alt','title','width','height'],
      FORCE_BODY:   true,
    });
  }
  // Plain-text excerpt (for card preview — no HTML)
  function mdExcerpt(text, maxLen = 120) {
    if (!text) return '';
    const stripped = text.replace(/[#*_`~>\[\]!]/g, '').replace(/\n+/g, ' ').trim();
    return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
  }

  // Extract first inline image URL from markdown content
  function extractFirstImageUrl(content) {
    if (!content) return null;
    const m = content.match(/!\[.*?\]\((.*?)\)/);
    return m ? m[1] : null;
  }

  // Load user avatars + user list for @mention
  API.users.avatars().then(res => {
    if (res?.ok) {
      const users = res.data.data || [];
      users.forEach(u => { userAvatarMap[u.id] = u.avatar_url || ''; });
      allUsers = users.map(u => ({ id: u.id, name: u.name || '', username: u.username || '', avatar_url: u.avatar_url || '' }));
      // Set my avatar in comment box
      const me = users.find(u => u.id === currentUser.id);
      const myAvEl = document.getElementById('cmt-my-avatar');
      if (myAvEl) {
        myAvEl.style.background = _authorColor(currentUser.id);
        if (me?.avatar_url) {
          myAvEl.innerHTML = `<img src="${escHtml(me.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
          myAvEl.textContent = getInitials(currentUser.name || '?');
        }
      }
      // Re-render visible cards to update avatars
      document.querySelectorAll('[data-author-id]').forEach(el => {
        const uid = el.dataset.authorId;
        const name = el.dataset.authorName || '';
        el.innerHTML = _avatarHtml(uid, name);
      });
    }
  });

  // ── @Mention picker ──────────────────────────────────────
  function initMentionPicker(textarea, dropdownEl, getMentions, setMentions) {
    let matchStart = -1;
    let _lastQ = null;
    textarea.addEventListener('input', () => {
      const text   = textarea.value;
      const cursor = textarea.selectionStart;
      const before = text.slice(0, cursor);
      const match  = before.match(/@(\w*)$/);
      if (!match) { dropdownEl.style.display = 'none'; return; }
      matchStart = cursor - match[0].length;
      const q = match[1].toLowerCase();
      if (q === _lastQ) return; // skip rebuild if query unchanged
      _lastQ = q;

      // Build list: @allsm first (if query matches), then individual users
      const showAll = 'allsm'.startsWith(q) || q === '';
      const hits = allUsers.filter(u =>
        u.name.toLowerCase().startsWith(q) || u.username.toLowerCase().startsWith(q)
      ).slice(0, showAll ? 6 : 7);
      if (!showAll && !hits.length) { dropdownEl.style.display = 'none'; return; }

      const allsmItem = showAll
        ? `<div class="mention-opt sel" data-idx="0" data-id="__all__" data-name="allsm" style="border-bottom:1px solid var(--border)">
            <div class="mention-opt-av" style="background:#7c3aed;font-size:13px">👥</div>
            <div>
              <span class="mention-opt-name" style="color:#7c3aed">All SM Team</span>
              <div style="font-size:10px;color:var(--text-muted);margin-top:1px">Notify everyone in the team</div>
            </div>
            <span class="mention-opt-user">@allsm</span>
          </div>`
        : '';
      const offset = showAll ? 1 : 0;

      dropdownEl.style.display = 'block';
      dropdownEl.innerHTML = allsmItem + hits.map((u, i) =>
        `<div class="mention-opt${!showAll && i===0?' sel':''}" data-idx="${i+offset}" data-id="${escHtml(u.id)}" data-name="${escHtml(u.name)}">
          <div class="mention-opt-av" style="background:${_authorColor(u.id)}">${u.avatar_url ? `<img src="${escHtml(u.avatar_url)}">` : escHtml(getInitials(u.name))}</div>
          <span class="mention-opt-name">${escHtml(u.name)}</span>
          <span class="mention-opt-user">@${escHtml(u.username)}</span>
        </div>`).join('');
      dropdownEl.dataset.sel = '0';
      dropdownEl.querySelectorAll('.mention-opt').forEach(opt => {
        opt.addEventListener('mousedown', e => {
          e.preventDefault();
          insertMention(textarea, dropdownEl, matchStart, getMentions, setMentions, opt.dataset.id, opt.dataset.name);
        });
      });
    });
    textarea.addEventListener('keydown', e => {
      if (dropdownEl.style.display === 'none') return;
      const opts = dropdownEl.querySelectorAll('.mention-opt');
      let sel = parseInt(dropdownEl.dataset.sel || '0');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        opts[sel]?.classList.remove('sel');
        sel = (sel + 1) % opts.length;
        opts[sel]?.classList.add('sel');
        dropdownEl.dataset.sel = sel;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        opts[sel]?.classList.remove('sel');
        sel = (sel - 1 + opts.length) % opts.length;
        opts[sel]?.classList.add('sel');
        dropdownEl.dataset.sel = sel;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const chosen = opts[sel];
        if (chosen) { e.preventDefault(); insertMention(textarea, dropdownEl, matchStart, getMentions, setMentions, chosen.dataset.id, chosen.dataset.name); }
      } else if (e.key === 'Escape') {
        dropdownEl.style.display = 'none'; _lastQ = null;
      }
    });
    document.addEventListener('click', e => {
      if (!dropdownEl.contains(e.target) && e.target !== textarea) {
        dropdownEl.style.display = 'none'; _lastQ = null;
      }
    });
  }

  function insertMention(textarea, dropdown, start, getMentions, setMentions, uid, uname) {
    const text     = textarea.value;
    const cursor   = textarea.selectionStart;
    const before   = text.slice(0, start);
    const after    = text.slice(cursor);
    const tag      = `@${uname} `;
    textarea.value = before + tag + after;
    const pos      = (before + tag).length;
    textarea.setSelectionRange(pos, pos);
    const cur = getMentions();
    if (!cur.find(m => m.id === uid)) setMentions([...cur, { id: uid, name: uname }]);
    dropdown.style.display = 'none';
    textarea.focus();
  }

  // Init mention picker on post-content textarea
  initMentionPicker(
    document.getElementById('post-content'),
    document.getElementById('post-mention-dd'),
    () => postMentions,
    v => postMentions = v
  );
  // Init mention picker on comment textarea
  initMentionPicker(
    document.getElementById('cmt-input'),
    document.getElementById('cmt-mention-dd'),
    () => cmtMentions,
    v => cmtMentions = v
  );

  // ── Load config (tabs + service types) ─────────────────
  async function loadConfig() {
    const res = await API.boardConfig.get();
    if (res?.ok) {
      boardConfig = res.data.data || { categories: [], service_types: [] };
      renderTabs();
      populateBoardTypeSelect();
      populateServiceTypeSelect();
    }
  }

  function renderTabs() {
    const container = document.getElementById('board-tabs');
    const tabsHtml = boardConfig.categories
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(c => `<div class="board-tab" data-type="${escHtml(c.id)}" onclick="switchTab(this,'${c.id}')">${escHtml(c.name)}</div>`)
      .join('');
    container.innerHTML = `<div class="board-tab active" data-type="" onclick="switchTab(this,'')">All</div>${tabsHtml}<div class="board-tab" data-type="__starred__" onclick="switchStarred(this)" style="margin-left:auto">★ Starred</div>`;
  }

  function _boardUpdateUrl() {
    const _p = new URLSearchParams();
    if (isStarredTab) _p.set('tab', '__starred__');
    else if (activeTab) _p.set('tab', activeTab);
    const _q = document.getElementById('search-input')?.value.trim();
    if (_q) _p.set('q', _q);
    history.replaceState(null, '', _p.toString() ? '?' + _p.toString() : location.pathname);
  }

  function switchTab(el, typeId) {
    document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    activeTab    = typeId;
    isStarredTab = false;
    boardOffset  = 0;
    _boardUpdateUrl();
    loadPosts();
  }

  function switchStarred(el) {
    document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    isStarredTab = true;
    activeTab    = '';
    boardOffset  = 0;
    _boardUpdateUrl();
    loadPosts();
  }

  function populateBoardTypeSelect() {
    const sel = document.getElementById('post-board-type');
    const opts = boardConfig.categories
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`)
      .join('');
    sel.innerHTML = `<option value="">— Select Board —</option>${opts}`;
  }

  function populateServiceTypeSelect() {
    const sel = document.getElementById('post-service-type');
    const opts = boardConfig.service_types
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(st => `<option value="${escHtml(st.id)}" data-name="${escHtml(st.name)}">${escHtml(st.name)}</option>`)
      .join('');
    sel.innerHTML = `<option value="">— Select —</option>${opts}<option value="__new_st__" style="color:var(--orange);font-weight:600">+ เพิ่ม Service Type ใหม่...</option>`;
    document.getElementById('post-service-subtype').innerHTML = '<option value="">— Select —</option>';
    document.getElementById('new-st-row').style.display = 'none';
    document.getElementById('new-sst-row').style.display = 'none';
  }

  function onServiceTypeChange() {
    const stId = document.getElementById('post-service-type').value;

    if (stId === '__new_st__') {
      document.getElementById('post-service-type').value = '';
      document.getElementById('new-st-row').style.display = 'block';
      document.getElementById('new-st-name').focus();
      return;
    }

    document.getElementById('new-st-row').style.display = 'none';
    document.getElementById('new-sst-row').style.display = 'none';

    const st = boardConfig.service_types.find(s => s.id === stId);
    const sel = document.getElementById('post-service-subtype');

    if (!stId) {
      sel.innerHTML = '<option value="">— Select —</option>';
      return;
    }
    if (!st || !st.subtypes?.length) {
      sel.innerHTML = `<option value="">— None —</option><option value="__new_sst__" style="color:var(--orange);font-weight:600">+ เพิ่ม Sub Type ใหม่...</option>`;
      return;
    }
    const opts = st.subtypes
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(s => `<option value="${escHtml(s.id)}" data-name="${escHtml(s.name)}">${escHtml(s.name)}</option>`)
      .join('');
    sel.innerHTML = `<option value="">— Select —</option>${opts}<option value="__new_sst__" style="color:var(--orange);font-weight:600">+ เพิ่ม Sub Type ใหม่...</option>`;
  }

  function onSubtypeChange() {
    const sstId = document.getElementById('post-service-subtype').value;
    if (sstId === '__new_sst__') {
      document.getElementById('post-service-subtype').value = '';
      document.getElementById('new-sst-row').style.display = 'block';
      document.getElementById('new-sst-name').focus();
    }
  }

  async function saveNewServiceType() {
    const input = document.getElementById('new-st-name');
    const name = input.value.trim();
    if (!name) return;
    const res = await API.boardConfig.addServiceType({ name });
    if (!res?.ok) { Toast.error(res?.data?.message || 'เพิ่มไม่สำเร็จ'); return; }
    const cfgRes = await API.boardConfig.get();
    if (cfgRes?.ok) boardConfig = cfgRes.data.data || boardConfig;
    populateServiceTypeSelect();
    const newSt = boardConfig.service_types.find(s => s.name === name);
    if (newSt) {
      document.getElementById('post-service-type').value = newSt.id;
      onServiceTypeChange();
    }
    input.value = '';
    Toast.success(`เพิ่ม Service Type "${name}" แล้ว`);
  }

  function cancelNewServiceType() {
    document.getElementById('new-st-row').style.display = 'none';
    document.getElementById('new-st-name').value = '';
  }

  async function saveNewSubtype() {
    const stId = document.getElementById('post-service-type').value;
    if (!stId) { Toast.error('กรุณาเลือก Service Type ก่อน'); return; }
    const input = document.getElementById('new-sst-name');
    const name = input.value.trim();
    if (!name) return;
    const res = await API.boardConfig.addSubtype(stId, { name });
    if (!res?.ok) { Toast.error(res?.data?.message || 'เพิ่มไม่สำเร็จ'); return; }
    const cfgRes = await API.boardConfig.get();
    if (cfgRes?.ok) boardConfig = cfgRes.data.data || boardConfig;
    onServiceTypeChange();
    const st = boardConfig.service_types.find(s => s.id === stId);
    const newSst = st?.subtypes?.find(s => s.name === name);
    if (newSst) document.getElementById('post-service-subtype').value = newSst.id;
    input.value = '';
    document.getElementById('new-sst-row').style.display = 'none';
    Toast.success(`เพิ่ม Sub Type "${name}" แล้ว`);
  }

  function cancelNewSubtype() {
    document.getElementById('new-sst-row').style.display = 'none';
    document.getElementById('new-sst-name').value = '';
  }

  // ── Load posts (Kanban shows all in one page) ───────────
  async function loadPosts(append = false) {
    if (!append) { boardOffset = 0; allPosts = []; }
    const search = document.getElementById('search-input').value.trim();
    const res = await API.board.list(search, activeTab, '', BOARD_PAGE_SIZE, boardOffset, isStarredTab);
    if (!res?.ok) { Toast.error('Failed to load posts'); return; }
    const { items = [], total = 0 } = res.data.data || {};
    boardTotal = total;
    allPosts   = append ? allPosts.concat(items) : items;
    boardOffset = allPosts.length;
    renderKanban(allPosts, boardOffset < boardTotal);

    // Update poll baseline after each full load
    if (!append) {
      _lastLoadTs = new Date().toISOString();
      hideBanner();
    }
  }

  // ── Real-time poll ──────────────────────────────────────
  function startBoardPoller() {
    if (_pollTimer) return;
    _pollTimer = setInterval(async () => {
      if (document.hidden || isStarredTab) return;
      try {
        const r = await API.board.poll(_lastLoadTs);
        if (!r?.ok) return;
        const { count = 0 } = r.data.data || {};
        if (count > 0) showBanner(count);
      } catch {}
    }, POLL_MS);
  }

  function showBanner(count) {
    const b = document.getElementById('new-posts-banner');
    document.getElementById('new-posts-text').textContent =
      count === 1 ? 'มี 1 โพสต์ใหม่' : `มี ${count} โพสต์ใหม่`;
    b.style.display = 'flex';
  }
  function hideBanner() {
    document.getElementById('new-posts-banner').style.display = 'none';
  }
  function reloadAndDismissBanner() { hideBanner(); loadPosts(); }
  function dismissBanner(e) { if (e) e.stopPropagation(); hideBanner(); }

  // Render a mention-highlighted text (plain text with @Name → styled span)
  function renderMentionText(text, mentions) {
    let out = escHtml(text);
    (mentions || []).forEach(m => {
      const isAll   = m.id === '__all__';
      const escaped = escHtml(m.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cls     = isAll ? 'mention-tag all' : 'mention-tag';
      out = out.replace(new RegExp('@' + escaped, 'g'), `<span class="${cls}">@${escHtml(m.name)}</span>`);
    });
    return out;
  }

  // ── Render Kanban board ──────────────────────────────────
  function renderKanban(posts, hasMore = false) {
    // Split into pinned + status buckets
    const pinned = posts.filter(p => p.pinned);
    const buckets = { open: [], in_progress: [], resolved: [] };
    posts.forEach(p => {
      const st = STATUS_ORDER.includes(p.status) ? p.status : 'open';
      buckets[st].push(p);
    });

    // Pin strip
    const pinStrip = document.getElementById('pin-strip');
    const pinScroll = document.getElementById('pin-strip-scroll');
    const pinCount = document.getElementById('pin-strip-count');
    if (pinned.length) {
      pinStrip.style.display = 'flex';
      pinCount.textContent = pinned.length;
      pinScroll.innerHTML = pinned.map(p => buildPinChip(p)).join('');
    } else {
      pinStrip.style.display = 'none';
    }

    // Columns
    STATUS_ORDER.forEach(st => {
      const body = document.getElementById('col-body-' + st);
      const cnt  = document.getElementById('col-count-' + st);
      cnt.textContent = buckets[st].length;
      if (buckets[st].length === 0) {
        body.innerHTML = `<div class="kanban-col-empty">No ${STATUS_LABELS[st].toLowerCase()} posts.<br>Drop a card here to move it.</div>`;
      } else {
        body.innerHTML = buckets[st].map(p => buildKanbanCard(p)).join('');
      }
    });

    // Load more (rare — only if >100 posts)
    if (hasMore) {
      const wrap = document.getElementById('board-container');
      let btn = document.getElementById('kanban-load-more');
      if (!btn) {
        btn = document.createElement('div');
        btn.id = 'kanban-load-more';
        btn.style.cssText = 'text-align:center;padding:8px 0;flex-shrink:0';
        btn.innerHTML = `<button class="btn btn-ghost" onclick="loadPosts(true)" style="font-size:12px;padding:6px 24px">Load more · ${boardTotal - boardOffset} more</button>`;
        wrap.appendChild(btn);
      } else {
        btn.querySelector('button').textContent = `Load more · ${boardTotal - boardOffset} more`;
      }
    } else {
      document.getElementById('kanban-load-more')?.remove();
    }

    // Refresh comment counts
    posts.forEach(p => {
      const el = document.getElementById('cmt-n-' + p.id);
      if (el) el.textContent = commentCountMap[p.id] !== undefined ? commentCountMap[p.id] : '—';
    });
    loadAllCommentCounts(posts.map(p => p.id));
  }

  async function loadAllCommentCounts(ids) {
    if (!ids.length) return;
    try {
      const r = await API.comments.counts(ids);
      if (!r?.ok) return;
      const map = r.data.data || {};
      Object.entries(map).forEach(([pid, cnt]) => {
        commentCountMap[pid] = cnt;
        const el = document.getElementById('cmt-n-' + pid);
        if (el) el.textContent = cnt;
      });
    } catch {}
  }

  // Generate consistent color from user id
  function _authorColor(id) {
    const palette = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#be185d'];
    let h = 0;
    for (let i = 0; i < (id || '').length; i++) h = (id.charCodeAt(i) + ((h << 5) - h)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  function _avatarHtml(authorId, authorName) {
    const url = userAvatarMap[authorId];
    if (url) return `<img src="${escHtml(url)}" alt="${escHtml(authorName)}" onerror="this.parentElement.style.background='${_authorColor(authorId)}';this.remove();this.parentElement.textContent='${escHtml(getInitials(authorName))}'">`;
    return escHtml(getInitials(authorName));
  }

  // ── Build one Kanban card (compact) ─────────────────────
  function buildKanbanCard(p) {
    const canEdit   = p.author_id === currentUser.id || Roles.canManage(currentUser.role);
    const canDrag   = canEdit;  // same permission as status edit (server enforces)
    const canPin    = Roles.canManage(currentUser.role);
    const canDelete = canEdit;

    // Thumbnail (only if inline image detected)
    const imgUrl  = p.image_url || extractFirstImageUrl(p.content);
    const imgHtml = imgUrl
      ? `<img class="k-card-thumb" src="${escHtml(imgUrl)}" alt="" onerror="this.style.display='none'">`
      : '';

    // Tags (skip status — column already conveys it)
    const tags = [];
    if (p.board_type_name)   tags.push(`<span class="badge badge-blue" style="font-size:9.5px;padding:1px 6px">${escHtml(p.board_type_name)}</span>`);
    if (p.service_type_name) {
      const label = p.service_subtype_name
        ? `${escHtml(p.service_type_name)} · ${escHtml(p.service_subtype_name)}`
        : escHtml(p.service_type_name);
      tags.push(`<span class="badge badge-gray" style="font-size:9.5px;padding:1px 6px">${label}</span>`);
    }
    const tagsHtml = tags.length ? `<div class="k-card-tags">${tags.join('')}</div>` : '';

    const excerpt = mdExcerpt(p.content || '', 90);
    const starIcon  = p.starred ? '<i data-icon="star"></i>' : '<i data-icon="star"></i>';
    const starStyle = p.starred ? 'color:#f59e0b' : 'color:var(--text-muted)';

    return `
      <div class="k-card${canDrag ? ' can-drag' : ''}" id="card-${p.id}"
           ${canDrag ? `draggable="true" ondragstart="onCardDragStart(event,'${p.id}','${p.status || 'open'}')" ondragend="onCardDragEnd(event)"` : ''}
           onclick="openDetail('${p.id}')">
        ${imgHtml}
        ${tagsHtml}
        <div class="k-card-title">${escHtml(p.title)}</div>
        ${excerpt ? `<div class="k-card-excerpt">${escHtml(excerpt)}</div>` : ''}
        <div class="k-card-foot">
          <div class="k-avatar"
               data-author-id="${escHtml(p.author_id)}"
               data-author-name="${escHtml(p.author_name)}"
               style="background:${_authorColor(p.author_id)}"
               title="${escHtml(p.author_name)}">${_avatarHtml(p.author_id, p.author_name)}</div>
          <span title="${DateTime.format(p.created_at)}">${DateTime.timeAgo(p.created_at)}</span>
          <span class="k-card-cmt" onclick="openDetail('${p.id}');event.stopPropagation()">💬 <span id="cmt-n-${p.id}">—</span></span>
          <div class="k-card-actions">
            <button class="btn btn-ghost btn-icon btn-sm" id="star-btn-${p.id}" data-tip="${p.starred ? 'Unstar' : 'Star'}" style="${starStyle}" onclick="toggleStar('${p.id}',event)">${starIcon}</button>
            ${canPin    ? `<button class="btn btn-ghost btn-icon btn-sm" data-tip="${p.pinned ? 'Unpin' : 'Pin'}" onclick="togglePin('${p.id}',event)">${p.pinned ? '📌' : '⊙'}</button>` : ''}
            ${canEdit   ? `<button class="btn btn-ghost btn-icon btn-sm" data-tip="Edit" onclick="editPost('${p.id}',event)"><i data-icon="pencil"></i></button>` : ''}
            ${canDelete ? `<button class="btn btn-ghost btn-icon btn-sm" data-tip="Delete" style="color:var(--danger)" onclick="deletePost('${p.id}',event)"><i data-icon="x"></i></button>` : ''}
          </div>
        </div>
      </div>`;
  }

  // ── Build one pinned chip (top strip) ───────────────────
  function buildPinChip(p) {
    const st = p.status || 'open';
    return `
      <div class="pin-chip" onclick="openDetail('${p.id}')">
        <div class="pin-chip-title">${escHtml(p.title)}</div>
        <div class="pin-chip-meta">
          <span class="status-badge status-${st}" style="padding:1px 6px;font-size:9px">${STATUS_LABELS[st] || st}</span>
          <span>·</span>
          <span>${escHtml(p.author_name)}</span>
          <span>·</span>
          <span>${DateTime.timeAgo(p.created_at)}</span>
        </div>
      </div>`;
  }

  // ── Drag & Drop ──────────────────────────────────────────
  function onCardDragStart(ev, postId, fromStatus) {
    ev.stopPropagation();
    _dragPostId     = postId;
    _dragFromStatus = fromStatus;
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', postId); } catch(e) {}
    const el = document.getElementById('card-' + postId);
    if (el) el.classList.add('dragging');
  }

  function onCardDragEnd(ev) {
    const el = ev.currentTarget;
    if (el) el.classList.remove('dragging');
    document.querySelectorAll('.kanban-col.drop-over').forEach(c => c.classList.remove('drop-over'));
    _dragPostId = null;
    _dragFromStatus = null;
  }

  function onColDragOver(ev, status) {
    if (!_dragPostId) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    ev.currentTarget.classList.add('drop-over');
  }

  function onColDragLeave(ev) {
    // Only remove if we're truly leaving the column (not entering a child)
    if (ev.currentTarget.contains(ev.relatedTarget)) return;
    ev.currentTarget.classList.remove('drop-over');
  }

  async function onColDrop(ev, newStatus) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drop-over');
    const postId = _dragPostId;
    const oldStatus = _dragFromStatus;
    _dragPostId = null;
    _dragFromStatus = null;
    if (!postId || !newStatus || newStatus === oldStatus) return;

    const post = allPosts.find(p => p.id === postId);
    if (!post) return;

    // Optimistic update
    post.status = newStatus;
    renderKanban(allPosts, boardOffset < boardTotal);

    const res = await API.board.update(postId, { status: newStatus });
    if (res?.ok) {
      Toast.success(`Moved to ${STATUS_LABELS[newStatus]}`);
    } else {
      // Rollback
      post.status = oldStatus;
      renderKanban(allPosts, boardOffset < boardTotal);
      Toast.error(res?.data?.message || 'Failed to update status');
    }
  }

  // ── Detail modal ─────────────────────────────────────────
  function openDetail(id) {
    const p = allPosts.find(x => x.id === id);
    if (!p) return;

    const canEdit   = p.author_id === currentUser.id || Roles.canManage(currentUser.role);
    const canPin    = Roles.canManage(currentUser.role);
    const canDelete = canEdit;

    // Image
    const img = document.getElementById('detail-img');
    if (p.image_url) { img.src = p.image_url; img.style.display = 'block'; }
    else             { img.src = ''; img.style.display = 'none'; }

    // Title
    document.getElementById('detail-modal-title').textContent = p.title;
    document.getElementById('detail-title').textContent = p.title;

    // Content (render as Markdown)
    document.getElementById('detail-content').innerHTML = renderMd(p.content || '');

    // Badges
    const pSt = p.status || 'open';
    const badges = [`<span class="status-badge status-${pSt}">${STATUS_LABELS[pSt] || pSt}</span>`];
    if (p.pinned) badges.push('<span class="badge badge-orange"><i data-icon="pin"></i> Pinned</span>');
    if (p.board_type_name) badges.push(`<span class="badge badge-blue" style="font-size:10px">${escHtml(p.board_type_name)}</span>`);
    if (p.service_type_name) {
      const label = p.service_subtype_name
        ? `${escHtml(p.service_type_name)} · ${escHtml(p.service_subtype_name)}`
        : escHtml(p.service_type_name);
      badges.push(`<span class="badge badge-gray" style="font-size:10px">${label}</span>`);
    }
    document.getElementById('detail-badges').innerHTML = badges.join('');

    // Edit history
    historyPanelOpen = false;
    const histSection = document.getElementById('detail-history-section');
    const history = p.edit_history || [];
    if (history.length) {
      histSection.style.display = '';
      document.getElementById('history-count-badge').textContent = history.length;
      document.getElementById('history-toggle-icon').innerHTML = '<i data-icon="play"></i>';
      document.getElementById('history-panel').style.display = 'none';
      document.getElementById('history-panel').innerHTML = history.map(h => `
        <div class="hist-item">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
            <span style="font-weight:700;color:var(--text)">${escHtml(h.editor_name)}</span>
            <span style="color:var(--text-muted);font-size:10px">${DateTime.timeAgo(h.edited_at)}</span>
            <span class="status-badge status-${escHtml(h.old_status || 'open')}" style="margin-left:auto">${STATUS_LABELS[h.old_status] || h.old_status || 'open'}</span>
          </div>
          ${h.old_title !== p.title ? `<div style="color:var(--text-muted);font-size:10px">Was: "${escHtml(h.old_title)}"</div>` : ''}
        </div>`).join('');
    } else {
      histSection.style.display = 'none';
    }

    // Meta
    const avatarColor = _authorColor(p.author_id);
    document.getElementById('detail-meta').innerHTML = `
      <div class="board-author-avatar-wrap" style="background:${avatarColor};cursor:pointer"
           onclick="window.location.href='./profile.html?user=${escHtml(p.author_id)}'"
           title="Click to view profile">${_avatarHtml(p.author_id, p.author_name)}</div>
      <span>${makeUserClickable(p.author_id, p.author_name)}</span>
      <span>·</span>
      <span>${DateTime.format(p.created_at)}</span>`;

    // Actions
    const isStarred = p.starred ?? false;
    let actionsHtml = `<button class="btn btn-ghost btn-sm" id="detail-star-btn" style="${isStarred ? 'color:#f59e0b' : ''}" onclick="toggleStar('${p.id}',event)">${isStarred ? '<i data-icon="star"></i> Starred' : '<i data-icon="star"></i> Star'}</button>`;
    if (canPin)    actionsHtml += `<button class="btn btn-ghost btn-sm" onclick="togglePin('${p.id}',event)">${p.pinned ? '<i data-icon="pin"></i> Unpin' : '⊙ Pin'}</button>`;
    if (canEdit)   actionsHtml += `<button class="btn btn-ghost btn-sm" onclick="editPost('${p.id}',event);Modal.close('detail-modal')">✎ Edit</button>`;
    if (canDelete) actionsHtml += `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deletePost('${p.id}',event);Modal.close('detail-modal')">✕ Delete</button>`;
    document.getElementById('detail-actions').innerHTML = actionsHtml;

    Modal.open('detail-modal');
    // Load comments
    cmtCurrentPostId   = id;
    cmtMentions = [];
    document.getElementById('cmt-input').value = '';
    loadComments(id);
  }

  // ── Comments ─────────────────────────────────────────────
  async function loadComments(postId) {
    const list = document.getElementById('comments-list');
    if (!list) return;
    list.innerHTML = `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:12px 0">Loading...</div>`;
    const res = await API.comments.list(postId);
    if (!res?.ok) { list.innerHTML = `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:12px 0">Failed to load comments</div>`; return; }
    const comments = res.data.data || [];

    // Update count
    commentCountMap[postId] = comments.length;
    const el = document.getElementById('cmt-n-' + postId);
    if (el) el.textContent = comments.length;

    // Section header
    const sectionHd = document.getElementById('comments-section');
    // Add/update header
    const existingHd = document.getElementById('cmt-section-hd');
    if (!existingHd) {
      const hd = document.createElement('div');
      hd.id = 'cmt-section-hd';
      hd.className = 'cmt-section-hd';
      hd.innerHTML = `<span class="cmt-section-title">Comments</span><span class="cmt-count-badge" id="cmt-count-badge">${comments.length}</span>`;
      sectionHd.insertBefore(hd, sectionHd.firstChild);
    } else {
      document.getElementById('cmt-count-badge').textContent = comments.length;
    }

    if (!comments.length) {
      list.innerHTML = `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:20px 0;opacity:.6">No comments yet — be the first!</div>`;
      return;
    }
    list.innerHTML = comments.map(c => buildComment(c)).join('');
  }

  function buildComment(c) {
    const canDel  = c.author_id === currentUser.id || Roles.canManage(currentUser.role);
    const canEdit = c.author_id === currentUser.id;
    const av = userAvatarMap[c.author_id];
    const avHtml = av
      ? `<img src="${escHtml(av)}" onerror="this.parentElement.style.background='${_authorColor(c.author_id)}';this.parentElement.textContent='${escHtml(getInitials(c.author_name))}';this.remove()">`
      : escHtml(getInitials(c.author_name));
    return `
      <div class="cmt-item" id="cmt-${escHtml(c.id)}">
        <div class="cmt-avatar" style="background:${_authorColor(c.author_id)};cursor:pointer"
             onclick="window.location.href='./profile.html?user=${escHtml(c.author_id)}'"
             title="Click to view profile">${avHtml}</div>
        <div class="cmt-bubble">
          <div class="cmt-bubble-head">
            <span class="cmt-author">${makeUserClickable(c.author_id, c.author_name)}</span>
            <span class="cmt-time">${DateTime.timeAgo(c.created_at)}</span>
          </div>
          <div class="cmt-text" id="cmt-text-${escHtml(c.id)}" data-raw="${escHtml(c.content)}">${renderMd(c.content)}</div>
          ${(canEdit || canDel) ? `
          <div class="cmt-actions">
            ${canEdit ? `<button class="cmt-edit-btn" onclick="startEditComment('${escHtml(c.id)}')">✎</button>` : ''}
            ${canDel  ? `<button class="cmt-del-btn"  onclick="deleteComment('${escHtml(c.id)}')">✕</button>`  : ''}
          </div>` : ''}
        </div>
      </div>`;
  }

  async function submitComment() {
    const input   = document.getElementById('cmt-input');
    const content = input.value.trim();
    if (!content) { input.focus(); return; }
    if (!cmtCurrentPostId) return;

    const btn = document.getElementById('cmt-send-btn');
    btn.disabled = true;
    btn.textContent = '...';

    const res = await API.comments.create({
      post_id:  cmtCurrentPostId,
      content,
      mentions: cmtMentions
    });

    btn.disabled = false;
    btn.textContent = 'Send';

    if (res?.ok) {
      trackBoardComment();
      const newComment = res.data.data;
      input.value = '';
      cmtMentions = [];

      // Optimistic insert — append immediately without full re-fetch
      const list = document.getElementById('comments-list');
      const empty = list?.querySelector('[style*="No comments"]');
      if (empty) list.innerHTML = '';
      if (list && newComment) {
        const div = document.createElement('div');
        div.innerHTML = buildComment(newComment);
        list.appendChild(div.firstElementChild);
        div.firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Update count
      const newCount = (commentCountMap[cmtCurrentPostId] || 0) + 1;
      commentCountMap[cmtCurrentPostId] = newCount;
      const chip = document.getElementById('cmt-n-' + cmtCurrentPostId);
      if (chip) chip.textContent = newCount;
      const badge = document.getElementById('cmt-count-badge');
      if (badge) badge.textContent = newCount;
    } else {
      Toast.error(res?.data?.message || 'Failed to post comment');
    }
  }

  // Send comment on Ctrl+Enter
  document.getElementById('cmt-input').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitComment();
    }
  });

  function startEditComment(id) {
    const textEl = document.getElementById('cmt-text-' + id);
    if (!textEl || textEl.querySelector('textarea')) return; // already editing

    // Grab raw markdown stored in data attribute, or strip HTML as fallback
    const raw = textEl.dataset.raw || textEl.innerText;
    textEl.dataset.raw = raw; // store for cancel

    textEl.innerHTML = `
      <textarea class="cmt-edit-area" id="cmt-edit-ta-${id}">${escHtml(raw)}</textarea>
      <div class="cmt-edit-btns">
        <button class="btn btn-primary btn-sm" onclick="saveEditComment('${id}')">บันทึก</button>
        <button class="btn btn-ghost btn-sm" onclick="cancelEditComment('${id}')">ยกเลิก</button>
      </div>`;
    document.getElementById('cmt-edit-ta-' + id)?.focus();
  }

  function cancelEditComment(id) {
    const textEl = document.getElementById('cmt-text-' + id);
    if (!textEl) return;
    const raw = textEl.dataset.raw || '';
    textEl.innerHTML = renderMd(raw);
  }

  async function saveEditComment(id) {
    const ta = document.getElementById('cmt-edit-ta-' + id);
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) return;

    const res = await API.comments.update(id, { content });
    if (res?.ok) {
      const textEl = document.getElementById('cmt-text-' + id);
      if (textEl) {
        textEl.dataset.raw = content;
        textEl.innerHTML = renderMd(content);
      }
    } else {
      Toast.error(res?.data?.message || 'แก้ไขไม่สำเร็จ');
    }
  }

  async function deleteComment(id) {
    const confirmed = await confirmDialog('Delete this comment?', 'Delete Comment');
    if (!confirmed) return;
    const res = await API.comments.delete(id);
    if (res?.ok) {
      document.getElementById('cmt-' + id)?.remove();
      // Update count
      if (cmtCurrentPostId) {
        const cnt = (commentCountMap[cmtCurrentPostId] || 1) - 1;
        commentCountMap[cmtCurrentPostId] = cnt;
        const el = document.getElementById('cmt-n-' + cmtCurrentPostId);
        if (el) el.textContent = cnt;
        const badge = document.getElementById('cmt-count-badge');
        if (badge) badge.textContent = cnt;
      }
    } else {
      Toast.error(res?.data?.message || 'Failed to delete');
    }
  }

  // Reset mentions when post modal is opened
  function resetPostMentions() { postMentions = []; }

  function toggleHistoryPanel() {
    historyPanelOpen = !historyPanelOpen;
    document.getElementById('history-panel').style.display = historyPanelOpen ? 'flex' : 'none';
    document.getElementById('history-toggle-icon').innerHTML = historyPanelOpen ? '▼' : '<i data-icon="play"></i>';
  }

  // ── Create/Edit modal ────────────────────────────────────
  function openCreateModal() {
    document.getElementById('modal-title').textContent = 'New Post';
    document.getElementById('save-post-text').textContent = 'Create Post';
    document.getElementById('edit-post-id').value = '';
    document.getElementById('post-title').value = '';
    document.getElementById('post-content').value = '';
    document.getElementById('post-image-url').value = '';
    uploadedImageUrl = null;
    postMentions = [];
    document.getElementById('status-field-row').style.display = 'none'; // hidden on create

    // Pre-select active tab if not "All"
    if (activeTab) {
      document.getElementById('post-board-type').value = activeTab;
    } else {
      document.getElementById('post-board-type').value = '';
    }
    populateServiceTypeSelect();
    Modal.open('post-modal');
  }

  function editPost(id, event) {
    if (event) event.stopPropagation();
    const p = allPosts.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-title').textContent = 'Edit Post';
    document.getElementById('save-post-text').textContent = 'Save Changes';
    document.getElementById('edit-post-id').value = p.id;
    document.getElementById('post-board-type').value = p.board_type || '';
    document.getElementById('post-title').value = p.title;
    document.getElementById('post-content').value = p.content || '';

    // Status (show only when editing)
    document.getElementById('status-field-row').style.display = '';
    document.getElementById('post-status').value = p.status || 'open';

    // Service type
    populateServiceTypeSelect();
    document.getElementById('post-service-type').value = p.service_type_id || '';
    onServiceTypeChange();
    // Need micro-delay for subtype options to render
    setTimeout(() => {
      document.getElementById('post-service-subtype').value = p.service_subtype_id || '';
    }, 50);

    if (p.image_url) {
      document.getElementById('post-image-url').value = p.image_url;
      uploadedImageUrl = p.image_url;
    } else {
      document.getElementById('post-image-url').value = '';
      uploadedImageUrl = null;
    }
    Modal.open('post-modal');
  }

  // ── Save post ────────────────────────────────────────────
  async function savePost() {
    const btn  = document.getElementById('save-post-btn');
    const text = document.getElementById('save-post-text');
    const spin = document.getElementById('save-post-spin');
    const id   = document.getElementById('edit-post-id').value; // keep for the API call below
    const title = document.getElementById('post-title').value.trim();
    const content = document.getElementById('post-content').value;

    if (!title) { Toast.warning('Title is required'); return; }

    // Collect board type
    const boardTypeSel = document.getElementById('post-board-type');
    const boardTypeId   = boardTypeSel.value;
    const boardTypeName = boardTypeSel.options[boardTypeSel.selectedIndex]?.text || '';

    // Collect service type
    const stSel  = document.getElementById('post-service-type');
    const stId   = stSel.value;
    const stName = stId ? (stSel.options[stSel.selectedIndex]?.dataset?.name || stSel.options[stSel.selectedIndex]?.text || '') : '';

    // Collect subtype
    const sstSel  = document.getElementById('post-service-subtype');
    const sstId   = sstSel.value;
    const sstName = sstId ? (sstSel.options[sstSel.selectedIndex]?.dataset?.name || sstSel.options[sstSel.selectedIndex]?.text || '') : '';

    btn.disabled = true;
    spin.classList.remove('hidden');

    const editingId = document.getElementById('edit-post-id').value;
    const payload = {
      title,
      content,
      image_url:            uploadedImageUrl || null,
      board_type:           boardTypeId,
      board_type_name:      boardTypeId ? boardTypeName : '',
      service_type_id:      stId,
      service_type_name:    stName,
      service_subtype_id:   sstId,
      service_subtype_name: sstName,
      mentions:             postMentions,
      ...(editingId ? { status: document.getElementById('post-status').value } : {})
    };

    const res = id
      ? await API.board.update(id, payload)
      : await API.board.create({ ...payload, status: 'open' });

    btn.disabled = false;
    spin.classList.add('hidden');

    if (res?.ok) {
      if (!id) trackBoardPostCreate(boardTypeId || 'general');
      Toast.success(id ? 'Post updated!' : 'Post created!');
      Modal.close('post-modal');
      loadPosts();
    } else {
      Toast.error(res?.data?.message || 'Failed to save post');
    }
  }

  // ── Toggle star (personal bookmark) ──────────────────────
  async function toggleStar(id, event) {
    if (event) event.stopPropagation();
    const post = allPosts.find(p => p.id === id);
    if (!post) return;
    const wasStarred = post.starred ?? false;
    const res = wasStarred ? await API.stars.unstar(id) : await API.stars.star(id);
    if (!res?.ok) { Toast.error(res?.data?.message || 'Failed to update star'); return; }
    // Update local state
    post.starred = !wasStarred;
    // Update card star button
    const cardBtn = document.getElementById('star-btn-' + id);
    if (cardBtn) {
      cardBtn.innerHTML = post.starred ? '<i data-icon="star"></i>' : '<i data-icon="star"></i>';
      cardBtn.style.color = post.starred ? '#f59e0b' : '';
    }
    // Update detail modal star button if open
    const detailBtn = document.getElementById('detail-star-btn');
    if (detailBtn) {
      detailBtn.innerHTML = post.starred ? '<i data-icon="star"></i> Starred' : '<i data-icon="star"></i> Star';
      detailBtn.style.color = post.starred ? '#f59e0b' : '';
    }
    Toast.success(post.starred ? 'Added to Starred' : 'Removed from Starred');
    if (isStarredTab && !post.starred) loadPosts(); // refresh starred tab if unstarred
  }

  // ── Toggle pin ────────────────────────────────────────────
  async function togglePin(id, event) {
    if (event) event.stopPropagation();
    const res = await API.board.pin(id);
    if (res?.ok) { Toast.success('Pin status updated'); loadPosts(); }
    else Toast.error(res?.data?.message || 'Failed to pin');
  }

  // ── Delete post ───────────────────────────────────────────
  async function deletePost(id, event) {
    if (event) event.stopPropagation();
    const confirmed = await confirmDialog('ลบโพสต์นี้? จะถูกเก็บใน Trash 30 วัน จากนั้นลบถาวร', 'Delete Post');
    if (!confirmed) return;
    const res = await API.board.delete(id);
    if (res?.ok) { Toast.success('โพสต์ถูกย้ายไป Trash'); loadPosts(); }
    else Toast.error(res?.data?.message || 'Failed to delete');
  }

  // ── Inline image upload (paste / attach) ─────────────────
  async function uploadSingleImage(file) {
    if (!file || !file.type.startsWith('image/')) return null;
    const fd = new FormData();
    fd.append('image', file);
    const res = await API.board.upload(fd);
    return res?.ok ? res.data.data.url : null;
  }

  function insertTextAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after  = textarea.value.slice(end);
    textarea.value = before + text + after;
    const pos = start + text.length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.dispatchEvent(new Event('input'));
  }

  async function handleContentImageFiles(files, targetId) {
    const textarea = document.getElementById(targetId);
    if (!textarea || !files || !files.length) return;
    const indicatorId = targetId === 'cmt-input' ? 'cmt-img-uploading' : 'post-img-uploading';
    const indicator = document.getElementById(indicatorId);
    if (indicator) indicator.style.display = '';
    for (const file of Array.from(files)) {
      const url = await uploadSingleImage(file);
      if (url) {
        const md = `\n![image](${url})\n`;
        insertTextAtCursor(textarea, md);
        Toast.success('อัปโหลดรูปสำเร็จ <i data-icon="check"></i>');
      } else {
        Toast.error('อัปโหลดรูปไม่สำเร็จ');
      }
    }
    if (indicator) indicator.style.display = 'none';
    // Reset file input
    const fileInputs = document.querySelectorAll(`label input[type="file"]`);
    fileInputs.forEach(i => { try { i.value = ''; } catch(e) {} });
  }

  // Paste image handler (works for both post content and comment)
  function setupPasteImageUpload(textareaId) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    ta.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(i => i.type.startsWith('image/'));
      if (!imageItems.length) return;
      e.preventDefault();
      // Ensure each file has a proper extension (clipboard files often have no name)
      const files = imageItems.map(i => {
        const raw = i.getAsFile();
        const ext = (i.type.split('/')[1] || 'png').replace('jpeg','jpg');
        const named = new File([raw], `clipboard-image.${ext}`, { type: i.type });
        return named;
      });
      await handleContentImageFiles(files, textareaId);
    });
    // Drag and drop directly onto textarea
    ta.addEventListener('dragover', e => e.preventDefault());
    ta.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length) await handleContentImageFiles(files, textareaId);
    });
  }

  setupPasteImageUpload('post-content');
  setupPasteImageUpload('cmt-input');

  // ── Search ────────────────────────────────────────────────
  const doSearch = debounce(() => { boardOffset = 0; _boardUpdateUrl(); loadPosts(); }, 350);
  document.getElementById('search-input').addEventListener('input', doSearch);

  // ── Init ──────────────────────────────────────────────────
  loadConfig().then(() => {
    const _bp = new URLSearchParams(location.search);
    const _bTab = _bp.get('tab');
    const _bQ   = _bp.get('q');
    if (_bQ) document.getElementById('search-input').value = _bQ;
    if (_bTab === '__starred__') {
      const el = document.querySelector('.board-tab[data-type="__starred__"]');
      if (el) { document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); }
      isStarredTab = true; activeTab = '';
    } else if (_bTab) {
      const el = document.querySelector(`.board-tab[data-type="${_bTab}"]`);
      if (el) { document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); }
      activeTab = _bTab;
    }
    loadPosts().then(() => startBoardPoller());
  });

  // Resume poll when tab regains focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      API.board.poll(_lastLoadTs).then(r => {
        if (r?.ok) { const { count = 0 } = r.data.data || {}; if (count > 0) showBanner(count); }
      }).catch(() => {});
    }
  });

  // ── Image Lightbox ───────────────────────────────────────────────────────
  (function () {
    // Build DOM elements programmatically so order doesn't matter
    const lb = document.createElement('div');
    lb.id = 'img-lightbox';

    const btn = document.createElement('button');
    btn.id = 'img-lightbox-close';
    btn.innerHTML = '<i data-icon="x"></i>';

    const img = document.createElement('img');
    img.id = 'img-lightbox-img';
    img.alt = '';

    lb.appendChild(btn);
    lb.appendChild(img);
    document.body.appendChild(lb);

    function open(src) {
      img.src = src;
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lb.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(() => { img.src = ''; }, 220);
    }

    document.addEventListener('click', e => {
      const el = e.target.closest('.detail-content img, .cmt-text img');
      if (el) open(el.src);
    });

    btn.addEventListener('click', close);
    lb.addEventListener('click', e => { if (e.target === lb || e.target === img) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_authorColor", { configurable: true, get: () => _authorColor, set: (v) => { _authorColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_avatarHtml", { configurable: true, get: () => _avatarHtml, set: (v) => { _avatarHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildComment", { configurable: true, get: () => buildComment, set: (v) => { buildComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildKanbanCard", { configurable: true, get: () => buildKanbanCard, set: (v) => { buildKanbanCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildPinChip", { configurable: true, get: () => buildPinChip, set: (v) => { buildPinChip = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cancelEditComment", { configurable: true, get: () => cancelEditComment, set: (v) => { cancelEditComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cancelNewServiceType", { configurable: true, get: () => cancelNewServiceType, set: (v) => { cancelNewServiceType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cancelNewSubtype", { configurable: true, get: () => cancelNewSubtype, set: (v) => { cancelNewSubtype = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteComment", { configurable: true, get: () => deleteComment, set: (v) => { deleteComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deletePost", { configurable: true, get: () => deletePost, set: (v) => { deletePost = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dismissBanner", { configurable: true, get: () => dismissBanner, set: (v) => { dismissBanner = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editPost", { configurable: true, get: () => editPost, set: (v) => { editPost = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "extractFirstImageUrl", { configurable: true, get: () => extractFirstImageUrl, set: (v) => { extractFirstImageUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "handleContentImageFiles", { configurable: true, get: () => handleContentImageFiles, set: (v) => { handleContentImageFiles = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hideBanner", { configurable: true, get: () => hideBanner, set: (v) => { hideBanner = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initMentionPicker", { configurable: true, get: () => initMentionPicker, set: (v) => { initMentionPicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "insertMention", { configurable: true, get: () => insertMention, set: (v) => { insertMention = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "insertTextAtCursor", { configurable: true, get: () => insertTextAtCursor, set: (v) => { insertTextAtCursor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAllCommentCounts", { configurable: true, get: () => loadAllCommentCounts, set: (v) => { loadAllCommentCounts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadComments", { configurable: true, get: () => loadComments, set: (v) => { loadComments = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadConfig", { configurable: true, get: () => loadConfig, set: (v) => { loadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPosts", { configurable: true, get: () => loadPosts, set: (v) => { loadPosts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mdExcerpt", { configurable: true, get: () => mdExcerpt, set: (v) => { mdExcerpt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onCardDragEnd", { configurable: true, get: () => onCardDragEnd, set: (v) => { onCardDragEnd = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onCardDragStart", { configurable: true, get: () => onCardDragStart, set: (v) => { onCardDragStart = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onColDragLeave", { configurable: true, get: () => onColDragLeave, set: (v) => { onColDragLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onColDragOver", { configurable: true, get: () => onColDragOver, set: (v) => { onColDragOver = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onColDrop", { configurable: true, get: () => onColDrop, set: (v) => { onColDrop = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onServiceTypeChange", { configurable: true, get: () => onServiceTypeChange, set: (v) => { onServiceTypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onSubtypeChange", { configurable: true, get: () => onSubtypeChange, set: (v) => { onSubtypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateModal", { configurable: true, get: () => openCreateModal, set: (v) => { openCreateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDetail", { configurable: true, get: () => openDetail, set: (v) => { openDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateBoardTypeSelect", { configurable: true, get: () => populateBoardTypeSelect, set: (v) => { populateBoardTypeSelect = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateServiceTypeSelect", { configurable: true, get: () => populateServiceTypeSelect, set: (v) => { populateServiceTypeSelect = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reloadAndDismissBanner", { configurable: true, get: () => reloadAndDismissBanner, set: (v) => { reloadAndDismissBanner = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderKanban", { configurable: true, get: () => renderKanban, set: (v) => { renderKanban = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMd", { configurable: true, get: () => renderMd, set: (v) => { renderMd = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMentionText", { configurable: true, get: () => renderMentionText, set: (v) => { renderMentionText = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTabs", { configurable: true, get: () => renderTabs, set: (v) => { renderTabs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetPostMentions", { configurable: true, get: () => resetPostMentions, set: (v) => { resetPostMentions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEditComment", { configurable: true, get: () => saveEditComment, set: (v) => { saveEditComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveNewServiceType", { configurable: true, get: () => saveNewServiceType, set: (v) => { saveNewServiceType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveNewSubtype", { configurable: true, get: () => saveNewSubtype, set: (v) => { saveNewSubtype = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePost", { configurable: true, get: () => savePost, set: (v) => { savePost = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupPasteImageUpload", { configurable: true, get: () => setupPasteImageUpload, set: (v) => { setupPasteImageUpload = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showBanner", { configurable: true, get: () => showBanner, set: (v) => { showBanner = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startBoardPoller", { configurable: true, get: () => startBoardPoller, set: (v) => { startBoardPoller = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startEditComment", { configurable: true, get: () => startEditComment, set: (v) => { startEditComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitComment", { configurable: true, get: () => submitComment, set: (v) => { submitComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchStarred", { configurable: true, get: () => switchStarred, set: (v) => { switchStarred = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleHistoryPanel", { configurable: true, get: () => toggleHistoryPanel, set: (v) => { toggleHistoryPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "togglePin", { configurable: true, get: () => togglePin, set: (v) => { togglePin = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleStar", { configurable: true, get: () => toggleStar, set: (v) => { toggleStar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "uploadSingleImage", { configurable: true, get: () => uploadSingleImage, set: (v) => { uploadSingleImage = v; } }); } catch (e) {}
})();
