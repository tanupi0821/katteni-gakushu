import { makeMatcher, keystrokes } from './romaji.js';
import { CHAPTERS, WAVES_PER_CHAPTER, isBossWave } from './words.js';
import { STRINGS } from './i18n.js';
import { Sfx, vol } from './audio.js';
import { byId, offerable, take } from './upgrades.js';
import { RunStats, commit, analyze } from './stats.js';
import { makeEntry, submit as submitScore, top as boardTop, getName, setName, detectBackend, isOnline } from './leaderboard.js';

const W = 960;
const H = 540;
const CORE_X = 96;
const HIT_X = 150;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

// 描画は常に 960x540 の論理座標で行い、実際のバッファだけ表示サイズ×DPR に合わせる。
// 文字がゲームの本体なので、拡大でぼやけると致命的。
let SC = 1;
function fit() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const px = Math.max(W, Math.round((cv.getBoundingClientRect().width || W) * dpr));
  cv.width = px;
  cv.height = Math.round((px * H) / W);
  SC = cv.width / W;
}
fit();
addEventListener('resize', fit);
addEventListener('load', fit);

// サーバーが居ればオンラインランキングに切り替える（静的配信のままでも動く）
detectBackend();

// BIZ UDP は可読性のために作られた UD フォント。読みと漢字が均等に見える。
// 等幅は Cascadia Mono（Code ではない）。Code の合字はタイピングゲームでは害になる。
// どちらも無い環境のために従来のフォントを後段に残してある。
const JP = "'BIZ UDPGothic','Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif";
const MONO = "'Cascadia Mono','Consolas','SF Mono','Courier New',monospace";

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 章ごとの語彙。打鍵数は前計算しておく（難易度の共通尺度）
const DECKS = CHAPTERS.map((c) => ({
  name: c.name,
  hue: c.hue,
  shape: c.shape,
  motif: c.motif,
  ja: c.ja.map((e) => ({ ...e, n: keystrokes(e) })),
  en: c.en.map((w) => ({ w, n: w.length })),
}));

const chapterIndex = (wave) => (Math.ceil(wave / WAVES_PER_CHAPTER) - 1) % DECKS.length;
const chapter = () => DECKS[chapterIndex(s.wave)];

let lang = localStorage.getItem('kd.lang') ?? (navigator.language?.startsWith('ja') ? 'ja' : 'en');
const T = () => STRINGS[lang];
// スコア計算を変えたら v を上げる。旧仕様のハイスコアが残ると比較にならない
const bestKey = () => `kd.best.v2.${lang}`;
const getBest = () => Number(localStorage.getItem(bestKey()) ?? 0);

// 強化カードは src/upgrades.js（node からテストできるように分離してある）

// ---------------------------------------------------------------- 状態
let s;

function newGame() {
  s = {
    phase: 'title',        // title | play | upgrade | over
    t: 0,
    wave: 1,
    hp: 5,
    maxHp: 5,
    score: 0,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    miss: 0,
    startedAt: 0,
    playMs: 0,
    record: false,
    enemies: [],
    target: null,
    buf: '',       // 打鍵バッファ。これで始まる敵が候補になる
    recent: [],    // 直近に出した語。連続で同じ語が出ないようにする
    spawnLeft: 0,
    spawnTimer: 0,
    particles: [],
    ambient: [],   // タイトル画面の背後を流れる語（装飾専用）
    titleT: 0,     // タイトルの登場演出の経過時間
    banner: 0,
    shake: 0,
    flash: 0,
    flashColor: '#f45',
    cards: [],
    taken: {},     // 強化ごとの取得数。重ねがけの状態はここが唯一の情報源
    stats: new RunStats(),
    unitAt: 0,     // いま打っている単位を打ち始めた時刻
    report: null,  // ゲームオーバー時に出す弱点分析
    rank: 0,       // 今回の順位（0 は圏外）
    board: null,   // ランキング表示用
    mods: { speed: 1, comboKeep: 0, lenBias: 0, blast: 0, scoreMul: 1, shield: 0 },
  };
}
newGame();

function startWave() {
  const boss = isBossWave(s.wave);
  s.phase = 'play';
  // 1ウェーブは短く、代わりに密度で締め上げる（上級者のランが長引きすぎないように）
  // ボス戦は雑魚を減らしてボスに集中させる
  s.spawnLeft = boss ? Math.round(3 + s.wave * 0.4) : Math.round(6 + s.wave * 1.2);
  s.spawnTimer = boss ? 1.6 : 0.4;
  s.buf = '';
  if (!s.startedAt) s.startedAt = performance.now();
  if (boss) spawnBoss();
  // 章の変わり目にだけタイトルを出す
  if ((s.wave - 1) % WAVES_PER_CHAPTER === 0) s.banner = 2.4;
  Sfx.startMusic(s.wave, chapterIndex(s.wave));
}

function wordForWave(bias = 0) {
  // wave1〜2 は短い語だけにして、操作を覚える余地を作る
  const lo = clamp(3 + Math.floor(s.wave * 0.85) + s.mods.lenBias + bias, 3, 11);
  const hi = clamp(lo + 4, 5, 16);
  const deck = chapter()[lang];
  const pool = deck.filter((e) => e.n >= lo && e.n <= hi);
  const base = pool.length ? pool : deck;

  // 画面に出ている語と、直近に出した語を避ける。
  // 同じ語が並ぶとどちらを打っているのか分からなくなるし、すぐ出直すと飽きる。
  const onScreen = new Set(s.enemies.filter((e) => !e.dead).map((e) => e.word.w));
  const recent = new Set(s.recent);
  const fresh = base.filter((e) => !onScreen.has(e.w) && !recent.has(e.w));
  const loose = base.filter((e) => !onScreen.has(e.w));
  const chosen = pick(fresh.length ? fresh : loose.length ? loose : base);

  // 履歴はプールぎりぎりまで長く持つ。短いと体感でループが見えてしまう。
  // 全部が履歴に入っても loose へフォールバックするので詰まらない。
  s.recent.push(chosen.w);
  // プールが小さい章・ウェーブでは履歴もそれに合わせて縮める。
  // 履歴がプールを超えると全部が「最近出た」になり、重複回避が丸ごと効かなくなる。
  const keep = Math.min(20, Math.max(3, base.length - 3));
  while (s.recent.length > keep) s.recent.shift();
  return chosen;
}

function spawn() {
  const e = wordForWave();
  // wave1 は画面横断に約 24 秒かけて、読んでから打つ余裕を作る。
  // 序盤で「速すぎて何もできない」と感じさせると、そこで終わってしまう。
  const speed = (36 + s.wave * 6.2 + rand(-3, 7)) * s.mods.speed;
  s.enemies.push({
    x: W + 150, // 語句ごと画面外から滑り込ませる（文字が端で切れないように）
    y: rand(96, H - 84),
    vy: rand(-6, 6),
    speed,
    word: e,
    m: makeMatcher(e),
    hue: chapter().hue + rand(-25, 25),
    shape: chapter().shape,
  });
}

function spawnBoss() {
  const hp = 3 + chapterIndex(s.wave);
  const e = wordForWave(2); // ボスは一段長い語を出す
  s.enemies.push({
    boss: true,
    hp,
    maxHp: hp,
    x: W + 180,
    y: H / 2,
    vy: 0,
    speed: (26 + s.wave * 1.6) * s.mods.speed,
    word: e,
    m: makeMatcher(e),
    hue: chapter().hue + 180,
    shape: chapter().shape,
  });
}

// ---------------------------------------------------------------- 演出
function burst(x, y, hue, n = 18, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = rand(60, 320) * power;
    s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.75), max: 0.75, hue });
  }
}

// ---------------------------------------------------------------- 入力
let volRow = 0;      // ポーズ画面で選択中の音量行
let preMute = null;  // ミュート前の全体音量

function toggleMute() {
  if (preMute === null) { preMute = vol.master || 0.7; Sfx.setVolume('master', 0); }
  else { Sfx.setVolume('master', preMute); preMute = null; }
}

// 記事ページに埋め込むと、スクロールしようとしただけでゲームが動いてしまう。
// クリックで «操作中» にしたときだけキーを受け取る。単体の index.html では既定で操作中。
let focused = true;
export function setFocused(v) { focused = !!v; }

addEventListener('keydown', (e) => {
  if (!focused) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
  Sfx.unlock(); // 自動再生制限はユーザー操作の中でしか解除できない
  // タイトルでは静かな版（パッドとアルペジオだけ）を流す
  if (s.phase === 'title') Sfx.startMusic(1, 0, 'title');

  if (s.phase === 'pause') {
    const kinds = ['master', 'sfx', 'music'];
    if (k === 'ArrowUp') volRow = (volRow + 2) % 3;
    else if (k === 'ArrowDown') volRow = (volRow + 1) % 3;
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const d = k === 'ArrowRight' ? 0.1 : -0.1;
      Sfx.setVolume(kinds[volRow], Math.round((vol[kinds[volRow]] + d) * 10) / 10);
      if (kinds[volRow] === 'master') preMute = null;
      Sfx.card();
    } else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'Escape') {
      if (s.pauseFrom === 'title') { s.phase = 'title'; }
      else { s.phase = 'play'; Sfx.startMusic(s.wave, chapterIndex(s.wave)); }
    } else if (k === 'q' || k === 'Q') { flushStats(); Sfx.stopMusic(); newGame(); }
    return;
  }

  if (s.phase === 'board') {
    // 名前の編集中は文字キーを名前へ回す
    if (s.editName) {
      if (k === 'Enter' || k === 'Escape') { s.editName = false; }
      else if (k === 'Backspace') { setName(getName().slice(0, -1)); }
      else if (k.length === 1 && /[\w\-.]/.test(k)) { setName(getName() + k); }
      return;
    }
    if (k === 'Escape' || k === 'l' || k === 'L') { s.phase = 'title'; }
    else if (k === 'n' || k === 'N' || k === 'Enter') { s.editName = true; }
    return;
  }

  if (s.phase === 'title') {
    if (k === '1' || k === '2') {
      lang = k === '1' ? 'en' : 'ja';
      localStorage.setItem('kd.lang', lang);
      boardTop(10, lang).then((list) => { s.board = list; });
    }
    if (k === 'm' || k === 'M') toggleMute();
    if (k === 'l' || k === 'L') {
      s.phase = 'board';
      boardTop(10, lang).then((list) => { s.board = list; });
    }
    if (k === 'Escape') { s.pauseFrom = 'title'; s.phase = 'pause'; }
    if (k === 'Enter' || k === ' ') { newGame(); startWave(); }
    return;
  }
  if (s.phase === 'over') {
    if (k === 'm' || k === 'M') toggleMute();
    if (k === 'Enter' || k === ' ') { newGame(); startWave(); }
    return;
  }
  if (s.phase === 'upgrade') {
    const i = '123'.indexOf(k);
    if (i >= 0 && s.cards[i]) { take(s, s.cards[i].id); s.wave++; Sfx.card(); startWave(); }
    return;
  }
  if (s.phase !== 'play') return;
  if (k === 'Escape') { s.pauseFrom = 'play'; s.phase = 'pause'; Sfx.stopMusic(); return; }
  if (k.length !== 1 || !/[a-z0-9\-,.'’]/i.test(k)) return;

  typeChar(k.toLowerCase());
});

/** 語を頭から str のぶんだけ打てるか。打てるなら、その状態の状態機械を返す */
function feed(word, str) {
  const m = makeMatcher(word);
  for (const c of str) if (m.input(c) === 'miss') return null;
  return m;
}

function typeChar(ch) {
  const alive = s.enemies.filter((e) => !e.dead);

  // 打ちかけの語が画面から消えていたら、打鍵バッファを捨てる（打てなくなるのを防ぐ）
  if (s.buf && !alive.some((e) => feed(e.word, s.buf))) s.buf = '';

  // 1 体に決め打ちせず、「打った文字列で始まる敵」を全部候補として持つ。
  // 同じ文字で始まる語が並んでいても、打ち進めるうちに勝手に絞り込まれる。
  const next = s.buf + ch;
  const hits = [];
  for (const e of alive) {
    const m = feed(e.word, next);
    if (m) hits.push({ e, m });
  }
  if (!hits.length) return onMiss();

  // 打鍵の記録。単位（かな 1 つ / 英字 1 文字）を打ち切った瞬間に、
  // その単位にかかった時間と打鍵数を積む。
  {
    const now = performance.now();
    if (!s.unitAt) s.unitAt = now;
    const lead = hits.slice().sort((a, b) => a.e.x - b.e.x)[0];
    const before = s.target && s.target.m ? s.target.m.idx : 0;
    const after = lead.m.idx;
    // 同じ語を打ち進めていて、単位が確定した場合だけ数える
    if (s.target === lead.e && after > before) {
      const u = lead.m.units[before];
      const keys = Math.max(1, lead.m.typed().length - (s.unitKeys ?? 0));
      s.stats.unit(u.kana, keys, now - s.unitAt);
      s.unitKeys = lead.m.typed().length;
      s.unitAt = now;
    } else if (s.target !== lead.e) {
      // 対象が変わったら計測をやり直す（別の語の時間を混ぜない）
      s.unitAt = now;
      s.unitKeys = lead.m.typed().length;
    }
  }

  s.buf = next;
  // 候補から外れた敵だけ打鍵表示を消す（全部作り直すと打鍵ごとに無駄が出る）
  const hitSet = new Set(hits.map((h) => h.e));
  for (const e of alive) if (!hitSet.has(e) && e.m.typed().length) e.m = makeMatcher(e.word);
  for (const h of hits) h.e.m = h.m;

  hits.sort((a, b) => a.e.x - b.e.x);
  s.target = hits[0].e; // コアに近い候補を主対象（リングを濃く出す）にする

  s.correct++;
  s.combo++;
  s.bestCombo = Math.max(s.bestCombo, s.combo);
  s.shake = Math.max(s.shake, 2);
  Sfx.hit(s.combo);
  burst(s.target.x, s.target.y, s.target.hue, 3, 0.35);

  const finished = hits.find((h) => h.m.done);
  if (finished) { kill(finished.e); s.buf = ''; }
}

function onMiss() {
  s.miss++;
  // ミスは「いま打っている単位」に紐づける。どのかなで指が迷ったかが知りたい
  if (s.target && s.target.m && !s.target.m.done) {
    s.stats.missOn(s.target.m.units[s.target.m.idx]?.kana);
  }
  Sfx.miss();
  s.combo = Math.floor(s.combo * s.mods.comboKeep);
  s.flash = 0.25;
  s.flashColor = '#f4455a';
  s.shake = Math.max(s.shake, 7);
}

function kill(e) {
  const mul = 1 + Math.min(s.combo, 150) * 0.02; // 上限 4 倍。青天井だとスコアが桁で壊れる
  s.score += Math.round(e.word.n * 10 * mul * s.mods.scoreMul);
  Sfx.kill(e.word.n);
  s.target = null;

  // ボスは 1 語打ち切るごとに 1 ダメージ。押し戻して次の語を出す
  if (e.boss && --e.hp > 0) {
    e.x = Math.min(W - 140, e.x + 170);
    e.word = wordForWave(2);
    e.m = makeMatcher(e.word);
    burst(e.x, e.y, e.hue, 26, 1.2);
    s.shake = Math.max(s.shake, 14);
    return;
  }

  e.dead = true;
  burst(e.x, e.y, e.hue, e.boss ? 70 : 34, e.boss ? 2.2 : 1.4);
  s.shake = Math.max(s.shake, e.boss ? 26 : 12);
  if (e.boss) { s.flash = 0.3; s.flashColor = '#ffe36e'; Sfx.waveClear(); }

  if (s.mods.blast) {
    const near = s.enemies.filter((o) => !o.dead).sort((a, b) => a.x - b.x)[0];
    if (near) { near.x += s.mods.blast; burst(near.x, near.y, 40, 10, 0.6); }
  }
}

function damage(e) {
  // ボスは消えずに押し戻されるだけ（延々と殴られ続けないための猶予）
  if (e.boss) { e.x = W - 240; if (e === s.target) s.target = null; }
  else e.dead = true;

  if (s.mods.shield > 0) {
    s.mods.shield--;
    s.flash = 0.3;
    s.flashColor = '#5cf';
    Sfx.shield();
    burst(CORE_X, H / 2, 200, 26, 1.1);
    return;
  }
  Sfx.damage();
  s.hp--;
  s.combo = 0;
  s.buf = '';
  s.flash = 0.45;
  s.flashColor = '#f4455a';
  s.shake = 22;
  burst(CORE_X, H / 2, 0, 30, 1.3);
  if (s.hp <= 0) gameOver();
}

/**
 * 打鍵の記録を通算へ流し込む。ウェーブの切れ目でも呼ぶので、
 * 途中でやめても、そこまでの打鍵は残る。
 */
function flushStats(summary = null) {
  commit(lang, s.stats, summary);
  s.stats = new RunStats();
}

function gameOver() {
  s.phase = 'over';
  s.playMs = performance.now() - s.startedAt;
  // 記録を確定して弱点を出す。ここが「ゲーム」と「トレーナー」の分かれ目
  flushStats({ score: s.score, wave: s.wave, kpm: kpmNow(), acc: accuracy() });
  s.report = analyze(lang);

  const entry = makeEntry({
    score: s.score, wave: s.wave, kpm: kpmNow(), acc: accuracy(),
    keys: s.correct, misses: s.miss, ms: s.playMs, lang,
  });
  submitScore(entry).then((rank) => { s.rank = rank; });
  boardTop(10, lang).then((list) => { s.board = list; });
  Sfx.stopMusic();
  Sfx.gameOver();
  if (s.score > getBest()) {
    localStorage.setItem(bestKey(), String(s.score));
    s.record = true;
  }
}

// ---------------------------------------------------------------- 更新
function update(dt) {
  s.t += dt;
  s.shake *= Math.pow(0.0015, dt);
  s.flash = Math.max(0, s.flash - dt);
  if (s.phase === 'play') s.banner = Math.max(0, s.banner - dt);

  // タイトル画面の背後でも語を流しておく。静止画のメニューは安く見える
  if (s.phase === 'title') {
    const first = s.titleT === 0;
    s.titleT += dt;
    // 流すのは上の帯だけ。下半分はメニューの場所なので空けておく。
    // 初回は画面全体にばらまく（右端から湧いてくるのを待つと最初の数十秒が寂しい）
    const add = (x) => {
      const e = pick(DECKS[0][lang]);
      // 近くに既に居る高さは避ける。語が重なると読めず、雑に見える
      let y = rand(48, 138);
      for (let k = 0; k < 8; k++) {
        const clash = s.ambient.some((o) => Math.abs(o.x - x) < 240 && Math.abs(o.y - y) < 46);
        if (!clash) break;
        y = rand(48, 138);
      }
      s.ambient.push({
        x,
        y,
        speed: rand(22, 42),
        word: e,
        m: makeMatcher(e),
        hue: DECKS[0].hue + rand(-30, 30),
      });
    };
    if (first) for (let i = 0; i < 5; i++) add(rand(-60, W + 120));
    else if (s.ambient.length < 5 && Math.random() < dt * 1.6) add(W + 200);
    for (const a of s.ambient) a.x -= a.speed * dt;
    s.ambient = s.ambient.filter((a) => a.x > -240);
  }

  for (const p of s.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.02, dt); p.vy *= Math.pow(0.02, dt);
    p.life -= dt;
  }
  s.particles = s.particles.filter((p) => p.life > 0);

  if (s.phase !== 'play') return;

  if (s.spawnLeft > 0) {
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      spawn();
      s.spawnLeft--;
      // 序盤の湧き間隔を広く取る。wave1 で必要な打鍵速度が 160KPM 近くあり、
      // 初心者（100KPM 前後）が 1 面から詰むのを避ける
      s.spawnTimer = clamp(3.3 - s.wave * 0.2, 0.35, 3.3) * rand(0.85, 1.2);
    }
  }

  for (const e of s.enemies) {
    // 同じフレームで 2 体がコアに触れると、ゲームオーバー後も被弾が続いて hp が負になる
    if (s.phase !== 'play') break;
    if (e.dead) continue;
    e.x -= e.speed * dt;
    e.y += e.vy * dt;
    if (e.y < 90 || e.y > H - 78) e.vy *= -1;
    if (e.x <= HIT_X) damage(e);
  }
  s.enemies = s.enemies.filter((e) => !e.dead);
  if (s.target && s.target.dead) s.target = null;

  if (s.phase === 'play' && s.spawnLeft === 0 && s.enemies.length === 0) {
    s.phase = 'upgrade';
    // 上限に達したカードは出さない。取っても何も起きないカードを引かせない
    s.cards = offerable(s.taken).sort(() => Math.random() - 0.5).slice(0, 3);
    flushStats(); // ウェーブの切れ目で打鍵を保存（途中でやめても消えないように）
    Sfx.waveClear();
  }
}

// ---------------------------------------------------------------- 描画
// 奥行きを作るための星。手前ほど速く流れる
const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  z: 0.25 + Math.random() * 0.9, // 手前ほど大きい
}));

function bg() {
  // 章ごとに背景の色味を変える。ゲームの中身は同じでも「進んだ」感じが出る
  const hue = chapter().hue;
  const g = ctx.createLinearGradient(W, 0, 0, H);
  g.addColorStop(0, `hsl(${hue + 14} 40% 11%)`);
  g.addColorStop(0.55, `hsl(${hue} 45% 6%)`);
  g.addColorStop(1, `hsl(${hue - 10} 50% 4%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 星流
  ctx.globalCompositeOperation = 'lighter';
  for (const st of STARS) {
    st.x -= st.z * 11 * (1 / 60);
    if (st.x < -4) { st.x = W + 4; st.y = Math.random() * H; }
    ctx.fillStyle = `hsl(${hue + 30} 70% 80% / ${0.05 + st.z * 0.11})`;
    ctx.fillRect(st.x, st.y, st.z * 2.2, st.z * 2.2);
  }
  ctx.globalCompositeOperation = 'source-over';

  // 方眼。奥に行くほど薄くして平面感を消す
  const gl = ctx.createLinearGradient(0, 0, W, 0);
  gl.addColorStop(0, `hsl(${hue} 80% 70% / 0.02)`);
  gl.addColorStop(1, `hsl(${hue} 80% 70% / 0.075)`);
  ctx.strokeStyle = gl;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < W; x += 48) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
  for (let y = 0; y < H; y += 48) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();

  motifLayer(hue);

  // 防衛ライン。流れる破線にして「越えさせてはいけない線」だと分かるように
  const off = (s.t * 26) % 22;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,80,110,0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 17]);
  ctx.lineDashOffset = -off;
  ctx.beginPath(); ctx.moveTo(HIT_X, 40); ctx.lineTo(HIT_X, H - 30); ctx.stroke();
  ctx.setLineDash([]);
  const warn = ctx.createLinearGradient(HIT_X - 60, 0, HIT_X, 0);
  warn.addColorStop(0, 'rgba(255,60,90,0)');
  warn.addColorStop(1, 'rgba(255,60,90,0.10)');
  ctx.fillStyle = warn;
  ctx.fillRect(HIT_X - 60, 0, 60, H);
  ctx.restore();
}

/** 画面全体の締め。周辺減光と上下のレターボックス感 */
function vignette() {
  const g = ctx.createRadialGradient(W * 0.45, H * 0.5, H * 0.42, W * 0.45, H * 0.5, H * 1.1);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * 章ごとの敵の形。色相だけ変えても「進んだ」感じは出ないので、輪郭から変える。
 * 原点に描くので、呼ぶ側で translate / rotate してから使う。
 */
function enemyShape(kind, r) {
  ctx.beginPath();
  switch (kind) {
    case 'gear': { // 機械都市: 歯車。小さく表示されるので歯は深く取る
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.62;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    }
    case 'tri': { // 観測所: 三角
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
      }
      ctx.closePath();
      break;
    }
    case 'spike': { // 呪詛: 四方に伸びる棘
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 1.35 : r * 0.5;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    }
    case 'ring': // 記憶: 丸
      ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
      break;
    case 'leaf': // 野生: 角を丸めた菱形
    default:
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.75, -r * 0.75, r, 0);
      ctx.quadraticCurveTo(r * 0.75, r * 0.75, 0, r);
      ctx.quadraticCurveTo(-r * 0.75, r * 0.75, -r, 0);
      ctx.quadraticCurveTo(-r * 0.75, -r * 0.75, 0, -r);
      ctx.closePath();
  }
}

/** 章ごとの背景の意匠。方眼のうえに 1 枚だけ重ねる */
function motifLayer(hue) {
  const m = chapter().motif;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (m === 'pollen') {
    // 花粉。ゆっくり漂う細かい点
    for (let i = 0; i < 26; i++) {
      const x = ((i * 137.5 + s.t * (8 + (i % 5) * 4)) % (W + 40)) - 20;
      const y = (i * 61.3 + Math.sin(s.t * 0.6 + i) * 22) % H;
      ctx.fillStyle = `hsl(${hue + 20} 80% 78% / 0.10)`;
      ctx.beginPath();
      ctx.arc(W - x, y, 1.6 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (m === 'scan') {
    // 走査線。上から下へゆっくり流れる横線
    for (let i = 0; i < 3; i++) {
      const y = ((s.t * (26 + i * 13) + i * 200) % (H + 120)) - 60;
      const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
      g.addColorStop(0, 'transparent');
      g.addColorStop(0.5, `hsl(${hue} 90% 70% / 0.07)`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 22, W, 44);
    }
  } else if (m === 'constellation') {
    // 星座。固定点を線で結ぶ
    const pts = [[120, 90], [260, 160], [400, 70], [520, 190], [700, 110], [840, 210], [300, 420], [560, 470], [760, 400]];
    ctx.strokeStyle = `hsl(${hue + 20} 85% 78% / 0.10)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < pts.length - 1; i++) { ctx.moveTo(...pts[i]); ctx.lineTo(...pts[i + 1]); }
    ctx.stroke();
    for (let i = 0; i < pts.length; i++) {
      const tw = 0.5 + Math.sin(s.t * 1.6 + i * 1.7) * 0.5;
      ctx.fillStyle = `hsl(${hue + 25} 90% 85% / ${0.10 + tw * 0.22})`;
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], 1.8 + tw * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (m === 'embers') {
    // 火の粉。下から上へ立ちのぼる
    for (let i = 0; i < 22; i++) {
      const y = H - ((s.t * (22 + (i % 4) * 12) + i * 90) % (H + 60));
      const x = (i * 173.7 % W) + Math.sin(s.t * 0.9 + i) * 14;
      ctx.fillStyle = `hsl(${hue + 15} 95% 66% / 0.16)`;
      ctx.fillRect(x, y, 2, 3.5);
    }
  } else if (m === 'bokeh') {
    // 玉ボケ。大きく柔らかい光
    for (let i = 0; i < 7; i++) {
      const x = ((i * 241 + s.t * (6 + i)) % (W + 200)) - 100;
      const y = (i * 97) % H;
      const r = 26 + (i % 4) * 16;
      const g = ctx.createRadialGradient(W - x, y, 1, W - x, y, r);
      g.addColorStop(0, `hsl(${hue + 10} 85% 70% / 0.075)`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(W - x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

function polygon(cx, cy, r, sides, rot) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rot;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawCore() {
  const cy = H / 2;
  const hurt = clamp(1 - s.hp / Math.max(1, s.maxHp), 0, 1); // 減るほど赤く不安定に
  const pulse = 1 + Math.sin(s.t * (2.4 + hurt * 4)) * (0.05 + hurt * 0.05);
  const r = 32 * pulse;
  const hue = 196 - hurt * 190;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const grd = ctx.createRadialGradient(CORE_X, cy, 2, CORE_X, cy, r * 3.6);
  grd.addColorStop(0, `hsl(${hue} 95% 70% / 0.55)`);
  grd.addColorStop(0.35, `hsl(${hue} 95% 60% / 0.18)`);
  grd.addColorStop(1, 'transparent');
  ctx.fillStyle = grd;
  ctx.fillRect(CORE_X - r * 3.6, cy - r * 3.6, r * 7.2, r * 7.2);

  // 三重のリングを別々の速度で回す
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = `hsl(${hue} 90% 72% / 0.95)`;
  polygon(CORE_X, cy, r, 6, s.t * 0.55);
  ctx.stroke();

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `hsl(${hue + 12} 90% 76% / 0.45)`;
  polygon(CORE_X, cy, r * 1.3, 6, -s.t * 0.33 + Math.PI / 6);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = `hsl(${hue} 90% 80% / 0.28)`;
  ctx.setLineDash([3, 9]);
  ctx.beginPath();
  ctx.arc(CORE_X, cy, r * 1.95, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = `hsl(${hue} 100% 88% / ${0.5 + Math.sin(s.t * 3) * 0.18})`;
  polygon(CORE_X, cy, r * 0.28, 6, -s.t * 0.9);
  ctx.fill();

  for (let i = 0; i < s.mods.shield; i++) {
    ctx.strokeStyle = 'rgba(140,225,255,0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(CORE_X, cy, r * 2.3 + i * 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEnemy(e) {
  const typed = e.m.typed();
  const rest = e.m.remaining();
  const lit = typed.length > 0;        // 打鍵候補（複数同時にありうる）
  const lead = lit && e === s.target;  // そのうちコアに一番近いもの
  const r = e.boss ? 34 : 15;
  const near = clamp(1 - (e.x - HIT_X) / 420, 0, 1); // コアに近いほど危険色を混ぜる
  const hue = e.hue - near * 40;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 軌跡。進行方向の後ろに尾を引かせると、止まって見えなくなる
  const tail = ctx.createLinearGradient(e.x, 0, e.x + 90 + e.speed * 0.5, 0);
  tail.addColorStop(0, `hsl(${hue} 80% 60% / ${lit ? 0.3 : 0.16})`);
  tail.addColorStop(1, 'transparent');
  ctx.fillStyle = tail;
  ctx.fillRect(e.x, e.y - r * 0.32, 90 + e.speed * 0.5, r * 0.64);

  const glow = ctx.createRadialGradient(e.x, e.y, 1, e.x, e.y, r * (e.boss ? 3.4 : 2.6));
  glow.addColorStop(0, `hsl(${hue} 90% 65% / ${lit ? 0.5 : 0.26})`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(e.x - r * 3.4, e.y - r * 3.4, r * 6.8, r * 6.8);
  ctx.restore();

  ctx.save();
  ctx.translate(e.x, e.y);
  if (lit) {
    // 候補は全部印を出す。打ち進めるほど候補が減っていくのが見える。
    // 主対象だけは四隅のブラケット＝照準にして、他と役割を分ける
    const rr = r + 11 + Math.sin(s.t * 9) * 2;
    ctx.strokeStyle = lead ? 'rgba(255,227,110,0.95)' : 'rgba(255,227,110,0.35)';
    ctx.lineWidth = lead ? 2.2 : 1.2;
    if (lead) {
      const c = rr * 0.55;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(sx * rr, sy * rr - sy * c);
        ctx.lineTo(sx * rr, sy * rr);
        ctx.lineTo(sx * rr - sx * c, sy * rr);
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.rotate(Math.PI / 4 + s.t * (e.boss ? 0.35 : 0.8));
  ctx.fillStyle = `hsl(${hue} 72% ${lit ? 64 : 46}%)`;
  enemyShape(e.shape, r);
  ctx.fill();
  ctx.strokeStyle = `hsl(${hue} 90% 82% / ${lit ? 0.9 : 0.45})`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  if (e.boss) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    enemyShape(e.shape, r * 0.5);
    ctx.stroke();
  }
  ctx.restore();

  if (e.boss) {
    // 体力ピップ（残り何語打てばいいかがそのまま見える）
    const pw = 16;
    const x0 = e.x - (e.maxHp * pw) / 2;
    for (let i = 0; i < e.maxHp; i++) {
      ctx.fillStyle = i < e.hp ? `hsl(${hue} 90% 68%)` : 'rgba(255,255,255,0.13)';
      ctx.fillRect(x0 + i * pw, e.y - r - 26, pw - 4, 6);
    }
  }

  ctx.textAlign = 'center';
  const top = e.boss ? e.y - r - 44 : e.y - 34;
  if (e.word.k) {
    // 日本語: 表記と読みを上に出す（読みが打鍵のヒントになる）
    ctx.font = `600 ${e.boss ? 26 : 20}px ${JP}`;
    ctx.fillStyle = lit ? '#fff' : 'rgba(224,234,255,0.72)';
    ctx.fillText(e.word.w, e.x, top);
    ctx.font = `12px ${JP}`;
    ctx.fillStyle = `rgba(150,175,215,${lit ? 0.9 : 0.55})`;
    ctx.fillText(e.word.k, e.x, top - 21);
  }

  // 打鍵列（打った分 / 残り）。ゲームの主役なので、候補は光らせる
  const big = e.boss
    ? (lit ? '700 26px' : '600 22px')
    : e.word.k ? (lit ? '700 19px' : '15px') : (lit ? '700 24px' : '600 19px');
  ctx.font = `${big} ${MONO}`;
  const wt = ctx.measureText(typed).width;
  const wr = ctx.measureText(rest).width;
  const x0 = e.x - (wt + wr) / 2;
  const y0 = e.boss ? e.y + r + 32 : e.word.k ? e.y + 40 : e.y + 44;
  ctx.textAlign = 'left';
  if (lit) { ctx.shadowColor = 'rgba(255,205,60,0.85)'; ctx.shadowBlur = 14; }
  ctx.fillStyle = '#ffe36e';
  ctx.fillText(typed, x0, y0);
  ctx.shadowBlur = 0;
  ctx.fillStyle = lit ? 'rgba(240,248,255,0.98)' : 'rgba(196,212,240,0.42)';
  ctx.fillText(rest, x0 + wt, y0);

  // 進捗バー。あと何文字かが線の長さで分かる
  if (lit) {
    const total = wt + wr;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x0, y0 + 7, total, 2);
    ctx.fillStyle = '#ffe36e';
    ctx.fillRect(x0, y0 + 7, wt, 2);
  }
  ctx.textAlign = 'center';
}

function drawHud() {
  const t = T();
  ctx.textAlign = 'left';
  ctx.font = `600 15px ${JP}`;
  ctx.fillStyle = 'rgba(200,220,255,0.55)';
  ctx.fillText(`${t.wave} ${s.wave}`, 24, 42);
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = `hsl(${chapter().hue} 70% 70% / 0.6)`;
  // 日本語名は字間を空けてあるので HUD では詰める（英語名の語間は残す）
  const cname = lang === 'ja' ? chapter().name.ja.replace(/\s/g, '') : chapter().name.en;
  ctx.fillText(`CH.${chapterIndex(s.wave) + 1}  ${cname}`, 24, 22);

  ctx.font = `700 26px ${MONO}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText(String(s.score).padStart(6, '0'), 24, 72);

  for (let i = 0; i < s.maxHp; i++) {
    ctx.fillStyle = i < s.hp ? '#ff5f7e' : 'rgba(255,95,126,0.18)';
    ctx.fillRect(24 + i * 18, 86, 12, 12);
  }

  const best = getBest();
  if (best) {
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = 'rgba(170,195,235,0.5)';
    ctx.fillText(`${t.best} ${best}`, 24, 120);
  }

  // 取得済みの強化。重ねがけが効いているかを遊びながら確認できるようにする。
  // コアと重ならないよう左下から積み上げる
  const ids = Object.keys(s.taken);
  if (ids.length) {
    let y = H - 46 - ids.length * 15;
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(150,175,215,0.4)';
    ctx.fillText('UPGRADES', 24, y);
    y += 15;
    for (const id of ids) {
      const n = s.taken[id];
      ctx.textAlign = 'left';
      ctx.font = `11px ${JP}`;
      ctx.fillStyle = 'rgba(215,232,255,0.75)';
      ctx.fillText(`${t.up[id][0]}${n > 1 ? ` ×${n}` : ''}`, 24, y);
      // 値は右揃え。英語名は長さがまちまちで、左揃えだと名前に食い込む
      ctx.textAlign = 'right';
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = 'rgba(255,227,110,0.55)';
      ctx.fillText(byId(id).level(s), 208, y);
      ctx.textAlign = 'left';
      y += 15;
    }
  }

  if (s.combo > 1) {
    const pop = 1 + clamp((s.combo % 10) / 60, 0, 0.2);
    ctx.textAlign = 'right';
    ctx.save();
    ctx.translate(W - 24, 60);
    ctx.scale(pop, pop);
    ctx.font = `800 34px ${MONO}`;
    ctx.fillStyle = '#ffe36e';
    ctx.fillText(`${s.combo}`, 0, 0);
    ctx.font = `600 13px ${JP}`;
    ctx.fillStyle = 'rgba(255,227,110,0.7)';
    ctx.fillText(t.combo, 0, 18);
    ctx.restore();
  }

  ctx.textAlign = 'right';
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = 'rgba(180,200,235,0.6)';
  ctx.fillText(t.stats(kpmNow(), accuracy()), W - 24, H - 22);
  ctx.textAlign = 'left';
}

function kpmNow() {
  const ms = s.phase === 'over' ? s.playMs : s.startedAt ? performance.now() - s.startedAt : 0;
  return ms > 500 ? Math.round(s.correct / (ms / 60000)) : 0;
}
function accuracy() {
  const total = s.correct + s.miss;
  return total ? Math.round((s.correct / total) * 100) : 100;
}

function panel(x, y, w, h) {
  ctx.fillStyle = 'rgba(12,17,32,0.86)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(130,180,255,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** タイトル背後を流れる語。操作対象ではないので、うんと引いた明度で置く */
function drawAmbient(a) {
  const r = 11;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = 'lighter';
  const tail = ctx.createLinearGradient(a.x, 0, a.x + 80, 0);
  tail.addColorStop(0, `hsl(${a.hue} 80% 60% / 0.14)`);
  tail.addColorStop(1, 'transparent');
  ctx.fillStyle = tail;
  ctx.fillRect(a.x, a.y - r * 0.3, 80, r * 0.6);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.PI / 4 + s.t * 0.5);
  ctx.fillStyle = `hsl(${a.hue} 70% 52%)`;
  enemyShape(DECKS[0].shape, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.textAlign = 'center';
  if (a.word.k) {
    ctx.font = `14px ${JP}`;
    ctx.fillStyle = 'rgba(214,228,250,0.85)';
    ctx.fillText(a.word.w, a.x, a.y - 22);
  }
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = 'rgba(196,214,244,0.8)';
  ctx.fillText(a.m.remaining(), a.x, a.y + 30);
  ctx.restore();
}

/**
 * キーキャップ。キーボードのゲームなので、メニューそのものをキーで作る。
 * ここがこの画面で一番「そのゲームらしい」部分。
 */
function keycap(x, y, w, h, label, on, appear = 1) {
  if (appear <= 0) return;
  ctx.save();
  ctx.globalAlpha = clamp(appear, 0, 1);
  ctx.translate(x, y + (1 - clamp(appear, 0, 1)) * 8);

  // 側面（押し込まれた立体感）
  ctx.fillStyle = on ? 'rgba(120,95,20,0.55)' : 'rgba(18,26,38,0.85)';
  ctx.beginPath();
  ctx.roundRect(0, 3, w, h, 6);
  ctx.fill();

  // 天面
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, on ? 'rgba(255,227,110,0.30)' : 'rgba(150,185,235,0.13)');
  g.addColorStop(1, on ? 'rgba(255,190,60,0.13)' : 'rgba(120,155,205,0.05)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h - 3, 6);
  ctx.fill();
  ctx.strokeStyle = on ? 'rgba(255,227,110,0.9)' : 'rgba(150,185,235,0.32)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(h * 0.42)}px ${MONO}`;
  ctx.fillStyle = on ? '#ffe36e' : 'rgba(196,215,242,0.72)';
  ctx.fillText(label, w / 2, h * 0.66);
  ctx.restore();
}

function drawTitle() {
  const t = T();
  const T0 = s.titleT;
  const step = (at, dur = 0.45) => clamp((T0 - at) / dur, 0, 1);
  const ease = (v) => 1 - Math.pow(1 - v, 3);

  // 背景の語が見える程度の薄い幕。真っ黒で覆うと静止画に見える
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, 'rgba(6,10,20,0.30)');
  scrim.addColorStop(0.30, 'rgba(6,10,20,0.72)');
  scrim.addColorStop(0.72, 'rgba(6,10,20,0.72)');
  scrim.addColorStop(1, 'rgba(6,10,20,0.34)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const titleY = 190;

  // タイトルの背後の光
  const halo = ctx.createRadialGradient(cx, titleY - 18, 10, cx, titleY - 18, 330);
  halo.addColorStop(0, `hsl(200 90% 60% / ${0.20 * step(0, 0.9)})`);
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - 340, titleY - 210, 680, 400);

  // ── タイトルが「打たれて」現れる。このゲームの署名をタイトル自身に使う
  const name = 'KEY DEFENSE';
  const shown = Math.min(name.length, Math.floor(Math.max(0, T0 - 0.25) / 0.075));
  ctx.textAlign = 'left';
  ctx.letterSpacing = '6px';
  ctx.font = `800 66px ${JP}`;
  const full = ctx.measureText(name).width;
  const x0 = cx - full / 2;
  const typed = name.slice(0, shown);
  ctx.shadowColor = 'rgba(120,190,255,0.55)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#f2f8ff';
  ctx.fillText(typed, x0, titleY);
  ctx.shadowBlur = 0;

  // キャレット。打ち終わったあとも数回点滅して消える
  const caretOn = shown < name.length ? true : (T0 < 2.4 ? Math.floor(T0 * 3) % 2 === 0 : false);
  if (caretOn) {
    const cw = ctx.measureText(typed).width;
    ctx.fillStyle = '#ffe36e';
    ctx.fillRect(x0 + cw + 2, titleY - 46, 8, 52);
  }
  ctx.letterSpacing = '0px';

  // 下線が中央から左右に伸びる
  const rule = ease(step(1.15, 0.5));
  if (rule > 0) {
    ctx.fillStyle = 'rgba(255,227,110,0.75)';
    ctx.fillRect(cx - (full / 2) * rule, titleY + 16, full * rule, 2);
  }

  ctx.textAlign = 'center';

  // 日本語タイトル
  const jp = step(1.35);
  if (jp > 0) {
    ctx.save();
    ctx.globalAlpha = jp;
    ctx.letterSpacing = '10px';
    ctx.font = `700 26px ${JP}`;
    ctx.fillStyle = 'rgba(150,200,255,0.92)';
    ctx.fillText('打鍵防衛', cx + 5, titleY + 56);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // 一行の説明。3 行並べると読まれないので 1 行に絞る
  const tag = step(1.6);
  if (tag > 0) {
    ctx.save();
    ctx.globalAlpha = tag;
    ctx.font = `14px ${JP}`;
    ctx.fillStyle = 'rgba(190,210,240,0.72)';
    ctx.fillText(t.how[0], cx, titleY + 96);
    ctx.restore();
  }

  // ── 言語選択（キーキャップ）
  const KH = 40;
  const menuY = 330;
  ctx.font = `600 16px ${JP}`;
  const labels = ['English', '日本語 (romaji)'];
  const widths = labels.map((l) => ctx.measureText(l).width);
  const unit = widths.map((w) => 34 + 12 + w);
  const gap = 46;
  let mx = cx - (unit[0] + gap + unit[1]) / 2;
  [['1', 'en'], ['2', 'ja']].forEach(([key, code], i) => {
    const on = lang === code;
    const ap = step(1.85 + i * 0.12, 0.35);
    keycap(mx, menuY, 34, KH, key, on, ap);
    ctx.save();
    ctx.globalAlpha = clamp(ap, 0, 1);
    ctx.textAlign = 'left';
    ctx.font = `600 16px ${JP}`;
    ctx.fillStyle = on ? '#ffe36e' : 'rgba(170,195,235,0.5)';
    ctx.fillText(labels[i], mx + 46, menuY + KH * 0.66);
    ctx.restore();
    mx += unit[i] + gap;
  });
  ctx.textAlign = 'center';

  // ── 記録
  const best = getBest();
  const bp = step(2.05, 0.4);
  if (best && bp > 0) {
    ctx.save();
    ctx.globalAlpha = bp;
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(150,178,215,0.55)';
    ctx.fillText(t.best, cx, menuY + 78);
    ctx.font = `700 22px ${MONO}`;
    ctx.fillStyle = 'rgba(235,245,255,0.9)';
    ctx.fillText(String(best), cx, menuY + 104);
    ctx.restore();
  }

  // ── 開始
  const sp = step(2.2, 0.4);
  if (sp > 0) {
    const pulse = 0.62 + Math.sin(s.t * 3.4) * 0.32;
    ctx.save();
    ctx.globalAlpha = clamp(sp, 0, 1);
    ctx.font = `600 15px ${JP}`;
    const label = t.start.replace(/^\[[^\]]*\]\s*/, '');
    const lw = ctx.measureText(label).width;
    const kw = 78;
    const sx = cx - (kw + 12 + lw) / 2;
    keycap(sx, 452, kw, 34, 'Enter', true, sp * pulse + 0.3);
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(255,227,110,${pulse})`;
    ctx.fillText(label, sx + kw + 12, 452 + 23);
    ctx.restore();
  }

  // 隅の情報。あると「製品」に見える
  ctx.save();
  ctx.globalAlpha = step(2.4, 0.6) * 0.5;
  ctx.textAlign = 'left';
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(150,178,215,0.9)';
  ctx.fillText('v0.1.0', 22, H - 20);
  ctx.textAlign = 'right';
  ctx.fillText(`${t.boardOpen}    [ Esc ] settings`, W - 22, H - 20);
  ctx.restore();

  ctx.textAlign = 'left';
}

function drawUpgrade() {
  const t = T();
  ctx.fillStyle = 'rgba(8,12,24,0.78)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = `700 30px ${JP}`;
  ctx.fillStyle = '#e9f2ff';
  ctx.fillText(t.cleared(s.wave), W / 2, 118);
  ctx.font = `15px ${JP}`;
  ctx.fillStyle = 'rgba(180,205,245,0.8)';
  ctx.fillText(t.choose, W / 2, 152);

  const cw = 250;
  const gap = 24;
  const x0 = (W - (cw * 3 + gap * 2)) / 2;
  s.cards.forEach((c, i) => {
    const [name, desc] = t.up[c.id];
    const x = x0 + i * (cw + gap);
    const n = s.taken[c.id] ?? 0;
    panel(x, 200, cw, 190);
    ctx.font = `800 30px ${MONO}`;
    ctx.fillStyle = 'rgba(255,227,110,0.9)';
    ctx.fillText(`${i + 1}`, x + cw / 2, 250);
    ctx.font = `700 22px ${JP}`;
    ctx.fillStyle = '#eaf2ff';
    ctx.fillText(name, x + cw / 2, 300);
    ctx.font = `14px ${JP}`;
    ctx.fillStyle = 'rgba(190,210,240,0.85)';
    wrap(desc, x + cw / 2, 336, cw - 36, 20);
    // 既に持っている枚数と上限。重ねがけできているかが選ぶ前に分かる
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = n ? 'rgba(255,227,110,0.85)' : 'rgba(150,175,215,0.45)';
    ctx.fillText(n ? `所持 ${n} / ${c.max}` : `${c.max} まで重ねられる`, x + cw / 2, 378);
  });
  ctx.textAlign = 'left';
}

function wrap(text, cx, y, maxW, lh) {
  // 英語は単語単位、日本語は文字単位で折る
  const parts = /\s/.test(text) ? text.split(' ').map((w, i) => (i ? ' ' + w : w)) : [...text];
  let line = '';
  let yy = y;
  for (const p of parts) {
    if (line && ctx.measureText(line + p).width > maxW) { ctx.fillText(line, cx, yy); line = p.trimStart(); yy += lh; }
    else line += p;
  }
  ctx.fillText(line, cx, yy);
}

function drawBanner() {
  // 出るときも消えるときもフェード（2.4 秒のうち両端 0.4 秒）
  const a = clamp(Math.min(s.banner, 2.4 - s.banner) / 0.4, 0, 1);
  const c = chapter();
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.font = `12px ${MONO}`;
  ctx.fillStyle = `hsl(${c.hue} 75% 72%)`;
  ctx.fillText(`CHAPTER ${chapterIndex(s.wave) + 1}`, W / 2, H / 2 - 34);
  ctx.font = `800 46px ${JP}`;
  ctx.fillStyle = '#f2f7ff';
  ctx.fillText(c.name[lang], W / 2, H / 2 + 14);
  ctx.strokeStyle = `hsl(${c.hue} 75% 65% / 0.5)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 170, H / 2 + 34);
  ctx.lineTo(W / 2 + 170, H / 2 + 34);
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawPause() {
  const t = T();
  ctx.fillStyle = 'rgba(8,12,24,0.86)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = `800 40px ${JP}`;
  ctx.fillStyle = '#e9f2ff';
  ctx.fillText(t.paused, W / 2, 150);

  const kinds = ['master', 'sfx', 'music'];
  t.vols.forEach((label, i) => {
    const y = 230 + i * 46;
    const on = i === volRow;
    ctx.textAlign = 'right';
    ctx.font = `${on ? '700 17px' : '15px'} ${JP}`;
    ctx.fillStyle = on ? '#ffe36e' : 'rgba(180,205,245,0.7)';
    ctx.fillText(label, W / 2 - 130, y + 5);

    // バー
    const v = vol[kinds[i]];
    const bx = W / 2 - 110;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, y - 8, 220, 14);
    ctx.fillStyle = on ? '#ffe36e' : 'rgba(150,190,240,0.55)';
    ctx.fillRect(bx, y - 8, 220 * v, 14);

    ctx.textAlign = 'left';
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = 'rgba(190,210,240,0.7)';
    ctx.fillText(`${Math.round(v * 100)}`, bx + 232, y + 4);
  });

  ctx.textAlign = 'center';
  ctx.font = `13px ${JP}`;
  ctx.fillStyle = 'rgba(160,185,225,0.6)';
  ctx.fillText(t.volHelp, W / 2, 396);
  if (preMute !== null) {
    ctx.font = `700 13px ${MONO}`;
    ctx.fillStyle = '#ff8ea4';
    ctx.fillText(t.muted, W / 2, 418);
  }
  ctx.font = `600 15px ${JP}`;
  ctx.fillStyle = 'rgba(255,227,110,0.85)';
  ctx.fillText(`${t.resume}     ${t.quit}`, W / 2, 458);
  ctx.font = `12px ${JP}`;
  ctx.fillStyle = 'rgba(160,185,225,0.5)';
  ctx.fillText(t.fullscreen, W / 2, 484);
  ctx.textAlign = 'left';
}

/** 通算のかな別弱点。棒の長さ = 自分の平均に対する遅さ */
function drawWeakness(t, cx, top) {
  const r = s.report;
  ctx.textAlign = 'center';
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(150,178,215,0.55)';
  ctx.fillText(t.weakTitle, cx, top);

  if (!r || !r.weakest.length) {
    ctx.font = `13px ${JP}`;
    ctx.fillStyle = 'rgba(170,195,235,0.5)';
    ctx.fillText(t.weakNone, cx, top + 34);
    return;
  }

  const BW = 128;
  const worst = Math.max(1.25, r.weakest[0].ratio);
  r.weakest.forEach((u, i) => {
    const y = top + 30 + i * 27;
    // かな
    ctx.textAlign = 'right';
    ctx.font = `600 17px ${JP}`;
    ctx.fillStyle = '#eaf2ff';
    ctx.fillText(u.kana, cx - BW / 2 - 12, y + 5);

    // 棒（1.0 = 自分の平均の位置に目盛りを置く）
    const x0 = cx - BW / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x0, y - 5, BW, 10);
    const w = BW * clamp(u.ratio / worst, 0.05, 1);
    ctx.fillStyle = `hsl(${Math.max(0, 45 - (u.ratio - 1) * 90)} 90% 60%)`;
    ctx.fillRect(x0, y - 5, w, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x0 + BW / worst, y - 8, 1, 16); // 平均の目盛り

    ctx.textAlign = 'left';
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = 'rgba(255,227,110,0.85)';
    ctx.fillText(`${u.ratio.toFixed(2)}x`, x0 + BW + 12, y + 4);
  });

  ctx.textAlign = 'center';
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(150,178,215,0.45)';
  ctx.fillText(t.weakHint(r.runs), cx, top + 30 + r.weakest.length * 27 + 12);
}

function drawBoard() {
  const t = T();
  ctx.fillStyle = 'rgba(6,9,18,0.94)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.font = `700 26px ${JP}`;
  ctx.fillStyle = '#e9f2ff';
  ctx.fillText(t.boardTitle, W / 2, 78);

  // 名前
  const nm = getName() || '—';
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(150,178,215,0.5)';
  ctx.fillText(t.nameLabel, W / 2, 106);
  ctx.font = `700 20px ${MONO}`;
  ctx.fillStyle = s.editName ? '#ffe36e' : 'rgba(235,245,255,0.92)';
  const caret = s.editName && Math.floor(s.t * 3) % 2 === 0 ? '_' : '';
  ctx.fillText(nm + caret, W / 2, 132);

  const list = s.board ?? [];
  const cols = [-186, -74, 40, 130, 214];
  const cx = W / 2;

  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(150,178,215,0.45)';
  t.boardCols.forEach((c, i) => {
    ctx.textAlign = i === 0 ? 'left' : 'right';
    ctx.fillText(c, cx + cols[i], 172);
  });

  if (!list.length) {
    ctx.textAlign = 'center';
    ctx.font = `14px ${JP}`;
    ctx.fillStyle = 'rgba(170,195,235,0.5)';
    ctx.fillText(t.boardEmpty, cx, 220);
  }

  list.slice(0, 10).forEach((e, i) => {
    const y = 198 + i * 24;
    const mine = s.rank && i === s.rank - 1;
    ctx.fillStyle = mine ? 'rgba(255,227,110,0.10)' : 'transparent';
    if (mine) ctx.fillRect(cx - 200, y - 15, 430, 22);

    const c = mine ? '#ffe36e' : 'rgba(220,232,250,0.85)';
    ctx.textAlign = 'left';
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = mine ? c : 'rgba(150,178,215,0.6)';
    ctx.fillText(String(i + 1).padStart(2, ' '), cx + cols[0], y);

    ctx.textAlign = 'right';
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = c;
    ctx.fillText(String(e.score), cx + cols[1], y);
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = mine ? c : 'rgba(200,216,240,0.7)';
    ctx.fillText(String(e.wave), cx + cols[2], y);
    ctx.fillText(String(e.kpm), cx + cols[3], y);
    ctx.fillText(`${e.acc}%`, cx + cols[4], y);
  });

  ctx.textAlign = 'center';
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = 'rgba(150,178,215,0.4)';
  ctx.fillText(isOnline() ? t.boardOnline : t.boardLocal, cx, H - 62);
  ctx.font = `600 13px ${JP}`;
  ctx.fillStyle = 'rgba(255,227,110,0.8)';
  ctx.fillText(s.editName ? t.namePrompt : `[ N ] ${t.nameLabel}     ${t.boardBack}`, cx, H - 34);
  ctx.textAlign = 'left';
}

function drawOver() {
  const t = T();
  // 読ませる画面なので背後は強く沈める（章の意匠が明るいと数字が読めない）
  ctx.fillStyle = 'rgba(6,9,18,0.94)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = `800 44px ${JP}`;
  ctx.fillStyle = '#ff6b86';
  ctx.fillText(t.over, W / 2, 158);

  if (s.record) {
    ctx.font = `700 16px ${MONO}`;
    ctx.fillStyle = '#ffe36e';
    ctx.fillText(t.newBest, W / 2, 188);
  }

  // 左: この回の成績
  const vals = [String(s.score), String(s.wave), String(s.bestCombo), `${kpmNow()} KPM`, `${accuracy()}%`];
  const LX = W * 0.30;
  t.rows.forEach((k, i) => {
    const y = 236 + i * 32;
    ctx.textAlign = 'right';
    ctx.font = `14px ${JP}`;
    ctx.fillStyle = 'rgba(180,205,245,0.8)';
    ctx.fillText(k, LX - 12, y);
    ctx.textAlign = 'left';
    ctx.font = `700 19px ${MONO}`;
    ctx.fillStyle = '#eaf2ff';
    ctx.fillText(vals[i], LX + 12, y);
  });

  // 自己ベストでの位置
  if (s.rank > 0) {
    ctx.textAlign = 'center';
    ctx.font = `600 13px ${JP}`;
    ctx.fillStyle = s.rank === 1 ? '#ffe36e' : 'rgba(170,195,235,0.7)';
    ctx.fillText(t.rankNow(s.rank), LX, 236 + t.rows.length * 32 + 6);
  }

  // 右: 通算の弱点。ゲームは「速かったか」しか返さないが、ここは「どこで詰まったか」を返す
  drawWeakness(t, W * 0.68, 208);

  ctx.textAlign = 'center';
  ctx.font = `700 17px ${JP}`;
  ctx.fillStyle = `rgba(255,227,110,${0.55 + Math.sin(s.t * 4) * 0.35})`;
  ctx.fillText(t.retry, W / 2, 452);
  ctx.textAlign = 'left';
}

function render() {
  ctx.setTransform(SC, 0, 0, SC, 0, 0);
  ctx.save();
  const sh = s.shake;
  if (sh > 0.4) ctx.translate(rand(-sh, sh), rand(-sh, sh));

  bg();
  drawCore();
  if (s.phase === 'title') for (const a of s.ambient) drawAmbient(a);
  for (const e of s.enemies) drawEnemy(e);

  // 粒子は加算合成。重なったところが白く飛んで、火花らしくなる
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of s.particles) {
    const a = p.life / p.max;
    const sz = 1.5 + a * 2.5;
    ctx.fillStyle = `hsla(${p.hue} 95% ${55 + a * 30}% / ${a})`;
    ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
  }
  ctx.restore();

  vignette();
  if (s.phase === 'play' || s.phase === 'upgrade' || s.phase === 'pause') drawHud();
  if (s.banner > 0) drawBanner();
  ctx.restore();

  if (s.flash > 0) {
    ctx.fillStyle = s.flashColor;
    ctx.globalAlpha = s.flash * 0.35;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  if (s.phase === 'title') drawTitle();
  if (s.phase === 'upgrade') drawUpgrade();
  if (s.phase === 'pause') drawPause();
  if (s.phase === 'board') drawBoard();
  if (s.phase === 'over') drawOver();
}

// タブを閉じる・別ページへ移るときも、そこまでの打鍵を残す
addEventListener('pagehide', () => { if (s.phase === 'play') flushStats(); });

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  Sfx.tick();
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// デバッグ用（プレビュー検証で使う）
window.__game = {
  state: () => s,
  lang: (v) => { if (v) { lang = v; localStorage.setItem('kd.lang', v); } return lang; },
  type: (str) => { for (const c of str) typeChar(c.toLowerCase()); },
  start: () => { newGame(); startWave(); },
  step: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) update(dt); },
  frame: () => render(),
  setFocused,
  focused: () => focused,
  // ストア用スクリーンショット（1920x1080）を撮るために解像度を固定する
  setResolution: (px) => { cv.width = px; cv.height = Math.round((px * H) / W); SC = cv.width / W; },
  pickUpgrade: (i) => { take(s, s.cards[i].id); s.wave++; startWave(); },
};
