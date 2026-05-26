// ============================================================
// State
// ============================================================
const state = {
  screen: 'works',          // 'works' | 'chapters' | 'browse' | 'learn'
  works: [],                // from works.json
  currentWork: null,        // selected work meta
  currentWorkMeta: null,    // full meta (with chapters)
  currentChapter: null,     // selected chapter data
  filteredSentences: null,  // filtered subset for practice (or null = all)
  searchQuery: '',
  // learning state
  sentenceIdx: 0,
  chunkIdx: 0,
  isAuto: false,
  autoTimer: null
};

const speedMap = { 1: 1.0, 2: 1.5, 3: 2.0, 4: 3.0, 5: 4.5 };

// ============================================================
// Screen routing
// ============================================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  state.screen = name;
  stopAuto();
}

// ============================================================
// Screen 1: Works list
// ============================================================
async function loadWorks() {
  try {
    const res = await fetch('data/works.json');
    if (!res.ok) throw new Error('Failed to load works.json');
    const data = await res.json();
    state.works = data.works;
    renderWorks();
  } catch (e) {
    document.getElementById('works-list').innerHTML =
      `<div class="error-msg">作品一覧を読み込めませんでした。<br>ローカルファイルで開いていませんか？ Webサーバー経由で開く必要があります。<br><br>${e.message}</div>`;
  }
}

function renderWorks() {
  const list = document.getElementById('works-list');
  if (state.works.length === 0) {
    list.innerHTML = '<div class="empty-msg">まだ作品が登録されていません</div>';
    return;
  }
  list.innerHTML = state.works.map(w => `
    <div class="list-item" data-work-id="${w.id}">
      <div class="list-item-title">${escapeHtml(w.title)}</div>
      <div class="list-item-subtitle">${escapeHtml(w.author)}</div>
      ${w.description ? `<div class="list-item-meta">${escapeHtml(w.description)}</div>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => selectWork(el.dataset.workId));
  });
}

// ============================================================
// Screen 2: Chapters list
// ============================================================
async function selectWork(workId) {
  const work = state.works.find(w => w.id === workId);
  if (!work) return;
  state.currentWork = work;

  try {
    const res = await fetch(`data/${workId}/meta.json`);
    if (!res.ok) throw new Error('Failed to load meta.json');
    const meta = await res.json();
    state.currentWorkMeta = meta;
    renderChapters();
    showScreen('chapters');
  } catch (e) {
    alert('作品の情報を読み込めませんでした: ' + e.message);
  }
}

function renderChapters() {
  document.getElementById('chapters-title').textContent = state.currentWork.title;
  const list = document.getElementById('chapters-list');
  const chapters = state.currentWorkMeta.chapters || [];
  if (chapters.length === 0) {
    list.innerHTML = '<div class="empty-msg">章がまだ登録されていません</div>';
    return;
  }
  list.innerHTML = chapters.map(c => `
    <div class="list-item" data-chapter-file="${c.file}">
      <div class="list-item-title">Chapter ${c.number}: ${escapeHtml(c.title)}</div>
      ${c.subtitle ? `<div class="list-item-subtitle">${escapeHtml(c.subtitle)}</div>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => selectChapter(el.dataset.chapterFile));
  });
}

// ============================================================
// Screen 3: Sentence browse + search
// ============================================================
async function selectChapter(file) {
  try {
    const res = await fetch(`data/${state.currentWork.id}/${file}`);
    if (!res.ok) throw new Error('Failed to load chapter');
    const chapter = await res.json();
    state.currentChapter = chapter;
    state.filteredSentences = null;
    state.searchQuery = '';
    document.getElementById('search-input').value = '';
    renderBrowse();
    showScreen('browse');
  } catch (e) {
    alert('章を読み込めませんでした: ' + e.message);
  }
}

function renderBrowse() {
  document.getElementById('browse-title').textContent = state.currentChapter.title;

  const allSentences = state.currentChapter.sentences;
  const query = state.searchQuery.trim().toLowerCase();

  let matching;
  if (query === '') {
    matching = allSentences.map(s => ({ s, indices: [] }));
  } else {
    matching = allSentences.map(s => {
      // Combine all chunk en text + full_jp text for searching
      const enText = s.chunks.map(c => c.en).join(' ').toLowerCase();
      const jpText = (s.full_jp || '').toLowerCase() + ' ' + s.chunks.map(c => c.jp).join(' ').toLowerCase();
      const matched = enText.includes(query) || jpText.includes(query);
      return matched ? { s, query } : null;
    }).filter(Boolean);
  }

  // Update info bar
  const info = document.getElementById('search-info');
  if (query === '') {
    info.textContent = `全 ${allSentences.length} 文`;
  } else {
    info.textContent = `「${state.searchQuery}」を含む文: ${matching.length} / ${allSentences.length}`;
  }

  // Practice button
  const practiceBtn = document.getElementById('practice-filtered-btn');
  if (query === '' || matching.length === 0) {
    practiceBtn.style.display = 'none';
  } else {
    practiceBtn.style.display = 'block';
    practiceBtn.textContent = `この ${matching.length} 文だけ練習する →`;
  }

  // Render list
  const list = document.getElementById('sentence-list');
  if (matching.length === 0) {
    list.innerHTML = '<div class="empty-msg">該当する文が見つかりませんでした</div>';
    return;
  }

  list.innerHTML = matching.map(({ s }) => {
    const enFull = s.chunks.map(c => c.en).join(' ');
    const highlighted = query ? highlightText(enFull, query) : escapeHtml(enFull);
    return `
      <div class="sentence-item" data-sentence-id="${s.id}">
        <div class="sentence-item-num">#${s.id}</div>
        <div class="sentence-item-en">${highlighted}</div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.sentence-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.sentenceId);
      startLearning(allSentences, id);
    });
  });
}

function highlightText(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const re = new RegExp('(' + escapeRegex(query) + ')', 'gi');
  return escaped.replace(re, '<mark>$1</mark>');
}

// ============================================================
// Search handling
// ============================================================
function onSearchInput(e) {
  state.searchQuery = e.target.value;
  renderBrowse();
}

function onPracticeFiltered() {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return;
  const matching = state.currentChapter.sentences.filter(s => {
    const enText = s.chunks.map(c => c.en).join(' ').toLowerCase();
    const jpText = (s.full_jp || '').toLowerCase() + ' ' + s.chunks.map(c => c.jp).join(' ').toLowerCase();
    return enText.includes(query) || jpText.includes(query);
  });
  if (matching.length === 0) return;
  startLearningWithSet(matching, 0);
}

// ============================================================
// Screen 4: Learning (chunk reading)
// ============================================================
function startLearning(sentences, startId) {
  state.filteredSentences = sentences;
  const idx = sentences.findIndex(s => s.id === startId);
  state.sentenceIdx = idx >= 0 ? idx : 0;
  state.chunkIdx = 0;
  initLearningScreen();
  showScreen('learn');
}

function startLearningWithSet(sentences, startIdx) {
  state.filteredSentences = sentences;
  state.sentenceIdx = startIdx;
  state.chunkIdx = 0;
  initLearningScreen();
  showScreen('learn');
}

function initLearningScreen() {
  document.getElementById('learn-title').textContent = state.currentChapter.title;
  document.getElementById('chunk-row').innerHTML = '';
  document.getElementById('jp-row').textContent = '';
  document.getElementById('full-jp-row').classList.remove('visible');
  renderChunk();
}

function getSentences() {
  return state.filteredSentences || state.currentChapter.sentences;
}

function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) {
    if (onEnd) setTimeout(onEnd, 800);
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = 0.92;
  if (onEnd) utter.onend = onEnd;
  window.speechSynthesis.speak(utter);
}

function renderChunk() {
  const sentences = getSentences();
  const sentence = sentences[state.sentenceIdx];
  const chunkRow = document.getElementById('chunk-row');
  const jpRow = document.getElementById('jp-row');
  const fullJpRow = document.getElementById('full-jp-row');
  const progress = document.getElementById('progress');

  Array.from(chunkRow.children).forEach((el, i) => {
    if (i < state.chunkIdx) {
      const dist = state.chunkIdx - i;
      el.style.opacity = Math.max(0, 0.5 - dist * 0.2);
      el.style.filter = `blur(${Math.min(3, dist * 1.2)}px)`;
    }
  });

  let onSpeakEnd = null;
  if (state.chunkIdx < sentence.chunks.length) {
    const chunk = sentence.chunks[state.chunkIdx];
    const span = document.createElement('span');
    span.style.opacity = '1';
    span.textContent = chunk.en;
    chunkRow.appendChild(span);

    if (state.isAuto) {
      onSpeakEnd = () => {
        if (state.isAuto) {
          clearTimeout(state.autoTimer);
          state.autoTimer = setTimeout(advanceChunk, speedMap[document.getElementById('speed').value] * 500);
        }
      };
    }
    speak(chunk.en, onSpeakEnd);
  }

  jpRow.textContent = '';
  fullJpRow.classList.remove('visible');
  fullJpRow.textContent = '';

  progress.textContent = `Sentence ${state.sentenceIdx + 1} / ${sentences.length}  ·  Chunk ${Math.min(state.chunkIdx + 1, sentence.chunks.length)} / ${sentence.chunks.length}`;
}

function showJp() {
  const sentences = getSentences();
  const sentence = sentences[state.sentenceIdx];
  if (state.chunkIdx < sentence.chunks.length) {
    document.getElementById('jp-row').textContent = sentence.chunks[state.chunkIdx].jp;
  }
}

function showFullJp() {
  const sentences = getSentences();
  const sentence = sentences[state.sentenceIdx];
  const el = document.getElementById('full-jp-row');
  el.textContent = sentence.full_jp;
  el.classList.add('visible');
}

function advanceChunk() {
  const sentences = getSentences();
  const sentence = sentences[state.sentenceIdx];
  const fullJpRow = document.getElementById('full-jp-row');

  if (state.chunkIdx < sentence.chunks.length - 1) {
    state.chunkIdx++;
    renderChunk();
  } else if (state.chunkIdx === sentence.chunks.length - 1 && !fullJpRow.classList.contains('visible')) {
    state.chunkIdx++;
    Array.from(document.getElementById('chunk-row').children).forEach((el, i) => {
      const dist = state.chunkIdx - i;
      el.style.opacity = Math.max(0, 0.5 - dist * 0.2);
      el.style.filter = `blur(${Math.min(3, dist * 1.2)}px)`;
    });
    showFullJp();
    if (state.isAuto) {
      clearTimeout(state.autoTimer);
      state.autoTimer = setTimeout(advanceSentence, speedMap[document.getElementById('speed').value] * 1500);
    }
  } else {
    advanceSentence();
  }
}

function advanceSentence() {
  const sentences = getSentences();
  if (state.sentenceIdx < sentences.length - 1) {
    state.sentenceIdx++;
    state.chunkIdx = 0;
    document.getElementById('chunk-row').innerHTML = '';
    renderChunk();
  } else {
    document.getElementById('jp-row').textContent = '— End —';
    stopAuto();
  }
}

function prevSentence() {
  if (state.sentenceIdx > 0) {
    state.sentenceIdx--;
    state.chunkIdx = 0;
    document.getElementById('chunk-row').innerHTML = '';
    renderChunk();
  }
}

function toggleMode() {
  state.isAuto = !state.isAuto;
  document.getElementById('mode-toggle').textContent = state.isAuto ? 'Auto' : 'Manual';
  document.getElementById('auto-controls').classList.toggle('visible', state.isAuto);
  if (state.isAuto) {
    state.autoTimer = setTimeout(advanceChunk, 200);
  } else {
    stopAuto();
  }
}

function stopAuto() {
  clearTimeout(state.autoTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Init
// ============================================================
function init() {
  // Back buttons
  document.getElementById('back-to-works').addEventListener('click', () => showScreen('works'));
  document.getElementById('back-to-chapters').addEventListener('click', () => showScreen('chapters'));
  document.getElementById('back-to-browse').addEventListener('click', () => {
    stopAuto();
    showScreen('browse');
  });

  // Search
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('practice-filtered-btn').addEventListener('click', onPracticeFiltered);

  // Browse-level: "practice from start" button
  document.getElementById('practice-all-btn').addEventListener('click', () => {
    if (!state.currentChapter) return;
    startLearningWithSet(state.currentChapter.sentences, 0);
  });

  // Learning controls
  document.getElementById('show-jp').addEventListener('click', showJp);
  document.getElementById('next-chunk').addEventListener('click', advanceChunk);
  document.getElementById('next-sentence').addEventListener('click', advanceSentence);
  document.getElementById('prev-sentence').addEventListener('click', prevSentence);
  document.getElementById('mode-toggle').addEventListener('click', toggleMode);
  document.getElementById('speed').addEventListener('input', (e) => {
    document.getElementById('speed-label').textContent = speedMap[e.target.value].toFixed(1) + 's';
  });

  // iOS Safari: wake speech synthesis on first interaction
  let firstInteraction = true;
  document.addEventListener('touchstart', () => {
    if (firstInteraction && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(u);
      firstInteraction = false;
    }
  }, { once: true });

  loadWorks();
}

document.addEventListener('DOMContentLoaded', init);
