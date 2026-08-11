// 強化カード。
//
// ゲーム本体から切り離してあるのは、「重ねがけがちゃんと効いているか」を
// node のテストで機械的に確かめるため。効かない強化を引かせるのが一番よくない。
//
// max は取得可能な上限。上限に達したカードは提案されなくなる。

export const UPGRADES = [
  {
    id: 'slow',
    max: 5,
    apply: (s) => { s.mods.speed *= 0.85; },
    level: (s) => `×${s.mods.speed.toFixed(2)}`,
  },
  {
    id: 'heal',
    max: 99,
    apply: (s) => { s.maxHp++; s.hp = Math.min(s.maxHp, s.hp + 1); },
    level: (s) => `HP ${s.maxHp}`,
  },
  {
    id: 'focus',
    max: 3,
    // 段階的に上がる。以前は 0.5 を代入するだけで、2 枚目以降が完全に無意味だった
    apply: (s, taken) => { s.mods.comboKeep = [0.5, 0.7, 0.85][Math.min(2, taken)]; },
    level: (s) => `${Math.round(s.mods.comboKeep * 100)}%`,
  },
  {
    id: 'short',
    max: 2,
    apply: (s) => { s.mods.lenBias -= 2; },
    level: (s) => `${s.mods.lenBias}`,
  },
  {
    id: 'blast',
    max: 4,
    apply: (s) => { s.mods.blast += 90; },
    level: (s) => `${s.mods.blast}px`,
  },
  {
    id: 'amp',
    max: 6,
    apply: (s) => { s.mods.scoreMul += 0.3; },
    level: (s) => `×${s.mods.scoreMul.toFixed(1)}`,
  },
  {
    id: 'shield',
    max: 3,
    apply: (s) => { s.mods.shield++; },
    level: (s) => `${s.mods.shield}`,
  },
];

export const byId = (id) => UPGRADES.find((u) => u.id === id);

/** まだ上限に達していないカードだけを候補にする */
export function offerable(taken) {
  return UPGRADES.filter((u) => (taken[u.id] ?? 0) < u.max);
}

/** 1 枚取る。取得数を数えたうえで効果を適用する */
export function take(s, id) {
  const u = byId(id);
  const n = s.taken[id] ?? 0;
  u.apply(s, n);
  s.taken[id] = n + 1;
  return s.taken[id];
}
