#!/usr/bin/env node
/*
 * 確認用のローカルサーバー。 npm start で起動し、http://localhost:8765 を開く。
 * ページをそのまま配信するだけ。自分のパソコン（127.0.0.1）からしか接続できない。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const PORT = Number(process.env.PORT || 8765);
const HOST = '127.0.0.1';

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
  .createServer((req, res) => serveStatic(req, res, new URL(req.url, `http://${req.headers.host || HOST}`)))
  .listen(PORT, HOST, () => {
    console.log(`とーまくんのAI動画園: http://localhost:${PORT}`);
  });
