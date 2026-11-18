/*
 * YouTube Data API v3 から「直近N日間のAI関連動画」を取得する共通ロジック。
 * ブラウザ（index.html）と Node（tools/fetch.js）の両方から使う。
 * 読み込むと globalThis.AITube が定義される。
 */
(function (root) {
  'use strict';

  const API = 'https://www.googleapis.com/youtube/v3';

  /*
   * 画面のタブ（AI別・テーマ別）。
   *   q    … そのタブ用に YouTube を検索するキーワード（1つにつき1回100ユニット、無料枠は1日10,000）
   *   re   … タイトルにこれが含まれる動画をこのタブに入れる
   *   days … 対象期間（省略時は7日）。動画が少ないテーマだけ長めにする
   * 1本の動画が複数のタブに入ることもある。タブを増やすときはここに足すだけでよい。
   */
  const DEFAULT_DAYS = 7;
  const CATEGORIES = [
    { id: 'new', label: '最新機能', q: ['AI 新機能'], re: /新機能|アップデート|新モデル|リリース|登場|搭載|発表|ついに|速報/ },
    { id: 'claude', label: 'Claude', q: ['Claude 使い方'], re: /Claude|クロード|Anthropic|アンソロピック/i },
    { id: 'codex', label: 'Codex', q: ['Codex AI'], re: /Codex|コーデックス/i },
    { id: 'seedance', label: 'Seedance', q: ['Seedance', 'Seedance 使い方'], re: /Seedance|シーダンス|シードダンス/i, days: 30 },
    { id: 'chatgpt', label: 'ChatGPT', q: ['ChatGPT 使い方'], re: /ChatGPT|チャットGPT|OpenAI|\bGPT-?\d/i },
    { id: 'gemini', label: 'Gemini', q: ['Gemini 使い方'], re: /Gemini|ジェミニ|NotebookLM|\bVeo\b|Nano ?Banana/i },
  ];
  // タブに関係なく、AIの使い方全般を拾うための追加検索
  const EXTRA_QUERIES = ['生成AI 活用術'];

  const SEARCHES = CATEGORIES.flatMap((c) => c.q.map((q) => ({ q, days: c.days || DEFAULT_DAYS })))
    .concat(EXTRA_QUERIES.map((q) => ({ q, days: DEFAULT_DAYS })))
    .map((s) => Object.assign(s, { relevanceLanguage: 'ja', regionCode: 'JP' }));

  function categorize(v) {
    return CATEGORIES.filter((c) => c.re.test(v.title)).map((c) => c.id);
  }

  /** 動画の投稿日が、その動画が入るタブの対象期間内かどうか */
  function withinPeriod(v, now) {
    const ageDays = (now - Date.parse(v.publishedAt)) / 86400000;
    const maxDays = Math.max(DEFAULT_DAYS, ...CATEGORIES.filter((c) => v.cats.includes(c.id)).map((c) => c.days || 0));
    return ageDays <= maxDays;
  }

  // 「新機能・使い方」の動画とみなす語（タイトル・タグで判定）
  const FOCUS_RE = new RegExp(
    [
      '新機能', '機能', '使い方', '使いこなし', '活用', 'アップデート', '設定', '方法', 'やり方', '作り方',
      '始め方', 'できること', '自動化', '効率化', '時短', '入門', '講座', 'チュートリアル', 'プロンプト',
      'ツール', 'アプリ', '実演', 'デモ', '比較', 'レビュー', '検証', '使ってみた', '試してみた',
      'リリース', '登場', '搭載', '新モデル', '最新', '完全ガイド', '徹底', '制作', '作った', '作ってみた',
      '生成', 'ワークフロー', '手順', 'コツ', '実践', '仕事術', '解説',
    ].join('|')
  );
  // ニュース・投資・エンタメ寄りの話題は対象外（タイトルで判定）
  const EXCLUDE_RE = /怪談|株価|米国株|日本株|相場|銘柄|投資|決算|辞任|退任|選挙|恐ろしい|怖い|暴走|都市伝説|事件|逮捕|炎上|バブル|陰謀/;

  function isFeatureTopic(v) {
    if (EXCLUDE_RE.test(v.title)) return false;
    return FOCUS_RE.test(v.title + ' ' + (v.tags || []).join(' '));
  }

  // この秒数以下はショート動画として扱う（YouTube ショートは最長3分）
  const SHORT_MAX_SEC = 180;

  // タイトル・説明文・タグに含まれていれば「AI関連」とみなすキーワード
  const AI_RE = new RegExp(
    [
      '\\bA\\.?I\\b', '人工知能', '生成\\s*AI', 'ChatGPT', '\\bGPT', 'Claude', 'Gemini',
      '\\bLLMs?\\b', 'OpenAI', 'Anthropic', 'DeepSeek', 'Copilot', 'Midjourney', '\\bSora\\b',
      '\\bGrok\\b', '\\bLlama\\b', '\\bAGI\\b', '機械学習', 'ディープラーニング', '深層学習',
      'Seedance', 'シーダンス', 'Codex', 'コーデックス', 'クロード', 'NotebookLM', 'Higgsfield', '\\bVeo\\b',
      'machine learning', 'deep learning', 'neural net', 'ニューラル',
    ].join('|'),
    'i'
  );

  const KANA_RE = /[぀-ゟ゠-ヿ]/; // ひらがな・カタカナ

  function isAIRelated(v) {
    return AI_RE.test([v.title, v.description, (v.tags || []).join(' ')].join(' '));
  }

  /** 'ja' / 'en' / null（対象外の言語）を返す */
  function detectLang(v) {
    const audio = (v.audioLang || v.defaultLang || '').toLowerCase();
    // 漢字だけでは中国語と区別できないので、かなの有無で判定する
    if (audio.startsWith('ja') || KANA_RE.test(v.title + (v.description || '').slice(0, 500))) return 'ja';
    if (audio.startsWith('en')) return 'en';
    if (audio) return null; // 他言語の音声が明示されている
    const letters = v.title.match(/\p{L}/gu) || [];
    if (!letters.length) return null;
    const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
    return latin / letters.length >= 0.9 ? 'en' : null;
  }

  /** ISO 8601 の期間（PT1H2M3S / P1DT2H）を秒に変換 */
  function parseDuration(iso) {
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
    if (!m) return 0;
    const [, d, h, mi, s] = m.map((x) => Number(x || 0));
    return d * 86400 + h * 3600 + mi * 60 + s;
  }

  async function call(fetchImpl, endpoint, params) {
    const url = new URL(API + '/' + endpoint);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    const res = await fetchImpl(url.toString());
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      /* JSON でない応答 */
    }
    if (!res.ok) {
      const err = body && body.error;
      const reason = err && err.errors && err.errors[0] && err.errors[0].reason;
      let msg = (err && err.message) || 'HTTP ' + res.status;
      if (reason === 'quotaExceeded') msg = 'YouTube API の1日の利用上限に達しました。明日（太平洋時間0時）に回復します。';
      else if (reason === 'keyInvalid' || /API key not valid/i.test(msg)) msg = 'YouTube API キーが正しくありません。config.js を確認してください。';
      else if (reason === 'accessNotConfigured') msg = 'Google Cloud で「YouTube Data API v3」が有効になっていません。';
      const e = new Error(msg);
      e.status = res.status;
      e.reason = reason;
      throw e;
    }
    return body;
  }

  function normalize(item) {
    const sn = item.snippet || {};
    const st = item.statistics || {};
    const th = sn.thumbnails || {};
    return {
      id: item.id,
      url: 'https://www.youtube.com/watch?v=' + item.id,
      title: sn.title || '',
      channel: sn.channelTitle || '',
      channelId: sn.channelId || '',
      publishedAt: sn.publishedAt,
      description: sn.description || '',
      tags: sn.tags || [],
      audioLang: sn.defaultAudioLanguage || '',
      defaultLang: sn.defaultLanguage || '',
      thumbnail: (th.medium || th.high || th.default || {}).url || '',
      durationSec: parseDuration((item.contentDetails || {}).duration),
      views: Number(st.viewCount || 0),
      likes: st.likeCount !== undefined ? Number(st.likeCount) : null,
      comments: st.commentCount !== undefined ? Number(st.commentCount) : null,
      live: sn.liveBroadcastContent || 'none',
    };
  }

  /**
   * 直近 days 日間の、AIの新機能・使い方を扱う日本語動画を取得する。
   * 消費クォータの目安: 検索1回100 × キーワード8 × pages + 動画詳細 数ユニット（無料枠は1日10,000）
   */
  async function fetchVideos(apiKey, opts) {
    opts = opts || {};
    const pages = opts.pages || 1;
    const fetchImpl = opts.fetchImpl || root.fetch.bind(root);
    if (!apiKey) throw new Error('YouTube API キーが設定されていません。');

    const now = Date.now();
    const ids = new Set();

    for (const s of SEARCHES) {
      let pageToken;
      for (let p = 0; p < pages; p++) {
        const r = await call(fetchImpl, 'search', {
          part: 'snippet',
          type: 'video',
          order: 'viewCount',
          maxResults: 50,
          publishedAfter: new Date(now - s.days * 86400000).toISOString(),
          q: s.q,
          relevanceLanguage: s.relevanceLanguage,
          regionCode: s.regionCode,
          pageToken,
          key: apiKey,
        });
        (r.items || []).forEach((it) => it.id && it.id.videoId && ids.add(it.id.videoId));
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
    }

    const all = [...ids];
    const videos = [];
    for (let i = 0; i < all.length; i += 50) {
      const r = await call(fetchImpl, 'videos', {
        part: 'snippet,statistics,contentDetails',
        id: all.slice(i, i + 50).join(','),
        maxResults: 50,
        key: apiKey,
      });
      (r.items || []).forEach((it) => videos.push(normalize(it)));
    }

    const result = videos
      .filter((v) => v.live === 'none')
      .filter(isAIRelated)
      .filter(isFeatureTopic)
      .map((v) => Object.assign(v, { lang: detectLang(v), cats: categorize(v) }))
      .filter((v) => v.lang === 'ja' && withinPeriod(v, now))
      .sort((a, b) => b.views - a.views);

    return { fetchedAt: new Date(now).toISOString(), days: DEFAULT_DAYS, videos: result };
  }

  root.AITube = {
    fetchVideos, detectLang, isAIRelated, isFeatureTopic, categorize, parseDuration,
    SHORT_MAX_SEC, SEARCHES, CATEGORIES, DEFAULT_DAYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
