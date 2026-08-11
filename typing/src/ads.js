// 広告枠。
//
// 設定（config.js の ADS.client）が空の間は、スクリプトも読み込まないし枠も出さない。
// 「審査に通ってから 1 か所書き換えれば出る」状態で置いておくための仕組み。
//
// 広告はゲームの上下にしか置かない。プレイ中の画面には重ねない。
// タイピングは一瞬の集中が要るので、視界の中で動くものは体験を壊す。

import { ADS } from './config.js';

let loaded = false;

function loadScript(client) {
  if (loaded) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}

/**
 * 指定した枠に広告を挿す。
 * @param {string} elementId 枠の id
 * @param {string} slotName  ADS.slots のキー
 */
export function mountAd(elementId, slotName) {
  const { client, slots } = ADS;
  const slot = slots?.[slotName];
  if (!client || !slot) return false; // 未設定なら何もしない＝枠は空のまま非表示

  const host = document.getElementById(elementId);
  if (!host || host.dataset.mounted) return false;
  host.dataset.mounted = '1';

  loadScript(client);

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = client;
  ins.dataset.adSlot = slot;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  host.appendChild(ins);

  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* 読み込み前でも後から処理される */ }
  return true;
}

/** 設定済みかどうか（ページ側で案内を出し分けるのに使う） */
export const adsEnabled = () => Boolean(ADS.client);
