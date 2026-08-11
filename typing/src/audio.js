// 音は全部その場で合成する。アセット 0 = ライセンス問題 0・容量 0・遅延 0。
// タイピングゲームは打鍵音の手触りが評価を決めるので、ここは妥協しない。

import { PROFILES, stepVoices, stepSeconds } from './music.js';

const num = (k, d) => {
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && localStorage.getItem(k) !== null ? v : d;
};

export const vol = {
  master: num('kd.vol.master', 0.7),
  sfx: num('kd.vol.sfx', 0.8),
  music: num('kd.vol.music', 0.45),
};

let ctx = null;
let masterGain = null;
let sfxBus = null;
let musicBus = null;
let noiseBuf = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  masterGain = ctx.createGain();
  masterGain.gain.value = vol.master;
  masterGain.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = vol.sfx;
  sfxBus.connect(masterGain);

  musicBus = ctx.createGain();
  musicBus.gain.value = vol.music;
  musicBus.connect(masterGain);

  // ノイズ源（打鍵のアタックとハイハットに使う）
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  return ctx;
}

function tone({ freq, to, type = 'square', dur = 0.08, gain = 0.2, at = 0, bus = sfxBus, cutoff = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  let node = o;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    node.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.06, gain = 0.15, at = 0, cutoff = 4000, type = 'highpass', bus = sfxBus }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;

  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(cutoff, t);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(f);
  f.connect(g);
  g.connect(bus);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------- BGM
// 16 ステップのシーケンサ。ウェーブが進むほどテンポが上がる。
const SCALE = [0, 3, 5, 7, 10]; // マイナーペンタトニック
const ROOT = 55;                // A1
const hz = (semi) => ROOT * Math.pow(2, semi / 12);

let playing = false;
let step = 0;
let nextNoteAt = 0;
let profile = PROFILES[0];
let level = 0;      // 0〜1。ウェーブが進むほど層が増える
let mmode = 'game'; // 'game' | 'title'

// ── 声部ごとの発音。音色の作り分けはここに集約する
function padVoice(v, at) {
  const t = ctx.currentTime + at;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v.gain, t + 0.35);           // ゆっくり立ち上げる
  g.gain.setValueAtTime(v.gain, t + v.dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);

  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(v.cutoff, t);
  f.Q.value = 0.7;

  // 2 基をわずかにずらして厚みを出す
  for (const det of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = v.type;
    o.frequency.setValueAtTime(v.freq, t);
    o.detune.setValueAtTime(det, t);
    o.connect(f);
    o.start(t);
    o.stop(t + v.dur + 0.05);
  }
  f.connect(g);
  g.connect(musicBus);
}

function pluck(v, at, cutoff) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = v.type;
  o.frequency.setValueAtTime(v.freq, t);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);

  let node = o;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.5), t + v.dur);
    node.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(musicBus);
  o.start(t);
  o.stop(t + v.dur + 0.05);
}

function kick(at) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
  o.connect(g);
  g.connect(musicBus);
  o.start(t);
  o.stop(t + 0.24);
}

function snare(at) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(1900, t);
  f.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  src.connect(f); f.connect(g); g.connect(musicBus);
  src.start(t); src.stop(t + 0.16);
}

function hat(at, gain) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.setValueAtTime(8200, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  src.connect(f); f.connect(g); g.connect(musicBus);
  src.start(t); src.stop(t + 0.05);
}

function scheduleStep(at) {
  for (const v of stepVoices(profile, step, level, mmode)) {
    if (v.kind === 'pad') padVoice(v, at);
    else if (v.kind === 'bass') pluck(v, at, v.cutoff);
    else if (v.kind === 'arp' || v.kind === 'lead') pluck(v, at, 0);
    else if (v.kind === 'kick') kick(at);
    else if (v.kind === 'snare') snare(at);
    else if (v.kind === 'hat') hat(at, v.gain);
  }
  step++;
}

// スケジューラはゲームループ（rAF）から回す。
// setInterval だと非アクティブタブで 1 秒に間引かれて BGM が破綻する。
function tick() {
  if (!ctx || !playing) return;
  // 長時間ブロックされた後に一気に鳴らないよう、遅れすぎたら現在時刻へ寄せる
  if (nextNoteAt < ctx.currentTime - 0.3) nextNoteAt = ctx.currentTime;
  while (nextNoteAt < ctx.currentTime + 0.12) {
    scheduleStep(Math.max(0, nextNoteAt - ctx.currentTime));
    nextNoteAt += stepSeconds(profile, step);
  }
}

// ---------------------------------------------------------------- 公開 API
export const Sfx = {
  /** 最初のキー入力で呼ぶ（ブラウザの自動再生制限の解除） */
  unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  },

  ready: () => !!ctx,

  setVolume(kind, v) {
    vol[kind] = Math.max(0, Math.min(1, v));
    localStorage.setItem(`kd.vol.${kind}`, String(vol[kind]));
    if (!ctx) return;
    ({ master: masterGain, sfx: sfxBus, music: musicBus })[kind].gain.value = vol[kind];
  },

  /** 打鍵。コンボでピッチが上がっていく＝連打が気持ちよくなる */
  hit(combo = 0) {
    if (!ctx) return;
    const semi = SCALE[combo % SCALE.length] + 48 + Math.min(24, (combo / SCALE.length | 0) * 2);
    tone({ freq: hz(semi), type: 'square', dur: 0.035, gain: 0.075 });
    noise({ dur: 0.018, gain: 0.05, cutoff: 5200 });
  },

  miss() {
    tone({ freq: 150, to: 70, type: 'sawtooth', dur: 0.14, gain: 0.14, cutoff: 900 });
    noise({ dur: 0.07, gain: 0.07, cutoff: 1200, type: 'lowpass' });
  },

  /** 撃破。長い語ほど上まで駆け上がる */
  kill(n = 4) {
    const steps = Math.min(4, 2 + (n / 4 | 0));
    for (let i = 0; i < steps; i++) {
      tone({ freq: hz(SCALE[i % SCALE.length] + 60), type: 'triangle', dur: 0.12, gain: 0.1, at: i * 0.035 });
    }
    noise({ dur: 0.09, gain: 0.06, cutoff: 3000 });
  },

  damage() {
    tone({ freq: 180, to: 40, type: 'sine', dur: 0.5, gain: 0.3 });
    tone({ freq: 90, to: 30, type: 'sawtooth', dur: 0.4, gain: 0.14, cutoff: 500 });
    noise({ dur: 0.3, gain: 0.12, cutoff: 900, type: 'lowpass' });
  },

  shield() {
    tone({ freq: hz(72), type: 'sine', dur: 0.3, gain: 0.16 });
    tone({ freq: hz(79), type: 'sine', dur: 0.35, gain: 0.1, at: 0.04 });
  },

  waveClear() {
    [0, 5, 7, 12].forEach((semi, i) => {
      tone({ freq: hz(semi + 60), type: 'triangle', dur: 0.28, gain: 0.11, at: i * 0.09 });
    });
  },

  card() {
    tone({ freq: hz(67), type: 'square', dur: 0.07, gain: 0.09 });
  },

  gameOver() {
    [12, 10, 7, 3].forEach((semi, i) => {
      tone({ freq: hz(semi + 48), type: 'triangle', dur: 0.5, gain: 0.12, at: i * 0.16 });
    });
    tone({ freq: 120, to: 35, type: 'sine', dur: 1.2, gain: 0.2 });
  },

  // --- BGM
  /** @param chapter 章の番号（0 起点）。章ごとに調とテンポと楽器が変わる */
  startMusic(wave = 1, chapter = 0, kind = 'game') {
    if (!ensure()) return;
    const next = PROFILES[chapter % PROFILES.length];
    const changed = next !== profile || kind !== mmode;
    profile = next;
    mmode = kind;
    Sfx.setWave(wave);
    if (playing && !changed) return;
    // 章が変わったら小節の頭から鳴らし直す（つぎはぎに聞こえないように）
    step = 0;
    nextNoteAt = ctx.currentTime + 0.06;
    playing = true;
  },

  /** ゲームループから毎フレーム呼ぶ */
  tick,

  setWave(wave) {
    level = Math.min(1, (wave - 1) / 8);
  },

  stopMusic() {
    playing = false;
  },

  /** いま鳴っている曲の情報（検証用） */
  info: () => ({ playing, profile: profile.id, level, mode: mmode, step }),
};
