(() => {
'use strict';
const $ = s => document.querySelector(s);
const CATS = ['商务用语','行业术语','材质','光学电气','安装与结构','其他'];
const LESSON_LEN = 10, DAILY_GOAL = 30, MAX_BOX = 5;
const LS = { prog:'vq_progress', stats:'vq_stats', cats:'vq_cats', words:'vq_words_cache', sound:'vq_sound' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let DB = load(LS.words, null);           // {syncedAt,count,words}
let prog = load(LS.prog, {});            // id -> {box,seen,ok,bad,last}
let stats = load(LS.stats, { xp:0, streak:0, lastDay:'', today:'', todayXp:0 });
let selCats = load(LS.cats, []);         // [] = 全部
let soundOn = load(LS.sound, true);

const today = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const yesterday = () => { const d = new Date(); d.setDate(d.getDate()-1); return today(d); };
const shuffle = a => { a = a.slice(); for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words = () => (DB && DB.words) || [];
const P = id => prog[id] || (prog[id] = { box:0, seen:0, ok:0, bad:0, last:0 });
const isWrong = w => { const p = prog[w.id]; return p && p.bad > 0 && p.box < 3; };
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200); }
function fmtTime(iso){ if (!iso) return '-'; const d = new Date(iso); if (isNaN(d)) return iso; return d.toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }); }

/* ---------- speech: pre-generated en-GB-RyanNeural MP3, fallback speechSynthesis ---------- */
const AUDIO_DIR = 'audio/';
let audioIndex = null;          // text -> filename
let audioEl = null;
let speakToken = 0;
let voice = null;
function pickVoice(){
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
  const pref = [/Google UK English Male/i, /Daniel/i, /Ryan/i, /Google UK English/i, /en-GB/i, /Samantha/i, /Google US English/i, /Microsoft (Aria|Jenny|Guy)/i];
  voice = null;
  for (const re of pref) { voice = vs.find(v => re.test(v.name) || re.test(v.lang)); if (voice) break; }
  if (!voice) voice = vs.find(v => /en[-_]GB/i.test(v.lang)) || vs.find(v => /en[-_]AU/i.test(v.lang)) || vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function ttsNorm(text){ return String(text).replace(/\s*\/\s*/g, ', ').replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim(); }
function getAudioEl(){ if (!audioEl) { audioEl = new Audio(); audioEl.preload = 'auto'; } return audioEl; }
function stopSpeak(){
  try { if (audioEl) { audioEl.onerror = null; audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } } catch (e) {}
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
}
function fallbackSpeak(text, rate = 0.85){
  if (!('speechSynthesis' in window)) { toast('此浏览器不支持朗读'); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(ttsNorm(text) || String(text));
    u.lang = (voice && voice.lang) || 'en-GB'; if (voice) u.voice = voice; u.rate = rate; u.pitch = 1;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function speak(text, rate){
  const raw = String(text ?? '');
  if (!raw.trim()) return;
  const token = ++speakToken;
  stopSpeak();
  const file = audioIndex && (audioIndex[raw] || audioIndex[raw.trim()] || audioIndex[ttsNorm(raw)]);
  if (file) {
    const el = getAudioEl();
    el.playbackRate = rate == null ? 1 : rate;
    const fail = err => {
      if (token !== speakToken) return;
      if (err && err.name === 'AbortError') return;
      el.onerror = null;
      fallbackSpeak(raw, rate == null ? 0.85 : rate);
    };
    el.onerror = () => fail();
    el.src = AUDIO_DIR + file;
    const p = el.play();
    if (p && p.catch) p.catch(fail);
    return;
  }
  fallbackSpeak(raw, rate == null ? 0.85 : rate);
}
async function loadAudioIndex(){
  try {
    const r = await fetch(AUDIO_DIR + 'index.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    audioIndex = d.files || d;
  } catch (e) { if (!audioIndex) audioIndex = {}; }
}
function unlockMedia(){
  try {
    const el = getAudioEl();
    el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAABAAgAZGF0YQAAAAA=';
    const p = el.play(); if (p && p.catch) p.catch(() => {});
    el.pause();
  } catch (e) {}
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
}


/* ---------- sound fx (Web Audio, no files) ---------- */
let actx = null;
function tone(freqs, dur = 0.12, type = 'sine', vol = 0.18){
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    let t = actx.currentTime;
    freqs.forEach(f => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur); t += dur * 0.85;
    });
  } catch (e) {}
}
const sfx = { ok: () => tone([660, 880, 1320], 0.11, 'triangle'), bad: () => tone([220, 165], 0.18, 'sawtooth', 0.09), tap: () => tone([520], 0.04, 'sine', 0.06), done: () => tone([523, 659, 784, 1046, 1318], 0.13, 'triangle') };

/* ---------- data ---------- */
async function fetchWords(manual){
  const btn = $('#refreshBtn'); if (manual) { btn.disabled = true; btn.textContent = '刷新中…'; }
  try {
    const r = await fetch('words.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const before = words().length;
    DB = d; save(LS.words, d);
    renderHome(); renderList();
    if (manual) { const diff = d.count - before; toast(`词库已刷新：共 ${d.count} 个词` + (before && diff > 0 ? `（新增 ${diff}）` : '')); }
  } catch (e) {
    if (manual || !DB) toast('刷新失败，请检查网络' + (DB ? '（已使用本地缓存）' : ''));
  } finally { if (manual) { btn.disabled = false; btn.textContent = '🔄 刷新词库'; } }
}
function pool(){ const ws = words(); return selCats.length ? ws.filter(w => selCats.includes(w.cat)) : ws; }

/* ---------- home ---------- */
function rollDay(){ const t = today(); if (stats.today !== t) { stats.today = t; stats.todayXp = 0; } if (stats.lastDay && stats.lastDay !== t && stats.lastDay !== yesterday()) stats.streak = 0; save(LS.stats, stats); }
function renderHome(){
  rollDay();
  $('#streak').textContent = stats.streak; $('#xp').textContent = stats.xp;
  $('#mastered').textContent = words().filter(w => (prog[w.id]?.box || 0) >= 4).length;
  $('#goalText').textContent = `${Math.min(stats.todayXp, DAILY_GOAL)} / ${DAILY_GOAL} XP`;
  $('#goalFill').style.width = Math.min(100, stats.todayXp / DAILY_GOAL * 100) + '%';
  $('#wordCount').textContent = words().length;
  $('#syncTime').textContent = fmtTime(DB?.syncedAt);
  const wc = words().filter(isWrong).length; $('#wrongCount').textContent = wc; $('#wrongBtn').disabled = wc === 0;
  $('#soundToggle').textContent = soundOn ? '🔊' : '🔈';
  const g = stats.todayXp >= DAILY_GOAL ? '今日目标达成！太棒了 🎉' : stats.streak ? `已连续 ${stats.streak} 天，继续保持！` : '今天也来练几个词吧！';
  $('#greet').textContent = g;
  const counts = {}; words().forEach(w => counts[w.cat] = (counts[w.cat] || 0) + 1);
  const chip = (c, label, n) => `<button class="chip ${(c === '' ? !selCats.length : selCats.includes(c)) ? 'on' : ''}" data-c="${esc(c)}">${esc(label)}<span class="n">${n}</span></button>`;
  $('#catChips').innerHTML = chip('', '全部', words().length) + CATS.filter(c => counts[c]).map(c => chip(c, c, counts[c])).join('') +
    Object.keys(counts).filter(c => !CATS.includes(c)).map(c => chip(c, c, counts[c])).join('');
  $('#startBtn').disabled = pool().length < 4;
}
$('#catChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; sfx.tap();
  const c = b.dataset.c;
  if (!c) selCats = []; else { selCats = selCats.includes(c) ? selCats.filter(x => x !== c) : [...selCats, c]; if (selCats.length === CATS.length) selCats = []; }
  save(LS.cats, selCats); renderHome();
});
$('#soundToggle').onclick = () => { soundOn = !soundOn; save(LS.sound, soundOn); renderHome(); sfx.tap(); };
$('#refreshBtn').onclick = () => fetchWords(true);

/* ---------- spaced repetition picking ---------- */
function weight(w){
  const p = prog[w.id]; if (!p || !p.seen) return 3;             // new words
  const days = (Date.now() - (p.last || 0)) / 864e5;
  const base = Math.pow(2, MAX_BOX - p.box);                      // box0=32 … box5=1
  const due = Math.min(3, 1 + days / (Math.pow(2, p.box) || 1));  // overdue boost
  return base * due * (p.bad > p.ok ? 1.5 : 1);
}
function weightedPick(list, n){
  const out = [], arr = list.map(w => ({ w, k: Math.pow(Math.random(), 1 / weight(w)) })); // weighted sampling w/o replacement
  arr.sort((a, b) => b.k - a.k); for (const x of arr.slice(0, n)) out.push(x.w); return out;
}

/* ---------- question building ---------- */
function distractors(w, n, key){
  const ws = words(); const same = shuffle(ws.filter(x => x.cat === w.cat && x.id !== w.id)); const other = shuffle(ws.filter(x => x.cat !== w.cat));
  const seen = new Set([norm(key(w))]), out = [];
  for (const x of same.concat(other)) { const k = norm(key(x)); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= n) break; }
  return out;
}
const norm = s => String(s || '').toLowerCase().trim();
function buildQ(w, forceType){
  const clozeEx = shuffle((w.examples || []).filter(e => e.hit));
  const types = ['en2zh', 'zh2en']; if (clozeEx.length) types.push('cloze');
  const type = forceType || types[Math.floor(Math.random() * types.length)];
  if (type === 'cloze' && clozeEx.length) {
    const ex = clozeEx[0]; const ds = distractors(w, 3, x => x.en);
    const opts = shuffle([{ t: ex.hit, ok: true }, ...ds.map(d => ({ t: matchCase(clozeForm(d.en), ex.hit), ok: false })).filter(o => norm(o.t) !== norm(ex.hit))]);
    return { w, type, ex, opts };
  }
  if (type === 'zh2en') { const ds = distractors(w, 3, x => x.en); return { w, type, opts: shuffle([{ t: w.en, ok: true }, ...ds.map(d => ({ t: d.en, ok: false }))]) }; }
  const ds = distractors(w, 3, x => x.zh); return { w, type: 'en2zh', opts: shuffle([{ t: w.zh, ok: true }, ...ds.map(d => ({ t: d.zh, ok: false }))]) };
}
function clozeForm(s){ return String(s).split('/')[0].replace(/\s*[（(][^）)]*[）)]/g, '').trim(); }
function matchCase(s, ref){ return ref[0] === ref[0].toUpperCase() && ref[0] !== ref[0].toLowerCase() ? s[0].toUpperCase() + s.slice(1) : (s === s.toUpperCase() && s.length <= 4 ? s : s.toLowerCase()); }

/* ---------- lesson ---------- */
let L = null;
function startLesson(mode){
  let list = mode === 'wrong' ? words().filter(isWrong) : pool();
  if (list.length < 1) { toast('没有可练习的词'); return; }
  const picks = weightedPick(list, Math.min(LESSON_LEN, list.length));
  while (picks.length < LESSON_LEN && list.length) picks.push(list[Math.floor(Math.random() * list.length)]);
  L = { mode, queue: picks.map(w => buildQ(w)), i: 0, done: 0, total: picks.length, correct: 0, answered: 0, combo: 0, xp: 0, missed: new Map(), sel: null, checked: false, retried: new Set() };
  document.body.classList.add('inlesson'); show('lesson'); renderQ();
}
function renderQ(){
  const q = L.queue[L.i]; L.sel = null; L.checked = false;
  const bar = $('#checkBar'); bar.className = 'checkbar'; $('#checkBtn').textContent = '检查'; $('#checkBtn').disabled = true;
  $('#lessonFill').style.width = (L.done / L.total * 100) + '%';
  $('#combo').textContent = L.combo >= 2 ? `🔥${L.combo}` : '';
  const w = q.w; let ph = '';
  if (q.type === 'en2zh') { $('#qType').textContent = '选择正确的中文意思'; ph = `<button class="speak" data-say="${esc(w.en)}">🔊</button><div><div class="word">${esc(w.en)}</div></div>`; }
  else if (q.type === 'zh2en') { $('#qType').textContent = '选择对应的英文'; ph = `<div><div class="zhword">${esc(w.zh)}</div><div class="hint">${esc(w.cat)}</div></div>`; }
  else {
    $('#qType').textContent = '选词填空';
    const i = q.ex.en.indexOf(q.ex.hit);
    const s = esc(q.ex.en.slice(0, i)) + '<span class="gap" id="gap">&nbsp;</span>' + esc(q.ex.en.slice(i + q.ex.hit.length));
    ph = `<div><div class="sent">${s}</div><div class="hint">${esc(q.ex.zh)}</div></div>`;
  }
  $('#qPrompt').innerHTML = ph;
  $('#qOptions').innerHTML = q.opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="k">${i + 1}</span><span>${esc(o.t)}</span></button>`).join('');
  $('.qwrap').scrollTop = 0;
  if (q.type === 'en2zh') speak(w.en);
}
$('#qPrompt').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) speak(b.dataset.say); });
$('#qOptions').addEventListener('click', e => {
  const b = e.target.closest('.opt'); if (!b || L.checked) return;
  document.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); L.sel = +b.dataset.i;
  const q = L.queue[L.i], o = q.opts[L.sel]; sfx.tap();
  if (q.type === 'zh2en') speak(o.t); if (q.type === 'cloze') $('#gap').textContent = o.t;
  $('#checkBtn').disabled = false;
});
$('#checkBtn').onclick = () => { if (!L) return; if (!L.checked) check(); else next(); };
function check(){
  const q = L.queue[L.i], o = q.opts[L.sel]; L.checked = true; L.answered++;
  const p = P(q.w.id); p.seen++; p.last = Date.now(); p.h = (p.h || []).concat(o.ok ? 1 : 0).slice(-20);
  const btns = document.querySelectorAll('.opt'); btns.forEach(b => b.disabled = true);
  const ri = q.opts.findIndex(x => x.ok); btns[ri].classList.add('right');
  const bar = $('#checkBar'), w = q.w;
  const full = q.type === 'cloze' ? `<div>${esc(q.ex.en)}</div>` : `<div>${esc(w.en)} = ${esc(w.zh)}</div>`;
  if (o.ok) {
    L.correct++; L.combo++; L.done++; p.ok++; p.box = Math.min(MAX_BOX, p.box + 1);
    const gain = 1 + (L.combo >= 5 ? 1 : 0); L.xp += gain;
    bar.className = 'checkbar ok'; $('#fbTitle').textContent = pick(['太棒了！', '正确！', '真厉害！', '完美！', '答对了！']) + (L.combo >= 3 ? ` 连对 ${L.combo}` : '');
    $('#fbBody').innerHTML = full; sfx.ok(); btns[ri].classList.add('pop');
    if (q.type !== 'en2zh') speak(q.type === 'cloze' ? q.ex.en : w.en);
  } else {
    L.combo = 0; p.bad++; p.box = 0; L.missed.set(w.id, w);
    btns[L.sel].classList.add('wrong');
    bar.className = 'checkbar bad'; $('#fbTitle').textContent = '正确答案：';
    $('#fbBody').innerHTML = `<div>${esc(q.opts[ri].t)}</div>` + (q.type === 'cloze' ? full : `<div style="opacity:.8">${esc(w.en)} = ${esc(w.zh)}</div>`);
    sfx.bad(); if (navigator.vibrate) navigator.vibrate(120);
    if (!L.retried.has(w.id)) { L.retried.add(w.id); L.queue.push(buildQ(w)); }   // ask again at end of lesson
    else L.done++;
  }
  save(LS.prog, prog);
  $('#checkBtn').textContent = '继续'; $('#checkBtn').disabled = false;
  $('#lessonFill').style.width = (L.done / L.total * 100) + '%';
}
const pick = a => a[Math.floor(Math.random() * a.length)];
function next(){ L.i++; if (L.i >= L.queue.length) finish(); else renderQ(); }
function finish(){
  rollDay();
  const perfect = L.correct === L.answered; const bonus = 5 + (perfect ? 5 : 0); L.xp += bonus;
  stats.xp += L.xp; stats.todayXp += L.xp;
  const t = today();
  if (stats.lastDay !== t) { stats.streak = stats.lastDay === yesterday() ? stats.streak + 1 : 1; stats.lastDay = t; }
  save(LS.stats, stats);
  $('#doneTitle').textContent = perfect ? '完美通关！' : '完成一课！';
  $('#doneXp').textContent = '+' + L.xp; $('#doneAcc').textContent = Math.round(L.correct / Math.max(1, L.answered) * 100) + '%'; $('#doneStreak').textContent = '🔥' + stats.streak;
  const ms = [...L.missed.values()];
  $('#doneReview').innerHTML = ms.length ? `<div class="card-title">需要复习的词（已加入错题本）</div>` + ms.map(w => `<div class="ri"><span>${esc(w.en)}</span><span>${esc(w.zh)}</span></div>`).join('') : '';
  document.body.classList.remove('inlesson'); show('done'); sfx.done(); confetti();
}
function confetti(){
  const cs = ['#58cc02', '#1cb0f6', '#ffc800', '#ff4b4b', '#ce82ff', '#ff9600'];
  for (let i = 0; i < 60; i++) { const d = document.createElement('div'); d.className = 'confetti'; d.style.left = Math.random() * 100 + 'vw'; d.style.background = cs[i % cs.length]; d.style.animationDuration = (1.6 + Math.random() * 1.8) + 's'; d.style.animationDelay = Math.random() * 0.5 + 's'; document.body.appendChild(d); setTimeout(() => d.remove(), 4200); }
}
$('#quitBtn').onclick = () => { if (confirm('确定退出吗？本课进度不会保存经验值。')) { L = null; document.body.classList.remove('inlesson'); show('home'); renderHome(); } };
$('#startBtn').onclick = () => startLesson('normal');
$('#wrongBtn').onclick = () => startLesson('wrong');
$('#doneBtn').onclick = () => { show('home'); renderHome(); };
$('#againBtn').onclick = () => startLesson(L?.mode || 'normal');

/* ---------- word list ---------- */
let listCat = '', listWrongOnly = false;
function renderList(){
  const q = norm($('#search').value);
  const counts = {}; words().forEach(w => counts[w.cat] = (counts[w.cat] || 0) + 1);
  const chip = (c, label) => `<button class="chip ${listCat === c && !listWrongOnly ? 'on' : ''}" data-c="${esc(c)}">${esc(label)}</button>`;
  $('#listChips').innerHTML = chip('', '全部') + `<button class="chip ${listWrongOnly ? 'on' : ''}" data-c="__wrong">📕 错题本</button>` + CATS.filter(c => counts[c]).map(c => chip(c, c)).join('');
  let ws = words().slice().reverse();
  if (listWrongOnly) ws = ws.filter(isWrong); else if (listCat) ws = ws.filter(w => w.cat === listCat);
  if (q) ws = ws.filter(w => norm(w.en).includes(q) || norm(w.zh).includes(q) || norm(w.material).includes(q));
  if (!ws.length) { $('#wordList').innerHTML = `<div class="empty">${listWrongOnly ? '错题本是空的，继续保持！🎉' : '没有找到匹配的词'}</div>`; return; }
  $('#wordList').innerHTML = `<div class="muted" style="margin:0 2px 10px">共 ${ws.length} 个</div>` + ws.map(w => {
    const p = prog[w.id]; const lv = p && p.seen ? `<span class="tag lv">熟练度 ${p.box}/${MAX_BOX}</span>` : ''; const bad = isWrong(w) ? `<span class="tag bad">错 ${p.bad} 次</span>` : '';
    const exs = (w.examples || []).map(e => `<div class="wex"><button class="speak sm" data-say="${esc(e.en)}">🔊</button><div><div>${esc(e.en)}</div><div class="zh">${esc(e.zh)}</div></div></div>`).join('');
    return `<div class="wcard"><div class="wtop"><div class="t"><div class="wen">${esc(w.en)}</div><div class="wzh">${esc(w.zh)}</div></div><button class="speak sm" data-say="${esc(w.en)}">🔊</button></div>
      <div style="margin-top:8px"><span class="tag">${esc(w.cat)}</span>${w.material ? `<span class="tag">${esc(w.material)}</span>` : ''}${lv}${bad}</div>
      <div class="tog">展开例句和用法 ▾</div><div class="more">${exs}${w.usage ? `<div class="wuse">💡 ${esc(w.usage)}</div>` : ''}${w.notes ? `<div class="wuse">${esc(w.notes)}</div>` : ''}</div></div>`;
  }).join('');
}
$('#search').addEventListener('input', () => renderList());
$('#listChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const c = b.dataset.c; if (c === '__wrong') { listWrongOnly = !listWrongOnly; listCat = ''; } else { listWrongOnly = false; listCat = c; } renderList(); });
$('#wordList').addEventListener('click', e => {
  const s = e.target.closest('[data-say]'); if (s) { speak(s.dataset.say); return; }
  const t = e.target.closest('.tog'); if (t) { const c = t.closest('.wcard'); c.classList.toggle('open'); t.textContent = c.classList.contains('open') ? '收起 ▴' : '展开例句和用法 ▾'; }
});

/* ---------- backup: export / import ---------- */
const APP_ID = 'vocab-quest';
function exportData(){ return { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), data: { progress: prog, stats, cats: selCats, sound: soundOn } }; }
function validNum(n){ return typeof n === 'number' && isFinite(n) && n >= 0; }
function validate(obj){
  if (!obj || typeof obj !== 'object') throw new Error('不是有效的 JSON 对象');
  if (obj.app !== APP_ID) throw new Error('这不是本应用导出的进度文件');
  const d = obj.data; if (!d || typeof d !== 'object') throw new Error('缺少 data 字段');
  const pr = d.progress || {}; if (typeof pr !== 'object' || Array.isArray(pr)) throw new Error('progress 格式错误');
  const clean = {};
  for (const [id, r] of Object.entries(pr)) {
    if (!r || typeof r !== 'object') continue;
    if (!['box','seen','ok','bad','last'].every(k => r[k] == null || validNum(r[k]))) throw new Error('单词进度数据格式错误：' + id);
    clean[id] = { box: Math.min(MAX_BOX, Math.round(r.box || 0)), seen: r.seen || 0, ok: r.ok || 0, bad: r.bad || 0, last: r.last || 0, h: Array.isArray(r.h) ? r.h.filter(x => x === 0 || x === 1).slice(-20) : [] };
  }
  const st = d.stats || {};
  if (!['xp','streak','todayXp'].every(k => st[k] == null || validNum(st[k]))) throw new Error('统计数据格式错误');
  const ds = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '';
  const stats2 = { xp: st.xp || 0, streak: st.streak || 0, lastDay: ds(st.lastDay), today: ds(st.today), todayXp: st.todayXp || 0 };
  const cats = Array.isArray(d.cats) ? d.cats.filter(c => typeof c === 'string') : [];
  return { progress: clean, stats: stats2, cats, sound: d.sound !== false, exportedAt: obj.exportedAt };
}
function applyImport(v, mode){
  if (mode === 'replace') { prog = v.progress; stats = v.stats; selCats = v.cats; soundOn = v.sound; }
  else {
    for (const [id, r] of Object.entries(v.progress)) { const cur = prog[id]; if (!cur || (r.last || 0) > (cur.last || 0)) prog[id] = r; }
    const a = stats, b = v.stats;
    const newer = (b.lastDay || '') > (a.lastDay || '') ? b : a;
    stats = { xp: Math.max(a.xp || 0, b.xp || 0), streak: newer.streak || 0, lastDay: newer.lastDay || '', today: a.today >= b.today ? a.today : b.today, todayXp: a.today === b.today ? Math.max(a.todayXp || 0, b.todayXp || 0) : (a.today > b.today ? a.todayXp : b.todayXp) };
    if (!selCats.length && v.cats.length) selCats = v.cats;
  }
  save(LS.prog, prog); save(LS.stats, stats); save(LS.cats, selCats); save(LS.sound, soundOn);
  renderHome(); renderList();
}
const modal = $('#modal');
function openModal(html){ $('#modalBody').innerHTML = html; modal.classList.add('show'); }
function closeModal(){ modal.classList.remove('show'); }
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
async function copyText(t){
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  const ta = $('#exportText'); if (ta) { ta.focus(); ta.select(); ta.setSelectionRange(0, t.length); try { return document.execCommand('copy'); } catch (e) {} }
  return false;
}
$('#exportBtn').onclick = () => {
  const json = JSON.stringify(exportData());
  const fname = '单词闯关进度-' + today() + '.json';
  try { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); } catch (e) {}
  const n = Object.keys(prog).length;
  openModal(`<h3>导出进度</h3><p class="muted">已尝试下载文件 <b>${esc(fname)}</b>。如果手机没有下载（例如 iPhone），请复制下面的文本，保存到备忘录或发给自己。</p>
    <p class="muted">包含 ${n} 个单词记录、${stats.xp} XP、连续 ${stats.streak} 天。</p>
    <textarea id="exportText" readonly>${esc(json)}</textarea>
    <button class="btn big primary" id="copyBtn">复制文本</button><button class="btn big secondary" data-close>关闭</button>`);
  $('#copyBtn').onclick = async () => { const ok = await copyText(json); toast(ok ? '已复制到剪贴板' : '复制失败，请长按文本框手动全选复制'); };
};
$('#importBtn').onclick = () => {
  openModal(`<h3>导入进度</h3><p class="muted">选择之前导出的 .json 文件，或把导出的文本粘贴到下面。</p>
    <label class="btn big secondary filebtn">📁 选择文件<input type="file" id="importFile" accept=".json,application/json,text/plain"></label>
    <textarea id="importText" placeholder="在这里粘贴导出的文本…"></textarea>
    <div class="err" id="importErr"></div>
    <button class="btn big primary" id="importGo">导入</button><button class="btn big secondary" data-close>取消</button>`);
  $('#importFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#importText').value = r.result; }; r.readAsText(f); };
  $('#importGo').onclick = () => {
    let v; try { v = validate(JSON.parse($('#importText').value.trim())); } catch (e) { $('#importErr').textContent = '无法导入：' + (e instanceof SyntaxError ? '文本不是有效的 JSON' : e.message); return; }
    const n = Object.keys(v.progress).length;
    openModal(`<h3>确认导入</h3><p class="muted">文件中有 ${n} 个单词记录、${v.stats.xp} XP、连续 ${v.stats.streak} 天${v.exportedAt ? '（导出于 ' + esc(fmtTime(v.exportedAt)) + '）' : ''}。</p>
      <p class="muted"><b>合并</b>：保留两边的记录，同一个词取最近练习的那份，XP 取较大值。<br><b>覆盖</b>：用文件内容完全替换当前进度。</p>
      <button class="btn big primary" id="doMerge">合并</button><button class="btn big danger" id="doReplace">覆盖当前进度</button><button class="btn big secondary" data-close>取消</button>`);
    $('#doMerge').onclick = () => { applyImport(v, 'merge'); closeModal(); toast('导入完成（已合并）'); };
    $('#doReplace').onclick = () => { if (!confirm('确定用文件内容覆盖当前全部进度吗？此操作无法撤销。')) return; applyImport(v, 'replace'); closeModal(); toast('导入完成（已覆盖）'); };
  };
};

/* ---------- nav ---------- */
function show(id){ document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; sfx.tap();
  let t = b.dataset.tab;
  if (t === 'wrong') { listWrongOnly = true; listCat = ''; t = 'words'; } else if (t === 'words') { listWrongOnly = false; }
  document.querySelectorAll('.tabbar button').forEach(x => x.classList.toggle('on', x === b));
  show(t); if (t === 'words') renderList(); else renderHome();
});
// unlock audio + speech on iOS with the first gesture
const unlockOnce = () => { unlockMedia(); document.removeEventListener('touchend', unlockOnce); document.removeEventListener('click', unlockOnce); };
document.addEventListener('touchend', unlockOnce, { once: true });
document.addEventListener('click', unlockOnce, { once: true });

renderHome(); renderList();
Promise.all([fetchWords(false), loadAudioIndex()]).then(() => { if (location.hash === '#demo-lesson') startLesson('normal'); });
})();
