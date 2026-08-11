// 打鍵の記録と、かな別の弱点分析。
//
// これがこの製品の差別化点。ゲームは「速く打てたか」しか返さないが、
// トレーナーは「どこで詰まっているか」を返す。全打鍵は既に通っているので、
// 拾って貯めるだけで「しゃ が平均の 1.8 倍遅い」が出せる。
//
// 保存は言語ごと。セッションをまたいで積み上がることが価値なので localStorage に置く。

const VERSION = 1;
const key = (lang) => `kd.stats.v${VERSION}.${lang}`;

const empty = () => ({ v: VERSION, runs: 0, units: {}, history: [] });

export function load(lang) {
  try {
    const raw = JSON.parse(localStorage.getItem(key(lang)) ?? 'null');
    if (raw && raw.v === VERSION && raw.units) return raw;
  } catch { /* 壊れていたら作り直す */ }
  return empty();
}

function save(lang, data) {
  try { localStorage.setItem(key(lang), JSON.stringify(data)); } catch { /* 容量超過は黙って諦める */ }
}

export function reset(lang) {
  save(lang, empty());
}

/**
 * 1 ラン分の記録をためる器。ラン中はメモリ上だけで動かし、終了時にまとめて永続化する。
 * 打鍵のたびに localStorage を触ると重い。
 */
export class RunStats {
  constructor() {
    this.units = {};   // かな（英語なら1文字）→ { n, ms, keys, miss }
    this.correct = 0;
    this.miss = 0;
  }

  /** 入力単位を1つ打ち切った */
  unit(kana, keys, ms) {
    const u = (this.units[kana] ??= { n: 0, ms: 0, keys: 0, miss: 0 });
    u.n++;
    u.keys += keys;
    // 極端に長い間隔は「考えていた」「手を止めた」であって打鍵速度ではないので上限で切る
    u.ms += Math.min(ms, 3000);
  }

  /** その単位を打っている最中にミスした */
  missOn(kana) {
    if (!kana) return;
    (this.units[kana] ??= { n: 0, ms: 0, keys: 0, miss: 0 }).miss++;
  }
}

/**
 * 溜まった記録を通算へ足しこむ。
 *
 * summary を渡したときだけ「1 ラン終わった」とみなして履歴に積む。
 * ウェーブの切れ目でも呼ぶこと。ゲームオーバー時しか保存しないと、
 * 途中でやめた人の打鍵が丸ごと消える（トレーナーとしては致命的）。
 */
export function commit(lang, run, summary = null) {
  const data = load(lang);
  let touched = false;
  for (const [k, u] of Object.entries(run.units)) {
    if (!u.n && !u.miss) continue;
    const t = (data.units[k] ??= { n: 0, ms: 0, keys: 0, miss: 0 });
    t.n += u.n; t.ms += u.ms; t.keys += u.keys; t.miss += u.miss;
    touched = true;
  }
  if (summary) {
    data.runs++;
    data.history.push({ t: Date.now(), ...summary });
    if (data.history.length > 200) data.history = data.history.slice(-200);
    touched = true;
  }
  if (touched) save(lang, data);
  return data;
}

/**
 * 通算の分析。
 * 単位ごとの「1打鍵あたりの所要時間」を、その人自身の平均と比べる。
 * 他人と比べても意味がない（速い人にも苦手なかなはある）。
 */
export function analyze(lang, { minCount = 4, top = 5 } = {}) {
  const data = load(lang);
  const entries = Object.entries(data.units).filter(([, u]) => u.keys > 0);
  if (!entries.length) return null;

  const totalMs = entries.reduce((a, [, u]) => a + u.ms, 0);
  const totalKeys = entries.reduce((a, [, u]) => a + u.keys, 0);
  const baseline = totalMs / totalKeys; // 自分の平均: 1打鍵あたり ms

  const scored = entries
    .filter(([, u]) => u.n >= minCount)
    .map(([kana, u]) => ({
      kana,
      n: u.n,
      msPerKey: u.ms / u.keys,
      ratio: (u.ms / u.keys) / baseline,     // 1.0 が自分の平均。大きいほど苦手
      missRate: u.n ? u.miss / u.n : 0,
    }));

  return {
    runs: data.runs,
    baseline,
    tracked: scored.length,
    // 遅さとミス率を合わせて「詰まっている度合い」にする
    weakest: [...scored].sort((a, b) => (b.ratio + b.missRate * 2) - (a.ratio + a.missRate * 2)).slice(0, top),
    fastest: [...scored].sort((a, b) => a.ratio - b.ratio).slice(0, top),
    history: data.history,
  };
}
