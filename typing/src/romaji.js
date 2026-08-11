// ローマ字入力エンジン
//
// かな文字列を「入力単位」に分解し、単位ごとに許容ローマ字の候補を持たせる。
// し = si / shi / ci、っ = 次の子音の重ね打ち、ん = 後続に応じて n / nn を出し分ける、
// といった日本語タイピングの分岐をすべて受け付ける。ここがこのゲームの心臓部。

const BASE = {
  あ: ['a'], い: ['i', 'yi'], う: ['u', 'wu', 'whu'], え: ['e'], お: ['o'],
  か: ['ka', 'ca'], き: ['ki'], く: ['ku', 'cu', 'qu'], け: ['ke'], こ: ['ko', 'co'],
  が: ['ga'], ぎ: ['gi'], ぐ: ['gu'], げ: ['ge'], ご: ['go'],
  さ: ['sa'], し: ['si', 'shi', 'ci'], す: ['su'], せ: ['se', 'ce'], そ: ['so'],
  ざ: ['za'], じ: ['zi', 'ji'], ず: ['zu'], ぜ: ['ze'], ぞ: ['zo'],
  た: ['ta'], ち: ['ti', 'chi'], つ: ['tu', 'tsu'], て: ['te'], と: ['to'],
  だ: ['da'], ぢ: ['di'], づ: ['du'], で: ['de'], ど: ['do'],
  な: ['na'], に: ['ni'], ぬ: ['nu'], ね: ['ne'], の: ['no'],
  は: ['ha'], ひ: ['hi'], ふ: ['hu', 'fu'], へ: ['he'], ほ: ['ho'],
  ば: ['ba'], び: ['bi'], ぶ: ['bu'], べ: ['be'], ぼ: ['bo'],
  ぱ: ['pa'], ぴ: ['pi'], ぷ: ['pu'], ぺ: ['pe'], ぽ: ['po'],
  ま: ['ma'], み: ['mi'], む: ['mu'], め: ['me'], も: ['mo'],
  や: ['ya'], ゆ: ['yu'], よ: ['yo'],
  ら: ['ra'], り: ['ri'], る: ['ru'], れ: ['re'], ろ: ['ro'],
  わ: ['wa'], を: ['wo'], ゔ: ['vu'],
  'ー': ['-'],
};

// 小書き文字（単独で打つ場合）
const SMALL = {
  ぁ: ['xa', 'la'], ぃ: ['xi', 'li'], ぅ: ['xu', 'lu'], ぇ: ['xe', 'le'], ぉ: ['xo', 'lo'],
  ゃ: ['xya', 'lya'], ゅ: ['xyu', 'lyu'], ょ: ['xyo', 'lyo'], ゎ: ['xwa', 'lwa'],
  っ: ['xtu', 'ltu', 'xtsu', 'ltsu'],
};

// 拗音・外来音（2文字で1単位）
const COMBO = {
  きゃ: ['kya'], きゅ: ['kyu'], きょ: ['kyo'], きぇ: ['kye'],
  ぎゃ: ['gya'], ぎゅ: ['gyu'], ぎょ: ['gyo'],
  しゃ: ['sya', 'sha'], しゅ: ['syu', 'shu'], しょ: ['syo', 'sho'], しぇ: ['sye', 'she'],
  じゃ: ['zya', 'ja', 'jya'], じゅ: ['zyu', 'ju', 'jyu'], じょ: ['zyo', 'jo', 'jyo'], じぇ: ['zye', 'je', 'jye'],
  ちゃ: ['tya', 'cha', 'cya'], ちゅ: ['tyu', 'chu', 'cyu'], ちょ: ['tyo', 'cho', 'cyo'], ちぇ: ['tye', 'che', 'cye'],
  にゃ: ['nya'], にゅ: ['nyu'], にょ: ['nyo'],
  ひゃ: ['hya'], ひゅ: ['hyu'], ひょ: ['hyo'],
  びゃ: ['bya'], びゅ: ['byu'], びょ: ['byo'],
  ぴゃ: ['pya'], ぴゅ: ['pyu'], ぴょ: ['pyo'],
  みゃ: ['mya'], みゅ: ['myu'], みょ: ['myo'],
  りゃ: ['rya'], りゅ: ['ryu'], りょ: ['ryo'],
  ふぁ: ['fa'], ふぃ: ['fi'], ふぇ: ['fe'], ふぉ: ['fo'], ふゅ: ['fyu'],
  てぃ: ['thi'], てゅ: ['thu'], でぃ: ['dhi'], でゅ: ['dhu'],
  とぅ: ['twu'], どぅ: ['dwu'],
  うぃ: ['wi', 'whi'], うぇ: ['we', 'whe'], うぉ: ['who'],
  ゔぁ: ['va'], ゔぃ: ['vi'], ゔぇ: ['ve'], ゔぉ: ['vo'],
  くぁ: ['qa'], くぃ: ['qi'], くぇ: ['qe'], くぉ: ['qo'],
};

const isVowel = (c) => 'aiueo'.includes(c);
const uniq = (a) => [...new Set(a)];

/** かな列を入力単位のかな文字列へ分割する（拗音は2文字で1単位） */
function tokenize(kana) {
  const out = [];
  for (let i = 0; i < kana.length; i++) {
    const c = kana[i];
    const n = kana[i + 1];
    if (n && COMBO[c + n]) { out.push(c + n); i++; continue; }
    if (n && SMALL[n] && n !== 'っ' && BASE[c]) { out.push(c + n); i++; continue; }
    out.push(c);
  }
  return out;
}

/** 単位1つ分の許容ローマ字候補。っ と ん は後続単位の候補に依存する */
function candidatesFor(unit, nextCands) {
  if (unit === 'っ') {
    const out = [...SMALL['っ']];
    if (nextCands) {
      for (const c of nextCands) {
        const f = c[0];
        if (!isVowel(f) && f !== 'n' && /[a-z]/.test(f)) out.push(f); // 子音重ね（がっこう = ga-k-ko-u）
      }
    }
    return uniq(out);
  }
  if (unit === 'ん') {
    const out = ['nn', "n'", 'xn'];
    if (nextCands) {
      const heads = uniq(nextCands.map((c) => c[0]));
      // 後続が母音・n・y で始まるときは単独 n を認めない（んあ / んな / んや の誤変換防止）
      if (!heads.some((f) => isVowel(f) || f === 'n' || f === 'y')) out.unshift('n');
    }
    return out;
  }
  if (COMBO[unit]) {
    const split = [];
    for (const b of BASE[unit[0]] ?? []) for (const s of SMALL[unit[1]] ?? []) split.push(b + s);
    return uniq([...COMBO[unit], ...split]); // きゃ = kya / kixya / kilya
  }
  if (unit.length === 2) {
    const split = [];
    for (const b of BASE[unit[0]] ?? []) for (const s of SMALL[unit[1]] ?? []) split.push(b + s);
    return uniq(split);
  }
  return BASE[unit] ?? SMALL[unit] ?? [unit];
}

// 解析結果は語ごとに使い回す。
// 入力候補の判定は打鍵ごとに画面上の全敵ぶん走るので、毎回組み立てると重い。
// Matcher は units を読むだけで書き換えないので、共有して問題ない。
const parseCache = new Map();

export function parseKana(kana) {
  const hit = parseCache.get(kana);
  if (hit) return hit;

  const raw = tokenize(kana);
  const units = new Array(raw.length);
  for (let i = raw.length - 1; i >= 0; i--) {
    units[i] = { kana: raw[i], cands: candidatesFor(raw[i], i + 1 < raw.length ? units[i + 1].cands : null) };
  }
  parseCache.set(kana, units);
  return units;
}

const shortest = (cands) => cands.reduce((a, b) => (b.length < a.length ? b : a), cands[0]);

/** 1単語ぶんの入力状態機械 */
export class Matcher {
  constructor(kana) {
    this.kana = kana;
    this.units = parseKana(kana);
    this.idx = 0;      // 確定済み単位数
    this.buf = '';     // 現在の単位に入っている途中入力
    this.log = '';     // 実際に打たれた文字列
  }

  get done() { return this.idx >= this.units.length; }
  get progress() { return this.units.length ? this.idx / this.units.length : 1; }

  /** @returns {'hit'|'done'|'miss'} */
  input(ch) {
    ch = ch.toLowerCase();
    for (let guard = 0; guard < 4; guard++) {
      if (this.done) return 'miss';
      const cands = this.units[this.idx].cands.filter((c) => c.startsWith(this.buf));
      const next = this.buf + ch;
      const ext = cands.filter((c) => c.startsWith(next));
      if (ext.length) {
        this.buf = next;
        this.log += ch;
        // 「n」のように、確定形でありながらより長い候補（nn）も残る場合は確定を保留する
        if (ext.includes(next) && !ext.some((c) => c.length > next.length)) {
          this.idx++;
          this.buf = '';
        }
        return this.done ? 'done' : 'hit';
      }
      // 途中入力がすでに確定形なら、その単位を確定して同じ文字を次の単位で試す
      if (cands.includes(this.buf)) { this.idx++; this.buf = ''; continue; }
      return 'miss';
    }
    return 'miss';
  }

  /** 未入力ぶんのローマ字（最短経路で表示） */
  remaining() {
    let out = '';
    if (!this.done) {
      const cur = this.units[this.idx].cands.filter((c) => c.startsWith(this.buf));
      out += shortest(cur).slice(this.buf.length);
    }
    for (let i = this.idx + 1; i < this.units.length; i++) out += shortest(this.units[i].cands);
    return out;
  }

  typed() { return this.log; }

  /** 最短経路でのローマ字全長（スコア計算用） */
  static length(kana) {
    return parseKana(kana).reduce((n, u) => n + shortest(u.cands).length, 0);
  }
}

/**
 * ラテン文字をそのまま打つ言語（英語・スペイン語など）用。
 * Matcher と同じインターフェースを持たせ、ゲーム側が言語を意識しないようにする。
 */
export class PlainMatcher {
  constructor(word) {
    this.word = word.toLowerCase();
    this.i = 0;
    this.log = '';
    // 日本語側の Matcher と同じ形にしておく（1 文字 = 1 単位）。
    // 打鍵統計が言語を意識せずに済む
    this.units = [...this.word].map((c) => ({ kana: c, cands: [c] }));
  }

  get idx() { return this.i; }
  get done() { return this.i >= this.word.length; }
  get progress() { return this.word.length ? this.i / this.word.length : 1; }

  input(ch) {
    if (this.done) return 'miss';
    if (this.word[this.i] !== ch.toLowerCase()) return 'miss';
    this.i++;
    this.log += this.word[this.i - 1];
    return this.done ? 'done' : 'hit';
  }

  remaining() { return this.word.slice(this.i); }
  typed() { return this.log; }
}

/** 語彙エントリ（かな読みがあれば日本語、なければラテン文字）から打鍵状態機械を作る */
export function makeMatcher(entry) {
  return entry.k ? new Matcher(entry.k) : new PlainMatcher(entry.w);
}

/** 打鍵数（スコアと難易度調整に使う共通尺度） */
export function keystrokes(entry) {
  return entry.k ? Matcher.length(entry.k) : entry.w.length;
}
