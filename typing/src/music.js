// BGM。章ごとに調・テンポ・楽器を変える。
//
// 以前の実装はベースとハイハットが数個鳴るだけで、実際には「無音」に聞こえていた。
// ここではコード進行・ベース・パッド・アルペジオ・旋律・ドラムを持つ、
// 曲として成立する構成にしてある。音源ファイルは使わず全部合成。
//
// 章ごとに旋法を変えるのは、耳でも「別の場所に来た」と分かるようにするため。

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

const MODES = {
  minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:   [0, 2, 3, 5, 7, 9, 10],
  lydian:   [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major:    [0, 2, 4, 5, 7, 9, 11],
};

/** 章ごとの音楽。順に 野生 / 機械都市 / 観測所 / 呪詛 / 記憶 */
export const PROFILES = [
  {
    id: 'wild', bpm: 92, root: 45, mode: 'minor',
    chords: [0, 5, 2, 4],
    bass: 'sawtooth', pad: 'triangle', arp: 'triangle', lead: 'sine',
    bassCut: 380, padCut: 1500,
    melody: [0, 2, 4, 2, 0, -3, 0, null],
    swing: 0.06,
  },
  {
    id: 'machine', bpm: 118, root: 38, mode: 'dorian',
    chords: [0, 3, 0, 6],
    bass: 'square', pad: 'sawtooth', arp: 'square', lead: 'square',
    bassCut: 520, padCut: 1100,
    melody: [0, 4, 3, 4, 6, 4, 3, null],
    swing: 0,
  },
  {
    id: 'observatory', bpm: 80, root: 41, mode: 'lydian',
    chords: [0, 1, 5, 3],
    bass: 'triangle', pad: 'sine', arp: 'sine', lead: 'triangle',
    bassCut: 700, padCut: 2600,
    melody: [4, 6, 4, 2, 0, 2, 4, null],
    swing: 0.08,
  },
  {
    id: 'arcane', bpm: 132, root: 40, mode: 'phrygian',
    chords: [0, 1, 0, 4],
    bass: 'sawtooth', pad: 'sawtooth', arp: 'sawtooth', lead: 'square',
    bassCut: 340, padCut: 900,
    melody: [0, 1, 0, -2, 0, 4, 3, null],
    swing: 0,
  },
  {
    id: 'memory', bpm: 100, root: 48, mode: 'major',
    chords: [0, 4, 5, 3],
    bass: 'triangle', pad: 'triangle', arp: 'sine', lead: 'sine',
    bassCut: 620, padCut: 2000,
    melody: [2, 4, 2, 0, -3, 0, 2, null],
    swing: 0.05,
  },
];

/** 音階の度数から MIDI ノートを引く（オクターブをまたいでも壊れない） */
function degree(p, d, oct = 0) {
  const sc = MODES[p.mode];
  const n = sc.length;
  const i = ((d % n) + n) % n;
  const wrap = Math.floor(d / n);
  return p.root + sc[i] + (wrap + oct) * 12;
}

/** 三和音（1・3・5度） */
function triad(p, root, oct = 0) {
  return [0, 2, 4].map((k) => degree(p, root + k, oct));
}

/**
 * 1 ステップ（16 分音符）ぶんの音を組み立てて返す。
 * 実際の発音は audio.js 側に任せ、ここは「何を鳴らすか」だけを決める。
 *
 * @param step   通し歩数
 * @param level  0〜1。ウェーブが進むほど層が増える
 * @param mode   'game' | 'title'
 */
export function stepVoices(profile, step, level, mode = 'game') {
  const p = profile;
  const out = [];
  const bar = Math.floor(step / 16) % 4;
  const beat = step % 16;
  const chord = p.chords[bar];
  const title = mode === 'title';

  // ── パッド（常時）。小節頭で三和音を長く伸ばす
  if (beat === 0) {
    for (const n of triad(p, chord, 1)) {
      out.push({ kind: 'pad', freq: midi(n), type: p.pad, dur: (60 / p.bpm) * 4 * 0.95, gain: title ? 0.075 : 0.062, cutoff: p.padCut });
    }
  }

  // ── ベース（タイトルでは鳴らさない。静かに始めたい）
  if (!title && (beat === 0 || beat === 6 || beat === 10)) {
    const n = degree(p, chord, -1);
    out.push({ kind: 'bass', freq: midi(n), type: p.bass, dur: 0.26, gain: 0.30, cutoff: p.bassCut });
  }

  // ── ドラム
  if (!title) {
    if (beat === 0 || beat === 8) out.push({ kind: 'kick' });
    if (level > 0.55 && (beat === 4 || beat === 12)) out.push({ kind: 'snare' });
    if (level > 0.15 && beat % 4 === 2) out.push({ kind: 'hat', gain: 0.05 });
    if (level > 0.75 && beat % 2 === 1) out.push({ kind: 'hat', gain: 0.028 });
  }

  // ── アルペジオ。旋律の主役なので最初から鳴らす。
  // ここを後半まで伏せていたせいで、序盤が「BGM が無い」と感じられていた。
  if (beat % 2 === 0) {
    const notes = triad(p, chord, 2);
    const n = notes[(step / 2) % notes.length | 0];
    out.push({ kind: 'arp', freq: midi(n), type: p.arp, dur: 0.14, gain: title ? 0.055 : 0.05 });
  }

  // ── 旋律。8 分音符 8 個で 1 小節ぶんの動機を回す
  if (!title && level > 0.45 && beat % 2 === 0) {
    const d = p.melody[(beat / 2) % p.melody.length];
    if (d !== null) {
      out.push({ kind: 'lead', freq: midi(degree(p, chord + d, 2)), type: p.lead, dur: 0.19, gain: 0.085 });
    }
  }

  return out;
}

/** ステップの秒数。スイングは偶数・奇数で長さを変えて跳ねさせる */
export function stepSeconds(profile, step) {
  const base = 60 / profile.bpm / 4;
  if (!profile.swing) return base;
  return step % 2 === 0 ? base * (1 + profile.swing) : base * (1 - profile.swing);
}
