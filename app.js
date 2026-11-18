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
    term: null, // 用語集から「この言葉が出てくる動画」を選んだとき { term, match[] }
    gCat: 'all', // 用語集のカテゴリ
    gQuery: '',
    sort: 'views',
    onlyPicks: false,
    owner: false, // 持ち主モード（ローカルサーバーで開いたとき）
    picksDirty: false,
    ownerMsg: '',
    hideShorts: true,
    onlySummarized: false,
    query: '',
  };

  // 表示設定はブラウザに記憶（失敗しても動作に影響なし）
  const PREF = 'ai-weekly-prefs';
  try {
    const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
    ['tab', 'sort', 'hideShorts', 'onlySummarized', 'onlyPicks'].forEach((k) => k in saved && (state[k] = saved[k]));
  } catch (_) {}
  function savePrefs() {
    try {
      const { tab, sort, hideShorts, onlySummarized, onlyPicks } = state;
      localStorage.setItem(PREF, JSON.stringify({ tab, sort, hideShorts, onlySummarized, onlyPicks }));
    } catch (_) {}
  }

  const $ = (s) => document.querySelector(s);
  const summaries = () => window.SUMMARIES || {};
  const guides = () => window.GUIDES || {};
  const toma = () => window.TOMA || { comments: {} };

  // とーまくんおすすめ（data/picks.js）。持ち主モード（npm start のローカルサーバー）のときだけ変更できる
  const picks = new Set((window.PICKS && window.PICKS.ids) || []);
  const isPicked = (id) => picks.has(id);

  async function ownerApi(pathname, body) {
    const res = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Toma-Owner': '1' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    return data;
  }

  async function togglePick(id, btn) {
    const on = !isPicked(id);
    btn.disabled = true;
    try {
      const r = await ownerApi('/api/picks', { id, on });
      picks.clear();
      r.ids.forEach((x) => picks.add(x));
      state.picksDirty = true;
    } catch (e) {
      alertOwner('おすすめを保存できませんでした: ' + e.message);
    }
    render();
  }

  async function publish() {
    const btn = $('#publish');
    btn.disabled = true;
    btn.textContent = '反映中…';
    try {
      await ownerApi('/api/publish');
      state.picksDirty = false;
      state.ownerMsg = '公開ページに反映しました。1〜2分で更新されます。';
    } catch (e) {
      state.ownerMsg = '反映できませんでした: ' + e.message;
    }
    render();
  }

  function alertOwner(msg) {
    state.ownerMsg = msg;
  }
  const glossary = () => window.GLOSSARY || { cats: [], terms: [] };
  const TABS = [{ id: 'all', label: 'すべて' }]
    .concat(AITube.CATEGORIES)
    .concat(glossary().terms.length ? [{ id: 'glossary', label: '📖 用語集' }] : []);
  const isGlossary = () => state.tab === 'glossary';
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
  /** 動画のタイトル・要約に、用語集の言葉が出てくるか */
  function videoText(v) {
    const s = summaries()[v.id];
    return [v.title, s ? s.summary : '', s && s.points ? s.points.join(' ') : ''].join(' ').toLowerCase();
  }
  function mentions(v, match) {
    const t = videoText(v);
    return match.some((m) => t.includes(m.toLowerCase()));
  }

  function visibleVideos(tab, opts) {
    tab = tab || state.tab;
    if (tab === 'glossary') return [];
    const ignoreTerm = opts && opts.ignoreTerm;
    const q = state.query.trim().toLowerCase();
    const sums = summaries();
    const maxAge = tabDays(tab) * 86400000;
    const list = state.videos.filter((v) => {
      // 日本語の動画のみ。要約時に「新機能・使い方の動画ではない」と判断したもの（topic: other）は出さない
      if (v.lang !== 'ja') return false;
      if (sums[v.id] && sums[v.id].topic === 'other') return false;
      if (tab !== 'all' && !catsOf(v).includes(tab)) return false;
      if (state.onlyPicks && !isPicked(v.id)) return false;
      if (Date.now() - Date.parse(v.publishedAt) > maxAge) return false;
      if (state.hideShorts && v.durationSec <= AITube.SHORT_MAX_SEC) return false;
      if (state.onlySummarized && !sums[v.id]) return false;
      if (q && !(v.title + ' ' + v.channel).toLowerCase().includes(q)) return false;
      if (state.term && !ignoreTerm && !mentions(v, state.term.match)) return false;
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

  function pickButton(id) {
    const on = isPicked(id);
    const btn = el('button', {
      type: 'button',
      class: 'pick-btn',
      'aria-pressed': String(on),
      text: on ? '★ とーまくんおすすめ中' : '☆ とーまくんおすすめにする',
    });
    btn.addEventListener('click', () => togglePick(id, btn));
    return btn;
  }

  function card(v, rank) {
    const s = summaries()[v.id];
    const isPick = isPicked(v.id);
    const thumb = el('a', { class: 'thumb', href: v.url, target: '_blank', rel: 'noopener' }, [
      v.thumbnail ? el('img', { src: v.thumbnail, alt: '', loading: 'lazy' }) : null,
      el('span', { class: 'dur', text: fmtDur(v.durationSec) }),
      state.sort === 'views' ? el('span', { class: 'rank', text: '#' + rank }) : null,
      isPick
        ? el('span', { class: 'pick' }, [
            el('img', { src: 'images/toma-icon.png', alt: '', width: '28', height: '28' }),
            'とーまくんおすすめ',
          ])
        : null,
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

    return el('article', { class: 'card' + (isPick ? ' is-pick' : '') }, [
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
        // 持ち主モードのときだけ「おすすめ」ボタンを出す（公開ページには出ない）
        state.owner ? pickButton(v.id) : null,
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
          [
            t.label,
            el('span', {
              class: 'count',
              text: String(t.id === 'glossary' ? glossary().terms.length : visibleVideos(t.id).length),
            }),
          ]
        )
      )
    );
  }

  /** とーまくんのひとこと（data/toma.js）。無いタブは件数から作る */
  function renderToma(list) {
    const box = $('#toma-say');
    const t = tabInfo(state.tab);
    let text = (toma().comments || {})[state.tab];
    if (!text) {
      text = list.length
        ? `${t.id === 'all' ? '' : t.label + ' の'}動画は ${list.length} 本あったよ。いちばん見られてるのは「${list[0].title}」だね〜。`
        : 'うーん、ここはまだ動画がないみたい。';
    }
    const tabPicks = list.filter((v) => isPicked(v.id));
    const pick = tabPicks[0];
    box.replaceChildren(
      el('img', { class: 'toma-say-img', src: 'images/toma-stand.png', alt: 'とーまくん', width: '275', height: '360' }),
      el('div', { class: 'bubble' }, [
        el('p', { class: 'bubble-name', text: 'とーまくん' }),
        el('p', { text }),
        pick
          ? el('p', { class: 'bubble-pick' }, [
              `★ ぼくのおすすめは ${tabPicks.length} 本。たとえば `,
              el('a', { href: pick.url, target: '_blank', rel: 'noopener', text: '「' + pick.title + '」' }),
              state.onlyPicks ? ' だよ。' : ' だよ。「★ とーまくんおすすめだけ」で絞りこめるよ。',
            ])
          : null,
      ])
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
        el('img', { class: 'guide-icon', src: 'images/toma-laugh.png', alt: '', width: '207', height: '194' }),
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

  /** 用語集タブ（data/glossary.js） */
  function renderGlossary() {
    const box = $('#glossary');
    const g = glossary();
    const base = visibleVideos('all', { ignoreTerm: true });

    const search = el('input', {
      type: 'search',
      class: 'search glossary-search',
      placeholder: '言葉をさがす（例：MCP、プロンプト）',
      'aria-label': '用語をさがす',
      value: state.gQuery,
    });
    search.addEventListener('input', (e) => {
      state.gQuery = e.target.value;
      renderGlossaryList();
    });

    const chips = el(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'カテゴリ' },
      ['all'].concat(g.cats).map((c) => {
        const b = el('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(state.gCat === c),
          text: c === 'all' ? 'ぜんぶ' : c,
        });
        b.addEventListener('click', () => {
          state.gCat = c;
          renderGlossary();
        });
        return b;
      })
    );

    const listBox = el('div', { class: 'terms' });
    function renderGlossaryList() {
      const q2 = state.gQuery.trim().toLowerCase();
      const shown = g.terms.filter((t) => {
        if (state.gCat !== 'all' && t.cat !== state.gCat) return false;
        if (q2 && ![t.term, t.kana, t.body, t.toma].join(' ').toLowerCase().includes(q2)) return false;
        return true;
      });
      if (!shown.length) {
        listBox.replaceChildren(
          el('div', { class: 'empty' }, [
            el('img', { src: 'images/toma-question.png', alt: '', width: '182', height: '196' }),
            el('p', { text: 'その言葉は、まだ用語集にないみたい。' }),
          ])
        );
        return;
      }
      listBox.replaceChildren(
        ...shown.map((t) => {
          const hits = base.filter((v) => mentions(v, t.match || [t.term]));
          const jump = hits.length
            ? el('button', { type: 'button', class: 'term-jump', text: `この言葉が出てくる動画 ${hits.length}本 →` })
            : el('span', { class: 'term-nohit', text: '今週の動画にはまだ出てきてないよ' });
          if (hits.length) {
            jump.addEventListener('click', () => {
              state.term = { term: t.term, match: t.match || [t.term] };
              state.tab = 'all';
              savePrefs();
              render();
              $('#list').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          }
          return el('article', { class: 'term' }, [
            el('div', { class: 'term-head' }, [
              el('h3', { class: 'term-name', text: t.term }),
              t.kana ? el('span', { class: 'term-kana', text: t.kana }) : null,
              el('span', { class: 'tag', text: t.cat }),
            ]),
            t.toma
              ? el('p', { class: 'term-toma' }, [
                  el('img', { src: 'images/toma-icon.png', alt: 'とーまくん', width: '28', height: '28' }),
                  el('span', { text: t.toma }),
                ])
              : null,
            el('p', { class: 'term-body', text: t.body }),
            jump,
          ]);
        })
      );
    }
    renderGlossaryList();

    box.replaceChildren(
      el('div', { class: 'glossary-head' }, [
        el('h2', { text: 'とーまくんの AI 用語集' }),
        g.updatedAt ? el('span', { class: 'guide-date', text: g.updatedAt + ' 更新' }) : null,
      ]),
      el('div', { class: 'glossary-tools' }, [search, chips]),
      listBox
    );
  }

  /** 用語集から来たときの「〇〇が出てくる動画」表示と解除ボタン */
  function renderTermChip() {
    const old = $('#term-chip');
    if (old) old.remove();
    if (!state.term || isGlossary()) return;
    const chip = el('div', { id: 'term-chip', class: 'term-chip' }, [
      el('span', { text: `📖「${state.term.term}」が出てくる動画だけ表示中` }),
    ]);
    const x = el('button', { type: 'button', class: 'term-chip-x', text: '× 解除' });
    x.addEventListener('click', () => {
      state.term = null;
      render();
    });
    const back = el('button', { type: 'button', class: 'term-chip-x', text: '← 用語集にもどる' });
    back.addEventListener('click', () => {
      state.term = null;
      state.tab = 'glossary';
      savePrefs();
      render();
    });
    chip.append(x, back);
    $('#status').after(chip);
  }

  function render() {
    const glossaryMode = isGlossary();
    const list = visibleVideos();
    renderTabs();
    renderToma(list);
    renderGuide();
    renderKpis(glossaryMode ? visibleVideos('all', { ignoreTerm: true }) : list);
    renderStatus();
    renderTermChip();
    // 用語集タブでは、動画用の操作・一覧を隠して用語集を出す
    $('.toolbar-inner').hidden = glossaryMode;
    $('#status').hidden = glossaryMode;
    $('#list').hidden = glossaryMode;
    $('#glossary').hidden = !glossaryMode;
    if (glossaryMode) {
      renderGlossary();
      return;
    }
    document.querySelectorAll('.seg').forEach((g) => {
      g.querySelectorAll('button').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.value === state[g.dataset.key]))
      );
    });
    $('#hideShorts').checked = state.hideShorts;
    $('#onlySummarized').checked = state.onlySummarized;
    $('#onlyPicks').setAttribute('aria-pressed', String(state.onlyPicks));

    const bar = $('#owner-bar');
    bar.hidden = !state.owner;
    if (state.owner) {
      $('#owner-msg').textContent =
        state.ownerMsg ||
        (state.picksDirty
          ? 'おすすめを変更しました。スマホの公開ページにも出すには「公開ページに反映」を押してください。'
          : '★ボタンで、とーまくんおすすめを選べます（このパソコンだけ）。');
      const pub = $('#publish');
      pub.disabled = false;
      pub.textContent = '公開ページに反映';
    }

    const box = $('#list');
    if (!list.length) {
      const msg = state.loading
        ? ''
        : state.videos.length
        ? 'あれ？ 条件に合う動画が見つからないよ。絞り込みを変えてみてね。'
        : 'まだ動画がないみたい。ぼくが集めてくるまで、ちょっと待っててね。';
      box.replaceChildren(
        msg
          ? el('div', { class: 'empty' }, [
              el('img', { src: 'images/toma-question.png', alt: '', width: '182', height: '196' }),
              el('p', { text: msg }),
            ])
          : ''
      );
      return;
    }
    box.replaceChildren(...list.map((v, i) => card(v, i + 1)));
  }

  // ---- イベント ----
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    state.term = null;
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
  $('#onlyPicks').addEventListener('click', () => {
    state.onlyPicks = !state.onlyPicks;
    savePrefs();
    render();
  });
  $('#publish').addEventListener('click', publish);

  // 持ち主モードの判定：npm start のローカルサーバーにだけある /api/owner が応答するか
  // （GitHub Pages などの公開ページにはこの API がないので、ボタンは出ない）
  async function detectOwner() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    try {
      const r = await fetch('/api/owner', { cache: 'no-store' });
      if (r.ok && (await r.json()).owner === true) {
        state.owner = true;
        render();
      }
    } catch (_) {}
  }

  // ---- 起動: 保存済みデータを即表示 → 古ければ（6時間以上前）最新を取得 ----
  // 1回の取得で約800ユニット使うので、開くたびには取得しない
  const STALE_MS = 6 * 3600 * 1000;
  if (window.SNAPSHOT && Array.isArray(window.SNAPSHOT.videos)) {
    state.videos = window.SNAPSHOT.videos;
    state.fetchedAt = window.SNAPSHOT.fetchedAt;
    state.source = 'snapshot';
  }
  render();
  detectOwner();
  if (!state.fetchedAt || Date.now() - Date.parse(state.fetchedAt) > STALE_MS) loadLive();
})();
