(function () {
  'use strict';

  const AITube = window.AITube;
  const key = (window.YT_API_KEY || '').trim();
  const hasKey = key && !key.startsWith('ここに');

  const state = {
    videos: [],
    fetchedAt: null,
    source: 'none', // 'live' | 'snapshot' | 'none'
    loading: false,
    error: '',
    tab: 'all',
    sort: 'views',
    hideShorts: true,
    onlySummarized: false,
    query: '',
  };

  // 表示設定はブラウザに記憶（失敗しても動作に影響なし）
  const PREF = 'ai-weekly-prefs';
  try {
    const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
    ['tab', 'sort', 'hideShorts', 'onlySummarized'].forEach((k) => k in saved && (state[k] = saved[k]));
  } catch (_) {}
  function savePrefs() {
    try {
      const { tab, sort, hideShorts, onlySummarized } = state;
      localStorage.setItem(PREF, JSON.stringify({ tab, sort, hideShorts, onlySummarized }));
    } catch (_) {}
  }

  const $ = (s) => document.querySelector(s);
  const summaries = () => window.SUMMARIES || {};
  const guides = () => window.GUIDES || {};
  const TABS = [{ id: 'all', label: 'すべて' }].concat(AITube.CATEGORIES);
  if (!TABS.some((t) => t.id === state.tab)) state.tab = 'all';
  const tabInfo = (id) => TABS.find((t) => t.id === id) || TABS[0];
  const tabDays = (id) => tabInfo(id).days || AITube.DEFAULT_DAYS;

  /** 動画のタブ。要約時に Claude が付けたもの（summary.cats）があればそちらを優先 */
  function catsOf(v) {
    const s = summaries()[v.id];
    return (s && Array.isArray(s.cats) ? s.cats : v.cats) || [];
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    });
    [].concat(children || []).forEach((c) => c != null && n.append(c));
    return n;
  }

  // ---- 表示用フォーマット ----
  function fmtCount(n) {
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '億';
    if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '万';
    return n.toLocaleString('ja-JP');
  }
  function fmtAgo(iso) {
    const diff = (Date.now() - Date.parse(iso)) / 1000;
    if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + '分前';
    if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
    return Math.floor(diff / 86400) + '日前';
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDur(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // ---- データ ----
  function visibleVideos(tab) {
    tab = tab || state.tab;
    const q = state.query.trim().toLowerCase();
    const sums = summaries();
    const maxAge = tabDays(tab) * 86400000;
    const list = state.videos.filter((v) => {
      // 日本語の動画のみ。要約時に「新機能・使い方の動画ではない」と判断したもの（topic: other）は出さない
      if (v.lang !== 'ja') return false;
      if (sums[v.id] && sums[v.id].topic === 'other') return false;
      if (tab !== 'all' && !catsOf(v).includes(tab)) return false;
      if (Date.now() - Date.parse(v.publishedAt) > maxAge) return false;
      if (state.hideShorts && v.durationSec <= AITube.SHORT_MAX_SEC) return false;
      if (state.onlySummarized && !sums[v.id]) return false;
      if (q && !(v.title + ' ' + v.channel).toLowerCase().includes(q)) return false;
      return true;
    });
    return list.sort((a, b) =>
      state.sort === 'date' ? Date.parse(b.publishedAt) - Date.parse(a.publishedAt) : b.views - a.views
    );
  }

  async function loadLive() {
    if (!hasKey || state.loading) return;
    state.loading = true;
    state.error = '';
    renderStatus();
    try {
      const r = await AITube.fetchVideos(key);
      state.videos = r.videos;
      state.fetchedAt = r.fetchedAt;
      state.source = 'live';
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  // ---- 描画 ----
  function renderKpis(list) {
    const sums = summaries();
    const total = list.reduce((s, v) => s + v.views, 0);
    const done = list.filter((v) => sums[v.id]).length;
    const items = [
      ['動画', list.length.toLocaleString('ja-JP') + '本'],
      ['合計再生数', fmtCount(total) + '回'],
      ['要約済み', `${done} / ${list.length}`],
    ];
    $('#kpis').replaceChildren(
      ...items.map(([k, v]) => el('div', { class: 'kpi' }, [el('dt', { text: k }), el('dd', { text: v })]))
    );
  }

  function renderStatus() {
    const box = $('#status');
    const parts = [];
    if (state.loading) parts.push(el('span', { class: 'spin', 'aria-hidden': 'true' }), '最新の動画を取得しています…');
    else if (state.fetchedAt) {
      const label = state.source === 'live' ? 'たった今 YouTube から取得' : '保存済みデータ';
      parts.push(`${label}（${fmtDateTime(state.fetchedAt)} 時点）`);
    }
    if (state.error) parts.push(el('span', { class: 'err', text: ' 取得エラー: ' + state.error }));
    // キーの案内は手元（file:// や localhost）で開いたときだけ。公開ページ（GitHub Pages）では出さない
    const isLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!hasKey && isLocal) {
      parts.push(
        el('span', { class: 'hint' }, [
          ' YouTube API キーが未設定のため最新取得はできません。config.example.js を ',
          el('code', { text: 'config.js' }),
          ' にコピーしてキーを書き込んでください。',
        ])
      );
    }
    box.replaceChildren(...parts);
    $('#refresh').hidden = !hasKey;
    $('#refresh').disabled = state.loading;
  }

  function card(v, rank) {
    const s = summaries()[v.id];
    const thumb = el('a', { class: 'thumb', href: v.url, target: '_blank', rel: 'noopener' }, [
      v.thumbnail ? el('img', { src: v.thumbnail, alt: '', loading: 'lazy' }) : null,
      el('span', { class: 'dur', text: fmtDur(v.durationSec) }),
      state.sort === 'views' ? el('span', { class: 'rank', text: '#' + rank }) : null,
    ]);

    let summaryBlock;
    if (s) {
      summaryBlock = el('div', { class: 'summary' }, [
        el('p', { text: s.summary }),
        s.points && s.points.length ? el('ul', {}, s.points.map((p) => el('li', { text: p }))) : null,
      ]);
    } else {
      const desc = v.description.trim();
      summaryBlock = el('div', { class: 'summary pending' }, [
        el('p', { class: 'pending-label', text: 'まだ要約されていません' }),
        desc
          ? el('details', {}, [
              el('summary', { text: '説明文を見る' }),
              el('p', { class: 'desc', text: desc.length > 600 ? desc.slice(0, 600) + '…' : desc }),
            ])
          : null,
      ]);
    }

    return el('article', { class: 'card' }, [
      thumb,
      el('div', { class: 'body' }, [
        el('div', { class: 'meta' }, [
          el('time', { datetime: v.publishedAt, title: new Date(v.publishedAt).toLocaleString('ja-JP'), text: fmtAgo(v.publishedAt) }),
          ...catsOf(v)
            .filter((c) => c !== 'new')
            .map((c) => el('span', { class: 'tag', text: tabInfo(c).label })),
          catsOf(v).includes('new') ? el('span', { class: 'tag tag-new', text: '新機能' }) : null,
        ]),
        el('h2', { class: 'title' }, el('a', { href: v.url, target: '_blank', rel: 'noopener', text: v.title })),
        el('div', { class: 'channel', text: v.channel }),
        el('div', { class: 'stats' }, [
          el('span', { class: 'views', title: v.views.toLocaleString('ja-JP') + ' 回' }, [
            el('strong', { text: fmtCount(v.views) }),
            ' 回再生',
          ]),
          v.likes != null ? el('span', { text: '高評価 ' + fmtCount(v.likes) }) : null,
          v.comments != null ? el('span', { text: 'コメント ' + fmtCount(v.comments) }) : null,
        ]),
        summaryBlock,
      ]),
    ]);
  }

  function renderTabs() {
    const nav = $('#tabs');
    nav.replaceChildren(
      ...TABS.map((t) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'tab',
            'data-tab': t.id,
            'aria-selected': String(t.id === state.tab),
          },
          [t.label, el('span', { class: 'count', text: String(visibleVideos(t.id).length) })]
        )
      )
    );
  }

  /** タブごとの「まとめ」（data/guides.js。Claude が要約時に書く） */
  function renderGuide() {
    const box = $('#guide');
    const g = guides()[state.tab];
    if (!g) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.hidden = false;
    box.replaceChildren(
      el('div', { class: 'guide-head' }, [
        el('h2', { text: g.title }),
        g.updatedAt ? el('span', { class: 'guide-date', text: g.updatedAt + ' 更新' }) : null,
      ]),
      g.intro ? el('p', { class: 'guide-intro', text: g.intro }) : null,
      el(
        'div',
        { class: 'guide-sections' },
        (g.sections || []).map((s) =>
          el('div', { class: 'guide-section' }, [
            el('h3', { text: s.heading }),
            el('ol', {}, (s.items || []).map((it) => el('li', { text: it }))),
          ])
        )
      ),
      g.note ? el('p', { class: 'guide-note', text: g.note }) : null
    );
  }

  function render() {
    const list = visibleVideos();
    renderTabs();
    renderGuide();
    renderKpis(list);
    renderStatus();
    document.querySelectorAll('.seg').forEach((g) => {
      g.querySelectorAll('button').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.value === state[g.dataset.key]))
      );
    });
    $('#hideShorts').checked = state.hideShorts;
    $('#onlySummarized').checked = state.onlySummarized;

    const box = $('#list');
    if (!list.length) {
      const msg = state.loading
        ? ''
        : state.videos.length
        ? '条件に合う動画がありません。絞り込みを変えてみてください。'
        : '表示できる動画がまだありません。API キーを設定して「最新を取得」を押してください。';
      box.replaceChildren(msg ? el('p', { class: 'empty', text: msg }) : '');
      return;
    }
    box.replaceChildren(...list.map((v, i) => card(v, i + 1)));
  }

  // ---- イベント ----
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    savePrefs();
    render();
  });
  document.querySelectorAll('.seg').forEach((g) =>
    g.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state[g.dataset.key] = b.dataset.value;
      savePrefs();
      render();
    })
  );
  $('#hideShorts').addEventListener('change', (e) => {
    state.hideShorts = e.target.checked;
    savePrefs();
    render();
  });
  $('#onlySummarized').addEventListener('change', (e) => {
    state.onlySummarized = e.target.checked;
    savePrefs();
    render();
  });
  $('#query').addEventListener('input', (e) => {
    state.query = e.target.value;
    render();
  });
  $('#refresh').addEventListener('click', loadLive);

  // ---- 起動: 保存済みデータを即表示 → 古ければ（6時間以上前）最新を取得 ----
  // 1回の取得で約800ユニット使うので、開くたびには取得しない
  const STALE_MS = 6 * 3600 * 1000;
  if (window.SNAPSHOT && Array.isArray(window.SNAPSHOT.videos)) {
    state.videos = window.SNAPSHOT.videos;
    state.fetchedAt = window.SNAPSHOT.fetchedAt;
    state.source = 'snapshot';
  }
  render();
  if (!state.fetchedAt || Date.now() - Date.parse(state.fetchedAt) > STALE_MS) loadLive();
})();
