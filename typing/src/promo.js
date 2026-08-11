// 自分のアプリの紹介枠（ハウス広告）。
//
// AdSense と違って審査もドメインも要らない。クラス名を `.ad` にしないのは、
// 広告ブロッカーが `.ad` を問答無用で消すため。第三者広告ではなく自分の告知なので、
// 消される必要がない。
//
// 「同じ作者のアプリ」と明記する。黙って混ぜると、その一回で信用を失う。

/**
 * 出す内容。アプリが公開されたら url をストアのリンクに差し替える。
 * from= を付けておくと、あとで解析を入れたときに流入元が分かる。
 */
export const PROMOS = {
  study: {
    label: '同じ作者のアプリ',
    icon: '../icon.png',
    title: '勝手に学習計画',
    lead: '予定を入れるだけで、空いた時間に勉強タスクを自動で配置します。受験生向けの学習計画アプリ。',
    cta: 'アプリについて見る',
    url: '../?from=typing',
  },
};

export function mountPromo(elementId, name) {
  const p = PROMOS[name];
  const host = document.getElementById(elementId);
  if (!p || !host || host.dataset.mounted) return false;
  host.dataset.mounted = '1';

  const a = document.createElement('a');
  a.className = 'promo-card';
  a.href = p.url;

  const img = document.createElement('img');
  img.src = p.icon;
  img.alt = '';
  img.width = 56;
  img.height = 56;
  img.loading = 'lazy';

  const body = document.createElement('div');

  const label = document.createElement('span');
  label.className = 'promo-label';
  label.textContent = p.label;

  const title = document.createElement('strong');
  title.textContent = p.title;

  const lead = document.createElement('p');
  lead.textContent = p.lead;

  const cta = document.createElement('span');
  cta.className = 'promo-cta';
  cta.textContent = p.cta;

  body.append(label, title, lead, cta);
  a.append(img, body);
  host.append(a);
  return true;
}
