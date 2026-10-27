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
        fs.writeFileSync(path.join(IMG, name), m === 8 ? require('zlib').inflateRawSync(raw) : raw); ok++;
      }
      console.log('unzip', zf, ok);
    }
  } catch (err) { console.log('unzip error', err.message); }
})();
const srv = http.createServer((q, r) => {
  let f = path.basename(q.url.split('?')[0]) || 'index.html', dir = __dirname;
  if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(path.join(IMG, f))) dir = IMG;
  if (!MT[path.extname(f)] || f === 'package.json' || !fs.existsSync(path.join(dir, f))) { f = 'index.html'; dir = __dirname; }
  r.writeHead(200, path.extname(f) === '.webp' ? { 'Content-Type': MT['.webp'], 'Cache-Control': 'public, max-age=86400' } : { 'Content-Type': MT[path.extname(f)] });
  fs.createReadStream(path.join(dir, f)).pipe(r);
});
const crypto = require('crypto');
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY, SEC = process.env.SECRET || crypto.createHash('sha256').update('bot:' + (process.env.SUPABASE_KEY || 'dev')).digest('hex'), ADMIN = (process.env.ADMIN_USER || '').toLowerCase();
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, mem = {};
const RMAP = { SCR: 'SEC', CBR: 'UBR' };
function mig(d) {
  if (!d || typeof CARDS === 'undefined') return d;
  const CI = new Set(CARDS.map(c => c.id));
  if (d.cards) { const o = {}; for (const [k, n] of Object.entries(d.cards)) { let [id, r] = k.split('|'); if (!CI.has(id)) continue; r = RMAP[r] || r; const nk = id + '|' + r; o[nk] = (o[nk] || 0) + n; } d.cards = o; }
  if (d.decks) for (const k of Object.keys(d.decks)) { const x = d.decks[k]; if (x && x.main) x.main = x.main.filter(i => CI.has(i)); if (x && x.life) x.life = x.life.filter(i => CI.has(i)); }
  return d;
}
const dbGet = async n => { if (!SB) return mig(mem[n]); const a = await (await fetch(`${SB}/rest/v1/users?name=eq.${encodeURIComponent(n)}&select=d`, { headers: H })).json(); return mig(a[0] && a[0].d); };
const dbPut = async (n, d) => { if (!SB) { mem[n] = d; return; } const r = await fetch(`${SB}/rest/v1/users`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ name: n, d }) }); if (!r.ok) throw 'บันทึกข้อมูลไม่สำเร็จ'; };
const hash = (pw, s) => crypto.scryptSync(pw, s, 32).toString('hex');
const sign = n => { const p = n + '|' + (Date.now() + 90 * 864e5); return Buffer.from(p).toString('base64') + '.' + crypto.createHmac('sha256', SEC).update(p).digest('hex'); };
const unsign = t => { try { const [b, s] = t.split('.'), p = Buffer.from(b, 'base64').toString(); if (crypto.createHmac('sha256', SEC).update(p).digest('hex') !== s) return; const [n, e] = p.split('|'); return +e > Date.now() ? n : null; } catch (e) { } };
const prof = (n, d) => ({ name: n, gems: d.gems, cards: d.cards, admin: n === ADMIN, decks: d.decks || {}, fr: d.fr || [], rq: d.rq || [], pity: d.pity || 0, bought: d.bought || [], skins: d.skins || [], eq: d.eq || {} });
const ST = JSON.parse(fs.readFileSync(path.join(__dirname, 'starters.json'), 'utf8'));
const giveSt = (d, k) => ST[k].main.concat(ST[k].life).forEach(([id, n, r]) => { for (let j = 0; j < n; j++) add(d, { id, r }); });
const SETS = ['BT01','BT02','BT03','BT04','BT05','BT06','BT07','BT08','BT09','BT10'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const add = (d, x) => { const k = x.id + '|' + x.r; d.cards[k] = (d.cards[k] || 0) + 1; };
function pack(set, gar) {
  const R = []; CARDS.forEach(c => c.id.startsWith(set + '-') && c.v.forEach(r => R.push({ id: c.id, r })));
  const by = r => R.filter(x => x.r === r), w = () => { const x = Math.random(); return gar ? (x < .7 ? 'UR' : 'SEC') : x < .62 ? 'R' : x < .9 ? 'SR' : x < .98 ? 'UR' : 'SEC'; };
  const g = r => { const a = by(r); return a.length ? pick(a) : pick(by('C').length ? by('C') : R); };
  return [g('C'), g('C'), g('C'), g('R'), g(w())];
}
function preDeck(s) { const x = ST[s]; return { main: x.main.flatMap(([id, n]) => Array(n).fill(id)), life: x.life.map(([id]) => id) }; }
async function pickDeck(m, user, ban) {
  if (m.mine) { const u = await dbGet(user), k = u.decks && u.decks[m.mine]; if (!k) E('ไม่พบเด็ค'); return mkDeck([...k.main, ...k.life].map(i => i + ' x1').join(' '), 0, 0, ban); }
  if (m.pre) { const u = await dbGet(user); if (!ST[m.pre] || !(/^SD0[1-3]$/.test(m.pre) || (u.bought || []).includes(m.pre))) E('ยังไม่มีเด็คนี้'); return preDeck(m.pre); }
  if (!process.env.BOT_TEST) E('ปิดใช้งานเด็ควางลิสต์/เด็คทดสอบแล้ว');
  return mkDeck(m.text || '', m.rand, m.skip, ban);
}
async function settle(r) { const g = r.g; if (!g.over || g.paid || g.win == null) return; g.paid = 1;
  for (let k = 0; k < 2; k++) { const w = r.p[k].ws; if (!w || !w.user) continue; const d = await dbGet(w.user); d.gems += k === g.win ? 150 : 50; await dbPut(w.user, d); w.send(JSON.stringify({ t: 'me', me: prof(w.user, d), gain: k === g.win ? 150 : 50 })); } }
const wss = new WebSocketServer({ server: srv });
const rooms = {}; let UID = 1, DRN = 0, BTN = 0, DCN = 0;
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const inst = id => ({ u: UID++, id, pw: 0, tired: false });
const ZN = ['hand','hell','av','mg','co','dk'];
const E = s => { throw s; };
/* ===== เอฟเฟกต์ให้ฝั่งไคลเอนต์เล่นอนิเมชัน + กวาดอุปกรณ์ที่ไม่มีเจ้าของ ===== */
let CR = null, FXN = 0;
const fx = o => { if (!CR || !CR.g) return; const g = CR.g; (g.fxl = g.fxl || []).push({ n: ++FXN, ...o }); if (g.fxl.length > 20) g.fxl.shift(); };
function sweep(r) { r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) { const m = p.mg[k]; if (m.at != null && !r.p.some(q => q.av.some(a => a.u === m.at))) { p.mg.splice(k, 1); delete m.at; p.hell.push(m); } } }); }

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
    v += mod456(r, x, f);
    r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u) { if (m.id === 'SD01-016') v += 1; if (m.id === 'SD03-018' && s === 'นรก') v += 1; } }));
    if (x.id === 'SD03-005') v += new Set(p.hell.filter(h => isAv(h) && B[h.id].n.startsWith('นายนิรยบาล')).map(h => B[h.id].n)).size;
  }
  return Math.max(0, v);
}
const kick = (r, a) => /เตะไข่/.test(a.tk ? '' : B[a.id].e) || r.p.some(q => q.mg.some(m => m.at === a.u && B[m.id].e.includes('เตะไข่')));
const allCards = (r, u) => { for (let i = 0; i < 2; i++) for (const z of [...ZN, 'deck']) { const c = r.p[i][z].find(x => x.u === u); if (c) return { i, z, c }; } return null; };
/* ===== คิว + ตัวเลือก (ask) ===== */
function runQ(r) { CR = r; const g = r.g; let n = 0; if (g && g.pendAfter && !g.ask && !g.pend) { const f = g.pendAfter; g.pendAfter = null; try { f(); } catch (e) { console.error('fx', e); } } while (g && !g.over && !g.ask && !g.pend && g.q.length && n++ < 100) { const f = g.q.shift(); try { f(r); } catch (e) { console.error('fx', e); } } sweep(r); }
function ask(r, who, o) {
  const opts = o.yn ? [] : o.opts;
  if (!o.yn && !opts.length) { o.none && o.none(); return false; }
  const n = Math.min(o.n || 1, opts.length), min = Math.min(o.min == null ? n : o.min, n);
  r.g.ask = { who, text: o.text, opts, n, min, cancel: !!o.cancel, yn: !!o.yn, cb: o.cb, onCancel: o.onCancel,
    cards: opts.map(u => { const f = allCards(r, u); return f ? { u, id: f.c.id, tk: f.c.tk ? f.c.tk.n : null, i: f.i, z: f.z } : { u }; }) };
  return true;
}
const sendHell = (r, u) => { const f = take(r, u); if (!f.c.tk) r.p[f.i].hell.push(f.c); };
const destroyAv = (r, u) => { const f = find(r, u); if (f && f.z === 'av') kill(r, f.i, u); };
const bounce = (r, u) => { const f = take(r, u); fx({ k: 'bounce', u }); if (!f.c.tk) { f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; f.c.tired = false; r.p[f.i].hand.push(f.c); } };
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
    default: SUM[x.id] && SUM[x.id](r, i, x);
  }
}
function fxAtk(r, i, a) { fxAtk2(r, i, a); if (a.id === 'SD01-002') { addTp(a, 2); log(r, '✨ พระนารายณ์ POWER +2'); } if (a.id === 'SD03-002') { mill(r, i, 2, a); addTp(a, 1); log(r, '✨ พ่อจีจ้า POWER +1'); } }
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
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t && t.z === 'av') { log(r, '✨ นำ ' + nmOf(t.c) + ' กลับขึ้นมือ'); bounce(r, t.c.u); } } },
  'SD03-016': { steps: [{ key: 'c', pay: 1, text: 'ส่ง Avatar นรก จากมือ 1 ใบ ลงนรก', opts: handAv(c => B[c.id].s === 'นรก') }], run: (r, i) => { mill(r, i, 2); draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD03-017': { run: (r, i) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && B[c.id].n.startsWith('นายนิรยบาล') && B[c.id].c <= 4).map(c => c.u);
    const fin = u => { if (u != null) { const k = p.deck.findIndex(c => c.u === u), [c] = p.deck.splice(k, 1); p.hand.push(c); p.noCost = p.noCost || []; p.noCost.push(B[c.id].n); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' ขึ้นมือ (ใช้เป็น Cost ไม่ได้อีก)'); } else log(r, '✨ ค้น Deck ไม่พบ'); shuf(p.deck); };
    if (!L.length) return fin(null); ask(r, i, { text: 'เลือก นายนิรยบาล Cost ≤ 4 จาก Deck 1 ใบ ขึ้นมือ', opts: L, cb: us => fin(us[0]) }); } },
  'SD03-020': { react: 'summon', steps: [{ key: 'c', pay: 1, text: 'ส่ง Avatar นรก จากมือ ที่ Cost ≥ Avatar ที่อัญเชิญ ลงนรก', opts: (r, i, cx) => handAv(c => B[c.id].s === 'นรก' && B[c.id].c >= (cx.ev.cost || 0))(r, i) }],
    run: (r, i, cx) => { mill(r, i, 2); destroyAv(r, cx.ev.u); } },
};
function reactOK(r, i, c, def) { const p = r.g.pend; if (!p || p.who !== i) return false; if (def.react === 'summon') return !!(p.ev && p.ev.k === 'summon'); if (def.react === 'cast') return !!(p.ev && p.ev.k === 'cast'); if (def.react === 'atk') return p.k === 'atk'; if (def.react === 'atkTank') return p.k === 'atk' && p.tk === 'av' && r.p[i].av.some(a => a.u === p.tg && isTank(a)); if (def.react === 'atkPeople') return p.k === 'atk' && p.tk === 'av' && r.p[i].av.some(a => a.u === p.tg && isPeopleF(a)); return true; }
function startCast(r, i, f, c, def) {
  const g = r.g, ctx = { ev: g.pend && g.pend.ev, pend: g.pend, pick: {}, card: f.c };
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
  else if (c.st === 'Land') { if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: card, o: i }; }
  else me.hell.push(card);
  ev(r, c.id); log(r, me.name + ' ร่าย ' + c.st + ': ' + c.n + (t ? ' → ' + nmOf(t.c) : ''));
  if (c.st === 'React') { def.run && def.run(r, i, ctx); const p = g.pend; if (p && p.who === i) { g.pend = null; if (p.k === 'atk' && !p.cancel) { if (g.ask) g.pendAfter = () => resolveAtk(r, p); else resolveAtk(r, p); } } }
  else { if (def.run) g.q.push(() => ctx.cancelled ? log(r, '❌ ' + c.n + ' ถูกยกเลิก') : def.run(r, i, ctx)); open(r, { who: 1 - i, k: 'ev', ev: { k: 'cast', id: c.id, i, cx: ctx } }); }
}
/* ===== SD04-06: wear / use / scout / skills ===== */
const nm2 = x => nmOf(x).replace(/\s+/g, ' ');
const isTank = x => isAv(x) && (nm2(x).startsWith('รถถัง') || x.id === 'SD04-005');
const isPeople = x => isAv(x) && nm2(x).startsWith('บึงทมิฬ People');
const isPeopleF = x => isPeople(x) || x.id === 'SD05-006';
const campTxt = x => isAv(x) && (B[x.id].e || '').includes('ค่ายบางระจัน');
const hasCamp = (r, i) => r.p[i].co.some(c => c.id === 'SD06-018');
const rnd = a => a[Math.floor(Math.random() * a.length)];
const hasEq = (r, x, id) => r.p.some(q => q.mg.some(m => m.at === x.u && m.id === id));
const tiredCnt = r => allAv(r).filter(a => a.x.tired).length;
const landIs = (r, id) => !!(r.g.land && r.g.land.c.id === id);
function hasKw(r, x, kw) {
  if (x.tk) return false; if ((B[x.id].e || '').includes(kw) && isAv(x)) return true;
  const f = find(r, x.u); if (!f || f.z !== 'av') return false;
  if (kw === 'ลูกฮึด' && hasEq(r, x, 'SD06-016')) return true;
  if ((kw === 'สามัคคี' || kw === 'โล่มนุษย์') && campTxt(x) && hasCamp(r, f.i)) return true;
  return false;
}
function mod456(r, x, f) {
  let v = 0; const p = r.p[f.i];
  (x.wr || []).forEach(w => { if (w.id === 'SD04-003') v += 1; if (w.id === 'SD06-008') v += hasCamp(r, f.i) ? 2 : 1; });
  if (campTxt(x) && hasCamp(r, f.i)) v += 1;
  if (x.id === 'SD06-002' && hasCamp(r, f.i)) v += 2;
  if (x.id === 'SD06-005' && r.g.turn !== f.i) v += 2;
  if (hasKw(r, x, 'ลูกฮึด') && p.life.length && p.life.every(l => l.up)) v += 1;
  return v;
}
function lifeDown(r, i) {
  const p = r.p[i], L = p.life.filter(l => l.up); if (!L.length) return log(r, '❤ ' + p.name + ': ไม่มี LIFE ที่หงายอยู่');
  const l = rnd(L); l.up = 0; const k = (p.lf || []).indexOf(l.id); if (k >= 0) p.lf.splice(k, 1);
  fx({ k: 'life', i }); log(r, '❤ ' + p.name + ': สุ่มคว่ำ LIFE 1 ใบ');
}
function putAv(r, i, c, o = {}) {
  const p = r.p[i];
  if (p.av.filter(x => !x.tk).length >= 4 || p.av.length >= 6) { log(r, 'Avatar เต็ม อัญเชิญ ' + B[c.id].n + ' ไม่ได้ (ลงนรก)'); p.hell.push(c); return false; }
  c.tired = !!o.tired; c.pw = 0; c.tp = 0; c.bp = 0; delete c.exp; p.av.push(c); ev(r, c.id);
  log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + (o.tired ? ' (สภาพนอน)' : ''));
  if (o.sm) r.g.q.push(() => fxSummon(r, i, c)); return true;
}
const fromZone = (r, i, z, u) => { const a = r.p[i][z], k = a.findIndex(c => c.u === u); return k < 0 ? null : a.splice(k, 1)[0]; };
/* wear */
const canWear = (t, card) => !(t.wr || []).some(w => B[w.id].n === B[card.id].n);
const tanksFor = (r, i, card) => r.p[i].av.filter(t => isTank(t) && t.u !== card.u && canWear(t, card)).map(t => t.u);
function wearOn(r, i, t, card) { t.wr = t.wr || []; t.wr.push(card); card.tired = false; fx({ k: 'buff', u: t.u, v: 0 }); log(r, '🪖 ' + nmOf(t) + ' สวมใส่ ' + B[card.id].n); }
function wearChoose(r, i, card) {
  const L = tanksFor(r, i, card);
  if (!L.length) { log(r, 'ไม่มีรถถังที่สวมได้ → ' + B[card.id].n + ' ลงนรก'); return r.p[i].hell.push(card); }
  if (L.length === 1) return wearOn(r, i, find(r, L[0]).c, card);
  ask(r, i, { text: 'เลือกรถถังที่จะสวม ' + B[card.id].n, opts: L, cb: us => wearOn(r, i, find(r, us[0]).c, card) });
}
/* scout */
function scout(r, i, n, o) {
  const p = r.p[i], seen = p.deck.slice(-n).reverse(), ok = seen.filter(c => o.pred(c)).map(c => c.u);
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ (' + seen.map(c => B[c.id].n).join(', ') + ')');
  const fin = u => {
    let got = null; if (u != null) { const k = p.deck.findIndex(c => c.u === u); got = p.deck.splice(k, 1)[0]; }
    const rest = seen.filter(c => c !== got && p.deck.includes(c));
    if (o.rest === 'bottom') { rest.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...rest); log(r, '⬇ นำการ์ดที่เหลือไว้ใต้ Deck'); } else if (o.rest === 'shuffle') shuf(p.deck);
    o.then(got, seen);
  };
  if (!ok.length) return fin(null);
  ask(r, i, { text: o.text, opts: ok, n: 1, min: 1, cb: us => fin(us[0]) });
}
function startUse(r, i, card, def) {
  const ctx = { pick: {}, card }, steps = def.steps || [];
  for (const s of steps) if (s.opts(r, i, ctx).length < (s.min == null ? (s.n || 1) : s.min)) E('เงื่อนไขการใช้ไม่ครบ');
  let k = 0;
  const next = () => {
    if (k >= steps.length) { steps.forEach(s => s.pay && (ctx.pick[s.key] || []).forEach(u => sendHell(r, u))); card.us = r.g.n; log(r, '⚡ ' + r.p[i].name + ' ใช้ความสามารถ ' + B[card.id].n); def.run && def.run(r, i, ctx); return; }
    const s = steps[k++], used = Object.values(ctx.pick).flat();
    ask(r, i, { text: s.text, opts: s.opts(r, i, ctx).filter(u => !used.includes(u)), n: s.n || 1, min: s.min, cancel: true, cb: us => { ctx.pick[s.key] = us; next(); }, none: next });
  };
  next();
}
const abOf = (r, i, x, z) => { const d = AB[x.id]; return d && d.z === z && r.g.turn === i && r.g.phase === 'main' && x.us !== r.g.n && !r.g.ask && !r.g.pend ? 1 : 0; };
/* ability tables */
const myAv = f => (r, i, cx) => r.p[i].av.filter(a => f(a, cx)).map(a => a.u);
const wearUse = { z: 'av', can: (r, i, c) => tanksFor(r, i, c).length > 0, steps: [{ key: 't', text: 'เลือก Avatar รถถังที่จะสวมใส่', opts: (r, i, cx) => tanksFor(r, i, cx.card) }],
  run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } };
const AB = {
  'SD04-001': wearUse, 'SD04-002': wearUse, 'SD04-003': wearUse,
  'SD06-008': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.u !== c.u && canWear(a, c)), steps: [{ key: 't', text: 'เลือก Avatar ที่จะสวมใส่ บุญช่วย', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && canWear(a, cx.card)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } },
  'SD04-019': { z: 'mg', run: (r, i, cx) => { const t = find(r, cx.card.at); const h = Math.random() < .5; log(r, '🪙 ถาดหลุม: ทอยเหรียญ ' + (h ? 'หัว +2' : 'ก้อย -2')); t && addTp(t.c, h ? 2 : -2); } },
  'SD04-020': { z: 'land', steps: [{ key: 't', text: 'เลือก Avatar {คน} ของเรา 1 ใบ เปลี่ยนเป็นสภาพนอน', opts: myAv(a => symOf(a) === 'คน') }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); t && (t.c.tired = true); const p = r.p[i], c = p.deck[p.deck.length - 1]; if (!c) return;
      ask(r, i, { yn: true, text: 'สอดแนม: ใบบนสุดคือ ' + B[c.id].n + ' — ไว้บนสุดต่อไหม? (ไม่ = ใต้ Deck)', cb: y => { if (!y) { p.deck.pop(); p.deck.unshift(c); log(r, '⬇ นำไว้ใต้ Deck'); } } }); } },
  'SD05-005': { z: 'av', can: (r, i, c) => !c.tired, steps: [{ key: 't', text: 'เลือก บึงทมิฬ People ใบอื่น', opts: myAv((a, cx) => isPeopleF(a) && a.u !== cx.card.u) }],
    run: (r, i, cx) => { cx.card.tired = true; const t = find(r, cx.pick.t[0]); if (t) { t.c.ward = r.g.n + 2; log(r, '🛡 ' + nmOf(t.c) + ' ไม่ถูกทำลาย 1 ครั้ง'); } } },
  'SD05-014': { z: 'land', steps: [{ key: 't', text: 'เลือก Avatar ของเรา 1 ใบ เปลี่ยนเป็นสภาพนอน', opts: myAv(a => !a.tired) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) t.c.tired = true; draw(r, r.p[i], 1); log(r, '✨ ' + r.p[i].name + ': จั่ว 1 ใบ'); } },
  'SD05-018': { z: 'mg', can: (r, i) => !r.g.used[i].Land,
    run: (r, i, cx) => { const p = r.p[i]; take(r, cx.card.u); p.hell.push(cx.card); const c = p.deck.find(x => x.id === 'SD05-014'); if (!c) { log(r, 'ไม่พบ บึงทมิฬ ใน Deck'); return shuf(p.deck); }
      p.deck.splice(p.deck.indexOf(c), 1); if (r.g.land) r.p[r.g.land.o].hell.push(r.g.land.c); r.g.land = { c, o: i }; r.g.used[i].Land = 1; shuf(p.deck); ev(r, c.id); log(r, '🌊 วาง บึงทมิฬ ลง Land Magic Zone'); } },
};
const SUM = {
  'SD04-001': (r, i) => scout(r, i, 5, { text: 'จุติ: เลือก จ่ามะนาว/จ่าแดงเดือด 1 ใบ สวมให้รถถัง', pred: c => isAv(c) && ['จ่ามะนาว', 'จ่าแดงเดือด'].some(n => B[c.id].n.startsWith(n)) && tanksFor(r, i, c).length > 0, rest: 'bottom', then: c => c && wearChoose(r, i, c) }),
  'SD04-002': (r, i) => { if (r.p[i].av.some(isTank)) lifeDown(r, i); },
  'SD04-005': (r, i, x) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && !isTank(c) && B[c.id].n.includes('Tank Ranger') && canWear(x, c)).map(c => c.u);
    const fin = u => { if (u != null) wearOn(r, i, x, fromZone(r, i, 'deck', u)); else log(r, 'ค้น Tank Ranger ไม่พบ'); shuf(p.deck); };
    if (!L.length) return fin(null); ask(r, i, { text: 'จุติ: เลือก Avatar "Tank Ranger" จาก Deck 1 ใบ สวมให้ MEGA ROR.DOR', opts: L, cb: us => fin(us[0]) }); },
  'SD05-003': (r, i) => { const p = r.p[i], n = tiredCnt(r); if (!n) return log(r, 'ไม่มี Avatar สภาพนอน'); const seen = p.deck.slice(0, n);
    log(r, '🔎 แสดงการ์ดล่างสุด ' + seen.length + ' ใบ: ' + seen.map(c => B[c.id].n).join(', '));
    const fin = u => { if (u != null) p.hand.push(fromZone(r, i, 'deck', u)); shuf(p.deck); }, ok = seen.filter(c => isAv(c) && B[c.id].s === 'ปลา').map(c => c.u);
    if (!ok.length) return fin(null); ask(r, i, { text: 'จุติ: เลือก Avatar {ปลา} 1 ใบ ขึ้นมือ', opts: ok, cb: us => fin(us[0]) }); },
  'SD05-006': (r, i) => { const p = r.p[i], awake = landIs(r, 'SD05-014'); let k = 0;
    const step = () => { if (k++ >= 2) return shuf(p.deck); const L = p.deck.filter(c => isPeople(c)).map(c => c.u); if (!L.length) return shuf(p.deck);
      ask(r, i, { text: 'จุติ: เลือก บึงทมิฬ People จาก Deck (' + k + '/2)', opts: L, cb: us => { putAv(r, i, fromZone(r, i, 'deck', us[0]), { tired: !awake }); r.g.q.unshift(step); } }); };
    step(); },
  'SD06-004': (r, i) => { const p = r.p[i]; if (p.hand.length < 2 || p.co.length >= 3 || p.co.some(c => c.id === 'SD06-018') || !p.deck.some(c => c.id === 'SD06-018')) return;
    ask(r, i, { text: 'จุติ: ทิ้งการ์ดบนมือ 2 ใบ เพื่อก่อสร้าง ค่ายบางระจัน จาก Deck (ยกเลิก = ไม่ใช้)', opts: p.hand.map(c => c.u), n: 2, cancel: true,
      cb: us => { us.forEach(u => sendHell(r, u)); const c = p.deck.find(x => x.id === 'SD06-018'); p.co.push(fromZone(r, i, 'deck', c.u)); shuf(p.deck); ev(r, c.id); log(r, '🏕 ' + p.name + ': ก่อสร้าง ค่ายบางระจัน'); } }); },
};
function fxAtk2(r, i, a) {
  if (a.id === 'SD05-001') { const n = tiredCnt(r); addTp(a, n); log(r, '✨ คุณจิระ POWER +' + n); }
  if (a.id === 'SD06-003') { addTp(a, 2); log(r, '✨ ทองเหม็น POWER +2'); }
}
function deathFx(r, f) {
  const c = f.c, p = r.p[f.i];
  if (c.id === 'SD06-001' && hasCamp(r, f.i)) { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); shuf(p.deck); draw(r, p, 1); log(r, '🏕 จัน หนวดเขี้ยว กลับเข้า Deck และจั่ว 1'); } }
  if (c.id === 'SD06-006') r.g.q.push(() => scout(r, f.i, 5, { text: 'คำสั่งเสีย: เลือก Avatar ที่มี "ค่ายบางระจัน" ใน Text Box 1 ใบ (ไม่ใช่พ่อแท่น) ขึ้นมือ', pred: x => campTxt(x) && x.id !== 'SD06-006', rest: 'shuffle', then: x => x && p.hand.push(x) }));
}
function onConDie(r, i, c) { if (c.id === 'SD06-018') { r.p[i].av.slice().forEach(a => sendHell(r, a.u)); log(r, '🏕 ค่ายบางระจัน ถูกทำลาย: ส่ง Avatar ทุกใบลงนรก'); } }
function winFx(r, i, w) {
  if (!find(r, w.u)) return;
  if (hasEq(r, w, 'SD06-017')) { draw(r, r.p[i], 1); log(r, '📖 ดาบใบข้าว X: จั่ว 1 ใบ'); }
  if ((w.wr || []).some(x => x.id === 'SD04-003')) ask(r, i, { yn: true, text: 'จ่าแดงเดือด: ทำลายการ์ดที่สวมใส่ เพื่อให้ ' + nmOf(w) + ' กลับเป็นสภาพตื่น?', cb: y => { if (!y) return; const k = (w.wr || []).findIndex(x => x.id === 'SD04-003'); if (k < 0) return; r.p[i].hell.push(w.wr.splice(k, 1)[0]); w.tired = false; log(r, '🪖 ' + nmOf(w) + ' กลับเป็นสภาพตื่น'); } });
}
function surviveFx(r, i, a) {
  if (a.id === 'SD05-002' && find(r, a.u) && a.us !== r.g.n && r.p[i].av.some(x => x.u !== a.u && isPeopleF(x))) { a.us = r.g.n; const d = 1 + Math.floor(Math.random() * 6); log(r, '🎲 คุณเค้นท์ ทอย ' + d); if (d % 2 && a.tired) { a.tired = false; log(r, '✨ คุณเค้นท์ กลับเป็นสภาพตื่น'); } }
}
function afterBattle(r, p, a, d, res) { if (res === 'win') winFx(r, p.ai, a); if (res === 'lose') winFx(r, 1 - p.ai, d); if (res !== 'lose' && res !== 'both') surviveFx(r, p.ai, a); }
function wall(r, i) {
  const p = r.p[i], c = p.co.find(x => x.id === 'SD06-020'); if (!c || c.us === r.g.n || p.av.length || !p.hand.length) return;
  ask(r, i, { yn: true, text: 'กำแพงด่านสุดท้าย: ทิ้งการ์ดบนมือ 1 ใบ เพื่อสอดแนมไหม?', cb: y => { if (!y) return;
    ask(r, i, { text: 'เลือกการ์ดบนมือที่จะทิ้ง', opts: p.hand.map(x => x.u), cancel: true, cb: us => { sendHell(r, us[0]); c.us = r.g.n;
      const n = 1 + (p.co.some(x => x.id === 'SD06-019') ? 2 : 0), seen = p.deck.splice(-n).reverse(); log(r, '🔎 สอดแนม ' + seen.length + ' ใบ: ' + seen.map(x => B[x.id].n).join(', '));
      seen.forEach(x => { if (campTxt(x) && B[x.id].c <= 4) putAv(r, i, x); else { p.hand.push(x); log(r, '✋ ' + B[x.id].n + ' ขึ้นมือ'); } }); } }); } });
}
/* ทำลาย Construct ด้วยความสามารถของ Avatar หรือ Magic — การ์ดสกิลใหม่ต้องเรียกฟังก์ชันนี้ (ไม่ใช่การทำลายจากการต่อสู้) */
function destroyCo(r, u) {
  const f = find(r, u); if (!f || f.z !== 'co') return;
  if (r.g.ask) return r.g.q.push(() => destroyCo(r, u));
  const i = f.i, p = r.p[i], done = () => { const h = find(r, u); if (!h || h.z !== 'co') return; take(r, u); p.hell.push(h.c); fx({ k: 'die', u, id: h.c.id }); log(r, '💥 Construct ' + B[h.c.id].n + ' ถูกทำลาย'); onConDie(r, i, h.c); };
  if (f.c.id === 'SD06-018' && !r.g.used[i].dhamma) {
    const m = [...p.hand, ...p.av].filter(c => c.id === 'SD06-007');
    if (m.length) return ask(r, i, { yn: true, text: 'อาจารย์ธรรมโชติ: ส่งกลับใต้ Deck เพื่อให้ ค่ายบางระจัน ไม่ถูกทำลาย?', cb: y => { if (!y) return done(); r.g.used[i].dhamma = 1; const c = m[0]; take(r, c.u); p.deck.unshift(c); log(r, '🛡 อาจารย์ธรรมโชติ กลับใต้ Deck — ค่ายบางระจัน ไม่ถูกทำลาย'); } });
  }
  done();
}
function shieldThen(r, p) {
  const d = r.p[p.who], L = p.tk === 'co' ? [] : d.av.filter(a => !a.tired && a.u !== p.tg && hasKw(r, a, 'โล่มนุษย์')).map(a => a.u);
  if (!L.length) return open(r, p);
  const go = () => r.g.q.unshift(() => open(r, p));
  ask(r, p.who, { text: 'โล่มนุษย์: เลือก Avatar โล่มนุษย์ (สภาพตื่น) เพื่อรับการโจมตีแทน — จะกลายเป็นสภาพนอน (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, onCancel: go,
    cb: us => { const s = find(r, us[0]); if (s && !s.c.tired) { s.c.tired = true; p.tg = s.c.u; p.tk = 'av'; if (s.c.id === 'SD05-004') { s.c.bp = (s.c.bp || 0) + 2; p.sh = s.c.u; } log(r, '🛡 โล่มนุษย์: ' + nmOf(s.c) + ' รับการโจมตีแทน'); } go(); } });
}
function endTurn456(r) {
  const g = r.g; r.p.forEach(q => { q.co.forEach(c => { if (c.pb) { c.pw = (c.pw || 0) - c.pb; c.pb = 0; } });
    q.av.slice().forEach(a => { if (a.ward && g.n >= a.ward) delete a.ward; if (a.exp && g.n >= a.exp) { log(r, '👻 ' + nmOf(a) + ' กลับลงนรก'); sendHell(r, a.u); } }); });
}
const myAvEq = f => (r, i) => r.p[i].av.filter(f).map(a => a.u);
const oneHand = (n, t) => ({ key: 'c', n, pay: 1, text: t, opts: (r, i, cx) => r.p[i].hand.filter(c => c.u !== cx.card.u).map(c => c.u) });
Object.assign(MG, {
  'SD04-014': { run: (r, i) => { const sm = (w, pred, t) => { const p = r.p[w], L = p.deck.filter(c => isAv(c) && B[c.id].c <= 5 && pred(c)).map(c => c.u);
      if (!L.length) { log(r, p.name + ': ไม่มี Avatar ให้อัญเชิญ'); return shuf(p.deck); } ask(r, w, { text: t, opts: L, cb: us => { putAv(r, w, fromZone(r, w, 'deck', us[0])); shuf(p.deck); } }); };
    sm(i, c => isTank(c), 'เลือก Avatar "รถถัง" (Cost ≤5) จาก Deck อัญเชิญ'); r.g.q.push(() => sm(1 - i, () => true, 'เลือก Avatar (Cost ≤5) จาก Deck ของเรา อัญเชิญ')); } },
  'SD04-015': { run: (r, i) => lifeDown(r, i) },
  'SD04-016': { run: (r, i) => { const p = r.p[i], c = p.deck.pop(); if (!c) return; log(r, '🔎 สอดแนม: ' + B[c.id].n);
    if (isAv(c) && B[c.id].s === 'คน' && B[c.id].c <= 3) putAv(r, i, c); else { p.deck.unshift(c); log(r, '⬇ ใส่ไว้ใต้ Deck'); } } },
  'SD04-017': { react: 'atk', steps: [{ key: 'k', pay: 1, text: 'เลือก Avatar "รถถัง" ของเรา 1 ใบ ทำลายเป็น Cost', opts: myAvEq(isTank) }], run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'SD04-018': { react: 'atkTank', run: (r, i, cx) => { const p = r.p[i], tg = cx.pend.tg, at = cx.pend.u;
    scout(r, i, 5, { text: 'เลือก Avatar {คน} ที่ติดชื่อ "Tank Ranger" 1 ใบ สวมให้รถถังที่ถูกโจมตี', pred: c => isAv(c) && B[c.id].s === 'คน' && B[c.id].n.includes('Tank Ranger') && !isTank(c), rest: 'bottom',
      then: c => { const t = find(r, tg); if (c && t && t.z === 'av' && canWear(t.c, c)) { wearOn(r, i, t.c, c); destroyAv(r, at); log(r, '💥 ทำลาย Avatar ที่สั่งโจมตี'); } else { if (c) { p.deck.unshift(c); } log(r, 'สวมใส่ไม่สำเร็จ'); } } }); } },
  'SD04-019': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ถาดหลุม', opts: r => allAv(r).map(a => a.x.u) }] },
  'SD05-015': { steps: [{ key: 't', text: 'เลือก Avatar {ปลา} ในนรกเรา', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && B[c.id].s === 'ปลา').map(c => c.u) }], run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); c && putAv(r, i, c, { tired: !landIs(r, 'SD05-014') }); } },
  'SD05-016': { react: 'atkPeople', run: (r, i, cx) => { cx.pend.cancel = 1; allAv(r).forEach(a => { if (a.x.u !== cx.pend.u) a.x.tired = !a.x.tired; }); log(r, '🌀 ยกเลิกการโจมตี และเปลี่ยนสภาพ Avatar ทุกใบ ยกเว้นตัวที่โจมตี'); } },
  'SD05-017': { mod: 1, steps: [{ key: 'tg', text: 'เลือก บึงทมิฬ People ที่จะสวมใส่ ปืนฉมวก', opts: myAvEq(isPeopleF) }] },
  'SD05-018': { mod: 1, steps: [{ key: 'tg', text: 'เลือก บึงทมิฬ People ที่จะสวมใส่ ตรีศูล', opts: myAvEq(isPeopleF) }] },
  'SD05-019': { run: (r) => { mill(r, 0, 3); mill(r, 1, 3); } },
  'SD05-020': { react: 'cast', run: (r, i, cx) => { const cc = cx.ev && cx.ev.cx; if (!cc) return; cc.cancelled = 1; const card = cc.card;
    if (r.g.land && r.g.land.c.u === card.u) { r.p[r.g.land.o].hell.push(card); r.g.land = null; } else if (find(r, card.u)) sendHell(r, card.u); log(r, '⛔ ยกเลิกการใช้ ' + B[card.id].n); } },
  'SD06-012': { steps: [oneHand(2, 'ทิ้งการ์ดบนมือ 2 ใบ')], run: (r, i) => tutor(r, i, c => campTxt(c), 'Avatar ที่มี ค่ายบางระจัน') },
  'SD06-013': { steps: [oneHand(1, 'ทิ้งการ์ดบนมือ 1 ใบ'), { key: 't', text: 'เลือก Avatar ที่มี ค่ายบางระจัน ในนรก', opts: (r, i) => r.p[i].hell.filter(c => campTxt(c)).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); if (c && putAv(r, i, c, { sm: 1 })) c.exp = r.g.n + 2; } },
  'SD06-014': { react: 'atk', run: (r, i, cx) => { const p = r.p[i], n = p.av.length + p.mg.length + p.co.length + p.hand.length + (r.g.land && r.g.land.o === i ? 1 : 0), a = find(r, cx.pend.u); if (a) { addTp(a.c, -2 * n); log(r, '🐎 ' + nmOf(a.c) + ' POWER -' + 2 * n); } } },
  'SD06-015': { react: 'summon', steps: [{ key: 'a', text: 'เลือก Avatar ที่มี ค่ายบางระจัน ของเรา', opts: myAvEq(campTxt) }, { key: 'b', text: 'เลือก Avatar ของฝ่ายตรงข้าม', opts: (r, i) => r.p[1 - i].av.map(a => a.u) }],
    run: (r, i, cx) => { destroyAv(r, cx.pick.a[0]); destroyAv(r, cx.pick.b[0]); log(r, '💥 ปืนใหญ่: ทำลาย Avatar 2 ใบ'); } },
  'SD06-016': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่มี ค่ายบางระจัน ที่จะสวมใส่', opts: myAvEq(campTxt) }] },
  'SD06-017': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่มี ค่ายบางระจัน ที่จะสวมใส่', opts: myAvEq(campTxt) }] },
});

const lifeFx = (r, i, id) => { const c = B[id], p = r.p[i];
  if (id === 'SD06-022') { p.co.forEach(x => { x.pw = (x.pw || 0) + 1; x.pb = (x.pb || 0) + 1; }); return log(r, '❤ ' + c.n + ': Construct ทุกใบ POWER +1 จนจบเทิร์น'); }
  if (id === 'SD06-023') return ask(r, i, { text: c.n + ': เลือก Construct ในนรกเรา 1 ใบ ขึ้นมือ', opts: p.hell.filter(x => x.id && B[x.id].t === 'Construct').map(x => x.u), cb: us => { p.hand.push(fromZone(r, i, 'hell', us[0])); log(r, '❤ นำ Construct ขึ้นมือ'); } });
  if (id === 'SD06-024') return scout(r, i, 5, { text: c.n + ': เลือก Construct 1 ใบ ขึ้นมือ', pred: x => B[x.id].t === 'Construct', rest: 'bottom', then: x => x && p.hand.push(x) }); if (/จั่วการ์ด 1 ใบ/.test(c.e) && /main phase/i.test(c.e)) { draw(r, p, 1); log(r, '❤ ' + c.n + ': ' + p.name + ' จั่ว 1 ใบ'); } else log(r, '❤ LIFE ' + c.n + ': ' + c.e + ' (ใช้เอง)'); };

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
const DC_MS = 180000, LOST = {};
const rjRoom = n => Object.values(rooms).find(q => q.g && !q.g.over && q.p.some(p => p.name === n));
function rjStatus(ws) {
  const q = rjRoom(ws.user);
  if (q) { const k = q.p.findIndex(p => p.name === ws.user), p = q.p[k]; ws.send(JSON.stringify({ t: 'rj', room: q.code, op: q.p[1 - k] && q.p[1 - k].name, left: p.dc ? Math.max(0, DC_MS - (Date.now() - p.dc)) : DC_MS })); return; }
  const l = LOST[ws.user]; if (l && Date.now() - l.at < 18e5) ws.send(JSON.stringify({ t: 'lost', op: l.op })); else delete LOST[ws.user];
}
const view = (r, i) => {
  const g = r.g, pub = p => ({ name: p.name, eq: p.eq || {}, av: p.av.map(x => ({ ...x, wr: undefined, wn: (x.wr || []).map(w => w.id), cp: P(r, x), ab: abOf(r, r.p.indexOf(p), x, 'av'), sg: hasKw(r, x, 'สามัคคี') ? 1 : 0 })), mg: p.mg.map(x => ({ ...x, ab: abOf(r, r.p.indexOf(p), x, 'mg') })), co: p.co.map(x => ({ ...x, ab: abOf(r, r.p.indexOf(p), x, 'co') })), hell: p.hell, dk: p.dk, deck: p.deck.length, hn: p.hand.length, life: p.life.map(l => l.up ? l : { up: 0 }) });
  return { i, odc: r.p[1 - i].dc ? Math.max(0, DC_MS - (Date.now() - r.p[1 - i].dc)) : 0, dc: g.dc || null, md: r.p.map(p => !!p.m), me: { ...pub(r.p[i]), hand: r.p[i].hand }, op: pub(r.p[1 - i]), mine: g.turn === i, phase: g.phase, land: g.land && { c: { ...g.land.c, ab: abOf(r, g.land.o, g.land.c, 'land') }, o: g.land.o }, log: g.log.slice(-40), over: g.over, ev: g.ev || null, dw: g.dw, dr: g.dr || null, bt: g.bt || null, fx: g.fxl || [], tn: g.n, ru: g.used && g.used[i] && g.used[i].React ? 1 : 0, ask: g.ask ? { mine: g.ask.who === i, text: g.ask.text, opts: g.ask.who === i ? g.ask.opts : [], n: g.ask.n, min: g.ask.min, cancel: g.ask.cancel, yn: g.ask.yn, cards: g.ask.who === i ? g.ask.cards : null } : null, won: g.over ? (g.win == null ? null : g.win === i) : null, pend: g.pend ? { mine: g.pend.who === i, ev: g.pend.ev ? { k: g.pend.ev.k, id: g.pend.ev.id } : null, k: g.pend.k, until: g.pend.until, u: g.pend.u, tg: g.pend.tg, ai: g.pend.ai } : null };
};
const sview = r => { const v = view(r, 0); v.spec = 1; v.mine = false; v.tp = r.g.turn; v.me.hn = r.p[0].hand.length; v.me.hand = []; v.ru = 1; if (v.ask) v.ask = { ...v.ask, mine: false, opts: [], cards: null }; if (v.pend) v.pend = { ...v.pend, mine: false }; return v; };
const bc = r => { (r.spec || []).forEach(w => { if (r.g && w.readyState === 1) w.send(JSON.stringify({ t: 's', s: sview(r) })); }); bc0(r); };
const bc0 = r => r.p.forEach((p, i) => {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(r.g ? { t: 's', s: view(r, i) } : { t: 'lobby', owner: r.p[0] && r.p[0].name, exp: r.exp ? Math.max(0, r.exp - Date.now()) : 0, clock: r.cfg.clock, react: r.cfg.react, ban: r.cfg.ban, players: r.p.map(x => ({ name: x.name, ready: !!x.deck })) }));
});
const log = (r, s) => r.g.log.push(s);
const ev = (r, id) => { r.g.ev = { n: (r.g.ev ? r.g.ev.n : 0) + 1, id }; };
const draw = (r, p, n) => { for (let k = 0; k < n && p.deck.length; k++) p.hand.push(p.deck.pop()); if (!p.deck.length && !r.g.over) { r.g.over = p.name + ' เด็คหมด แพ้!'; r.g.win = r.p ? 1 - r.p.indexOf(p) : null; } };
const pw = x => (x.tk ? x.tk.p : B[x.id].p) + x.pw;
const find = (r, u) => { for (let i = 0; i < 2; i++) for (const z of ZN) { const k = r.p[i][z].findIndex(c => c.u === u); if (k >= 0) return { i, z, k, c: r.p[i][z][k] }; } return null; };
const release = (r, u) => r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) if (p.mg[k].at === u) { const [g] = p.mg.splice(k, 1); delete g.at; p.hell.push(g); } });
const take = (r, u) => { const f = find(r, u); if (!f) E('ไม่พบการ์ด'); r.p[f.i][f.z].splice(f.k, 1); if (f.z === 'av') { release(r, u); if (f.c.wr && f.c.wr.length) { f.c.wr.forEach(w => r.p[f.i].hell.push(w)); f.c.wr = []; } } delete f.c.at; return f; };
const kill = (r, i, u, ns) => {
  const f0 = find(r, u);
  if (f0 && f0.z === 'av' && !ns && f0.c.id !== 'SD06-005' && campTxt(f0.c) && hasCamp(r, f0.i) && !r.g.ask) {
    const g5 = r.p[f0.i].av.find(a => a.id === 'SD06-005');
    if (g5) { ask(r, f0.i, { yn: true, text: 'พันเรือง: ทำลาย พันเรือง แทน ' + nmOf(f0.c) + ' ไหม?', cb: y => y ? kill(r, f0.i, g5.u, 1) : kill(r, i, u, 1) }); return; }
  }
  if (f0 && f0.z === 'av') {
    if (f0.c.ward) { delete f0.c.ward; log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกทำลาย (คุณพยาบาล)'); return; }
    const k = (f0.c.wr || []).findIndex(w => w.id === 'SD04-002');
    if (k >= 0) { r.p[f0.i].hell.push(f0.c.wr.splice(k, 1)[0]); log(r, '🛡 ทำลาย จ่ามะนาว แทน ' + nmOf(f0.c)); return; }
  }
  const f = take(r, u); fx({ k: 'die', u, id: f.c.tk ? null : f.c.id, nm: f.c.tk ? f.c.tk.n : null }); if (!f.c.tk) r.p[f.i].hell.push(f.c);
  deathFx(r, f);
};

function payOK(c, pay, me) {
  if (!c.c) { if (pay.length) E('Cost 0 ไม่ต้องจ่าย'); return; }
  const gs = pay.map(x => { const d = B[x.id]; if (me && me.noCost && me.noCost.includes(d.n)) E('ใช้เป็น Cost ไม่ได้: ' + d.n); if (!d.g) E('การ์ด Gem 0 ใช้จ่ายไม่ได้'); if (d.gc && d.gc !== c.col) E('สี Gem ไม่ตรง: ' + d.n); return d.g; });
  const sum = gs.reduce((a, b) => a + b, 0);
  if (sum < c.c) E('Gem ไม่พอ (' + sum + '/' + c.c + ')');
}
function startTurn(r) {
  const g = r.g, p = r.p[g.turn]; g.used = [{}, {}];
  p.av.forEach(a => a.tired = false);
  const b4 = p.hand.length; draw(r, p, g.n === 0 ? 2 : p.hand.length < 3 ? 3 - p.hand.length : 1);
  const got = p.hand.length - b4; g.dr = { n: ++DRN, who: g.turn, c: got };
  g.phase = 'main'; log(r, '— เทิร์น ' + p.name + ' —'); log(r, p.name + ' จั่ว ' + got + ' ใบ');
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

function passTurn(r, i) {
  const g = r.g; if (r.p[i].hand.length > 7) E('มือเกิน 7 ต้องทิ้งก่อน');
  r.p.forEach(q => q.av.forEach(a => { a.tp = 0; a.bp = 0; })); g.turn = 1 - i; g.n++; endTurn456(r); startTurn(r);
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
      if (m.fin) { if (g.phase === 'dice' || g.phase === 'pick' || g.phase === 'mull') E('ยังจบเทิร์นไม่ได้'); if (me.hand.length > 7) { g.phase = 'end'; log(r, me.name + ': มือเกิน 7 ต้องทิ้ง ' + (me.hand.length - 7) + ' ใบ'); } else passTurn(r, i); break; }
      if (g.phase === 'main') g.phase = g.n === 0 ? 'end' : 'battle';
      else if (g.phase === 'battle') g.phase = 'end';
      else passTurn(r, i);
      break;
    case 'discard': { const f = own(m.u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); take(r, m.u); me.hell.push(f.c); log(r, me.name + ' ทิ้ง ' + B[f.c.id].n); break; }
    case 'summon': case 'build': {
      mainOnly(); const f = own(m.u), c = B[f.c.id], av = m.t === 'summon';
      if (f.z !== 'hand' || c.t !== (av ? 'Avatar' : 'Construct')) E('ประเภทผิด');
      if (f.c.id === 'SD03-003') E('การ์ดนี้ลงสนามจากบนมือไม่ได้');
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
      if (a.c.id === 'SD04-004' && !(a.c.wr && a.c.wr.length)) E('รถถังต้องมี Avatar สวมใส่ก่อนจึงโจมตีได้');
      if (a.c.id === 'SD06-003' && m.tg === 'life' && !hasCamp(r, i)) E('ทองเหม็นตี LIFE ไม่ได้ ถ้าไม่ได้ควบคุม ค่ายบางระจัน');
      let tk = 'av';
      if (m.tg === 'life') { if (op.av.length && !kick(r, a.c)) E('ต้องกำจัด Avatar ก่อน'); tk = 'life'; }
      else if (op.av.some(x => x.u === m.tg)) tk = 'av';
      else if (op.co.some(x => x.u === m.tg)) tk = 'co';
      else E('ไม่พบเป้าหมาย');
      const sup = [...new Set((m.sup || []).map(Number))].filter(u => u !== a.c.u).map(u => { const q = own(u); if (q.z !== 'av' || q.c.tired || q.c.tk || !hasKw(r, q.c, 'สามัคคี')) E('สามัคคีไม่ได้: ' + nmOf(q.c)); return q.c; });
      sup.forEach(q => { a.c.bp = (a.c.bp || 0) + P(r, q); q.tired = true; fx({ k: 'buff', u: a.c.u, v: P(r, q) }); log(r, '🤝 ' + nmOf(q) + ' สามัคคี +' + P(r, q)); });
      if (g.land && g.land.c.id === 'SD02-020' && TRIO.includes(nmOf(a.c))) { a.c.bp = (a.c.bp || 0) + 2; fx({ k: 'buff', u: a.c.u, v: 2 }); log(r, '🏠 สมชายห้องเช่า: POWER +2'); }
      a.c.tired = true; log(r, nmOf(a.c) + ' โจมตี ' + (tk === 'life' ? 'LIFE' : tk === 'co' ? 'Construct' : 'Avatar'));
      if (a.c.id === 'SD06-002' && tk === 'life' && op.av.length) g.q.push(() => ask(r, i, { text: 'เตะไข่: เลือก Avatar ฝ่ายเรา 1 ใบ ทำลาย', opts: me.av.map(x => x.u), cb: us => destroyAv(r, us[0]) }));
      g.q.push(() => fxAtk(r, i, a.c)); g.q.push(() => shieldThen(r, { who: 1 - i, k: 'atk', ai: i, u: m.u, tg: m.tg, tk })); break;
    }
    case 'use': {
      mainOnly(); let f = find(r, m.u), z;
      if (f && f.i === i) z = f.z; else if (g.land && g.land.o === i && g.land.c.u === m.u) { f = { i, z: 'land', c: g.land.c }; z = 'land'; } else E('ไม่ใช่การ์ดของเรา');
      const def = AB[f.c.id]; if (!def || def.z !== z) E('การ์ดนี้ไม่มีความสามารถที่สั่งใช้ได้');
      if (f.c.us === g.n) E('ใช้ได้เทิร์นละครั้ง'); if (def.can && !def.can(r, i, f.c)) E('เงื่อนไขการใช้ไม่ครบ');
      startUse(r, i, f.c, def); break;
    }
    case 'oe': { if (g.phase !== 'dice' || i !== 0) E('ตอนนี้ไม่ได้'); const d = 1 + Math.floor(Math.random() * 6); g.dw = (d % 2 === 1) === (m.v === 'odd') ? 0 : 1; g.dc = { n: ++DCN, d, v: m.v, w: g.dw }; log(r, me.name + ' ทอย ' + d + ' · ' + r.p[g.dw].name + ' ชนะ'); g.phase = 'pick'; break; }
    case 'first': { if (g.phase !== 'pick' || i !== g.dw) E('ไม่ใช่สิทธิ์'); g.turn = m.v ? i : 1 - i; log(r, r.p[g.turn].name + ' เริ่มก่อน'); g.phase = 'mull'; break; }
    case 'pass': { if (!g.pend || g.pend.who !== i) E('ไม่มี React'); passReact(r); break; }
    case 'token': case 'move': case 'pw': case 'tire': case 'drawn':
      E('คำสั่งนี้ถูกปิด'); break;
    case 'discardm': { const us = [...new Set((m.us || []).map(Number))].slice(0, 20); if (!us.length) E('ยังไม่เลือก'); us.forEach(u => { const f = own(u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); }); us.forEach(u => { const f = take(r, u); me.hell.push(f.c); }); log(r, me.name + ' ทิ้ง ' + us.length + ' ใบ'); if (mine && g.phase === 'end' && me.hand.length <= 7) passTurn(r, i); break; }
    case 'dview': { const n = +m.n | 0, L = (n > 0 ? me.deck.slice(-n) : me.deck.slice()).reverse(); me.ws && me.ws.send(JSON.stringify({ t: 'dv', cards: L.map(c => ({ u: c.u, id: c.id })) })); log(r, me.name + ' ดูเด็ค'); break; }
    case 'dmove': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบ'); if (!['hand','hell','av','mg','co'].includes(m.to)) E('โซนผิด'); const [c] = me.deck.splice(k, 1); me[m.to].push(c); log(r, me.name + ' ย้ายจากเด็ค → ' + m.to); if (!me.deck.length && !g.over) { g.over = me.name + ' เด็คหมด'; g.win = 1 - i; } break; }
    case 'dpos': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบ'); const [c] = me.deck.splice(k, 1); m.top ? me.deck.push(c) : me.deck.unshift(c); log(r, me.name + ' วาง' + (m.top ? 'บน' : 'ใต้') + 'เด็ค'); break; }
    case 'dshuf': shuf(me.deck); log(r, me.name + ' สับเด็ค 🔀'); break;
    case 'surrender': { if (g.phase === 'dice' || g.phase === 'pick') E('ยังยอมแพ้ไม่ได้'); g.ask = null; g.pend = null; g.q = []; g.over = me.name + ' ยอมแพ้'; g.win = 1 - i; log(r, '🏳 ' + me.name + ' ยอมแพ้'); break; }
    case 'chat': log(r, '💬 ' + me.name + ': ' + String(m.x || '').slice(0, 200)); break;
    default: E('คำสั่งไม่รู้จัก');
  }
  runQ(r);
}

const hasReact = (r, w) => !r.g.used[w].React && r.p[w].hand.some(c => { const d = B[c.id]; return d && d.t === 'Magic' && d.st === 'React'; });
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
  if (p.tk === 'av') { const d0 = op.av.find(x => x.u === p.tg); if (d0 && d0.id === 'SD03-002') { mill(r, 1 - p.ai, 2, d0); addTp(d0, 1); log(r, '✨ พ่อจีจ้า POWER +1'); } }
  if (p.tk === 'av') { const d1 = op.av.find(x => x.u === p.tg); if (d1 && d1.id === 'SD05-001') { const n = tiredCnt(r); addTp(d1, n); log(r, '✨ คุณจิระ POWER +' + n); } }
  if (r.g.over) return;
  let pa = P(r, a); const base = { ai: p.ai, aid: a.tk ? null : a.id, an, pa };
  if (p.tg === 'life') {
    if (op.av.length && !kick(r, a)) return log(r, 'ตี LIFE ไม่ได้');
    log(r, an + ' (' + pa + ') โจมตี LIFE');
    if (pa > 0) { const x = hit(r, op, me); if (x !== 'KO' && !op.av.length) r.g.q.push(() => wall(r, 1 - p.ai)); setBt(r, { ...base, tg: 'life', res: x === 'KO' ? 'ko' : 'life', cid: x === 'KO' ? null : x }); }
    else { log(r, 'Power 0 ไม่เสียหาย'); setBt(r, { ...base, tg: 'life', res: 'zero' }); }
  } else if (p.tk === 'co') {
    const d = op.co.find(x => x.u === p.tg); if (!d) return log(r, 'เป้าหาย');
    const pd = (B[d.id].p || 0) + (d.pw || 0), dn = B[d.id].n; let res = 'none';
    log(r, an + ' (' + pa + ') โจมตี Construct ' + dn + ' (' + pd + ')');
    if (pa > pd) { take(r, d.u); fx({ k: 'die', u: d.u, id: d.id }); op.hell.push(d); onConDie(r, 1 - p.ai, d); log(r, dn + ' ถูกทำลาย'); res = 'win'; } else log(r, 'Power ไม่เกิน Construct — ไม่มีอะไรเกิดขึ้น');
    setBt(r, { ...base, tg: 'av', dn, did: d.id, pd, res });
  } else {
    const d = op.av.find(x => x.u === p.tg); if (!d) return log(r, 'เป้าหาย');
    let pd = P(r, d); const dn = nmOf(d); let res;
    if (hasEq(r, a, 'SD05-017') && d.tired) { addTp(a, 1); addTp(d, -1); pa += 1; pd = Math.max(0, pd - 1); base.pa = pa; log(r, '🔱 ปืนฉมวก: POWER +1 / เป้าหมาย -1'); }
    log(r, an + ' (' + pa + ') สู้ ' + dn + ' (' + pd + ')');
    if (pa === pd) { if (pa > 0) { kill(r, p.ai, a.u); kill(r, 1 - p.ai, d.u); log(r, 'ตายทั้งคู่'); res = 'both'; } else { log(r, 'เสมอ (0)'); res = 'none'; } }
    else if (pa > pd) { kill(r, 1 - p.ai, d.u); log(r, dn + ' ตาย'); res = 'win'; }
    else { kill(r, p.ai, a.u); log(r, an + ' ตาย'); res = 'lose'; }
    afterBattle(r, p, a, d, res);
    setBt(r, { ...base, tg: 'av', dn, did: d.tk ? null : d.id, pd, res });
  }
  if (p.tk !== 'av') surviveFx(r, p.ai, a);
  a.bp = 0; if (p.sh) { const q = find(r, p.sh); q && (q.c.bp = 0); }
}
function passReact(r) { CR = r; const p = r.g.pend; r.g.pend = null; if (p && p.k === 'atk') resolveAtk(r, p); runQ(r); }
function begin(r) {
  r.p.forEach(x => { draw({ g: {} }, x, 5); x.t = (r.cfg.clock || 0) * 60000; x.rm = 0; x.dc = null; x.m = false; });
  r.g = { turn: 0, phase: 'dice', pend: null, ask: null, q: [], n: 0, used: [{}, {}], land: null, log: ['เริ่มเกม!'], over: null };
}
async function rematch(r, i) {
  r.p[i].rm = 1; if (!r.rmT) r.rmT = Date.now();
  if (r.p.every(x => x.rm)) {
    for (const x of r.p) { const d = await pickDeck(x.last, x.name, r.cfg.ban); x.deck = shuf(d.main.map(inst)); x.life = shuf(d.life.map(id => ({ ...inst(id), up: 0 }))); x.hand = []; x.hell = []; x.av = []; x.mg = []; x.co = []; x.dk = []; x.lf = []; x.noCost = []; }
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
    r.p.forEach((p, k) => { if (!g.over && p.dc && now - p.dc > DC_MS) { g.over = p.name + ' หลุด 3 นาที แพ้'; g.win = 1 - k; LOST[p.name] = { op: r.p[1 - k].name, at: now }; } });
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
        ws.user = n; ws.send(JSON.stringify({ t: 'auth', tok: sign(n), me: prof(n, d) })); rjStatus(ws); return;
      }
      if (!ws.user) E('ต้องล็อกอินก่อน');
      if (m.t === 'rjq') { rjStatus(ws); return; }
      if (m.t === 'lostack') { delete LOST[ws.user]; return; }
      if (m.t === 'rjff') {
        const q = rjRoom(ws.user); if (!q) E('ไม่มีเกมที่ค้างอยู่');
        const k = q.p.findIndex(p => p.name === ws.user), g = q.g;
        g.ask = null; g.pend = null; g.q = []; g.over = ws.user + ' ยอมแพ้'; g.win = 1 - k; log(q, '🏳 ' + ws.user + ' ยอมแพ้');
        bc(q); settle(q).catch(() => { }); ws.send(JSON.stringify({ t: 'lost', op: q.p[1 - k].name, self: 1 })); return;
      }
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
        if (life.some(i => B[i].t !== 'Life') || main.some(i => B[i].t === 'Life')) E('ประเภทผิด');
        mkDeck([...main, ...life].map(i => i + ' x1').join(' '), 0, false);
        const nm = String(m.name || 'เด็คใหม่').slice(0, 20); d.decks = d.decks || {};
        if (!d.decks[nm] && Object.keys(d.decks).length >= 20) E('เด็คเต็ม 20'); d.decks[nm] = { main, life };
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
        const ps = []; for (let k = 0; k < n; k++) { d.pity = (d.pity || 0) + 1; const p = pack(m.set, d.pity >= 20); if (['UR','SEC'].includes(p[4].r)) d.pity = 0; p.forEach(x => add(d, x)); ps.push(p); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d) })); return;
      }
      if (m.t === 'code') {
        const d = await dbGet(ws.user), c = String(m.c || '').trim().toUpperCase();
        const K = { BOTFANMADE: { gems: 5555 }, SOCOOL: { art: 5 }, AMUJI: { gems: 111111 }, ...((await dbGet('sys:codes')) || {}) }, X = K[c]; if (!X) E('โค้ดผิด'); if (d.codes.includes(c)) E('ใช้แล้ว'); d.codes.push(c);
        let ps = []; d.gems += X.gems || 0;
        if (X.art) { const A = []; CARDS.forEach(x => x.v.forEach(r => ['PR','UBR','SEC'].includes(r) && A.push({ id: x.id, r }))); const p = []; for (let k = 0; k < X.art; k++) { const x = pick(A); add(d, x); p.push(x); } for (let k = 0; k < p.length; k += 5) ps.push(p.slice(k, k + 5)); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d), note: X.gems ? 'ได้ ' + X.gems + ' Gem' : '' })); return;
      }
      if (m.t === 'join') {
        const code = String(m.room || '').toUpperCase().slice(0, 8), name = ws.user;
        if (!code) E('ใส่รหัสห้อง');
        r = rooms[code];
        if (!r) { if (!m.create) E('ไม่พบห้อง'); r = rooms[code] = { p: [], g: null, code, exp: Date.now() + 18e4, cfg: { clock: [5,10,20].includes(+m.clock) ? +m.clock : 0, react: [10,20,30].includes(+m.react) ? +m.react : 0, ban: String(m.ban) !== '0' } }; }
        i = r.p.findIndex(p => p.name === name);
        if (i < 0) { if (r.p.length >= 2) E('ห้องเต็ม'); i = r.p.length; r.p.push({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], dk: [], life: [], lf: [], noCost: [] }); }
        r.p[i].ws = ws; delete LOST[name]; { const ud = await dbGet(name); r.p[i].eq = (ud && ud.eq) || {}; } if (r.p.length === 2) r.exp = 0; if (r.p[i].dc) { r.p[i].dc = null; if (r.g) log(r, '✔ ' + name + ' กลับมา'); } bc(r);
      } else if (m.t === 'deck') {
        if (!r || r.g) E('ตั้งเด็คไม่ได้');
        const d = await pickDeck(m, ws.user, r.cfg.ban), p = r.p[i];
        p.last = m; p.deck = shuf(d.main.map(inst)); p.life = shuf(d.life.map(id => ({ ...inst(id), up: 0 }))); p.hand = [];
        bc(r);
      } else if (m.t === 'rcfg') {
        if (!r || r.g || i !== 0) E('เฉพาะเจ้าห้องตั้งกติกาได้');
        if (m.clock != null) r.cfg.clock = [5, 10, 20].includes(+m.clock) ? +m.clock : 0;
        if (m.react != null) r.cfg.react = [10, 20, 30].includes(+m.react) ? +m.react : 0;
        if (m.ban != null) { const nb = String(m.ban) !== '0'; if (nb !== r.cfg.ban) r.p.forEach(x => { x.deck = null; }); r.cfg.ban = nb; }
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
console.log('[KD] loading');
try{
Object.assign(SUM,{
'KD01-007':function(r,i){scout(r,i,3,{text:'จุติ KD01-007',pred:function(c){return (c.s||'')==='เทพ';},rest:'bottom',then:function(c){if(c)r.p[i].hand.push(c);}});},
'KD02-003':function(r,i){var me=r.p[i];var L=me.hell.filter(function(c){return isAv(c)&&B[c.id].n.indexOf('นายนิรยบาล')===0;});if(!L.length)return;ask(r,i,{text:'จุติ KD02-003',opts:L.map(function(c){return c.u;}),cb:function(us){var h=me.hell.find(function(c){return c.u===us[0];});if(h)summonFree(r,i,h);}});},
'KD02-004':function(r,i){scout(r,i,5,{text:'จุติ KD02-004',pred:function(c){return isAv(c)&&(B[c.id].n==='พญายม'||B[c.id].n.indexOf('นายนิรยบาล')===0);},rest:'bottom',then:function(c){if(c)r.p[i].hand.push(c);}});},
'KD04-002':function(r,i){scout(r,i,5,{text:'จุติ KD04-002',pred:function(c){return isAv(c)&&B[c.id].n.indexOf('ไมเกรน')>=0;},rest:'bottom',then:function(c){if(c)r.p[i].hand.push(c);}});},
'KD04-003':function(r,i){scout(r,i,5,{text:'จุติ KD04-003',pred:function(c){return B[c.id].st==='Modification'&&(B[c.id].n||'').indexOf('อาวุธ')>=0;},rest:'bottom',then:function(c){if(c)r.p[i].hand.push(c);}});}
});
var d2={run:function(r,i){draw(r,r.p[i],2);log(r,'จั่ว 2');}};
MG['KD01-013']=d2;MG['KD03-012']=d2;MG['KD04-018']=d2;
MG['KD01-014']={steps:[{key:'t',text:'Avatar',opts:function(r){return allAv(r).map(function(a){return a.x.u;});}}],run:function(r,i,cx){var t=find(r,cx.pick.t[0]);if(t)addTp(t.c,4);}};
MG['KD01-016']={mod:1,steps:[{key:'tg',text:'Avatar',opts:function(r){return allAv(r).map(function(a){return a.x.u;});}}]};
MG['KD01-017']={react:'summon',run:function(r,i,cx){destroyAv(r,cx.ev.u);}};
MG['KD02-014']={run:function(r,i){var me=r.p[i];mill(r,i,3);var seen={};me.hell.forEach(function(c){if(isAv(c)&&B[c.id].s==='นรก')seen[B[c.id].n]=1;});var cnt=Object.keys(seen).length;draw(r,me,cnt>=5?2:1);}};
MG['KD02-015']={steps:[{key:'t',text:'Avatar ศัตรู',opts:function(r){return r.p[1].av.map(function(a){return a.u;});}}],run:function(r,i,cx){bounce(r,cx.pick.t[0]);}};
MG['KD02-019']={mod:1,steps:[{key:'tg',text:'Avatar นรก',opts:function(r,i){return r.p[i].av.filter(function(x){return B[x.id].s==='นรก';}).map(function(x){return x.u;});}}]};
Object.assign(AB,{
'KD04-006':{z:'av',steps:[{key:'t',text:'ไมเกรน',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].n.indexOf('ไมเกรน')>=0;}).map(function(a){return a.u;});}}],run:function(r,i,cx){cx.card.us=r.g.n;var t=find(r,cx.pick.t[0]);if(t)t.c.ward=(r.g.n||0)+1;}}
});
console.log('[KD] loaded OK — SUM/MG/AB extended');
}catch(e){console.log('[KD] load error:',e.message);}
/* ===== KD BATCH 3: MG + Hook ===== */
try{
var d2={run:function(r,i){draw(r,r.p[i],2);log(r,'จั่ว 2');}};
MG['KD01-013']=d2;MG['KD03-012']=d2;MG['KD04-018']=d2;
MG['KD01-014']={steps:[{key:'t',text:'Avatar',opts:function(r){return allAv(r).map(function(a){return a.x.u;});}}],run:function(r,i,cx){var t=find(r,cx.pick.t[0]);if(t)addTp(t.c,4);}};
MG['KD01-016']={mod:1,steps:[{key:'tg',text:'Avatar',opts:function(r){return allAv(r).map(function(a){return a.x.u;});}}]};
MG['KD01-017']={react:'summon',run:function(r,i,cx){destroyAv(r,cx.ev.u);}};
MG['KD01-018']={react:'atk',run:function(r,i,cx){var p=r.p[i];var n=p.av.length+p.mg.length+p.co.length+p.hand.length+((r.g.land&&r.g.land.o===i)?1:0);var a=find(r,cx.pend.u);if(a)addTp(a.c,-2*n);}};
MG['KD02-014']={run:function(r,i){var me=r.p[i];mill(r,i,3);var seen={};me.hell.forEach(function(c){if(isAv(c)&&B[c.id].s==='นรก')seen[B[c.id].n]=1;});draw(r,me,Object.keys(seen).length>=5?2:1);}};
MG['KD02-015']={steps:[{key:'t',text:'Avatar ศัตรู',opts:function(r){return r.p[1].av.map(function(a){return a.u;});}}],run:function(r,i,cx){bounce(r,cx.pick.t[0]);}};
MG['KD02-017']={react:'any',run:function(r,i,cx){if(r.g.pend)r.g.pend.cancel=1;}};
MG['KD02-018']={react:'cast',run:function(r,i,cx){var cc=cx.ev&&cx.ev.cx;if(cc)cc.cancelled=1;}};
MG['KD02-019']={mod:1,steps:[{key:'tg',text:'Avatar นรก',opts:function(r,i){return r.p[i].av.filter(function(x){return B[x.id].s==='นรก';}).map(function(x){return x.u;});}}]};
MG['KD03-013']={steps:[{key:'t',text:'ผี ≤4',opts:function(r,i){return r.p[i].deck.filter(function(c){return isAv(c)&&B[c.id].s==='ผี'&&B[c.id].c<=4;}).map(function(c){return c.u;});}}],run:function(r,i,cx){if(!r.p[i].av.some(function(a){return B[a.id].s==='มนุษย์'&&B[a.id].c>=3;}))return;var c=fromZone(r,i,'deck',cx.pick.t[0]);if(c)putAv(r,i,c);shuf(r.p[i].deck);}};
MG['KD03-014']={run:function(r,i){if(!r.p[i].av.some(function(a){return B[a.id].n.indexOf('ไอดอล')>=0;}))return;var L=r.p[i].deck.filter(function(c){return isAv(c)&&B[c.id].n.indexOf('โอตะ')>=0;});if(L.length){r.p[i].hand.push(fromZone(r,i,'deck',L[0].u));}}};
MG['KD03-015']={react:'atk',run:function(r,i,cx){var t=find(r,cx.pend.tg);if(!t||B[t.c.id].n.indexOf('ไอดอล')<0)return;cx.pend.cancel=1;var L=r.p[i].hell.filter(function(c){return isAv(c)&&B[c.id].n.indexOf('โอตะ')>=0;});if(L.length)wearOn(r,i,t.c,L[0]);}};
MG['KD03-016']={react:'summon',run:function(r,i,cx){destroyAv(r,cx.ev.u);}};
MG['KD03-017']={react:'use',run:function(r,i,cx){var t=find(r,cx.ev&&cx.ev.u);if(t)t.c.noab=r.g.n;}};
MG['KD03-018']={mod:1,steps:[{key:'tg',text:'Avatar',opts:function(r){return allAv(r).map(function(a){return a.x.u;});}}]};
MG['KD03-019']={mod:1,steps:[{key:'tg',text:'ไอดอล',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].n.indexOf('ไอดอล')>=0;}).map(function(a){return a.u;});}}],run:function(r,i){draw(r,r.p[i],1);}};
MG['KD04-012']={steps:[{key:'t',text:'ไมเกรน',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].n.indexOf('ไมเกรน')>=0;}).map(function(a){return a.u;});}}],run:function(r,i,cx){var t=find(r,cx.pick.t[0]);if(t)t.c.multi=r.g.n;}};
MG['KD04-013']={mod:1,steps:[{key:'tg',text:'หุ่นยนต์',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].s==='หุ่นยนต์';}).map(function(a){return a.u;});}}]};
MG['KD04-014']={mod:1,steps:[{key:'tg',text:'ผู้กล้า',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].n.indexOf('ผู้กล้า')>=0;}).map(function(a){return a.u;});}}]};
MG['KD04-015']={mod:1,steps:[{key:'tg',text:'หุ่นยนต์',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].s==='หุ่นยนต์';}).map(function(a){return a.u;});}}]};
MG['KD04-019']={react:'cast',run:function(r,i,cx){var cc=cx.ev&&cx.ev.cx;if(cc)cc.cancelled=1;}};
MG['KD04-020']={react:'battle',run:function(r,i,cx){var L=r.p[i].hell.filter(function(c){return B[c.id].st==='Modification';});if(L.length)r.p[i].hand.push(fromZone(r,i,'hell',L[0].u));var a=find(r,cx.pend.u);if(a)addTp(a.c,-1);}};

Object.assign(AB,{
'KD04-002':{z:'av',steps:[{key:'t',text:'ทิ้ง 1',opts:function(r,i,cx){return r.p[i].hand.filter(function(c){return c.u!==cx.card.u;}).map(function(c){return c.u;});}}],run:function(r,i,cx){cx.card.us=r.g.n;sendHell(r,cx.pick.t[0]);var L=r.p[i].hell.filter(function(c){return B[c.id].st==='Modification'&&(B[c.id].n||'').indexOf('อาวุธ')>=0;});if(L.length)r.p[i].hand.push(fromZone(r,i,'hell',L[0].u));}},
'KD04-006':{z:'av',steps:[{key:'t',text:'ไมเกรน',opts:function(r,i){return r.p[i].av.filter(function(a){return B[a.id].n.indexOf('ไมเกรน')>=0;}).map(function(a){return a.u;});}}],run:function(r,i,cx){cx.card.us=r.g.n;var t=find(r,cx.pick.t[0]);if(t)t.c.ward=(r.g.n||0)+1;}},
'KD02-001':{z:'av',can:function(r,i){var L=r.p[i].hell.filter(function(c){return isAv(c)&&B[c.id].s==='นรก';});var s={};L.forEach(function(c){s[B[c.id].n]=1;});return Object.keys(s).length>=7;},steps:[{key:'t',text:'เนรเทศ นรก 5',opts:function(r,i){return r.p[i].hell.filter(function(c){return isAv(c)&&B[c.id].s==='นรก';}).map(function(c){return c.u;});},n:5,min:5}],run:function(r,i,cx){cx.card.us=r.g.n;cx.pick.t.forEach(function(u){var k=r.p[i].hell.findIndex(function(c){return c.u===u;});if(k>=0)r.p[i].dk.push(r.p[i].hell.splice(k,1)[0]);});r.p[1-i].av.slice().forEach(function(x){if(x.u!==cx.card.u)kill(r,1-i,x.u);});}},
'KD04-001':{z:'av',can:function(r,i){var L=r.p[i].hell.filter(function(c){return isAv(c)&&B[c.id].n.indexOf('ไมเกรน')>=0;});var s={};L.forEach(function(c){s[B[c.id].n]=1;});return Object.keys(s).length>=3;},steps:[{key:'t',text:'ไมเกรน 3 ชื่อ',opts:function(r,i){var L=r.p[i].hell.filter(function(c){return isAv(c)&&B[c.id].n.indexOf('ไมเกรน')>=0;});return L.map(function(c){return c.u;});},n:3,min:3}],run:function(r,i,cx){cx.card.us=r.g.n;cx.pick.t.forEach(function(u){var k=r.p[i].hell.findIndex(function(c){return c.u===u;});if(k>=0)r.p[i].dk.push(r.p[i].hell.splice(k,1)[0]);});}}
});
console.log('[KD] Batch3 loaded');
}catch(e){console.log('[KD] Batch3 error:',e.message);}
/* ===== END BATCH 3 ===== */
srv.listen(process.env.PORT || 3000, () => console.log('ready'));
if (process.env.BOT_TEST) module.exports = { rooms, act, inst, find, P, B, view, sview, runQ, wss, shuf, destroyCo };
