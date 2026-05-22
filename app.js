// =============================================
//  QT Journal — app.js
//  Firebase Auth + Firestore + 전체 앱 로직
//  [설정 필요] FIREBASE_CONFIG 와 WORKER_URL 교체
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ──────────────────────────────────────────
//  🔧 설정: 아래 두 값을 실제 값으로 교체
// ──────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbG7cu7YW1fHkhtjLuIW1Xb6Ex40NeLSc",
  authDomain: "qt-journal-eeheeree.firebaseapp.com",
  projectId: "qt-journal-eeheeree",
  storageBucket: "qt-journal-eeheeree.firebasestorage.app",
  messagingSenderId: "357865374616",
  appId: "1:357865374616:web:ba07f857f46819b432a1ed"
};
const WORKER_URL = "https://lucky-paper-33a1.continuingrace.workers.dev"; // Cloudflare Worker URL

// ──────────────────────────────────────────
//  Firebase 초기화
// ──────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ──────────────────────────────────────────
//  앱 상태
// ──────────────────────────────────────────
let currentUser = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDate = null;
let editingDate = null;
let allEntries = {}; // { "2025-01-15": { ...entry } }
let allTags = new Set();
let activeTagFilter = null;
let drawingCanvas, drawingCtx, isDrawing = false, currentColor = "#e8e8e8", currentTool = "pen";

const toDateStr = (y, m, d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const todayStr = () => toDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const fmtDate = s => { const [y,m,d] = s.split('-'); return `${y}년 ${+m}월 ${+d}일`; };

// ──────────────────────────────────────────
//  Auth
// ──────────────────────────────────────────
document.getElementById('btn-login').addEventListener('click', async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, provider);
  }
  catch(e) { console.error(e); }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
  allEntries = {}; allTags = new Set();
  showModal('settings', false);
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  document.getElementById('screen-login').classList.toggle('active', !user);
  document.getElementById('screen-app').classList.toggle('active', !!user);
  if (user) {
    document.getElementById('setting-user').textContent = `${user.displayName} (${user.email})`;
    await loadAllEntries();
    renderCalendar();
    renderStats();
    renderTagChips();
    showStreakToast();
  }
});

// ──────────────────────────────────────────
//  Firestore CRUD
// ──────────────────────────────────────────
async function saveEntry(dateStr, data) {
  const ref = doc(db, 'users', currentUser.uid, 'entries', dateStr);
  await setDoc(ref, { ...data, updatedAt: Date.now() });
  allEntries[dateStr] = data;
  updateTagSet();
}

async function loadAllEntries() {
  const col = collection(db, 'users', currentUser.uid, 'entries');
  const snap = await getDocs(col);
  allEntries = {};
  snap.forEach(d => { allEntries[d.id] = d.data(); });
  updateTagSet();
}

function updateTagSet() {
  allTags = new Set();
  Object.values(allEntries).forEach(e => {
    (e.tags || []).forEach(t => allTags.add(t));
  });
}

// ──────────────────────────────────────────
//  Calendar
// ──────────────────────────────────────────
document.getElementById('cal-prev').addEventListener('click', () => {
  currentMonth--; if(currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  currentMonth++; if(currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
});

function renderCalendar() {
  document.getElementById('cal-title').textContent = `${currentYear}년 ${currentMonth+1}월`;
  const container = document.getElementById('cal-days');
  container.innerHTML = '';
  const first = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
  const today = todayStr();

  // empty cells
  for(let i=0; i<first; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    container.appendChild(el);
  }

  for(let d=1; d<=daysInMonth; d++) {
    const ds = toDateStr(currentYear, currentMonth, d);
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = d;
    if(ds === today) el.classList.add('today');
    const entry = allEntries[ds];
    const tagOk = !activeTagFilter || (entry?.tags || []).includes(activeTagFilter);
    if(entry && tagOk) el.classList.add('has-entry');
    el.addEventListener('click', () => onDayClick(ds, !!entry));
    container.appendChild(el);
  }

  // today label
  const now = new Date();
  document.getElementById('today-label').textContent =
    `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${['일','월','화','수','목','금','토'][now.getDay()]}요일`;
}

function onDayClick(ds, hasEntry) {
  selectedDate = ds;
  if(hasEntry) openViewPage(ds);
  else openWritePage(ds);
}

// ──────────────────────────────────────────
//  Stats
// ──────────────────────────────────────────
function renderStats() {
  const total = Object.keys(allEntries).length;
  const ym = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}`;
  const month = Object.keys(allEntries).filter(k => k.startsWith(ym)).length;
  const streak = calcStreak();
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-month').textContent = month;
  document.getElementById('stat-streak').textContent = streak;
}

function calcStreak() {
  let streak = 0;
  const now = new Date();
  for(let i=0; i<365; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if(allEntries[ds]) streak++;
    else break;
  }
  return streak;
}

function showStreakToast() {
  const s = calcStreak();
  if(s < 1) return;
  const toast = document.getElementById('streak-toast');
  document.getElementById('streak-text').textContent = `🔥 연속 묵상 ${s}일째`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

document.getElementById('btn-streak').addEventListener('click', showStreakToast);

// ──────────────────────────────────────────
//  Tag Chips
// ──────────────────────────────────────────
function renderTagChips() {
  const container = document.getElementById('tag-chips');
  container.innerHTML = '';
  allTags.forEach(tag => {
    const el = document.createElement('button');
    el.className = 'tag-chip' + (activeTagFilter === tag ? ' active' : '');
    el.textContent = '#' + tag;
    el.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === tag ? null : tag;
      renderCalendar(); renderTagChips();
    });
    container.appendChild(el);
  });
}

// ──────────────────────────────────────────
//  Write Page
// ──────────────────────────────────────────
function openWritePage(ds) {
  editingDate = ds;
  document.getElementById('write-date-label').textContent = fmtDate(ds);
  // 기존 데이터 불러오기
  const e = allEntries[ds] || {};
  document.getElementById('verse-ref').value = e.verseRef || '';
  document.getElementById('verse-text').value = e.verseText || '';
  document.getElementById('creative-text').value = e.creative || '';
  document.getElementById('ind-observe').value = e.indObserve || '';
  document.getElementById('ind-interpret').value = e.indInterpret || '';
  document.getElementById('ind-apply').value = e.indApply || '';
  document.getElementById('sermon-preacher').value = e.sermonPreacher || '';
  document.getElementById('sermon-title').value = e.sermonTitle || '';
  document.getElementById('sermon-date').value = e.sermonDate || '';
  document.getElementById('sermon-notes').value = e.sermonNotes || '';
  document.getElementById('sermon-reflection').value = e.sermonReflection || '';
  renderCurrentTags(e.tags || []);
  // 캔버스
  if(e.drawing) {
    const img = new Image();
    img.onload = () => drawingCtx.drawImage(img, 0, 0);
    img.src = e.drawing;
  } else {
    drawingCtx && drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  // AI 초기화
  document.getElementById('ai-questions').innerHTML = '<p class="ai-hint">말씀을 입력하고 AI 질문을 받아보세요</p>';
  showPage('write');
}

document.getElementById('btn-write-today').addEventListener('click', () => openWritePage(todayStr()));
document.getElementById('btn-back-write').addEventListener('click', () => { showPage('calendar'); renderCalendar(); renderStats(); renderTagChips(); });
document.getElementById('btn-save').addEventListener('click', saveCurrentEntry);

async function saveCurrentEntry() {
  const btn = document.getElementById('btn-save');
  btn.textContent = '저장 중...'; btn.disabled = true;
  const tags = getCurrentTagsArray();
  const data = {
    verseRef: document.getElementById('verse-ref').value,
    verseText: document.getElementById('verse-text').value,
    creative: document.getElementById('creative-text').value,
    indObserve: document.getElementById('ind-observe').value,
    indInterpret: document.getElementById('ind-interpret').value,
    indApply: document.getElementById('ind-apply').value,
    sermonPreacher: document.getElementById('sermon-preacher').value,
    sermonTitle: document.getElementById('sermon-title').value,
    sermonDate: document.getElementById('sermon-date').value,
    sermonNotes: document.getElementById('sermon-notes').value,
    sermonReflection: document.getElementById('sermon-reflection').value,
    drawing: drawingCanvas ? drawingCanvas.toDataURL('image/png') : null,
    tags
  };
  await saveEntry(editingDate, data);
  btn.textContent = '저장됨 ✓'; btn.disabled = false;
  setTimeout(() => { btn.textContent = '저장'; }, 1500);
  renderCalendar(); renderStats(); renderTagChips();
}

// ──────────────────────────────────────────
//  Tag Handling
// ──────────────────────────────────────────
let currentTagsArr = [];
function renderCurrentTags(tags) {
  currentTagsArr = [...tags];
  const el = document.getElementById('current-tags');
  el.innerHTML = '';
  tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'curr-tag'; chip.textContent = '#' + t;
    chip.addEventListener('click', () => {
      currentTagsArr.splice(i, 1);
      renderCurrentTags(currentTagsArr);
    });
    el.appendChild(chip);
  });
}
function getCurrentTagsArray() { return [...currentTagsArr]; }
document.getElementById('tag-input').addEventListener('keydown', e => {
  if(e.key === 'Enter') {
    const val = e.target.value.trim().replace(/^#/,'');
    if(val && !currentTagsArr.includes(val)) {
      currentTagsArr.push(val); renderCurrentTags(currentTagsArr);
    }
    e.target.value = '';
  }
});

// ──────────────────────────────────────────
//  View Page
// ──────────────────────────────────────────
function openViewPage(ds) {
  const e = allEntries[ds] || {};
  document.getElementById('view-date-label').textContent = fmtDate(ds);
  const container = document.getElementById('view-content');
  container.innerHTML = '';

  if(e.tags?.length) {
    const row = document.createElement('div'); row.className = 'view-tags';
    e.tags.forEach(t => { const s = document.createElement('span'); s.className = 'view-tag'; s.textContent = '#'+t; row.appendChild(s); });
    container.appendChild(row);
  }
  if(e.verseRef || e.verseText) {
    const d = document.createElement('div'); d.className = 'view-verse';
    d.innerHTML = `<strong>${e.verseRef || ''}</strong><br>${e.verseText || ''}`;
    container.appendChild(d);
  }
  const sections = [
    ['🔭 낯설게 보기', e.creative],
    ['👁 관찰', e.indObserve], ['💡 해석', e.indInterpret], ['🙏 적용', e.indApply],
    ['🎙 강해 설교', [e.sermonPreacher, e.sermonTitle, e.sermonDate].filter(Boolean).join(' · ')],
    ['📝 설교 메모', e.sermonNotes], ['💭 개인 묵상', e.sermonReflection],
  ];
  sections.forEach(([title, text]) => {
    if(!text) return;
    const s = document.createElement('div'); s.className = 'view-section';
    s.innerHTML = `<div class="view-section-title">${title}</div><div class="view-text">${text}</div>`;
    container.appendChild(s);
  });
  if(e.drawing) {
    const s = document.createElement('div'); s.className = 'view-section';
    s.innerHTML = `<div class="view-section-title">🎨 그림</div><img class="view-drawing" src="${e.drawing}">`;
    container.appendChild(s);
  }
  document.getElementById('btn-edit-entry').onclick = () => openWritePage(ds);
  showPage('view');
}

document.getElementById('btn-back-view').addEventListener('click', () => { showPage('calendar'); });

// ──────────────────────────────────────────
//  Tab Navigation
// ──────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ──────────────────────────────────────────
//  Bottom Nav
// ──────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.page;
    if(p === 'write-today') { openWritePage(todayStr()); }
    else if(p === 'search') { showModal('search', true); }
    else { showPage('calendar'); renderCalendar(); renderStats(); renderTagChips(); }
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ──────────────────────────────────────────
//  Page / Modal Helpers
// ──────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
}
function showModal(name, show) {
  document.getElementById('modal-' + name).classList.toggle('hidden', !show);
}

document.getElementById('btn-settings-open').addEventListener('click', () => showModal('settings', true));
document.getElementById('btn-settings-close').addEventListener('click', () => showModal('settings', false));
document.getElementById('btn-search-close').addEventListener('click', () => showModal('search', false));

// ──────────────────────────────────────────
//  Bible API
// ──────────────────────────────────────────
// 한국어 성경 API (scripture.api.bible) — 무료 API key 필요
// https://scripture.api.bible 에서 가입 후 key 발급
// 성경 본문: 매일성경 사이트 링크로 대체 (index.html의 a 태그 처리)

// ──────────────────────────────────────────
//  AI 묵상 질문 (Cloudflare Worker)
// ──────────────────────────────────────────
document.getElementById('btn-get-ai').addEventListener('click', async () => {
  const verse = document.getElementById('verse-text').value || document.getElementById('verse-ref').value;
  if(!verse.trim()) { alert('먼저 말씀을 입력해주세요.'); return; }
  const btn = document.getElementById('btn-get-ai');
  btn.textContent = '생성 중...'; btn.disabled = true;
  try {
    const res = await fetch(WORKER_URL + '/qt-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verse })
    });
    const data = await res.json();
    const questions = data.questions || [];
    const container = document.getElementById('ai-questions');
    container.innerHTML = '';
    questions.forEach(q => {
      const el = document.createElement('div');
      el.className = 'ai-question-item'; el.textContent = q;
      container.appendChild(el);
    });
  } catch(e) {
    document.getElementById('ai-questions').innerHTML = '<p class="ai-hint">AI 연결에 실패했어요. Worker URL을 확인해주세요.</p>';
  }
  btn.textContent = '질문 생성하기'; btn.disabled = false;
});

// ──────────────────────────────────────────
//  Drawing Canvas
// ──────────────────────────────────────────
window.addEventListener('load', () => {
  drawingCanvas = document.getElementById('drawing-canvas');
  drawingCtx = drawingCanvas.getContext('2d');

  function resizeCanvas() {
    const w = drawingCanvas.parentElement.clientWidth - 32;
    const saved = drawingCanvas.toDataURL();
    drawingCanvas.width = w;
    drawingCanvas.height = w * 0.65;
    drawingCtx.fillStyle = '#1a1a1a';
    drawingCtx.fillRect(0,0,drawingCanvas.width,drawingCanvas.height);
    if(saved !== 'data:,') { const img = new Image(); img.onload = () => drawingCtx.drawImage(img,0,0); img.src = saved; }
  }
  resizeCanvas();

  const getPos = e => {
    const rect = drawingCanvas.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    return { x: (touch.clientX - rect.left) * (drawingCanvas.width/rect.width),
              y: (touch.clientY - rect.top) * (drawingCanvas.height/rect.height) };
  };

  const startDraw = e => { e.preventDefault(); isDrawing = true; const p = getPos(e); drawingCtx.beginPath(); drawingCtx.moveTo(p.x, p.y); };
  const draw = e => {
    if(!isDrawing) return; e.preventDefault();
    const p = getPos(e);
    drawingCtx.lineWidth = document.getElementById('brush-size').value;
    drawingCtx.lineCap = 'round';
    drawingCtx.strokeStyle = currentTool === 'eraser' ? '#1a1a1a' : currentColor;
    drawingCtx.lineTo(p.x, p.y); drawingCtx.stroke();
    drawingCtx.beginPath(); drawingCtx.moveTo(p.x, p.y);
  };
  const stopDraw = () => { isDrawing = false; };

  drawingCanvas.addEventListener('mousedown', startDraw);
  drawingCanvas.addEventListener('mousemove', draw);
  drawingCanvas.addEventListener('mouseup', stopDraw);
  drawingCanvas.addEventListener('touchstart', startDraw, { passive: false });
  drawingCanvas.addEventListener('touchmove', draw, { passive: false });
  drawingCanvas.addEventListener('touchend', stopDraw);

  document.querySelectorAll('.swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(sw => sw.classList.remove('active'));
      s.classList.add('active'); currentColor = s.dataset.color; currentTool = 'pen';
      document.getElementById('tool-pen').classList.add('active');
      document.getElementById('tool-eraser').classList.remove('active');
    });
  });
  document.getElementById('tool-pen').addEventListener('click', () => {
    currentTool = 'pen';
    document.getElementById('tool-pen').classList.add('active');
    document.getElementById('tool-eraser').classList.remove('active');
  });
  document.getElementById('tool-eraser').addEventListener('click', () => {
    currentTool = 'eraser';
    document.getElementById('tool-eraser').classList.add('active');
    document.getElementById('tool-pen').classList.remove('active');
  });
  document.getElementById('btn-clear-canvas').addEventListener('click', () => {
    drawingCtx.fillStyle = '#1a1a1a';
    drawingCtx.fillRect(0,0,drawingCanvas.width,drawingCanvas.height);
  });
  document.getElementById('btn-save-png').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `qt-drawing-${editingDate || 'today'}.png`;
    a.href = drawingCanvas.toDataURL('image/png'); a.click();
  });
});

// ──────────────────────────────────────────
//  Backup / Restore
// ──────────────────────────────────────────
document.getElementById('btn-backup').addEventListener('click', () => {
  const json = JSON.stringify({ entries: allEntries, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `qt-backup-${todayStr()}.json`; a.href = URL.createObjectURL(blob); a.click();
});

document.getElementById('btn-restore').addEventListener('click', () => {
  document.getElementById('restore-file').click();
});
document.getElementById('restore-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  try {
    const json = JSON.parse(text);
    const entries = json.entries || json;
    for(const [ds, data] of Object.entries(entries)) {
      await saveEntry(ds, data);
    }
    alert(`✓ ${Object.keys(entries).length}개 항목이 복구되었습니다.`);
    renderCalendar(); renderStats(); renderTagChips();
  } catch(err) {
    alert('복구 파일 형식이 올바르지 않아요.');
  }
  e.target.value = '';
});

// ──────────────────────────────────────────
//  Search
// ──────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const container = document.getElementById('search-results');
  container.innerHTML = '';
  if(!q) return;
  const results = Object.entries(allEntries).filter(([ds, entry]) => {
    const texts = [entry.verseRef, entry.verseText, entry.creative,
      entry.indObserve, entry.indInterpret, entry.indApply,
      entry.sermonNotes, entry.sermonReflection, ...(entry.tags||[])].join(' ').toLowerCase();
    return texts.includes(q);
  }).sort((a,b) => b[0].localeCompare(a[0]));

  results.forEach(([ds, entry]) => {
    const preview = [entry.creative, entry.indObserve, entry.sermonNotes].find(t=>t) || '';
    const el = document.createElement('div'); el.className = 'search-item';
    el.innerHTML = `<div class="search-item-date">${fmtDate(ds)} ${entry.verseRef ? '· '+entry.verseRef : ''}</div>
      <div class="search-item-preview">${preview.slice(0,60)}${preview.length>60?'...':''}</div>`;
    el.addEventListener('click', () => { showModal('search', false); openViewPage(ds); });
    container.appendChild(el);
  });
  if(!results.length) container.innerHTML = '<p style="color:var(--text3);font-size:14px;text-align:center;padding:20px">검색 결과가 없어요</p>';
});

// ──────────────────────────────────────────
//  PWA Service Worker 등록
// ──────────────────────────────────────────
if('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
