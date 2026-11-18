#!/usr/bin/env node
/*
 * 最新のAI関連動画を取得して保存し、まだ要約していない動画を data/pending.json に書き出す。
 *   node tools/fetch.js            … 取得（言語ごとに検索1ページ）
 *   node tools/fetch.js --pages 2  … 検索を2ページずつ（件数は増えるがクォータも倍）
 * 対象は日本語の「AIの新機能・使い方」動画のみ（判定は js/youtube.js）。
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
require(path.join(store.ROOT, 'js', 'youtube.js'));
const { fetchVideos, SHORT_MAX_SEC } = globalThis.AITube;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

(async () => {
  const key = store.loadApiKey();
  if (!key) {
    console.error('YouTube API キーが見つかりません。config.example.js を config.js にコピーしてキーを書き込んでください。');
    process.exit(1);
  }

  const snap = await fetchVideos(key, { pages: Number(arg('pages', 1)) });
  store.writeJsAssign(store.SNAPSHOT, 'SNAPSHOT', snap, 'tools/fetch.js が自動生成。直接編集しないこと。');

  const summaries = store.readSummaries();
  const pending = snap.videos
    .filter((v) => !summaries[v.id] && v.durationSec > SHORT_MAX_SEC)
    .map((v) => ({
      id: v.id,
      lang: v.lang,
      views: v.views,
      channel: v.channel,
      title: v.title,
      description: v.description.slice(0, 2500),
      tags: v.tags.slice(0, 20),
    }));
  fs.writeFileSync(store.PENDING, JSON.stringify(pending, null, 2), 'utf8');

  console.log(`取得: ${snap.videos.length} 件（日本語・新機能/使い方）`);
  console.log(`未要約（ショート除く）: ${pending.length} 件 → ${path.relative(store.ROOT, store.PENDING)}`);
})().catch((e) => {
  console.error('取得に失敗しました: ' + e.message);
  process.exit(1);
});
