const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf8'));
const B = {}; CARDS.forEach(c => B[c.id] = c);

const MT={'.json':'application/json','.html':'text/html;charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.mp3':'audio/mpeg'};
const IMG = path.join(require('os').tmpdir(), 'bot-img');
(function unzipImgs() {
  try {
    fs.mkdirSync(IMG, { recursive: true });
    for (const zf of fs.readdirSync(__dirname).filter(n => /^imgs.*\.zip$/i.test(n))) {
      const b = fs.readFileSync(path.join(__dirname, zf)); let e = b.length - 22;
      while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
      if (e < 0) continue;
      let n = b.readUInt16LE(e + 10), p = b.readUInt32LE(e + 16), ok = 0;
      while (n-- > 0 && b.readUInt32LE(p) === 0x02014b50) {
        const m = b.readUInt16LE(p + 10), cs = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42);
        const name = path.basename(b.toString('utf8', p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
        if (!/\.(webp|json|png)$/i.test(name)) continue;
        const d = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28), raw = b.subarray(d, d + cs);
        try { if (m !== 0 && m !== 8) { console.log('unzip skip (method ' + m + ')', name); continue; } const out = m === 8 ? require('zlib').inflateRawSync(raw) : raw, dst = path.join(IMG, name), tmp = dst + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, out); fs.renameSync(tmp, dst); ok++; } catch (e2) { console.log('unzip file error', name, e2.message); }
      }
      console.log('unzip', zf, ok);
    }
  } catch (err) { console.log('unzip error', err.message); }
})();
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/_img') { let n = 0, a = false; try { n = fs.readdirSync(IMG).length; a = fs.existsSync(path.join(IMG, 'atlas.json')) || fs.existsSync(path.join(__dirname, 'atlas.json')); } catch (e) {} r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ tmp: IMG, files: n, atlas: a, zips: fs.readdirSync(__dirname).filter(x => /^imgs.*\.zip$/i.test(x)) })); }
  if (u === '/_imgs.json') { let L = []; try { L = [...new Set([...fs.readdirSync(IMG), ...fs.readdirSync(__dirname)])].filter(x => /\.(webp|png|jpg)$/i.test(x)); } catch (e) {} r.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return r.end(JSON.stringify(L)); }
  let f; try { f = path.basename(decodeURIComponent(u)) || 'index.html'; } catch (e) { f = 'index.html'; } let dir = __dirname;
  if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(path.join(IMG, f))) dir = IMG;
  const ext = path.extname(f);
  if (f !== 'index.html' && ext && /^\.(webp|png|jpg|json|mp4|webm|mp3)$/.test(ext) && (f === 'package.json' || !fs.existsSync(path.join(dir, f)))) { r.writeHead(404, { 'Content-Type': 'text/plain' }); return r.end('not found'); }
  if (!MT[ext] || f === 'package.json' || !fs.existsSync(path.join(dir, f))) { f = 'index.html'; dir = __dirname; }
  r.writeHead(200, path.extname(f) === '.webp' ? { 'Content-Type': MT['.webp'], 'Cache-Control': 'public, max-age=86400' } : { 'Content-Type': MT[path.extname(f)], 'Cache-Control': 'no-cache' });
  const st = fs.createReadStream(path.join(dir, f)); st.on('error', () => r.destroy()); st.pipe(r);
});
const crypto = require('crypto');
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY, SEC = process.env.SECRET || crypto.createHash('sha256').update('bot:' + (process.env.SUPABASE_KEY || 'dev')).digest('hex'), ADMIN = (process.env.ADMIN_USER || '').toLowerCase();
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, mem = {};
const dbGet = async n => { if (!SB) return mem[n]; const a = await (await fetch(`${SB}/rest/v1/users?name=eq.${encodeURIComponent(n)}&select=d`, { headers: H })).json(); return a[0] && a[0].d; };
const dbPut = async (n, d) => { if (!SB) { mem[n] = d; return; } const r = await fetch(`${SB}/rest/v1/users`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ name: n, d }) }); if (!r.ok) throw 'บันทึกข้อมูลไม่สำเร็จ'; };
const hash = (pw, s) => crypto.scryptSync(pw, s, 32).toString('hex');
const sign = n => { const p = n + '|' + (Date.now() + 90 * 864e5); return Buffer.from(p).toString('base64') + '.' + crypto.createHmac('sha256', SEC).update(p).digest('hex'); };
const unsign = t => { try { const [b, s] = t.split('.'), p = Buffer.from(b, 'base64').toString(); if (crypto.createHmac('sha256', SEC).update(p).digest('hex') !== s) return; const [n, e] = p.split('|'); return +e > Date.now() ? n : null; } catch (e) { } };
const prof = (n, d) => ({ name: n, gems: d.gems, cards: d.cards, admin: n === ADMIN, decks: d.decks || {}, fr: d.fr || [], rq: d.rq || [], pity: d.pity || 0, bought: d.bought || [], skins: d.skins || [], eq: d.eq || {} });
const ST = JSON.parse(fs.readFileSync(path.join(__dirname, 'starters.json'), 'utf8'));
const giveSt = (d, k) => ST[k].main.concat(ST[k].life).forEach(([id, n, r]) => { for (let j = 0; j < n; j++) add(d, { id, r }); });
const SETS = ['BT01','BT02','BT03','BT04','BT05','BT06','BT07','BT08','BT09','BT10','BT11'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const add = (d, x) => { const k = x.id + '|' + x.r; d.cards[k] = (d.cards[k] || 0) + 1; };
function pack(set, gar) {
  const R = []; CARDS.forEach(c => c.id.startsWith(set + '-') && c.v.forEach(r => R.push({ id: c.id, r })));
  const by = r => R.filter(x => x.r === r), w = () => { const x = Math.random(); return gar ? (x < .7 ? 'UR' : 'SCR') : x < .62 ? 'R' : x < .9 ? 'SR' : x < .98 ? 'UR' : 'SCR'; };
  const g = r => { const a = by(r); return a.length ? pick(a) : pick(by('C').length ? by('C') : R); };
  return [g('C'), g('C'), g('C'), g('R'), g(w())];
}
function preDeck(s) { const x = ST[s]; return { main: x.main.flatMap(([id, n]) => Array(n).fill(id)), life: x.life.map(([id]) => id) }; }
async function pickDeck(m, user, ban, exs) {
  if (m.mine) { const u = await dbGet(user), k = u.decks && u.decks[m.mine]; if (!k) E('ไม่พบเด็ค'); return mkDeck([...k.main, ...k.life].map(i => i + ' x1').join(' '), 0, 0, ban); }
  if (m.pre) { const u = await dbGet(user); if (!ST[m.pre] || !(/^SD0[1-3]$/.test(m.pre) || (u.bought || []).includes(m.pre))) E('ยังไม่มีเด็คนี้'); const pd = preDeck(m.pre); if (ban && exs === false) { try { checkBan(pd.main); } catch (e) { E('เด็ค Starter ' + m.pre + ' ผิดแบนลิสต์ (ห้องนี้ไม่ได้ยกเว้น Starter): ' + e); } } return pd; }
  if (!process.env.BOT_TEST) E('ปิดใช้งานเด็ควางลิสต์/เด็คทดสอบแล้ว');
  return mkDeck(m.text || '', m.rand, m.skip, ban);
}
async function settle(r) { const g = r.g; if (!g.over || g.paid || g.win == null) return; g.paid = 1;
  for (let k = 0; k < 2; k++) { const w = r.p[k].ws; if (!w || !w.user) continue; const d = await dbGet(w.user); d.gems += k === g.win ? 150 : 50; await dbPut(w.user, d); const gain = k === g.win ? 150 : 50;
    if (w.readyState === 1) w.send(JSON.stringify({ t: 'me', me: prof(w.user, d), gain }));
    else MISSED[w.user] = { over: g.over, won: k === g.win, gain, code: r.code, at: Date.now() }; } }
const wss = new WebSocketServer({ server: srv });
const rooms = {}; let UID = 1, DRN = 0, BTN = 0, DCN = 0;
const REJOIN_MS = 3 * 60 * 1000; // หลุดเกิน 3 นาที = แพ้
const MISSED = {}; // ผลแมตช์ที่ผู้เล่นไม่อยู่ตอนจบ (หลุด/ออฟไลน์) -> แจ้งตอนกลับเข้าเว็บ
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const inst = id => ({ u: UID++, id, pw: 0, tired: false });
const ZN = ['hand','hell','av','mg','co','dk'];
const E = s => { throw s; };
/* ===== เอฟเฟกต์ให้ฝั่งไคลเอนต์เล่นอนิเมชัน + กวาดอุปกรณ์ที่ไม่มีเจ้าของ ===== */
let CR = null, FXN = 0;
const fx = o => { if (!CR || !CR.g) return; const g = CR.g; (g.fxl = g.fxl || []).push({ n: ++FXN, ...o }); if (g.fxl.length > 20) g.fxl.shift(); };
function sweep(r) { r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) { const m = p.mg[k]; if (m.at != null && !r.p.some(q => q.av.some(a => a.u === m.at))) { p.mg.splice(k, 1); delete m.at; toHellM(r, p, m); } } }); }

/* ===== ENGINE: กฎ v3.2 + สกิล SD01-03 (เลือกเป้าหมายเอง) ===== */
const nmOf = x => x.tk ? x.tk.n : B[x.id].n;
const symOf = x => x.tk ? (x.tk.s || '') : (B[x.id].s || '');
const isAv = x => !x.tk && B[x.id] && B[x.id].t === 'Avatar';
const TRIO = ['กุ่ย', 'ฮอล', 'นาย'];
const allAv = r => { const a = []; r.p.forEach((p, i) => p.av.forEach(x => a.push({ i, x }))); return a; };
const addTp = (x, n) => { x.tp = (x.tp || 0) + n; n && fx({ k: 'buff', u: x.u, v: n }); };
const lose = (r, i, why) => { if (r.g.over) return; r.g.over = r.p[i].name + ' ' + why + ' แพ้!'; r.g.win = 1 - i; };
function P(r, x) {
  const f = find(r, x.u); let v = (x.tk ? x.tk.p : (B[x.id].p || 0)) + (x.pw || 0) + (x.tp || 0) + (x.bp || 0);
  if (f && f.z === 'av') {
    const p = r.p[f.i], s = symOf(x), L = r.g.land && r.g.land.c.id;
    if (s === 'เทพ') { v += p.av.filter(a => a.id === 'SD01-004').length; if (L === 'SD01-020') v += 1; }
    if (s === 'นรก' && L === 'SD03-019') v += 1;
    if (x.id === 'BT01-002') v += 2 * p.life.filter(l => l.up).length;
    if (x.id === 'BT01-004') v += p.av.filter(a => symOf(a) === 'เทพ').length;
    if (L === 'BT01-048' && ['แมลง', 'สัตว์', 'รัททาทุย', 'คน'].includes(s)) v += 1;
    r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u) { if (m.id === 'SD01-016') v += 1; if (m.id === 'BT01-045') v += 2; if (m.id === 'SD03-018' && s === 'นรก') v += 1; } }));
    if (x.id === 'SD03-005') v += new Set(p.hell.filter(h => isAv(h) && B[h.id].n.startsWith('นายนิรยบาล')).map(h => B[h.id].n)).size;
  }
  return Math.max(0, v);
}
const kick = (r, a) => /เตะไข่/.test(a.tk ? '' : B[a.id].e) || r.p.some(q => q.mg.some(m => m.at === a.u && B[m.id].e.includes('เตะไข่')));
const allCards = (r, u) => { for (let i = 0; i < 2; i++) for (const z of [...ZN, 'deck']) { const c = r.p[i][z].find(x => x.u === u); if (c) return { i, z, c }; } return null; };
/* ===== คิว + ตัวเลือก (ask) ===== */
function runQ(r) { CR = r; const g = r.g; let n = 0; while (g && !g.over && !g.ask && !g.pend && g.q.length && n++ < 100) { const f = g.q.shift(); try { f(r); } catch (e) { console.error('fx', e); } } sweep(r); }
function ask(r, who, o) {
  const opts = o.yn ? [] : o.opts;
  if (!o.yn && !opts.length) { o.none && o.none(); return false; }
  const n = Math.min(o.n || 1, opts.length), min = Math.min(o.min == null ? n : o.min, n);
  r.g.ask = { who, text: o.text, opts, n, min, cancel: !!o.cancel, yn: !!o.yn, cb: o.cb, onCancel: o.onCancel,
    cards: opts.map(u => { const f = allCards(r, u); return f ? { u, id: f.c.id, tk: f.c.tk ? f.c.tk.n : null, i: f.i, z: f.z } : { u }; }) };
  return true;
}
const homeOf = f => f.c.oo != null ? f.c.oo : f.i;
const sendHell = (r, u) => { const f = take(r, u); if (!f.c.tk) r.p[homeOf(f)].hell.push(f.c); delete f.c.oo; };
const destroyAv = (r, u) => { const f = find(r, u); if (!f || f.z !== 'av') return;
  if (guardable(r, f.c)) return guardAsk(r, [f.c], () => { const g2 = find(r, u); g2 && g2.z === 'av' && kill(r, g2.i, u); });
  kill(r, f.i, u); };
const bounce = (r, u) => { const f = take(r, u); fx({ k: 'bounce', u }); if (!f.c.tk) { f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; f.c.tired = false; r.p[homeOf(f)].hand.push(f.c); delete f.c.oo; } };
function summonFree(r, i, c) {
  const p = r.p[i]; if (p.av.filter(x => !x.tk).length >= 4 || p.av.length >= 6) { log(r, 'Avatar เต็ม อัญเชิญไม่ได้'); return false; }
  const k = p.hell.findIndex(h => h.u === c.u); if (k < 0) return false; p.hell.splice(k, 1);
  c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; p.av.push(c); ev(r, c.id); log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + ' จากนรก'); return true;
}
function mill(r, i, n, src) {
  const p = r.p[i]; if (src) p.av.forEach(a => { if (a.id === 'SD03-004' && src.id !== 'SD03-004') n += 2; });
  const cs = []; for (let k = 0; k < n && p.deck.length; k++) cs.push(p.deck.pop());
  cs.forEach(c => p.hell.push(c)); cs.length && fx({ k: 'mill', i, ids: cs.map(c => c.id) }); log(r, '🕳 ' + p.name + ': ธรณีสูบ ' + cs.length + ' ใบ (' + cs.map(c => B[c.id].n).join(', ') + ')');
  cs.forEach(c => { if (c.id === 'SD03-018') c.mh = r.g.n; });
  if (cs.some(c => c.id === 'BT01-018')) { cs.filter(c => c.id === 'BT01-018').forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } }); shuf(p.deck); log(r, '✨ นีโม่ กลับเข้า Deck แล้วสับ'); }
  cs.filter(c => c.id === 'BT01-015').forEach(() => r.g.q.push(() => { mill(r, i, 2); mill(r, 1 - i, 2); }));
  if (!p.deck.length) return lose(r, i, 'เด็คหมด');
  cs.filter(c => c.id === 'SD03-003').forEach(c => r.g.q.unshift(() => ask(r, i, { yn: true, text: 'นายนิรยบาล แว่น ถูกธรณีสูบ — อัญเชิญลง Avatar Zone จากนรกไหม?', cb: y => y && summonFree(r, i, c) })));
}
function tutor(r, i, pred, label) {
  const p = r.p[i], L = p.deck.filter(pred).map(c => c.u);
  const done = u => { if (u != null) { const k = p.deck.findIndex(c => c.u === u), [c] = p.deck.splice(k, 1); p.hand.push(c); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' จาก Deck ขึ้นมือ'); } else log(r, '✨ ' + p.name + ': ค้น Deck ไม่พบ ' + label); shuf(p.deck); };
  if (!L.length) return done(null);
  if (new Set(L.map(u => B[p.deck.find(c => c.u === u).id].n)).size === 1) return done(L[0]);
  ask(r, i, { text: 'เลือก ' + label + ' จาก Deck 1 ใบ ขึ้นมือ', opts: L, cb: us => done(us[0]) });
}
const trioHell = (r, i) => r.p[i].hell.filter(c => isAv(c) && TRIO.includes(B[c.id].n)).map(c => c.u);
function fxSummon(r, i, x) { /* จุติ (อัญเชิญแบบจ่าย Cost) */
  const me = r.p[i], pickAv = (text, f) => ask(r, i, { text, opts: allAv(r).map(a => a.x.u), cb: us => { const t = find(r, us[0]); if (t) f(t.c); } });
  if (x.id.startsWith('BT01-')) return fxSummon01(r, i, x);
  switch (x.id) {
    case 'SD01-001': pickAv('จุติ: เลือก Avatar 1 ใบ POWER -4 จนจบเทิร์น', t => { addTp(t, -4); log(r, '✨ ' + nmOf(t) + ' POWER -4'); }); break;
    case 'SD01-003': pickAv('จุติ: เลือก Avatar 1 ใบ POWER +3 จนจบเทิร์น', t => { addTp(t, 3); log(r, '✨ ' + nmOf(t) + ' POWER +3'); }); break;
    case 'SD01-005': draw(r, me, 3); log(r, '✨ ' + me.name + ': จั่ว 3 ใบ'); break;
    case 'SD02-001': tutor(r, i, c => isAv(c) && B[c.id].n === 'ฮอล', 'ฮอล'); break;
    case 'SD02-002': tutor(r, i, c => isAv(c) && B[c.id].n === 'นาย', 'นาย'); break;
    case 'SD02-003': tutor(r, i, c => isAv(c) && B[c.id].n === 'กุ่ย', 'กุ่ย'); break;
    case 'SD02-004': { const fin = us => { us.forEach(u => { const k = me.hell.findIndex(c => c.u === u); me.deck.push(...me.hell.splice(k, 1)); }); shuf(me.deck); draw(r, me, 1); log(r, '✨ ' + me.name + ': คืน ' + us.length + ' ใบเข้า Deck แล้วจั่ว 1'); };
      ask(r, i, { text: 'จุติ: เลือก กุ่ย/ฮอล/นาย จากนรก ได้สูงสุด 3 ใบ กลับเข้า Deck', opts: trioHell(r, i), n: 3, min: 0, cb: fin, none: () => fin([]) }); break; }
    case 'SD02-005': ask(r, i, { text: 'จุติ: เลือก กุ่ย/ฮอล/นาย จากนรก ได้สูงสุด 3 ใบ ขึ้นมือ', opts: trioHell(r, i), n: 3, min: 0, cb: us => { us.forEach(u => { const k = me.hell.findIndex(c => c.u === u); me.hand.push(...me.hell.splice(k, 1)); }); log(r, '✨ ' + me.name + ': นำ ' + us.length + ' ใบจากนรกขึ้นมือ'); } }); break;
    case 'SD03-001': ask(r, i, { text: 'จุติ: เลือก Avatar นายนิรยบาล ในนรก 1 ใบ อัญเชิญลงสนาม', opts: me.hell.filter(c => isAv(c) && B[c.id].n.startsWith('นายนิรยบาล')).map(c => c.u), cb: us => { const c = me.hell.find(h => h.u === us[0]); c && summonFree(r, i, c); } }); break;
  }
}
function fxAtk(r, i, a) { if (a.id === 'SD01-002') { addTp(a, 2); log(r, '✨ พระนารายณ์ POWER +2'); } if (a.id === 'SD03-002') { mill(r, i, 2, a); addTp(a, 1); log(r, '✨ พ่อจีจ้า POWER +1'); } }
/* ===== Magic ===== */
const sym = s => (r) => allAv(r).filter(a => symOf(a.x) === s).map(a => a.x.u);
const handAv = f => (r, i) => r.p[i].hand.filter(c => isAv(c) && f(c)).map(c => c.u);
const trioHandOrField = name => (r, i) => [...r.p[i].hand, ...r.p[i].av].filter(c => isAv(c) && B[c.id].n === name).map(c => c.u);
const trioAny = (r, i) => [...r.p[i].hand, ...r.p[i].av].filter(c => isAv(c) && TRIO.includes(B[c.id].n)).map(c => c.u);
const MG = {
  'SD01-016': { mod: 1 }, 'SD02-017': { mod: 1 }, 'SD03-018': { mod: 1 },
  'SD01-017': { react: 'summon', run: (r, i, cx) => destroyAv(r, cx.ev.u) },
  'SD01-018': { steps: [{ key: 'c', pay: 1, text: 'ทิ้ง Avatar เทพ จากมือ 1 ใบ', opts: handAv(c => B[c.id].s === 'เทพ') }], run: (r, i) => { draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD01-019': { steps: [{ key: 't', text: 'เลือก Avatar เทพ 1 ใบ POWER +2 จนจบเทิร์น', opts: sym('เทพ') }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { addTp(t.c, 2); log(r, '✨ ' + nmOf(t.c) + ' POWER +2'); } } },
  'SD01-020': {}, 'SD02-020': {}, 'SD03-019': {},
  'SD02-016': { react: 1, steps: TRIO.map((n, k) => ({ key: 'k' + k, pay: 1, text: 'ส่ง Avatar "' + n + '" 1 ใบ จากมือ/สนามเรา ลงนรก', opts: trioHandOrField(n) })),
    run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'SD02-018': { steps: [{ key: 'c', pay: 1, text: 'ทิ้ง กุ่ย/ฮอล/นาย จากมือ 1 ใบ', opts: handAv(c => TRIO.includes(B[c.id].n)) }], run: (r, i) => { draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD02-019': { react: 1, steps: [{ key: 'c', pay: 1, text: 'ส่ง กุ่ย/ฮอล/นาย 1 ใบ จากมือ/สนามเรา ลงนรก', opts: trioAny }, { key: 't', text: 'เลือก Avatar บนสนาม 1 ใบ นำกลับขึ้นมือ', opts: r => allAv(r).map(a => a.x.u) }],
    run: (r, i, cx) => { const t = cx.pick.t && find(r, cx.pick.t[0]); if (t && t.z === 'av') { log(r, '✨ นำ ' + nmOf(t.c) + ' กลับขึ้นมือ'); bounce(r, t.c.u); } } },
  'SD03-016': { steps: [{ key: 'c', pay: 1, text: 'ส่ง Avatar นรก จากมือ 1 ใบ ลงนรก', opts: handAv(c => B[c.id].s === 'นรก') }], run: (r, i) => { mill(r, i, 2, { id: 'MAGIC' }); draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD03-017': { run: (r, i) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && B[c.id].n.startsWith('นายนิรยบาล') && B[c.id].c <= 4).map(c => c.u);
    const fin = u => { if (u != null) { const k = p.deck.findIndex(c => c.u === u), [c] = p.deck.splice(k, 1); p.hand.push(c); p.noCost = p.noCost || []; p.noCost.push(B[c.id].n); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' ขึ้นมือ (ใช้เป็น Cost ไม่ได้อีก)'); } else log(r, '✨ ค้น Deck ไม่พบ'); shuf(p.deck); };
    if (!L.length) return fin(null); ask(r, i, { text: 'เลือก นายนิรยบาล Cost ≤ 4 จาก Deck 1 ใบ ขึ้นมือ', opts: L, cb: us => fin(us[0]) }); } },
  'SD03-020': { react: 'summon', steps: [{ key: 'c', pay: 1, text: 'ส่ง Avatar นรก จากมือ ที่ Cost ≥ Avatar ที่อัญเชิญ ลงนรก', opts: (r, i, cx) => handAv(c => B[c.id].s === 'นรก' && B[c.id].c >= (cx.ev.cost || 0))(r, i) }],
    run: (r, i, cx) => { mill(r, i, 2, { id: 'MAGIC' }); destroyAv(r, cx.ev.u); } },
};
Object.assign(MG, {
  'BT01-035': { run: (r, i) => { mill(r, i, 3, { id: 'MAGIC' }); mill(r, 1 - i, 3); } },
  'BT01-036': { run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'BT01-037': { steps: [{ key: 'c', pay: 1, text: 'เซ่นไหว้: ส่ง Avatar สัตว์ บนสนามเรา 1 ใบ ลงนรก', opts: (r, i) => r.p[i].av.filter(a => symOf(a) === 'สัตว์').map(a => a.u) }],
    run: (r, i) => { draw(r, r.p[i], 3); r.g.lim = r.g.lim || {}; r.g.lim[i] = 'สัตว์'; log(r, '✨ ' + r.p[i].name + ': จั่ว 3 ใบ — เทิร์นนี้อัญเชิญได้เฉพาะ Avatar สัตว์'); } },
  'BT01-038': { run: (r, i) => { draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'BT01-039': { react: 'atk', run: (r) => { const p = r.g.pend; if (p && p.k === 'atk') { const f = find(r, p.u); if (f) { log(r, '✨ ส่ง ' + nmOf(f.c) + ' ลงนรก'); sendHell(r, p.u); } } } },
  'BT01-040': { auto: 1 }, 'BT01-042': { auto: 1 },
  'BT01-041': { react: 'cast', run: (r) => { const p = r.g.pend; if (p && p.ev) cancelCast(r, p.ev); } },
  'BT01-043': {}, 'BT01-044': {}, 'BT01-045': {}, 'BT01-046': {}, 'BT01-047': {}, 'BT01-048': {}, 'BT01-049': {}, 'BT01-050': {},
});
function reactOK(r, i, c, def) { const p = r.g.pend; if (!p || p.who !== i) return false; if (def.react === 'summon') return !!(p.ev && p.ev.k === 'summon'); if (def.react === 'atk') return p.k === 'atk'; if (def.react === 'cast') return !!(p.ev && p.ev.k === 'cast'); return true; }
function startCast(r, i, f, c, def) {
  const g = r.g, ctx = { ev: g.pend && g.pend.ev, pick: {}, card: f.c };
  const steps = def.steps || (def.mod ? [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ' + c.n, opts: r => allAv(r).map(a => a.x.u) }] : []);
  for (const s of steps) if (s.opts(r, i, ctx).length < (s.min == null ? (s.n || 1) : s.min)) E('เงื่อนไขการใช้ไม่ครบ');
  let k = 0;
  const next = () => { if (k >= steps.length) return castFinal(r, i, f.c, c, def, ctx, steps);
    const s = steps[k++], used = Object.values(ctx.pick).flat();
    ask(r, i, { text: s.text, opts: s.opts(r, i, ctx).filter(u => !used.includes(u)), n: s.n || 1, min: s.min, cancel: true, cb: us => { ctx.pick[s.key] = us; next(); }, none: next }); };
  next();
}
function castFinal(r, i, card, c, def, ctx, steps) {
  const g = r.g, me = r.p[i];
  const z = find(r, card.u); if (!z || z.i !== i || !['hand', 'hell'].includes(z.z)) E('การ์ดไม่อยู่แล้ว');
  steps.forEach(s => s.pay && (ctx.pick[s.key] || []).forEach(u => sendHell(r, u)));
  g.used[i][c.st] = 1; take(r, card.u); let t = null;
  if (def.mod) { t = find(r, ctx.pick.tg[0]); if (!t || t.z !== 'av') E('เป้าหมายหาย'); card.at = t.c.u; me.mg.push(card); }
  else if (c.st === 'Land') { if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: card, o: i, n: g.n }; }
  else me.hell.push(card);
  ev(r, c.id); log(r, me.name + ' ร่าย ' + c.st + ': ' + c.n + (t ? ' → ' + nmOf(t.c) : ''));
  if (c.st === 'React') { def.run && def.run(r, i, ctx); const p = g.pend; if (p && p.who === i) { g.pend = null; if (p.k === 'atk') resolveAtk(r, p); } }
  else { if (def.run) { const fn = () => def.run(r, i, ctx); fn.cu = card.u; g.q.push(fn); } open(r, { who: 1 - i, k: 'ev', ev: { k: 'cast', id: c.id, i, cu: card.u } }); }
}

/* ===================== BT01 ===================== */
const slotsOK = p => p.av.filter(x => !x.tk).length < 4 && p.av.length < 6;
function toHellM(r, p, g) { p.hell.push(g); if (g.id === 'BT01-045' || g.id === 'BT01-046') flipOwnLife(r, r.p.indexOf(p)); }
function flipOwnLife(r, i) { const p = r.p[i], k = p.life.findIndex(l => !l.up); if (k < 0) return; p.life[k].up = 1; fx({ k: 'life', i }); log(r, '❤ ' + p.name + ': หงาย LIFE ใบบนสุด 1 ใบ (' + B[p.life[k].id].n + ')'); if (p.life.every(l => l.up)) log(r, p.name + ' สาหัส!'); }
function destroyTrig(r, c, h) {
  const p = r.p[h];
  if (c.id === 'BT01-012') { const k = p.life.findIndex(l => l.up); if (k >= 0) { p.life[k].up = 0; log(r, '✨ ลูกแม่ศรีนวล: ' + p.name + ' คว่ำ LIFE ที่หงายอยู่ 1 ใบ กลับ'); } }
  if (c.id === 'BT01-013') ask(r, h, { text: 'คำสั่งเสีย: เลือก Avatar สัตว์ Cost ≤ 4 จากนรก ขึ้นมือ', opts: p.hell.filter(x => isAv(x) && B[x.id].s === 'สัตว์' && B[x.id].c <= 4).map(x => x.u),
    cb: us => { const k = p.hell.findIndex(x => x.u === us[0]); if (k >= 0) { p.hand.push(...p.hell.splice(k, 1)); log(r, '✨ ' + p.name + ': นำ Avatar สัตว์จากนรกขึ้นมือ'); } } });
}
function scout(r, i, n, pred, label) {
  const p = r.p[i], top = p.deck.slice(-n).reverse(); if (!top.length) return; const ids = top.map(c => c.u);
  log(r, '🔍 ' + p.name + ' สอดแนม ' + top.length + ' ใบ: ' + top.map(c => B[c.id].n).join(', '));
  const fin = pick => {
    if (pick != null) { const k = p.deck.findIndex(c => c.u === pick), [c] = p.deck.splice(k, 1); p.hand.push(c); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' ขึ้นมือ'); }
    const rest = ids.filter(u => u !== pick && p.deck.some(c => c.u === u));
    const place = us => { us.forEach(u => { const k = p.deck.findIndex(c => c.u === u), [c] = p.deck.splice(k, 1); p.deck.unshift(c); }); log(r, '✨ ' + p.name + ': เรียงการ์ดที่เหลือไว้ใต้ Deck'); };
    if (rest.length > 1) ask(r, i, { text: 'เรียงการ์ดที่เหลือไว้ใต้ Deck (เลือกตามลำดับ ใบแรก = บนสุดของกองล่าง)', opts: rest, n: rest.length, min: rest.length, cb: place }); else place(rest);
  };
  ask(r, i, { text: 'สอดแนม: เลือก ' + label + ' 1 ใบ ขึ้นมือ (ไม่เลือกก็ได้)', opts: top.filter(pred).map(c => c.u), n: 1, min: 0, cb: us => fin(us.length ? us[0] : null), none: () => fin(null) });
}
function summonDeck(r, i, u) {
  const p = r.p[i]; if (!slotsOK(p)) return false; const k = p.deck.findIndex(c => c.u === u); if (k < 0) return false;
  const [c] = p.deck.splice(k, 1); c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; p.av.push(c); ev(r, c.id); log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + ' จาก Deck'); return true;
}
function steal(r, i, u) {
  const f = find(r, u), me = r.p[i]; if (!f || f.z !== 'av' || f.i === i) return false;
  if (!slotsOK(me)) { log(r, 'Avatar เต็ม เปลี่ยนการควบคุมไม่ได้'); return false; }
  r.p[f.i].av.splice(f.k, 1); if (f.c.oo == null) f.c.oo = f.i; f.c.tired = true; me.av.push(f.c); log(r, '✨ ' + me.name + ' ยึด ' + nmOf(f.c) + ' มาฝั่งเรา (สภาพนอน)'); return true;
}
function destroyMg(r, u) {
  const f = find(r, u); if (!f || f.z !== 'mg') return; const c = f.c, own = r.p[f.i];
  take(r, u); toHellM(r, own, c); log(r, '💥 ทำลาย Magic ' + B[c.id].n);
  if (c.id === 'BT01-042' && c.at != null) { const t = find(r, c.at); if (t && t.z === 'av') { log(r, '✨ ริกกี้ ถูกทำลาย: ' + nmOf(t.c) + ' กลับขึ้นมือเจ้าของ'); bounce(r, t.c.u); } }
}
function cancelCast(r, e) {
  const g = r.g; g.q = g.q.filter(f => f.cu !== e.cu);
  const f = find(r, e.cu); if (f && f.z === 'mg') { take(r, e.cu); toHellM(r, r.p[f.i], f.c); }
  if (g.land && g.land.c.u === e.cu) { r.p[g.land.o].hell.push(g.land.c); g.land = null; }
  log(r, '✨ ยกเลิกการใช้ Magic ใบนั้น');
}
const guardable = (r, x) => { const f = find(r, x.u); if (!f || f.z !== 'av' || (r.g.prot && r.g.prot[x.u])) return false; return !r.g.used[f.i].React && r.p[f.i].hand.some(c => c.id === 'BT01-040'); };
function guardAsk(r, list, done) {
  const by = {}; list.filter(x => guardable(r, x)).forEach(x => { const f = find(r, x.u); (by[f.i] = by[f.i] || []).push(x); });
  const owners = Object.keys(by).map(Number);
  const nx = () => { if (!owners.length) return done(); const i = owners.shift(), xs = by[i];
    ask(r, i, { yn: true, text: 'ใช้ หมอมาแล้ววว (React) ไม่ให้ ' + xs.map(nmOf).join(', ') + ' ถูกทำลาย?', cb: y => {
      if (y && !r.g.used[i].React) { const p = r.p[i], k = p.hand.findIndex(c => c.id === 'BT01-040'); if (k >= 0) { const [c] = p.hand.splice(k, 1); p.hell.push(c); r.g.used[i].React = 1; r.g.prot = r.g.prot || {}; xs.forEach(x => r.g.prot[x.u] = 1); ev(r, c.id); log(r, '✨ ' + p.name + ' ใช้ React: ' + B[c.id].n); } }
      nx(); } }); };
  nx();
}
function postBattle(r, list) {
  const g = r.g;
  const nx = () => { if (!list.length || g.over) return; const i = list.shift(), p = r.p[i], o = r.p[1 - i];
    const T = o.av.filter(a => a.tired), k = p.hand.findIndex(c => c.id === 'BT01-042');
    if (k < 0 || g.used[i].React || !T.length || !slotsOK(p)) return nx();
    ask(r, i, { yn: true, text: 'Avatar ของเราถูกทำลายจากการต่อสู้ — ใช้ ริกกี้ นักปลอมแปลง (React) ยึด Avatar สภาพนอนของศัตรู 1 ใบ?', cb: y => { if (!y) return nx();
      ask(r, i, { text: 'เลือก Avatar สภาพนอนของศัตรู ที่จะยึด', opts: T.map(a => a.u), cancel: true, onCancel: nx, cb: us => {
        const kk = p.hand.findIndex(c => c.id === 'BT01-042'); if (kk < 0) return nx(); const [c] = p.hand.splice(kk, 1); g.used[i].React = 1;
        if (steal(r, i, us[0])) { c.at = us[0]; p.mg.push(c); ev(r, c.id); log(r, '✨ ' + p.name + ' ใช้ React: ' + B[c.id].n); } else p.hand.push(c);
        nx(); } }); } }); };
  nx();
}
const hasShield = (r, x) => !x.tk && (x.id === 'BT01-014' || r.p.some(q => q.mg.some(m => m.at === x.u && m.id === 'BT01-044')));
function atkDecl(r, pa) {
  const g = r.g, i = pa.ai, a = find(r, pa.u); if (!a || a.z !== 'av') { pa.cancel = 1; return; }
  if (g.land && g.land.c.id === 'BT01-047') { log(r, '🏠 เขาไกรลาสเอียง: ' + r.p[i].name + ' ธรณีสูบ 2 ใบ'); mill(r, i, 2); }
  if (a.c.id === 'BT01-001' && pa.tk === 'av') { const t = find(r, pa.tg); if (t && t.z === 'av' && symOf(t.c) === 'เทพ') { log(r, '✨ นนทก นิ้วเพชร: ทำลาย ' + nmOf(t.c)); destroyAv(r, t.c.u); } }
  g.q.unshift(() => oodStep(r, pa)); g.q.unshift(() => shieldStep(r, pa));
}
function shieldStep(r, pa) {
  if (pa.cancel) return; const d = 1 - pa.ai, p = r.p[d];
  const L = p.av.filter(x => !x.tired && hasShield(r, x) && x.u !== pa.tg).map(x => x.u); if (!L.length) return;
  ask(r, d, { text: 'โล่มนุษย์: เลือก Avatar ที่จะนอนลงและรับการโจมตีแทน (ไม่เลือก = ไม่ใช้)', opts: L, n: 1, min: 0, cb: us => {
    if (!us.length) return; const t = find(r, us[0]); if (!t) return; t.c.tired = true; pa.tg = t.c.u; pa.tk = 'av'; log(r, '🛡 โล่มนุษย์: ' + nmOf(t.c) + ' รับการโจมตีแทน'); } });
}
function oodStep(r, pa) {
  if (pa.cancel || pa.tk !== 'av') return; const d = 1 - pa.ai, p = r.p[d], t = p.av.find(x => x.u === pa.tg);
  if (!t || t.id !== 'BT01-005' || p.av.length < 2) return;
  ask(r, d, { yn: true, text: 'อู๊ดลูกเสือ ถูกโจมตี — ส่ง Avatar ใบอื่นของเราลงนรก เพื่อยกเลิกการโจมตี?', cb: y => { if (!y) return;
    ask(r, d, { text: 'เลือก Avatar ใบอื่น 1 ใบ ส่งลงนรก', opts: p.av.filter(x => x.u !== t.u).map(x => x.u), cancel: true, cb: us => { sendHell(r, us[0]); pa.cancel = 1; log(r, '✨ อู๊ดลูกเสือ: ยกเลิกการโจมตี'); } }); } });
}
function enterEnd(r, i) {
  const p = r.p[i];
  p.av.forEach(a => { if (a.id === 'BT01-007') { a.pw = (a.pw || 0) + 1; fx({ k: 'buff', u: a.u, v: 1 }); log(r, '✨ แม่กบ POWER +1'); }
    if (a.tired && r.p.some(q => q.mg.some(m => m.at === a.u && m.id === 'BT01-043'))) { a.tired = false; log(r, '✨ น้ำชูกำลัง: ' + nmOf(a) + ' กลับสภาพตื่น'); } });
}
const USE = {
  'BT01-050': (r, i, land) => {
    const g = r.g, p = r.p[i]; if (!p.hand.length) E('ไม่มีการ์ดในมือให้ทิ้ง');
    ask(r, i, { text: 'โรงบาล: เลือกการ์ดในมือ 1 ใบ ทิ้ง', opts: p.hand.map(c => c.u), cancel: true, cb: us => {
      const k = p.hand.findIndex(c => c.u === us[0]); if (k < 0) return; const [c] = p.hand.splice(k, 1); p.hell.push(c); g.used[i]['use' + land.id] = 1; log(r, '🏥 โรงบาล: ' + p.name + ' ทิ้ง ' + B[c.id].n);
      ask(r, i, { text: 'โรงบาล: เลือก Avatar Cost ≤ 3 จากนรก ขึ้นมือ', opts: p.hell.filter(x => isAv(x) && B[x.id].c <= 3).map(x => x.u), cb: u2 => {
        const k2 = p.hell.findIndex(x => x.u === u2[0]); if (k2 < 0) return; const [h] = p.hell.splice(k2, 1); p.hand.push(h); p.ban = p.ban || {}; p.ban[B[h.id].n] = g.n;
        log(r, '🏥 โรงบาล: นำ ' + B[h.id].n + ' ขึ้นมือ (อัญเชิญไม่ได้ในเทิร์นนี้)'); } }); } });
  },
};
function fxSummon01(r, i, x) {
  const me = r.p[i], nm = c => B[c.id].n;
  switch (x.id) {
    case 'BT01-003': scout(r, i, 5, c => B[c.id].t === 'Magic' && B[c.id].st === 'Land', 'Land Magic'); break;
    case 'BT01-006': tutor(r, i, c => B[c.id].t === 'Magic' && B[c.id].st === 'Modification' && nm(c).startsWith('น้ำ'), 'Modification Magic "น้ำ"'); break;
    case 'BT01-009': { if (!me.av.some(a => nmOf(a) === 'รัททาทุย นางพญา')) break; let left = 5;
      const step = () => { const opts = me.deck.filter(c => isAv(c) && nm(c).includes('รัททาทุย') && B[c.id].c <= left).map(c => c.u); if (!opts.length || !slotsOK(me)) { shuf(me.deck); return; }
        ask(r, i, { text: 'จุติ: อัญเชิญ รัททาทุย จาก Deck (Cost คงเหลือ ' + left + ') — ไม่เลือก = จบ', opts, n: 1, min: 0, cb: us => { if (!us.length) { shuf(me.deck); return; } const c = me.deck.find(y => y.u === us[0]); left -= B[c.id].c; summonDeck(r, i, us[0]); step(); } }); };
      step(); break; }
    case 'BT01-011': ask(r, i, { text: 'จุติ: เลือก Magic บนสนาม 1 ใบ ทำลาย', opts: [...r.p[0].mg, ...r.p[1].mg].map(c => c.u), cb: us => destroyMg(r, us[0]) }); break;
    case 'BT01-016': scout(r, i, 5, c => nm(c) === 'พญายม' || nm(c).startsWith('นายนิรยบาล'), '"พญายม" หรือ "นายนิรยบาล"'); break;
    case 'BT01-017': ask(r, i, { text: 'จุติ: เลือก Avatar ศัตรู 1 ใบ ยึดมาฝั่งเรา (สภาพนอน) — ไม่เลือกก็ได้', opts: r.p[1 - i].av.map(a => a.u), n: 1, min: 0, cb: us => us.length && steal(r, i, us[0]) }); break;
    case 'BT01-019': scout(r, i, 5, c => nm(c) === 'สิมพลีนรก', '"สิมพลีนรก"'); break;
    case 'BT01-020': ask(r, i, { text: 'จุติ: เลือก Avatar ผี จาก Deck 1 ใบ อัญเชิญลงสนาม', opts: me.deck.filter(c => isAv(c) && B[c.id].s === 'ผี').map(c => c.u), cb: us => { summonDeck(r, i, us[0]); shuf(me.deck); }, none: () => shuf(me.deck) }); break;
    case 'BT01-021': tutor(r, i, c => isAv(c) && nm(c).includes('ตำรวจสัมภเวสี') && !nm(c).startsWith('สารวัตร'), 'ตำรวจสัมภเวสี'); break;
  }
}

const lifeFx = (r, i, id) => { const c = B[id], p = r.p[i]; if (/จั่วการ์ด 1 ใบ/.test(c.e) && /main phase/i.test(c.e)) { draw(r, p, 1); log(r, '❤ ' + c.n + ': ' + p.name + ' จั่ว 1 ใบ'); } else log(r, '❤ LIFE ' + c.n + ': ' + c.e + ' (ใช้เอง)'); };

const BAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'banlist.json'), 'utf8'));
function checkBan(main) {
  const cnt = {}; main.forEach(i => { const n = B[i].n; cnt[n] = (cnt[n] || 0) + 1; if (B[i].o === 'ลำเอียง') E('ห้ามใช้การ์ดลำเอียง: ' + n); });
  for (const n in cnt) { if (BAN.ban.includes(n)) E('การ์ดบาป ห้ามใส่: ' + n); if (BAN.lim[n] && cnt[n] > BAN.lim[n]) E('จำกัด ' + BAN.lim[n] + ' ใบ: ' + n); }
  for (const [a, b] of BAN.pairs) if (cnt[a] && cnt[b]) E('เลือกใส่ได้อย่างใดอย่างหนึ่ง: ' + a + ' / ' + b);
  const only = main.find(i => B[i].o === 'Only #1');
  for (const c of (BAN.cond || [])) {
    if (c.if && cnt[c.if]) {
      if (c.avatarsText) main.forEach(i => { const d = B[i]; if (d.t === 'Avatar' && !d.n.includes(c.avatarsText) && !(d.e || '').includes(c.avatarsText)) E(c.msg + ' — ผิดที่: ' + d.n); });
      if (c.onlySymbol && (!only || B[only].s !== c.onlySymbol)) E(c.msg);
    }
    if (c.ifOnlyName && only && B[only].n.includes(c.ifOnlyName) && c.avatarsSymbol) main.forEach(i => { const d = B[i]; if (d.t === 'Avatar' && d.s !== c.avatarsSymbol && !(d.e || '').includes('symbol ' + c.avatarsSymbol)) E(c.msg + ' — ผิดที่: ' + d.n); });
  }
}
function mkDeck(text, rand, skip, ban) {
  let main = [], life = [];
  if (rand) {
    const col = shuf(['แดง','ฟ้า','เขียว','ม่วง'])[0], cnt = {};
    const ok = c => c.t !== 'Life' && !c.o && (!c.col || c.col === col);
    const only = shuf(CARDS.filter(c => c.o === 'Only #1' && c.t === 'Avatar' && (!c.col || c.col === col)))[0];
    if (only) { main.push(only.id); cnt[only.n] = 1; }
    for (const c of shuf(CARDS.filter(ok))) { if (main.length >= 50) break; const k = cnt[c.n] || 0; if (k < 4) { cnt[c.n] = k + 1; main.push(c.id); } }
    const seen = new Set();
    for (const c of shuf(CARDS.filter(c => c.t === 'Life'))) if (life.length < 5 && !seen.has(c.n)) { seen.add(c.n); life.push(c.id); }
  } else {
    for (const m of text.matchAll(/([A-Za-z0-9]+-\d+)\s*(?:[xX*]\s*(\d+))?/g)) {
      const c = B[m[1].toUpperCase()]; if (!c) E('ไม่พบการ์ด ' + m[1]);
      for (let i = 0; i < (+m[2] || 1); i++) (c.t === 'Life' ? life : main).push(c.id);
    }
    if (!skip) {
      if (main.length !== 50) E('Main ต้อง 50 ใบ (มี ' + main.length + ')');
      if (life.length !== 5 || new Set(life.map(i => B[i].n)).size !== 5) E('LIFE 5 ใบชื่อไม่ซ้ำ');
      const cnt = {}; main.forEach(i => cnt[B[i].n] = (cnt[B[i].n] || 0) + 1);
      for (const i of main) if (cnt[B[i].n] > (B[i].lim || (B[i].o === 'Only #1' ? 1 : 4))) E('ซ้ำเกิน: ' + B[i].n);
      if (main.filter(i => B[i].o === 'Only #1').length !== 1) E('ต้องมี Only#1 1 ใบ');
      if (ban) checkBan(main);
    }
  }
  return { main, life };
}
const view = (r, i) => {
  const g = r.g, pub = p => ({ name: p.name, eq: p.eq || {}, av: p.av.map(x => ({ ...x, cp: P(r, x) })), mg: p.mg, co: p.co, hell: p.hell, dk: p.dk, deck: p.deck.length, hn: p.hand.length, life: p.life.map(l => l.up ? l : { up: 0 }) });
  return { i, dc: g.dc || null, md: r.p.map(p => !!p.m), me: { ...pub(r.p[i]), hand: r.p[i].hand }, op: pub(r.p[1 - i]), mine: g.turn === i, phase: g.phase, land: g.land, log: g.log.slice(-40), over: g.over, ev: g.ev || null, dw: g.dw, dr: g.dr || null, bt: g.bt || null, fx: g.fxl || [], tn: g.n, dl: r.p.map(p => p.dc ? Math.max(0, REJOIN_MS - (Date.now() - p.dc)) : 0), ru: g.used && g.used[i] && g.used[i].React ? 1 : 0, ask: g.ask ? { mine: g.ask.who === i, text: g.ask.text, opts: g.ask.who === i ? g.ask.opts : [], n: g.ask.n, min: g.ask.min, cancel: g.ask.cancel, yn: g.ask.yn, cards: g.ask.who === i ? g.ask.cards : null } : null, won: g.over ? (g.win == null ? null : g.win === i) : null, pend: g.pend ? { mine: g.pend.who === i, ev: g.pend.ev ? { k: g.pend.ev.k, id: g.pend.ev.id } : null, k: g.pend.k, until: g.pend.until, u: g.pend.u, tg: g.pend.tg, ai: g.pend.ai } : null };
};
const sview = r => { const v = view(r, 0); v.spec = 1; v.mine = false; v.tp = r.g.turn; v.me.hn = r.p[0].hand.length; v.me.hand = []; v.ru = 1; if (v.ask) v.ask = { ...v.ask, mine: false, opts: [], cards: null }; if (v.pend) v.pend = { ...v.pend, mine: false }; return v; };
const bc = r => { (r.spec || []).forEach(w => { if (r.g && w.readyState === 1) w.send(JSON.stringify({ t: 's', s: sview(r) })); }); bc0(r); };
const bc0 = r => r.p.forEach((p, i) => {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(r.g ? { t: 's', s: view(r, i) } : { t: 'lobby', owner: r.p[0] && r.p[0].name, exp: r.exp ? Math.max(0, r.exp - Date.now()) : 0, clock: r.cfg.clock, react: r.cfg.react, ban: r.cfg.ban, exs: r.cfg.exs !== false, players: r.p.map(x => ({ name: x.name, ready: !!x.deck, dk: x.last ? (x.last.pre ? 'pre:' + x.last.pre : 'mine:' + x.last.mine) : null })) }));
});
const log = (r, s) => r.g.log.push(s);
const ev = (r, id) => { r.g.ev = { n: (r.g.ev ? r.g.ev.n : 0) + 1, id }; };
const draw = (r, p, n) => { for (let k = 0; k < n && p.deck.length; k++) p.hand.push(p.deck.pop()); if (!p.deck.length && !r.g.over) { r.g.over = p.name + ' เด็คหมด แพ้!'; r.g.win = r.p ? 1 - r.p.indexOf(p) : null; } };
const pw = x => (x.tk ? x.tk.p : B[x.id].p) + x.pw;
const find = (r, u) => { for (let i = 0; i < 2; i++) for (const z of ZN) { const k = r.p[i][z].findIndex(c => c.u === u); if (k >= 0) return { i, z, k, c: r.p[i][z][k] }; } return null; };
const release = (r, u) => r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) if (p.mg[k].at === u) { const [g] = p.mg.splice(k, 1); delete g.at; toHellM(r, p, g); } });
const take = (r, u) => { const f = find(r, u); if (!f) E('ไม่พบการ์ด'); r.p[f.i][f.z].splice(f.k, 1); if (f.z === 'av') release(r, u); delete f.c.at; return f; };
const kill = (r, i, u) => {
  if (r.g.prot && r.g.prot[u]) { delete r.g.prot[u]; const f0 = find(r, u); log(r, '🛡 ' + (f0 ? nmOf(f0.c) : 'Avatar') + ' ไม่ถูกทำลาย'); return false; }
  const f = take(r, u); fx({ k: 'die', u, id: f.c.tk ? null : f.c.id, nm: f.c.tk ? f.c.tk.n : null }); const h = homeOf(f);
  if (!f.c.tk) { r.p[h].hell.push(f.c); delete f.c.oo; r.g.q.push(() => destroyTrig(r, f.c, h)); } return true; };

function payOK(c, pay, me) {
  if (!c.c) { if (pay.length) E('Cost 0 ไม่ต้องจ่าย'); return; }
  const gs = pay.map(x => { const d = B[x.id]; if (me && me.noCost && me.noCost.includes(d.n)) E('ใช้เป็น Cost ไม่ได้: ' + d.n); if (!d.g) E('การ์ด Gem 0 ใช้จ่ายไม่ได้'); if (d.gc && d.gc !== c.col) E('สี Gem ไม่ตรง: ' + d.n); return d.g; });
  const sum = gs.reduce((a, b) => a + b, 0);
  if (sum < c.c) E('Gem ไม่พอ (' + sum + '/' + c.c + ')');
}
function startTurn(r) {
  const g = r.g, p = r.p[g.turn]; g.used = [{}, {}]; g.ac = {}; g.lim = null; g.prot = {};
  p.av.forEach(a => a.tired = false);
  const b4 = p.hand.length; draw(r, p, g.n === 0 ? 2 : p.hand.length < 3 ? 3 - p.hand.length : 1);
  const got = p.hand.length - b4; g.dr = { n: ++DRN, who: g.turn, c: got };
  g.phase = 'main'; log(r, '— เทิร์น ' + p.name + ' —'); log(r, p.name + ' จั่ว ' + got + ' ใบ');
  if (g.land && g.land.c.id === 'BT01-049' && g.n - (g.land.n || 0) >= 4) { r.p[g.land.o].hell.push(g.land.c); log(r, '🏠 มวยทะเล หมดอายุ (ครบ 4 เทิร์น) ลงนรก'); g.land = null; }
  if (!p.fd) { p.fd = 1; const w = g.turn; if (got > 0 && p.deck.some(c => c.id === 'BT01-008')) g.q.push(() => ask(r, w, { yn: true, text: 'Draw Phase แรก: นำ รัททาทุย นางพญา จาก Deck ขึ้นมือ แทนการจั่ว 1 ใบ?', cb: y => {
    if (!y) return; const k = p.deck.findIndex(c => c.id === 'BT01-008'), last = p.hand.pop(); if (k < 0 || !last) { last && p.hand.push(last); return; }
    p.deck.push(last); const [q] = p.deck.splice(p.deck.findIndex(c => c.id === 'BT01-008'), 1); p.hand.push(q); shuf(p.deck); log(r, '✨ ' + p.name + ': นำ รัททาทุย นางพญา ขึ้นมือแทนการจั่ว'); } })); }
  (p.lf || []).splice(0).forEach(id => lifeFx(r, g.turn, id));
}
function hit(r, d, atk) {
  const k = d.life.findIndex(l => !l.up);
  if (k < 0) { r.g.over = atk.name + ' ชนะ!'; r.g.win = r.p.indexOf(atk); return 'KO'; }
  d.life[k].up = 1; fx({ k: 'life', i: r.p.indexOf(d) }); (d.lf = d.lf || []).push(d.life[k].id); const c = B[d.life[k].id];
  log(r, d.name + ' LIFE: ' + c.n + ' — ' + c.e);
  if (d.life.every(l => l.up)) log(r, d.name + ' สาหัส!');
  return d.life[k].id;
}

function act(r, i, m) {
  CR = r; const g = r.g, me = r.p[i], op = r.p[1 - i], mine = g.turn === i;
  if (g.over && m.t !== 'chat') E('เกมจบแล้ว');
  if (g.ask) { if (!['chat', 'pick', 'surrender'].includes(m.t)) E('รอเลือกให้เสร็จก่อน'); if (m.t === 'pick' && g.ask.who !== i) E('รออีกฝ่ายเลือก'); }
  else if (g.pend && !['chat','pass','surrender'].includes(m.t) && !(i === g.pend.who && ['dview','dmove','dpos','dshuf','cast','discard'].includes(m.t))) E('รอ React ก่อน');
  const mainOnly = () => { if (!mine || g.phase !== 'main') E('เฉพาะ Main Phase'); };
  const own = u => { const f = find(r, u); if (!f || f.i !== i) E('ไม่ใช่การ์ดของเรา'); return f; };
  const pays = () => (m.pay || []).map(u => { if (u === m.u) E('ใช้การ์ดใบนี้เป็น Cost ของตัวเองไม่ได้'); const f = own(u); if (f.z !== 'hand') E('ต้องจ่ายด้วยการ์ดในมือ'); return f.c; });
  switch (m.t) {
    case 'mull': {
      if (g.phase !== 'mull' || me.m) E('เปลี่ยนมือไม่ได้');
      if (i !== g.turn && !r.p[g.turn].m) E('รอผู้เล่นที่เริ่มก่อนเปลี่ยนมือเสร็จก่อน');
      me.m = true;
      const us = [...new Set((m.us||[]).map(Number))];
      const cs = us.map(u => { const f = own(u); if (f.z !== 'hand') E('ไม่ใช่การ์ดในมือ'); return take(r, u).c; });
      cs.forEach(c => me.deck.unshift(c));
      draw(r, me, cs.length);
      shuf(me.deck);
      if (r.p.every(p => p.m)) { g.phase='x'; startTurn(r); }
      break;
    }
    case 'next':
      if (!mine) E('ไม่ใช่เทิร์นเรา');
      if (g.phase === 'main') { g.phase = g.n === 0 ? 'end' : 'battle'; if (g.phase === 'end') enterEnd(r, i); }
      else if (g.phase === 'battle') { g.phase = 'end'; enterEnd(r, i); }
      else { if (me.hand.length > 7) E('มือเกิน 7 ต้องทิ้งก่อน'); r.p.forEach(q => q.av.forEach(a => { a.tp = 0; a.bp = 0; })); g.turn = 1 - i; g.n++; startTurn(r); }
      break;
    case 'discard': { const f = own(m.u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); take(r, m.u); me.hell.push(f.c); log(r, me.name + ' ทิ้ง ' + B[f.c.id].n); break; }
    case 'summon': case 'build': {
      mainOnly(); const f = own(m.u), c = B[f.c.id], av = m.t === 'summon';
      if (f.z !== 'hand' || c.t !== (av ? 'Avatar' : 'Construct')) E('ประเภทผิด');
      if (f.c.id === 'SD03-003') E('การ์ดนี้ลงสนามจากบนมือไม่ได้');
      if (av && g.lim && g.lim[i] && B[f.c.id].s !== g.lim[i]) E('เทิร์นนี้อัญเชิญได้เฉพาะ Avatar ' + g.lim[i]);
      if (av && me.ban && me.ban[B[f.c.id].n] === g.n) E('โรงบาล: การ์ดชื่อนี้อัญเชิญไม่ได้ในเทิร์นนี้');
      if (av ? me.av.filter(x => !x.tk).length >= 4 : me.co.length >= 3) E(av ? 'Avatar เต็ม 4' : 'Construct เต็ม 3');
      if (av && me.av.length >= 6) E('Avatar+Token เต็ม 6');
      if (!av && me.co.some(x => B[x.id].n === c.n)) E('Construct ชื่อซ้ำ');
      const ps = pays(); payOK(c, ps, me);
      ps.forEach(p => { take(r, p.u); me.hell.push(p); }); take(r, m.u); me[av ? 'av' : 'co'].push(f.c);
      if (av) g.q.push(() => fxSummon(r, i, f.c));
      ev(r, c.id); log(r, me.name + (av ? ' อัญเชิญ ' : ' ก่อสร้าง ') + c.n); open(r, { who: 1 - i, k: 'ev', ev: { k: av ? 'summon' : 'build', u: f.c.u, i, cost: c.c, id: c.id } }); break;
    }
    case 'cast': {
      const f = own(m.u), c = B[f.c.id]; if (c.t !== 'Magic') E('ไม่ใช่ Magic');
      const def = MG[c.id] || (c.st === 'Modification' ? { mod: 1 } : {});
      if (def.auto) E('การ์ดนี้ทำงานอัตโนมัติเมื่อเข้าเงื่อนไข (ถามเมื่อถึงจังหวะ)');
      if (!(f.z === 'hand' || (f.z === 'hell' && f.c.mh === g.n && c.st === 'Modification' && !g.used[i].Modification && mine && g.phase === 'main'))) E('ใช้จากโซนนี้ไม่ได้');
      if (c.st === 'React') { if (!reactOK(r, i, c, def)) E('ใช้ React ตอนนี้ไม่ได้'); } else mainOnly();
      if (g.used[i][c.st]) E(c.st + ' ใช้ได้ 1 ครั้ง/เทิร์น');
      if (!MG[c.id]) log(r, '⚠ ' + c.n + ': ระบบยังไม่รองรับเอฟเฟกต์ — ทำเองตามข้อความการ์ด');
      startCast(r, i, f, c, def); break;
    }
    case 'pick': {
      const a = g.ask; if (!a) E('ไม่มีให้เลือก');
      if (m.cancel) { if (!a.cancel) E('ยกเลิกไม่ได้'); g.ask = null; a.onCancel && a.onCancel(); break; }
      if (a.yn) { g.ask = null; a.cb(!!m.yes); break; }
      const us = [...new Set((m.us || []).map(Number))];
      if (us.length < a.min || us.length > a.n || us.some(u => !a.opts.includes(u))) E('เลือกไม่ถูกต้อง (' + (a.min === a.n ? a.n : a.min + '-' + a.n) + ' ใบ)');
      g.ask = null; a.cb(us); break;
    }
    case 'atk': {
      if (!mine || g.phase !== 'battle') E('เฉพาะ Battle Phase');
      const a = own(m.u); if (a.z !== 'av' || a.c.tired) E('โจมตีไม่ได้');
      if (g.land && g.land.c.id === 'BT01-049' && g.ac && g.ac[i]) E('มวยทะเล: สั่งโจมตีได้ 1 ตัวต่อเทิร์น');
      let tk = 'av';
      if (m.tg === 'life') { if (op.av.length && !kick(r, a.c)) E('ต้องกำจัด Avatar ก่อน'); tk = 'life'; }
      else if (op.av.some(x => x.u === m.tg)) { tk = 'av'; const t0 = op.av.find(x => x.u === m.tg); if (t0.id === 'BT01-020' && op.av.some(y => y !== t0 && symOf(y) === 'ผี')) E('ศาลพระภูมิ: ยังมี Avatar ผี อยู่ เลือกเป็นเป้าหมายไม่ได้'); }
      else if (op.co.some(x => x.u === m.tg)) tk = 'co';
      else E('ไม่พบเป้าหมาย');
      const sup = [...new Set((m.sup || []).map(Number))].filter(u => u !== a.c.u).map(u => { const q = own(u); if (q.z !== 'av' || q.c.tired || q.c.tk || !B[q.c.id].e.includes('สามัคคี')) E('สามัคคีไม่ได้: ' + nmOf(q.c)); return q.c; });
      sup.forEach(q => { a.c.bp = (a.c.bp || 0) + P(r, q); q.tired = true; fx({ k: 'buff', u: a.c.u, v: P(r, q) }); log(r, '🤝 ' + nmOf(q) + ' สามัคคี +' + P(r, q)); });
      if (g.land && g.land.c.id === 'SD02-020' && TRIO.includes(nmOf(a.c))) { a.c.bp = (a.c.bp || 0) + 2; fx({ k: 'buff', u: a.c.u, v: 2 }); log(r, '🏠 สมชายห้องเช่า: POWER +2'); }
      a.c.tired = true; log(r, nmOf(a.c) + ' โจมตี ' + (tk === 'life' ? 'LIFE' : tk === 'co' ? 'Construct' : 'Avatar'));
      g.ac = g.ac || {}; g.ac[i] = (g.ac[i] || 0) + 1;
      const pa = { who: 1 - i, k: 'atk', ai: i, u: m.u, tg: m.tg, tk };
      g.q.push(() => fxAtk(r, i, a.c)); g.q.push(() => atkDecl(r, pa)); g.q.push(() => { if (pa.cancel) return log(r, 'การโจมตีถูกยกเลิก'); open(r, pa); }); break;
    }
    case 'use': {
      mainOnly(); const L = g.land; if (!L || L.c.u !== m.u) E('ไม่พบการ์ด'); const def = USE[L.c.id]; if (!def) E('การ์ดนี้ไม่มีความสามารถสั่งใช้');
      if (g.used[i]['use' + L.c.id]) E('ใช้ได้เทิร์นละครั้ง'); def(r, i, L.c); break;
    }
    case 'oe': { if (g.phase !== 'dice' || i !== 0) E('ตอนนี้ไม่ได้'); const d = 1 + Math.floor(Math.random() * 6); g.dw = (d % 2 === 1) === (m.v === 'odd') ? 0 : 1; g.dc = { n: ++DCN, d, v: m.v, w: g.dw }; log(r, me.name + ' ทอย ' + d + ' · ' + r.p[g.dw].name + ' ชนะ'); g.phase = 'pick'; break; }
    case 'first': { if (g.phase !== 'pick' || i !== g.dw) E('ไม่ใช่สิทธิ์'); g.turn = m.v ? i : 1 - i; log(r, r.p[g.turn].name + ' เริ่มก่อน'); g.phase = 'mull'; break; }
    case 'pass': { if (!g.pend || g.pend.who !== i) E('ไม่มี React'); passReact(r); break; }
    case 'token': case 'move': case 'pw': case 'tire': case 'drawn':
      E('คำสั่งนี้ถูกปิด'); break;
    case 'discardm': { const us = [...new Set((m.us || []).map(Number))].slice(0, 20); if (!us.length) E('ยังไม่เลือก'); us.forEach(u => { const f = own(u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); }); us.forEach(u => { const f = take(r, u); me.hell.push(f.c); }); log(r, me.name + ' ทิ้ง ' + us.length + ' ใบ'); break; }
    case 'dview': { const n = +m.n | 0, L = (n > 0 ? me.deck.slice(-n) : me.deck.slice()).reverse(); me.ws && me.ws.send(JSON.stringify({ t: 'dv', cards: L.map(c => ({ u: c.u, id: c.id })) })); log(r, me.name + ' ดูเด็ค'); break; }
    case 'dmove': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบ'); if (!['hand','hell','av','mg','co'].includes(m.to)) E('โซนผิด'); const [c] = me.deck.splice(k, 1); me[m.to].push(c); log(r, me.name + ' ย้ายจากเด็ค → ' + m.to); if (!me.deck.length && !g.over) { g.over = me.name + ' เด็คหมด'; g.win = 1 - i; } break; }
    case 'dpos': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบ'); const [c] = me.deck.splice(k, 1); m.top ? me.deck.push(c) : me.deck.unshift(c); log(r, me.name + ' วาง' + (m.top ? 'บน' : 'ใต้') + 'เด็ค'); break; }
    case 'dshuf': shuf(me.deck); log(r, me.name + ' สับเด็ค 🔀'); break;
    case 'surrender': { if ((g.phase === 'dice' || g.phase === 'pick') && !m.ff) E('ยังยอมแพ้ไม่ได้'); g.ask = null; g.pend = null; g.q = []; g.over = me.name + ' ยอมแพ้'; g.win = 1 - i; log(r, '🏳 ' + me.name + ' ยอมแพ้'); break; }
    case 'chat': log(r, '💬 ' + me.name + ': ' + String(m.x || '').slice(0, 200)); break;
    default: E('คำสั่งไม่รู้จัก');
  }
  runQ(r);
}

const hasReact = (r, w) => !r.g.used[w].React && r.p[w].hand.some(c => { const d = B[c.id]; return d && d.t === 'Magic' && d.st === 'React' && !(MG[d.id] && MG[d.id].auto); });
const open = (r, p) => {
  if (r.g.over) return;
  if (!hasReact(r, p.who)) { if (p.k === 'atk') resolveAtk(r, p); return; }
  p.until = r.cfg.react ? Date.now() + r.cfg.react * 1000 : 0; r.g.pend = p;
};
const setBt = (r, o) => { r.g.bt = { n: ++BTN, ...o }; };
function resolveAtk(r, p) {
  const me = r.p[p.ai], op = r.p[1 - p.ai], f = find(r, p.u);
  if (!f || f.i !== p.ai || f.z !== 'av') return log(r, 'การโจมตีถูกยกเลิก');
  const a = f.c, an = nmOf(a);
  if (p.tk === 'av' && !p.chk) {
    const d0 = op.av.find(x => x.u === p.tg); if (d0 && d0.id === 'SD03-002') { mill(r, 1 - p.ai, 2, d0); addTp(d0, 1); log(r, '✨ พ่อจีจ้า POWER +1'); }
    if (r.g.over) return;
    if (d0) { const x1 = P(r, a), x2 = P(r, d0), dead = x1 === x2 ? (x1 > 0 ? [a, d0] : []) : x1 > x2 ? [d0] : [a];
      if (dead.some(x => guardable(r, x))) { p.chk = 1; return guardAsk(r, dead, () => r.g.q.unshift(() => resolveAtk(r, p))); } }
  }
  if (r.g.over) return;
  const pa = P(r, a), base = { ai: p.ai, aid: a.tk ? null : a.id, an, pa };
  if (p.tg === 'life') {
    if (op.av.length && !kick(r, a)) return log(r, 'ตี LIFE ไม่ได้');
    log(r, an + ' (' + pa + ') โจมตี LIFE');
    if (pa > 0) { const x = hit(r, op, me); setBt(r, { ...base, tg: 'life', res: x === 'KO' ? 'ko' : 'life', cid: x === 'KO' ? null : x }); }
    else { log(r, 'Power 0 ไม่เสียหาย'); setBt(r, { ...base, tg: 'life', res: 'zero' }); }
  } else if (p.tk === 'co') {
    const d = op.co.find(x => x.u === p.tg); if (!d) return log(r, 'เป้าหาย');
    const pd = (B[d.id].p || 0) + (d.pw || 0), dn = B[d.id].n; let res = 'none';
    log(r, an + ' (' + pa + ') โจมตี Construct ' + dn + ' (' + pd + ')');
    if (pa > pd) { take(r, d.u); fx({ k: 'die', u: d.u, id: d.id }); op.hell.push(d); log(r, dn + ' ถูกทำลาย'); res = 'win'; } else log(r, 'Power ไม่เกิน Construct — ไม่มีอะไรเกิดขึ้น');
    setBt(r, { ...base, tg: 'av', dn, did: d.id, pd, res });
  } else {
    const d = op.av.find(x => x.u === p.tg); if (!d) return log(r, 'เป้าหาย');
    const pd = P(r, d), dn = nmOf(d); let res; const dd = [];
    log(r, an + ' (' + pa + ') สู้ ' + dn + ' (' + pd + ')');
    if (pa === pd) { if (pa > 0) { kill(r, p.ai, a.u) && dd.push(p.ai); kill(r, 1 - p.ai, d.u) && dd.push(1 - p.ai); log(r, 'ตายทั้งคู่'); res = 'both'; } else { log(r, 'เสมอ (0)'); res = 'none'; } }
    else if (pa > pd) { if (kill(r, 1 - p.ai, d.u)) { dd.push(1 - p.ai); log(r, dn + ' ตาย');
        if (a.rt !== r.g.n && r.p.some(q => q.mg.some(m => m.at === a.u && m.id === 'BT01-046'))) { a.tired = false; a.rt = r.g.n; log(r, '✨ ตีพ่อ: ' + an + ' กลับมาสภาพตื่น'); } } res = 'win'; }
    else { if (kill(r, p.ai, a.u)) dd.push(p.ai); log(r, an + ' ตาย'); res = 'lose'; }
    dd.length && r.g.q.push(() => postBattle(r, dd.slice()));
    setBt(r, { ...base, tg: 'av', dn, did: d.tk ? null : d.id, pd, res });
  }
  a.bp = 0;
}
function passReact(r) { CR = r; const p = r.g.pend; r.g.pend = null; if (p && p.k === 'atk') resolveAtk(r, p); runQ(r); }
function begin(r) {
  r.p.forEach(x => { draw({ g: {} }, x, 5); x.t = (r.cfg.clock || 0) * 60000; x.rm = 0; x.dc = null; x.m = false; x.fd = 0; x.ban = null; });
  r.g = { turn: 0, phase: 'dice', pend: null, ask: null, q: [], n: 0, used: [{}, {}], land: null, log: ['เริ่มเกม!'], over: null };
}
async function rematch(r, i) {
  r.p[i].rm = 1; if (!r.rmT) r.rmT = Date.now();
  if (r.p.every(x => x.rm)) {
    for (const x of r.p) { const d = await pickDeck(x.last, x.name, r.cfg.ban, r.cfg.exs); x.deck = shuf(d.main.map(inst)); x.life = shuf(d.life.map(id => ({ ...inst(id), up: 0 }))); x.hand = []; x.hell = []; x.av = []; x.mg = []; x.co = []; x.dk = []; x.lf = []; x.noCost = []; }
    r.rmT = 0; begin(r);
  } else { const o = r.p[1 - i].ws; o && o.readyState === 1 && o.send(JSON.stringify({ t: 'rmq' })); }
  bc(r);
}
const dropRoom = c => { (rooms[c].spec || []).forEach(w => w.readyState === 1 && w.send(JSON.stringify({ t: 'specend' }))); delete rooms[c]; };
setInterval(() => {
  const now = Date.now();
  for (const c in rooms) {
    const r = rooms[c], g = r.g;
    if (!g) { if (r.exp && now > r.exp) { r.p.forEach(p => p.ws && p.ws.readyState === 1 && p.ws.send(JSON.stringify({ err: 'ห้องหมดอายุ' }))); dropRoom(c); } continue; }
    if (g.over) { g.oa = g.oa || now; if ((r.rmT && now - r.rmT > 10000) || now - g.oa > 6e5) { r.p.forEach(p => p.ws && p.ws.readyState === 1 && p.ws.send(JSON.stringify({ t: 'rmx' }))); dropRoom(c); } continue; }
    r.p.forEach((p, k) => { if (p.dc && now - p.dc > REJOIN_MS) { g.over = p.name + ' หลุดการเชื่อมต่อเกิน 3 นาที แพ้'; g.win = 1 - k; g.ask = null; g.pend = null; g.q = []; } });
    if (g.pend && g.pend.until && now > g.pend.until) { passReact(r); bc(r); settle(r).catch(() => { }); }
    if (!g.over && r.cfg.clock && ['main','battle','end'].includes(g.phase)) {
      const p = r.p[g.turn]; p.t -= 1000; if (p.t <= 0) { g.over = p.name + ' หมดเวลา แพ้'; g.win = 1 - g.turn; }
      r.p.forEach(x => x.ws && x.ws.readyState === 1 && x.ws.send(JSON.stringify({ t: 'clk', a: r.p.map(y => y.t) })));
    }
    if (g.over) { bc(r); settle(r).catch(() => { }); }
  }
}, 1000);
wss.on('connection', ws => {
  let r, i;
  ws.on('close', () => { if (ws.sp) ws.sp.spec = (ws.sp.spec || []).filter(w => w !== ws); if (r && r.p[i] && r.p[i].ws === ws) { r.p[i].dc = Date.now(); if (r.g && !r.g.over) { log(r, '⚠ ' + r.p[i].name + ' หลุด (รอ 3 นาที)'); bc(r); } } });
  const err = s => ws.send(JSON.stringify({ err: String(s) }));
  ws.on('message', async raw => {
    try {
      const m = JSON.parse(raw);
      if (m.t === 'reg' || m.t === 'login' || m.t === 'tok') {
        let n = String(m.name || '').trim().toLowerCase().slice(0, 16), d;
        if (m.t === 'tok') { n = unsign(String(m.tok)); if (!n) E('เซสชันหมดอายุ'); d = await dbGet(n); if (!d) E('ไม่พบบัญชี'); }
        else {
          if (!/^[a-z0-9_\u0E00-\u0E7F]{3,16}$/.test(n)) E('ชื่อ 3-16 ตัว'); d = await dbGet(n); const pw = String(m.pw || '');
          if (m.t === 'reg') {
            if (d) E('ชื่อถูกใช้'); if (pw.length < 4) E('รหัสผ่าน ≥ 4 ตัว');
            const s = crypto.randomBytes(8).toString('hex'); d = { s, h: hash(pw, s), gems: 0, cards: {}, codes: [] };
            ['SD01','SD02','SD03'].forEach(x => giveSt(d, x));
            await dbPut(n, d);
          } else if (!d || d.h !== hash(pw, d.s)) E('ชื่อ/รหัสผิด');
        }
        ws.user = n; ws.send(JSON.stringify({ t: 'auth', tok: sign(n), me: prof(n, d) }));
        const q = Object.values(rooms).find(x => x.g && !x.g.over && x.p.some(p => p.name === n));
        if (q) { const pp = q.p.find(p => p.name === n); ws.send(JSON.stringify({ t: 'rj', room: q.code, left: Math.max(0, REJOIN_MS - (pp.dc ? Date.now() - pp.dc : 0)) })); }
        if (MISSED[n]) { ws.send(JSON.stringify({ t: 'missed', ...MISSED[n] })); delete MISSED[n]; }
        return;
      }
      if (!ws.user) E('ต้องล็อกอินก่อน');
      if (m.t === 'fstat') {
        const d = await dbGet(ws.user), on = n => [...wss.clients].some(w => w.user === n && w.readyState === 1);
        const L = (d.fr || []).map(n => { const q = Object.values(rooms).find(x => x.p.some(p => p.name === n && p.ws && p.ws.readyState === 1)); return { name: n, on: on(n), st: q ? (q.g && !q.g.over ? 'play' : 'room') : '' }; });
        ws.send(JSON.stringify({ t: 'fst', l: L })); return;
      }
      if (m.t === 'finv') {
        const t = String(m.name || '').toLowerCase(), code = String(m.room || '').toUpperCase(), d = await dbGet(ws.user), q = rooms[code];
        if (!(d.fr || []).includes(t)) E('ไม่ใช่เพื่อนของคุณ');
        if (!q || q.g || q.p.length >= 2 || !q.p.some(p => p.name === ws.user)) E('ห้องนี้เชิญไม่ได้');
        const tw = [...wss.clients].find(w => w.user === t && w.readyState === 1); if (!tw) E('เพื่อนไม่ได้ออนไลน์');
        tw.send(JSON.stringify({ t: 'inv', from: ws.user, room: code })); return;
      }
      if (m.t === 'spec') {
        const t = String(m.name || '').toLowerCase(), d = await dbGet(ws.user);
        if (!(d.fr || []).includes(t)) E('ดูได้เฉพาะแมตช์ของเพื่อน');
        const q = Object.values(rooms).find(x => x.g && !x.g.over && x.p.some(p => p.name === t));
        if (!q) E('เพื่อนไม่ได้แข่งอยู่'); if (q.p.some(p => p.name === ws.user)) E('คุณอยู่ในห้องนี้แล้ว');
        q.spec = q.spec || []; if (q.spec.length >= 10 && !q.spec.includes(ws)) E('ผู้ชมเต็ม');
        if (!q.spec.includes(ws)) q.spec.push(ws); ws.sp = q; ws.send(JSON.stringify({ t: 's', s: sview(q) })); return;
      }
      if (m.t === 'mkcode') {
        if (ws.user !== ADMIN) E('เฉพาะแอดมิน'); const c = String(m.c || '').trim().toUpperCase(); if (!/^[A-Z0-9]{3,20}$/.test(c)) E('โค้ด 3-20 ตัว');
        const T = (await dbGet('sys:codes')) || {}; T[c] = { gems: Math.max(0, +m.gems | 0), art: Math.min(50, Math.max(0, +m.art | 0)) };
        await dbPut('sys:codes', T); ws.send(JSON.stringify({ note: 'สร้างโค้ด ' + c })); return;
      }
      const me_ = d => ws.send(JSON.stringify({ t: 'me', me: prof(ws.user, d) }));
      if (m.t === 'buyst') {
        const d = await dbGet(ws.user); d.bought = d.bought || [];
        if (!ST[m.set] || /^SD0[1-3]$/.test(m.set)) E('ไม่มีสินค้า'); if (d.bought.includes(m.set)) E('ซื้อแล้ว'); if (d.gems < 1500) E('Gem ไม่พอ');
        d.gems -= 1500; d.bought.push(m.set); giveSt(d, m.set);
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'deldeck') { const d = await dbGet(ws.user); if (!d.decks || !d.decks[m.name]) E('ไม่พบเด็ค'); delete d.decks[m.name]; await dbPut(ws.user, d); me_(d); return; }
      if (m.t === 'buyskin' || m.t === 'eqskin') {
        const SK = { board: { classic: 0, slate: 300, wood: 300, neon: 400 }, card: { black: 0, crimson: 300, gold: 400, ocean: 300 } };
        const pr = SK[m.k] && SK[m.k][m.id]; if (pr == null) E('ไม่มีสินค้า');
        const d = await dbGet(ws.user), key = m.k + ':' + m.id; d.skins = d.skins || []; d.eq = d.eq || {};
        if (m.t === 'buyskin') { if (pr === 0 || d.skins.includes(key)) E('มีแล้ว'); if (d.gems < pr) E('Gem ไม่พอ'); d.gems -= pr; d.skins.push(key); d.eq[m.k] = m.id; }
        else { if (pr > 0 && !d.skins.includes(key)) E('ยังไม่ได้ซื้อ'); d.eq[m.k] = m.id; }
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'savedeck') {
        const d = await dbGet(ws.user), own = {}; Object.entries(d.cards).forEach(([k, v]) => { const i = k.split('|')[0]; own[i] = (own[i] || 0) + v; });
        const main = (m.main || []).map(String), life = (m.life || []).map(String), cnt = {};
        [...main, ...life].forEach(i => { if (!B[i]) E('ไม่พบ ' + i); cnt[i] = (cnt[i] || 0) + 1; });
        for (const i in cnt) if (cnt[i] > (own[i] || 0)) E('การ์ดไม่พอ: ' + B[i].n);
        let vr = null;
        if (m.vr && typeof m.vr === 'object') { vr = {}; const sum = {};
          for (const [k, n] of Object.entries(m.vr)) { const c = Math.floor(+n); if (!(c > 0)) continue; const i = k.split('|')[0]; if (!B[i]) E('ไม่พบ ' + i); if (c > (d.cards[k] || 0)) E('การ์ดไม่พอ: ' + B[i].n + ' (' + k.split('|')[1] + ')'); vr[k] = c; sum[i] = (sum[i] || 0) + c; }
          for (const i in cnt) if ((sum[i] || 0) !== cnt[i]) E('ข้อมูลเรทติ้งไม่ตรงกับเด็ค: ' + B[i].n); }
        if (life.some(i => B[i].t !== 'Life') || main.some(i => B[i].t === 'Life')) E('ประเภทผิด');
        mkDeck([...main, ...life].map(i => i + ' x1').join(' '), 0, false, true); /* ตรวจแบนลิสต์ด้วย */
        const nm = String(m.name || 'เด็คใหม่').slice(0, 20); d.decks = d.decks || {};
        if (!d.decks[nm] && Object.keys(d.decks).length >= 20) E('เด็คเต็ม 20'); d.decks[nm] = vr ? { main, life, vr } : { main, life };
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'fadd') {
        const t = String(m.name || '').trim().toLowerCase(); if (t === ws.user) E('เพิ่มตัวเองไม่ได้');
        const o = await dbGet(t), d = await dbGet(ws.user); if (!o) E('ไม่พบผู้ใช้'); if ((d.fr || []).includes(t)) E('เป็นเพื่อนแล้ว');
        o.rq = o.rq || []; if (!o.rq.includes(ws.user)) o.rq.push(ws.user); await dbPut(t, o); me_(d); ws.send(JSON.stringify({ note: 'ส่งคำขอแล้ว' })); return;
      }
      if (m.t === 'facc') {
        const t = String(m.name), d = await dbGet(ws.user), o = await dbGet(t); d.rq = d.rq || []; if (!o || !d.rq.includes(t)) E('ไม่พบคำขอ');
        d.rq = d.rq.filter(x => x !== t); if (m.ok) { d.fr = [...new Set([...(d.fr || []), t])]; o.fr = [...new Set([...(o.fr || []), ws.user])]; await dbPut(t, o); }
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'open') {
        const d = await dbGet(ws.user), n = m.n === 10 ? 10 : 1, cost = n === 10 ? 900 : 100;
        if (!SETS.includes(m.set)) E('ไม่มีชุดนี้'); if (d.gems < cost) E('Gem ไม่พอ'); d.gems -= cost;
        const ps = []; for (let k = 0; k < n; k++) { d.pity = (d.pity || 0) + 1; const p = pack(m.set, d.pity >= 20); if (['UR','SCR'].includes(p[4].r)) d.pity = 0; p.forEach(x => add(d, x)); ps.push(p); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d) })); return;
      }
      if (m.t === 'code') {
        const d = await dbGet(ws.user), c = String(m.c || '').trim().toUpperCase();
        const K = { BOTFANMADE: { gems: 5555 }, SOCOOL: { art: 5 }, AMUJI: { gems: 111111 }, BUGFIXALOT: { gems: 5555, art: 2 }, ...((await dbGet('sys:codes')) || {}) }, X = K[c]; if (!X) E('โค้ดผิด'); if (d.codes.includes(c)) E('ใช้แล้ว'); d.codes.push(c);
        let ps = []; d.gems += X.gems || 0;
        if (X.art) { const A = []; CARDS.forEach(x => x.v.forEach(r => ['PR','CBR','SCR'].includes(r) && A.push({ id: x.id, r }))); const p = []; for (let k = 0; k < X.art; k++) { const x = pick(A); add(d, x); p.push(x); } for (let k = 0; k < p.length; k += 5) ps.push(p.slice(k, k + 5)); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d), note: X.gems ? 'ได้ ' + X.gems + ' Gem' : '' })); return;
      }
      if (m.t === 'join') {
        const code = String(m.room || '').toUpperCase().slice(0, 8), name = ws.user;
        if (!code) E('ใส่รหัสห้อง');
        r = rooms[code];
        if (!r) { if (!m.create) E('ไม่พบห้อง'); r = rooms[code] = { p: [], g: null, code, exp: Date.now() + 18e4, cfg: { clock: [5,10,20].includes(+m.clock) ? +m.clock : 0, react: [10,20,30].includes(+m.react) ? +m.react : 0, ban: String(m.ban) !== '0', exs: String(m.exs) !== '0' } }; }
        i = r.p.findIndex(p => p.name === name);
        if (i < 0) { if (r.p.length >= 2) E('ห้องเต็ม'); i = r.p.length; r.p.push({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], dk: [], life: [], lf: [], noCost: [] }); }
        r.p[i].ws = ws; { const ud = await dbGet(name); r.p[i].eq = (ud && ud.eq) || {}; } if (r.p.length === 2) r.exp = 0; if (r.p[i].dc) { r.p[i].dc = null; if (r.g) log(r, '✔ ' + name + ' กลับมา'); } bc(r);
      } else if (m.t === 'deck') {
        if (!r || r.g) E('ตั้งเด็คไม่ได้');
        const d = await pickDeck(m, ws.user, r.cfg.ban, r.cfg.exs), p = r.p[i];
        p.last = m; p.deck = shuf(d.main.map(inst)); p.life = shuf(d.life.map(id => ({ ...inst(id), up: 0 }))); p.hand = [];
        bc(r);
      } else if (m.t === 'rcfg') {
        if (!r || r.g || i !== 0) E('เฉพาะเจ้าห้องตั้งกติกาได้');
        if (m.clock != null) r.cfg.clock = [5, 10, 20].includes(+m.clock) ? +m.clock : 0;
        if (m.react != null) r.cfg.react = [10, 20, 30].includes(+m.react) ? +m.react : 0;
        if (m.ban != null) { const nb = String(m.ban) !== '0'; if (nb !== r.cfg.ban) r.p.forEach(x => { x.deck = null; }); r.cfg.ban = nb; }
        if (m.exs != null) { const ne = String(m.exs) !== '0'; if (ne !== (r.cfg.exs !== false)) r.p.forEach(x => { x.deck = null; }); r.cfg.exs = ne; }
        bc(r);
      } else if (m.t === 'start') {
        if (!r || r.g || i !== 0) E('เฉพาะเจ้าห้องเริ่มเกมได้');
        if (r.p.length < 2 || !r.p.every(x => x.deck)) E('ผู้เล่นยังไม่พร้อม');
        begin(r); bc(r);
      } else if (m.t === 'rm' && r && r.g && r.g.over) { await rematch(r, i);
      } else if (r && r.g) { act(r, i, m); bc(r); settle(r).catch(() => { }); }
    } catch (e) { err(e && e.message ? 'ผิดพลาด' : e); }
  });
});
srv.listen(process.env.PORT || 3000, () => console.log('ready'));
if (process.env.BOT_TEST) module.exports = { rooms, act, inst, find, P, B, view, sview, runQ, wss, shuf };
