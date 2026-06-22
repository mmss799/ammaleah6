// ============================================================
// الرسائل العملية - تطبيق ويب (نسخة مجددة من تطبيق APK قديم)
// ============================================================

let db = null;
let allBooks = [];      // [{id, name, author_id, author, bk_table}]
let allAuthors = {};    // {id: name}
let authorOrder = [];   // [id,...] in display order (real authors first, then glossary group)
const GLOSSARY_AUTHOR_ID = '__glossary__';

let currentAuthorId = null;
let currentBookId = null;
let currentBookTable = null;
let currentSectionIndex = null;
let currentSections = [];   // cached rows for current book: [{rowid, title, body}]
let navStack = [];          // for back button
let currentTab = 'books';
let booksTabActive = false;       // هل المستخدم متوقف بداخل تسلسل القراءة (وليس بقائمة المراجع)؟
let lastBooksPageId = 'booksPage';
let lastBooksPageTitle = 'المحتويات';
let lastBooksBreadcrumb = null;
let reorderModeActive = false;
let reorderSnapshot = null; // نسخة احتياطية من الترتيب نأخذها عند الدخول، لاستعادتها لو أُلغي بدون حفظ

function enterReorderModeFromSettings() {
  closeSettings();
  reorderSnapshot = authorOrder.slice();
  reorderModeActive = true;
  showTab('books');
}

function saveReorderAndExit() {
  saveCustomAuthorOrder();
  reorderModeActive = false;
  reorderSnapshot = null;
  renderReferencesPage();
}

function cancelReorderMode() {
  if (reorderSnapshot) authorOrder = reorderSnapshot;
  reorderSnapshot = null;
  reorderModeActive = false;
  renderReferencesPage();
}

let dragSrcAid = null;
function onRefDragStart(evt) {
  dragSrcAid = evt.currentTarget.dataset.aid;
  evt.currentTarget.classList.add('dragging');
  evt.dataTransfer.effectAllowed = 'move';
}
function onRefDragOver(evt) {
  evt.preventDefault();
  const row = evt.currentTarget;
  if (row.dataset.aid === dragSrcAid) return;
  const rect = row.getBoundingClientRect();
  const before = (evt.clientY - rect.top) < rect.height / 2;
  row.classList.toggle('drop-before', before);
  row.classList.toggle('drop-after', !before);
}
function onRefDrop(evt) {
  evt.preventDefault();
  const targetAid = evt.currentTarget.dataset.aid;
  document.querySelectorAll('.ref-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
  if (!dragSrcAid || targetAid === dragSrcAid) return;
  const normSrc = (dragSrcAid === GLOSSARY_AUTHOR_ID) ? dragSrcAid : parseInt(dragSrcAid, 10);
  const normTarget = (targetAid === GLOSSARY_AUTHOR_ID) ? targetAid : parseInt(targetAid, 10);
  const srcIdx = authorOrder.findIndex(a => a === normSrc);
  let targetIdx = authorOrder.findIndex(a => a === normTarget);
  if (srcIdx === -1 || targetIdx === -1) return;
  authorOrder.splice(srcIdx, 1);
  targetIdx = authorOrder.findIndex(a => a === normTarget);
  const rect = evt.currentTarget.getBoundingClientRect();
  const before = (evt.clientY - rect.top) < rect.height / 2;
  authorOrder.splice(before ? targetIdx : targetIdx + 1, 0, normSrc);
  renderReferencesPage();
}
function onRefDragEnd(evt) {
  evt.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.ref-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
  dragSrcAid = null;
}

// ---------- سحب باللمس (الجوال) — DnD العادي لا يعمل عبر اللمس ----------
let touchDragState = null;
function onRefHandleTouchStart(evt) {
  if (!reorderModeActive) return;
  evt.preventDefault();
  const row = evt.currentTarget.closest('.ref-row');
  touchDragState = { aid: row.dataset.aid, rowEl: row, startY: evt.touches[0].clientY, targetAid: null, before: true };
  row.classList.add('dragging');
  row.style.position = 'relative';
  row.style.zIndex = '60';
  document.addEventListener('touchmove', onRefHandleTouchMove, { passive: false });
  document.addEventListener('touchend', onRefHandleTouchEnd, { passive: false });
}

function onRefHandleTouchMove(evt) {
  if (!touchDragState) return;
  evt.preventDefault();
  const touchY = evt.touches[0].clientY;
  const dy = touchY - touchDragState.startY;
  touchDragState.rowEl.style.transform = `translateY(${dy}px)`;

  const allRows = Array.from(document.querySelectorAll('#booksPage .ref-row'));
  allRows.forEach(r => r.classList.remove('drop-before', 'drop-after'));
  for (const r of allRows) {
    if (r === touchDragState.rowEl) continue;
    const rect = r.getBoundingClientRect();
    if (touchY >= rect.top && touchY <= rect.bottom) {
      const before = (touchY - rect.top) < rect.height / 2;
      r.classList.toggle('drop-before', before);
      r.classList.toggle('drop-after', !before);
      touchDragState.targetAid = r.dataset.aid;
      touchDragState.before = before;
      break;
    }
  }
}

function onRefHandleTouchEnd() {
  if (!touchDragState) return;
  document.removeEventListener('touchmove', onRefHandleTouchMove);
  document.removeEventListener('touchend', onRefHandleTouchEnd);
  const { aid, targetAid, before } = touchDragState;
  touchDragState = null;
  document.querySelectorAll('.ref-row').forEach(r => {
    r.classList.remove('drop-before', 'drop-after', 'dragging');
    r.style.transform = ''; r.style.position = ''; r.style.zIndex = '';
  });
  if (!targetAid || targetAid === aid) return;
  const normSrc = (aid === GLOSSARY_AUTHOR_ID) ? aid : parseInt(aid, 10);
  const normTarget = (targetAid === GLOSSARY_AUTHOR_ID) ? targetAid : parseInt(targetAid, 10);
  const srcIdx = authorOrder.findIndex(a => a === normSrc);
  if (srcIdx === -1) return;
  authorOrder.splice(srcIdx, 1);
  let targetIdx = authorOrder.findIndex(a => a === normTarget);
  if (targetIdx === -1) targetIdx = authorOrder.length;
  authorOrder.splice(before ? targetIdx : targetIdx + 1, 0, normSrc);
  renderReferencesPage();
}

let fontSize = parseInt(localStorage.getItem('rs_fontSize') || '17');
let fontFamily = localStorage.getItem('rs_fontFamily') || 'font-default';
let nightMode = localStorage.getItem('rs_night') === '1';
let favorites = JSON.parse(localStorage.getItem('rs_favorites') || '[]');
// favorites item shapes:
//   section-level: {bookId, sectionIdx, title, bookName}
//   مسألة-level:   {bookId, sectionIdx, title, bookName, masalaNum, snippet}

// ---------- GLOSSARY (قائمة المصطلحات) ----------
// مبني بالكامل من كتب المصطلحات الموجودة فعلياً في قاعدة البيانات
// (لا يضاف أي تعريف من خارج القاعدة).
let glossaryMap = new Map();     // term -> [{def, source}]
let glossaryRegex = null;
const GLOSSARY_MIN_TERM_LEN = 4; // تجاهل الكلمات القصيرة جداً لتقليل التشويش البصري
const ARABIC_WORD_CHAR = '\\u0600-\\u06FF\\u200c\\u200d';

// تعميم: "مسألة" و "السؤال" يُعاملان بنفس آلية التقسيم والتنسيق والأدوات
const BLOCK_NUM_SRC = '[0-9\\u06F0-\\u06F9\\u0660-\\u0669]+';
const BLOCK_MARKER_SRC = `(?:مسأل[ةه]|السؤال)\\s*${BLOCK_NUM_SRC}\\s*:`;
const BLOCK_MARKER_TEST = new RegExp(BLOCK_MARKER_SRC);
const BLOCK_MARKER_SPLIT = new RegExp(`(?=${BLOCK_MARKER_SRC})`);
const BLOCK_MARKER_CAPTURE = new RegExp(`^(?:مسأل[ةه]|السؤال)\\s*(${BLOCK_NUM_SRC})\\s*:`);

function normalizeDigits(s) {
  return String(s).replace(/[\u06F0-\u06F9\u0660-\u0669]/g, d => {
    const code = d.charCodeAt(0);
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return d;
  });
}

// ---------- PENDING SEARCH HIGHLIGHT ----------
let pendingSearchTerm = null; // الكلمة المطلوب التمرير إليها وتمييزها بعد فتح القارئ

// ============================================================
// مقارنة المسائل بين المراجع — بيانات يدوية موثّقة فقط
// ============================================================
// مهم جداً: هذه القائمة لا تُبنى آلياً ولن يُضاف لها أي تخمين أو تشابه
// نصي تلقائي، لتجنّب الخطأ في نسبة حكم فقهي لمسألة لا تخصه. كل عنصر هنا
// يجب أن يكون أدخله شخص قرأ النصين وتأكد إنهما يتناولان نفس الموضوع.
//
// الصيغة المطلوبة لإضافة مجموعة مقارنة:
// {
//   topic: "وصف مختصر اختياري للموضوع المشترك (يظهر في صفحة المقارنة)",
//   entries: [
//     { bookId: 1, masalaNum: "5" },   // bookId = رقم الكتاب كما في فهرس الكتب
//     { bookId: 23, masalaNum: "12" }
//   ]
// }
// أضف كل مجموعة كعنصر جديد داخل المصفوفة بالأسفل. القائمة فاضية الآن.
const masalaComparisons = [
  // (لا توجد مجموعات مقارنة مُدخلة بعد)
];

let comparisonIndex = new Map(); // key: `${bookId}::${masalaNum}` -> group object

function buildComparisonIndex() {
  comparisonIndex = new Map();
  for (const group of masalaComparisons) {
    for (const entry of group.entries) {
      comparisonIndex.set(`${entry.bookId}::${entry.masalaNum}`, group);
    }
  }
}

// ---------- INITIALIZATION ----------
async function init() {
  applyTheme();
  try {
    const SQL = await initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
    const resp = await fetch('books.db');
    const total = +resp.headers.get('Content-Length') || 0;
    const reader = resp.body.getReader();
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const mb = (received / 1048576).toFixed(1);
        const totalMb = (total / 1048576).toFixed(1);
        document.getElementById('loadProgress').textContent = `${mb} MB / ${totalMb} MB`;
      }
    }
    const buf = new Uint8Array(received);
    let pos = 0;
    for (const c of chunks) { buf.set(c, pos); pos += c.length; }

    db = new SQL.Database(buf);
    loadBooksAndAuthors();
    try { buildGlossary(); } catch (e) { console.warn('تعذر بناء قائمة المصطلحات:', e); }
    buildComparisonIndex();
    setupSwipeNavigation();
    setupHardwareBack();
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (!resumeLastPosition()) renderReferencesPage();
  } catch (err) {
    document.getElementById('loadProgress').textContent = 'حدث خطأ أثناء التحميل: ' + err.message;
    console.error(err);
  }
}

function loadBooksAndAuthors() {
  const authRes = db.exec("SELECT auther_id, auher_name FROM authers ORDER BY auther_id");
  if (authRes.length) {
    for (const row of authRes[0].values) {
      allAuthors[row[0]] = (row[1] || '').trim().replace(/^المرجع\s+/, '');
      authorOrder.push(row[0]);
    }
  }
  const bookRes = db.exec("SELECT book_id, book_name, auther_id, bk_table FROM book_menu ORDER BY book_id");
  if (bookRes.length) {
    for (const row of bookRes[0].values) {
      allBooks.push({
        id: row[0],
        name: row[1],
        author_id: row[2],
        bk_table: row[3],
        author: allAuthors[row[2]] || ''
      });
    }
  }
  // أي كتب بلا مرجع (author_id = 0) تُجمَّع في فئة خاصة "القواعد والمصطلحات"
  // حتى لا تختفي ولا تُحذف، بل تبقى متاحة كأي مرجع آخر في القائمة الرئيسية.
  const hasOrphanBooks = allBooks.some(b => !allAuthors[b.author_id]);
  if (hasOrphanBooks) authorOrder.push(GLOSSARY_AUTHOR_ID);
  allAuthors[GLOSSARY_AUTHOR_ID] = 'القواعد والمصطلحات';
  applyCustomAuthorOrder();
}

// ---------- ترتيب المراجع حسب رغبة القارئ (يُحفظ في المتصفح) ----------
function applyCustomAuthorOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('rs_authorOrder') || '[]'); } catch (e) { saved = []; }
  if (!saved.length) return;
  const savedSet = new Set(saved);
  const known = saved.filter(id => authorOrder.includes(id) || authorOrder.includes(parseInt(id, 10)));
  const remaining = authorOrder.filter(id => !savedSet.has(id) && !savedSet.has(String(id)));
  authorOrder = known.map(id => authorOrder.includes(id) ? id : parseInt(id, 10)).concat(remaining);
}

function saveCustomAuthorOrder() {
  localStorage.setItem('rs_authorOrder', JSON.stringify(authorOrder));
}

// ---------- GLOSSARY BUILD ----------
function buildGlossary() {
  // كتب المصطلحات هي الكتب التي بلا مرجع (author_id = 0) واسمها يتضمن "مصطلح" أو "اصطلاح"
  const glossaryBooks = allBooks.filter(b =>
    (!allAuthors[b.author_id] || b.author_id === 0) &&
    (b.name.includes('مصطلح') || b.name.includes('اصطلاح'))
  );
  for (const book of glossaryBooks) {
    let rows;
    try {
      const res = db.exec(`SELECT title, body FROM "${book.bk_table}" ORDER BY rowid`);
      rows = res.length ? res[0].values : [];
    } catch (e) { continue; }
    for (const [title, body] of rows) {
      if (!body) continue;
      for (const entry of parseGlossaryBody(body)) {
        if (!glossaryMap.has(entry.term)) glossaryMap.set(entry.term, []);
        glossaryMap.get(entry.term).push({ def: entry.def, source: book.name });
      }
    }
  }
  // بناء التعبير النمطي لمطابقة الكلمة كاملة فقط (بدون اشتقاقات أو تخمين)
  const terms = Array.from(glossaryMap.keys())
    .filter(t => t.length >= GLOSSARY_MIN_TERM_LEN)
    .sort((a, b) => b.length - a.length); // الأطول أولاً لتفادي التطابق الجزئي
  if (terms.length) {
    const escaped = terms.map(escapeRegex).join('|');
    glossaryRegex = new RegExp(
      `(?<![${ARABIC_WORD_CHAR}])(${escaped})(?![${ARABIC_WORD_CHAR}])`,
      'g'
    );
  }
}

// يفصل نص كتاب المصطلحات إلى مدخلات (مصطلح : تعريف) بالاعتماد على الفقرات
// الفاصلة بسطر فارغ، كما هي مخزّنة بالفعل في قاعدة البيانات الأصلية.
function parseGlossaryBody(body) {
  const entries = [];
  const blocks = body.split(/\n\s*\n/);
  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;
    const m = block.match(/^([^\n:：]{1,60}?)[\s\u200c]*[:：]\s*([\s\S]*)$/);
    if (!m) continue;
    let term = m[1].replace(/[\u200c\u200d]/g, '').trim();
    let def = m[2].replace(/[\u200c\u200d]/g, ' ').replace(/[ \t]+/g, ' ').trim();
    if (!term || !def) continue;
    if (term.length < 2 || term.length > 40) continue;
    entries.push({ term, def });
  }
  return entries;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------- THEME / SETTINGS ----------
function applyTheme() {
  document.body.classList.toggle('night-mode', nightMode);
  const toggle = document.getElementById('nightToggle');
  if (toggle) toggle.classList.toggle('on', nightMode);
  document.querySelectorAll('.font-family-controls button').forEach(b => {
    b.classList.toggle('active', b.dataset.font === fontFamily);
  });
}

function openSettings() { document.getElementById('settingsOverlay').classList.add('show'); }
function closeSettings() { document.getElementById('settingsOverlay').classList.remove('show'); }

function toggleNight() {
  nightMode = !nightMode;
  localStorage.setItem('rs_night', nightMode ? '1' : '0');
  applyTheme();
}

function changeFontSize(delta) {
  fontSize = Math.min(28, Math.max(12, fontSize + delta));
  localStorage.setItem('rs_fontSize', fontSize);
  const bodyText = document.querySelector('#readerPage .body-text');
  if (bodyText) bodyText.style.fontSize = fontSize + 'px';
}

function setFontFamily(f) {
  fontFamily = f;
  localStorage.setItem('rs_fontFamily', f);
  applyTheme();
  const bodyText = document.querySelector('#readerPage .body-text');
  if (bodyText) {
    bodyText.classList.remove('font-default', 'font-serif', 'font-naskh');
    bodyText.classList.add(f);
  }
}

// ---------- NAVIGATION ----------
let tabScrollPositions = {}; // tabName -> scrollTop
function restoreTabScroll(tab) {
  const content = document.getElementById('content');
  requestAnimationFrame(() => { content.scrollTop = tabScrollPositions[tab] || 0; });
}

function showTab(tab) {
  const wasAlreadyOnThisTab = (currentTab === tab);
  // نحفظ موضع التمرير للتبويب الذي نغادره الآن
  const content = document.getElementById('content');
  if (currentTab) tabScrollPositions[currentTab] = content.scrollTop;
  currentTab = tab;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#bottomnav .navitem').forEach(n => n.classList.remove('active'));
  document.querySelector(`#bottomnav .navitem[data-page="${tab}"]`).classList.add('active');

  if (tab === 'books') {
    // ثبات الصفحة: إذا كان المستخدم متوقفاً بداخل القراءة، نعيد إظهار نفس الصفحة
    // بدل الرجوع لقائمة المراجع، إلا إذا ضغط تبويب "الرسائل" وهو بالأصل فيه (= رجوع للجذر)
    if (wasAlreadyOnThisTab || !booksTabActive) {
      navStack = [];
      document.getElementById('backBtn').style.display = 'none';
      hideBreadcrumb();
      renderReferencesPage();
      content.scrollTop = 0;
    } else {
      navStack = [() => { navStack = []; document.getElementById('backBtn').style.display = 'none'; hideBreadcrumb(); renderReferencesPage(); }];
      document.getElementById('backBtn').style.display = 'flex';
      if (lastBooksBreadcrumb) showBreadcrumb(lastBooksBreadcrumb); else hideBreadcrumb();
      switchPage(lastBooksPageId, lastBooksPageTitle);
      restoreTabScroll(tab);
    }
    return;
  }

  navStack = [];
  document.getElementById('backBtn').style.display = 'none';
  hideBreadcrumb();

  if (tab === 'search') {
    document.getElementById('pageTitle').textContent = 'البحث';
    switchPage('searchPage', 'البحث');
    if (!document.getElementById('searchFilterPanel').dataset.built) buildSearchFilterPanel();
    restoreTabScroll(tab);
  } else if (tab === 'favorites') {
    document.getElementById('pageTitle').textContent = 'الاشارات المرجعية';
    renderFavoritesPage();
    switchPage('favoritesPage', 'الاشارات المرجعية');
    restoreTabScroll(tab);
  } else if (tab === 'comparison') {
    document.getElementById('pageTitle').textContent = 'المقارنة';
    renderComparisonPage();
    switchPage('comparisonPage', 'المقارنة');
  } else if (tab === 'writing') {
    document.getElementById('pageTitle').textContent = 'الكتابة';
    renderWritingPage();
    switchPage('writingPage', 'الكتابة');
  }
}

function goBack() {
  if (navStack.length === 0) { showTab(currentTab); return; }
  const prev = navStack.pop();
  prev();
  if (navStack.length === 0) document.getElementById('backBtn').style.display = 'none';
}

function pushNav(fn) {
  navStack.push(fn);
  document.getElementById('backBtn').style.display = 'flex';
}

function switchPage(pageId, title) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.getElementById('pageTitle').textContent = title;
}

// ---------- BREADCRUMB (شريط المسار الثابت) ----------
function showBreadcrumb(parts) {
  const bar = document.getElementById('breadcrumbBar');
  bar.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    let onclickAttr = '';
    if (!isLast) {
      if (i === 0) onclickAttr = ` onclick="openAuthorBooks(currentAuthorId)"`;
      else if (i === 1) onclickAttr = ` onclick="openBookIndex(currentBookId)"`;
    }
    const cls = isLast ? 'crumb-current' : 'crumb-link';
    return (i > 0 ? '<span class="crumb-sep">›</span>' : '') +
      `<span class="${cls}"${onclickAttr}>${escapeHtml(p)}</span>`;
  }).join('');
  bar.classList.add('show');
}
function hideBreadcrumb() {
  document.getElementById('breadcrumbBar').classList.remove('show');
}

// ---------- LEVEL 1: قائمة المراجع ----------
// صور المراجع (محفوظة محلياً) — تُستخدم بدل الرمز التعبيري حيث تتوفر
const AUTHOR_PHOTOS = {
  1: 'icons/marja/sistani.jpg',
  3: 'icons/marja/khamenei.jpg',
  4: 'icons/marja/fayyad.jpg',
  7: 'icons/marja/sadiq_shirazi.jpg',
  11: 'icons/marja/khoei.jpg',
  12: 'icons/marja/waheed_khorasani.jpg',
  13: 'icons/marja/khomeini.jpg',
  16: 'icons/marja/mohammad_shirazi.jpg'
};

function renderReferencesPage() {
  const container = document.getElementById('booksPage');
  let html = '';
  if (reorderModeActive) {
    html += `<div class="ref-toolbar reorder-active-bar">
      <span class="reorder-hint">اسحب ⠿ لإعادة الترتيب</span>
      <button class="reorder-save-btn" onclick="saveReorderAndExit()">✓ حفظ الترتيب</button>
      <button class="reorder-cancel-btn" onclick="cancelReorderMode()">إلغاء</button>
    </div>`;
  }
  authorOrder.forEach((aid, i) => {
    const name = allAuthors[aid] || '';
    const count = allBooks.filter(b => (b.author_id === aid) || (aid === GLOSSARY_AUTHOR_ID && !allAuthors[b.author_id])).length;
    const photo = AUTHOR_PHOTOS[aid];
    const iconHtml = photo
      ? `<img class="ref-photo" src="${photo}" alt="" onerror="this.outerHTML='<span style=&quot;font-size:20px;&quot;>👤</span>'">`
      : `<span style="font-size:20px;">${aid === GLOSSARY_AUTHOR_ID ? '📘' : '👤'}</span>`;
    html += `<div class="list-row ref-row" data-aid="${aid}" ${reorderModeActive ? 'draggable="true"' : ''}
        ondragstart="onRefDragStart(event)" ondragover="onRefDragOver(event)" ondrop="onRefDrop(event)" ondragend="onRefDragEnd(event)">
      <span class="drag-handle" ontouchstart="onRefHandleTouchStart(event)">⠿</span>
      <span onclick="openAuthorBooks('${aid}')">${iconHtml}</span>
      <div class="label" onclick="openAuthorBooks('${aid}')">${escapeHtml(name)}<small>${count} كتاب</small></div>
    </div>`;
  });
  container.innerHTML = html || '<div class="empty-state"><div class="ic">📚</div>لا توجد مراجع</div>';
  container.classList.toggle('reorder-mode', reorderModeActive);
  hideBreadcrumb();
  switchPage('booksPage', 'المحتويات');
  booksTabActive = false;
  lastBooksPageId = 'booksPage';
  lastBooksPageTitle = 'المحتويات';
  lastBooksBreadcrumb = null;
}

// ---------- LEVEL 2: كتب مرجع معين ----------
function openAuthorBooks(authorId) {
  const normId = (authorId === GLOSSARY_AUTHOR_ID) ? authorId : parseInt(authorId, 10);
  pushNav(() => renderReferencesPage());
  currentAuthorId = normId;
  const isGlossaryGroup = normId === GLOSSARY_AUTHOR_ID;
  const books = allBooks.filter(b => isGlossaryGroup ? !allAuthors[b.author_id] : b.author_id === normId);
  const authorName = allAuthors[normId] || '';

  let html = '';
  for (const book of books) {
    html += `<div class="list-row" onclick="openBookIndex(${book.id})">
      <span style="font-size:20px;">📖</span>
      <div class="label">${escapeHtml(book.name)}</div>
    </div>`;
  }
  document.getElementById('authorBooksPage').innerHTML = html || '<div class="empty-state"><div class="ic">📖</div>لا توجد كتب</div>';

  // رابط الفتاوى الرقمية الخاص بالمرجع السيستاني فقط
  if (normId === 1) {
    const link = document.createElement('a');
    link.href = 'https://share.google/OfPpIpnOWgVMSjnC7';
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'ref-link-row';
    link.innerHTML = '🌐 الفتاوى الرقمية';
    document.getElementById('authorBooksPage').prepend(link);
  }

  showBreadcrumb([authorName]);
  switchPage('authorBooksPage', authorName);
  booksTabActive = true;
  lastBooksPageId = 'authorBooksPage';
  lastBooksPageTitle = authorName;
  lastBooksBreadcrumb = [authorName];
}

// ---------- BOOK INDEX (فهرس الكتاب) ----------
function openBookIndex(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  const resolvedAuthorId = allAuthors[book.author_id] ? book.author_id : GLOSSARY_AUTHOR_ID;
  currentAuthorId = resolvedAuthorId;
  pushNav(() => openAuthorBooks(resolvedAuthorId));
  currentBookId = bookId;
  currentBookTable = book.bk_table;

  const res = db.exec(`SELECT rowid, title, body FROM "${currentBookTable}" ORDER BY rowid`);
  currentSections = res.length ? res[0].values.map(r => ({ rowid: r[0], title: r[1] || '(بدون عنوان)', body: r[2] || '' })) : [];

  let html = '';
  currentSections.forEach((sec, idx) => {
    html += `<div class="list-row" onclick="openReader(${bookId}, ${idx})">
      <div class="label">${escapeHtml(sec.title)}</div>
    </div>`;
  });
  document.getElementById('indexPage').innerHTML = html || '<div class="empty-state"><div class="ic">📄</div>هذا الكتاب فارغ</div>';
  showBreadcrumb([allAuthors[book.author_id] || allAuthors[GLOSSARY_AUTHOR_ID], book.name]);
  switchPage('indexPage', book.name);
  booksTabActive = true;
  lastBooksPageId = 'indexPage';
  lastBooksPageTitle = book.name;
  lastBooksBreadcrumb = [allAuthors[book.author_id] || allAuthors[GLOSSARY_AUTHOR_ID], book.name];
}

// ---------- READER PAGE ----------
function openReader(bookId, sectionIdx) {
  pushNav(() => openBookIndex(bookId));
  searchResultContext = null; // أي فتح عادي للقارئ يلغي سياق "التنقل بين نتائج البحث"
  currentBookId = bookId;
  currentSectionIndex = sectionIdx;
  const book = allBooks.find(b => b.id === bookId);
  if (book.bk_table !== currentBookTable) {
    currentBookTable = book.bk_table;
    const res = db.exec(`SELECT rowid, title, body FROM "${currentBookTable}" ORDER BY rowid`);
    currentSections = res.length ? res[0].values.map(r => ({ rowid: r[0], title: r[1] || '(بدون عنوان)', body: r[2] || '' })) : [];
  }
  renderReaderContent();
  switchPage('readerPage', book.name);
  const authorLabel = allAuthors[book.author_id] || allAuthors[GLOSSARY_AUTHOR_ID];
  showBreadcrumb([authorLabel, book.name, currentSections[sectionIdx] ? currentSections[sectionIdx].title : '']);
  saveLastPosition();
  booksTabActive = true;
  lastBooksPageId = 'readerPage';
  lastBooksPageTitle = book.name;
  lastBooksBreadcrumb = [authorLabel, book.name, currentSections[sectionIdx] ? currentSections[sectionIdx].title : ''];
}

// ---------- استئناف القراءة من نفس النقطة عند فتح التطبيق مجدداً ----------
function saveLastPosition() {
  try {
    localStorage.setItem('rs_lastPosition', JSON.stringify({ bookId: currentBookId, sectionIdx: currentSectionIndex }));
  } catch (e) { /* تجاهل أي خطأ تخزين */ }
}

function resumeLastPosition() {
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem('rs_lastPosition') || 'null'); } catch (e) { pos = null; }
  if (!pos) return false;
  const book = allBooks.find(b => b.id === pos.bookId);
  if (!book) return false; // الكتاب لم يعد موجوداً (مثلاً تم حذفه)
  // نبني فهرس الكتاب أولاً ليصبح زر "رجوع" يعمل بشكل صحيح (المرجع ‹ الكتاب ‹ القارئ)
  openBookIndex(pos.bookId);
  const sectionIdx = Math.min(pos.sectionIdx, currentSections.length - 1);
  if (sectionIdx < 0) return false;
  openReader(pos.bookId, sectionIdx);
  return true;
}

function renderReaderContent() {
  const sec = currentSections[currentSectionIndex];
  if (!sec) return;
  const isFav = isFavorite(currentBookId, currentSectionIndex);
  const bodyHtml = renderBodyHtml(sec.body);
  const html = `
    <div class="reader-toolbar">
      <button onclick="navSection(-1)">‹ السابق</button>
      <span class="fav-star ${isFav ? 'active' : ''}" onclick="toggleFavorite()">★</span>
      <button onclick="navSection(1)">التالي ›</button>
    </div>
    <h2 class="section-title">${escapeHtml(sec.title)}</h2>
    <div class="body-text ${fontFamily}" style="font-size:${fontSize}px;">${bodyHtml}</div>
  `;
  document.getElementById('readerPage').innerHTML = html;
  attachMasalaToolEvents();
  applyPendingSearchHighlight();
}

// يبني نص القراءة: تلوين أرقام المسائل + تمييز مصطلحات قائمة المصطلحات +
// تغليف كل مسألة بكتلة منفصلة فيها أيقونات نسخ/إشارة مرجعية مخفية افتراضياً.
function renderBodyHtml(rawBody) {
  const hasMasala = BLOCK_MARKER_TEST.test(rawBody);
  if (!hasMasala) {
    return formatPlainText(rawBody);
  }
  // تقسيم النص إلى مسائل/أسئلة بالاعتماد على بداية كل واحدة
  const parts = rawBody.split(BLOCK_MARKER_SPLIT);
  let html = '';
  for (const part of parts) {
    const m = part.match(BLOCK_MARKER_CAPTURE);
    if (!m) { html += formatPlainText(part); continue; }
    const num = normalizeDigits(m[1]);
    const blockType = /^السؤال/.test(m[0]) ? 'سؤال' : 'مسألة';
    const isFav = isMasalaFavorite(currentBookId, currentSectionIndex, num);
    const existingNote = getNoteFor(currentBookId, currentSectionIndex, num);
    const inner = formatPlainText(part);
    const hasComparison = comparisonIndex.has(`${currentBookId}::${num}`);
    const cmpFlag = hasComparison
      ? `<span class="ms-cmp-flag" title="آراء مراجع أخرى" onclick="toggleComparisonAccordion(event, '${num}')">!</span>`
      : '';
    const favClass = isFav ? 'masala-fav-persistent' : '';
    const noteDisplay = existingNote
      ? `<div class="note-display" id="note-display-${num}">📝 ${escapeHtml(existingNote)}</div>`
      : `<div class="note-display" id="note-display-${num}" style="display:none;"></div>`;
    html += `<div class="masala-block ${favClass}" data-masala="${num}" data-blocktype="${blockType}">
      <div class="masala-tools">
        <button title="نسخ" onclick="copyMasala(event, '${num}')">📋</button>
        <button title="إشارة مرجعية" class="${isFav ? 'bm-active' : ''}" onclick="toggleMasalaFavorite(event, '${num}')">★</button>
        <button title="ملاحظة" class="${existingNote ? 'note-active' : ''}" onclick="toggleNoteEditor(event, '${num}')">📝</button>
      </div>
      ${inner}${cmpFlag}
      ${hasComparison ? `<div class="cmp-accordion" id="cmp-acc-${num}"></div>` : ''}
      ${noteDisplay}
      <div class="note-accordion" id="note-acc-${num}"></div>
    </div>`;
  }
  return html;
}

function formatPlainText(text) {
  let html = escapeHtml(text).replace(/\n/g, '<br>');
  html = html.replace(new RegExp(`(^|<br>)(\\s*)(${BLOCK_MARKER_SRC})`, 'g'), '$1$2<span class="ms-num">$3</span>');
  if (glossaryRegex) {
    html = html.replace(glossaryRegex, (m) => `<span class="gterm" onclick="openGlossaryPopup('${escapeJsAttr(m)}')">${m}</span>`);
  }
  return html;
}

function escapeJsAttr(s) { return s.replace(/'/g, "\\'"); }

let sectionScrollPositions = new Map(); // `${bookId}::${sectionIdx}` -> scrollTop

function navSection(delta) {
  const newIdx = currentSectionIndex + delta;
  if (newIdx < 0 || newIdx >= currentSections.length) return;
  const content = document.getElementById('content');
  // نحفظ موضع القراءة الحالي قبل المغادرة (يُستخدم عند الرجوع لاحقاً لهذا القسم)
  sectionScrollPositions.set(`${currentBookId}::${currentSectionIndex}`, content.scrollTop);
  currentSectionIndex = newIdx;
  renderReaderContent();
  const book = allBooks.find(b => b.id === currentBookId);
  const authorLabel = allAuthors[book.author_id] || allAuthors[GLOSSARY_AUTHOR_ID];
  showBreadcrumb([authorLabel, book.name, currentSections[currentSectionIndex].title]);
  lastBooksBreadcrumb = [authorLabel, book.name, currentSections[currentSectionIndex].title];
  saveLastPosition();
  triggerPageTransition(delta);
  if (delta > 0) {
    content.scrollTop = 0; // التالي: يبدأ من أعلى الصفحة
  } else {
    const saved = sectionScrollPositions.get(`${currentBookId}::${currentSectionIndex}`);
    content.scrollTop = saved || 0; // السابق: يستعيد نفس مستوى النزول الذي كان عنده
  }
}

function triggerPageTransition(delta) {
  const bar = document.getElementById('pageTransitionBar');
  if (!bar) return;
  bar.classList.remove('sweep-next', 'sweep-prev');
  void bar.offsetWidth; // إعادة تشغيل الأنيميشن
  bar.classList.add(delta > 0 ? 'sweep-next' : 'sweep-prev');
}

// ---------- SWIPE NAVIGATION (التمرير الجانبي بين الصفحات) ----------
function setupSwipeNavigation() {
  const content = document.getElementById('content');
  let startX = 0, startY = 0, tracking = false;
  content.addEventListener('touchstart', (e) => {
    if (!document.getElementById('readerPage').classList.contains('active')) { tracking = false; return; }
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // السحب لليمين = التالي (يبدأ من الأعلى)، السحب لليسار = السابق (يستعيد مستوى القراءة)
    const direction = dx > 0 ? 1 : -1;
    if (searchResultContext) {
      navSearchResult(direction);
    } else {
      navSection(direction);
    }
  }, { passive: true });

  // مؤشر القراءة العائم: يعرض أقرب مسألة/سؤال للأعلى أثناء التمرير السريع
  let scrollIndicatorTimeout = null;
  content.addEventListener('scroll', () => {
    if (!document.getElementById('readerPage').classList.contains('active')) return;
    const blocks = document.querySelectorAll('#readerPage .masala-block');
    if (!blocks.length) return;
    let nearest = null, nearestDist = Infinity;
    const contentTop = content.getBoundingClientRect().top;
    blocks.forEach(b => {
      const dist = Math.abs(b.getBoundingClientRect().top - contentTop - 40);
      if (dist < nearestDist) { nearestDist = dist; nearest = b; }
    });
    if (!nearest) return;
    const indicator = document.getElementById('scrollIndicator');
    const typeLabel = nearest.dataset.blocktype || 'مسألة';
    indicator.textContent = `${typeLabel} ${nearest.dataset.masala}`;
    // نحرّك المؤشر رأسياً بنفس نسبة موضع التمرير الحالي، فيتبع شريط السحب بصرياً
    const maxScroll = content.scrollHeight - content.clientHeight;
    const ratio = maxScroll > 0 ? content.scrollTop / maxScroll : 0;
    const usableHeight = content.clientHeight - 40;
    indicator.style.top = `${content.getBoundingClientRect().top + 10 + ratio * usableHeight}px`;
    indicator.style.transform = 'none';
    indicator.classList.add('show');
    clearTimeout(scrollIndicatorTimeout);
    scrollIndicatorTimeout = setTimeout(() => indicator.classList.remove('show'), 700);
    updateCustomScrollbar();
  }, { passive: true });

  setupCustomScrollbar();
}

// ---------- شريط تمرير مخصص قابل للسحب باللمس ----------
// الشريط الأصلي (::-webkit-scrollbar) لا يمكن سحبه بإصبع على أغلب متصفحات
// الجوال (مجرد مؤشر بصري لا يستجيب للمس)، فهذا شريط حقيقي نبنيه ونتحكم به يدوياً.
function updateCustomScrollbar() {
  const content = document.getElementById('content');
  const track = document.getElementById('customScrollbarTrack');
  const thumb = document.getElementById('customScrollbarThumb');
  const trackHeight = track.clientHeight;
  const maxScroll = content.scrollHeight - content.clientHeight;
  if (maxScroll <= 2) { track.classList.remove('active'); thumb.style.opacity = '0'; return; }
  thumb.style.opacity = '1';
  track.classList.add('active');
  const thumbHeight = Math.max(36, (content.clientHeight / content.scrollHeight) * trackHeight);
  const ratio = content.scrollTop / maxScroll;
  const thumbTop = ratio * (trackHeight - thumbHeight);
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.top = `${thumbTop}px`;
}

function setupCustomScrollbar() {
  const content = document.getElementById('content');
  const thumb = document.getElementById('customScrollbarThumb');
  const track = document.getElementById('customScrollbarTrack');
  let dragging = false, startY = 0, startScrollTop = 0;

  thumb.addEventListener('touchstart', (e) => {
    dragging = true;
    thumb.classList.add('dragging');
    startY = e.touches[0].clientY;
    startScrollTop = content.scrollTop;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const trackHeight = track.clientHeight;
    const maxScroll = content.scrollHeight - content.clientHeight;
    const dy = e.touches[0].clientY - startY;
    const scrollDelta = (dy / trackHeight) * content.scrollHeight;
    content.scrollTop = Math.max(0, Math.min(maxScroll, startScrollTop + scrollDelta));
    updateCustomScrollbar();
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove('dragging');
  });

  // إعادة الحساب عند كل تبديل صفحة (الحجم يختلف باختلاف المحتوى)
  const observer = new MutationObserver(() => updateCustomScrollbar());
  observer.observe(content, { childList: true, subtree: true });
  window.addEventListener('resize', updateCustomScrollbar);
  setInterval(updateCustomScrollbar, 600);
}

// ---------- زر/إيماءة الرجوع في الجوال (Hardware Back) ----------
// نضيف "حارساً" واحداً فقط في تاريخ المتصفح. أي ضغطة رجوع (زر أو إيماءة)
// تستهلك هذا الحارس فتُطلق popstate، فنتصرف داخلياً (الرجوع لصفحة سابقة
// بالتطبيق) ثم نعيد وضع الحارس فوراً ليبقى جاهزاً للضغطة التالية. إذا كنا
// بالصفحة الرئيسية (navStack فاضي) لا نتدخل، فيخرج المستخدم بشكل طبيعي.
let exitConfirmPending = false;
let exitConfirmTimeout = null;
function setupHardwareBack() {
  history.pushState({ rsGuard: true }, '');
  window.addEventListener('popstate', () => {
    if (navStack.length > 0) {
      const prev = navStack.pop();
      prev();
      if (navStack.length === 0) document.getElementById('backBtn').style.display = 'none';
      history.pushState({ rsGuard: true }, '');
      return;
    }
    // نحن بالصفحة الرئيسية: أول ضغطة نحذّر ونمتص الضغطة، الثانية (خلال ثانيتين) تسمح بالخروج فعلاً
    if (!exitConfirmPending) {
      exitConfirmPending = true;
      showExitToast();
      history.pushState({ rsGuard: true }, '');
      clearTimeout(exitConfirmTimeout);
      exitConfirmTimeout = setTimeout(() => { exitConfirmPending = false; }, 2000);
    }
    // إذا كانت exitConfirmPending=true (ضغطة ثانية بنفس الفترة): لا نفعل شيء، فيخرج المستخدم فعلياً
  });
}

function showExitToast() {
  const toast = document.getElementById('exitToast');
  toast.classList.add('show');
  clearTimeout(toast._hideTimeout);
  toast._hideTimeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ---------- مسألة TOOLS (نسخ / إشارة مرجعية) ----------
function attachMasalaToolEvents() {
  const blocks = document.querySelectorAll('#readerPage .masala-block');
  blocks.forEach(b => {
    b.addEventListener('click', (e) => {
      if (e.target.closest('.masala-tools')) return; // النقر على الأيقونات نفسها لا يبدّل الحالة
      const wasTouched = b.classList.contains('touched');
      blocks.forEach(x => x.classList.remove('touched'));
      if (!wasTouched) b.classList.add('touched');
    });
  });
  // النقر في أي مكان آخر من الصفحة يخفي الأدوات
  document.getElementById('readerPage').addEventListener('click', (e) => {
    if (e.target.closest('.masala-block')) return;
    blocks.forEach(x => x.classList.remove('touched'));
  });
}

function getMasalaText(num) {
  const sec = currentSections[currentSectionIndex];
  const parts = sec.body.split(BLOCK_MARKER_SPLIT);
  for (const part of parts) {
    const m = part.match(BLOCK_MARKER_CAPTURE);
    if (m && normalizeDigits(m[1]) === num) return part.trim();
  }
  return '';
}

function copyMasala(evt, num) {
  evt.stopPropagation();
  const text = getMasalaText(num);
  if (!text) return;
  const book = allBooks.find(b => b.id === currentBookId);
  const authorName = (allAuthors[book.author_id] || allAuthors[GLOSSARY_AUTHOR_ID] || '').trim();
  const sectionTitle = currentSections[currentSectionIndex] ? currentSections[currentSectionIndex].title : '';
  const citation = `${text}\n\nالمصدر: ${authorName} - ${book.name} - ${sectionTitle}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(citation).then(() => flashCopyButton(evt.target));
  } else {
    const ta = document.createElement('textarea');
    ta.value = citation; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    flashCopyButton(evt.target);
  }
}
function flashCopyButton(btn) {
  const old = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = old; }, 1000);
}

function isMasalaFavorite(bookId, sectionIdx, masalaNum) {
  return favorites.some(f => f.bookId === bookId && f.sectionIdx === sectionIdx && f.masalaNum === masalaNum);
}

function toggleMasalaFavorite(evt, num) {
  evt.stopPropagation();
  const book = allBooks.find(b => b.id === currentBookId);
  const sec = currentSections[currentSectionIndex];
  const idx = favorites.findIndex(f => f.bookId === currentBookId && f.sectionIdx === currentSectionIndex && f.masalaNum === num);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    const snippet = getMasalaText(num).slice(0, 90);
    favorites.push({ bookId: currentBookId, sectionIdx: currentSectionIndex, title: sec.title, bookName: book.name, masalaNum: num, snippet });
  }
  localStorage.setItem('rs_favorites', JSON.stringify(favorites));
  evt.target.classList.toggle('bm-active');
  const block = document.querySelector(`#readerPage .masala-block[data-masala="${num}"]`);
  if (block) block.classList.toggle('masala-fav-persistent', idx < 0);
}

// ---------- المقارنة السريعة (علامة !) ----------
// يجلب نص مسألة معيّنة من أي كتاب (ليس بالضرورة الكتاب المفتوح حالياً)
function getMasalaTextFromBook(bookId, masalaNum) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return null;
  let rows;
  try {
    const res = db.exec(`SELECT body FROM "${book.bk_table}"`);
    rows = res.length ? res[0].values : [];
  } catch (e) { return null; }
  for (const [body] of rows) {
    if (!body) continue;
    const parts = body.split(BLOCK_MARKER_SPLIT);
    for (const part of parts) {
      const m = part.match(BLOCK_MARKER_CAPTURE);
      if (m && normalizeDigits(m[1]) === masalaNum) return part.trim();
    }
  }
  return null;
}

function toggleComparisonAccordion(evt, num) {
  evt.stopPropagation();
  const acc = document.getElementById(`cmp-acc-${num}`);
  if (!acc) return;
  if (acc.classList.contains('open')) { acc.classList.remove('open'); return; }
  if (!acc.dataset.built) {
    const group = comparisonIndex.get(`${currentBookId}::${num}`);
    acc.innerHTML = renderComparisonGroupHtml(group, currentBookId, num);
    acc.dataset.built = '1';
  }
  acc.classList.add('open');
}

function closeComparisonAccordion(num) {
  const acc = document.getElementById(`cmp-acc-${num}`);
  if (acc) acc.classList.remove('open');
}

function renderComparisonGroupHtml(group, excludeBookId, excludeMasalaNum) {
  let html = `<div class="cmp-acc-title">⚖️ آراء مراجع أخرى في هذه المسألة${group.topic ? ' — ' + escapeHtml(group.topic) : ''}</div>`;
  let any = false;
  for (const entry of group.entries) {
    if (entry.bookId === excludeBookId && entry.masalaNum === excludeMasalaNum) continue;
    const book = allBooks.find(b => b.id === entry.bookId);
    if (!book) continue;
    const text = getMasalaTextFromBook(entry.bookId, entry.masalaNum);
    if (!text) continue;
    any = true;
    const authorName = allAuthors[book.author_id] || '';
    html += `<div class="cmp-card">
      <div class="cmp-author">${escapeHtml(authorName)} — ${escapeHtml(book.name)}</div>
      <div class="cmp-text">${escapeHtml(text)}</div>
      <span class="cmp-goto" onclick="goToMasalaFromAccordion(${entry.bookId}, '${entry.masalaNum}')">عرض المسألة كاملة ‹</span>
    </div>`;
  }
  if (!any) html += `<div style="font-size:13px;color:var(--text-dim);">لا توجد بيانات لعرضها.</div>`;
  html += `<button class="cmp-acc-close" onclick="closeComparisonAccordion('${excludeMasalaNum}')">إغلاق</button>`;
  return html;
}

function goToMasalaFromAccordion(bookId, masalaNum) {
  // يفتح المسألة المقابلة كاملة في صفحتها الأصلية (سياق كامل بدون أي تصرف بالنص)
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  const res = db.exec(`SELECT rowid, title, body FROM "${book.bk_table}" ORDER BY rowid`);
  const sections = res.length ? res[0].values.map(r => ({ rowid: r[0], title: r[1] || '', body: r[2] || '' })) : [];
  const idx = sections.findIndex(s => {
    const parts = s.body.split(BLOCK_MARKER_SPLIT);
    return parts.some(p => {
      const m = p.match(BLOCK_MARKER_CAPTURE);
      return m && normalizeDigits(m[1]) === masalaNum;
    });
  });
  navStack = [];
  pushNav(() => showTab(currentTab));
  openBookIndex(bookId);
  openReader(bookId, idx >= 0 ? idx : 0);
}

// ---------- التعليقات/الملاحظات على المسائل ----------
let notes = JSON.parse(localStorage.getItem('rs_notes') || '[]');
// شكل العنصر: {bookId, sectionIdx, masalaNum, text, title, bookName}

function getNoteFor(bookId, sectionIdx, masalaNum) {
  const n = notes.find(x => x.bookId === bookId && x.sectionIdx === sectionIdx && x.masalaNum === masalaNum);
  return n ? n.text : null;
}

function saveNoteStorage() {
  localStorage.setItem('rs_notes', JSON.stringify(notes));
}

function setNoteFor(bookId, sectionIdx, masalaNum, text, title, bookName) {
  const idx = notes.findIndex(x => x.bookId === bookId && x.sectionIdx === sectionIdx && x.masalaNum === masalaNum);
  if (!text.trim()) {
    if (idx >= 0) notes.splice(idx, 1);
  } else if (idx >= 0) {
    notes[idx].text = text;
  } else {
    notes.push({ bookId, sectionIdx, masalaNum, text, title, bookName });
  }
  saveNoteStorage();
}

function toggleNoteEditor(evt, num) {
  evt.stopPropagation();
  const acc = document.getElementById(`note-acc-${num}`);
  if (!acc) return;
  if (acc.classList.contains('open')) { acc.classList.remove('open'); return; }
  const existing = getNoteFor(currentBookId, currentSectionIndex, num) || '';
  acc.innerHTML = `
    <textarea id="note-text-${num}" placeholder="اكتب ملاحظتك هنا...">${escapeHtml(existing)}</textarea>
    <div class="note-acc-actions">
      <button class="note-save" onclick="saveNoteFromEditor(event, '${num}')">حفظ</button>
      <button class="note-cancel" onclick="closeNoteEditor('${num}')">إغلاق</button>
    </div>`;
  acc.classList.add('open');
}

function closeNoteEditor(num) {
  const acc = document.getElementById(`note-acc-${num}`);
  if (acc) acc.classList.remove('open');
}

function saveNoteFromEditor(evt, num) {
  evt.stopPropagation();
  const textarea = document.getElementById(`note-text-${num}`);
  const book = allBooks.find(b => b.id === currentBookId);
  const sec = currentSections[currentSectionIndex];
  setNoteFor(currentBookId, currentSectionIndex, num, textarea.value, sec.title, book.name);
  closeNoteEditor(num);
  // تحديث مظهر أيقونة الملاحظة (نشطة/غير نشطة) دون إعادة رسم الصفحة كاملة
  const btn = document.querySelector(`#readerPage .masala-block[data-masala="${num}"] button[title="ملاحظة"]`);
  if (btn) btn.classList.toggle('note-active', !!textarea.value.trim());
  // تحديث النص الظاهر دائماً تحت المسألة
  const display = document.getElementById(`note-display-${num}`);
  if (display) {
    if (textarea.value.trim()) {
      display.textContent = '📝 ' + textarea.value;
      display.style.display = 'block';
    } else {
      display.style.display = 'none';
    }
  }
}


function isFavorite(bookId, sectionIdx) {
  return favorites.some(f => f.bookId === bookId && f.sectionIdx === sectionIdx && !f.masalaNum);
}

function toggleFavorite() {
  const book = allBooks.find(b => b.id === currentBookId);
  const sec = currentSections[currentSectionIndex];
  const idx = favorites.findIndex(f => f.bookId === currentBookId && f.sectionIdx === currentSectionIndex && !f.masalaNum);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push({ bookId: currentBookId, sectionIdx: currentSectionIndex, title: sec.title, bookName: book.name });
  }
  localStorage.setItem('rs_favorites', JSON.stringify(favorites));
  renderReaderContent();
}

function renderFavoritesPage() {
  const container = document.getElementById('favoritesPage');
  if (favorites.length === 0 && notes.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="ic">⭐</div>لا توجد مسائل في المفضلة بعد<br>اضغط على ★ أثناء القراءة لإضافتها</div>';
    return;
  }
  let html = '';
  if (favorites.length) {
    html += `<div class="section-header">⭐ المفضلة (${favorites.length})</div>`;
    favorites.forEach((f, i) => {
      const subtitle = f.masalaNum ? `مسألة ${f.masalaNum} — ${f.bookName}` : f.bookName;
      html += `<div class="list-row" onclick="openFavorite(${i})">
        <span style="font-size:18px;color:gold;">★</span>
        <div class="label">${escapeHtml(f.title)}<div class="sub">${escapeHtml(subtitle)}</div></div>
      </div>`;
    });
  }
  if (notes.length) {
    html += `<div class="section-header">📝 المسائل التي عليها تعليق (${notes.length})</div>`;
    notes.forEach((n, i) => {
      html += `<div class="list-row" onclick="openNoteFromFavorites(${i})">
        <span style="font-size:18px;">📝</span>
        <div class="label">${escapeHtml(n.title)}<div class="sub">مسألة ${escapeHtml(n.masalaNum)} — ${escapeHtml(n.bookName)}</div></div>
      </div>`;
    });
  }
  container.innerHTML = html;
}

function openNoteFromFavorites(i) {
  const n = notes[i];
  navStack = [];
  pushNav(() => showTab('favorites'));
  openReader(n.bookId, n.sectionIdx);
  setTimeout(() => {
    const block = document.querySelector(`#readerPage .masala-block[data-masala="${n.masalaNum}"]`);
    if (block) {
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      block.classList.add('fav-jump-highlight');
    }
  }, 60);
}

function openFavorite(i) {
  const f = favorites[i];
  navStack = [];
  pushNav(() => showTab('favorites'));
  openReader(f.bookId, f.sectionIdx);
  if (f.masalaNum) {
    setTimeout(() => {
      const block = document.querySelector(`#readerPage .masala-block[data-masala="${f.masalaNum}"]`);
      if (block) {
        block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        block.classList.add('fav-jump-highlight');
      }
    }, 60);
  }
}

// ---------- GLOSSARY POPUP (النافذة المنبثقة للمعاني) ----------
function openGlossaryPopup(term) {
  const defs = glossaryMap.get(term);
  if (!defs || !defs.length) return;
  const card = document.getElementById('glossaryCard');
  let html = `<h4>${escapeHtml(term)}</h4>`;
  html += `<div class="gdef-warning">المعنى قد لا يتوافق مع السياق</div>`;
  defs.forEach(d => {
    html += `<div class="gdef">${escapeHtml(d.def)}<span class="gsrc">المصدر: ${escapeHtml(d.source)}</span></div>`;
  });
  html += `<button class="gclose" onclick="closeGlossaryPopup()">إغلاق</button>`;
  card.innerHTML = html;
  document.getElementById('glossaryOverlay').classList.add('show');
}
function closeGlossaryPopup() {
  // إغلاق النافذة فقط دون أي تمرير للصفحة، فيبقى القارئ في نفس السطر الذي كان فيه
  document.getElementById('glossaryOverlay').classList.remove('show');
}

// ---------- SEARCH ----------

// تطبيع عربي مرن: يتجاهل اختلاف الهمزات (أ،إ،آ) والتاء المربوطة/الهاء والألف المقصورة
function normalizeArabic(s) {
  return String(s)
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/ى/g, 'ي');
}

function toggleSearchFilterPanel() {
  document.getElementById('searchFilterPanel').classList.toggle('show');
}

function buildSearchFilterPanel() {
  const panel = document.getElementById('searchFilterPanel');
  let html = `<div class="filter-actions filter-actions-top">
    <button onclick="setAllFilterChecks(true)">تحديد الكل</button>
    <button onclick="setAllFilterChecks(false)">إلغاء التحديد</button>
  </div>`;
  for (const aid of authorOrder) {
    const name = allAuthors[aid];
    const books = allBooks.filter(b => aid === GLOSSARY_AUTHOR_ID ? !allAuthors[b.author_id] : b.author_id === aid);
    if (!books.length) continue;
    html += `<div class="filter-author-group">
      <div class="filter-author-row" onclick="toggleFilterAuthorExpand(event, '${aid}')">
        <input type="checkbox" checked data-author="${aid}" onclick="event.stopPropagation()" onchange="onFilterAuthorToggle(this)">
        <span>${escapeHtml(name)}</span>
        <span class="toggle-arrow">‹</span>
      </div>
      <div class="filter-books-sub" id="filter-books-${aid}">`;
    for (const b of books) {
      html += `<div class="filter-book-row">
        <input type="checkbox" checked data-book="${b.id}" data-author-of="${aid}">
        <span>${escapeHtml(b.name)}</span>
      </div>`;
    }
    html += `</div></div>`;
  }
  panel.innerHTML = html;
  panel.dataset.built = '1';
}

function toggleFilterAuthorExpand(evt, aid) {
  const sub = document.getElementById(`filter-books-${aid}`);
  const row = evt.currentTarget;
  sub.classList.toggle('expanded');
  row.classList.toggle('expanded');
}

function onFilterAuthorToggle(checkbox) {
  const aid = checkbox.dataset.author;
  document.querySelectorAll(`input[data-author-of="${aid}"]`).forEach(c => c.checked = checkbox.checked);
}

function setAllFilterChecks(state) {
  document.querySelectorAll('#searchFilterPanel input[type=checkbox]').forEach(c => c.checked = state);
}

function getSelectedBookIds() {
  const ids = new Set();
  document.querySelectorAll('#searchFilterPanel input[data-book]').forEach(c => {
    if (c.checked) ids.add(parseInt(c.dataset.book, 10));
  });
  return ids;
}

// ---------- حالة نتائج البحث الحالية (للترقيم والتنقل بالسحب بين النتائج) ----------
let lastSearchResults = [];
let lastSearchTerm = '';
const SEARCH_PAGE_SIZE = 20;
let searchCurrentPage = 1;
// عندما يُفتح القارئ من نتيجة بحث، يُملأ هذا السياق فيتحكم بالسحب الجانبي
let searchResultContext = null; // { results: [...], index: N }

function doSearch() {
  const rawTerm = document.getElementById('searchInput').value.trim();
  const resultsDiv = document.getElementById('searchResults');
  const paginationDiv = document.getElementById('searchPagination');
  if (!rawTerm) { resultsDiv.innerHTML = ''; paginationDiv.innerHTML = ''; return; }
  resultsDiv.innerHTML = '<div class="empty-state">جاري البحث...</div>';
  paginationDiv.innerHTML = '';

  const precision = document.querySelector('input[name="searchPrecision"]:checked').value; // exact | scattered
  const scope = document.querySelector('input[name="searchScope"]:checked').value; // both | titles | body
  const filterBuilt = document.getElementById('searchFilterPanel').dataset.built;
  const selectedIds = filterBuilt ? getSelectedBookIds() : null;

  const normTerm = normalizeArabic(rawTerm);
  const queryWords = normTerm.split(/\s+/).filter(Boolean);

  setTimeout(() => {
    const results = [];
    for (const book of allBooks) {
      if (selectedIds && !selectedIds.has(book.id)) continue;
      let rows;
      try {
        const res = db.exec(`SELECT rowid, title, body FROM "${book.bk_table}" ORDER BY rowid`);
        rows = res.length ? res[0].values : [];
      } catch (e) { continue; }
      for (const [rowid, title, body] of rows) {
        const t = title || '', b = body || '';
        const normTitle = scope !== 'body' ? normalizeArabic(t) : '';
        const normBody = scope !== 'titles' ? normalizeArabic(b) : '';
        const haystack = normTitle + '\n' + normBody;
        let isMatch;
        if (precision === 'exact') {
          isMatch = haystack.includes(normTerm);
        } else {
          isMatch = queryWords.every(w => haystack.includes(w));
        }
        if (isMatch) {
          results.push({ bookId: book.id, bookName: book.name, rowid, title: t, body: b });
          if (results.length >= 500) break;
        }
      }
      if (results.length >= 500) break;
    }

    lastSearchResults = results;
    lastSearchTerm = rawTerm;
    searchCurrentPage = 1;
    renderSearchResultsPage();
  }, 30);
}

function renderSearchResultsPage() {
  const resultsDiv = document.getElementById('searchResults');
  const paginationDiv = document.getElementById('searchPagination');
  const results = lastSearchResults;
  const term = lastSearchTerm;

  if (results.length === 0) {
    const googleUrl = `https://www.google.com/search?q=site:sistani.org+${encodeURIComponent(term)}`;
    resultsDiv.innerHTML = `<div id="searchEmpty">لا توجد نتائج لكلمة "${escapeHtml(term)}"</div>
      <a class="external-search-row" href="${googleUrl}" target="_blank" rel="noopener">
        🌐 بحث "${escapeHtml(term)}" في موقع السيستاني الرسمي (نتائج Google، يفتح بتبويب جديد)
      </a>`;
    paginationDiv.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(results.length / SEARCH_PAGE_SIZE);
  const startIdx = (searchCurrentPage - 1) * SEARCH_PAGE_SIZE;
  const pageResults = results.slice(startIdx, startIdx + SEARCH_PAGE_SIZE);

  let html = `<div class="section-header">${results.length} نتيجة — صفحة ${searchCurrentPage} من ${totalPages}</div>`;
  const googleSiteSearchUrl = `https://www.google.com/search?q=site:sistani.org+${encodeURIComponent(term)}`;
  html += `<a class="external-search-row" href="${googleSiteSearchUrl}" target="_blank" rel="noopener">
    🌐 بحث "${escapeHtml(term)}" في موقع السيستاني الرسمي (نتائج Google، يفتح بتبويب جديد)
  </a>`;
  pageResults.forEach((r, i) => {
    const globalIdx = startIdx + i;
    const snippet = makeSnippet(r.body, term);
    html += `<div class="result-row" onclick="searchResultClick(${globalIdx})">
      <div class="rbook">${escapeHtml(r.bookName)}</div>
      <div class="rtitle">${highlightTerm(escapeHtml(r.title), term)}</div>
      <div class="rsnippet">${snippet}</div>
    </div>`;
  });
  resultsDiv.innerHTML = html;
  renderSearchPagination(totalPages);
}

function renderSearchPagination(totalPages) {
  const paginationDiv = document.getElementById('searchPagination');
  if (totalPages <= 1) { paginationDiv.innerHTML = ''; return; }
  let html = '';
  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="${p === searchCurrentPage ? 'active' : ''}" onclick="goToSearchPage(${p})">${p}</button>`;
  }
  paginationDiv.innerHTML = html;
}

function goToSearchPage(p) {
  searchCurrentPage = p;
  renderSearchResultsPage();
  document.getElementById('searchResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function makeSnippet(body, term) {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(term.toLowerCase());
  let snippet;
  if (idx === -1) {
    snippet = body.slice(0, 120);
  } else {
    const start = Math.max(0, idx - 40);
    const end = Math.min(body.length, idx + term.length + 80);
    snippet = (start > 0 ? '...' : '') + body.slice(start, end) + (end < body.length ? '...' : '');
  }
  return highlightTerm(escapeHtml(snippet), term);
}

function highlightTerm(escapedText, term) {
  if (!term) return escapedText;
  const escTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escTerm, 'gi');
  return escapedText.replace(re, m => `<mark>${m}</mark>`);
}

// التوجيه المباشر: فتح القارئ والتمرير فوراً لموضع الكلمة وتمييزها (يبقى ثابتاً بلا تلاشٍ)
// resultIndex: فهرس النتيجة داخل lastSearchResults الكاملة (لا داخل الصفحة الحالية فقط)
function searchResultClick(resultIndex) {
  const r = lastSearchResults[resultIndex];
  if (!r) return;
  const book = allBooks.find(b => b.id === r.bookId);
  currentAuthorId = allAuthors[book.author_id] ? book.author_id : GLOSSARY_AUTHOR_ID;
  currentBookTable = book.bk_table;
  const res = db.exec(`SELECT rowid, title, body FROM "${currentBookTable}" ORDER BY rowid`);
  currentSections = res.length ? res[0].values.map(rr => ({ rowid: rr[0], title: rr[1] || '(بدون عنوان)', body: rr[2] || '' })) : [];
  const idx = currentSections.findIndex(s => s.rowid === r.rowid);
  navStack = [];
  pushNav(() => showTab('search'));
  currentBookId = r.bookId;
  currentSectionIndex = idx >= 0 ? idx : 0;
  pendingSearchTerm = lastSearchTerm;
  searchResultContext = { results: lastSearchResults, index: resultIndex };
  renderReaderContent();
  switchPage('readerPage', book.name);
  showBreadcrumb([allAuthors[currentAuthorId], book.name, currentSections[currentSectionIndex].title]);
  saveLastPosition();
}

// التنقل بين نتائج البحث (يُستخدم من السحب الجانبي إن كان سياق بحث نشطاً)
function navSearchResult(delta) {
  const newIndex = searchResultContext.index + delta;
  if (newIndex < 0 || newIndex >= searchResultContext.results.length) return;
  searchResultClick(newIndex);
}

// يبحث عن أول ظهور للكلمة داخل النص المعروض، يمرّر إليه، ويميّزه (تظليل ثابت لا يتلاشى)
function applyPendingSearchHighlight() {
  if (!pendingSearchTerm) return;
  const term = pendingSearchTerm;
  pendingSearchTerm = null;
  const bodyEl = document.querySelector('#readerPage .body-text');
  if (!bodyEl) return;

  const escTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escTerm, 'i');
  const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const m = node.nodeValue.match(re);
    if (m) {
      const before = node.nodeValue.slice(0, m.index);
      const matchTxt = node.nodeValue.slice(m.index, m.index + m[0].length);
      const after = node.nodeValue.slice(m.index + m[0].length);
      const span = document.createElement('mark');
      span.className = 'search-flash'; // يبقى ثابتاً طالما الصفحة مفتوحة عبر نتيجة بحث (بدون تلاشٍ تلقائي)
      span.textContent = matchTxt;
      const parent = node.parentNode;
      const afterNode = document.createTextNode(after);
      parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(span, node);
      parent.insertBefore(afterNode, node);
      parent.removeChild(node);
      setTimeout(() => {
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      break;
    }
  }
}

// ---------- صفحة الكتابة (كتابة حرة) ----------
let freeWritings = JSON.parse(localStorage.getItem('rs_writings') || '[]'); // [{id, text, updatedAt}]
let currentWritingId = null;

function saveWritingsStorage() {
  localStorage.setItem('rs_writings', JSON.stringify(freeWritings));
}

function renderWritingPage() {
  currentWritingId = null;
  const container = document.getElementById('writingPage');
  let html = `<div class="writing-list-header">
      <h2 style="margin:0;">الكتابة</h2>
      <button class="writing-add-btn" onclick="openWritingEditor(null)">+ كتابة جديدة</button>
    </div>`;
  if (!freeWritings.length) {
    html += `<div class="cmp-empty">✍️ لا توجد كتابات سابقة بعد. اضغط "+ كتابة جديدة" للبدء.</div>`;
  } else {
    html += `<div class="writing-list">`;
    freeWritings.slice().reverse().forEach(w => {
      const preview = (w.text || '').slice(0, 70) || '(كتابة فارغة)';
      html += `<div class="list-row" onclick="openWritingEditor('${w.id}')">
        <span style="font-size:18px;">📄</span>
        <div class="label">${escapeHtml(preview)}${w.text && w.text.length > 70 ? '…' : ''}</div>
      </div>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}

function openWritingEditor(id) {
  currentWritingId = id;
  const container = document.getElementById('writingPage');
  const writing = id ? freeWritings.find(w => w.id === id) : null;
  container.innerHTML = `
    <div class="writing-list-header">
      <button class="writing-back-btn" onclick="renderWritingPage()">‹ القائمة</button>
      <button class="writing-fav-toggle-btn" onclick="toggleWritingFavPanel()">⭐📝 إدراج من المفضلة/التعليقات</button>
    </div>
    <div id="writingFavPanel" class="writing-fav-panel"></div>
    <textarea id="writingMainTextarea" placeholder="اكتب هنا...">${escapeHtml(writing ? writing.text : '')}</textarea>
    <div class="writing-actions">
      <button class="writing-save" onclick="saveCurrentWriting()">حفظ</button>
      <button class="writing-copy" onclick="copyCurrentWriting()">📋 نسخ</button>
      <button class="writing-share" onclick="shareCurrentWriting()">↗ مشاركة</button>
      ${writing ? `<button class="writing-delete" onclick="deleteCurrentWriting()">حذف</button>` : ''}
    </div>`;
}

function toggleWritingFavPanel() {
  const panel = document.getElementById('writingFavPanel');
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  const favMasalas = favorites.filter(f => f.masalaNum);
  let html = '';
  if (favMasalas.length) {
    html += `<div class="section-header">⭐ المفضلة</div>`;
    html += favMasalas.map((f, i) => `
      <div class="writing-fav-item" onclick="insertFavoriteIntoWriting(${i})">
        <div class="wf-title">${escapeHtml(f.title)}</div>
        <div class="wf-sub">مسألة ${escapeHtml(f.masalaNum)} — ${escapeHtml(f.bookName)}</div>
      </div>`).join('');
  }
  if (notes.length) {
    html += `<div class="section-header">📝 التعليقات</div>`;
    html += notes.map((n, i) => `
      <div class="writing-fav-item" onclick="insertNoteIntoWriting(${i})">
        <div class="wf-title">${escapeHtml(n.title)}</div>
        <div class="wf-sub">مسألة ${escapeHtml(n.masalaNum)} — ${escapeHtml(n.bookName)}</div>
      </div>`).join('');
  }
  panel.innerHTML = html || `<div class="cmp-empty" style="padding:16px;">لا توجد مسائل مؤشر عليها بنجمة أو فيها تعليق بعد.</div>`;
  panel.classList.add('open');
}

function insertTextAtCursor(text) {
  const textarea = document.getElementById('writingMainTextarea');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  const newPos = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(newPos, newPos);
  document.getElementById('writingFavPanel').classList.remove('open');
}

function insertFavoriteIntoWriting(i) {
  const f = favorites.filter(fv => fv.masalaNum)[i];
  if (!f) return;
  insertTextAtCursor(getMasalaTextFromBook(f.bookId, f.masalaNum) || f.snippet || '');
}

function insertNoteIntoWriting(i) {
  const n = notes[i];
  if (!n) return;
  const masalaText = getMasalaTextFromBook(n.bookId, n.masalaNum) || '';
  insertTextAtCursor(masalaText + (n.text ? `\n(تعليقي: ${n.text})` : ''));
}

function saveCurrentWriting() {
  const text = document.getElementById('writingMainTextarea').value;
  if (currentWritingId) {
    const w = freeWritings.find(x => x.id === currentWritingId);
    if (w) { w.text = text; w.updatedAt = Date.now(); }
  } else {
    const id = 'w' + Date.now();
    freeWritings.push({ id, text, updatedAt: Date.now() });
    currentWritingId = id;
  }
  saveWritingsStorage();
  renderWritingPage();
}

function copyCurrentWriting() {
  const text = document.getElementById('writingMainTextarea').value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
}

function shareCurrentWriting() {
  const text = document.getElementById('writingMainTextarea').value;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    copyCurrentWriting();
  }
}

function deleteCurrentWriting() {
  if (!currentWritingId) return;
  freeWritings = freeWritings.filter(w => w.id !== currentWritingId);
  saveWritingsStorage();
  renderWritingPage();
}
function renderComparisonPage() {
  const container = document.getElementById('comparisonPage');
  if (!masalaComparisons.length) {
    container.innerHTML = `
      <h2>المقارنة</h2>
      <div class="cmp-empty">
        ⚖️ لا توجد بيانات مقارنة مُدخلة حتى الآن.<br><br>
        هذه الصفحة تعرض مقارنة بين آراء المراجع في مسائل محددة يتم تحديدها يدوياً من قِبل شخص مختص
        بعد التأكد من تطابق الموضوع، لتجنّب أي خطأ في نسبة حكم فقهي لمسألة لا تخصه.
      </div>`;
    return;
  }
  let html = `<h2>المقارنة</h2>
    <select id="cmpTopicSelect" onchange="onCmpTopicChange()">
      <option value="">— اختر الموضوع المشترك —</option>
      ${masalaComparisons.map((g, i) => `<option value="${i}">${escapeHtml(g.topic || ('موضوع ' + (i + 1)))}</option>`).join('')}
    </select>
    <div id="cmpAuthorChecks"></div>
    <div id="cmpResultTable" class="cmp-table"></div>`;
  container.innerHTML = html;
}

function onCmpTopicChange() {
  const idx = document.getElementById('cmpTopicSelect').value;
  const checksDiv = document.getElementById('cmpAuthorChecks');
  const resultDiv = document.getElementById('cmpResultTable');
  resultDiv.innerHTML = '';
  if (idx === '') { checksDiv.innerHTML = ''; return; }
  const group = masalaComparisons[parseInt(idx, 10)];
  let html = '';
  group.entries.forEach((entry, i) => {
    const book = allBooks.find(b => b.id === entry.bookId);
    if (!book) return;
    const authorName = allAuthors[book.author_id] || '';
    html += `<label><input type="checkbox" checked data-cmp-entry="${i}"> ${escapeHtml(authorName)}</label>`;
  });
  checksDiv.innerHTML = html;
  checksDiv.dataset.groupIdx = idx;
  renderCmpResultTable();
  checksDiv.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', renderCmpResultTable));
}

function renderCmpResultTable() {
  const checksDiv = document.getElementById('cmpAuthorChecks');
  const resultDiv = document.getElementById('cmpResultTable');
  const groupIdx = checksDiv.dataset.groupIdx;
  if (groupIdx === undefined) return;
  const group = masalaComparisons[parseInt(groupIdx, 10)];
  let html = '';
  group.entries.forEach((entry, i) => {
    const checkbox = checksDiv.querySelector(`input[data-cmp-entry="${i}"]`);
    if (!checkbox || !checkbox.checked) return;
    const book = allBooks.find(b => b.id === entry.bookId);
    if (!book) return;
    const authorName = allAuthors[book.author_id] || '';
    const text = getMasalaTextFromBook(entry.bookId, entry.masalaNum);
    html += `<div class="cmp-card">
      <div class="cmp-author">${escapeHtml(authorName)} — ${escapeHtml(book.name)}</div>
      <div class="cmp-text">${text ? escapeHtml(text) : 'تعذّر إيجاد نص المسألة'}</div>
      <span class="cmp-goto" onclick="goToMasalaFromAccordion(${entry.bookId}, '${entry.masalaNum}')">عرض المسألة كاملة ‹</span>
    </div>`;
  });
  resultDiv.innerHTML = html || '<div class="cmp-empty">اختر مرجعاً واحداً على الأقل</div>';
}

// ---------- UTIL ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', init);
