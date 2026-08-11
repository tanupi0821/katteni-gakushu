// 配置に関する設定。
//
// ゲーム本体は GitHub Pages（勝手に学習と同じドメイン）に置き、
// ランキング API だけ Cloudflare Worker に置く構成を想定している。
// GitHub Pages のドメインには Worker を載せられないので、この 2 つは別オリジンになる。
//
// 同一オリジンで配る（Worker から静的配信もする）構成に変えるときは
// API_BASE を空文字にすれば、そのまま同一オリジンを見にいく。

/** ランキング API の場所。空文字なら同一オリジンの /api/board を使う */
export const API_BASE = 'https://daken-boei.tanupi0821.workers.dev';

/** 公開先のオリジン。Worker 側の CORS 許可リストと必ず揃えること */
export const SITE_ORIGINS = [
  'https://tanupi0821.github.io',
  'http://localhost:5173',
];

/**
 * 広告。
 *
 * AdSense は「自分で取得したドメイン」でしか申し込めない。
 * tanupi0821.github.io のような他人のドメインのサブドメインは登録できないので、
 * 独自ドメインを取って審査に通るまでは client を空のままにしておく。
 * 空の間は広告枠自体が表示されない（`.ad:empty { display:none }`）。
 *
 * 有効にする手順:
 *   1. 独自ドメインを取り、そちらで公開する
 *   2. AdSense の審査に通す
 *   3. client に "ca-pub-XXXXXXXXXXXXXXXX" を入れ、slots に広告ユニット ID を入れる
 */
export const ADS = {
  client: '',
  slots: {
    top: '',
    mid: '',
  },
};
