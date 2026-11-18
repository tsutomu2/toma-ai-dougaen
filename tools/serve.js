#!/usr/bin/env node
/*
 * 持ち主用のローカルサーバー。 npm start で起動し、http://localhost:8765 を開く。
 *
 * - ページをそのまま配信する
 * - 「とーまくんおすすめ」ボタンの保存先（POST /api/picks → data/picks.js）
 * - 「公開ページに反映」ボタン（POST /api/publish → git commit & push）
 *
 * このサーバーは自分のパソコン（127.0.0.1）からしか接続できない。
 * GitHub Pages の公開ページにはこの仕組みがないので、ほかの人はおすすめを変えられない。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./store');

const PORT = Number(process.env.PORT || 8765);
const HOST = '127.0.0.1';
const PICKS = path.join(store.DATA, 'picks.js');
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

function readPicks() {
  return store.readJsAssign(PICKS, { ids: [] });
}
function writePicks(p) {
  p.updatedAt = new Date().toISOString().slice(0, 10);
  store.writeJsAssign(PICKS, 'PICKS', p, 'とーまくんおすすめ（持ち主が選んだ動画）。tools/serve.js の「おすすめ」ボタンで更新される。');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** よそのサイトからの書き込み（CSRF）を防ぐ：同じ localhost のページからの要求だけ受け付ける */
function isOwnerRequest(req) {
  const origin = req.headers.origin;
  return req.headers['x-toma-owner'] === '1' && (!origin || ALLOWED_ORIGINS.has(origin));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10000) reject(new Error('too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function git(args) {
  return execFileSync('git', args, { cwd: store.ROOT, encoding: 'utf8' }).trim();
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/owner' && req.method === 'GET') {
    return json(res, 200, { owner: true });
  }
  if (!isOwnerRequest(req)) return json(res, 403, { error: 'forbidden' });

  if (url.pathname === '/api/picks' && req.method === 'POST') {
    const { id, on } = JSON.parse((await readBody(req)) || '{}');
    if (typeof id !== 'string' || !/^[\w-]{6,20}$/.test(id)) return json(res, 400, { error: 'bad id' });
    const p = readPicks();
    const set = new Set(p.ids || []);
    if (on) set.add(id);
    else set.delete(id);
    p.ids = [...set];
    writePicks(p);
    return json(res, 200, { ids: p.ids });
  }

  if (url.pathname === '/api/publish' && req.method === 'POST') {
    try {
      // 公開してはいけない API キーが入っていないか確認してから push する
      git(['add', '-A']);
      const leaked = (() => {
        try {
          return git(['grep', '--cached', '-lE', 'AIza[0-9A-Za-z_-]{30,}']);
        } catch (_) {
          return ''; // 見つからないと git grep は終了コード1になる
        }
      })();
      if (leaked) return json(res, 500, { error: 'API キーらしき文字列が含まれているため中止しました: ' + leaked });
      if (git(['status', '--porcelain'])) {
        git(['commit', '-m', 'とーまくんおすすめを更新']);
      }
      git(['push']);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { error: String(e.stderr || e.message).slice(0, 500) });
    }
  }
  return json(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(store.ROOT, rel));
  // フォルダの外や、隠しファイル（.git など）は配信しない
  if (!file.startsWith(store.ROOT + path.sep) || /[\\/]\./.test(path.relative(store.ROOT, file))) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((e) => json(res, 500, { error: e.message }));
    } else {
      serveStatic(req, res, url);
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`とーまくんのAI動画園（持ち主モード）: http://localhost:${PORT}`);
  });
