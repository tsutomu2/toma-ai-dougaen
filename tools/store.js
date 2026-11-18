// data/ 配下のファイル読み書きと API キー読み込み（Node 用）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const SUMMARIES = path.join(DATA, 'summaries.js');
const SNAPSHOT = path.join(DATA, 'videos.js');
const PENDING = path.join(DATA, 'pending.json');

/** "window.NAME = {...};" 形式のファイルから JSON 部分を読む */
function readJsAssign(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, 'utf8');
  const m = /window\.\w+\s*=/.exec(text);
  const end = text.lastIndexOf('}');
  if (!m || end < 0) return fallback;
  return JSON.parse(text.slice(m.index + m[0].length, end + 1));
}

function writeJsAssign(file, name, obj, comment) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = comment ? '// ' + comment + '\n' : '';
  fs.writeFileSync(file, head + 'window.' + name + ' = ' + JSON.stringify(obj, null, 2) + ';\n', 'utf8');
}

const readSummaries = () => readJsAssign(SUMMARIES, {});
const writeSummaries = (obj) =>
  writeJsAssign(SUMMARIES, 'SUMMARIES', obj, '動画IDごとの要約。tools/merge-summaries.js で更新する。');

function loadApiKey() {
  if (process.env.YT_API_KEY) return process.env.YT_API_KEY.trim();
  const file = path.join(ROOT, 'config.js');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/YT_API_KEY\s*=\s*['"]([^'"]*)['"]/);
  const key = m && m[1].trim();
  return key && !key.startsWith('ここに') ? key : null;
}

module.exports = {
  ROOT, DATA, SUMMARIES, SNAPSHOT, PENDING,
  readJsAssign, writeJsAssign, readSummaries, writeSummaries, loadApiKey,
};
