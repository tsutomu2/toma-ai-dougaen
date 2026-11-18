#!/usr/bin/env node
/*
 * 要約を data/summaries.js に追加する。
 *   node tools/merge-summaries.js 要約.json
 * 要約.json の形式:
 *   { "動画ID": { "topic": "feature", "summary": "2〜3文の要約", "points": ["使い方1", "使い方2"] }, ... }
 *   topic を "other" にすると、新機能・使い方の動画ではないとしてページに表示しない（summary は短くてよい）
 */
const fs = require('fs');
const store = require('./store');

const file = process.argv[2];
if (!file) {
  console.error('使い方: node tools/merge-summaries.js 要約.json');
  process.exit(1);
}

const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const summaries = store.readSummaries();
const today = new Date().toISOString().slice(0, 10);
let added = 0;

for (const [id, s] of Object.entries(input)) {
  if (!s || typeof s.summary !== 'string' || !s.summary.trim()) {
    console.warn('スキップ（summary がない）: ' + id);
    continue;
  }
  summaries[id] = {
    // feature = 新機能・使い方の動画 / other = 対象外（ページに表示しない）
    topic: s.topic === 'other' ? 'other' : 'feature',
    summary: s.summary.trim(),
    points: Array.isArray(s.points) ? s.points.map(String).filter(Boolean) : [],
    // 自動判定のタブを上書きしたいときだけ指定（例: ["claude", "new"]）
    ...(Array.isArray(s.cats) ? { cats: s.cats.map(String) } : {}),
    summarizedAt: today,
  };
  added++;
}

// 60日より前の要約は削除して肥大化を防ぐ
const limit = Date.now() - 60 * 86400 * 1000;
for (const [id, s] of Object.entries(summaries)) {
  if (s.summarizedAt && Date.parse(s.summarizedAt) < limit) delete summaries[id];
}
store.writeSummaries(summaries);

// pending.json から要約済みを除く
if (fs.existsSync(store.PENDING)) {
  const pending = JSON.parse(fs.readFileSync(store.PENDING, 'utf8')).filter((v) => !summaries[v.id]);
  fs.writeFileSync(store.PENDING, JSON.stringify(pending, null, 2), 'utf8');
  console.log(`追加: ${added} 件 / 残りの未要約: ${pending.length} 件`);
} else {
  console.log(`追加: ${added} 件`);
}
