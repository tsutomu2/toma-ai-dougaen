# とーまくんのウマいAI動画

とーまくんが選ぶ AI 動画集。YouTube の直近1週間から、AI の新機能・使い方を紹介する日本語の動画を、
AI別のタブ・再生数・要約つきで紹介します。

## はじめに（1回だけ）
1. Google Cloud で **YouTube Data API v3** を有効にし、API キーを作成する
   - https://console.cloud.google.com/apis/library/youtube.googleapis.com
   - キーの制限は「API の制限 → YouTube Data API v3」だけにする（HTTP リファラー制限は付けない）
2. `config.example.js` をコピーして `config.js` を作り、`ここにAPIキー` をキーに書き換える

## 使い方
- `index.html` をダブルクリックで開く → 自動で最新1週間分を取得して表示
- 並び順（再生数順／新しい順）、ショートの表示、キーワードで絞り込みできる

## 要約の更新
Claude に「新しい動画を要約して」と頼むと、未要約の動画を要約して `data/summaries.js` に保存します。
ページを再読み込みすると要約が表示されます。手順は `CLAUDE.md` に書いてあります。
