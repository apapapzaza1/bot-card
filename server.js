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
  if (d.cards) { d.stg = d.stg || [];
    [...new Set(['SD01','SD02','SD03', ...(d.bought || [])])].filter(s => ST[s] && !d.stg.includes(s)).forEach(s => {
      const own = {}; Object.entries(d.cards).forEach(([k, v]) => { const i = k.split('|')[0]; own[i] = (own[i] || 0) + v; });
      ST[s].main.concat(ST[s].life).forEach(([id, n, r]) => { if (!B[id]) return; const miss = n - (own[id] || 0); for (let j = 0; j < miss; j++) add(d, { id, r: (B[id].v || []).includes(r) ? r : (B[id].v || ['C'])[0] }); });
      d.stg.push(s); }); }
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
const RT = ['C','R','SR','UR','SEC','PR','UBR','USEC'];
const RW = { R: 92, SR: 7, UR: .8, SEC: .15, PR: .03, UBR: .015, USEC: .005 };
const CW = { R: 70, SR: 24, UR: 4.5, SEC: 1, PR: .3, UBR: .15, USEC: .05 };
const GW = { UR: 90, SEC: 8.5, PR: 1, UBR: .4, USEC: .1 };
function eff(av, W) { const o = {}; for (const t of RT) { const w = W[t]; if (!w) continue; let k = RT.indexOf(t); while (k > 0 && !av.has(RT[k])) k--; const tt = av.has(RT[k]) ? RT[k] : 'C'; o[tt] = (o[tt] || 0) + w; } return o; }
function pack(set, gar) {
  const R = []; CARDS.forEach(c => c.id.startsWith(set + '-') && c.v.forEach(r => R.push({ id: c.id, r })));
  const av = new Set(R.map(x => x.r)), by = r => R.filter(x => x.r === r);
  const roll = W => { const e = eff(av, W), tot = Object.values(e).reduce((a, b) => a + b, 0); let x = Math.random() * tot; for (const [t, w] of Object.entries(e)) if ((x -= w) < 0) return t; return 'R'; };
  const g = r => { const a = by(r); return a.length ? pick(a) : pick(by('C').length ? by('C') : R); };
  return [g('C'), g('C'), g('C'), g(roll(RW)), g(roll(gar ? GW : CW))];
}
const inst2 = (id, art) => { const c = inst(id); if (art && art[id]) c.ar = art[id]; return c; };
function deckInsts(d) { const left = {}; Object.entries(d.vr || {}).forEach(([k, n]) => { const [i, r] = k.split('|'); (left[i] = left[i] || []).push(...Array(Math.max(0, n | 0)).fill(r)); });
  const mk = id => { const c = inst(id), a = (left[id] && left[id].shift()) || (d.art && d.art[id]); if (a) c.ar = a; return c; };
  return { deck: shuf(d.main.map(mk)), life: shuf(d.life.map(id => ({ ...mk(id), up: 0 }))) }; }
function preDeck(s) { const x = ST[s], vr = {}; [...x.main, ...x.life].forEach(([id, n, r]) => { if (r) vr[id + '|' + r] = (vr[id + '|' + r] || 0) + n; }); return { main: x.main.flatMap(([id, n]) => Array(n).fill(id)), life: x.life.map(([id]) => id), vr }; }
async function pickDeck(m, user, ban) {
  if (m.mine) { const u = await dbGet(user), k = u.decks && u.decks[m.mine]; if (!k) E('ไม่พบเด็ค'); return { ...mkDeck([...k.main, ...k.life].map(i => i + ' x1').join(' '), 0, 0, ban), art: k.art || {}, vr: k.vr || null }; }
  if (m.pre) { const u = await dbGet(user); if (!ST[m.pre] || !(/^SD0[1-3]$/.test(m.pre) || (u.bought || []).includes(m.pre))) E('ยังไม่มีเด็คนี้'); return preDeck(m.pre); }
  if (!process.env.BOT_TEST) E('ปิดใช้งานเด็ควางลิสต์/เด็คทดสอบแล้ว');
  return mkDeck(m.text || '', m.rand, m.skip, ban);
}
async function settle(r) { const g = r.g; if (!g.over || g.paid || g.win == null) return; g.paid = 1;
  for (let k = 0; k < 2; k++) { const w = r.p[k].ws; if (!w || !w.user) continue; const gn = r.bot ? (k === g.win ? BOT_LV[r.bot.lv].win : BOT_LOSE) : (k === g.win ? 150 : 50); const d = await dbGet(w.user); d.gems += gn; await dbPut(w.user, d); w.send(JSON.stringify({ t: 'me', me: prof(w.user, d), gain: gn })); } }
const wss = new WebSocketServer({ server: srv });
const rooms = {}; let UID = 1, DRN = 0, BTN = 0, DCN = 0;
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/* ===== KD: การ์ดพิมพ์ซ้ำ (reprint) ใช้สกิลเดิมของการ์ดต้นฉบับ: instance เก็บ id ต้นฉบับ + kd = id จริง (ใช้แสดงรูป) ===== */
const CANON = { 'KD01-006': 'SD01-002', 'KD01-008': 'BT02-008', 'KD01-010': 'BT01-004', 'KD01-013': 'BT01-038', 'KD01-014': 'BT02-045', 'KD01-015': 'SD08-013', 'KD01-017': 'SD01-017', 'KD01-018': 'BT02-054', 'KD01-019': 'SD01-020', 'KD01-020': 'BT02-060',
  'KD02-003': 'SD03-001', 'KD02-004': 'BT01-016', 'KD02-006': 'SD03-002', 'KD02-007': 'SD03-003', 'KD02-008': 'SD03-004', 'KD02-009': 'BT01-015', 'KD02-015': 'BT02-046', 'KD02-016': 'SD08-013', 'KD02-018': 'BT01-041', 'KD02-020': 'BT02-058',
  'KD03-003': 'BT02-009', 'KD03-004': 'BT03-026', 'KD03-007': 'BT02-010', 'KD03-008': 'BT03-014', 'KD03-011': 'BT02-012', 'KD03-012': 'BT01-038', 'KD03-013': 'BT03-044', 'KD03-014': 'BT03-042', 'KD03-016': 'SD01-017',
  'KD04-003': 'BT03-004', 'KD04-005': 'BT03-006', 'KD04-006': 'BT03-007', 'KD04-007': 'BT03-005', 'KD04-013': 'BT03-051', 'KD04-018': 'BT01-038', 'KD04-019': 'BT01-041', 'KD04-020': 'BT03-049' };
const inst = id => CANON[id] ? { u: UID++, id: CANON[id], kd: id, pw: 0, tired: false } : { u: UID++, id, pw: 0, tired: false };
const ZN = ['hand','hell','av','mg','co','dk'];
const E = s => { throw s; };
let CR = null, FXN = 0;
const fx = o => { if (!CR || !CR.g) return; const g = CR.g; (g.fxl = g.fxl || []).push({ n: ++FXN, ...o }); if (g.fxl.length > 20) g.fxl.shift(); };
function sweep(r) { chk052(r); bt4Sweep(r); r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) { const m = p.mg[k]; if (m.at != null && !r.p.some(q => q.av.some(a => a.u === m.at))) { p.mg.splice(k, 1); delete m.at; p.hell.push(m); } } }); }

/* ===== ENGINE: กฎ v3.2 + สกิล SD01-08 + BT01-02 ===== */
const nmOf = x => x.tk ? x.tk.n : B[x.id].n;
const symOf = x => x.tk ? (x.tk.s || '') : (x.wr && x.wr.some(w => w.id === 'BT03-021')) ? 'ผี' : (CR && CR.g && CR.g.land && CR.g.land.c.id === 'BT02-060' && CR.p.some(q => q.av.includes(x))) ? 'เทพ' : (B[x.id].s || '');
const isAv = x => !x.tk && B[x.id] && B[x.id].t === 'Avatar';
const TRIO = ['กุ่ย', 'ฮอล', 'นาย'];
const allAv = r => { const a = []; r.p.forEach((p, i) => p.av.forEach(x => a.push({ i, x }))); return a; };
const addPw = (x, n) => { if (n < 0 && MGX > 0 && CR && is016(x) && CR.p.some(q => q.av.includes(x)) && CR.p.findIndex(q => q.av.includes(x)) !== MGWHO && !noFx(CR, x)) return; if (n < 0 && x.hero != null && CR && CR.g && x.hero === CR.g.n) return; x.pw = (x.pw || 0) + n; if (n > 0) x.bc = (x.bc || 0) + 1; n && fx({ k: 'buff', u: x.u, v: n }); };
const addTp = (x, n) => { if (n < 0 && MGX > 0 && CR && is016(x) && CR.p.some(q => q.av.includes(x)) && CR.p.findIndex(q => q.av.includes(x)) !== MGWHO && !noFx(CR, x)) return; if (n < 0 && x.hero != null && CR && CR.g && x.hero === CR.g.n) return; x.tp = (x.tp || 0) + n; if (n > 0) x.bc = (x.bc || 0) + 1; n && fx({ k: 'buff', u: x.u, v: n }); };
const lose = (r, i, why) => { if (r.g.over) return; r.g.over = r.p[i].name + ' ' + why + ' แพ้!'; r.g.win = 1 - i; };

// [MERGED] SD07/SD08 helpers
const colOf = x => x.tk ? (x.tk.col || '') : (B[x.id].col || '');
const isKP = x => isAv(x) && symOf(x) === 'ต่างชาติ' && B[x.id].n.includes('ขุนพล');
const isRat = x => isAv(x) && symOf(x) === 'รัททาทุย';
const isRat1 = x => isRat(x) && B[x.id].c === 1 && B[x.id].g === 1 && B[x.id].p === 1;
const guanOn = (r, i) => r.p[i].av.some(a => a.id === 'SD07-001');
const protectedFrom0 = (r, who, x) => who !== undefined && !x.tk && ((isKP(x) && x.id !== 'SD07-001' && guanOn(r, r.p.findIndex(p => p.av.includes(x))) && r.p.findIndex(p => p.av.includes(x)) !== who) || (x.hero === r.g.n && r.p.findIndex(p => p.av.includes(x)) !== who));
let MGX = 0, MGWHO = -1;   // MGX>0 = กำลังประมวลผล Magic, MGWHO = ผู้ร่าย Magic นั้น
const is016 = x => !!x && !x.tk && (x.id === 'BT04-016' || x.id === 'CC02-029');   // ริกกี้ คุณตา / คุณตาใจดี
const mg016 = (r, f) => !!(f && f.z === 'av' && MGX > 0 && is016(f.c) && f.i !== MGWHO && !noFx(r, f.c));   // Magic ฝ่ายตรงข้ามกำลังจะมีผลกับ 016
const protectedFrom = (r, who, x, mg) => protectedFrom0(r, who, x) || (who !== undefined && is016(x) && (MGX > 0 || mg) && r.p.findIndex(q => q.av.includes(x)) !== who && !noFx(r, x));
const allAvT = (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x)).map(a => a.x.u);
const canPlaceAv = (r, i, c) => { if (c.id === 'KD02-001' && !c.kdOK) return false; const p = r.p[i], L = r.g.land, cap = ((L && L.o === i && L.c.id === 'SD08-017' && p.av.every(isRat) && isRat(c)) || (L && L.o === i && L.c.id === 'BT04-059' && p.av.every(a => symOf(a) === 'รัททาทุย') && symOf(c) === 'รัททาทุย')) ? 6 : 4; return p.av.filter(x => !x.tk).length < cap && p.av.length < 6; };
const addHold = (x, v, until) => { (x.hd = x.hd || []).push({ v, until }); if (v > 0) x.bc = (x.bc || 0) + 1; fx({ k: 'buff', u: x.u, v }); };
function endTurnFx(r) {
  const g = r.g;
  r.p.forEach(q => q.av.forEach(a => { if (a.hd) a.hd = a.hd.filter(h => h.until > g.n); }));
  r.p.forEach(q => q.av.slice().forEach(a => { if (a.ctl) { const to = a.ctl.from; take(r, a.u); delete a.ctl; delete a.nolife;
    if (canPlaceAv(r, to, a)) { a.tired = false; r.p[to].av.push(a); log(r, '↩ ' + nmOf(a) + ' กลับไปฝั่งเจ้าของ'); } else r.p[to].hell.push(a); } }));
}
function summonAny(r, i, u, from, src) {
  const p = r.p[i], k = p[from].findIndex(h => h.u === u); if (k < 0) return false; const c = p[from][k];
  if (!canPlaceAv(r, i, c)) { log(r, 'Avatar เต็ม อัญเชิญ ' + B[c.id].n + ' ไม่ได้'); return false; }
  p[from].splice(k, 1); c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; p.av.push(c); heroMk(r, i, c); ev(r, c.id); fx({ k: 'summon', u: c.u });
  log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + ' จาก' + ({ deck: ' Deck', hell: 'นรก', hand: 'มือ' }[from] || ''));
  if (src && isKP(src)) {
    if (c.id === 'SD07-003') r.g.q.unshift(() => { const opts = []; r.p.forEach(q => { q.av.forEach(x => opts.push(x.u)); q.co.forEach(x => opts.push(x.u)); q.mg.forEach(x => opts.push(x.u)); }); ask(r, i, { text: 'แฮหัวตุ้น: ทำลายการ์ดบนสนาม 1 ใบ', opts, cb: us => destroyAny(r, us[0]) }); });
    if (c.id === 'SD07-004') r.g.q.unshift(() => { draw(r, p, 1); log(r, '✨ แฮหัวเอี๋ยน: จั่ว 1 ใบ'); });
  }
  return true;
}
function destroyAny(r, u) { const f = find(r, u); if (!f) return; if (f.z === 'av') { const fi = f.i, fu = f.c.u; kill(r, fi, fu); } else { take(r, u); if (!f.c.tk) r.p[f.i].hell.push(f.c); log(r, '💥 ทำลาย ' + nmOf(f.c)); } }
function buildFree(r, i, c, from) {
  const p = r.p[i], k = p[from].findIndex(h => h.u === c.u); if (k < 0) return false;
  if (p.co.length >= 3 || p.co.some(x => B[x.id].n === B[c.id].n)) { log(r, 'ก่อสร้าง ' + B[c.id].n + ' ไม่ได้'); return false; }
  p[from].splice(k, 1); p.co.push(c); ev(r, c.id); log(r, '🏗 ' + p.name + ': ก่อสร้าง ' + B[c.id].n);
  if (c.id === 'SD08-018') r.g.q.push(() => summonRat1(r, i));
  return true;
}
function summonRat1(r, i) {
  const p = r.p[i], L = p.deck.filter(isRat1);
  if (!L.length) { log(r, '✨ ค้น Deck ไม่พบ รัททาทุย (Cost1/Gem1/Power1)'); return shuf(p.deck); }
  const done = u => { if (!summonAny(r, i, u, 'deck')) log(r, '⚠ อัญเชิญรัททาทุยไม่สำเร็จ (Avatar Zone เต็ม)'); shuf(p.deck); };
  if (new Set(L.map(x => B[x.id].n)).size === 1) return done(L[0].u);
  ask(r, i, { text: 'เลือกรัททาทุย (Cost1/Gem1/Power1) จาก Deck 1 ใบ อัญเชิญลงสนาม', opts: L.map(x => x.u), cb: us => done(us[0]) });
}
function fxSummon2(r, i, x) {
  const me = r.p[i];
  if (x.id === 'SD07-008') {
    const top = []; for (let k = 0; k < 3 && me.deck.length; k++) top.push(me.deck.pop());
    log(r, '🔍 สอดแนม 3 ใบ: ' + top.map(c => B[c.id].n).join(', '));
    const back = () => { me.deck.push(...top.filter(c => !c.taken)); shuf(me.deck); };
    const L = top.filter(isKP).map(c => c.u);
    if (!L.length) { back(); return; }
    ask(r, i, { text: 'สอดแนม: เลือก ขุนพล (ต่างชาติ) 1 ใบ ขึ้นมือ', opts: L, n: 1, min: 0, cb: us => {
      if (!us.length) return back(); const c = top.find(t => t.u === us[0]); c.taken = 1;
      const fin = toHand => { if (toHand) { me.hand.push(c); log(r, '✨ นำ ' + B[c.id].n + ' ขึ้นมือ'); } else { me.deck.push(c); if (!summonAny(r, i, c.u, 'deck', x)) me.hand.push(me.deck.pop()); } back(); };
      if (B[c.id].col === 'ฟ้า') ask(r, i, { yn: true, text: B[c.id].n + ' เป็นสีฟ้า — อัญเชิญลง Avatar Zone แทนการขึ้นมือ?', cb: y => fin(!y) }); else fin(true);
    } });
  }
  if (x.id === 'SD08-007') ask(r, i, { text: 'จุติ: เลือก Construct รัททาทุย จากนรก 1 ใบ ขึ้นมือ', opts: me.hell.filter(c => !c.tk && B[c.id].t === 'Construct' && symOf(c) === 'รัททาทุย').map(c => c.u), cb: us => { const q = me.hell.findIndex(h => h.u === us[0]); me.hand.push(...me.hell.splice(q, 1)); log(r, '✨ นำ Construct จากนรกขึ้นมือ'); } });
}
function fxPaid(r, i, ps, summoned) {
  ps.forEach(pc => {
    if ((pc.id === 'KD01-004' || pc.id === 'BT03-001') && isNarai(summoned)) { addTp(summoned, 3); fx({ k: 'say', id: pc.id, t: 'POWER +3' }); log(r, '✨ พระลักษมี: ' + nmOf(summoned) + ' POWER +3 จนจบเทิร์น'); }
    if (B[pc.id].n === 'ตุ๊กตารัททาทุย' && isRat(summoned)) r.g.q.push(() => { log(r, '✨ ตุ๊กตารัททาทุย: อัญเชิญรัททาทุยจาก Deck'); summonRat1(r, i); });   // ทุกใบ (SD08-010/BT03-015/PRMO-086) ใช้ได้ซ้ำทุกครั้ง 1 ใบต่อ 1 ตุ๊กตา
    if (pc.id === 'SD08-020' && isRat(summoned)) r.g.q.push(() => buildFree(r, i, pc, 'hell'));
    fxPaid03(r, i, pc, summoned); kdPaid(r, i, pc, summoned); bt4Paid(r, i, pc, summoned);
  });
}
const sameColPairs = (r, i) => { const p = r.p[i], o = []; p.av.filter(isKP).forEach(a => { if (p.av.filter(isKP).some(b => b !== a && colOf(b) === colOf(a) && nmOf(b) !== nmOf(a))) o.push(a.u); }); return o; };
const ratHand = (r, i) => r.p[i].hand.filter(isRat);

function P(r, x) {
  const f = find(r, x.u); let v = (x.tk ? x.tk.p : (B[x.id].p || 0)) + (x.pw || 0) + (x.tp || 0) + (x.bp || 0);
  if (f && f.z === 'av') {
    const p = r.p[f.i], s = symOf(x), L = r.g.land && r.g.land.c.id;
    if (s === 'เทพ') { v += p.av.filter(a => a.id === 'SD01-004').length; if (L === 'SD01-020') v += 1; }
    if (s === 'นรก' && L === 'SD03-019') v += 1;
    if (L === 'BT04-060' && ['ผี', 'เปรต', 'เอเลี่ยน', 'กะปอม'].includes(s)) v += 1;   // BT04-060: ผี เปรต เอเลี่ยน ไดโนเสาร์(กะปอม) +1
    if (x.id === 'SD07-002') v += 1;
    v += mod456(r, x, f) + mod03(r, x, f) + mod04(r, x, f) + mod05(r, x, f);
    r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u) {
      if (m.id === 'SD01-016') v += 1;
      if ((m.id === 'SD03-018' || m.id === 'KD02-019') && s === 'นรก') v += 1;
      if (m.id === 'SD07-018') v += B[x.id].n.startsWith('กวนอู') ? 2 : 1;
      if (m.id === 'SD08-016') v += p.av.filter(isRat).length;
      if (m.id === 'BT04-056') v += 3;
    } }));
    { const L2 = r.g.land; if (L2 && L2.o === f.i && L2.c.id === 'SD07-019' && new Set(p.av.map(colOf).filter(Boolean)).size >= 4) v += 2; }
    p.co.forEach(k => {
      if (k.id === 'SD07-020' && !x.tk && B[x.id].n.includes('ขุนพล') && colOf(x) === 'ม่วง') v += 1;
      if (k.id === 'SD08-019' && isRat1(x)) v += 1;
    });
    (x.hd || []).forEach(h => { if (h.until >= r.g.n) v += h.v; });
    if (x.id === 'SD03-005') v += new Set(p.hell.filter(h => isAv(h) && isNir(h)).map(h => B[h.id].n)).size;
  }
  if (x.id === 'BT04-008' && f && f.z === 'av' && !noFx(r, x)) v += r.p[1 - f.i].hand.length;   // BT04-008 ลูกคนรวย: POWER = จำนวนการ์ดบนมือฝ่ายตรงข้าม (base 0)
  v -= neg053(r, x);
  return Math.max(0, v);
}
const kick = (r, a) => (!a.tk && a.hero === r.g.n) || (a.id === 'BT04-032' && r.p.some(q => q.av.includes(a) && q.av.some(x => nmOf(x).includes('พระเจ้านิโคไล')))) || /เตะไข่/.test(a.tk || a.id === 'BT04-032' ? '' : B[a.id].e) || r.p.some(q => q.mg.some(m => m.at === a.u && B[m.id].e.includes('เตะไข่')));
const allCards = (r, u) => { for (let i = 0; i < 2; i++) for (const z of [...ZN, 'deck']) { const c = r.p[i][z].find(x => x.u === u); if (c) return { i, z, c }; } return null; };
function runQ(r) { CR = r; const g = r.g; let n = 0; if (g && g.pendAfter && !g.ask && !g.pend) { const f = g.pendAfter; g.pendAfter = null; try { f(); } catch (e) { console.error('fx', e); } } while (g && !g.over && !g.ask && !g.pend && g.q.length && n++ < 100) { const f = g.q.shift(); try { f(r); } catch (e) { console.error('fx', e); } } sweep(r); }
function ask(r, who, o) {
  const opts = (o.yn || o.choices) ? [] : o.opts;
  if (!o.yn && !o.choices && !opts.length) { o.none && o.none(); return false; }
  const n = Math.min(o.n || 1, opts.length), min = Math.min(o.min == null ? n : o.min, n);
  r.g.ask = { who, text: o.text, hint: o.hint, opts, n, min, cancel: !!o.cancel, yn: !!o.yn, choices: o.choices || null, cb: o.cb, onCancel: o.onCancel,
    cards: opts.map(u => { const f = allCards(r, u); return f ? { u, id: f.c.kd || f.c.id, tk: f.c.tk ? f.c.tk.n : null, i: f.i, z: f.z } : { u }; }) };
  return true;
}
const sendHell = (r, u) => { const f0 = find(r, u); if (mg016(r, f0)) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม'); if (f0 && f0.z === 'av' && f0.c.hero === r.g.n && !r.g.inB) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลความสามารถ'); const f = take(r, u); if (!f.c.tk) r.p[f.i].hell.push(f.c); };
const destroyAv = (r, u) => { const f = find(r, u); if (f && f.z === 'av') kill(r, f.i, u); };
const bounce = (r, u) => { const f0 = find(r, u); if (mg016(r, f0)) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม'); if (f0 && f0.z === 'av' && f0.c.hero === r.g.n) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลความสามารถ'); const f = take(r, u); fx({ k: 'bounce', u }); if (!f.c.tk) { f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; f.c.tired = false; r.p[f.i].hand.push(f.c); } };
function summonFree(r, i, c) {
  const p = r.p[i]; if (!canPlaceAv(r, i, c)) { log(r, 'Avatar เต็ม อัญเชิญไม่ได้'); return false; }
  const k = p.hell.findIndex(h => h.u === c.u); if (k < 0) return false; p.hell.splice(k, 1);
  c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; p.av.push(c); heroMk(r, i, c); ev(r, c.id); fx({ k: 'summon', u: c.u }); log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + ' จากนรก'); return true;
}
function mill(r, i, n, src) {
  const p = r.p[i]; if (src) p.av.forEach(a => { if (a.id === 'SD03-004' && src.id !== 'SD03-004') n += 2; });
  const cs = []; for (let k = 0; k < n && p.deck.length; k++) cs.push(p.deck.pop());
  cs.forEach(c => p.hell.push(c)); cs.length && fx({ k: 'mill', i, ids: cs.map(c => c.id) }); log(r, '🕳 ' + p.name + ': ธรณีสูบ ' + cs.length + ' ใบ (' + cs.map(c => B[c.id].n).join(', ') + ')');
  cs.forEach(c => { if (c.id === 'SD03-018' || c.id === 'KD02-019') c.mh = r.g.n; });
  const nemo = cs.filter(c => c.id === 'BT01-018'); if (nemo.length) { nemo.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } }); shuf(p.deck); log(r, '🔁 นีโม่ กลับเข้า Deck แล้วสับ'); }
  if (cs.some(c => c.id === 'BT01-015')) r.g.q.unshift(() => { log(r, '💀 นายนิรยบาล เต๋า: ทั้งสองฝ่ายธรณีสูบ 2 ใบ'); mill(r, 0, 2); mill(r, 1, 2); });
  if (!p.deck.length) return lose(r, i, 'เด็คหมด');
  cs.filter(c => c.id === 'SD03-003').forEach(c => r.g.q.unshift(() => ask(r, i, { yn: true, text: 'นายนิรยบาล แว่น ถูกธรณีสูบ — อัญเชิญลง Avatar Zone จากนรกไหม?', cb: y => y && summonFree(r, i, c) })));
  kdMill(r, i, cs, src);
}
function tutor(r, i, pred, label) {
  const p = r.p[i], L = p.deck.filter(pred).map(c => c.u);
  const done = u => { if (u != null) { const k = p.deck.findIndex(c => c.u === u), [c] = p.deck.splice(k, 1); p.hand.push(c); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' จาก Deck ขึ้นมือ'); } else log(r, '✨ ' + p.name + ': ค้น Deck ไม่พบ ' + label); shuf(p.deck); };
  if (!L.length) return done(null);
  if (new Set(L.map(u => B[p.deck.find(c => c.u === u).id].n)).size === 1) return done(L[0]);
  ask(r, i, { text: 'เลือก ' + label + ' จาก Deck 1 ใบ ขึ้นมือ', opts: L, cb: us => done(us[0]) });
}
const trioHell = (r, i) => r.p[i].hell.filter(c => isAv(c) && TRIO.includes(B[c.id].n)).map(c => c.u);

function fxSummon0(r, i, x) {
  if (noFx(r, x)) return;
  const me = r.p[i], pickAv = (text, f) => ask(r, i, { text, opts: allAvT(r, i), cb: us => { const t = find(r, us[0]); if (t) f(t.c); } });
  if (x.id.startsWith('BT01-')) return fxSummon01(r, i, x);
  if (x.id.startsWith('SD07-') || x.id.startsWith('SD08-')) return fxSummon2(r, i, x);
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
    case 'SD03-001': ask(r, i, { text: 'จุติ: เลือก Avatar นายนิรยบาล ในนรก 1 ใบ อัญเชิญลงสนาม', opts: me.hell.filter(c => isAv(c) && isNir(c)).map(c => c.u), cb: us => { const c = me.hell.find(h => h.u === us[0]); c && summonFree(r, i, c); } }); break;
    default: if (SUM[x.id]) { fx({ k: 'say', id: x.id, t: 'จุติ' }); SUM[x.id](r, i, x); }
  }
}
function fxAtk0(r, i, a, tg, tk) {
  if (noFx(r, a)) return;
  if (a.id === 'BT01-001' && tk === 'av') { const d = r.p[1 - i].av.find(x => x.u === tg); if (d && symOf(d) === 'เทพ') { fx({ k: 'say', id: a.id, t: 'ทำลายเป้าหมาย' }); log(r, '💥 นนทก นิ้วเพชร: ทำลาย ' + nmOf(d)); destroyAv(r, d.u); } }
  fxAtk03(r, i, a, tg, tk); fxAtk2(r, i, a); atkTrig(r, i, a); bt4Atk(r, i, a, tg, tk);
  if (a.id === 'SD01-002') { addTp(a, 2); log(r, '✨ พระนารายณ์ POWER +2'); }
  if (a.id === 'SD03-002') { mill(r, i, 2, a); addTp(a, 1); log(r, '✨ พ่อจีจ้า POWER +1'); }
  if (a.id === 'SD07-002') log(r, '✨ เตียวหุย (มี modifier อยู่ใน P)');
  if (a.id === 'SD08-001') ask(r, i, { text: 'ไพรมอล: เซ่นไหว้ Avatar รัททาทุย 1 ใบ เพื่อให้ตื่นอีกครั้ง (ไม่เซ่นก็ได้)', opts: r.p[i].av.filter(x => isRat(x) && x.u !== a.u).map(x => x.u), n: 1, min: 0, cb: us => { if (us.length) { const f = find(r, us[0]); if (f) { kill(r, f.i, f.c.u); if (find(r, a.u)) a.tired = false; log(r, '✨ ไพรมอล กลับมาตื่น'); } } } });
}

const sym = s => (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x) && symOf(a.x) === s).map(a => a.x.u);
const handAv = f => (r, i) => r.p[i].hand.filter(c => isAv(c) && f(c)).map(c => c.u);
const trioHandOrField = name => (r, i) => [...r.p[i].hand, ...r.p[i].av].filter(c => isAv(c) && B[c.id].n === name).map(c => c.u);
const trioAny = (r, i) => [...r.p[i].hand, ...r.p[i].av].filter(c => isAv(c) && TRIO.includes(B[c.id].n)).map(c => c.u);
const MG = {
  'SD01-016': { mod: 1 }, 'SD02-017': { mod: 1 }, 'SD03-018': { mod: 1 },
  'SD01-017': { react: 'summon', run: (r, i, cx) => destroyAv(r, cx.ev.u) },
  'SD01-018': { steps: [{ key: 'c', pay: 1, text: 'ทิ้ง Avatar เทพ จากมือ 1 ใบ', opts: handAv(c => symOf(c) === 'เทพ') }], run: (r, i) => { draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD01-019': { steps: [{ key: 't', text: 'เลือก Avatar เทพ 1 ใบ POWER +2 จนจบเทิร์น', opts: sym('เทพ') }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { addTp(t.c, 2); log(r, '✨ ' + nmOf(t.c) + ' POWER +2'); } } },
  'SD01-020': {}, 'SD02-020': {}, 'SD03-019': {},
  'SD02-016': { react: 1, steps: TRIO.map((n, k) => ({ key: 'k' + k, pay: 1, text: 'ส่ง Avatar "' + n + '" 1 ใบ จากมือ/สนามเรา ลงนรก', opts: trioHandOrField(n) })),
    run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'SD02-018': { steps: [{ key: 'c', pay: 1, text: 'ทิ้ง กุ่ย/ฮอล/นาย จากมือ 1 ใบ', opts: handAv(c => TRIO.includes(B[c.id].n)) }], run: (r, i) => { draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD02-019': { react: 1, steps: [{ key: 'c', pay: 1, text: 'ส่ง กุ่ย/ฮอล/นาย 1 ใบ จากมือ/สนามเรา ลงนรก', opts: trioAny }, { key: 't', text: 'เลือก Avatar บนสนาม 1 ใบ นำกลับขึ้นมือ', opts: (r, i) => allAvT(r, i) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t && t.z === 'av') { log(r, '✨ นำ ' + nmOf(t.c) + ' กลับขึ้นมือ'); bounce(r, t.c.u); } } },
  'SD03-016': { steps: [{ key: 'c', pay: 1, text: 'ส่ง Avatar นรก จากมือ 1 ใบ ลงนรก', opts: handAv(c => symOf(c) === 'นรก') }], run: (r, i) => { mill(r, i, 2); draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'SD03-017': { run: (r, i) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && isNir(c) && B[c.id].c <= 4).map(c => c.u);
    const fin = u => { if (u != null) { const k = p.deck.findIndex(c => c.u === u), [c] = p.deck.splice(k, 1); p.hand.push(c); p.noCost = p.noCost || []; p.noCost.push(B[c.id].n); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' ขึ้นมือ (ใช้เป็น Cost ไม่ได้อีก)'); } else log(r, '✨ ค้น Deck ไม่พบ'); shuf(p.deck); };
    if (!L.length) return fin(null); ask(r, i, { text: 'เลือก นายนิรยบาล Cost ≤ 4 จาก Deck 1 ใบ ขึ้นมือ', opts: L, cb: us => fin(us[0]) }); } },
  'SD03-020': { react: 'summon', steps: [{ key: 'c', pay: 1, text: 'ส่ง Avatar นรก จากมือ ที่ Cost ≥ Avatar ที่อัญเชิญ ลงนรก', opts: (r, i, cx) => handAv(c => symOf(c) === 'นรก' && B[c.id].c >= (cx.ev.cost || 0))(r, i) }],
    run: (r, i, cx) => { mill(r, i, 2); destroyAv(r, cx.ev.u); } },
};
function reactOK(r, i, c, def) { const p = r.g.pend; if (!p || p.who !== i) return false; if (r.g.noReact && r.g.noReact.who === i) return false;
  if (def.react === 'summon') return !!(p.ev && p.ev.k === 'summon');
  if (def.react === 'cast') return !!(p.ev && p.ev.k === 'cast');
  if (def.react === 'use') return !!(p.ev && p.ev.k === 'use');
  if (def.react === 'atk') return p.k === 'atk';
  if (def.react === 'atkav') return p.k === 'atk' && p.tk === 'av';
  if (def.react === 'atkTank') return p.k === 'atk' && p.tk === 'av' && r.p[i].av.some(a => a.u === p.tg && isTank(a));
  if (def.react === 'atkPeople') return p.k === 'atk' && p.tk === 'av' && r.p[i].av.some(a => a.u === p.tg && isPeopleF(a));
  if (def.react === 'atkAv') return p.k === 'atk' && p.tk === 'av' && r.p[i].av.some(a => a.u === p.tg);
  if (def.react === 'never') return false;
  return true; }
function startCast(r, i, f, c, def, pre) {
  const g = r.g, ctx = { ev: g.pend && g.pend.ev, pend: g.pend, pick: {}, card: f.c };
  if (def.cond && !def.cond(r, i)) E('เงื่อนไขการใช้ไม่ครบ');
  const steps = def.steps || (def.mod ? [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ' + c.n, opts: (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x, 1) && (!def.tgf || def.tgf(a.x))).map(a => a.x.u) }] : []);
  for (const s of steps) if (s.opts(r, i, ctx).length < (s.min == null ? (s.n || 1) : s.min)) E('เงื่อนไขการใช้ไม่ครบ');
  if (pre != null) steps.forEach(s => { if (s.key === 'tg' && (s.n || 1) === 1 && s.opts(r, i, ctx).includes(pre)) ctx.pick.tg = [pre]; });   // แตะ/ลากไอเทมไปที่ Avatar ตรงๆ ข้ามขั้นเลือกเป้า
  let k = 0;
  const next = () => { while (pre != null && k < steps.length && steps[k].key === 'tg' && ctx.pick.tg) k++; if (k >= steps.length) return castFinal(r, i, f.c, c, def, ctx, steps);
    const s = steps[k++], used = Object.values(ctx.pick).flat();
    ask(r, i, { text: s.text, opts: s.opts(r, i, ctx).filter(u => !used.includes(u)), n: s.n || 1, min: s.min, cancel: true, cb: us => { ctx.pick[s.key] = us; next(); }, none: next }); };
  next();
}
const MASS030 = new Set(['BT01-036', 'BT05-053', 'BT07-056', 'BT04-042', 'BT06-049']);   // Magic ที่กระทบทั้งสนาม (มาติเนซยกเลิกได้)
function castFinal(r, i, card, c, def, ctx, steps) {
  const g = r.g, me = r.p[i];
  const z = find(r, card.u); if (!z || z.i !== i || !['hand', 'hell'].includes(z.z)) E('การ์ดไม่อยู่แล้ว');
  steps.forEach(s => s.pay && (ctx.pick[s.key] || []).forEach(u => sendHell(r, u)));
  g.used[i][c.st] = 1; take(r, card.u); let t = null;
  if (def.mod) { t = find(r, ctx.pick.tg[0]); if (!t || t.z !== 'av') E('เป้าหมายหาย'); card.at = t.c.u; me.mg.push(card); }
  else if (c.st === 'Land') { if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: card, o: i }; }
  else me.hell.push(card);
  ev(r, c.id); log(r, me.name + ' ร่าย ' + c.st + ': ' + c.n + (t ? ' → ' + nmOf(t.c) : ''));
  if (c.t === 'Magic' && c.s === 'ฤษี') rishiFx(r);
  if (c.t === 'Magic' && !def.mod && c.st !== 'React' && c.st !== 'Land') {   // BT04-030 มาติเนซ: รถถังที่สวมใส่ตกเป็นเป้าหมายของ Magic ฝ่ายตรงข้าม → ทำลายตัวเองเพื่อยกเลิก
    const w030 = q => (q.wr || []).some(w => (CANON[w.id] || w.id) === 'BT04-030'), tkOf = x => ({ i: x.i, c: x.c, z: 'av' });
    const picked = Object.values(ctx.pick).flat().map(u => find(r, u)).filter(x => x && x.z === 'av' && x.i !== i && isTank(x.c) && w030(x.c));   // เป็นหนึ่งในเป้าหมาย (เลือกหลายเป้าหมายได้)
    const mass = c.st === 'Normal' && (MASS030.has(CANON[c.id] || c.id) || /(ทำลาย|ส่ง)[^\n]*(Avatar|การ์ด)[^\n]*(ทุกใบ|ทั้งหมด)/.test(c.e || ''));   // Magic ที่กระทบทั้งสนาม
    const tk = picked[0] || (mass ? r.p[1 - i].av.filter(x => isTank(x) && w030(x)).map(x => ({ i: 1 - i, c: x, z: 'av' }))[0] : null), massOnly = !picked.length;
    if (tk) { const w = tk.c.wr.find(q => (CANON[q.id] || q.id) === 'BT04-030');
      ask(r, tk.i, { yn: true, text: 'มาติเนซ Tank Ranger: ' + nmOf(tk.c) + (massOnly ? ' ได้รับผลของ Magic "' : ' ตกเป็นเป้าหมายของ Magic "') + c.n + (massOnly ? '" ที่กระทบทั้งสนาม' : '"') + ' — ทำลาย มาติเนซ จากสภาพสวมใส่ เพื่อยกเลิกความสามารถของ Magic ใบนั้นไหม?', cb: y => { if (!y) return; const k = tk.c.wr.indexOf(w); if (k < 0) return; tk.c.wr.splice(k, 1); r.p[tk.i].hell.push(w); ctx.cancelled = 1; vfx(tk.c.u, 'burst', 'มาติเนซ ยกเลิก Magic', '#22c55e'); log(r, '🛡 มาติเนซ Tank Ranger: ทำลายตัวเองจากสภาพสวมใส่ ยกเลิกความสามารถของ ' + c.n); } }); } }
  if (c.st === 'React') kdReactGate(r, i, c, cancelled => { if (!cancelled) def.run && def.run(r, i, ctx); const p = g.pend; if (p && p.who === i) { g.pend = null; if (p.k === 'atk' && !p.cancel) { if (g.ask) g.pendAfter = () => resolveAtk(r, p); else resolveAtk(r, p); } } });
  else { if (def.run) g.q.push(() => ctx.cancelled ? log(r, '❌ ' + c.n + ' ถูกยกเลิก') : def.run(r, i, ctx)); open(r, { who: 1 - i, k: 'ev', ev: { k: 'cast', id: c.id, i, cx: ctx } }); }
}

/* ===== SD04-06 helpers ===== */
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
  if (kw === 'สามัคคี' && x.sg3 === r.g.n) return true;
  if (kw === 'ลูกฮึด' && hasEq(r, x, 'SD06-016')) return true;
  if ((kw === 'สามัคคี' || kw === 'โล่มนุษย์') && campTxt(x) && hasCamp(r, f.i)) return true;
  if (kw === 'สามัคคี' && symOf(x) === 'แมลง' && landIs(r, 'BT02-059')) return true;
  return false;
}
function mod456(r, x, f) {
  let v = 0; const p = r.p[f.i];
  if (hasEq(r, x, 'BT02-056')) v += 2;
  if ((x.wr || []).some(w => w.id === 'BT02-028')) v += 2;
  if (noFx(r, x)) return v;
  if (x.id === 'BT02-001') v += r.p.reduce((s, q) => s + q.life.filter(l => l.up).length, 0);
  if (x.id === 'BT01-002') v += 2 * p.life.filter(l => l.up).length;
  if (x.id === 'BT01-004') v += p.av.filter(a => a.u !== x.u && symOf(a) === 'เทพ').length;
  if (['กุ่ย', 'ฮอล', 'นาย'].includes(B[x.id].n)) v += p.av.filter(a => a.id === 'BT02-014' && !noFx(r, a)).length;
  (x.wr || []).forEach(w => { if (w.id === 'SD04-003') v += 1; if (w.id === 'SD06-008') v += hasCamp(r, f.i) ? 2 : 1; });
  if (campTxt(x) && hasCamp(r, f.i)) v += 1;
  if (x.id === 'SD06-002' && hasCamp(r, f.i)) v += 2;
  if (x.id === 'SD06-005' && r.g.turn !== f.i) v += 2;
  if (hasKw(r, x, 'ลูกฮึด') && p.life.length && p.life.every(l => l.up)) v += 1;
  return v;
}
function lifeDown(r, i) {
  const p = r.p[i], L = p.life.filter(l => l.up); if (!L.length) return log(r, '❤ ' + p.name + ': ไม่มี LIFE ที่หงายอยู่');
  if (landIs(r, 'BT04-058')) return log(r, '🏥 โรงบาลรัฐ: LIFE ไม่สามารถเปลี่ยนเป็นสภาพคว่ำได้');
  const l = rnd(L); l.up = 0; const k = (p.lf || []).indexOf(l.id); if (k >= 0) p.lf.splice(k, 1);
  fx({ k: 'life', i }); log(r, '❤ ' + p.name + ': สุ่มคว่ำ LIFE 1 ใบ');
}
function putAv(r, i, c, o = {}) {
  const p = r.p[i];
  if (!canPlaceAv(r, i, c)) { log(r, 'Avatar เต็ม อัญเชิญ ' + B[c.id].n + ' ไม่ได้ (ลงนรก)'); p.hell.push(c); return false; }
  c.tired = !!o.tired; c.pw = 0; c.tp = 0; c.bp = 0; delete c.exp; p.av.push(c); heroMk(r, i, c); ev(r, c.id); fx({ k: 'summon', u: c.u });
  log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + (o.tired ? ' (สภาพนอน)' : ''));
  if (o.sm) r.g.q.push(() => fxSummon(r, i, c)); return true;
}
const fromZone = (r, i, z, u) => { const a = r.p[i][z], k = a.findIndex(c => c.u === u); return k < 0 ? null : a.splice(k, 1)[0]; };
const canWear = (t, card) => !(t.wr || []).some(w => B[w.id].n === B[card.id].n);
const tanksFor = (r, i, card) => r.p[i].av.filter(t => isTank(t) && t.u !== card.u && canWear(t, card)).map(t => t.u);
function wearOn(r, i, t, card) { t.wr = t.wr || []; t.wr.push(card); card.tired = false; fx({ k: 'buff', u: t.u, v: 0 }); if (B[card.id].n.includes('โอตะ')) vfx(t.u, 'aura', '🎀 สวมใส่ ' + B[card.id].n, '#f472b6'); log(r, '🪖 ' + nmOf(t) + ' สวมใส่ ' + B[card.id].n); }
function wearChoose(r, i, card) {
  const L = tanksFor(r, i, card);
  if (!L.length) { log(r, 'ไม่มีรถถังที่สวมได้ → ' + B[card.id].n + ' ลงนรก'); return r.p[i].hell.push(card); }
  if (L.length === 1) return wearOn(r, i, find(r, L[0]).c, card);
  ask(r, i, { text: 'เลือกรถถังที่จะสวม ' + B[card.id].n, opts: L, cb: us => wearOn(r, i, find(r, us[0]).c, card) });
}
function scout(r, i, n, o) {
  const p = r.p[i]; if (o.by && isAv(o.by) && symOf(o.by) === 'กะปอม') n += p.av.filter(x => (CANON[x.id] || x.id) === 'BT04-011' && !noFx(r, x)).length;   // BT04-011: สอดแนมของ {กะปอม} +1 ต่อเทอราโนดอน 1 ใบ (นับตัวเองด้วย)
  const seen = p.deck.slice(-n).reverse(); bt4Seen(r, i, seen, o); if (o.migSrc) kdMigScout(r, i, seen); const ok = seen.filter(c => p.deck.includes(c) && o.pred(c)).map(c => c.u);
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ (' + seen.map(c => B[c.id].n).join(', ') + ')'); seen.length && fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) });
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
    if (k >= steps.length) { steps.forEach(s => s.pay && (ctx.pick[s.key] || []).forEach(u => sendHell(r, u))); card.us = r.g.n; fx({ k: 'say', id: card.id, t: 'ความสามารถ' }); log(r, '⚡ ' + r.p[i].name + ' ใช้ความสามารถ ' + B[card.id].n); def.run && def.run(r, i, ctx); return; }
    const s = steps[k++], used = Object.values(ctx.pick).flat();
    ask(r, i, { text: s.text, opts: s.opts(r, i, ctx).filter(u => !used.includes(u)), n: s.n || 1, min: s.min, cancel: true, cb: us => { ctx.pick[s.key] = us; next(); }, none: next });
  };
  next();
}
const abOf = (r, i, x, z) => { const d = AB[x.id] || (z === 'av' && (x.wr || []).some(w => WEAR_IDOL.includes(w.id)) ? AB_R : null); const ok = r.g.turn === i && r.g.phase === 'main' && !r.g.ask && !r.g.pend;
  if (d && d.z === z && ok && x.us !== r.g.n) return 1;
  const a2 = ABIL[x.id]; /* ความสามารถแบบ ABIL (เช่น โดมรัททาทุย) ต้องแสดงปุ่มด้วย */
  if (a2 && a2.zone === z && ok && !(a2.once && x.ou === r.g.n)) return 1;
  return 0; };
const myAv = f => (r, i, cx) => r.p[i].av.filter(a => f(a, cx)).map(a => a.u);
const wearUse = { z: 'av', can: (r, i, c) => tanksFor(r, i, c).length > 0, steps: [{ key: 't', text: 'เลือก Avatar รถถังที่จะสวมใส่', opts: (r, i, cx) => tanksFor(r, i, cx.card) }],
  run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } };
const hospOK = (r, i, x) => { const h = r.g.hosp; return !(h && h.n === r.g.n && h.i === i && h.names.includes(B[x.id].n)); };
const AB = {
  'BT01-050': { z: 'land',
    steps: [{ key: 'd', pay: 1, text: 'โรงบาล: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) },
      { key: 't', text: 'โรงบาล: เลือก Avatar Cost ไม่เกิน 3 จากนรก ขึ้นมือ', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && !c.tk && B[c.id].c <= 3).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); if (!c) return; r.p[i].hand.push(c); const g = r.g; if (!g.hosp || g.hosp.n !== g.n || g.hosp.i !== i) g.hosp = { n: g.n, i, names: [] }; g.hosp.names.push(B[c.id].n); log(r, '🏥 ' + B[c.id].n + ' ขึ้นมือ (เทิร์นนี้อัญเชิญ/ใช้สกิลไม่ได้ รวมการ์ดชื่อเดียวกัน)'); } },
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
// [MERGED] SD08 active skills
const ABIL = {
  'SD08-001': { zone: 'av', once: 1, label: 'อัญเชิญรัททาทุยจาก Deck/นรก', run: (r, i, x) => {
    const p = r.p[i], L = [...p.deck.filter(isRat1).map(c => c.u), ...p.hell.filter(isRat1).map(c => c.u)];
    ask(r, i, { text: 'ไพรมอล: เลือกรัททาทุย (Cost1/Gem1/Power1) จาก Deck/นรก อัญเชิญลงสนาม', opts: L, cb: us => { const inDeck = p.deck.some(c => c.u === us[0]); summonAny(r, i, us[0], inDeck ? 'deck' : 'hell'); if (inDeck) shuf(p.deck); } }); } },
  'SD08-003': { zone: 'av', hint: 'ต้องมี Construct รัททาทุยในมือ เพื่อแสดงและก่อสร้าง', label: 'เซ่นไหว้ แล้วก่อสร้าง Construct รัททาทุยจากมือ', cond: (r, i) => r.p[i].hand.some(c => !c.tk && B[c.id].t === 'Construct' && symOf(c) === 'รัททาทุย'), run: (r, i, x) => {
    const p = r.p[i]; ask(r, i, { text: 'เลือก Construct รัททาทุย จากมือ (เซ่นไหว้ Avatar ใบนี้เป็น Cost)', opts: p.hand.filter(c => !c.tk && B[c.id].t === 'Construct' && symOf(c) === 'รัททาทุย').map(c => c.u), cancel: true,
      cb: us => { const chosen = p.hand.find(c => c.u === us[0]); if (!chosen) return; kill(r, find(r, x.u).i, x.u); r.g.q.unshift(() => buildFree(r, i, chosen, 'hand')); } }); } },
  'SD08-005': { zone: 'av', once: 1, label: 'เนรเทศรัททาทุยในนรก → POWER +1/ใบ', run: (r, i, x) => {
    const p = r.p[i], seen = new Set(), opts = []; p.hell.forEach(c => { if (isRat(c) && !seen.has(B[c.id].n)) { seen.add(B[c.id].n); opts.push(c.u); } });
    ask(r, i, { text: 'กินซาก: เลือกรัททาทุยในนรก (ชื่อต่างกัน) กี่ใบก็ได้ เพื่อเนรเทศ', opts, n: opts.length, min: 0, cb: us => { us.forEach(u => { const q = p.hell.findIndex(h => h.u === u); p.dk.push(...p.hell.splice(q, 1)); }); addTp(x, us.length); log(r, '✨ เนรเทศ ' + us.length + ' ใบ — POWER +' + us.length); } }); } },
  'SD08-018': { zone: 'co', once: 1, label: 'อัญเชิญรัททาทุยจาก Deck', run: (r, i) => summonRat1(r, i) },
};

const SUM = {
  'SD04-001': (r, i) => scout(r, i, 5, { text: 'จุติ: เลือก จ่ามะนาว/จ่าแดงเดือด 1 ใบ สวมให้รถถัง', pred: c => isAv(c) && ['จ่ามะนาว', 'จ่าแดงเดือด'].some(n => B[c.id].n.startsWith(n)) && tanksFor(r, i, c).length > 0, rest: 'bottom', then: c => c && wearChoose(r, i, c) }),
  'SD04-002': (r, i) => { if (r.p[i].av.some(isTank)) lifeDown(r, i); },
  'SD04-005': (r, i, x) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && !isTank(c) && B[c.id].n.includes('Tank Ranger') && canWear(x, c)).map(c => c.u);
    const fin = u => { if (u != null) wearOn(r, i, x, fromZone(r, i, 'deck', u)); else log(r, 'ค้น Tank Ranger ไม่พบ'); shuf(p.deck); };
    if (!L.length) return fin(null); ask(r, i, { text: 'จุติ: เลือก Avatar "Tank Ranger" จาก Deck 1 ใบ สวมให้ MEGA ROR.DOR', opts: L, cb: us => fin(us[0]) }); },
  'SD05-003': (r, i) => { const p = r.p[i], n = tiredCnt(r); if (!n) return log(r, 'ไม่มี Avatar สภาพนอน'); const seen = p.deck.slice(0, n);
    log(r, '🔎 แสดงการ์ดล่างสุด ' + seen.length + ' ใบ: ' + seen.map(c => B[c.id].n).join(', '));
    const fin = u => { if (u != null) p.hand.push(fromZone(r, i, 'deck', u)); shuf(p.deck); }, ok = seen.filter(c => isAv(c) && symOf(c) === 'ปลา').map(c => c.u);
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
  if (a.id === 'KD01-009' || a.id === 'BT03-002') { r.g.noReact = { who: 1 - i, at: a.u }; fx({ k: 'say', id: a.id, t: 'ฝ่ายตรงข้ามใช้ React ไม่ได้' }); log(r, '✨ นางอัปสร: ฝ่ายตรงข้ามสั่งใช้ React ไม่ได้ จนจบการต่อสู้'); }
  r.p.forEach(q => q.mg.forEach(m => { if (m.at === a.u && m.id === 'KD01-016') { draw(r, r.p[i], 1); fx({ k: 'say', id: m.id, t: 'จั่ว 1 ใบ' }); log(r, '🪓 ขวานทอง: ' + r.p[i].name + ' จั่ว 1 ใบ'); } }));
  if (a.id === 'SD05-001') { const n = tiredCnt(r); addTp(a, n); log(r, '✨ คุณจิระ POWER +' + n); }
  if (a.id === 'SD06-003') { addTp(a, 2); log(r, '✨ ทองเหม็น POWER +2'); }
}
function deathFx0(r, f, nf) {
  deathFx2(r, f, nf); if (nf) return;
  deathFx03(r, f);
  const c = f.c, p = r.p[f.i], gi = r.p.indexOf(p);
  if (c.id === 'SD06-001' && hasCamp(r, f.i)) { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); shuf(p.deck); draw(r, p, 1); log(r, '🏕 จัน หนวดเขี้ยว กลับเข้า Deck และจั่ว 1'); } }
  if (c.id === 'SD06-006') r.g.q.push(() => scout(r, f.i, 5, { text: 'คำสั่งเสีย: เลือก Avatar ที่มี "ค่ายบางระจัน" ใน Text Box 1 ใบ (ไม่ใช่พ่อแท่น) ขึ้นมือ', pred: x => campTxt(x) && x.id !== 'SD06-006', rest: 'shuffle', then: x => x && p.hand.push(x) }));
  // [MERGED] SD07/08 death triggers
  if (c.id === 'SD07-005') { const opts = p.av.filter(isKP).map(x => x.u); ask(r, gi, { text: 'คำสั่งเสีย: เลือก ขุนพล (ต่างชาติ) 1 ใบ POWER +2 จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', opts, cb: us => { const t = find(r, us[0]); if (t) { addHold(t.c, 2, r.g.n + (r.g.turn === gi ? 1 : 2)); log(r, '✨ ' + nmOf(t.c) + ' POWER +2'); } } }); }
  if (c.id === 'SD08-006') r.g.q.push(() => { log(r, '✨ รัททาทุยสืบพันธุ์: อัญเชิญรัททาทุยจาก Deck'); summonRat1(r, f.i); });
  if (isRat(c)) {
    const k = p.co.find(x => x.id === 'SD08-020');
    if (k && k.ou !== r.g.n) { k.ou = r.g.n; draw(r, p, 1); log(r, '✨ บ่อหมัก: ' + p.name + ' จั่ว 1 ใบ'); }
    const rr = p.hand.find(h => h.id === 'SD08-015');
    if (rr && !r.g.used[f.i].React) r.g.q.unshift(() => ask(r, f.i, { yn: true, text: 'ใช้ รัททาท่วม (React): อัญเชิญรัททาทุย (Cost1/Gem1/Power1) สูงสุด 2 ใบ จาก Deck?', cb: y => { if (!y) return; take(r, rr.u); p.hell.push(rr); r.g.used[f.i].React = 1; ev(r, rr.id); log(r, p.name + ' ใช้ React: รัททาท่วม');
      const L = p.deck.filter(isRat1).map(x => x.u); ask(r, f.i, { text: 'เลือกรัททาทุย 1-2 ใบ จาก Deck อัญเชิญลงสนาม', opts: L, n: 2, min: 1, cb: us => { us.forEach(u => summonAny(r, f.i, u, 'deck')); shuf(p.deck); } }); } }));
  }
}
function onConDie(r, i, c) { if (c.id === 'SD06-018') { r.p[i].av.slice().forEach(a => sendHell(r, a.u)); log(r, '🏕 ค่ายบางระจัน ถูกทำลาย: ส่ง Avatar ทุกใบลงนรก'); } }
function winFx(r, i, w, df) {
  if (!find(r, w.u)) return;
  if (w.id === 'BT03-008' && !noFx(r, w)) { w.pw = (w.pw || 0) + 1; vfx(w.u, 'aura', 'POWER +1 ถาวร', '#f97316'); log(r, '🔥 กาฬสินธุ์แมน POWER +1'); }
  if (hasEq(r, w, 'BT02-057')) { fx({ k: 'say', id: 'BT02-057', t: 'หงาย LIFE ศัตรู' }); lifeUp(r, 1 - i); }
  if (w.id === 'BT02-018' && !noFx(r, w)) { const L = r.p[1 - i].av.filter(x => P(r, x) === df).map(x => x.u); if (L.length) ask(r, i, { text: 'ธอร์: เลือก Avatar ศัตรูที่มี POWER ' + df + ' ทำลาย', opts: L, cb: us => { fx({ k: 'say', id: w.id, t: 'สายฟ้าฟาด!' }); destroyAv(r, us[0]); } }); }
  if (hasEq(r, w, 'SD06-017')) { draw(r, r.p[i], 1); log(r, '📖 ดาบใบข้าว X: จั่ว 1 ใบ'); }
  if ((w.wr || []).some(x => x.id === 'SD04-003')) ask(r, i, { yn: true, text: 'จ่าแดงเดือด: ทำลายการ์ดที่สวมใส่ เพื่อให้ ' + nmOf(w) + ' กลับเป็นสภาพตื่น?', cb: y => { if (!y) return; const k = (w.wr || []).findIndex(x => x.id === 'SD04-003'); if (k < 0) return; r.p[i].hell.push(w.wr.splice(k, 1)[0]); w.tired = false; log(r, '🪖 ' + nmOf(w) + ' กลับเป็นสภาพตื่น'); } });
}
function surviveFx(r, i, a) {
  if (a.id === 'SD05-002' && find(r, a.u) && a.us !== r.g.n && r.p[i].av.some(x => x.u !== a.u && isPeopleF(x))) { a.us = r.g.n; const d = 1 + Math.floor(Math.random() * 6); log(r, '🎲 คุณเค้นท์ ทอย ' + d); if (d % 2 && a.tired) { a.tired = false; log(r, '✨ คุณเค้นท์ กลับเป็นสภาพตื่น'); } }
}
function afterBattle(r, p, a, d, res, pa, pd) {
  const df = Math.abs((pa || 0) - (pd || 0)); kdAfter(r, p, a, d, res); bt4Win(r, p, a, d, res);
  if (res === 'win') winFx(r, p.ai, a, df); if (res === 'lose') winFx(r, 1 - p.ai, d, df);
  if (res !== 'lose' && res !== 'both') surviveFx(r, p.ai, a);
  if (res !== 'win' && res !== 'both' && d.id === 'BT02-027' && find(r, d.u) && !noFx(r, d)) { fx({ k: 'say', id: d.id, t: 'สุ่มคว่ำ LIFE' }); lifeDown(r, 1 - p.ai); }
}
function wall(r, i) {
  const p = r.p[i], c = p.co.find(x => x.id === 'SD06-020'); if (!c || c.us === r.g.n || p.av.length || !p.hand.length) return;
  ask(r, i, { yn: true, text: 'กำแพงด่านสุดท้าย: ทิ้งการ์ดบนมือ 1 ใบ เพื่อสอดแนมไหม?', cb: y => { if (!y) return;
    ask(r, i, { text: 'เลือกการ์ดบนมือที่จะทิ้ง', opts: p.hand.map(x => x.u), cancel: true, cb: us => { sendHell(r, us[0]); c.us = r.g.n;
      const n = 1 + (p.co.some(x => x.id === 'SD06-019') ? 2 : 0), seen = p.deck.splice(-n).reverse(); log(r, '🔎 สอดแนม ' + seen.length + ' ใบ: ' + seen.map(x => B[x.id].n).join(', '));
      seen.forEach(x => { if (campTxt(x) && B[x.id].c <= 4) putAv(r, i, x); else { p.hand.push(x); log(r, '✋ ' + B[x.id].n + ' ขึ้นมือ'); } }); } }); } });
}
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
function shieldStep(r, p) {
  const d = r.p[p.who], atkF = find(r, p.u);
  const lipo = atkF && atkF.c.id === 'SD07-007';
  const lipoSide = r.p[p.ai] && r.p[p.ai].av.some(x => x.id === 'SD07-007');
  const L = (p.tk === 'co' || (atkF && atkF.c.hero === r.g.n)) ? [] : d.av.filter(a => !a.tired && a.u !== p.tg && (hasKw(r, a, 'โล่มนุษย์') || lipoSide)).map(a => a.u);
  if (!L.length) return open1(r, p);
  const go = () => r.g.q.unshift(() => open1(r, p));
  ask(r, p.who, { text: 'โล่มนุษย์: เลือก Avatar โล่มนุษย์ (สภาพตื่น) เพื่อรับการโจมตีแทน' + (lipo ? ' — ลิโป้โจมตี ต้องใช้!' : ' — ยกเลิก = ไม่ใช้'), opts: L, n: 1, min: lipo ? 1 : 0, cancel: !lipo, onCancel: go,
    cb: us => {
      if (!us.length) return go();
      const s = find(r, us[0]); if (!s || s.c.tired) return go();
      s.c.tired = true; p.tg = s.c.u; p.tk = 'av';
      if (s.c.id === 'SD05-004') { s.c.bp = (s.c.bp || 0) + 2; p.sh = s.c.u; }
      log(r, '🛡 โล่มนุษย์: ' + nmOf(s.c) + ' รับการโจมตีแทน');
      if (lipoSide) { const L2 = d.av.filter(x => !protectedFrom(r, p.ai, x)).map(x => x.u);
        r.g.q.unshift(() => ask(r, p.ai, { text: 'ลิโป้: ทำลาย Avatar ศัตรู 1 ใบ (ไม่ทำก็ได้)', opts: L2, n: 1, min: 0, cb: u2 => u2.length && destroyAv(r, u2[0]) })); }
      go();
    } });
}
const shieldThen = shieldStep;
function endTurn456(r) {
  const g = r.g, prev = 1 - g.turn; bt4End(r, prev);
  r.p[prev].av.filter(a => a.id === 'BT01-007' && !noFx(r, a)).forEach(a => { const run = () => { a.pw = (a.pw || 0) + 1; a.bc = (a.bc || 0) + 1; fx({ k: 'buff', u: a.u, v: 1 }); log(r, '🐸 แม่กบ POWER +1'); }; if (!autoGuard(r, prev, a, () => true, run)) run(); });
  r.p.forEach((q, qi) => q.av.filter(a => a.ctl != null && a.oo != null && a.oo !== qi).forEach(a => { const o = a.oo; delete a.ctl; delete a.oo; q.av.splice(q.av.indexOf(a), 1); if (canPlaceAv(r, o, a)) { r.p[o].av.push(a); log(r, '↩ ' + nmOf(a) + ' กลับไปฝั่งเจ้าของ'); } else { r.p[o].hell.push(a); log(r, nmOf(a) + ' กลับไม่ได้ (Avatar เต็ม) ลงนรก'); } }));
  r.p[prev].av.filter(a => a.id === 'BT02-017' && !noFx(r, a)).forEach(a => { const run = () => { if (!find(r, a.u)) return; take(r, a.u); r.p[prev].deck.unshift(a); fx({ k: 'say', id: a.id, t: 'กลับใต้ Deck' }); log(r, '📤 แรงงานทาสออฟฟิศ กลับไปใต้ Deck'); }; if (!autoGuard(r, prev, a, () => true, run)) run(); });
  r.p.forEach(q => q.av.filter(a => a.endDie).forEach(a => { delete a.endDie; log(r, '💥 ความกล้าหาญ: ' + nmOf(a) + ' ถูกทำลาย'); kill(r, 0, a.u, 1); })); r.p.forEach(q => { q.co.forEach(c => { if (c.pb) { c.pw = (c.pw || 0) - c.pb; c.pb = 0; } });
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
    if (isAv(c) && symOf(c) === 'คน' && B[c.id].c <= 3) putAv(r, i, c); else { p.deck.unshift(c); log(r, '⬇ ใส่ไว้ใต้ Deck'); } } },
  'SD04-017': { react: 'atk', steps: [{ key: 'k', pay: 1, text: 'เลือก Avatar "รถถัง" ของเรา 1 ใบ ทำลายเป็น Cost', opts: myAvEq(isTank) }], run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'SD04-018': { react: 'atkTank', run: (r, i, cx) => { const p = r.p[i], tg = cx.pend.tg, at = cx.pend.u;
    scout(r, i, 5, { text: 'เลือก Avatar {คน} ที่ติดชื่อ "Tank Ranger" 1 ใบ สวมให้รถถังที่ถูกโจมตี', pred: c => isAv(c) && symOf(c) === 'คน' && B[c.id].n.includes('Tank Ranger') && !isTank(c), rest: 'bottom',
      then: c => { const t = find(r, tg); if (c && t && t.z === 'av' && canWear(t.c, c)) { wearOn(r, i, t.c, c); destroyAv(r, at); log(r, '💥 ทำลาย Avatar ที่สั่งโจมตี'); } else { if (c) { p.deck.unshift(c); } log(r, 'สวมใส่ไม่สำเร็จ'); } } }); } },
  'SD04-019': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ถาดหลุม', opts: (r, i) => allAvT(r, i) }] },
  'SD05-015': { steps: [{ key: 't', text: 'เลือก Avatar {ปลา} ในนรกเรา', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && symOf(c) === 'ปลา').map(c => c.u) }], run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); c && putAv(r, i, c, { tired: !landIs(r, 'SD05-014') }); } },
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

/* ===== [MERGED] SD07/SD08 Magic ===== */
Object.assign(MG, {
  'SD07-013': { run: (r, i) => {
    const p = r.p[i];
    ask(r, i, { choices: ['1) เลือก ขุนพล 1 ใบ → ค้น ขุนพลคนละชื่อ สีเดียวกัน (ไม่ใช่ Only#1)', '2) เลือก ขุนพล 2 ใบ (สีเดียวกัน ชื่อไม่ซ้ำ) → ค้น ขุนพล Only#1 สีเดียวกัน'], text: 'คำสาบานสวนท้อ: เลือกปฏิบัติ', cb: ch => {
      if (ch === 0) { const L = p.av.filter(isKP).map(x => x.u); ask(r, i, { text: 'เลือก ขุนพล (ต่างชาติ) 1 ใบ บนสนามเรา', opts: L, cb: us => { const t = find(r, us[0]).c, col = colOf(t); tutor(r, i, c => isKP(c) && B[c.id].o !== 'Only #1' && B[c.id].col === col && B[c.id].n !== nmOf(t), 'ขุนพลสี' + col + ' (ไม่ใช่ Only#1)'); } }); }
      else { const ask2 = () => ask(r, i, { text: 'เลือก ขุนพล 2 ใบ สีเดียวกัน ชื่อไม่ซ้ำ', opts: sameColPairs(r, i), n: 2, cb: us => { const a = find(r, us[0]).c, b = find(r, us[1]).c; if (colOf(a) !== colOf(b) || nmOf(a) === nmOf(b)) { log(r, 'เลือกไม่ตรงเงื่อนไข ลองใหม่'); return ask2(); } const col = colOf(a); tutor(r, i, c => isKP(c) && B[c.id].o === 'Only #1' && B[c.id].col === col, 'ขุนพล Only#1 สี' + col); } }); ask2(); }
    }, none: () => log(r, 'ไม่มีเป้าหมาย') }); } },
  'SD07-014': { cond: (r, i) => r.p[i].av.length > 0 && r.p[i].av.every(isKP),
    steps: [{ key: 'c', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i, cx) => r.p[i].hand.filter(c => c.u !== cx.card.u).map(c => c.u) },
            { key: 't', text: 'เลือก Avatar ศัตรูที่มี Modification ของศัตรูสวมอยู่ 1 ใบ', opts: (r, i) => r.p[1 - i].av.filter(a => a.id !== 'SD07-001' && a.id !== 'KD04-001' && !a.ctl && r.p[1 - i].mg.some(m => m.at === a.u) && !protectedFrom(r, i, a)).map(a => a.u) }],
    run: (r, i, cx) => { const f = find(r, cx.pick.t[0]); if (!f || f.z !== 'av') return; const me = r.p[i]; if (!canPlaceAv(r, i, f.c)) return log(r, 'Avatar เต็ม'); take(r, f.c.u); const c = f.c; c.ctl = { from: f.i }; c.nolife = 1; c.tired = false; me.av.push(c); log(r, '🕴 ยึด ' + nmOf(c) + ' จนจบเทิร์น (ตี LIFE ไม่ได้)'); } },
  'SD07-015': { run: (r, i) => { const p = r.p[i]; if (p.av.filter(isKP).length >= 2) { draw(r, p, 2); log(r, '✨ ' + p.name + ': จั่ว 2 ใบ'); } else { draw(r, p, 1); draw(r, r.p[1 - i], 1); log(r, '✨ ผู้เล่นทุกคนจั่ว 1 ใบ'); } } },
  'SD07-016': { react: 'atkav', run: (r) => { const p = r.g.pend, t = p && find(r, p.tg); if (t && t.z === 'av') { log(r, '✨ นำ ' + nmOf(t.c) + ' กลับขึ้นมือ'); bounce(r, t.c.u); } } },
  'SD07-017': { react: 'never' }, 'SD08-015': { react: 'never' },
  'SD07-018': { mod: 1, tgf: isKP }, 'SD07-019': {}, 'SD08-016': { mod: 1, tgf: isRat }, 'SD08-017': {},
  'SD08-012': { run: (r, i) => { const p = r.p[i]; const L = p.hell.filter(c => !c.tk && B[c.id].t === 'Construct' && B[c.id].o !== 'Only #1').map(c => c.u);
    const go = () => ask(r, i, { text: 'กรุงโรมใน 1 วัน: เลือก Construct จากนรก สูงสุด 2 ใบ (Cost รวมไม่เกิน 5) ก่อสร้าง', opts: L, n: 2, min: 0, cb: us => { const cs = us.map(u => p.hell.find(h => h.u === u)); if (cs.reduce((a, c) => a + B[c.id].c, 0) > 5) { log(r, 'Cost รวมเกิน 5 ลองใหม่'); return go(); } cs.forEach(c => buildFree(r, i, c, 'hell')); } }); go(); } },
  'SD08-013': { run: (r, i) => { const p = r.p[i], me = p.life.filter(l => l.up).length, op = r.p[1 - i].life.filter(l => l.up).length, both = me >= 4 && me > op;
    const fromHell = () => ask(r, i, { text: 'นำ Avatar Cost ≤ 5 (ไม่ใช่ Only#1) จากนรก ขึ้นมือ 1 ใบ', opts: p.hell.filter(c => isAv(c) && B[c.id].c <= 5 && B[c.id].o !== 'Only #1').map(c => c.u), cb: us => { const q = p.hell.findIndex(h => h.u === us[0]); p.hand.push(...p.hell.splice(q, 1)); } });
    const fromDeck = () => tutor(r, i, c => isAv(c) && B[c.id].c <= 5 && B[c.id].o !== 'Only #1', 'Avatar Cost ≤ 5');
    if (both) { fromHell(); r.g.q.unshift(() => fromDeck()); } else ask(r, i, { choices: ['1) จากนรก ขึ้นมือ', '2) จาก Deck ขึ้นมือ แล้วสับ'], text: 'เลือกปฏิบัติ', cb: c => c === 0 ? fromHell() : fromDeck() }); } },
  'SD08-014': { run: (r, i) => { const p = r.p[i];
    ask(r, i, { text: 'แพร่พันธุ์ทันใจ: ทิ้ง Avatar รัททาทุย จากมือกี่ใบก็ได้ (Cost รวม = เพดานของ Avatar ที่จะอัญเชิญ)', opts: ratHand(r, i).map(c => c.u), n: 7, min: 0, cb: us => {
      const tot = us.reduce((a, u) => a + B[p.hand.find(h => h.u === u).id].c, 0); us.forEach(u => { const q = p.hand.findIndex(h => h.u === u); p.hell.push(...p.hand.splice(q, 1)); });
      ask(r, i, { text: 'อัญเชิญ Avatar รัททาทุย Cost ≤ ' + tot + ' จาก Deck 1 ใบ', opts: p.deck.filter(c => isRat(c) && B[c.id].c <= tot).map(c => c.u), cb: u2 => { summonAny(r, i, u2[0], 'deck'); shuf(p.deck); }, none: () => shuf(p.deck) }); } }); } },
});
/* ===== [MERGED] BT01 Magic ===== */
Object.assign(MG, {
  'BT01-035': { run: (r, i) => { mill(r, i, 3); mill(r, 1 - i, 3); } },
  'BT01-036': { run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'BT01-037': { steps: [{ key: 'c', pay: 1, text: 'เซ่นไหว้: ส่ง Avatar สัตว์ บนสนามเรา 1 ใบ ลงนรก', opts: (r, i) => r.p[i].av.filter(a => isAnimal(a)).map(a => a.u) }],
    run: (r, i) => { draw(r, r.p[i], 3); r.g.lim = r.g.lim || {}; r.g.lim[i] = 'สัตว์'; log(r, '✨ ' + r.p[i].name + ': จั่ว 3 ใบ — เทิร์นนี้อัญเชิญได้เฉพาะ Avatar สัตว์'); } },
  'BT01-038': { run: (r, i) => { draw(r, r.p[i], 2); log(r, '✨ ' + r.p[i].name + ': จั่ว 2 ใบ'); } },
  'BT01-039': { react: 'atk', run: (r) => { const p = r.g.pend; if (p && p.k === 'atk') { const f = find(r, p.u); if (f) { log(r, '✨ ส่ง ' + nmOf(f.c) + ' ลงนรก'); sendHell(r, p.u); } } } },
  'BT01-040': {}, 'BT01-041': { react: 'cast', run: (r) => { const p = r.g.pend; if (p && p.ev) { /* cancelled flag handled via cx */ } } },
  'BT01-042': {}, 'BT01-043': {}, 'BT01-044': {}, 'BT01-045': {}, 'BT01-046': {}, 'BT01-047': {}, 'BT01-048': {}, 'BT01-049': {}, 'BT01-050': {},
});

/* ===== BT02 ===== */
const nmHas = (x, t) => nm2(x).includes(t);
const noFx = (r, x) => { if (!x || !isAv(x)) return false; const f = find(r, x.u); if (!f || f.z !== 'av') return false; if (x.hero === r.g.n) return false; if (x.nf === r.g.n) return true; if (hasEq(r, x, 'BT02-056')) return true; const n = r.g.nofx; return !!(n && n[f.i] === r.g.n); };
function lifeUp(r, i) { const d = r.p[i], l = d.life.find(x => !x.up); if (!l) return false; l.up = 1; fx({ k: 'life', i }); (d.lf = d.lf || []).push(l.id); log(r, '❤ หงาย LIFE ' + d.name + ': ' + B[l.id].n); if (d.life.every(x => x.up)) log(r, d.name + ' สาหัส!'); return true; }
function sac(r, u) { const f = find(r, u); if (!f || f.z !== 'av') return null; const nf = noFx(r, f.c); take(r, u); fx({ k: 'sac', u, id: f.c.id }); r.p[f.i].hell.push(f.c); log(r, '🔥 เซ่นไหว้ ' + nmOf(f.c)); deathFx(r, f, nf); return f.c; }
function costFx(r, i, ps, c) {
  if (symOf(c) !== 'เปรต') return; const me = r.p[i];
  ps.forEach(p => {
    if (p.id === 'BT02-002') { c.imm = r.g.n; fx({ k: 'say', id: p.id, t: 'ไม่ถูกทำลายในเทิร์นนี้' }); log(r, '🛡 ' + nmOf(c) + ' ไม่ถูกทำลายในเทิร์นนี้ (วันชัย)'); }
    if (p.id === 'BT02-003') { fx({ k: 'say', id: p.id, t: 'จั่ว 1 แล้วทิ้ง 1' }); draw(r, me, 1); r.g.q.push(() => me.hand.length && ask(r, i, { text: 'กัญญา: ทิ้งการ์ดบนมือ 1 ใบ', opts: me.hand.map(x => x.u), cb: us => sendHell(r, us[0]) })); }
  });
}
function chooseTg(r, i, a, base) {
  const op = r.p[1 - i], L = [...op.av, ...op.co].map(x => x.u);
  if (!L.length) return shieldStep(r, { ...base, tg: 'life', tk: 'life' });
  fx({ k: 'say', id: a.id, t: 'ศัตรูเลือกเป้าหมายเอง' });
  ask(r, 1 - i, { text: '40ดีกรีแมน โจมตี: เลือกเป้าหมายที่จะถูกโจมตี (ฝ่ายเราเป็นคนเลือก)', opts: L, cb: us => { const t = find(r, us[0]); shieldStep(r, { ...base, tg: us[0], tk: t.z === 'co' ? 'co' : 'av' }); } });
}
function startFx456(r) {
  const g = r.g, p = r.p[g.turn];
  p.av.slice().forEach(a => {
    if (noFx(r, a)) return;
    if (a.id !== 'BT02-020' && a.id !== 'BT02-024') return;
    const run = () => {
    if (a.id === 'BT02-020') { const n = r.p.reduce((s, q) => s + q.mg.filter(m => m.at === a.u && B[m.id].st === 'Modification').length, 0); if (n) { fx({ k: 'say', id: a.id, t: 'จั่ว ' + n }); draw(r, p, n); log(r, '✨ นินจินแมน: จั่ว ' + n + ' ใบ'); } }
    if (a.id === 'BT02-024') { fx({ k: 'say', id: a.id, t: 'จั่วเพิ่ม 1' }); draw(r, p, 1); log(r, '🌳 เสามงคล: จั่วเพิ่ม 1 ใบ'); }
    };
    if (!autoGuard(r, g.turn, a, () => true, run)) run();
  });
}
function atkTrig(r, i, a) {
  const me = r.p[i];
  if (noFx(r, a) || a.us === r.g.n || !me.hand.length) return;
  if (a.id === 'BT02-004') ask(r, i, { text: 'พี่เช: ทิ้งการ์ดบนมือ 1 ใบ เพื่อ POWER +2 จนจบเทิร์น (ยกเลิก = ไม่ใช้)', opts: me.hand.map(x => x.u), cancel: true, cb: us => { a.us = r.g.n; sendHell(r, us[0]); fx({ k: 'say', id: a.id, t: 'POWER +2' }); addTp(a, 2); } });
  if (a.id === 'BT02-005') ask(r, i, { text: 'จ่าคอป: ทิ้งการ์ดบนมือ 1 ใบ เพื่อสอดแนม 3 ใบ (ยกเลิก = ไม่ใช้)', opts: me.hand.map(x => x.u), cancel: true, cb: us => { a.us = r.g.n; sendHell(r, us[0]); fx({ k: 'say', id: a.id, t: 'สอดแนม 3' }); scout(r, i, 3, { text: 'เลือก Avatar {เครื่องจักร} 1 ใบ ขึ้นมือ', pred: c => isAv(c) && symOf(c) === 'เครื่องจักร', rest: 'bottom', then: c => c && r.p[i].hand.push(c) }); } });
}
function rishiFx(r) {
  r.p.forEach((q, pi) => q.av.filter(a => a.id === 'BT02-016' && !noFx(r, a)).forEach(a => r.g.q.push(() => ask(r, pi, { text: 'ฤษี โคบุตร: เลือก Avatar 1 ใบบนสนาม POWER +1', opts: allAvT(r, pi), cb: us => { const t = find(r, us[0]); if (t) { fx({ k: 'say', id: a.id, t: 'POWER +1' }); addTp(t.c, 1); } } }))));
}
const AB_R = { z: 'av', run: (r, i, cx) => { const k = (cx.card.wr || []).findIndex(w => WEAR_IDOL.includes(w.id)); if (k < 0) return; const w = cx.card.wr.splice(k, 1)[0]; putAv(r, i, w); } };
const mgAny = { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่', opts: (r, i) => allAvT(r, i) }] };
const pickOp = (txt, f) => ({ steps: [{ key: 't', text: txt, opts: (r, i) => r.p[1 - i].av.map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); t && f(r, i, t.c, cx); } });
Object.assign(AB, {
  'BT02-010': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.u !== c.u && nmHas(a, 'ไอดอล')), steps: [{ key: 't', text: 'เลือก Avatar ชื่อ "ไอดอล" ที่จะสวมใส่', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && nmHas(a, 'ไอดอล')).map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } },
  'BT02-028': wearUse,
  'BT02-058': { z: 'land', steps: [{ key: 'd', pay: 1, text: 'ทิ้ง Avatar {นรก} 1 ใบจากบนมือ', opts: (r, i) => r.p[i].hand.filter(c => isAv(c) && symOf(c) === 'นรก').map(c => c.u) }, { key: 't', text: 'เลือก "นายนิรยบาล" (Cost ไม่เกิน 4) จากนรก', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && (B[c.id].n.includes('นายนิรยบาล') || c.id === 'KD02-002') && B[c.id].c <= 4).map(c => c.u) }], run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); c && putAv(r, i, c); } },
});
Object.assign(SUM, {
  'BT02-001': (r, i) => lifeUp(r, i),
  'BT02-007': (r, i, x) => ask(r, i, { text: 'อ๊บ จุติ: เลือก Avatar ฝ่ายเรา (ไม่ใช่ใบนี้) เซ่นไหว้', opts: r.p[i].av.filter(a => a.u !== x.u).map(a => a.u), cb: us => sac(r, us[0]) }),
  'BT02-008': (r, i, x) => ask(r, i, { text: 'พระพรหม จุติ: เลือก Avatar ฝ่ายเรา 1 ใบ เซ่นไหว้', opts: r.p[i].av.filter(a => a.u !== x.u).map(a => a.u), cb: us => { const f = find(r, us[0]); if (!f) return; const s = symOf(f.c), n = nmOf(f.c); sac(r, us[0]); r.g.q.push(() => { const L = r.p[i].hell.filter(c => isAv(c) && symOf(c) === s && B[c.id].n !== n && B[c.id].c <= 8).map(c => c.u); ask(r, i, { text: 'เลือก Avatar จากนรก (Symbol เดียวกัน คนละชื่อ Cost ≤8) อัญเชิญ', opts: L, cb: u2 => { const c = fromZone(r, i, 'hell', u2[0]); c && putAv(r, i, c, { sm: 1 }); } }); }); } }),
  'BT02-009': (r, i, x) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && B[c.id].n.includes('โอตะ')).map(c => c.u); const fin = u => { if (u != null) wearOn(r, i, x, fromZone(r, i, 'deck', u)); shuf(p.deck); }; if (!L.length) return fin(null); ask(r, i, { text: 'จุติ: เลือก Avatar "โอตะ" จาก Deck 1 ใบ สวมให้มีมมิจัง', opts: L, cb: us => fin(us[0]) }); },
  'BT02-011': (r, i) => tutor(r, i, c => isAv(c) && (B[c.id].n.includes('ลูกแม่ศรีนวล') || B[c.id].n.includes('พ่อบุญใหญ่')), 'ลูกแม่ศรีนวล/พ่อบุญใหญ่'),
  'BT02-012': (r, i) => { const g = r.g; if (g.land) { r.p[g.land.o].hell.push(g.land.c); g.land = null; log(r, '💥 ทำลาย Land Magic'); } const p = r.p[i], L = p.deck.filter(c => B[c.id].t === 'Magic' && B[c.id].st === 'Land').map(c => c.u); const fin = u => { if (u != null) { g.land = { c: fromZone(r, i, 'deck', u), o: i }; ev(r, g.land.c.id); log(r, '🌍 วาง ' + B[g.land.c.id].n + ' ลง Land Magic Zone'); } shuf(p.deck); }; if (!L.length) return fin(null); ask(r, i, { text: 'เลือก Land Magic จาก Deck มาเล่น', opts: L, cb: us => fin(us[0]) }); },
  'BT02-015': (r, i, x) => { const me = r.p[i], op = r.p[1 - i]; if (!me.hand.length || !op.av.length) return; ask(r, i, { text: 'เอเลี่ยน จุติ: ทิ้งการ์ดบนมือ 1 ใบ แล้วเลือก Avatar ศัตรู โยนเหรียญ (ยกเลิก = ไม่ใช้)', opts: me.hand.map(x => x.u), cancel: true, cb: us => { sendHell(r, us[0]); r.g.q.push(() => ask(r, i, { text: 'เลือก Avatar ศัตรู 1 ใบ', opts: op.av.map(a => a.u), cb: u2 => { const h = Math.random() < .5; fx({ k: 'coin', h }); log(r, '🪙 โยนเหรียญ: ' + (h ? 'หัว — ทำลาย Avatar ศัตรู' : 'ก้อย — ทำลาย Avatar ใบนี้')); r.g.q.push(() => destroyAv(r, h ? u2[0] : x.u)); } })); } }); },
  'BT02-019': (r, i) => ask(r, i, { yn: true, text: 'โอดิน จุติ: ธรณีสูบ 9 ใบ เพื่อนำ Avatar {เทพ} จาก Deck ขึ้นมือ?', cb: y => { if (!y) return; mill(r, i, 9); r.g.q.push(() => tutor(r, i, c => isAv(c) && symOf(c) === 'เทพ', 'Avatar {เทพ}')); } }),
  'BT02-021': (r, i) => { const op = r.p[1 - i]; if (!op.av.length) return; ask(r, i, { yn: true, text: 'กัปตันไกร จุติ: ทิ้งการ์ดทั้งหมดบนมือ เพื่อนำ Avatar ศัตรู 1 ใบกลับขึ้นมือ?', cb: y => { if (!y) return; r.p[i].hand.slice().forEach(c => sendHell(r, c.u)); r.g.q.push(() => ask(r, i, { text: 'เลือก Avatar ศัตรูที่จะกลับขึ้นมือ', opts: op.av.map(a => a.u), cb: us => bounce(r, us[0]) })); } }); },
  'BT02-022': (r, i) => { const p = r.p[i], n = Math.min(3, p.deck.length); if (n < 2) return; const seen = p.deck.slice(-n).reverse(), order = []; log(r, '🔎 ' + p.name + ': สอดแนม ' + n + ' ใบ');
    const fin = () => { seen.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); order.slice().reverse().forEach(c => p.deck.push(c)); log(r, '🔎 เรียงลำดับการ์ดบน Deck แล้ว'); };
    const step = () => { const rem = seen.filter(c => !order.includes(c)); if (rem.length === 1) { order.push(rem[0]); return fin(); } ask(r, i, { text: 'สอดแนม: เลือกการ์ดที่จะวางเป็นลำดับที่ ' + (order.length + 1) + ' จากบนสุด', opts: rem.map(c => c.u), cb: us => { order.push(seen.find(c => c.u === us[0])); step(); } }); }; step(); },
  'BT02-025': (r, i) => tutor(r, i, c => isAv(c) && B[c.id].n.includes('เสามงคล'), 'เสามงคล'),
  'BT02-026': (r, i) => { const pk = (who, from) => { const L = r.p[from].hell.map(c => c.u); if (!L.length) return; ask(r, who, { text: 'ชุ่ย จุติ: เลือกการ์ดจากนรกของ ' + r.p[from].name + ' (สูงสุด 5 ใบ) กลับเข้า Deck เจ้าของ', opts: L, n: Math.min(5, L.length), cb: us => { us.forEach(u => { const c = fromZone(r, from, 'hell', u); c && r.p[from].deck.push(c); }); shuf(r.p[from].deck); log(r, '♻ ' + us.length + ' ใบ กลับเข้า Deck ของ ' + r.p[from].name); } }); };
    pk(i, 1 - i); r.g.q.push(() => pk(1 - i, i)); },
});
function deathFx2(r, f, nf) {
  if (nf) return; const c = f.c;
  if (c.id === 'BT01-012') { const q = r.p[f.i], l = q.life.find(x => x.up); if (l) { l.up = 0; const k = q.lf ? q.lf.lastIndexOf(l.id) : -1; if (k >= 0) q.lf.splice(k, 1); log(r, '❤ ลูกแม่ศรีนวล: คว่ำ LIFE ใบบนสุดที่หงายอยู่กลับ'); } }
  if (c.id === 'BT01-013') r.g.q.push(() => { const L = r.p[f.i].hell.filter(x => isAv(x) && isAnimal(x) && B[x.id].c <= 4).map(x => x.u); L.length && ask(r, f.i, { text: 'คำสั่งเสีย: เลือก Avatar {สัตว์} Cost ไม่เกิน 4 จากนรก นำกลับขึ้นมือ', opts: L, cb: us => { const x = fromZone(r, f.i, 'hell', us[0]); if (x) { r.p[f.i].hand.push(x); log(r, '♻ นำ ' + B[x.id].n + ' กลับขึ้นมือ'); } } }); });
  if (c.id === 'BT02-013') r.g.q.push(() => { const L = r.p.flatMap(q => q.mg.map(m => m.u)); if (L.length) return ask(r, f.i, { text: 'คำสั่งเสีย: เลือก MAGIC บนสนาม 1 ใบ ทำลาย', opts: L, cb: us => sendHell(r, us[0]) }); if (r.g.land) { r.p[r.g.land.o].hell.push(r.g.land.c); r.g.land = null; log(r, '💥 ทำลาย Land Magic'); } });
}
Object.assign(MG, {
  'BT02-042': { run: (r, i) => { r.p[i].av.forEach(a => a.tired = true); const sum = allAv(r).filter(a => a.x.tired).reduce((s, a) => s + P(r, a.x), 0); log(r, '🗳 ประชามติ: Avatar ฝ่ายเราเป็นสภาพนอน ผลรวม POWER นอน = ' + sum); const L = allAv(r).filter(a => P(r, a.x) < sum).map(a => a.x.u); ask(r, i, { text: 'เลือก Avatar ที่ POWER ต่ำกว่า ' + sum + ' ทำลาย', opts: L, cb: us => destroyAv(r, us[0]) }); } },
  'BT02-043': { run: (r, i) => { const E2 = ['r', 'p', 's'], N = { r: 'ค้อน', p: 'กระดาษ', s: 'กรรไกร' }; let a, b; do { a = rnd(E2); b = rnd(E2); } while (a === b); const w = ((E2.indexOf(a) - E2.indexOf(b) + 3) % 3 === 1) ? i : 1 - i; fx({ k: 'rps', a, b, i }); log(r, '✊ เป่ายิ้งฉุบ: ' + r.p[i].name + ' ' + N[a] + ' vs ' + r.p[1 - i].name + ' ' + N[b] + ' → ' + r.p[w].name + ' ชนะ'); r.g.q.push(() => ask(r, w, { text: 'ชนะเป่ายิ้งฉุบ: เลือก Avatar 1 ใบบนสนาม ทำลาย', opts: allAv(r).map(x => x.x.u), cb: us => destroyAv(r, us[0]) })); } },
  'BT02-044': { run: (r, i) => ask(r, i, { text: 'ด่านลอย: เลือกค่า Cost (0-9)', choices: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], cb: n => { const op = r.p[1 - i]; if (!op.hand.length) return log(r, 'ศัตรูไม่มีการ์ดบนมือ'); const c = rnd(op.hand); log(r, '🎯 ด่านลอย เลือก Cost ' + n + ' — สุ่มได้ ' + B[c.id].n); if (isAv(c) && B[c.id].c === n) { sendHell(r, c.u); log(r, '💥 ตรงค่า Cost! ส่งลงนรก'); } else log(r, 'ไม่ตรง'); } }) },
  'BT02-045': { steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายเรา POWER +4 (ถูกทำลายตอน End Phase)', opts: (r, i) => r.p[i].av.map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { addTp(t.c, 4); t.c.endDie = 1; } } },
  'BT02-046': pickOp('เลือก Avatar ศัตรู 1 ใบ นำขึ้นมือ', (r, i, t) => bounce(r, t.u)),
  'BT02-047': { steps: [{ key: 'k', text: 'เซ่นไหว้ Avatar {แมลง} ฝ่ายเรา 1 ใบ', opts: (r, i) => r.p[i].av.filter(a => symOf(a) === 'แมลง').map(a => a.u) }], run: (r, i, cx) => { sac(r, cx.pick.k[0]); draw(r, r.p[i], 3); r.g.onlyBug = { n: r.g.n, i }; log(r, '🦟 จั่ว 3 ใบ — เทิร์นนี้โจมตีได้เฉพาะ Avatar {แมลง}'); } },
  'BT02-048': { run: (r, i) => { r.g.nofx = r.g.nofx || [0, 0]; r.g.nofx[1 - i] = r.g.n; fx({ k: 'say', id: 'BT02-048', t: 'ความสามารถ Avatar ศัตรูไร้ผลจนจบเทิร์น' }); log(r, '🚫 ความสามารถของ Avatar ฝ่ายศัตรูไร้ผลจนจบเทิร์น'); } },
  'BT02-049': { react: 'atk', run: (r, i) => { const n = r.g.atkC && r.g.atkC.n === r.g.n ? r.g.atkC.c : 1; draw(r, r.p[i], n); log(r, '✨ จั่ว ' + n + ' ใบ'); } },
  'BT02-051': { react: 'never', run: (r) => log(r, 'ถวาย ใช้ได้อัตโนมัติเมื่อ Avatar จะถูกทำลาย') },
  'BT02-052': { react: 'atkAv', steps: [{ key: 't', text: 'เลือก Avatar ศัตรู 1 ใบ POWER -2', opts: (r, i) => r.p[1 - i].av.map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); t && addTp(t.c, -2); } },
  'BT02-053': { react: 'atkAv', steps: [{ key: 't', text: 'เลือก Avatar ใบอื่น (ไม่ใช่เป้าหมาย) นำ POWER ไปเพิ่มให้เป้าหมาย', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.pend.tg).map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]), tg = find(r, cx.pend.tg); if (!t || !tg) return; const v = P(r, t.c); addTp(tg.c, v); (cx.pend.tmp = cx.pend.tmp || []).push({ u: tg.c.u, v }); log(r, '🏫 ' + nmOf(tg.c) + ' POWER +' + v + ' จนจบการต่อสู้'); } },
  'BT02-054': MG['SD06-014'],
  'BT02-055': mgAny, 'BT02-056': mgAny, 'BT02-057': mgAny,
});

/* ===== [MERGED] BT01 Summon Effects ===== */
function fxSummon01(r, i, x) {
  const me = r.p[i], nm = c => B[c.id].n;
  switch (x.id) {
    case 'BT01-003': scout(r, i, 5, { text: 'จุติ: เลือก Land Magic 1 ใบ ขึ้นมือ', pred: c => B[c.id].t === 'Magic' && B[c.id].st === 'Land', rest: 'bottom', then: c => c && me.hand.push(c) }); break;
    case 'BT01-006': tutor(r, i, c => B[c.id].t === 'Magic' && B[c.id].st === 'Modification' && nm(c).startsWith('น้ำ'), 'Modification Magic "น้ำ"'); break;
    case 'BT01-009': { if (!me.av.some(a => nmOf(a) === 'รัททาทุย นางพญา')) break; let left = 5;
      const step = () => { const opts = me.deck.filter(c => isAv(c) && nm(c).includes('รัททาทุย') && B[c.id].c <= left).map(c => c.u); if (!opts.length || !canPlaceAv(r, i, { id: 'x' })) { shuf(me.deck); return; }
        ask(r, i, { text: 'จุติ: อัญเชิญ รัททาทุย จาก Deck (Cost คงเหลือ ' + left + ') — ไม่เลือก = จบ', opts, n: 1, min: 0, cb: us => { if (!us.length) { shuf(me.deck); return; } const c = me.deck.find(y => y.u === us[0]); left -= B[c.id].c; summonAny(r, i, us[0], 'deck'); step(); } }); };
      step(); break; }
    case 'BT01-011': ask(r, i, { text: 'จุติ: เลือก Magic บนสนาม 1 ใบ ทำลาย', opts: [...r.p[0].mg, ...r.p[1].mg].map(c => c.u), cb: us => { const f = find(r, us[0]); if (!f) return; take(r, us[0]); r.p[f.i].hell.push(f.c); log(r, '💥 ทำลาย Magic ' + B[f.c.id].n); } }); break;
    case 'BT01-016': scout(r, i, 5, { text: 'จุติ: เลือก "พญายม" หรือ "นายนิรยบาล" 1 ใบ ขึ้นมือ', pred: c => nm(c) === 'พญายม' || nm(c).startsWith('นายนิรยบาล') || c.id === 'KD02-002' || c.id === 'KD02-001', rest: 'bottom', then: c => c && me.hand.push(c) }); break;
    case 'BT01-017': ask(r, i, { text: 'จุติ: เลือก Avatar ศัตรู 1 ใบ ยึดมาฝั่งเรา (สภาพนอน) — ไม่เลือกก็ได้', opts: r.p[1 - i].av.map(a => a.u), n: 1, min: 0, cb: us => us.length && stealCard(r, i, us[0]) }); break;
    case 'BT01-019': scout(r, i, 5, { text: 'จุติ: เลือก "สิมพลีนรก" 1 ใบ ขึ้นมือ', pred: c => nm(c) === 'สิมพลีนรก', rest: 'bottom', then: c => c && me.hand.push(c) }); break;
    case 'BT01-020': ask(r, i, { text: 'จุติ: เลือก Avatar ผี จาก Deck 1 ใบ อัญเชิญลงสนาม', opts: me.deck.filter(c => isAv(c) && symOf(c) === 'ผี').map(c => c.u), cb: us => { summonAny(r, i, us[0], 'deck'); shuf(me.deck); }, none: () => shuf(me.deck) }); break;
    case 'BT01-021': tutor(r, i, c => isAv(c) && nm(c).includes('ตำรวจสัมภเวสี') && !nm(c).startsWith('สารวัตร'), 'ตำรวจสัมภเวสี'); break;
  }
}
function stealCard(r, i, u) {
  const f = find(r, u), me = r.p[i]; if (!f || f.z !== 'av' || f.i === i) return false;
  if (f.c.id === 'KD04-001') { log(r, '🛡 ราชันย์หุ่นนักรบผู้กล้า ไม่สามารถถูกเปลี่ยนการควบคุมได้'); return false; }
  if (f.c.id === 'BT04-003' && !r.g.nutOK && !noFx(r, f.c)) { log(r, '🛡 ไอ้นัท - คนใจเด็ด ไม่ถูกเปลี่ยนการควบคุม'); return false; }
  if (f.c.hero === r.g.n) { log(r, '🛡 ' + nmOf(f.c) + ' ไม่รับผลความสามารถ'); return false; }
  if (!canPlaceAv(r, i, f.c)) { log(r, 'Avatar เต็ม เปลี่ยนการควบคุมไม่ได้'); return false; }
  r.p[f.i].av.splice(f.k, 1); if (f.c.oo == null) f.c.oo = f.i; f.c.tired = true; me.av.push(f.c); log(r, '✨ ' + me.name + ' ยึด ' + nmOf(f.c) + ' มาฝั่งเรา'); return true;
}

/* ===== [MERGED] SD07/SD08/BT01 LIFE ===== */
const LIFEX = { 'SD07-021': { z: 'hand', col: 'เขียว' }, 'SD07-022': { z: 'hand', col: 'ฟ้า' }, 'SD07-023': { z: 'hand', col: 'แดง' }, 'SD08-021': { z: 'hand' }, 'SD08-022': { z: 'hell', must: 1, max: 2 } };
function lifeFx2(r, i, id) {
  const d = LIFEX[id]; if (!d) return false; const p = r.p[i];
  const opts = p[d.z].filter(c => isAv(c) && B[c.id].c <= (d.max != null ? d.max : 4) && (!d.col || B[c.id].col === d.col)).map(c => c.u);
  ask(r, i, { text: '❤ ' + B[id].n + ': อัญเชิญ Avatar' + (d.col ? 'สี' + d.col : '') + ' Cost ≤ ' + (d.max != null ? d.max : 4) + ' จาก' + (d.z === 'hand' ? 'มือ' : 'นรก') + ' ลงสนาม' + (d.must ? '' : ' (ไม่เลือกก็ได้)'), opts, n: 1, min: d.must ? 1 : 0, cb: us => us.length && summonAny(r, i, us[0], d.z) });
  return true;
}
const lifeFx = (r, i, id) => {
  if (lifeFx2(r, i, id)) return;
  if (kdLife(r, i, id)) return;
  const c = B[id], p = r.p[i];
  if (id === 'SD06-022') { p.co.forEach(x => { x.pw = (x.pw || 0) + 1; x.pb = (x.pb || 0) + 1; }); return log(r, '❤ ' + c.n + ': Construct ทุกใบ POWER +1 จนจบเทิร์น'); }
  if (id === 'SD06-023') return ask(r, i, { text: c.n + ': เลือก Construct ในนรกเรา 1 ใบ ขึ้นมือ', opts: p.hell.filter(x => x.id && B[x.id].t === 'Construct').map(x => x.u), cb: us => { p.hand.push(fromZone(r, i, 'hell', us[0])); log(r, '❤ นำ Construct ขึ้นมือ'); } });
  if (id === 'SD06-024') return scout(r, i, 5, { text: c.n + ': เลือก Construct 1 ใบ ขึ้นมือ', pred: x => B[x.id].t === 'Construct', rest: 'bottom', then: x => x && p.hand.push(x) });
  if (/จั่วการ์ด 1 ใบ/.test(c.e) && /main phase/i.test(c.e)) { draw(r, p, 1); log(r, '❤ ' + c.n + ': ' + p.name + ' จั่ว 1 ใบ'); } else log(r, '❤ LIFE ' + c.n + ': ' + c.e + ' (ใช้เอง)');
};

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
      for (const i of main) if (cnt[B[i].n] > (B[i].lim || (/ได้มากสุด 50 ใบ/.test(B[i].e || '') ? 50 : (B[i].o === 'Only #1' ? 1 : 4)))) E('ซ้ำเกิน: ' + B[i].n);
      if (main.filter(i => B[i].o === 'Only #1').length !== 1) E('ต้องมี Only#1 1 ใบ');
      if (ban) checkBan(main);
    }
  }
  return { main, life };
}
const DC_MS = 180000, LOST = {};
const userWs = n => [...wss.clients].filter(w => w.user === n && w.readyState === 1);
const friendStat = w => [...(w.fr || [])].map(n => { const q = Object.values(rooms).find(x => x.p.some(p => p.name === n && p.ws && p.ws.readyState === 1)); return { name: n, on: userWs(n).length > 0, st: q ? (q.g && !q.g.over ? 'play' : 'room') : '' }; });
const pushFst = (w, force) => { if (!w.user || !w.fr || w.readyState !== 1) return; const L = friendStat(w), s = JSON.stringify(L); if (force || s !== w.lastF) { w.lastF = s; w.send(JSON.stringify({ t: 'fst', l: L })); } };
const pushMe = async (n, note) => { const ws_ = userWs(n); if (!ws_.length) return; const d = await dbGet(n); ws_.forEach(w => { w.fr = new Set(d.fr || []); w.send(JSON.stringify({ t: 'me', me: prof(n, d), ...(note ? { note } : {}) })); pushFst(w, true); }); };
const rjRoom = n => Object.values(rooms).find(q => q.g && !q.g.over && q.p.some(p => p.name === n));
function rjStatus(ws) {
  const q = rjRoom(ws.user);
  if (q) { const k = q.p.findIndex(p => p.name === ws.user), p = q.p[k]; ws.send(JSON.stringify({ t: 'rj', room: q.code, op: q.p[1 - k] && q.p[1 - k].name, left: p.dc ? Math.max(0, DC_MS - (Date.now() - p.dc)) : DC_MS })); return; }
  const l = LOST[ws.user]; if (l && Date.now() - l.at < 18e5) ws.send(JSON.stringify({ t: 'lost', op: l.op })); else delete LOST[ws.user];
}
const view = (r, i) => {
  CR = r; const g = r.g, pub = p => ({ name: p.name, eq: p.eq || {}, av: p.av.map(x => ({ ...x, wr: undefined, wn: (x.wr || []).map(w => w.id), cp: P(r, x), ab: abOf(r, r.p.indexOf(p), x, 'av'), sg: hasKw(r, x, 'สามัคคี') ? 1 : 0 })), mg: p.mg.map(x => ({ ...x, ab: abOf(r, r.p.indexOf(p), x, 'mg') })), co: p.co.map(x => ({ ...x, ab: abOf(r, r.p.indexOf(p), x, 'co') })), hell: p.hell.map(c => ABIL[c.id] && ABIL[c.id].zone === 'hell' ? { ...c, hab: kdHellAb(r, r.p.indexOf(p), c) } : c), dk: p.dk, deck: p.deck.length, dt: dtop03(r, p), hn: p.hand.length, life: p.life.map(l => l.up ? l : { up: 0 }) });
  return { i, odc: r.p[1 - i].dc ? Math.max(0, DC_MS - (Date.now() - r.p[1 - i].dc)) : 0, dc: g.dc || null, md: r.p.map(p => !!p.m), me: { ...pub(r.p[i]), hand: r.p[i].hand.map(c => KD_HAND[c.id] ? { ...c, ab: kdHandAb(r, i, c) } : c) }, op: pub(r.p[1 - i]), mine: g.turn === i, phase: g.phase, land: g.land && { c: { ...g.land.c, ab: abOf(r, g.land.o, g.land.c, 'land') }, o: g.land.o }, log: g.log.slice(-40), over: g.over, ev: g.ev || null, dw: g.dw, dr: g.dr || null, bt: g.bt || null, fx: g.fxl || [], tn: g.n, ru: g.used && g.used[i] && g.used[i].React ? 1 : 0, ask: g.ask ? { mine: g.ask.who === i, text: g.ask.text, opts: g.ask.who === i ? g.ask.opts : [], n: g.ask.n, min: g.ask.min, cancel: g.ask.cancel, yn: g.ask.yn, choices: g.ask.choices, cards: g.ask.who === i ? g.ask.cards : null } : null, won: g.over ? (g.win == null ? null : g.win === i) : null, pend: g.pend ? { mine: g.pend.who === i, can: g.pend.who === i ? reactList(r, i) : undefined, ev: g.pend.ev ? { k: g.pend.ev.k, id: g.pend.ev.id } : null, k: g.pend.k, until: g.pend.until, u: g.pend.u, tg: g.pend.tg, ai: g.pend.ai } : null };
};
const sview = r => { const v = view(r, 0); v.spec = 1; v.mine = false; v.tp = r.g.turn; v.me.hn = r.p[0].hand.length; v.me.hand = []; v.ru = 1; if (v.ask) v.ask = { ...v.ask, mine: false, opts: [], cards: null }; if (v.pend) v.pend = { ...v.pend, mine: false }; return v; };
const bc = r => { (r.spec || []).forEach(w => { if (r.g && w.readyState === 1) w.send(JSON.stringify({ t: 's', s: sview(r) })); }); bc0(r); };
const bc0 = r => r.p.forEach((p, i) => {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(r.g ? { t: 's', s: view(r, i) } : { t: 'lobby', code: r.code, bot: r.bot ? r.bot.lv : 0, owner: r.p[0] && r.p[0].name, exp: r.exp ? Math.max(0, r.exp - Date.now()) : 0, clock: r.cfg.clock, react: r.cfg.react, ban: r.cfg.ban, players: r.p.map(x => ({ name: x.name, ready: !!x.deck })) }));
});
const log = (r, s) => r.g.log.push(s);
const ev = (r, id) => { r.g.ev = { n: (r.g.ev ? r.g.ev.n : 0) + 1, id }; };
const draw = (r, p, n) => { for (let k = 0; k < n && p.deck.length; k++) p.hand.push(p.deck.pop()); if (!p.deck.length && !r.g.over) { r.g.over = p.name + ' เด็คหมด แพ้!'; r.g.win = r.p ? 1 - r.p.indexOf(p) : null; } };
const pw = x => (x.tk ? x.tk.p : B[x.id].p) + x.pw;
const find = (r, u) => { for (let i = 0; i < 2; i++) for (const z of ZN) { const k = r.p[i][z].findIndex(c => c.u === u); if (k >= 0) return { i, z, k, c: r.p[i][z][k] }; } return null; };
const release = (r, u) => r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) if (p.mg[k].at === u) { const [g] = p.mg.splice(k, 1); delete g.at; p.hell.push(g); } });
const take = (r, u) => { const f = find(r, u); if (!f) E('ไม่พบการ์ด'); r.p[f.i][f.z].splice(f.k, 1); if (f.z === 'av') { delete f.c.half; delete f.c.kdSwap; release(r, u); if (f.c.wr && f.c.wr.length) { f.c.wr.forEach(w => r.p[f.i].hell.push(w)); f.c.wr = []; } } delete f.c.at; delete f.c.cx; return f; };
const kill = (r, i, u, ns) => {
  const f0 = find(r, u), nf0 = !!(f0 && f0.z === 'av' && noFx(r, f0.c));
  if (mg016(r, f0)) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม');
  if (f0 && f0.z === 'av' && !ns && f0.c.id !== 'SD06-005' && campTxt(f0.c) && hasCamp(r, f0.i) && !r.g.ask) {
    const g5 = r.p[f0.i].av.find(a => a.id === 'SD06-005');
    if (g5) { ask(r, f0.i, { yn: true, text: 'พันเรือง: ทำลาย พันเรือง แทน ' + nmOf(f0.c) + ' ไหม?', cb: y => y ? kill(r, f0.i, g5.u, 1) : kill(r, i, u, 1) }); return; }
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && f0.c.id === 'BT03-024' && !noFx(r, f0.c) && f0.c.us24 !== r.g.n) {
    ask(r, f0.i, { yn: true, text: 'บัลเดอร์: ธรณีสูบ Deck ตัวเอง 9 ใบ แทนการถูกทำลายไหม?', cb: y => { if (!y) return kill(r, i, u, 1); f0.c.us24 = r.g.n; vfx(f0.c.u, 'aura', 'ธรณีสูบ 9 ใบ แทน', '#fde047'); log(r, '🛡 บัลเดอร์: ธรณีสูบ 9 ใบ แทนการถูกทำลาย'); mill(r, f0.i, 9); } }); return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && nmOf(f0.c) === 'หุ่นนักรบผู้กล้า : ไม้ท์เกรน' && !noFx(r, f0.c)) {
    const g7 = r.p[f0.i].av.find(a => a.id === 'BT03-007' && a.u !== f0.c.u && !noFx(r, a));
    if (g7) { ask(r, f0.i, { yn: true, text: 'อากาศยานผู้กล้า: ทำลาย อากาศยานผู้กล้า แทน ' + nmOf(f0.c) + ' ไหม?', cb: y => { if (!y) return kill(r, i, u, 1); vfx(g7.u, 'burst', 'รับแทน!', '#38bdf8'); log(r, '🛡 อากาศยานผู้กล้า ถูกทำลายแทน ' + nmOf(f0.c)); kill(r, f0.i, g7.u, 1); } }); return; }
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && !(r.g.used && r.g.used[f0.i] && r.g.used[f0.i].React) && r.p[f0.i].hand.some(c => c.id === 'BT02-051')) {
    ask(r, f0.i, { yn: true, text: 'ถวาย: ทิ้งการ์ดทั้งหมดบนมือ เพื่อให้ ' + nmOf(f0.c) + ' ไม่ถูกทำลาย?', cb: y => { if (!y) return kill(r, i, u, 1); r.g.used[f0.i].React = 1; fx({ k: 'say', id: 'BT02-051', t: 'ไม่ถูกทำลาย' }); r.p[f0.i].hand.slice().forEach(c => sendHell(r, c.u)); log(r, '🙏 ถวาย: ' + nmOf(f0.c) + ' ไม่ถูกทำลาย'); } });
    return;
  }
  if (f0 && f0.z === 'av') {
    if (f0.c.hero === r.g.n && !r.g.inB) { log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลความสามารถ (ช่วยโลกใบนี้ไว้)'); return; }
    if (f0.c.imm === r.g.n) { log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกทำลายในเทิร์นนี้'); return; }
    if (r.g.inB) { const q = r.p.find(q => q.mg.some(m => m.at === f0.c.u && m.id === 'BT02-055')); if (q) { const k = q.mg.findIndex(m => m.at === f0.c.u && m.id === 'BT02-055'), [cd] = q.mg.splice(k, 1); delete cd.at; q.hell.push(cd); fx({ k: 'say', id: 'BT02-055', t: 'ไม่ถูกทำลาย' }); log(r, '🛡 ประกันชั้นต่ำ: ' + nmOf(f0.c) + ' ไม่ถูกทำลาย'); return; } }
    const k10 = (f0.c.wr || []).findIndex(w => w.id === 'BT02-010');
    if (k10 >= 0 && nmHas(f0.c, 'ไอดอล')) { r.p[f0.i].hell.push(f0.c.wr.splice(k10, 1)[0]); log(r, '🛡 ทำลาย โอตะ รุ่นก่อตั้ง แทน ' + nmOf(f0.c)); return; }
    if (f0.c.ward) { delete f0.c.ward; log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกทำลาย (คุณพยาบาล)'); return; }
    { const w14 = r.p[f0.i].mg.find(m => m.id === 'KD04-014' && m.at === f0.c.u && m.u14 !== r.g.n); if (w14 && !nf0 && !r.g.inB && r.g.turn !== f0.i) { w14.u14 = r.g.n; const dv = 1 + Math.floor(Math.random() * 6); log(r, '🎲 ไบโพล่า ชิลด์ ทอย ' + dv); if (dv % 2 === 0) { vfx(f0.c.u, 'burst', 'ไม่ถูกนำออกจากสนาม (ทอย ' + dv + ')', '#38bdf8'); log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนาม'); return; } } }
    if (f0.c.id === 'KD01-005' && !f0.c.half && !nf0) { f0.c.half = 1; const dv = Math.floor((B[f0.c.id].p || 0) / 2); f0.c.pw = (f0.c.pw || 0) - dv; fx({ k: 'say', id: f0.c.id, t: 'POWER ตั้งต้นลดครึ่ง แทนการถูกทำลาย' }); fx({ k: 'buff', u: f0.c.u, v: -dv }); log(r, '🛡 ' + nmOf(f0.c) + ': POWER ตั้งต้น -' + dv + ' แทนการถูกทำลาย'); return; }
    const k = (f0.c.wr || []).findIndex(w => w.id === 'SD04-002');
    if (k >= 0) { r.p[f0.i].hell.push(f0.c.wr.splice(k, 1)[0]); log(r, '🛡 ทำลาย จ่ามะนาว แทน ' + nmOf(f0.c)); return; }
  }
  const f = take(r, u); fx({ k: 'die', u, id: f.c.tk ? null : (f.c.kd || f.c.id), nm: f.c.tk ? f.c.tk.n : null }); if (!f.c.tk) r.p[f.i].hell.push(f.c);
  deathFx(r, f, nf0);
};
function payOK(c, pay, me) {
  if (!c.c) { if (pay.length) E('Cost 0 ไม่ต้องจ่าย'); return; }
  const gs = pay.map(x => { const d = B[x.id]; if (me && me.noCost && me.noCost.includes(d.n)) E('ใช้เป็น Cost ไม่ได้: ' + d.n); if (!d.g) E('การ์ด Gem 0 ใช้จ่ายไม่ได้'); if (d.gc && c.col && d.gc !== c.col) E('สี Gem ไม่ตรง: ' + d.n); /* Gem ขาว(ไม่มีสี)จ่ายได้ทุกสี / การ์ดไม่มีสีรับ Gem ทุกสี */ return d.g; });
  const sum = gs.reduce((a, b) => a + b, 0);
  if (sum < c.c) E('Gem ไม่พอ (' + sum + '/' + c.c + ')');
}
function startTurn(r) {
  const g = r.g, p = r.p[g.turn]; g.used = [{}, {}]; g.noReact = null;
  p.av.forEach(a => { if (!(a.hold && a.hold >= g.n)) a.tired = false; });
  const cnt = g.n === 0 ? 2 : p.hand.length < 3 ? 3 - p.hand.length : 1;
  const queen = g.n < 2 ? p.deck.find(c => c.id === 'BT01-008') : null;   // Draw Phase แรกของผู้เล่น
  const fin = swap => {
    const b4 = p.hand.length;
    if (swap) { p.deck.splice(p.deck.indexOf(queen), 1); p.hand.push(queen); draw(r, p, cnt - 1); shuf(p.deck); log(r, '👑 ' + p.name + ': นำ รัททาทุย นางพญา จาก Deck ขึ้นมือแทนการจั่ว'); }
    else draw(r, p, cnt);
    const got = p.hand.length - b4; g.dr = { n: ++DRN, who: g.turn, c: got };
    log(r, '— เทิร์น ' + p.name + ' —'); log(r, p.name + ' จั่ว ' + got + ' ใบ');
    (p.lf || []).splice(0).forEach(id => lifeFx(r, g.turn, id));
    startFx456(r);
  };
  g.phase = 'main';
  if (queen) ask(r, g.turn, { yn: true, text: 'รัททาทุย นางพญา: นำการ์ดใบนี้จาก Deck ขึ้นมือแทนการจั่ว 1 ใบ?', cb: y => fin(!!y) }); else fin(false);
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
  if (r.p[i].hand.length > 7) E('มือเกิน 7 ต้องทิ้งก่อน');
  if (!kdSwapList(r).length) return passTurn1(r, i);
  const step = () => { const w = kdSwapList(r)[0]; if (!w) return passTurn1(r, i); kdSwap(r, w.qi, w.a, step); };
  step();
}
function passTurn1(r, i) {
  const g = r.g; g.noReact = null;
  r.p.forEach(q => q.av.forEach(a => { a.tp = 0; a.bp = 0; a.bs = null; })); g.turn = 1 - i; g.n++; endTurn456(r); endTurnFx(r); loki03(r, i); startTurn(r);
}
function act(r, i, m) {
  CR = r; const g = r.g, me = r.p[i], op = r.p[1 - i], mine = g.turn === i; g.inB = 0;
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
      if (m.fin) { if (g.phase === 'dice' || g.phase === 'pick' || g.phase === 'mull') E('ยังจบเทิร์นไม่ได้'); if (me.hand.length > 7) { const need = me.hand.length - 7, us = [...new Set((m.disc || []).map(Number))]; if (us.length === need) { us.forEach(u => { const f = own(u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); }); us.forEach(u => { const f = take(r, u); me.hell.push(f.c); }); log(r, me.name + ' ทิ้ง ' + us.length + ' ใบ (มือเกิน 7)'); passTurn(r, i); } else { g.phase = 'end'; log(r, me.name + ': มือเกิน 7 ต้องทิ้ง ' + need + ' ใบ'); } } else passTurn(r, i); break; }
      if (g.phase === 'main') { g.phase = g.n === 0 ? 'end' : 'battle'; if (g.phase === 'battle') enterBattle03(r); }
      else if (g.phase === 'battle') g.phase = 'end';
      else passTurn(r, i);
      break;
    case 'discard': { const f = own(m.u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); take(r, m.u); me.hell.push(f.c); log(r, me.name + ' ทิ้ง ' + B[f.c.id].n); break; }
    case 'summon': case 'build': {
      mainOnly(); const f = own(m.u), c = B[f.c.id], av = m.t === 'summon';
      if (f.z !== 'hand' || c.t !== (av ? 'Avatar' : 'Construct')) E('ประเภทผิด');
      if (f.c.id === 'SD03-003') E('การ์ดนี้ลงสนามจากบนมือไม่ได้');
      if (!hospOK(r, i, f.c)) E('โรงบาล: เทิร์นนี้อัญเชิญการ์ดชื่อนี้ไม่ได้');
      if (f.c.id === 'BT04-005') E('ยายกบ 1954 อัญเชิญแบบจ่าย Cost ไม่ได้ (สั่งใช้ จากมือ โดยส่ง กบ ลงนรก)');
      if (f.c.id === 'KD02-001') E('เมฟิสโตเฟเลส อัญเชิญได้ด้วยความสามารถของตัวเองเท่านั้น (สั่งใช้ จากมือ)');
      if (av && g.lim && g.lim[i] && symOf(f.c) !== g.lim[i]) E('เทิร์นนี้อัญเชิญได้เฉพาะ Avatar ' + g.lim[i]);
      if (av ? !canPlaceAv(r, i, f.c) : me.co.length >= 3) E(av ? 'Avatar เต็ม' : 'Construct เต็ม 3');
      if (!av && me.co.some(x => B[x.id].n === c.n)) E('Construct ชื่อซ้ำ');
      const ps = pays(); payOK(c, ps, me); ps.forEach(q => { if (B[q.id].n === 'ตุ๊กตารัททาทุย' && !(av && isRat(f.c))) E('ตุ๊กตารัททาทุย ใช้จ่ายได้เฉพาะ Avatar รัททาทุย'); if (q.id === 'KD01-004' && !(av && symOf(f.c) === 'เทพ')) E('พระลักษมี ใช้เป็น Cost ได้เฉพาะ Avatar เทพ'); { const cr3 = COST03[q.id]; if (cr3 && !(av && cr3.ok(f.c))) E(cr3.msg); } });
      ps.forEach(p => { take(r, p.u); me.hell.push(p); }); take(r, m.u); me[av ? 'av' : 'co'].push(f.c); if (av) heroMk(r, i, f.c);
      if (av) { g.q.push(() => costFx(r, i, ps, f.c)); g.q.push(() => fxSummon(r, i, f.c)); } else g.q.push(() => { if (f.c.id === 'SD08-018') summonRat1(r, i); });
      g.q.push(() => fxPaid(r, i, ps, f.c));
      ev(r, c.id); log(r, me.name + (av ? ' อัญเชิญ ' : ' ก่อสร้าง ') + c.n); open(r, { who: 1 - i, k: 'ev', ev: { k: av ? 'summon' : 'build', u: f.c.u, i, cost: c.c, id: c.id } }); break;
    }
    case 'cast': {
      const f = own(m.u), c = B[f.c.id]; if (c.t !== 'Magic') E('ไม่ใช่ Magic');
      const def = MG[c.id] || (c.st === 'Modification' ? { mod: 1 } : {});
      if (!(f.z === 'hand' || (f.z === 'hell' && f.c.mh === g.n && c.st === 'Modification' && !g.used[i].Modification && mine && g.phase === 'main'))) E('ใช้จากโซนนี้ไม่ได้');
      if (c.st === 'React') { if (!reactOK(r, i, c, def)) E('ใช้ React ตอนนี้ไม่ได้'); } else mainOnly();
      const m2 = (g.mod2 && g.mod2.who === i && g.mod2.n === g.n && c.st === 'Modification') ? g.mod2 : null;
      if (m2 && !c.n.startsWith('อาวุธหุ่นนักรบผู้กล้า')) E('ฐานซีทันยาน: เทิร์นนี้ใช้ได้เฉพาะ Modification "อาวุธหุ่นนักรบผู้กล้า"');
      const extra = !!(m2 && g.used[i].Modification && !m2.second);
      if (g.used[i][c.st] && !extra) E(c.st + ' ใช้ได้ 1 ครั้ง/เทิร์น');
      if (extra) m2.second = 1;
      if (!MG[c.id]) log(r, '⚠ ' + c.n + ': ระบบยังไม่รองรับเอฟเฟกต์ — ทำเองตามข้อความการ์ด');
      startCast(r, i, f, c, def, m.tg != null ? Number(m.tg) : null); g.q.push(() => weaponTrig03(r, c)); break;
    }
    case 'pick': {
      const a = g.ask; if (!a) E('ไม่มีให้เลือก');
      if (m.cancel) { if (!a.cancel) E('ยกเลิกไม่ได้'); g.ask = null; a.onCancel && a.onCancel(); break; }
      if (a.choices) { const k = Number(m.i); if (!(k >= 0 && k < a.choices.length)) E('เลือกไม่ถูกต้อง'); g.ask = null; a.cb(k); break; }
      if (a.yn) { g.ask = null; a.cb(!!m.yes); break; }
      const us = [...new Set((m.us || []).map(Number))];
      if (us.length < a.min || us.length > a.n || us.some(u => !a.opts.includes(u))) E('เลือกไม่ถูกต้อง (' + (a.min === a.n ? a.n : a.min + '-' + a.n) + ' ใบ)');
      g.ask = null; a.cb(us); break;
    }
    case 'atk': {
      if (!mine) E('เฉพาะ Battle Phase'); if (g.phase === 'main' && g.n > 0) { g.phase = 'battle'; enterBattle03(r); } if (g.phase !== 'battle') E('เฉพาะ Battle Phase');
      const a = own(m.u); if (a.z !== 'av' || a.c.tired) E('โจมตีไม่ได้');
      if (a.c.nolife && m.tg === 'life') E('Avatar นี้โจมตี LIFE ไม่ได้');
      if (a.c.id === 'BT02-024' && !noFx(r, a.c)) E('เสามงคลโจมตีไม่ได้');
      if (a.c.id === 'BT04-029' && !noFx(r, a.c)) E('เสามงคล ทรงโรมัน โจมตีไม่ได้');
      if (a.c.noatk === g.n) E('Avatar นี้เปลี่ยนการควบคุม สั่งโจมตีไม่ได้ในเทิร์นนี้');
      if (a.c.id === 'BT03-009' && !noFx(r, a.c) && me.hand.length) E('จีสัส โจมตีได้เฉพาะเมื่อไม่มีการ์ดบนมือ');
      if (a.c.id === 'BT02-029' && !(a.c.wr && a.c.wr.length)) E('รถถังต้องมี Avatar สวมใส่ก่อนจึงโจมตีได้');
      if (g.onlyBug && g.onlyBug.n === g.n && g.onlyBug.i === i && !isInsect(r, a.c)) E('เทิร์นนี้โจมตีได้เฉพาะ Avatar {แมลง}');
      if (a.c.id === 'SD04-004' && !(a.c.wr && a.c.wr.length)) E('รถถังต้องมี Avatar สวมใส่ก่อนจึงโจมตีได้');
      if (a.c.id === 'SD06-003' && m.tg === 'life' && !hasCamp(r, i)) E('ทองเหม็นตี LIFE ไม่ได้ ถ้าไม่ได้ควบคุม ค่ายบางระจัน');
      let tk = 'av';
      if (m.tg === 'life') { if (op.av.length && !kick(r, a.c)) E('ต้องกำจัด Avatar ก่อน'); tk = 'life'; }
      else if (op.av.some(x => x.u === m.tg)) tk = 'av';
      else if (op.co.some(x => x.u === m.tg)) tk = 'co';
      else E('ไม่พบเป้าหมาย');
      if (tk === 'av') { const tgt = op.av.find(x => x.u === m.tg); if (tgt && kdUntarget(r, 1 - i, tgt)) E('Avatar นี้ถูกเลือกเป็นเป้าหมายการโจมตีไม่ได้'); }
      const sup = [...new Set((m.sup || []).map(Number))].filter(u => u !== a.c.u).map(u => { const q = own(u);
        if (q.z !== 'av' || q.c.tired || q.c.tk) E('สนับสนุนไม่ได้: ' + nmOf(q.c));
        const e = B[q.c.id].e || '';
        if (!/สามัคคี|แทงหลัง/.test(e) && !hasKw(r, q.c, 'สามัคคี')) E('สามัคคี/แทงหลังไม่ได้: ' + nmOf(q.c));
        if (!/แทงหลัง/.test(e) && op.co.some(x => x.id === 'SD07-020')) E('ด่านเฮาโลก๋วน: ฝ่ายตรงข้ามใช้สามัคคีไม่ได้');
        return q.c; });
      sup.forEach(q => {
        const e = B[q.id].e || '', bs = /แทงหลัง/.test(e);
        const add = P(r, q) + (bs ? 1 : 0); a.c.bp = (a.c.bp || 0) + add; q.tired = true;
        if (bs) { (a.c.bs = a.c.bs || []).push(colOf(q)); if (q.id === 'SD07-006' && colOf(a.c) === 'แดง' && q.ou !== g.n) { q.ou = g.n; q.tired = false; log(r, '✨ ซุนเซ็ก กลับมาตื่น'); } }
        fx({ k: 'buff', u: a.c.u, v: add }); log(r, (bs ? '🗡 ' : '🤝 ') + nmOf(q) + (bs ? ' แทงหลัง +' : ' สามัคคี +') + add);
      });
      if (g.land && g.land.c.id === 'SD02-020' && TRIO.includes(nmOf(a.c))) { a.c.bp = (a.c.bp || 0) + 2; fx({ k: 'buff', u: a.c.u, v: 2 }); log(r, '🏠 สมชายห้องเช่า: POWER +2'); }
      if (g.land && g.land.o === i && g.land.c.id === 'SD08-017' && isRat(a.c)) { a.c.bp = (a.c.bp || 0) + 2; fx({ k: 'buff', u: a.c.u, v: 2 }); log(r, '🏠 พิภพรัททาทุย: POWER +2'); }
      a.c.tired = true; log(r, nmOf(a.c) + ' โจมตี ' + (tk === 'life' ? 'LIFE' : tk === 'co' ? 'Construct' : 'Avatar')); if (!g.atkC || g.atkC.n !== g.n) g.atkC = { n: g.n, c: 0 }; g.atkC.c++;
      if (a.c.id === 'SD06-002' && tk === 'life' && op.av.length) g.q.push(() => ask(r, i, { text: 'เตะไข่: เลือก Avatar ฝ่ายเรา 1 ใบ ทำลาย', opts: me.av.map(x => x.u), cb: us => destroyAv(r, us[0]) }));
      g.q.push(() => fxAtk(r, i, a.c, m.tg, tk));
      g.q.push(() => a.c.id === 'BT02-023' && !noFx(r, a.c) ? chooseTg(r, i, a.c, { who: 1 - i, k: 'atk', ai: i, u: m.u }) : shieldStep(r, { who: 1 - i, k: 'atk', ai: i, u: m.u, tg: m.tg, tk }));
      break;
    }
    case 'use': {
      mainOnly(); let f = find(r, m.u), z;
      if (f && f.i === i) z = f.z; else if (g.land && g.land.o === i && g.land.c.u === m.u) { f = { i, z: 'land', c: g.land.c }; z = 'land'; } else E('ไม่ใช่การ์ดของเรา');
      if (z === 'av' && !m.rg17 && kdUseGate(r, i, f, m)) break;
      if (!hospOK(r, i, f.c)) E('โรงบาล: เทิร์นนี้ใช้สกิลการ์ดชื่อนี้ไม่ได้');
      const ab2 = ABIL[f.c.id];
      if (ab2 && ab2.zone === z) {
        if (ab2.once && f.c.ou === g.n) E('ใช้ได้เทิร์นละครั้ง');
        if (ab2.cond && !ab2.cond(r, i, f.c)) E(ab2.hint || 'เงื่อนไขการใช้ไม่ครบ');
        if (richGuard(r, i, f, m)) break;
        if (ab2.once) f.c.ou = g.n;
        log(r, '⚡ ' + me.name + ' ใช้สกิล ' + nmOf(f.c) + ': ' + (ab2.label || ''));
        ab2.run(r, i, f.c); break;
      }
      const def = AB[f.c.id] || ((f.c.wr || []).some(w => w.id === 'BT02-010') ? AB_R : null); if (!def || def.z !== z) E('การ์ดนี้ไม่มีความสามารถที่สั่งใช้ได้'); if (noFx(r, f.c)) E('ความสามารถถูกยกเลิก');
      if (f.c.us === g.n) E('ใช้ได้เทิร์นละครั้ง'); if (def.can && !def.can(r, i, f.c)) E('เงื่อนไขการใช้ไม่ครบ');
      if (richGuard(r, i, f, m)) break;
      startUse(r, i, f.c, def); break;
    }
    case 'oe': { if (g.phase !== 'dice' || i !== 0) E('ตอนนี้ไม่ได้'); const d = 1 + Math.floor(Math.random() * 6); g.dw = (d % 2 === 1) === (m.v === 'odd') ? 0 : 1; g.dc = { n: ++DCN, d, v: m.v, w: g.dw }; log(r, me.name + ' ทอย ' + d + ' · ' + r.p[g.dw].name + ' ชนะ'); g.phase = 'pick'; break; }
    case 'first': { if (g.phase !== 'pick' || i !== g.dw) E('ไม่ใช่สิทธิ์'); g.turn = m.v ? i : 1 - i; log(r, r.p[g.turn].name + ' เริ่มก่อน'); g.phase = 'mull'; break; }
    case 'pass': { if (!g.pend || g.pend.who !== i) E('ไม่มี React'); passReact(r); break; }
    case 'token': case 'move': case 'pw': case 'tire': case 'drawn': E('คำสั่งนี้ถูกปิด'); break;
    case 'discardm': { const us = [...new Set((m.us || []).map(Number))].slice(0, 20); if (!us.length) E('ยังไม่เลือก'); us.forEach(u => { const f = own(u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); }); us.forEach(u => { const f = take(r, u); me.hell.push(f.c); }); log(r, me.name + ' ทิ้ง ' + us.length + ' ใบ'); if (mine && g.phase === 'end' && me.hand.length <= 7) passTurn(r, i); break; }
    case 'dview': { const n = +m.n | 0, L = (n > 0 ? me.deck.slice(-n) : me.deck.slice()).reverse(); me.ws && me.ws.send(JSON.stringify({ t: 'dv', cards: L.map(c => ({ u: c.u, id: c.kd || c.id })) })); log(r, me.name + ' ดูเด็ค'); break; }
    case 'dmove': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบ'); if (!['hand','hell','av','mg','co'].includes(m.to)) E('โซนผิด'); const [c] = me.deck.splice(k, 1); me[m.to].push(c); log(r, me.name + ' ย้ายจากเด็ค → ' + m.to); if (!me.deck.length && !g.over) { g.over = me.name + ' เด็คหมด'; g.win = 1 - i; } break; }
    case 'dpos': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบ'); const [c] = me.deck.splice(k, 1); m.top ? me.deck.push(c) : me.deck.unshift(c); log(r, me.name + ' วาง' + (m.top ? 'บน' : 'ใต้') + 'เด็ค'); break; }
    case 'dshuf': shuf(me.deck); log(r, me.name + ' สับเด็ค 🔀'); break;
    case 'surrender': { if (g.phase === 'dice' || g.phase === 'pick') E('ยังยอมแพ้ไม่ได้'); g.ask = null; g.pend = null; g.q = []; g.over = me.name + ' ยอมแพ้'; g.win = 1 - i; log(r, '🏳 ' + me.name + ' ยอมแพ้'); break; }
    case 'chat': log(r, '💬 ' + me.name + ': ' + String(m.x || '').slice(0, 200)); break;
    default: E('คำสั่งไม่รู้จัก');
  }
  runQ(r);
}
const canReact = (r, w, c) => { const d = B[c.id]; if (!d || d.t !== 'Magic' || d.st !== 'React') return false; const def = MG[c.id]; if (!def) return true; try { if (!reactOK(r, w, d, def)) return false; if (def.cond && !def.cond(r, w)) return false; const p = r.g.pend, cx = { ev: p && p.ev, pend: p, pick: {}, card: c }; for (const s of (def.steps || [])) if (s.opts(r, w, cx).length < (s.min == null ? (s.n || 1) : s.min)) return false; } catch (e) { return true; } return true; };
const reactList = (r, w) => (!r.g.pend || (r.g.noReact && r.g.noReact.who === w) || r.g.used[w].React) ? [] : r.p[w].hand.filter(c => canReact(r, w, c)).map(c => c.u);
const hasReact = (r, w) => reactList(r, w).length > 0;
const open = (r, p) => { if (r.g.over) return; p.until = Date.now() + (r.cfg.react || 15) * 1000; r.g.pend = p; };
const setBt = (r, o) => { r.g.bt = { n: ++BTN, ...o }; };
function resolveAtk(r, p) {
  const me = r.p[p.ai], op = r.p[1 - p.ai], f = find(r, p.u);
  if (!f || f.i !== p.ai || f.z !== 'av') return log(r, 'การโจมตีถูกยกเลิก');
  const a = f.c, an = nmOf(a);
  if (p.tk === 'av') { const d0 = op.av.find(x => x.u === p.tg); if (d0 && d0.id === 'SD03-002') { mill(r, 1 - p.ai, 2, d0); addTp(d0, 1); log(r, '✨ พ่อจีจ้า POWER +1'); } }
  if (p.tk === 'av') { const d1 = op.av.find(x => x.u === p.tg); if (d1 && d1.id === 'SD05-001') { const n = tiredCnt(r); addTp(d1, n); log(r, '✨ คุณจิระ POWER +' + n); } }
  if (r.g.over) return;
  r.g.inB = 1;
  kdMulti(r, p, a);
  let pa = P(r, a) + bt4AtkBonus(r, a); const base = { ai: p.ai, aid: a.tk ? null : (a.kd || a.id), an, pa };
  const cleanup = () => {
    if (find(r, a.u)) a.bp = 0;
    if (p.sh) { const q = find(r, p.sh); q && (q.c.bp = 0); }
    (p.tmp || []).forEach(t => { const q = find(r, t.u); q && (q.c.tp = (q.c.tp || 0) - t.v); });
    r.g.inB = 0; r.g.noReact = null;
  };
  const doPierce = () => {
    const af = find(r, a.u);
    if (af && af.z === 'av' && a.bs && a.bs.some(c => c !== colOf(a))) {
      log(r, '🗡 แทงหลัง: ' + an + ' ถูกทำลาย (สีขัดกับผู้สนับสนุน)');
      const wasThere = !!af;
      a.bs = null;
      kill(r, p.ai, a.u, 1);
      if (wasThere && !find(r, a.u)) log(r, '🗡 แทงหลัง: ' + an + ' ตาย');
    }
    a.bs = null;
    cleanup(); runQ(r);
  };
  if (p.tg === 'life') {
    if (op.av.length && !kick(r, a)) { r.g.inB = 0; return log(r, 'ตี LIFE ไม่ได้'); }
    log(r, an + ' (' + pa + ') โจมตี LIFE');
    if (pa > 0) { const x = hit(r, op, me); if (x !== 'KO' && !op.av.length) r.g.q.push(() => wall(r, 1 - p.ai)); setBt(r, { ...base, tg: 'life', res: x === 'KO' ? 'ko' : 'life', cid: x === 'KO' ? null : x }); }
    else { log(r, 'Power 0 ไม่เสียหาย'); setBt(r, { ...base, tg: 'life', res: 'zero' }); }
    if (p.tk !== 'av') surviveFx(r, p.ai, a);
    doPierce();
  } else if (p.tk === 'co') {
    const d = op.co.find(x => x.u === p.tg); if (!d) { r.g.inB = 0; return log(r, 'เป้าหาย'); }
    const pd = (B[d.id].p || 0) + (d.pw || 0), dn = B[d.id].n; let res = 'none';
    log(r, an + ' (' + pa + ') โจมตี Construct ' + dn + ' (' + pd + ')');
    if (pa > pd) { take(r, d.u); fx({ k: 'die', u: d.u, id: d.id }); op.hell.push(d); onConDie(r, 1 - p.ai, d); log(r, dn + ' ถูกทำลาย'); res = 'win'; } else log(r, 'Power ไม่เกิน Construct — ไม่มีอะไรเกิดขึ้น');
    setBt(r, { ...base, tg: 'av', dn, did: d.id, pd, res });
    doPierce();
  } else {
    const d = op.av.find(x => x.u === p.tg); if (!d) { r.g.inB = 0; return log(r, 'เป้าหาย'); }
    let pd = P(r, d); const dn = nmOf(d);
    if (hasEq(r, a, 'SD05-017') && d.tired) { addTp(a, 1); addTp(d, -1); pa += 1; pd = Math.max(0, pd - 1); base.pa = pa; log(r, '🔱 ปืนฉมวก: POWER +1 / เป้าหมาย -1'); }
    if (a.id === 'SD08-002') { addPw(d, -1); pd = Math.max(0, pd - 1); log(r, '✨ รัททาทุย พาหะ: ' + dn + ' POWER -1 ถาวร'); }
    if (d.id === 'SD08-002') { addPw(a, -1); pa = Math.max(0, pa - 1); base.pa = pa; log(r, '✨ รัททาทุย พาหะ: ' + an + ' POWER -1 ถาวร'); }
    if (a.id === 'BT03-034' && !noFx(r, a)) { pa += 2; pd = Math.max(0, pd - 2); vfx(a.u, 'aura', 'พาลี +2 / ศัตรู -2', '#22c55e'); log(r, '🐒 พาลี: ' + an + ' +2 / ' + dn + ' -2'); }
    if (d.id === 'BT03-034' && !noFx(r, d)) { pd += 2; pa = Math.max(0, pa - 2); vfx(d.u, 'aura', 'พาลี +2 / ศัตรู -2', '#22c55e'); log(r, '🐒 พาลี: ' + dn + ' +2 / ' + an + ' -2'); }
    if ((a.id === 'BT04-001' && !noFx(r, a)) || (d.id === 'BT04-001' && !noFx(r, d))) { const bp0 = x => x.tk ? (x.tk.p || 0) : (B[x.id].p || 0); pa = bp0(a); pd = bp0(d); vfx((a.id === 'BT04-001' ? a : d).u, 'aura', 'POWER ตั้งต้น', '#ef4444'); log(r, '🦴 จอมหักกระดูก: Avatar ที่ต่อสู้ POWER กลับเป็นค่าตั้งต้น'); }
    [pa, pd] = bt4Swap(r, a, d, pa, pd);
    base.pa = pa;
    log(r, an + ' (' + pa + ') สู้ ' + dn + ' (' + pd + ')');
    let kl = [];
    if (pa === pd) { if (pa > 0) { const ta = hasKw(r, a, 'ลูกฮึด'), td = hasKw(r, d, 'ลูกฮึด'); kl = ta && !td ? [d.u] : td && !ta ? [a.u] : [a.u, d.u]; } else log(r, 'เสมอ (0)'); }
    else kl = pa > pd ? [d.u] : [a.u];
    if (a.kdLose) { delete a.kdLose; if (!kl.includes(a.u)) kl.push(a.u); }
    kl = kl.filter(u => { const m = u === a.u ? a : d, o = u === a.u ? d : a; if (m.id === 'BT03-028' && !noFx(r, m) && costNow(r, o) < costNow(r, m)) { vfx(m.u, 'burst', 'ไม่ถูกทำลาย', '#22c55e'); log(r, '🛡 พระเจ้านิโคไล: ไม่ถูกทำลายจากการต่อสู้กับ Avatar ที่ Cost น้อยกว่า'); return false; } return true; });
    kl = bt4Guard(r, kl, a, d);
    const finish = (rs) => {
      if (rs === 'win') { log(r, dn + ' ตาย'); } else if (rs === 'lose') { log(r, an + ' ตาย'); } else if (rs === 'both') { log(r, 'ตายทั้งคู่'); } else { log(r, 'ไม่มีใครตาย'); }
      afterBattle(r, p, a, d, rs, pa, pd);
      setBt(r, { ...base, tg: 'av', dn, did: d.tk ? null : (d.kd || d.id), pd, res: rs });
      if (p.tk !== 'av' && find(r, a.u)) surviveFx(r, p.ai, a);
      doPierce();
    };
    if (!kl.length) return finish('none');
    // sequential kills to preserve order
    const killSeq = (idx, results) => {
      if (idx >= kl.length) {
        const dead = u => results.some(x => x.u === u);
        const ka = dead(a.u), kd = dead(d.u);
        return finish(ka && kd ? 'both' : kd ? 'win' : ka ? 'lose' : 'none');
      }
      const u = kl[idx];
      const wasThere = !!find(r, u);
      kill(r, u === a.u ? p.ai : 1 - p.ai, u);
      const died = wasThere && !find(r, u);
      results.push({ u, died });
      // if guard triggered ask, next kill will run in queue after answer
      if (r.g.ask) { r.g.q.push(() => killSeq(idx + 1, results)); return; }
      killSeq(idx + 1, results);
    };
    killSeq(0, []);
  }
}
function passReact(r) { CR = r; const p = r.g.pend; r.g.pend = null; if (p && p.k === 'atk') resolveAtk(r, p); runQ(r); }
function begin(r) {
  r.p.forEach(x => { draw({ g: {} }, x, 5); x.t = (r.cfg.clock || 0) * 60000; x.rm = 0; x.dc = null; x.m = false; x.fd = 0; x.ban = null; });
  r.g = { turn: 0, phase: 'dice', pend: null, ask: null, q: [], n: 0, used: [{}, {}], land: null, log: ['เริ่มเกม!'], over: null };
  /* TEMP debug: แสดงใน Log เกม ว่ากุ่ย/ฮอล/นาย อยู่ในเด็ค/มือกี่ใบ */
  r.p.forEach(x => { try { const t = c => ['กุ่ย', 'ฮอล', 'นาย'].includes(B[c.id].n); r.g.log.push('🔎 ตรวจเด็ค ' + x.name + ': เด็ค ' + x.deck.length + ' ใบ · กุ่ย/ฮอล/นาย ในเด็ค ' + x.deck.filter(t).length + ' · ในมือ ' + x.hand.filter(t).length); } catch (e) { } });
}
async function rematch(r, i) {
  r.p[i].rm = 1; r.p.forEach(x => x.bot && (x.rm = 1)); if (!r.rmT) r.rmT = Date.now();
  if (r.p.every(x => x.rm)) {
    for (const x of r.p) { const d = x.bot ? botDeck() : await pickDeck(x.last, x.name, r.cfg.ban); { const y = deckInsts(d); x.deck = y.deck; x.life = y.life; } x.hand = []; x.hell = []; x.av = []; x.mg = []; x.co = []; x.dk = []; x.lf = []; x.noCost = []; }
    r.rmT = 0; if (r.bot) { r.bot.tn = -1; r.bot.fail = 0; } begin(r);
  } else { const o = r.p[1 - i].ws; o && o.readyState === 1 && o.send(JSON.stringify({ t: 'rmq' })); }
  bc(r);
}
const dropRoom = c => { (rooms[c].spec || []).forEach(w => w.readyState === 1 && w.send(JSON.stringify({ t: 'specend' }))); delete rooms[c]; };
let FTK = 0;
setInterval(() => { for (const c in rooms) { const r = rooms[c], g = r.g; if (!g || g.over || !g.pend || g.ask) continue; const w = g.pend.who; if (r.p[w] && r.p[w].bot) continue; try { if (!hasReact(r, w)) { const now = Date.now(); if (!g.pend.fk) g.pend.fk = now + 1500; else if (now >= g.pend.fk) { passReact(r); bc(r); settle(r).catch(() => { }); } } } catch (e) { } } }, 300);   // ไม่มี React: หน่วงคงที่ 1.5 วิ (กันอีกฝ่ายเดาว่ามีการ์ด React)
setInterval(() => {
  const now = Date.now();
  if ((++FTK) % 2 === 0) for (const w of wss.clients) { try { pushFst(w); } catch (e) { } }
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
            ['SD01','SD02','SD03'].forEach(x => giveSt(d, x)); d.stg = ['SD01','SD02','SD03'];
            await dbPut(n, d);
          } else if (!d || d.h !== hash(pw, d.s)) E('ชื่อ/รหัสผิด');
        }
        ws.user = n; ws.fr = new Set(d.fr || []); ws.lastF = null; ws.send(JSON.stringify({ t: 'auth', tok: sign(n), me: prof(n, d) })); rjStatus(ws); return;
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
      if (m.t === 'fstat') { ws.fr = new Set(((await dbGet(ws.user)).fr) || []); pushFst(ws, true); return; }
      if (m.t === 'finv') {
        const t = String(m.name || '').toLowerCase(), code = String(m.room || '').toUpperCase(), d = await dbGet(ws.user), q = rooms[code];
        if (!(d.fr || []).includes(t)) E('ไม่ใช่เพื่อนของคุณ');
        if (!q || q.g || q.p.length >= 2 || !q.p.some(p => p.name === ws.user)) E('ห้องนี้เชิญไม่ได้');
        const tws = userWs(t); if (!tws.length) E('เพื่อนไม่ได้ออนไลน์');
        if (Object.values(rooms).some(x => x.p.some(p => p.name === t && p.ws && p.ws.readyState === 1))) E('เพื่อนอยู่ในห้อง/กำลังแข่งอยู่');
        tws.forEach(w => w.send(JSON.stringify({ t: 'inv', from: ws.user, room: code, at: Date.now() }))); ws.send(JSON.stringify({ note: 'ส่งคำเชิญถึง ' + t + ' แล้ว' })); return;
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
        d.gems -= 1500; d.bought.push(m.set); giveSt(d, m.set); (d.stg = d.stg || []).includes(m.set) || d.stg.push(m.set);
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
        if (!d.decks[nm] && Object.keys(d.decks).length >= 20) E('เด็คเต็ม 20'); const art = {}; Object.entries(m.art || {}).forEach(([i, r]) => { if (cnt[i] && B[i] && (d.cards[i + '|' + r] || 0) > 0) art[i] = String(r); }); const vr = {}, vs = {}; Object.entries(m.vr || {}).forEach(([k, n]) => { const [i, r] = String(k).split('|'); n = n | 0; if (n > 0 && cnt[i] && (d.cards[i + '|' + r] || 0) >= n) { vr[i + '|' + r] = n; vs[i] = (vs[i] || 0) + n; } });
        for (const i in vs) if (vs[i] > cnt[i]) E('จำนวนระดับเกิน');
        for (const i in cnt) if ((vs[i] || 0) < cnt[i]) { const r = art[i] || (B[i].v || ['C'])[0], k = i + '|' + r; vr[k] = (vr[k] || 0) + cnt[i] - (vs[i] || 0); }
        d.decks[nm] = { main, life, art, vr };
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'fadd') {
        const t = String(m.name || '').trim().toLowerCase(); if (t === ws.user) E('เพิ่มตัวเองไม่ได้');
        const o = await dbGet(t), d = await dbGet(ws.user); if (!o) E('ไม่พบผู้ใช้'); if ((d.fr || []).includes(t)) E('เป็นเพื่อนแล้ว');
        o.rq = o.rq || []; if (!o.rq.includes(ws.user)) o.rq.push(ws.user); await dbPut(t, o); me_(d); ws.send(JSON.stringify({ note: 'ส่งคำขอแล้ว' })); pushMe(t, '👫 ' + ws.user + ' ส่งคำขอเป็นเพื่อนมา'); return;
      }
      if (m.t === 'facc') {
        const t = String(m.name), d = await dbGet(ws.user), o = await dbGet(t); d.rq = d.rq || []; if (!o || !d.rq.includes(t)) E('ไม่พบคำขอ');
        d.rq = d.rq.filter(x => x !== t); if (m.ok) { d.fr = [...new Set([...(d.fr || []), t])]; o.fr = [...new Set([...(o.fr || []), ws.user])]; await dbPut(t, o); }
        await dbPut(ws.user, d); me_(d); if (m.ok) { ws.fr = new Set(d.fr || []); pushFst(ws, true); pushMe(t, '👫 ' + ws.user + ' ตอบรับเป็นเพื่อนแล้ว'); } return;
      }
      if (m.t === 'open') {
        const d = await dbGet(ws.user), n = m.n === 10 ? 10 : 1, cost = n === 10 ? 900 : 100;
        if (!SETS.includes(m.set)) E('ไม่มีชุดนี้'); if (d.gems < cost) E('Gem ไม่พอ'); d.gems -= cost;
        const ps = []; for (let k = 0; k < n; k++) { d.pity = (d.pity || 0) + 1; const p = pack(m.set, d.pity >= 50); if (p.some(x => ['UR','SEC','PR','UBR','USEC'].includes(x.r))) d.pity = 0; p.forEach(x => add(d, x)); ps.push(p); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d) })); return;
      }
      if (m.t === 'code') {
        const d = await dbGet(ws.user), c = String(m.c || '').trim().toUpperCase();
        const K = { BOTFANMADE: { gems: 5555 }, SOCOOL: { art: 5 }, AMUJI: { gems: 111111 }, RATEDOWN: { gems: 555 }, ...((await dbGet('sys:codes')) || {}) }, X = K[c]; if (!X) E('โค้ดผิด'); if (d.codes.includes(c)) E('ใช้แล้ว'); d.codes.push(c);
        let ps = []; d.gems += X.gems || 0;
        if (X.art) { const A = []; CARDS.forEach(x => x.v.forEach(r => ['PR','UBR','SEC'].includes(r) && A.push({ id: x.id, r }))); const p = []; for (let k = 0; k < X.art; k++) { const x = pick(A); add(d, x); p.push(x); } for (let k = 0; k < p.length; k += 5) ps.push(p.slice(k, k + 5)); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d), note: X.gems ? 'ได้ ' + X.gems + ' Gem' : '' })); return;
      }
      if (m.t === 'bot') {
        if (rjRoom(ws.user)) E('มีเกมค้างอยู่ กดกลับเข้าเกมก่อน');
        Object.keys(rooms).filter(c => rooms[c].bot && !rooms[c].g && rooms[c].p[0] && rooms[c].p[0].name === ws.user).forEach(c => dropRoom(c));
        const lv = [1, 2, 3].includes(+m.lvl) ? +m.lvl : 2, code = 'BOT' + Math.random().toString(36).slice(2, 6).toUpperCase();
        const mkP = name => ({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], dk: [], life: [], lf: [], noCost: [] });
        r = rooms[code] = { p: [mkP(ws.user), mkP('บอท (' + BOT_LV[lv].n + ')')], g: null, code, exp: Date.now() + 18e5, cfg: { clock: 0, react: 0, ban: true }, bot: { lv, tried: new Set(), at: 0, fail: 0, tn: -1 } };
        i = 0; const bp = r.p[1], bd = botDeck(); bp.bot = 1; bp.eq = {}; bp.deck = shuf(bd.main.map(inst)); bp.life = shuf(bd.life.map(id => ({ ...inst(id), up: 0 })));
        r.p[0].ws = ws; { const ud = await dbGet(ws.user); r.p[0].eq = (ud && ud.eq) || {}; }
        bc(r); return;
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
        p.last = m; { const y = deckInsts(d); p.deck = y.deck; p.life = y.life; } p.hand = [];
        bc(r);
      } else if (m.t === 'rcfg') {
        if (!r || r.g || i !== 0) E('เฉพาะเจ้าห้องตั้งกติกาได้');
        if (m.clock != null) r.cfg.clock = [5, 10, 20].includes(+m.clock) ? +m.clock : 0;
        if (m.react != null) r.cfg.react = [10, 20, 30].includes(+m.react) ? +m.react : 0;
        if (m.ban != null) { const nb = String(m.ban) !== '0'; if (nb !== r.cfg.ban) r.p.forEach(x => { if (!x.bot) x.deck = null; }); r.cfg.ban = nb; }
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
/* ===== คนรวย (BT02-006): ขัดจังหวะ "ความสามารถอัตโนมัติ" ของอีกฝ่ายด้วย =====
   autoGuard คืน true = ขัดจังหวะแล้ว (ถ้าเจ้าของคนรวยปฏิเสธ จะเรียก fn ให้เอง) / false = ไม่เข้าเงื่อนไข ให้ผู้เรียกทำต่อตามปกติ */
const ATK_TRIG = new Set(['SD05-001', 'SD06-003', 'BT02-004', 'BT02-005', 'BT01-001', 'KD01-009', 'BT03-002', 'BT03-018', 'BT04-002']);
function autoGuard(r, o, card, kind, fn) {
  if (!card || card.tk || r.g.ask || r.g.over) return false;
  const rp = r.p[1 - o], a = rp.av.find(x => kdRich(r, 1 - o, x));
  if (!a || !rp.hand.length || a === card || noFx(r, card)) return false;
  if (!(kind instanceof RegExp ? kind.test(B[card.id].e || '') : kind(card))) return false;
  ask(r, 1 - o, { yn: true, text: 'คนรวย: ฝ่ายตรงข้ามจะใช้ความสามารถอัตโนมัติของ ' + nmOf(card) + ' — ให้การ์ดบนมือเรา 1 ใบแก่เขา เพื่อยกเลิกความสามารถนั้น? (เทิร์นนี้เราจะใช้ React Magic ไม่ได้)', cb: y => {
    if (!y) return fn();
    ask(r, 1 - o, { text: 'คนรวย: เลือกการ์ดบนมือเราที่จะให้อีกฝ่าย', opts: rp.hand.map(c => c.u), cb: us => {
      const c = fromZone(r, 1 - o, 'hand', us[0]); if (c) r.p[o].hand.push(c);
      a.rc = r.g.n; r.g.used[1 - o].React = 1; fx({ k: 'say', id: a.id, t: 'ยกเลิกความสามารถ' }); log(r, '💰 คนรวย: ให้การ์ด 1 ใบ ยกเลิกความสามารถอัตโนมัติของ ' + nmOf(card));
    } });
  } });
  return true;
}

/* ===== BT03 ชุด 1 (001-020) ===== */
const vfx = (u, t, txt, c) => fx({ k: 'vfx', u, t, txt, c });
const WEAR_IDOL = ['BT02-010', 'BT03-014'];
const COST03 = {
  'BT03-001': { ok: c => symOf(c) === 'เทพ', msg: 'พระลักษมี ใช้เป็น Cost ได้เฉพาะ Avatar เทพ' },
  'BT03-006': { ok: c => symOf(c) === 'หุ่นยนต์' && colOf(c) === 'แดง', msg: 'ยานเกราะผู้กล้า ใช้เป็น Cost ได้เฉพาะ Avatar หุ่นยนต์สีแดง' },
  'BT03-012': { ok: c => symOf(c) === 'กะปอม', msg: 'อิสานโนซอรัส ใช้เป็น Cost ได้เฉพาะ Avatar กะปอม' },
  'BT03-015': { ok: c => symOf(c) === 'รัททาทุย', msg: 'ตุ๊กตารัททาทุย ใช้เป็น Cost ได้เฉพาะ Avatar รัททาทุย' },
};
function mod03(r, x, f) {
  let v = 0; const p = r.p[f.i];
  if (x.id === 'BT03-003' && !noFx(r, x)) v += r.p.reduce((n, q) => n + q.mg.filter(m => B[m.id].st === 'Modification').length, 0);
  if (x.id === 'BT03-017' && !noFx(r, x)) v += p.av.filter(a => symOf(a) === 'รัททาทุย').length;
  if (symOf(x) === 'กะปอม') v += p.av.filter(a => a.id === 'BT03-013' && !noFx(r, a)).length;
  if (symOf(x) === 'รัททาทุย') v += p.av.filter(a => a.id === 'BT03-016' && a.u !== x.u && !noFx(r, a)).length;
  return v;
}
function fxPaid03(r, i, pc, summoned) {
  const me = r.p[i];
  if (pc.id === 'BT03-001' && isNarai(summoned)) vfx(summoned.u, 'aura', 'พระลักษมี +3', '#fb7185');
  if (pc.id === 'BT03-006') r.g.q.push(() => { draw(r, me, 1); vfx(summoned.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ยานเกราะผู้กล้า: ' + me.name + ' จั่ว 1 ใบ'); });
  if (pc.id === 'BT03-012') r.g.q.push(() => {   // อิสานโนซอรัส: สอดแนม 1 ใบ (+1 ต่อเทอราโนดอน) แต่ละใบเลือกอยู่ที่เดิม/ใต้ Deck
    const n0 = 1 + me.av.filter(x => (CANON[x.id] || x.id) === 'BT04-011' && !noFx(r, x)).length, seenAll = me.deck.slice(-n0).reverse(); if (!seenAll.length) return;
    fx({ k: 'scout', i, ids: seenAll.map(c => c.kd || c.id) }); log(r, '🔎 ' + me.name + ': สอดแนม ' + seenAll.length + ' ใบ (' + seenAll.map(c => B[c.id].n).join(', ') + ')');
    const one = k => { const c = seenAll[k]; if (!c) return; if (!me.deck.includes(c)) return one(k + 1);
      const norm = () => ask(r, i, { yn: true, text: 'อิสานโนซอรัส สอดแนม: ' + B[c.id].n + ' — ไว้ที่เดิมต่อไหม? (ไม่ = ใต้ Deck)', cb: y => { if (!y) { me.deck.splice(me.deck.indexOf(c), 1); me.deck.unshift(c); log(r, '⬇ นำไว้ใต้ Deck'); } one(k + 1); } });
      if (c.id === 'BT03-058' && !r.g.used[i].Land) ask(r, i, { yn: true, text: 'ยุคกาฬสินธุ์โซอิค ถูกสอดแนมจากกะปอม — วางลง Land Magic Zone เลยไหม?', cb: y => { if (y) { me.deck.splice(me.deck.indexOf(c), 1); placeLand03(r, i, c); one(k + 1); } else norm(); } }); else norm(); };
    one(0); });
}
function fxAtk03(r, i, a, tg, tk) {
  if (hasEq(r, a, 'KD03-018')) { a.hold = r.g.n + 2; log(r, '🍲 น้ำซุปชาบู: ' + nmOf(a) + ' จะไม่ตื่นจนจบ End Phase ถัดไปของเรา'); }
  if (hasEq(r, a, 'BT03-055')) { draw(r, r.p[i], 1); vfx(a.u, 'aura', 'ขวานทอง: จั่ว 1', '#fde047'); log(r, '🪓 ขวานทอง: ' + r.p[i].name + ' จั่ว 1 ใบ'); }
  if (hasEq(r, a, 'BT03-056') && tk === 'av') { const d = r.p[1 - i].av.find(x => x.u === tg); if (d) { vfx(a.u, 'shake'); vfx(d.u, 'burst', 'วัชระ!', '#38bdf8'); log(r, '⚡ สายฟ้า วัชระ: ทำลาย ' + nmOf(d)); destroyAv(r, d.u); } }
  if (a.id === 'BT03-002') vfx(a.u, 'aura', 'ศัตรูใช้ React ไม่ได้', '#a78bfa');
  if (a.id === 'BT03-018' && tk === 'av') { const d = r.p[1 - i].av.find(x => x.u === tg);
    if (d && symOf(d) === 'หุ่นยนต์') { vfx(a.u, 'shake'); vfx(d.u, 'burst', 'ทำลายเป้าหมาย', '#ef4444'); log(r, '💥 จ่างู: ทำลาย ' + nmOf(d)); destroyAv(r, d.u); } }
}
function weaponTrig03(r, c) {
  if (c.st !== 'Modification' || !c.n.startsWith('อาวุธหุ่นนักรบผู้กล้า')) return;
  allAv(r).forEach(({ i, x }) => { if (x.id === 'BT03-004' && x.us4 !== r.g.n && !noFx(r, x)) { x.us4 = r.g.n; draw(r, r.p[i], 1); vfx(x.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ไมเกรน: ' + r.p[i].name + ' จั่ว 1 ใบ'); } });
}
function deathFx03(r, f) {
  const c = f.c, g = r.g, p = r.p[f.i];
  if (c.tk) return;
  deathFx04(r, f); bt4Death(r, f);
  if (c.id === 'BT03-020' && c.drac) { delete c.drac; c.rv = { n: g.n }; log(r, '🧛 แดรกคูลา: จะกลับมาในเทิร์นถัดไปของเรา ช่วง Battle Phase'); }
  if (c.id === 'BT03-014') r.g.q.push(() => { draw(r, p, 1); log(r, '✨ โอตะปุส คำสั่งเสีย: ' + p.name + ' จั่ว 1 ใบ'); });
}
function enterBattle03(r) {
  const g = r.g, i = g.turn, p = r.p[i];
  if (g.kdBp && g.kdBp.who === i && g.kdBp.n === g.n) { g.kdBp = null; p.av.forEach(a => { addTp(a, 1); vfx(a.u, 'aura', 'POWER +1', '#fbbf24'); }); log(r, '❤ ไม่นะ ไมเกรน!: Avatar ทุกใบของ ' + p.name + ' POWER +1'); }
  p.hell.filter(c => c.id === 'BT03-020' && c.rv && c.rv.n < g.n).forEach(c => {
    delete c.rv;
    if (summonFree(r, i, c)) { vfx(c.u, 'burst', 'แดรกคูลา กลับมา!', '#7c3aed'); g.q.push(() => fxSummon(r, i, c)); }
  });
}
if (AB['BT02-010']) AB['BT03-014'] = AB['BT02-010'];
Object.assign(SUM, {
  'BT03-003': (r, i, x) => { const me = r.p[i], L = me.deck.filter(c => B[c.id].t === 'Magic' && B[c.id].st === 'Modification').map(c => c.u);
    const fin = u => { if (u != null) { const c = fromZone(r, i, 'deck', u); if (c) { c.at = x.u; me.mg.push(c); vfx(x.u, 'aura', 'สวม ' + B[c.id].n, '#f59e0b'); log(r, '🪖 อินทรีย์แมน สวมใส่ ' + B[c.id].n); } } shuf(me.deck); };
    if (!L.length) return fin(null);
    if (new Set(L.map(u => B[me.deck.find(c => c.u === u).id].n)).size === 1) return fin(L[0]);
    ask(r, i, { text: 'จุติ: เลือก Modification Magic จาก Deck 1 ใบ สวมให้ Avatar ใบนี้', opts: L, cb: us => fin(us[0]) }); },
  'BT03-004': (r, i, x) => scout(r, i, 5, { migSrc: 1, text: 'จุติ: เลือก "อาวุธหุ่นนักรบผู้กล้า" 1 ใบ ขึ้นมือ', pred: c => B[c.id].n.startsWith('อาวุธหุ่นนักรบผู้กล้า'), rest: 'bottom',
    then: c => { if (c) { r.p[i].hand.push(c); vfx(x.u, 'aura', 'ขึ้นมือ', '#38bdf8'); log(r, '✨ นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }),
  'BT03-005': (r, i, x) => { const me = r.p[i], op = r.p[1 - i];
    if (!me.av.some(a => symOf(a) === 'หุ่นยนต์' && nmOf(a).includes('ผู้กล้า'))) return;
    const c = op.deck[op.deck.length - 1]; if (!c) return;
    fx({ k: 'scout', i, ids: [c.kd || c.id] }); op.deck.pop();
    if (isAv(c)) { op.hell.push(c); log(r, '🔎 สอดแนม Deck ศัตรู: ' + B[c.id].n + ' เป็น Avatar → ลงนรก'); vfx(x.u, 'burst', 'ลงนรก', '#ef4444'); if (!op.deck.length) lose(r, 1 - i, 'เด็คหมด'); }
    else { op.deck.unshift(c); log(r, '🔎 สอดแนม Deck ศัตรู: ' + B[c.id].n + ' → ไว้ใต้ Deck'); } },
  'BT03-010': (r, i, x) => { const me = r.p[i], L = me.hell.filter(c => isAv(c) && symOf(c) === 'กะปอม' && B[c.id].c <= 3).map(c => c.u);
    const fin = us => { us.forEach(u => { const c = fromZone(r, i, 'hell', u); c && me.deck.push(c); }); shuf(me.deck); draw(r, me, 1); if (us.length) addTp(x, us.length);
      vfx(x.u, 'aura', 'จั่ว 1' + (us.length ? ' / POWER +' + us.length : ''), '#22c55e'); log(r, '✨ ไดโนกาฬสินธุ์: คืน ' + us.length + ' ใบเข้า Deck แล้วจั่ว 1'); };
    if (!L.length) return fin([]);
    ask(r, i, { text: 'จุติ: เลือก Avatar {กะปอม} Cost ≤3 จากนรก สูงสุด 4 ใบ กลับเข้า Deck', opts: L, n: Math.min(4, L.length), min: 0, cb: fin }); },
  'BT03-011': (r, i, x) => scout(r, i, 5, { by: x, text: 'จุติ: เลือก Avatar {กะปอม} Cost ≤3 อัญเชิญลงสนาม', pred: c => isAv(c) && symOf(c) === 'กะปอม' && B[c.id].c <= 3, rest: 'shuffle',
    then: (c, seen) => { if (c) putAv(r, i, c, { sm: 1 }); land058(r, i, seen); } }),
  'BT03-019': (r, i, x) => { const me = r.p[i], sh = me.av.filter(a => nmOf(a) === 'ศาลพระภูมิ').map(a => a.u);
    if (!sh.length || !me.hell.some(c => isAv(c) && symOf(c) === 'ผี')) return;
    ask(r, i, { text: 'จุติ: เลือก Avatar "ศาลพระภูมิ" ของเรา 1 ใบ ทำลาย เพื่ออัญเชิญ Avatar {ผี} จากนรก (ยกเลิก = ไม่ใช้)', opts: sh, cancel: true,
      cb: us => { destroyAv(r, us[0]); r.g.q.push(() => { const L = me.hell.filter(c => isAv(c) && symOf(c) === 'ผี').map(c => c.u);
        ask(r, i, { text: 'เลือก Avatar {ผี} จากนรก อัญเชิญลงสนาม', opts: L, cb: u2 => { const c = me.hell.find(h => h.u === u2[0]); if (c && summonFree(r, i, c)) vfx(c.u, 'burst', 'อัญเชิญ', '#7c3aed'); } }); }); } }); },
  'BT03-020': (r, i, x) => { x.drac = 1; vfx(x.u, 'aura', 'กลับมาเกิดซ้ำ', '#7c3aed'); log(r, '🧛 แดรกคูลา ได้รับความสามารถกลับมาเกิดซ้ำ'); },
});

/* ===== BT03 ชุด 2 (021-035) ===== */
const isNico = x => isAv(x) && nm2(x).includes('ราชาอาณาจักรของแพง') && nm2(x).includes('นิโคไล');
const isInsect = (r, x) => symOf(x) === 'แมลง' || (x.id === 'BT03-032' && !x.tk && (find(r, x.u) || {}).z === 'av' && !noFx(r, x));
const costNow = (r, x) => { if (x.tk) return 0; const f = find(r, x.u); let c = (B[x.id].c || 0) + (x.cx || 0);
  if (f && f.z === 'av') c -= r.p[1 - f.i].av.filter(a => a.id === 'BT03-029' && !noFx(r, a)).length; c -= r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && m.id === 'BT03-054').length, 0); c += 2 * r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && m.id === 'BT04-055').length, 0); return Math.max(0, c); };
function mod04(r, x, f) {
  let v = 0; const p = r.p[f.i];
  if ((x.wr || []).some(w => w.id === 'BT03-021')) v -= 2;
  if (x.id === 'BT03-029' && !noFx(r, x) && p.av.some(isNico)) v += 2;
  if (r.p.some(q => q.mg.some(m => m.at === x.u && m.id === 'BT04-055')) && costNow(r, x) >= 6) v += 1;   // BT04-055: Cost ≥ 6 → POWER +1
  if (x.id === 'BT03-032' && !noFx(r, x)) v += allAv(r).filter(a => isInsect(r, a.x)).length;
  return v;
}
const dtop03 = (r, p) => { if (!r.p.some(q => q.av.some(a => a.id === 'BT03-025' && !noFx(r, a)))) return null; const c = p.deck[p.deck.length - 1]; return c ? (c.kd || c.id) : null; };
function loki03(r, i) {
  const g = r.g;
  r.p[i].av.filter(a => a.id === 'BT03-023' && !noFx(r, a)).forEach(a => {
    if (!canPlaceAv(r, 1 - i, a)) return log(r, 'Avatar ฝ่ายตรงข้ามเต็ม โลกิย้ายไม่ได้');
    r.p[i].av.splice(r.p[i].av.indexOf(a), 1); r.p[1 - i].av.push(a); a.noatk = g.n;
    vfx(a.u, 'burst', 'โลกิ ย้ายฝั่ง!', '#a855f7'); log(r, '🎭 โลกิ: ย้ายไป Avatar Zone ของ ' + r.p[1 - i].name + ' (โจมตีไม่ได้ในเทิร์นนี้)');
  });
}
function deathFx04(r, f) {
  const c = f.c, p = r.p[f.i], op = r.p[1 - f.i];
  if (c.id === 'BT03-021') r.g.q.push(() => {
    const T = allAvT(r, f.i).filter(u => op.av.some(a => a.u === u)); if (!T.length || !p.hell.includes(c)) return;
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ นำ อีแป๋ม ผีกระสือ ไปสวม (เป็น {ผี} และ POWER -2)', opts: T,
      cb: us => { const t = find(r, us[0]), k = p.hell.indexOf(c); if (!t || k < 0) return; p.hell.splice(k, 1); wearOn(r, f.i, t.c, c); vfx(t.c.u, 'burst', 'ผีกระสือสิง! -2', '#a855f7'); } }); });
  if (c.id === 'BT03-027') r.g.q.push(() => { const T = allAvT(r, f.i).filter(u => costNow(r, find(r, u).c) <= 4);
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือก Avatar ที่ Cost ≤4 บนสนาม 1 ใบ ทำลาย', opts: T, cb: us => { const t = find(r, us[0]); if (t) vfx(t.c.u, 'burst', 'พิษ!', '#84cc16'); destroyAv(r, us[0]); } }); });
  if (c.id === 'BT03-033') r.g.q.push(() => { const L = p.hell.filter(h => isAv(h) && symOf(h) === 'แมลง' && B[h.id].c <= 4 && B[h.id].n !== 'แมลงปอ บรรพบุรุษ').map(h => h.u);
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือก Avatar {แมลง} Cost ≤4 จากนรก อัญเชิญแบบจุติ', opts: L, cb: us => { const h = p.hell.find(x => x.u === us[0]); if (h && summonFree(r, f.i, h)) { vfx(h.u, 'burst', 'อัญเชิญ', '#84cc16'); r.g.q.push(() => fxSummon(r, f.i, h)); } } }); });
}
Object.assign(SUM, {
  'BT03-022': (r, i, x) => { const op = r.p[1 - i], L = op.hell.map(c => c.u); if (!L.length) return;
    ask(r, i, { text: 'จุติ: เลือกการ์ดในนรกของฝ่ายตรงข้าม 1 ใบ กลับเข้าใต้ Deck ของเขา', opts: L, cb: us => {
      const k = op.hell.findIndex(c => c.u === us[0]); if (k < 0) return; const [c] = op.hell.splice(k, 1); op.deck.unshift(c); log(r, '⬇ แม่นาค: นำ ' + B[c.id].n + ' กลับใต้ Deck ฝ่ายตรงข้าม'); vfx(x.u, 'aura', 'ฝังกลับ', '#a855f7');
      const T = allAvT(r, i).filter(u => op.av.some(a => a.u === u)); if (!T.length) return;
      ask(r, i, { text: 'แม่นาค: เลือก Avatar ของอีกฝ่าย 1 ใบ POWER -2 (ถาวร)', opts: T, cb: u2 => { const t = find(r, u2[0]); if (!t) return;
        if (t.c.hero === r.g.n) return log(r, '🛡 ' + nmOf(t.c) + ' ไม่รับผลความสามารถ'); t.c.pw = (t.c.pw || 0) - 2; fx({ k: 'buff', u: t.c.u, v: -2 }); vfx(t.c.u, 'burst', 'POWER -2', '#a855f7'); log(r, '✨ ' + nmOf(t.c) + ' POWER -2'); } }); } }); },
  'BT03-030': (r, i, x) => { const L = r.p[i].av.filter(isNico).map(a => a.u);
    const fin = u => { const t = find(r, u); if (!t) return; t.c.cx = (t.c.cx || 0) + 1; t.c.pw = (t.c.pw || 0) + 1; fx({ k: 'buff', u: t.c.u, v: 1 }); vfx(t.c.u, 'aura', 'Cost +1 / POWER +1', '#22c55e'); log(r, '✨ ' + nmOf(t.c) + ' Cost +1 / POWER +1'); };
    if (!L.length) return; if (L.length === 1) return fin(L[0]);
    ask(r, i, { text: 'จุติ: เลือก พระเจ้านิโคไล 1 ใบ Cost +1 และ POWER +1', opts: L, cb: us => fin(us[0]) }); },
  'BT03-035': (r, i, x) => { const me = r.p[i], L = me.hell.filter(c => isAv(c) && symOf(c) === 'ยักษ์' && (B[c.id].p || 0) <= 3).map(c => c.u);
    ask(r, i, { text: 'จุติ: เลือก Avatar {ยักษ์} POWER ≤3 จากนรก อัญเชิญลงสนาม', opts: L, cb: us => { const c = me.hell.find(h => h.u === us[0]); if (c && summonFree(r, i, c)) vfx(c.u, 'burst', 'อัญเชิญ', '#84cc16'); } }); },
});
Object.assign(AB, {
  'BT03-026': { z: 'av', can: (r, i) => r.p[i].av.some(a => nmHas(a, 'ไอดอล') && (a.wr || []).some(w => B[w.id].n.includes('โอตะ'))),
    steps: [{ key: 't', text: 'เลือก Avatar "ไอดอล" ที่สวม "โอตะ" อยู่ (ทำลายโอตะเป็น Cost)', opts: myAv(a => nmHas(a, 'ไอดอล') && (a.wr || []).some(w => B[w.id].n.includes('โอตะ'))) },
      { key: 'd', text: 'เลือกการ์ดบนสนาม 1 ใบ ทำลาย', opts: (r, i) => [...allAvT(r, i), ...r.p.flatMap(q => q.co.map(c => c.u)), ...r.p.flatMap(q => q.mg.map(m => m.u))] }],
    run: (r, i, cx) => { const h = find(r, cx.pick.t[0]); if (!h) return; const k = h.c.wr.findIndex(w => B[w.id].n.includes('โอตะ')); if (k < 0) return;
      r.p[h.i].hell.push(h.c.wr.splice(k, 1)[0]); vfx(cx.card.u, 'shake', 'แบมบูจัง!', '#f472b6'); log(r, '💥 แบมบูจัง: ทำลายโอตะเป็น Cost'); destroyAny(r, cx.pick.d[0]); } },
  'BT03-031': { z: 'av', can: r => r.p.some(q => q.mg.some(m => B[m.id].st === 'Modification')),
    steps: [{ key: 't', text: 'เลือก Modification Magic บน Magic Zone 1 ใบ ทำลาย', opts: r => r.p.flatMap(q => q.mg.filter(m => B[m.id].st === 'Modification').map(m => m.u)) }],
    run: (r, i, cx) => { vfx(cx.card.u, 'aura', 'ทำลาย Modification', '#84cc16'); destroyAny(r, cx.pick.t[0]); } },
});

/* ===== BT03 ชุด 3 (Magic 041-060) ===== */
function mod05(r, x, f) {
  let v = modKD(r, x, f);
  if (hasEq(r, x, 'BT03-051')) v += nmOf(x).includes('หุ่นนักรบผู้กล้า') ? 3 : 1;
  if (hasEq(r, x, 'BT03-052')) v -= 2;
  if (!x.tk && nmOf(x).includes('แดรกคูลา') && landIs(r, 'BT03-060')) v += 1;
  return v;
}
function neg053(r, x) {
  if (!hasEq(r, x, 'BT03-053')) return 0;
  return Math.min(0, x.pw || 0) + Math.min(0, x.tp || 0) + Math.min(0, x.bp || 0) + ((x.wr || []).some(w => w.id === 'BT03-021') ? -2 : 0) + (hasEq(r, x, 'BT03-052') ? -2 : 0);
}
function chk052(r) {
  if (r.g.ask || r.g.over) return;
  r.p.forEach(q => q.mg.filter(m => m.id === 'BT03-052' && m.at != null).forEach(m => {
    const h = find(r, m.at); if (h && h.z === 'av' && P(r, h.c) === 0) { vfx(h.c.u, 'burst', 'แกงส้มตะปูเสียบ!', '#ef4444'); log(r, '💥 แผนการ: แกงส้มตะปูเสียบ — ' + nmOf(h.c) + ' POWER 0 ถูกทำลาย'); destroyAv(r, h.c.u); } }));
}
function placeLand03(r, i, card) {
  const g = r.g; if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: card, o: i }; g.used[i].Land = 1; ev(r, card.id);
  fx({ k: 'say', id: card.id, t: 'วางลง Land Zone' }); log(r, '🌋 ' + r.p[i].name + ': วาง ' + B[card.id].n + ' ลง Land Magic Zone (จากการสอดแนม)');
}
function land058(r, i, seen) {
  const l = (seen || []).find(x => x.id === 'BT03-058' && r.p[i].deck.includes(x)); if (!l || r.g.used[i].Land) return;
  ask(r, i, { yn: true, text: 'ยุคกาฬสินธุ์โซอิค ถูกสอดแนมจากกะปอม — วางลง Land Magic Zone เลยไหม?', cb: y => { if (!y) return; const k = r.p[i].deck.indexOf(l); if (k < 0) return; r.p[i].deck.splice(k, 1); placeLand03(r, i, l); } });
}
const SYMS03 = () => [...new Set(CARDS.filter(c => c.t === 'Avatar' && c.s).map(c => c.s))];
const handOpts = (r, i, cx) => r.p[i].hand.filter(h => h.u !== cx.card.u).map(h => h.u);
Object.assign(MG, {
  'BT03-041': { cond: r => !!r.g.land, steps: [{ key: 'c', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: handOpts }], run: (r, i) => { draw(r, r.p[i], 2); fx({ k: 'say', id: 'BT03-041', t: 'จั่ว 2' }); log(r, '✨ เก็บค่าคุ้มครอง: ' + r.p[i].name + ' จั่ว 2 ใบ'); } },
  'BT03-042': { cond: (r, i) => r.p[i].av.some(a => nmHas(a, 'ไอดอล')), run: (r, i) => tutor(r, i, c => isAv(c) && B[c.id].n.includes('โอตะ'), 'Avatar โอตะ') },
  'BT03-043': { run: (r, i) => { const S = SYMS03();
    ask(r, i, { text: 'ผมขอค้าน!!: เลือก Symbol ของ Avatar', choices: S, cb: k => { const sym = S[k], op = r.p[1 - i]; fx({ k: 'say', id: 'BT03-043', t: 'ประกาศ ' + sym });
      if (!op.hand.length) return log(r, 'ศัตรูไม่มีการ์ดบนมือ'); const c = rnd(op.hand); log(r, '🎯 ผมขอค้าน!! ประกาศ {' + sym + '} — สุ่มได้ ' + B[c.id].n);
      if (isAv(c) && symOf(c) === sym) { sendHell(r, c.u); log(r, '🗑 ' + B[c.id].n + ' ถูกทิ้งลงนรก'); } } }); } },
  'BT03-044': { cond: (r, i) => r.p[i].av.some(a => symOf(a) === 'คน' && costNow(r, a) >= 3),
    run: (r, i) => { const me = r.p[i], L = me.deck.filter(c => isAv(c) && symOf(c) === 'ผี' && B[c.id].c <= 4).map(c => c.u);
      const done = u => { const c = fromZone(r, i, 'deck', u); if (c) putAv(r, i, c, { sm: 1 }); shuf(me.deck); };
      if (!L.length) { log(r, '✨ ค้น Deck ไม่พบ Avatar {ผี}'); return shuf(me.deck); }
      ask(r, i, { text: 'เยี่ยวรดศาล: เลือก Avatar {ผี} Cost ≤4 จาก Deck อัญเชิญแบบจุติ', opts: L, cb: us => done(us[0]) }); } },
  'BT03-045': { steps: [{ key: 't', text: 'เลือก Avatar {สัตว์} 1 ใบ POWER +6 (ถูกทำลายตอน End Phase)', opts: (r, i) => allAvT(r, i).filter(u => symOf(find(r, u).c) === 'สัตว์') }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { addTp(t.c, 6); t.c.endDie = 1; vfx(t.c.u, 'aura', 'POWER +6', '#f97316'); log(r, '🍖 ซุปเปอร์สแน็ค: ' + nmOf(t.c) + ' POWER +6 (ตายตอน End Phase)'); } } },
  'BT03-046': { run: (r, i) => { const back = (w, cb) => { const L = r.p[w].av.map(a => a.u); if (!L.length) return cb();
      ask(r, w, { text: 'จมน้ำ: เลือก Avatar ของเรา 1 ใบ กลับเข้าใต้ Deck', opts: L, cb: us => { const f = take(r, us[0]); fx({ k: 'bounce', u: us[0] }); if (!f.c.tk) { f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; r.p[f.i].deck.unshift(f.c); } log(r, '🌊 จมน้ำ: ' + nmOf(f.c) + ' กลับใต้ Deck'); cb(); } }); };
    back(i, () => back(1 - i, () => { })); } },
  'BT03-047': { react: 'summon', run: (r, i, cx) => { const t = find(r, cx.ev.u); if (t && t.z === 'av') { t.c.tired = true; vfx(t.c.u, 'aura', 'ยังไม่พร้อม', '#94a3b8'); log(r, '😴 ไม่เจ้ายังไม่พร้อม: ' + nmOf(t.c) + ' เปลี่ยนเป็นสภาพนอน'); } } },
  'BT03-048': { steps: [{ key: 'c', text: 'เลือกการ์ดบนมือ 1 ใบ นำกลับเข้า Deck แล้วสับ', opts: handOpts },
      { key: 't', text: 'เลือก Avatar {แมลง} ของศัตรู 1 ใบ ทำลาย', opts: (r, i) => allAvT(r, i).filter(u => { const f = find(r, u); return f.i !== i && isInsect(r, f.c); }) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hand', cx.pick.c[0]); if (c) { r.p[i].deck.push(c); shuf(r.p[i].deck); } const t = find(r, cx.pick.t[0]); if (t) vfx(t.c.u, 'burst', 'ตบ!', '#84cc16'); destroyAv(r, cx.pick.t[0]); } },
  'BT03-049': { react: 'atkAv', steps: [{ key: 'm', text: 'เลือก Modification Magic จากนรกฝ่ายเรา 1 ใบ ขึ้นมือ', opts: (r, i) => r.p[i].hell.filter(c => B[c.id].t === 'Magic' && B[c.id].st === 'Modification').map(c => c.u) }],
    run: (r, i, cx) => { const k = r.p[i].hell.findIndex(c => c.u === cx.pick.m[0]); if (k >= 0) r.p[i].hand.push(...r.p[i].hell.splice(k, 1)); const a = find(r, cx.pend.u);
      if (a && a.z === 'av') { addTp(a.c, -1); vfx(a.c.u, 'burst', 'POWER -1', '#ef4444'); } log(r, '🔫 คว้าปืนมายิงหมี: นำ Modification ขึ้นมือ / ผู้โจมตี POWER -1'); } },
  'BT03-050': { react: 'atk', run: (r, i, cx) => { const pend = cx.pend;
    scout(r, i, 2, { text: 'งับ: เลือก Avatar {กะปอม} 1 ใบจากที่สอดแนม ขึ้นมือ', pred: c => isAv(c) && symOf(c) === 'กะปอม', rest: 'shuffle',
      then: c => { if (!c) return; r.p[i].hand.push(c); const a = find(r, pend.u); if (a && a.z === 'av') { pend.cancel = 1; vfx(a.c.u, 'burst', 'งับ!', '#ef4444'); log(r, '🦖 งับ: ทำลาย ' + nmOf(a.c) + ' ที่สั่งโจมตีอยู่'); destroyAv(r, a.c.u); } } }); } },
  'BT03-051': { mod: 1, tgf: a => symOf(a) === 'หุ่นยนต์' },
  'BT03-052': { mod: 1 }, 'BT03-053': { mod: 1 }, 'BT03-054': { mod: 1 }, 'BT03-055': { mod: 1 }, 'BT03-056': { mod: 1 },
  'BT03-057': {}, 'BT03-058': {}, 'BT03-059': {}, 'BT03-060': {},
});
Object.assign(AB, {
  'BT03-057': { z: 'land', can: (r, i) => r.p[1 - i].av.reduce((s, a) => s + costNow(r, a), 0) <= 4 && r.p[i].hand.length > 0,
    steps: [{ key: 'c', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(h => h.u) }],
    run: (r, i) => { fx({ k: 'say', id: 'BT03-057', t: 'นำนิโคไลขึ้นมือ' }); tutor(r, i, c => isNico(c), 'ราชาอาณาจักรของแพง พระเจ้านิโคไล'); } },
  'BT03-058': { z: 'land', can: (r, i) => r.p[i].hand.reduce((s, h) => s + (B[h.id].g || 0), 0) >= 3,
    run: (r, i, cx) => { const p = r.p[i];
      const go = () => { const L = p.hand.filter(h => B[h.id].g).map(h => h.u);
        ask(r, i, { text: 'ยุคกาฬสินธุ์โซอิค: เลือกการ์ดบนมือที่จะทิ้ง ให้ Gem รวมกัน ≥3', opts: L, n: Math.min(L.length, 6), min: 1, cancel: true, onCancel: () => { delete cx.card.us; },
          cb: us => { const sum = us.reduce((s, u) => s + (B[p.hand.find(h => h.u === u).id].g || 0), 0); if (sum < 3) { log(r, 'Gem รวมไม่ถึง 3 — เลือกใหม่'); return go(); }
            us.forEach(u => sendHell(r, u)); fx({ k: 'say', id: 'BT03-058', t: 'สอดแนม 5 ใบ' });
            scout(r, i, 5, { text: 'เลือก Avatar {กะปอม} 1 ใบ ขึ้นมือ (Cost ≤3 อัญเชิญแทนได้)', pred: c => isAv(c) && symOf(c) === 'กะปอม', rest: 'shuffle',
              then: c => { if (!c) return; const fin = sm => { if (sm) putAv(r, i, c, { sm: 1 }); else { p.hand.push(c); log(r, '✨ นำ ' + B[c.id].n + ' ขึ้นมือ'); } };
                if (B[c.id].c <= 3 && canPlaceAv(r, i, c)) ask(r, i, { yn: true, text: B[c.id].n + ' Cost ≤3 — อัญเชิญลงสนามแทนการขึ้นมือไหม?', cb: y => fin(y) }); else fin(false); } }); } }); };
      go(); } },
  'BT03-059': { z: 'land', steps: [{ key: 't', text: 'เลือก Avatar 1 ใบ ได้รับ สามัคคี จนจบเทิร์น', opts: (r, i) => allAvT(r, i) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { t.c.sg3 = r.g.n; vfx(t.c.u, 'aura', 'สามัคคี', '#38bdf8'); log(r, '🤝 ราชธานีสามัคคี: ' + nmOf(t.c) + ' ได้รับสามัคคี'); } } },
  'BT03-060': { z: 'land', can: (r, i) => r.p[i].hand.length > 0 && r.p[i].hell.some(c => isAv(c) && B[c.id].n.includes('แดรกคูลา')),
    steps: [{ key: 'c', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(h => h.u) },
      { key: 'd', text: 'เลือก แดรกคูลา จากนรกฝ่ายเรา อัญเชิญลงสนาม', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && B[c.id].n.includes('แดรกคูลา')).map(c => c.u) }],
    run: (r, i, cx) => { const c = r.p[i].hell.find(h => h.u === cx.pick.d[0]); if (c && summonFree(r, i, c)) { vfx(c.u, 'burst', 'ปราสาทแดรก', '#7c3aed'); log(r, '🏰 ปราสาทแดรก: อัญเชิญ ' + nmOf(c)); } } },
});

function fxSummon(r, i, x) { if (noFx(r, x)) return; if (autoGuard(r, i, x, /จุติ/, () => fxSummon0(r, i, x))) return; fxSummon0(r, i, x); }
function deathFx(r, f, nf) { if (!nf && autoGuard(r, f.i, f.c, /คำสั่งเสีย/, () => deathFx0(r, f, nf))) return; deathFx0(r, f, nf); }
function fxAtk(r, i, a, tg, tk) { if (noFx(r, a)) return; if (autoGuard(r, i, a, c => ATK_TRIG.has(c.id), () => fxAtk0(r, i, a, tg, tk))) return; fxAtk0(r, i, a, tg, tk); }

/* ===== [BT01/BT02 เก็บสกิลที่ขาด] ===== */
function heroMk(r, i, c) { if (r.p[i].hero === r.g.n && symOf(c) === 'เปรต') c.hero = r.g.n; }
// อู๊ดลูกเสือ: เมื่อถูกโจมตี เซ่นไหว้ Avatar ใบอื่น 1 ใบ เพื่อยกเลิกการโจมตี
function open1(r, p) {
  const d = r.p[p.who], t = p.tk === 'av' ? d.av.find(x => x.u === p.tg) : null;
  if (t && t.id === 'BT01-005' && !noFx(r, t) && d.av.some(x => x.u !== t.u)) {
    ask(r, p.who, { yn: true, hint: { u: p.u, tg: p.tg }, text: 'อู๊ดลูกเสือ: เซ่นไหว้ Avatar ใบอื่น 1 ใบ เพื่อยกเลิกการโจมตีนี้?', cb: y => {
      if (!y) return open(r, p);
      const L = d.av.filter(x => x.u !== t.u).map(x => x.u); if (!L.length) return open(r, p);
      ask(r, p.who, { text: 'อู๊ดลูกเสือ: เลือก Avatar ใบอื่นที่จะเซ่นไหว้', opts: L, cb: us => { sac(r, us[0]); fx({ k: 'say', id: t.id, t: 'ยกเลิกการโจมตี' }); log(r, '🛡 อู๊ดลูกเสือ: ยกเลิกการโจมตี'); } });
    } });
    return;
  }
  open(r, p);
}
// คนรวย: เมื่ออีกฝ่ายสั่งใช้ความสามารถ ให้การ์ด 1 ใบเพื่อยกเลิก (เทิร์นละครั้ง) แล้วเราใช้ React ไม่ได้ในเทิร์นนี้
function richGuard(r, i, f, m) {
  if (m.rj) return false;
  const o = r.p[1 - i], a = o.av.find(x => kdRich(r, 1 - i, x));
  if (!a || !o.hand.length || a === f.c) return false;
  ask(r, 1 - i, { yn: true, text: 'คนรวย: ฝ่ายตรงข้ามใช้ความสามารถของ ' + nmOf(f.c) + ' — ให้การ์ดบนมือเรา 1 ใบแก่เขา เพื่อยกเลิกความสามารถนั้น? (เทิร์นนี้เราจะใช้ React Magic ไม่ได้)', cb: y => {
    if (!y) return act(r, i, { ...m, rj: 1 });
    ask(r, 1 - i, { text: 'คนรวย: เลือกการ์ดบนมือเราที่จะให้อีกฝ่าย', opts: o.hand.map(c => c.u), cb: us => {
      const c = fromZone(r, 1 - i, 'hand', us[0]); if (c) r.p[i].hand.push(c);
      a.rc = r.g.n; r.g.used[1 - i].React = 1; f.c.us = r.g.n; f.c.ou = r.g.n;
      fx({ k: 'say', id: a.id, t: 'ยกเลิกความสามารถ' }); log(r, '💰 คนรวย: ให้การ์ด 1 ใบ ยกเลิกความสามารถของ ' + nmOf(f.c));
    } });
  } });
  return true;
}
Object.assign(MG, {
  // ช่วยโลกใบนี้ไว้: หงาย LIFE เราทุกใบ -> เทิร์นนี้ Avatar {เปรต} ที่อัญเชิญ ไม่รับผลการ์ดอื่น + เตะไข่ (โล่มนุษย์ใช้ไม่ได้)
  'BT02-041': { run: (r, i) => { const p = r.p[i]; p.life.forEach(l => { l.up = 1; }); p.hero = r.g.n; fx({ k: 'say', id: 'BT02-041', t: 'หงาย LIFE ทุกใบ' }); log(r, '🙏 ช่วยโลกใบนี้ไว้: หงาย LIFE ทุกใบ — Avatar {เปรต} ที่อัญเชิญเทิร์นนี้ได้รับเตะไข่ และไม่รับผลความสามารถ'); } },
  // เคี้ยวเพื่อนเธอซะ: เซ่นไหว้ Avatar กี่ใบก็ได้ แล้วอัญเชิญ Avatar จากมือตามค่า GEM รวมที่ได้ (นับเป็นงบ Cost)
  'BT02-050': { react: 'summon', steps: [{ key: 's', n: 9, min: 1, text: 'เซ่นไหว้ Avatar ฝ่ายเรากี่ใบก็ได้ (ได้ค่า GEM รวมไว้อัญเชิญ Avatar จากมือ)', opts: (r, i) => r.p[i].av.map(a => a.u) }],
    run: (r, i, cx) => {
      const p = r.p[i]; let gem = 0;
      (cx.pick.s || []).forEach(u => { const f = find(r, u); if (f && f.z === 'av') { gem += B[f.c.id].g || 0; sac(r, u); } });
      log(r, '🦷 เคี้ยวเพื่อนเธอซะ: ได้ GEM รวม ' + gem);
      const step = () => { const L = p.hand.filter(c => isAv(c) && B[c.id].c <= gem && canPlaceAv(r, i, c)).map(c => c.u); if (!L.length) return;
        ask(r, i, { text: 'เลือก Avatar จากมือ อัญเชิญ (GEM คงเหลือ ' + gem + ') — ไม่เลือก = จบ', opts: L, n: 1, min: 0, cb: us => { if (!us.length) return; const c = p.hand.find(x => x.u === us[0]); if (!c) return; gem -= B[c.id].c; if (summonAny(r, i, c.u, 'hand')) r.g.q.push(() => fxSummon(r, i, c)); step(); } }); };
      r.g.q.push(step);
    } },
  'BT02-060': {},   // Land: เปลี่ยน Symbol ทุก Avatar เป็น {เทพ} (ทำใน symOf) + สกิลสั่งใช้ใน AB
});
AB['BT02-060'] = { z: 'land', can: (r, i) => r.p[i].hand.length > 0 && r.p[1 - i].av.some(a => a.tired && !a.tk && B[a.id].c <= 3),
  steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ด 1 ใบจากบนมือ', opts: (r, i) => r.p[i].hand.map(c => c.u) },
    { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม (Cost ไม่เกิน 3, สภาพนอน) ยึดมาจนจบเทิร์น', opts: (r, i) => r.p[1 - i].av.filter(a => a.tired && !a.tk && B[a.id].c <= 3).map(a => a.u) }],
  run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t && stealCard(r, i, t.c.u)) { t.c.ctl = r.g.n; log(r, '🏛 แอสการ์ด: ยึด ' + nmOf(t.c) + ' จนจบเทิร์น'); } } };

/* ===== KD01 อวาตาร์ลงทัณฑ์ (เทพ / พระนารายณ์) ===== */
const isNarai = x => isAv(x) && (nm2(x).includes('พระนารายณ์') || x.id === 'KD01-009' || x.id === 'BT03-002');   // KD01-009 นับเป็นชื่อ "พระนารายณ์"
const KD_NARAI = ['KD01-001', 'KD01-002', 'KD01-003'];
const onAv = (r, u) => { const f = find(r, u); return !!(f && f.z === 'av'); };
const costOf = x => x.tk ? 0 : (B[x.id].c || 0);
// เนรเทศ: ย้าย Avatar ออกจากเกม (โซน dk)
function exileAv(r, u) {
  const f = find(r, u); if (!f || f.z !== 'av') return;
  if (f.c.hero === r.g.n && !r.g.inB) return log(r, '🛡 ' + nmOf(f.c) + ' ไม่รับผลความสามารถ');
  fx({ k: 'exile', u, id: f.c.tk ? null : (f.c.kd || f.c.id), nm: f.c.tk ? f.c.tk.n : null });
  take(r, u); if (!f.c.tk) r.p[f.i].dk.push(f.c);
  log(r, '🌀 เนรเทศ ' + nmOf(f.c));
}
// หลังจบการต่อสู้ที่ Avatar "พระนารายณ์" ทำลาย Avatar อีกฝ่าย → เปิดให้ใช้ KD01-001/002/003 จากมือ
function kdAfter(r, p, a, d, res) {
  const w = [];
  if ((res === 'win' || res === 'both') && isNarai(a)) w.push(p.ai);
  if ((res === 'lose' || res === 'both') && isNarai(d)) w.push(1 - p.ai);
  w.forEach(i => r.g.q.push(() => kdNarai(r, i)));
  const ws = [];
  if (res === 'win' || res === 'both') ws.push([p.ai, a]);
  if (res === 'lose' || res === 'both') ws.push([1 - p.ai, d]);
  ws.forEach(([wi, c]) => {
    if (c.crit === r.g.n) r.g.q.push(() => { if (r.g.over) return; vfx(c.u, 'burst', 'คริติคอล! LIFE -1', '#ef4444'); log(r, '💥 ' + nmOf(c) + ': ทำความเสียหายต่อ LIFE ฝ่ายตรงข้าม 1 ครั้ง'); hit(r, r.p[1 - wi], r.p[wi]); });
    if (c.id === 'KD04-004') r.g.q.push(() => kdProto(r, wi, c));
  });
}
function kdNarai(r, i) {
  const g = r.g, p = r.p[i];
  const cs = p.hand.filter(c => KD_NARAI.includes(c.id) && !(g.used[i] && g.used[i]['kd' + c.id]));
  if (!cs.length || !p.av.some(isNarai)) return;
  ask(r, i, { text: 'สั่งใช้จากมือ: เลือกการ์ด เทพผดุงธรรม/ร่างอวตาร เพื่ออัญเชิญโดยส่ง Avatar "พระนารายณ์" 1 ใบลงนรก (ไม่เลือก = ไม่ใช้)', opts: cs.map(c => c.u), n: 1, min: 0, cb: us => {
    if (!us.length) return;
    const c = p.hand.find(h => h.u === us[0]); if (!c) return;
    const go = tu => {
      const h = p.hand.find(x => x.u === c.u); if (!h || !onAv(r, tu)) return;
      if (c.id !== 'KD01-001') { g.used[i] = g.used[i] || {}; g.used[i]['kd' + c.id] = 1; }
      fx({ k: 'say', id: c.id, t: 'อวตาร!' });
      sendHell(r, tu); if (onAv(r, tu)) return log(r, 'ส่ง Avatar ลงนรกไม่ได้ ยกเลิกการอัญเชิญ');
      const hc = fromZone(r, i, 'hand', c.u); if (!hc) return;
      if (!putAv(r, i, hc, {})) return;
      kdNaraiFx(r, i, hc);
    };
    const L = p.av.filter(isNarai).map(a => a.u);
    if (L.length === 1) return go(L[0]);
    ask(r, i, { text: 'เลือก Avatar "พระนารายณ์" ของเราที่จะส่งลงนรก', opts: L, cb: u2 => go(u2[0]) });
  } });
}
function kdNaraiFx(r, i, c) {
  const p = r.p[i], op = r.p[1 - i];
  if (c.id === 'KD01-001') {
    const seen = p.deck.splice(-2).reverse(); seen.length && fx({ k: 'scout', i, ids: seen.map(x => x.kd || x.id) });
    p.hand.push(...seen); const sum = seen.reduce((t, x) => t + costOf(x), 0);
    log(r, '🔎 สอดแนม ' + seen.length + ' ใบขึ้นมือ (' + seen.map(x => B[x.id].n).join(', ') + ') ผลรวม Cost ' + sum);
    if (!p.deck.length) return lose(r, i, 'เด็คหมด');
    const L = op.av.filter(x => !protectedFrom(r, i, x) && costOf(x) <= sum).map(x => x.u);
    ask(r, i, { text: 'เนรเทศ Avatar ฝ่ายตรงข้าม 1 ใบ ที่ Cost ≤ ' + sum, opts: L, cb: us => exileAv(r, us[0]) });
  } else if (c.id === 'KD01-002') {
    c.kdSwap = r.g.n;
    const L = op.av.filter(x => !protectedFrom(r, i, x) && costOf(x) <= 4).map(x => x.u);
    ask(r, i, { text: 'ทำลาย Avatar ฝ่ายตรงข้าม 1 ใบ ที่ Cost ไม่เกิน 4', opts: L, cb: us => destroyAv(r, us[0]) });
  } else if (c.id === 'KD01-003') {
    c.kdSwap = r.g.n;
    const L = p.av.filter(a => symOf(a) === 'เทพ' && a.tired && !(a.hold && a.hold >= r.g.n)).map(a => a.u);
    ask(r, i, { text: 'เลือก Avatar {เทพ} ของเราที่อยู่ในสภาพนอน เปลี่ยนเป็นสภาพตื่น', opts: L, cb: us => { const t = find(r, us[0]); if (t) { t.c.tired = false; fx({ k: 'summon', u: t.c.u }); log(r, '☀ ' + nmOf(t.c) + ' กลับเป็นสภาพตื่น'); } } });
  }
}
// End Phase: ส่ง 002/003 ลงนรก แล้วอัญเชิญ Avatar "พระนารายณ์" ชื่ออื่นจากนรก
const kdSwapList = r => { const o = []; r.p.forEach((q, qi) => q.av.forEach(a => { if (a.kdSwap === r.g.n || (a.id === 'KD03-001' && qi === r.g.turn)) o.push({ qi, a }); })); return o; };
function kdSwap(r, qi, a, done) {
  if (a.id === 'KD03-001') return kdIdolEnd(r, qi, a, done);
  delete a.kdSwap; const p = r.p[qi], nm = B[a.id].n;
  log(r, '🔄 End Phase: ' + nm + ' ลงนรก แล้วอัญเชิญ "พระนารายณ์" ชื่ออื่นจากนรก');
  sendHell(r, a.u); if (onAv(r, a.u)) return done();
  const L = p.hell.filter(c => isNarai(c) && B[c.id].n !== nm).map(c => c.u);
  if (!L.length) { log(r, 'ไม่มี Avatar "พระนารายณ์" ชื่ออื่นในนรก'); return done(); }
  const go = u => { const c = p.hell.find(h => h.u === u); c && summonFree(r, qi, c); done(); };
  if (L.length === 1) return go(L[0]);
  ask(r, qi, { text: 'End Phase: เลือก Avatar "พระนารายณ์" ชื่ออื่น จากนรก อัญเชิญลง Avatar Zone', opts: L, cb: us => go(us[0]) });
}
// LIFE การ์ดชุด KD
function kdLife(r, i, id) {
  const c = B[id], p = r.p[i]; if (!c || !/^KD0[1-4]-02[1-5]$/.test(id)) return false;
  const lab = '❤ ' + c.n + ': ', toHand = (z, pred, text) => ask(r, i, { text: lab + text, opts: p[z].filter(pred).map(x => x.u), cb: us => { const h = fromZone(r, i, z, us[0]); if (h) { p.hand.push(h); log(r, '❤ นำ ' + B[h.id].n + ' ขึ้นมือ'); } } });
  if (['KD01-025', 'KD02-022', 'KD03-025'].includes(id)) { toHand('hell', x => isAv(x) && (B[x.id].g || 0) >= 3, 'เลือก Avatar ที่มี GEM 3 หรือมากกว่า จากนรก ขึ้นมือ'); return true; }
  if (id === 'KD04-022') { r.g.kdBp = { who: i, n: r.g.n }; log(r, '❤ ' + c.n + ': Battle Phase ถัดไป Avatar ทุกใบของเรา POWER +1'); return true; }
  if (id === 'KD02-023' || id === 'KD03-021' || id === 'KD04-021') { scout(r, i, 5, { text: lab + 'เลือก Avatar 1 ใบ จากที่สอดแนม ขึ้นมือ', pred: x => isAv(x), rest: 'bottom', then: x => x && p.hand.push(x) }); return true; }
  if (id === 'KD02-024' || id === 'KD03-022') { toHand('hell', x => !x.tk && B[x.id].t === 'Magic' && B[x.id].st === 'Normal', 'เลือก Normal Magic จากนรก ขึ้นมือ'); return true; }
  return false;
}
Object.assign(SUM, {
  'KD01-007': (r, i) => scout(r, i, 3, { text: 'จุติ: เลือกการ์ด {Symbol เทพ} 1 ใบ จากที่สอดแนม ขึ้นมือ', pred: c => B[c.id].s === 'เทพ', rest: 'bottom', then: c => { if (c) { r.p[i].hand.push(c); log(r, '✋ นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }),
});
Object.assign(MG, { 'KD01-016': { mod: 1 } });

/* ===== KD02 พันธสัญญาโลหิต (นายนิรยบาล / ธรณีสูบ) ===== */
const isNir = c => !c.tk && (B[c.id].n.startsWith('นายนิรยบาล') || c.id === 'KD02-002');   // ลิลิธ นับเป็นชื่อ "นายนิรยบาล"
const hellNames = p => new Set(p.hell.filter(c => isAv(c) && B[c.id].s === 'นรก').map(c => B[c.id].n)).size;
const KD_HAND = { 'KD02-001': 1 };
const kdHandAb = (r, i, c) => (r.g.turn === i && r.g.phase === 'main' && !r.g.ask && !r.g.pend && ABIL[c.id] && ABIL[c.id].cond(r, i, c)) ? 1 : 0;
function kdMill(r, i, cs, src) {
  const p = r.p[i];
  if (src && isMig(src)) cs.filter(c => c.id === 'KD04-012').forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.hand.push(c); log(r, '✋ สุดยอดท่าไม้ตายผู้กล้า THE END: ถูกธรณีสูบด้วย ไมเกรน นำขึ้นมือ'); } });
  cs.filter(c => c.id === 'KD02-014').forEach(c => r.g.q.unshift(() => {
    if (!p.hell.includes(c)) return; const L = p.hell.filter(x => isAv(x) && isNir(x)).map(x => x.u); if (!L.length) return;
    ask(r, i, { yn: true, text: 'สัญญาเลือด ถูกธรณีสูบ — เนรเทศการ์ดนี้ แล้วอัญเชิญ "นายนิรยบาล" 1 ใบจากนรก?', cb: y => {
      if (!y) return; const k = p.hell.indexOf(c); if (k < 0) return; p.hell.splice(k, 1); p.dk.push(c); log(r, '🌀 เนรเทศ สัญญาเลือด');
      ask(r, i, { text: 'เลือก "นายนิรยบาล" จากนรก อัญเชิญลง Avatar Zone', opts: p.hell.filter(x => isAv(x) && isNir(x)).map(x => x.u), cb: us => { const t = p.hell.find(h => h.u === us[0]); t && summonFree(r, i, t); } });
    } });
  }));
}
// อย่าให้มีครั้งที่ 2: ยกเลิกผล React ของฝ่ายตรงข้าม (ใช้ได้แม้ใช้ React แล้วในเทิร์นนี้ / 1 ใบต่อเทิร์น)
function kdReactGate(r, i, c, go) {
  const g = r.g, o = 1 - i, k = r.p[o].hand.find(h => h.id === 'KD02-017');
  if (!k || c.id === 'KD02-017' || g.used[o].kd17 || g.ask) return go(false);
  ask(r, o, { yn: true, text: 'ฝ่ายตรงข้ามใช้ React "' + c.n + '" — ใช้ อย่าให้มีครั้งที่ 2 ยกเลิกผลของการ์ดใบนั้นไหม?', cb: y => {
    if (!y || !r.p[o].hand.includes(k)) return go(false);
    g.used[o].kd17 = 1; take(r, k.u); r.p[o].hell.push(k); ev(r, k.id); fx({ k: 'say', id: k.id, t: 'ยกเลิกผล React!' });
    log(r, '🚫 ' + r.p[o].name + ' ใช้ อย่าให้มีครั้งที่ 2: ยกเลิกผลของ ' + c.n); go(true);
  } });
}
Object.assign(MG, {
  'KD02-014': { run: (r, i) => { const p = r.p[i]; mill(r, i, 3); r.g.q.push(() => { const n = hellNames(p) >= 5 ? 2 : 1; draw(r, p, n); log(r, '🩸 สัญญาเลือด: ' + p.name + ' จั่ว ' + n + ' ใบ'); }); } },
  'KD02-017': { react: 'never' },
  'BT01-041': MG['SD05-020'],   // ชายจากอนาคต (BT01 / KD02-018 / KD04-019): เดิมเป็นสกิลเปล่า ไม่ยกเลิกอะไร → ใช้สกิลเดียวกับ SD05-020
  'KD02-019': { mod: 1 },
});
Object.assign(SUM, {
  'KD02-005': (r, i, x) => { const p = r.p[i]; if (!p.hand.length) return;
    ask(r, i, { text: 'จุติ: ทิ้งการ์ดบนมือ 1 ใบ เพื่อธรณีสูบ 3 ใบ แล้วอัญเชิญ Avatar {นรก} Cost ≤ 4 จากนรก (ยกเลิก = ไม่ใช้)', opts: p.hand.map(c => c.u), cancel: true, cb: us => {
      sendHell(r, us[0]); mill(r, i, 3, x);
      r.g.q.push(() => ask(r, i, { text: 'เลือก Avatar {นรก} Cost ≤ 4 จากนรก อัญเชิญลง Avatar Zone', opts: p.hell.filter(c => isAv(c) && B[c.id].s === 'นรก' && (B[c.id].c || 0) <= 4).map(c => c.u), cb: u2 => { const t = p.hell.find(h => h.u === u2[0]); t && summonFree(r, i, t); } }));
    } }); },
});
Object.assign(ABIL, {
  'KD02-001': { zone: 'hand', label: 'อัญเชิญเมฟิสโตเฟเลส (ทิ้งมือ 2 ใบ)', cond: (r, i, c) => hellNames(r.p[i]) >= 7 && r.p[i].hand.filter(h => h.u !== c.u).length >= 2 && canPlaceAv(r, i, { id: 'KD02-001', kdOK: 1 }),
    run: (r, i, x) => { const p = r.p[i];
      ask(r, i, { text: 'เมฟิสโตเฟเลส: เลือกการ์ดบนมือ 2 ใบ ที่จะทิ้ง (ยกเลิก = ไม่ใช้)', opts: p.hand.filter(h => h.u !== x.u).map(h => h.u), n: 2, min: 2, cancel: true, cb: us => {
        us.forEach(u => sendHell(r, u)); const c = fromZone(r, i, 'hand', x.u); if (!c) return; c.kdOK = 1; fx({ k: 'say', id: c.id, t: 'ปีศาจแห่งพันธเลือด!' }); putAv(r, i, c, {});
      } }); } },
});
Object.assign(AB, {
  'KD02-001': { z: 'av', can: () => true, steps: [], run: (r, i, cx) => { const me = cx.card; mill(r, i, 5, me);
    r.g.q.push(() => { fx({ k: 'say', id: me.id, t: 'ทำลายทุกสนาม!' }); allAv(r).filter(a => a.x.u !== me.u).forEach(a => destroyAv(r, a.x.u)); log(r, '💥 เมฟิสโตเฟเลส: ทำลาย Avatar ทุกใบ ยกเว้นตัวเอง'); }); } },
  'KD02-002': { z: 'av', can: (r, i) => hellNames(r.p[i]) >= 4 && r.p[i].hell.length >= 2,
    steps: [{ key: 'x', n: 2, text: 'เนรเทศการ์ดในนรกฝ่ายเรา 2 ใบ', opts: (r, i) => r.p[i].hell.map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i];
      (cx.pick.x || []).forEach(u => { const k = p.hell.findIndex(h => h.u === u); if (k >= 0) { const [c] = p.hell.splice(k, 1); if (!c.tk) p.dk.push(c); } });
      fx({ k: 'exile', u: cx.card.u, id: null, nm: 'เนรเทศ 2 ใบ' }); log(r, '🌀 ลิลิธ: เนรเทศการ์ดในนรก 2 ใบ');
      ask(r, i, { text: 'ลิลิธ: เลือกการ์ด {นรก} จากนรก 1 ใบ ขึ้นมือ', opts: p.hell.filter(c => !c.tk && B[c.id].s === 'นรก').map(c => c.u), cb: us => { const h = fromZone(r, i, 'hell', us[0]); h && p.hand.push(h); } }); } },
});


/* ===== KD03 มุ่งสู่ฝันเป็นที่ 1 (ไอดอล / โอตะ) ===== */
const isIdol = x => isAv(x) && nmHas(x, 'ไอดอล');
const isMim = x => isAv(x) && (nmHas(x, 'มีมมิ') || nmHas(x, 'บีมมิ'));          // "บีมมิ" = ตระกูล มีมมิจัง
const isOtaC = c => !c.tk && B[c.id] && B[c.id].t === 'Avatar' && B[c.id].n.includes('โอตะ');
const otaOf = x => (x.wr || []).filter(w => B[w.id].n.includes('โอตะ'));
WEAR_IDOL.push('KD03-002');
Object.assign(COST03, {
  'KD03-002': { ok: c => isIdol(c) || nmHas(c, 'โปรดิวเซอร์'), msg: 'โอตะคูล่า ใช้เป็น Cost ได้เฉพาะ Avatar ไอดอล/โปรดิวเซอร์' },
  'KD03-009': { ok: c => isIdol(c), msg: 'โอตะตัวกะปอม ใช้เป็น Cost ได้เฉพาะ Avatar ไอดอล' },
  'KD03-019': { ok: c => isIdol(c) || nmHas(c, 'โปรดิวเซอร์'), msg: 'ของขวัญจากโอตะ ใช้เป็น Cost ได้เฉพาะ Avatar ไอดอล/โปรดิวเซอร์' },
});
KD_HAND['KD03-001'] = 1; KD_HAND['KD03-002'] = 1;
function modKD(r, x, f) {
  let v = 0; const p = r.p[f.i];
  (x.wr || []).forEach(w => { if (w.id === 'KD03-002' && (isIdol(x) || isMim(x))) v += isMim(x) ? 2 : 1; if (w.id === 'KD03-009' || w.id === 'BT04-013' || w.id === 'KD04-008') v += 1; });
  if (isIdol(x) && otaOf(x).length) v += 2 * p.av.filter(a => (a.id === 'KD03-005' || a.id === 'BT04-009') && a.u !== x.u && !noFx(r, a)).length;
  if (hasEq(r, x, 'KD03-018')) v += 3;
  return v;
}
const kdUntarget = (r, owner, x) => (x.id === 'KD03-005' || x.id === 'BT04-009') && !noFx(r, x) && otaOf(x).length > 0 && r.p[owner].av.some(a => a.u !== x.u && isIdol(a) && B[a.id].n !== B[x.id].n);
function kdPaid(r, i, pc, summoned) {
  if ((pc.id !== 'KD03-009' && pc.id !== 'BT04-013') || !isIdol(summoned)) return;
  const p = r.p[i];
  r.g.q.push(() => { if (!p.hell.includes(pc)) return; const L = p.av.filter(isIdol).map(a => a.u); if (!L.length) return;
    ask(r, i, { text: 'โอตะตัวกะปอม: นำมาสวมใส่ให้ Avatar "ไอดอล" 1 ใบ (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => { const t = find(r, us[0]), k = p.hell.indexOf(pc); if (!t || t.z !== 'av' || k < 0) return; p.hell.splice(k, 1); wearOn(r, i, t.c, pc); } }); });
}
// เชาว์ปัญญาลิง: เปิดช่อง React เมื่อฝ่ายตรงข้ามใช้ความสามารถของ Avatar
function kdUseGate(r, i, f, m) {
  const g = r.g, o = 1 - i;
  if (g.used[o].React || (g.noReact && g.noReact.who === o) || !r.p[o].hand.some(h => h.id === 'KD03-017')) return false;
  g.q.push(() => { const ff = find(r, f.c.u); if (!ff || ff.z !== 'av') return; if (ff.c.nf === g.n) return log(r, '❌ ความสามารถของ ' + nmOf(ff.c) + ' ถูกยกเลิก'); act(r, i, { ...m, rg17: 1 }); });
  open(r, { who: o, k: 'ev', ev: { k: 'use', id: f.c.id, u: f.c.u, i } });
  return true;
}
// มีมมิจัง No.1: End Phase กลับเข้า Deck, จั่ว 1, อัญเชิญ "บีมมิ" จากเนรเทศ
function kdIdolEnd(r, qi, a, done) {
  const p = r.p[qi], wr = a.wr || []; a.wr = [];
  fx({ k: 'say', id: a.id, t: 'กลับเข้า Deck' }); take(r, a.u); p.deck.push(a); shuf(p.deck); draw(r, p, 1);
  log(r, '🎤 End Phase: ' + B[a.id].n + ' กลับเข้า Deck แล้วสับ จั่ว 1 ใบ');
  const L = p.dk.filter(isMim).map(c => c.u), bury = () => { wr.forEach(w => p.hell.push(w)); done(); };
  if (!L.length) return bury();
  ask(r, qi, { text: 'End Phase: อัญเชิญ Avatar "บีมมิ" จากเนรเทศ Zone (ยกเลิก = ไม่อัญเชิญ)', opts: L, cancel: true, onCancel: bury, cb: us => {
    const k = p.dk.findIndex(c => c.u === us[0]); if (k < 0) return bury(); const [c] = p.dk.splice(k, 1);
    if (!putAv(r, qi, c, {})) return bury();
    wr.forEach(w => wearOn(r, qi, c, w)); done(); } });
}
function kdScoutMulti(r, i, n, pred, max, text, then) {
  const p = r.p[i], seen = p.deck.splice(-n).reverse();
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ (' + seen.map(c => B[c.id].n).join(', ') + ')'); seen.length && fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) });
  const fin = us => { const got = (us || []).map(u => seen.find(c => c.u === u)).filter(Boolean); seen.filter(c => !got.includes(c)).forEach(c => p.deck.push(c)); shuf(p.deck); log(r, '🔀 นำการ์ดที่เหลือกลับเข้า Deck แล้วสับ'); then(got); };
  const ok = seen.filter(pred).map(c => c.u); if (!ok.length) return fin([]);
  ask(r, i, { text, opts: ok, n: Math.min(max, ok.length), min: 0, cb: fin });
}
const kdOtaSrc = (r, i) => { const p = r.p[i], o = p.hell.filter(isOtaC).map(c => c.u); if (p.av.some(a => nmHas(a, 'ทัตดนัยซัง'))) o.push(...p.deck.filter(isOtaC).map(c => c.u)); return o; };
Object.assign(SUM, {
  'KD03-001': (r, i) => { const p = r.p[i], L = p.deck.filter(isIdol).map(c => c.u);
    if (!L.length) { shuf(p.deck); return log(r, 'ค้น Deck ไม่พบ Avatar ไอดอล'); }
    ask(r, i, { text: 'จุติ: เลือก Avatar "ไอดอล" จาก Deck อัญเชิญลง Avatar Zone', opts: L, cb: us => {
      if (!summonAny(r, i, us[0], 'deck')) { shuf(p.deck); return; }
      const t = find(r, us[0]), O = p.deck.filter(isOtaC).map(c => c.u);
      if (!t || !O.length) return shuf(p.deck);
      ask(r, i, { text: 'จุติ: เลือก Avatar "โอตะ" จาก Deck ไปสวมใส่ให้ ' + nmOf(t.c), opts: O, cb: u2 => { const c = fromZone(r, i, 'deck', u2[0]); c && wearOn(r, i, t.c, c); shuf(p.deck); } });
    } }); },
});
Object.assign(ABIL, {
  'KD03-001': { zone: 'hand', label: 'เนรเทศ "บีมมิ" แล้วอัญเชิญ มีมมิจัง No.1 (จุติ)', cond: (r, i) => r.p[i].av.some(isMim),
    run: (r, i, x) => { const p = r.p[i];
      ask(r, i, { text: 'มีมมิจัง No.1: เลือก Avatar "บีมมิ" บน Avatar Zone ที่จะเนรเทศ (ยกเลิก = ไม่ใช้)', opts: p.av.filter(isMim).map(a => a.u), cancel: true, cb: us => {
        const t = find(r, us[0]); if (!t || t.z !== 'av') return; const wr = t.c.wr || []; t.c.wr = [];
        fx({ k: 'exile', u: t.c.u, id: t.c.kd || t.c.id }); take(r, t.c.u); p.dk.push(t.c); log(r, '🌀 เนรเทศ ' + nmOf(t.c));
        const hc = fromZone(r, i, 'hand', x.u); if (!hc) return wr.forEach(w => p.hell.push(w));
        putAv(r, i, hc, { sm: 1 }); wr.forEach(w => B[w.id].n.includes('โอตะ') ? wearOn(r, i, hc, w) : p.hell.push(w));
      } }); } },
  'KD03-002': { zone: 'hand', label: 'เนรเทศใบนี้ + ทิ้งมือ 1 ใบ: นำ "บีมมิ" จาก Deck ขึ้นมือ', cond: (r, i, c) => r.p[i].hand.length >= 2 && r.p[i].deck.some(isMim),
    run: (r, i, x) => { const p = r.p[i];
      ask(r, i, { text: 'โอตะคูล่า: เลือกการ์ดบนมือ 1 ใบที่จะทิ้ง (ยกเลิก = ไม่ใช้)', opts: p.hand.filter(h => h.u !== x.u).map(h => h.u), cancel: true, cb: us => {
        sendHell(r, us[0]); const c = fromZone(r, i, 'hand', x.u); if (c) { p.dk.push(c); log(r, '🌀 เนรเทศ ' + B[c.id].n); }
        tutor(r, i, isMim, 'Avatar บีมมิ'); } }); } },
});
Object.assign(AB, {
  'KD03-002': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.u !== c.u && (isIdol(a) || isMim(a))),
    steps: [{ key: 't', text: 'เลือก Avatar "ไอดอล" หรือ "บีมมิ" ที่จะสวมใส่ โอตะคูล่า', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && (isIdol(a) || isMim(a))).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } },
  'KD03-006': { z: 'av', can: (r, i, c) => kdOtaSrc(r, i).length > 0 && r.p[i].av.some(a => a.u !== c.u && isIdol(a)),
    steps: [{ key: 't', text: 'เลือก Avatar "ไอดอล" ใบอื่น ที่จะสวมใส่ โอตะ', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && isIdol(a)).map(a => a.u) },
            { key: 'o', text: 'เลือก Avatar "โอตะ" (จากนรก หรือ Deck ถ้ามี ทัตดนัยซัง)', opts: (r, i) => kdOtaSrc(r, i) }],
    run: (r, i, cx) => { const p = r.p[i], t = find(r, cx.pick.t[0]), u = cx.pick.o[0]; if (!t) return; const z = p.hell.some(c => c.u === u) ? 'hell' : 'deck'; const c = fromZone(r, i, z, u); if (!c) return; wearOn(r, i, t.c, c); if (z === 'deck') shuf(p.deck); } },
  'KD03-020': { z: 'land', can: (r, i) => r.p[i].hand.length > 0,
    steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i) => { const p = r.p[i];
      ask(r, i, { text: 'เวทีแห่งความฝัน: เลือกปฏิบัติ', choices: ['1) สอดแนม 5 ใบ: โอตะ ≤ 2 ใบ สวมใส่ให้ ไอดอล', '2) สอดแนม 7 ใบ: นำ Avatar ไอดอล 1 ใบขึ้นมือ'], cb: k => {
        if (k === 1) return kdScoutMulti(r, i, 7, isIdol, 1, 'เลือก Avatar "ไอดอล" 1 ใบ ขึ้นมือ', got => got.forEach(c => { p.hand.push(c); log(r, '✋ นำ ' + B[c.id].n + ' ขึ้นมือ'); }));
        const I = p.av.filter(isIdol).map(a => a.u); if (!I.length) return log(r, 'ไม่มี Avatar ไอดอล บน Avatar Zone');
        kdScoutMulti(r, i, 5, isOtaC, 2, 'เลือก Avatar "โอตะ" ได้สูงสุด 2 ใบ ไปสวมใส่ให้ ไอดอล', got => {
          if (!got.length) return;
          const wear = tu => { const t = find(r, tu); if (!t || t.z !== 'av') return; got.forEach(c => { const q = p.deck.indexOf(c); if (q >= 0) p.deck.splice(q, 1); wearOn(r, i, t.c, c); }); };
          got.forEach(c => p.deck.push(c));   // ระหว่างเลือก ให้ใบที่ได้อยู่ใน Deck ชั่วคราว (ถ้าไม่มีเป้าหมาย จะกลับเข้า Deck อยู่แล้ว)
          if (I.length === 1) return wear(I[0]);
          ask(r, i, { text: 'เลือก Avatar "ไอดอล" ที่จะสวมใส่โอตะ', opts: I, cb: us => wear(us[0]) }); });
      } }); } },
});
Object.assign(MG, {
  'KD03-015': { react: 'atkAv', cond: r => { const p = r.g.pend; return !!(p && p.k === 'atk' && p.tk === 'av' && r.p[p.who].av.some(a => a.u === p.tg && isIdol(a))); },
    run: (r, i, cx) => { if (cx.pend) cx.pend.cancel = 1; log(r, '🤝 งานจับมือ: ยกเลิกการโจมตี'); const p = r.p[i], L = p.hell.filter(isOtaC).map(c => c.u), I = p.av.filter(isIdol).map(a => a.u); if (!L.length || !I.length) return;
      ask(r, i, { text: 'งานจับมือ: เลือก Avatar "โอตะ" จากนรก', opts: L, cb: us => ask(r, i, { text: 'เลือก Avatar "ไอดอล" ที่จะสวมใส่', opts: I, cb: u2 => { const t = find(r, u2[0]), c = fromZone(r, i, 'hell', us[0]); t && c && wearOn(r, i, t.c, c); } }) }); } },
  'KD03-017': { react: 'use', run: (r, i, cx) => { const e = cx.ev, f = e && find(r, e.u); if (!f || f.z !== 'av') return; f.c.nf = r.g.n; fx({ k: 'say', id: 'KD03-017', t: 'สูญเสียความสามารถ!' }); vfx(f.c.u, 'burst', 'สูญเสียความสามารถ', '#a3e635'); log(r, '🐒 ' + nmOf(f.c) + ' สูญเสียความสามารถทั้งหมด จนจบเทิร์น'); } },
  'KD03-018': { mod: 1 },
  'KD03-019': { mod: 1, tgf: x => isIdol(x), run: (r, i) => { draw(r, r.p[i], 1); log(r, '🎁 ของขวัญจากโอตะ: ' + r.p[i].name + ' จั่ว 1 ใบ'); } },
});


/* ===== KD04 ชะตากรแห่งจุดจบ (ไมเกรน / หุ่นนักรบผู้กล้า) ===== */
const isMig = x => !!x && !x.tk && /ไมเกรน|ไม้ท์เกรน/.test(nmOf(x)) && B[x.id].t === 'Avatar';
const isRobot = x => ['หุ่นยนต์', 'เครื่องจักร'].includes(symOf(x));
const isWeapon = c => !c.tk && B[c.id].t === 'Magic' && B[c.id].st === 'Modification' && B[c.id].n.startsWith('อาวุธหุ่นนักรบผู้กล้า');
const isModC = c => !c.tk && B[c.id].t === 'Magic' && B[c.id].st === 'Modification';
const dedupName = L => { const seen = new Set(); return L.filter(c => { const n = B[c.id].n; if (seen.has(n)) return false; seen.add(n); return true; }); };
const kdRich = (r, w, x) => (x.id === 'BT02-006' || ((x.id === 'KD04-009' || x.id === 'KD04-010') && !r.g.used[w].React && !(r.g.noReact && r.g.noReact.who === w))) && x.rc !== r.g.n && !noFx(r, x);
const kdHellAb = (r, i, c) => (r.g.turn === i && r.g.phase === 'main' && !r.g.ask && !r.g.pend && ABIL[c.id] && ABIL[c.id].cond(r, i, c)) ? 1 : 0;
function kdMigScout(r, i, seen) {
  const p = r.p[i];
  seen.filter(c => c.id === 'KD04-012').forEach(c => { const k = p.deck.indexOf(c); if (k >= 0) { p.deck.splice(k, 1); p.hand.push(c); log(r, '✋ สุดยอดท่าไม้ตายผู้กล้า THE END: ถูกสอดแนมด้วย ไมเกรน นำขึ้นมือ'); } });
}
// THE END: Avatar ไมเกรน ต่อสู้กับ Avatar ฝ่ายตรงข้ามทุกใบพร้อมกัน
function kdMulti(r, p, a) {
  if (p.tk !== 'av' || a.allFight !== r.g.n || p.multi) return;
  const op = r.p[1 - p.ai], pa = P(r, a), others = op.av.filter(x => x.u !== p.tg);
  if (!others.length) return;
  log(r, '⚔ THE END: ' + nmOf(a) + ' (' + pa + ') ต่อสู้กับ Avatar ฝ่ายตรงข้ามทุกใบพร้อมกัน');
  const dead = [];
  others.forEach(t => { const pt = P(r, t); log(r, '   ↳ สู้ ' + nmOf(t) + ' (' + pt + ')'); if (pa > pt) dead.push(t); else if (pa === pt && pa > 0) { dead.push(t); a.kdLose = true; } else if (pt > pa) a.kdLose = true; });
  dead.forEach(t => { vfx(t.u, 'burst', 'THE END', '#ef4444'); kill(r, p.ai, t.u); });
}
// โปรโตไมเกรน: ชนะการต่อสู้ → ส่งลงนรก อัญเชิญ จุติ ไมเกรน จาก Deck ย้ายของสวมใส่ทั้งหมด
function kdProto(r, wi, w) {
  const p = r.p[wi]; if (!onAv(r, w.u)) return; const mig = p.deck.find(c => c.kd === 'KD04-003'); if (!mig) return;
  ask(r, wi, { yn: true, text: 'โปรโตไมเกรน ชนะการต่อสู้: ส่งการ์ดนี้ลงนรก แล้วอัญเชิญ จุติ "หุ่นนักรบผู้กล้า : ไมเกรน" จาก Deck ไหม?', cb: y => {
    if (!y || !onAv(r, w.u)) return;
    const wr = w.wr || []; w.wr = []; const mods = p.mg.filter(m => m.at === w.u); mods.forEach(m => { m.at = -1; });
    sendHell(r, w.u); if (onAv(r, w.u)) { w.wr = wr; mods.forEach(m => { m.at = w.u; }); return; }
    const c = fromZone(r, wi, 'deck', mig.u); shuf(p.deck);
    const lost = () => { wr.forEach(x => p.hell.push(x)); mods.forEach(m => { const k = p.mg.indexOf(m); if (k >= 0) p.mg.splice(k, 1); p.hell.push(m); }); };
    if (!c) return lost(); if (!putAv(r, wi, c, { sm: 1 })) return lost();
    wr.forEach(x => wearOn(r, wi, c, x)); mods.forEach(m => { m.at = c.u; }); log(r, '🔁 ย้ายการ์ดสวมใส่ทั้งหมดไปให้ ' + B[c.id].n);
  } });
}
Object.assign(COST03, {});
Object.assign(SUM, {
  'KD04-002': (r, i) => scout(r, i, 5, { text: 'จุติ: เลือก Avatar "ไมเกรน" 1 ใบ จากที่สอดแนม ขึ้นมือ', pred: c => isMig(c), rest: 'shuffle', then: c => { if (c) { r.p[i].hand.push(c); log(r, '✋ นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }),
  'KD04-008': (r, i, x) => { const p = r.p[i], need = ['BT03-005', 'BT03-006', 'BT03-007'], picks = need.map(id => p.hell.find(c => c.id === id));
    if (picks.some(c => !c)) return log(r, 'จุติ สหายหุ่นผู้กล้า โฟเบีย: ในนรกยังไม่ครบ เก๊าท์/ไดบาเรีย/แอร์ซิด');
    ask(r, i, { yn: true, text: 'จุติ: นำ เก๊าท์ / ไดบาเรีย / แอร์ซิด รีฟลักซ์ อย่างละ 1 ใบจากนรกกลับเข้า Deck เพื่ออัญเชิญ "ไมเกรน" Cost ≤ 5 จาก Deck ไหม?', cb: y => {
      if (!y) return; picks.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } });
      const L = p.deck.filter(c => isMig(c) && costOf(c) <= 5).map(c => c.u); if (!L.length) { shuf(p.deck); return log(r, 'ไม่พบ ไมเกรน Cost ≤ 5 ใน Deck'); }
      ask(r, i, { text: 'เลือก Avatar "ไมเกรน" Cost ≤ 5 จาก Deck อัญเชิญลง Avatar Zone', opts: L, cb: us => {
        if (!summonAny(r, i, us[0], 'deck')) return shuf(p.deck); const t = find(r, us[0]); shuf(p.deck);
        if (t && onAv(r, x.u)) { take(r, x.u); wearOn(r, i, t.c, x); }
      } });
    } }); },
});
Object.assign(AB, {
  'KD04-001': { z: 'av', can: (r, i) => dedupName(r.p[i].hell.filter(isMig)).length >= 3, steps: [],
    run: (r, i, cx) => { const p = r.p[i], me = cx.card, chosen = [];
      const pick = () => { const L = dedupName(p.hell.filter(c => isMig(c))).filter(c => !chosen.some(h => B[h.id].n === B[c.id].n)).map(c => c.u);
        ask(r, i, { text: 'เนรเทศ Avatar "ไมเกรน" ชื่อแตกต่างกัน 3 ใบ จากนรก (' + (chosen.length + 1) + '/3)', opts: L, cancel: true, onCancel: () => { delete me.us; }, cb: us => {
          chosen.push(p.hell.find(c => c.u === us[0])); if (chosen.length < 3) return pick();
          chosen.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.dk.push(c); } }); fx({ k: 'exile', u: me.u, id: null, nm: 'เนรเทศ 3 ใบ' }); log(r, '🌀 ราชันย์หุ่นนักรบผู้กล้า: เนรเทศ ' + chosen.map(c => B[c.id].n).join(', '));
          ask(r, i, { text: 'เลือกปฏิบัติ', choices: ['1) นำ "อาวุธหุ่นนักรบผู้กล้า" จากนรก ≤ 2 ใบ มาสวมใส่ให้ Avatar ใบนี้', '2) เทิร์นนี้ ถ้า Avatar ใบนี้ทำลาย Avatar ฝ่ายตรงข้ามจากการต่อสู้ ทำความเสียหายต่อ LIFE 1 ครั้ง'], cb: k => {
            if (k === 1) { me.crit = r.g.n; vfx(me.u, 'aura', 'คริติคอล!', '#ef4444'); return log(r, '💥 ' + nmOf(me) + ' ได้รับ: ทำลาย Avatar จากการต่อสู้ → ทำความเสียหายต่อ LIFE 1 ครั้ง (จนจบเทิร์น)'); }
            const W = dedupName(p.hell.filter(isWeapon)).map(c => c.u); if (!W.length) return log(r, 'ไม่มี อาวุธหุ่นนักรบผู้กล้า ในนรก');
            ask(r, i, { text: 'เลือก "อาวุธหุ่นนักรบผู้กล้า" จากนรก ≤ 2 ใบ (ชื่อแตกต่างกันก็ได้/ซ้ำก็ได้)', opts: p.hell.filter(isWeapon).map(c => c.u), n: 2, min: 0, cb: us => us.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c && onAv(r, me.u)) { c.at = me.u; p.mg.push(c); vfx(me.u, 'aura', 'สวม ' + B[c.id].n, '#38bdf8'); log(r, '🪖 ' + nmOf(me) + ' สวมใส่ ' + B[c.id].n); } else if (c) p.hell.push(c); }) });
          } });
        } }); };
      pick(); } },
  'KD04-002': { z: 'av', can: (r, i) => r.p[i].hand.length > 0 && r.p[i].hell.some(isWeapon),
    steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i) => { const p = r.p[i]; ask(r, i, { text: 'เลือก "อาวุธหุ่นนักรบผู้กล้า" 1 ใบ จากนรก ขึ้นมือ', opts: p.hell.filter(isWeapon).map(c => c.u), cb: us => { const c = fromZone(r, i, 'hell', us[0]); c && p.hand.push(c); } }); } },
  'KD04-016': { z: 'land', can: (r, i) => !r.g.used[i].Modification, steps: [], run: (r, i) => { r.g.mod2 = { who: i, n: r.g.n }; log(r, '🏭 ซีทันยาน: เทิร์นนี้ใช้ "อาวุธหุ่นนักรบผู้กล้า" ได้ 2 ใบ (ใช้ Modification อื่นไม่ได้)'); } },
  'KD04-017': { z: 'land', can: (r, i) => r.p[i].hand.length > 0 && r.p[i].deck.some(isModC),
    steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i) => tutor(r, i, isModC, 'Modification Magic') },
});
Object.assign(ABIL, {
  'KD04-012': { zone: 'hell', label: 'เนรเทศ: นำอาวุธจากนรกไปสวมใส่ให้ ไมเกรน', cond: (r, i) => r.p[i].av.some(isMig) && r.p[i].hell.some(isWeapon),
    run: (r, i, x) => { const p = r.p[i];
      ask(r, i, { text: 'สุดยอดท่าไม้ตายผู้กล้า: เลือก Avatar "ไมเกรน" ที่จะสวมใส่อาวุธ (ยกเลิก = ไม่ใช้)', opts: p.av.filter(isMig).map(a => a.u), cancel: true, cb: us => {
        const t = find(r, us[0]); if (!t || t.z !== 'av') return; const k = p.hell.indexOf(x); if (k < 0) return; p.hell.splice(k, 1); p.dk.push(x); log(r, '🌀 เนรเทศ ' + B[x.id].n);
        const W = dedupName(p.hell.filter(isWeapon)); if (!W.length) return;
        ask(r, i, { text: 'เลือก "อาวุธหุ่นนักรบผู้กล้า" ชื่อแตกต่างกันกี่ใบก็ได้ มาสวมใส่', opts: W.map(c => c.u), n: W.length, min: 0, cb: u2 => u2.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c && onAv(r, t.c.u)) { c.at = t.c.u; p.mg.push(c); vfx(t.c.u, 'aura', 'สวม ' + B[c.id].n, '#38bdf8'); log(r, '🪖 ' + nmOf(t.c) + ' สวมใส่ ' + B[c.id].n); } else if (c) p.hell.push(c); }) });
      } }); } },
});
Object.assign(MG, {
  'KD04-012': { cond: (r, i) => r.p[i].av.some(isMig), steps: [{ key: 't', text: 'เลือก Avatar "ไมเกรน" ของเรา', opts: (r, i) => r.p[i].av.filter(isMig).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; t.c.allFight = r.g.n; vfx(t.c.u, 'aura', 'THE END!', '#ef4444'); fx({ k: 'say', id: 'KD04-012', t: 'ต่อสู้กับศัตรูทุกใบพร้อมกัน!' }); log(r, '☄ ' + nmOf(t.c) + ' ได้รับ: เมื่อโจมตี ต่อสู้กับ Avatar ฝ่ายตรงข้ามทุกใบพร้อมกัน (จนจบเทิร์น)'); } },
  'KD04-014': { mod: 1, tgf: x => isRobot(x) && nmOf(x).includes('ผู้กล้า') },
  'KD04-015': { mod: 1, tgf: x => isRobot(x) },
  'KD04-016': {}, 'KD04-017': {},
});

/* ===== BT04 ชุด 1: Avatar แดง (001-004, 006-009, 013, 036) + Magic พิมพ์ซ้ำ (046/048/050/054) ===== */
Object.assign(CANON, { 'BT04-046': 'SD08-013', 'BT04-048': 'KD03-015', 'BT04-050': 'KD03-017', 'BT04-054': 'KD03-019' });   // ข้อความเหมือนเดิมทุกตัวอักษร ใช้สกิลเดิม
COST03['BT04-013'] = COST03['KD03-009'];
const isAnimal = x => symOf(x) === 'สัตว์' || (x.id === 'BT04-007' && !x.tk);   // BT04-007: เป็น Symbol สัตว์ ด้วย
const BT4A = {
  'BT04-002': (r, i, a) => {   // ครูสงบ: ประกาศโจมตี → ทำลาย Modification ฝ่ายตรงข้าม 1 ใบ
    const L = r.p[1 - i].mg.filter(m => B[m.id].st === 'Modification').map(m => m.u); if (!L.length) return;
    ask(r, i, { text: 'ครูสงบ: เลือก Modification Magic ของฝ่ายตรงข้าม 1 ใบ ทำลาย (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => {
      fx({ k: 'say', id: a.id, t: 'ทำลาย Modification' }); vfx(a.u, 'shake', 'ทำลาย Modification', '#ef4444'); log(r, '💥 ครูสงบ: ทำลาย Modification ของฝ่ายตรงข้าม'); destroyAny(r, us[0]);
    } });
  },
};
function bt4Atk(r, i, a, tg, tk) { if (noFx(r, a)) return; const f = BT4A[a.id]; f && f(r, i, a, tg, tk); }
Object.assign(SUM, {
  'BT04-004': (r, i, x) => {   // อีช่า: เซ่นไหว้ Avatar ใบอื่น 1 ใบ → ยึด Avatar {คน/เทพ/นรก} ของศัตรู
    const p = r.p[i], SY = ['คน', 'เทพ', 'นรก'], tgs = () => r.p[1 - i].av.filter(a => SY.includes(symOf(a)) && !protectedFrom(r, i, a)).map(a => a.u);
    const L = p.av.filter(a => a.u !== x.u).map(a => a.u); if (!L.length || !tgs().length) return log(r, 'จุติ อีช่า: ไม่มี Avatar ให้เซ่นไหว้ หรือไม่มีเป้าหมาย');
    ask(r, i, { text: 'จุติ: เซ่นไหว้ Avatar ใบอื่นใน Avatar Zone เรา 1 ใบ เพื่อยึด Avatar {คน/เทพ/นรก} ของศัตรู (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => {
      sendHell(r, us[0]);
      r.g.q.push(() => { const T = tgs(); if (!T.length) return;
        ask(r, i, { text: 'เลือก Avatar {คน/เทพ/นรก} ของศัตรู 1 ใบ เปลี่ยนการควบคุมมาฝั่งเรา', opts: T, cb: u2 => {
          r.g.nutOK = 1; const ok = stealCard(r, i, u2[0]); r.g.nutOK = 0;
          if (ok) { fx({ k: 'say', id: x.id, t: 'ยึดการควบคุม!' }); vfx(u2[0], 'burst', 'เปลี่ยนการควบคุม', '#f43f5e'); }
        } }); });
    } });
  },
});
Object.assign(AB, {
  'BT04-007': { z: 'av', can: () => true, steps: [], run: (r, i, cx) => {   // ราม และ วิโรจน์: เลือกปฏิบัติ
    const me = cx.card, p = r.p[i];
    const wearOK = c => { const d = MG[c.id]; return !d || !d.tgf || d.tgf(me); };
    const L = () => (r.g.used[i].Modification || !onAv(r, me.u)) ? [] : p.hell.filter(c => !c.tk && B[c.id].st === 'Modification' && wearOK(c)).map(c => c.u);
    ask(r, i, { text: 'ราม และ วิโรจน์: เลือกปฏิบัติ', choices: ['1) Avatar ใบนี้ POWER +2 จนถึง End Phase ต่อไปของฝ่ายตรงข้าม', '2) (เทิร์นนี้ยังไม่ใช้ Modification) นำ Modification Magic 1 ใบจากนรกเรา มาสวมใส่ที่ Avatar ใบนี้ นับเป็นการใช้ Modification'], cb: k => {
      if (k === 0) { addHold(me, 2, r.g.n + 1); vfx(me.u, 'aura', 'POWER +2', '#f97316'); log(r, '🔥 ราม และ วิโรจน์ POWER +2 จนถึง End Phase ต่อไปของฝ่ายตรงข้าม'); return; }
      const O = L(); if (!O.length) return log(r, 'ใช้ข้อ 2 ไม่ได้ (เทิร์นนี้ใช้ Modification แล้ว หรือไม่มี Modification ในนรกที่สวมได้)');
      ask(r, i, { text: 'เลือก Modification Magic จากนรก 1 ใบ สวมใส่ที่ Avatar ใบนี้', opts: O, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return;
        if (!onAv(r, me.u)) return p.hell.push(c);
        c.at = me.u; p.mg.push(c); r.g.used[i].Modification = 1; vfx(me.u, 'aura', 'สวม ' + B[c.id].n, '#38bdf8'); log(r, '🪖 ราม และ วิโรจน์ สวมใส่ ' + B[c.id].n + ' จากนรก');
      } });
    } });
  } },
});

/* ===== BT04 ชุด 2 (batch 1): จุติ / สั่งใช้ / คำสั่งเสีย / Magic พื้นฐาน ===== */
const isPet = c => isAv(c) && symOf(c) === 'สัตว์' && /^(หมา|แมว)/.test(B[c.id].n);   // Avatar "หมา" หรือ "แมว" ที่มี {Symbol สัตว์}
const bt4Say = (x, t, c) => { fx({ k: 'say', id: x.id, t }); vfx(x.u, 'aura', t, c || '#38bdf8'); };
Object.assign(SUM, {
  'BT04-014': (r, i, x) => {   // มาวิน เซียนเบ็ด: ทิ้ง {แมลง}/"เหยื่อ" จากมือ → อัญเชิญ {ปลา} จากนรก
    const p = r.p[i], D = p.hand.filter(c => isAv(c) && (symOf(c) === 'แมลง' || B[c.id].n.includes('เหยื่อ'))).map(c => c.u);
    const F = () => p.hell.filter(c => isAv(c) && symOf(c) === 'ปลา').map(c => c.u);
    if (!D.length || !F().length) return log(r, 'จุติ มาวิน: ไม่มี Avatar {แมลง}/เหยื่อ ในมือ หรือไม่มี {ปลา} ในนรก');
    ask(r, i, { text: 'จุติ: ทิ้ง Avatar {แมลง} หรือ "เหยื่อ" จากมือ 1 ใบ เพื่ออัญเชิญ {ปลา} จากนรก (ยกเลิก = ไม่ใช้)', opts: D, cancel: true, cb: us => {
      const c = fromZone(r, i, 'hand', us[0]); if (!c) return; p.hell.push(c);
      r.g.q.unshift(() => ask(r, i, { text: 'เลือก Avatar {ปลา} จากนรก 1 ใบ อัญเชิญลงสนาม', opts: F(), cb: u2 => { if (summonAny(r, i, u2[0], 'hell')) vfx(u2[0], 'burst', 'อัญเชิญ', '#38bdf8'); } }));
    } });
  },
  'BT04-017': (r, i, x) => {   // หมานมเย็น: อัญเชิญ "หมา"/"แมว" {สัตว์} Cost ≤ 2 จาก Deck แล้วสับ
    const p = r.p[i], L = p.deck.filter(c => isPet(c) && B[c.id].c <= 2).map(c => c.u);
    if (!L.length) { shuf(p.deck); return log(r, 'จุติ หมานมเย็น: ไม่พบ หมา/แมว Cost ≤ 2 ใน Deck'); }
    ask(r, i, { text: 'จุติ: เลือก หมา/แมว {สัตว์} Cost ≤ 2 จาก Deck อัญเชิญลงสนาม', opts: L, cb: us => { if (summonAny(r, i, us[0], 'deck')) vfx(us[0], 'burst', 'อัญเชิญ', '#f59e0b'); shuf(p.deck); } });
  },
  'BT04-022': (r, i, x) => {   // รปภ.: จั่ว 1 แล้วนำการ์ด 1 ใบจากมือไปไว้บนสุดของ Deck
    const p = r.p[i]; draw(r, p, 1); vfx(x.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ' + p.name + ': จั่ว 1 ใบ');
    r.g.q.unshift(() => ask(r, i, { text: 'จุติ: เลือกการ์ดจากมือ 1 ใบ วางไว้บนสุดของ Deck', opts: p.hand.map(c => c.u), cb: us => { const c = fromZone(r, i, 'hand', us[0]); if (c) { p.deck.push(c); log(r, '⬆ ' + p.name + ': วางการ์ด 1 ใบไว้บน Deck'); } } }));
  },
  'BT04-026': (r, i, x) => {   // ลูกเขยบิ๊ก: นำ Magic "แผนการ" จาก Deck หรือ นรก ขึ้นมือ (จาก Deck ต้องสับ)
    const p = r.p[i], ok = c => B[c.id].t === 'Magic' && B[c.id].n.startsWith('แผนการ');
    const L = [...p.deck.filter(c => ok(c)).map(c => c.u), ...p.hell.filter(c => !c.tk && ok(c)).map(c => c.u)];
    if (!L.length) { shuf(p.deck); return log(r, 'จุติ ลูกเขยบิ๊ก: ไม่พบ Magic "แผนการ"'); }
    ask(r, i, { text: 'จุติ: เลือก Magic "แผนการ" จาก Deck/นรก 1 ใบ ขึ้นมือ', opts: L, cb: us => {
      const fromDeck = p.deck.some(c => c.u === us[0]), c = fromZone(r, i, fromDeck ? 'deck' : 'hell', us[0]); if (!c) return;
      p.hand.push(c); if (fromDeck) shuf(p.deck); vfx(x.u, 'aura', 'ขึ้นมือ', '#a78bfa'); log(r, '✨ ' + p.name + ': นำ ' + B[c.id].n + ' ขึ้นมือ');
    } });
  },
  'BT04-027': (r, i, x) => {   // ผู้งมงาย: จั่ว 1 แล้วทิ้งการ์ด 1 ใบจากมือลงนรก
    const p = r.p[i]; draw(r, p, 1); vfx(x.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ' + p.name + ': จั่ว 1 ใบ');
    r.g.q.unshift(() => ask(r, i, { text: 'จุติ: ทิ้งการ์ดจากมือ 1 ใบ ลงนรก', opts: p.hand.map(c => c.u), cb: us => { const c = fromZone(r, i, 'hand', us[0]); if (c) { p.hell.push(c); log(r, '🗑 ' + p.name + ': ทิ้ง ' + B[c.id].n); } } }));
  },
});
Object.assign(AB, {
  'BT04-019': { z: 'av', steps: [], run: (r, i, cx) => { draw(r, r.p[i], 1); vfx(cx.card.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ' + r.p[i].name + ': จั่ว 1 ใบ'); } },   // คนแก่สติเลอะเลือน: เทิร์นละครั้ง จั่ว 1 (ส่วนอัญเชิญเมื่อถูกสอดแนมโดย "ผู้รู้ความจริง" ทำใน batch ถัดไป)
  'BT04-031': { z: 'av', steps: [], run: (r, i, cx) => { tutor(r, i, c => B[c.id].t === 'Magic' && B[c.id].n.trim() === 'ปืนเล็กยาว', 'Modification Magic "ปืนเล็กยาว"'); vfx(cx.card.u, 'aura', 'ค้น ปืนเล็กยาว', '#84cc16'); } },
});
function bt4Death(r, f) {   // คำสั่งเสีย BT04 + 049
  const c = f.c, p = r.p[f.i]; if (c.tk) return;
  if (isAv(c) && symOf(c) === 'ผี' && !r.g.inB && r.g.turn !== f.i && !r.g.over) {   // BT04-049 เอาไปอยู่ด้วย (React)
    const h = p.hand.find(x => x.id === 'BT04-049');
    if (h && !r.g.used[f.i].React) r.g.q.unshift(() => { if (!p.hand.includes(h) || r.g.used[f.i].React) return;
      ask(r, f.i, { yn: true, text: 'Avatar {ผี} ถูกทำลายโดยฝ่ายตรงข้าม — ใช้ React เอาไปอยู่ด้วย: ทำลาย Avatar ฝ่ายตรงข้าม 1 ใบ?', cb: y => { if (!y) return; const T = foeAvT(r, f.i); if (!T.length) return log(r, 'ไม่มี Avatar ฝ่ายตรงข้ามให้ทำลาย');
        p.hand.splice(p.hand.indexOf(h), 1); p.hell.push(h); r.g.used[f.i].React = 1; ev(r, h.id); log(r, p.name + ' ใช้ React: เอาไปอยู่ด้วย');
        ask(r, f.i, { text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: T, cb: us => { vfx(us[0], 'burst', 'เอาไปอยู่ด้วย!', '#a855f7'); destroyAv(r, us[0]); } }); } }); });
  }
  if (c.id === 'BT04-034') r.g.q.push(() => {   // อนงค์: อัญเชิญ หมา/แมว {สัตว์} Cost ≤ 3 จากนรก
    const L = p.hell.filter(h => isPet(h) && B[h.id].c <= 3).map(h => h.u); if (!L.length) return log(r, 'คำสั่งเสีย อนงค์: ไม่มี หมา/แมว Cost ≤ 3 ในนรก');
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือก หมา/แมว {สัตว์} Cost ≤ 3 จากนรก อัญเชิญลงสนาม', opts: L, cb: us => { if (summonAny(r, f.i, us[0], 'hell')) vfx(us[0], 'burst', 'อัญเชิญ', '#f59e0b'); } });
  });
}
const foeAvT = (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a)).map(a => a.u);
Object.assign(MG, {
  'BT04-041': { run: (r, i) => {   // ล้มโต๊ะ: มือทั้ง 2 ฝ่ายกลับเข้า Deck สับ แล้วจั่วคนละ 4
    r.p.forEach(q => { q.deck.push(...q.hand.splice(0)); shuf(q.deck); }); r.p.forEach(q => draw(r, q, 4));
    fx({ k: 'vfx', u: null, t: 'burst', txt: 'ล้มโต๊ะ!', c: '#ef4444' }); log(r, '🎲 ล้มโต๊ะ: มือทั้งสองฝ่ายกลับเข้า Deck แล้วจั่วคนละ 4 ใบ'); } },
  'BT04-044': { steps: [oneHand(1, 'ทิ้งการ์ดบนมือ 1 ใบ'), { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: foeAvT }],   // บีมมมมมมมมมม
    run: (r, i, cx) => { const u = cx.pick.t[0]; vfx(u, 'burst', 'บีม!', '#facc15'); destroyAv(r, u); log(r, '💥 บีม: ทำลาย Avatar ฝ่ายตรงข้าม'); } },
});

/* ===== BT04 ชุด 2 (batch 2): ผู้รู้ความจริง / กะปอม / สัตว์ / Magic / Land / ที่เหลือทั้งหมด ===== */
const isTruth = x => !!x && nmOf(x).includes('ผู้รู้ความจริง');
const isPrime = n => { if (n < 2) return false; for (let k = 2; k * k <= n; k++) if (n % k === 0) return false; return true; };
function bt4Seen(r, i, seen, o) {   // 019: ถูกสอดแนมโดย Avatar "ผู้รู้ความจริง" → อัญเชิญลง Avatar Zone
  if (!o || !o.by || !isTruth(o.by)) return;
  seen.forEach(c => { if (c.id === 'BT04-019' && r.p[i].deck.includes(c)) r.r4 = summonAny(r, i, c.u, 'deck') && (vfx(c.u, 'burst', 'ถูกสอดแนม → อัญเชิญ', '#a855f7'), log(r, '🔮 คนแก่สติเลอะเลือนฯ ถูกสอดแนมโดยผู้รู้ความจริง → อัญเชิญ')); });
}
function bt4Peek(r, i, n, by) {
  const p = r.p[i], seen = p.deck.slice(-n).reverse();
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ (' + seen.map(c => B[c.id].n).join(', ') + ')'); seen.length && fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) });
  bt4Seen(r, i, seen, { by }); return seen;
}
function bt4Arrange(r, i, cs, done) {   // เรียงการ์ดที่สอดแนมไว้บนสุด/ใต้ Deck: เลือกใบบนสุดก่อน (ลงมาเรื่อยๆ) แล้วเลือกใบล่างสุด (ขึ้นมา)
  const p = r.p[i]; cs = cs.filter(c => p.deck.includes(c)); cs.forEach(c => p.deck.splice(p.deck.indexOf(c), 1));
  const top = [], bot = [], rem = () => cs.filter(c => !top.includes(c) && !bot.includes(c));
  const fin = () => { bot.slice().reverse().forEach(c => p.deck.unshift(c)); top.slice().reverse().forEach(c => p.deck.push(c)); log(r, '🔎 ' + p.name + ': เรียงการ์ดที่สอดแนม บนสุด ' + top.length + ' ใบ / ใต้ Deck ' + bot.length + ' ใบ'); done && done(); };
  const botStep = () => { const R = rem(); if (!R.length) return fin(); if (R.length === 1) { bot.push(R[0]); return fin(); }
    ask(r, i, { text: 'สอดแนม: เลือกการ์ดที่จะวางเป็น "ใบล่างสุด" ลำดับที่ ' + (bot.length + 1) + ' ของ Deck (นับขึ้นมาจากล่างสุด)', opts: R.map(c => c.u), cb: us => { bot.push(cs.find(c => c.u === us[0])); botStep(); } }); };
  const topStep = () => { const R = rem(); if (!R.length) return fin();
    if (R.length === 1) return ask(r, i, { text: 'สอดแนม: ' + B[R[0].id].n + ' — วางไว้ที่ไหน?', choices: ['บนสุดของ Deck (ใบที่ ' + (top.length + 1) + ')', 'ใต้ Deck'], cb: k => { (k === 0 ? top : bot).push(R[0]); fin(); } });
    ask(r, i, { text: 'สอดแนม: เลือกการ์ดที่จะวางเป็น "ใบบนสุด" ลำดับที่ ' + (top.length + 1) + ' ของ Deck (ยกเลิก = ที่เหลือทั้งหมดไปใต้ Deck)', opts: R.map(c => c.u), cancel: true, cb: us => { top.push(cs.find(c => c.u === us[0])); topStep(); }, onCancel: botStep }); };
  topStep();
}
const frogsOf = (r, i) => r.p[i].av.filter(a => isAv(a) && a.id !== 'BT04-005' && nmOf(a).includes('กบ') && !nmOf(a).includes('กบฏ') && (a.bc || 0) >= 3);
const animalAv = (r, i) => r.p[i].av.filter(a => isAnimal(a)).map(a => a.u);
Object.assign(SUM, {
  'BT04-020': (r, i, x) => {   // อู๊ด ประธานผู้รู้ความจริง
    const seen = bt4Peek(r, i, 2, x), sum = seen.reduce((n, c) => n + (B[c.id].c || 0), 0);
    bt4Arrange(r, i, seen, () => { const T = r.p[1 - i].av.filter(a => !protectedFrom(r, i, a) && costNow(r, a) <= sum).map(a => a.u); if (!T.length) return log(r, 'จุติ อู๊ด: ไม่มี Avatar Cost ≤ ' + sum);
      ask(r, i, { text: 'จุติ: ทำลาย Avatar อีกฝ่าย 1 ใบ ที่ Cost ≤ ' + sum + ' (ผลรวม Cost ที่แสดง)', opts: T, cb: us => { vfx(us[0], 'burst', 'ทำลาย Cost ≤ ' + sum, '#a855f7'); destroyAv(r, us[0]); } }); });
  },
  'BT04-024': (r, i, x) => {   // นายนิรยบาล หมอ
    const p = r.p[i]; if (!p.hand.length) return log(r, 'จุติ หมอ: ไม่มีการ์ดบนมือให้ทิ้ง');
    ask(r, i, { text: 'จุติ: ทิ้งการ์ดจากมือ 1 ใบ → ธรณีสูบ 3 ใบ แล้วอัญเชิญ Avatar {นรก} Cost ≤ 4 จากนรก (ยกเลิก = ไม่ใช้)', opts: p.hand.map(c => c.u), cancel: true, cb: us => {
      const c = fromZone(r, i, 'hand', us[0]); if (!c) return; p.hell.push(c); mill(r, i, 3, x);
      r.g.q.push(() => ask(r, i, { text: 'เลือก Avatar {นรก} Cost ≤ 4 จากนรก อัญเชิญลงสนาม', opts: p.hell.filter(h => isAv(h) && symOf(h) === 'นรก' && B[h.id].c <= 4).map(h => h.u), cb: u2 => { if (summonAny(r, i, u2[0], 'hell')) vfx(u2[0], 'burst', 'อัญเชิญจากนรก', '#7c3aed'); } }));
    } });
  },
  'BT04-025': (r, i, x) => {   // ครูแกง สอนเลข: ผลรวม POWER ฝ่ายไหนเป็นจำนวนเฉพาะ ทำลาย Avatar ทุกตัวฝ่ายนั้น
    const sums = [0, 1].map(k => r.p[k].av.reduce((n, a) => n + P(r, a), 0)); log(r, '🔢 ครูแกง: POWER รวม ' + r.p[0].name + ' = ' + sums[0] + ', ' + r.p[1].name + ' = ' + sums[1]);
    [0, 1].forEach(k => { if (isPrime(sums[k])) { log(r, '💥 ' + sums[k] + ' เป็นจำนวนเฉพาะ: ทำลาย Avatar ทุกตัวของ ' + r.p[k].name); r.p[k].av.slice().forEach(a => { vfx(a.u, 'burst', 'จำนวนเฉพาะ ' + sums[k], '#ef4444'); destroyAv(r, a.u); }); } });
  },
});
Object.assign(AB, {
  'BT04-012': { z: 'av', steps: [], run: (r, i, cx) => {   // เอเลี่ยนทูตดาวอังคาร
    const p = r.p[i], go = us => { const sum = us.reduce((n, u) => n + (B[(p.hand.find(c => c.u === u) || { id: 'BT04-040' }).id].c || 0), 0); if (us.length) log(r, '🛰 แสดง Avatar ' + us.length + ' ใบ รวม Cost = ' + sum);
      const T = r.p[1 - i].av.filter(a => !protectedFrom(r, i, a) && P(r, a) === sum).map(a => a.u);
      const give = () => { if (!p.hand.length) return; ask(r, i, { text: 'เลือกการ์ดบนมือ 1 ใบ ให้ฝ่ายตรงข้าม', opts: p.hand.map(c => c.u), cb: u2 => { const c = fromZone(r, i, 'hand', u2[0]); if (c) { r.p[1 - i].hand.push(c); log(r, '🎁 ' + p.name + ' ให้การ์ด 1 ใบแก่ฝ่ายตรงข้าม'); } } }); };
      if (!T.length) { log(r, 'ไม่มี Avatar ที่ POWER = ' + sum); return give(); }
      ask(r, i, { text: 'ทำลาย Avatar อีกฝ่ายที่ POWER = ' + sum, opts: T, cb: u2 => { vfx(u2[0], 'burst', 'POWER = ' + sum, '#38bdf8'); destroyAv(r, u2[0]); r.g.q.unshift(give); } }); };
    const L = p.hand.filter(isAv).map(c => c.u);
    ask(r, i, { text: 'เอเลี่ยนทูต: เลือกแสดง Avatar บนมือกี่ใบก็ได้ (ผลรวม Cost = POWER เป้าหมาย)', opts: L, n: L.length, min: 0, cb: go, none: () => go([]) }); } },
  'BT04-028': { z: 'av', steps: [oneHand(1, 'ทิ้งการ์ดบนมือ 1 ใบ')],   // พญายักษ์ ทศกัณฑ์
    can: (r, i) => r.p[i].av.filter(a => !a.tk).length < 5 && r.p[i].deck.some(c => isAv(c) && symOf(c) === 'ยักษ์' && B[c.id].p === 3 && !B[c.id].n.includes('ทศกัณฑ์')),
    run: (r, i, cx) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && symOf(c) === 'ยักษ์' && B[c.id].p === 3 && !B[c.id].n.includes('ทศกัณฑ์')).map(c => c.u);
      ask(r, i, { text: 'เลือก Avatar {ยักษ์} POWER 3 (ไม่ใช่ทศกัณฑ์) จาก Deck อัญเชิญลงสนาม', opts: L, cb: us => { if (summonAny(r, i, us[0], 'deck')) vfx(us[0], 'burst', 'อัญเชิญยักษ์', '#22c55e'); shuf(p.deck); }, none: () => shuf(p.deck) }); } },
  'BT04-030': wearUse,   // มาติเนซ Tank Ranger: สวมให้รถถัง (ส่วนยกเลิก Magic จากสภาพสวมใส่ อยู่ใน castFinal)
  'BT04-033': { z: 'av', steps: [{ key: 'c', pay: 1, text: 'ทิ้ง Avatar "พนักงานอาบน้ำสัตว์" หรือ Avatar {สัตว์} จากมือ 1 ใบ', opts: handAv(c => B[c.id].n.includes('พนักงานอาบน้ำสัตว์') || symOf(c) === 'สัตว์') },
    { key: 't', text: 'เลือก Avatar {สัตว์} ใน Avatar Zone เรา POWER +1', opts: (r, i) => animalAv(r, i) }],   // เจ้าของร้านอาบน้ำสัตว์
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { addPw(t.c, 1); vfx(t.c.u, 'aura', 'POWER +1', '#22c55e'); log(r, '🐾 ' + nmOf(t.c) + ' POWER +1'); } } },
  'BT04-057': { z: 'land', can: (r, i) => r.p[i].av.some(isTruth), steps: [], run: (r, i) => { const seen = bt4Peek(r, i, 3, null); bt4Arrange(r, i, seen); } },   // สมาคมผู้รู้ความจริง
});
Object.assign(BT4A, {
  'BT04-010': (r, i, a) => {   // ไดโนกาฬสินธุ์: สอดแนม 5 (+1 ต่อ เทอราโนดอน) อัญเชิญ {กะปอม} กี่ใบก็ได้ พร้อม จุติ
    const p = r.p[i], n = 5 + p.av.filter(x => (CANON[x.id] || x.id) === 'BT04-011' && !noFx(r, x)).length, seen = bt4Peek(r, i, n, a);
    const L = seen.filter(c => p.deck.includes(c) && isAv(c) && symOf(c) === 'กะปอม').map(c => c.u);
    const fin = us => { us.forEach(u => { const c = p.deck.find(h => h.u === u); if (c && summonAny(r, i, u, 'deck')) { vfx(u, 'burst', 'อัญเชิญ กะปอม', '#38bdf8'); r.g.q.push(() => fxSummon(r, i, c)); } }); shuf(p.deck); };
    ask(r, i, { text: 'ไดโนกาฬสินธุ์: เลือก Avatar {กะปอม} กี่ใบก็ได้ อัญเชิญลงสนาม (ได้ จุติ) ที่เหลือกลับเข้า Deck แล้วสับ', opts: L, n: L.length, min: 0, cb: fin, none: () => shuf(p.deck) });
  },
  'BT04-021': (r, i, a) => {   // น้องสาม: สอดแนม 2 เพิ่ม POWER = POWER ผู้รู้ความจริงที่เจอ แล้วนำ 1 ใบขึ้นมือ
    const p = r.p[i], seen = bt4Peek(r, i, 2, a), tr = seen.filter(c => isAv(c) && isTruth(c)), sum = tr.reduce((n, c) => n + (B[c.id].p || 0), 0);
    if (sum) { addTp(a, sum); vfx(a.u, 'aura', 'POWER +' + sum, '#a855f7'); log(r, '🔮 น้องสาม POWER +' + sum); }
    const fin = got => bt4Arrange(r, i, seen.filter(c => c !== got)), L = tr.filter(c => p.deck.includes(c)).map(c => c.u);
    if (!L.length) return fin(null);
    ask(r, i, { text: 'เลือก Avatar "ผู้รู้ความจริง" 1 ใบจากที่สอดแนม ขึ้นมือ (ยกเลิก = ไม่นำ)', opts: L, cancel: true, cb: us => { const c = fromZone(r, i, 'deck', us[0]); c && p.hand.push(c); log(r, '✨ ' + p.name + ': นำ ' + (c ? B[c.id].n : '-') + ' ขึ้นมือ'); fin(c); }, onCancel: () => fin(null) });
  },
});
ATK_TRIG.add('BT04-010'); ATK_TRIG.add('BT04-021');
ABIL['BT04-005'] = { zone: 'hand', label: 'อัญเชิญ ยายกบ 1954 (ส่ง กบ ที่ได้รับ POWER ≥3 ครั้ง ลงนรก)', cond: (r, i) => frogsOf(r, i).length > 0, hint: 'ต้องมี Avatar "กบ" ที่ได้รับผลเพิ่ม POWER ≥ 3 ครั้งในสนาม',
  run: (r, i, c0) => { const p = r.p[i];
    ask(r, i, { text: 'ยายกบ: เลือก Avatar "กบ" (ได้รับเพิ่ม POWER ≥3 ครั้ง) ส่งลงนรก เพื่ออัญเชิญ (ยกเลิก = ไม่ใช้)', opts: frogsOf(r, i).map(a => a.u), cancel: true, cb: us => {
      const fr = find(r, us[0]); if (!fr) return; const pw = P(r, fr.c); sendHell(r, us[0]);
      const c = fromZone(r, i, 'hand', c0.u); if (!c) return; fx({ k: 'say', id: c.id, t: 'ยายกบมาแล้ว!' }); if (putAv(r, i, c, {})) { c.pw = (c.pw || 0) + pw; vfx(c.u, 'aura', 'POWER +' + pw, '#22c55e'); log(r, '🐸 ยายกบ 1954 POWER +' + pw + ' ตามกบที่ส่งลงนรก'); }
    } }); } };
KD_HAND['BT04-005'] = 1;
function bt4Paid(r, i, pc, summoned) {   // 023 / 035: ถูกจ่าย Cost
  const p = r.p[i];
  if (pc.id === 'BT04-023' && colOf(summoned) === 'ม่วง') r.g.q.push(() => { const s = bt4Peek(r, i, 1, null), c = s[0]; if (!c) return;
    ask(r, i, { text: 'วิไลวรรณ: ' + B[c.id].n + ' — วางไว้บนสุดของ Deck หรือส่งลงนรก?', choices: ['ไว้บนสุด', 'ส่งลงนรก'], cb: k => { if (k === 1) { const q = p.deck.indexOf(c); if (q >= 0) { p.deck.splice(q, 1); p.hell.push(c); log(r, '🕳 ส่ง ' + B[c.id].n + ' ลงนรก'); } } } }); });
  if (pc.id === 'BT04-035' && isPet(summoned)) r.g.q.push(() => ask(r, i, { text: 'แฟรงกี้: เลือก Avatar {สัตว์} 1 ใบ POWER +2 จนจบเทิร์น', opts: animalAv(r, i), cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, 2); vfx(t.c.u, 'aura', 'POWER +2', '#22c55e'); } } }));
}
function bt4End(r, prev) {   // End Phase: เสามงคล + ล้างธง
  r.p.forEach(q => q.av.forEach(a => { delete a.sw; }));
  r.p[prev].av.filter(a => a.id === 'BT04-029' && !noFx(r, a)).forEach(a => r.g.q.push(() => {
    const L = r.p[prev].hell.filter(h => isAv(h) && B[h.id].n.startsWith('ผู้เจริญ')).map(h => h.u); if (!L.length) return;
    ask(r, prev, { text: 'เสามงคล: อัญเชิญ Avatar "ผู้เจริญ" 1 ใบ จากนรก', opts: L, cb: us => { if (summonAny(r, prev, us[0], 'hell')) vfx(a.u, 'aura', 'อัญเชิญ ผู้เจริญ', '#22c55e'); } }); }));
}
function bt4Win(r, p, a, d, res) {   // 015 คุณดีไมส์: ทำลาย Avatar สำเร็จ → ทิ้ง 1 ใบ กลับเป็นสภาพตื่น
  if (res !== 'win' || a.id !== 'BT04-015' || noFx(r, a) || !landIs(r, 'SD05-014') || !find(r, a.u) || !a.tired) return;
  r.g.q.push(() => { if (!r.p[p.ai].hand.length || !a.tired) return; ask(r, p.ai, { text: 'คุณดีไมส์: ทิ้งการ์ดบนมือ 1 ใบ เพื่อกลับเป็นสภาพตื่น (ยกเลิก = ไม่ใช้)', opts: r.p[p.ai].hand.map(c => c.u), cancel: true, cb: us => { sendHell(r, us[0]); a.tired = false; vfx(a.u, 'aura', 'กลับเป็นสภาพตื่น', '#38bdf8'); log(r, '🌊 คุณดีไมส์ กลับเป็นสภาพตื่น'); } }); });
}
const bt4AtkBonus = (r, a) => (landIs(r, 'BT04-059') && !a.tk && symOf(a) === 'รัททาทุย') ? 2 : 0;
function bt4Swap(r, a, d, pa, pd) {   // 052 กลับหลังหัน: สลับ Cost กับ POWER จนจบการต่อสู้
  if (a.sw) { pa = costNow(r, a); delete a.sw; vfx(a.u, 'aura', 'สลับ Cost↔POWER', '#f97316'); log(r, '🔄 ' + nmOf(a) + ' POWER = Cost ' + pa); }
  if (d.sw) { pd = costNow(r, d); delete d.sw; vfx(d.u, 'aura', 'สลับ Cost↔POWER', '#f97316'); log(r, '🔄 ' + nmOf(d) + ' POWER = Cost ' + pd); }
  return [pa, pd];
}
function bt4Guard(r, kl, a, d) {   // 018 รัททาทุย 2 หัว: เทิร์นละครั้ง ถูกทำลายจากการต่อสู้ → POWER -1 แทน
  return kl.filter(u => { const m = u === a.u ? a : d; if (m.id !== 'BT04-018' || noFx(r, m) || m.ou18 === r.g.n || P(r, m) < 1) return true;
    m.ou18 = r.g.n; addPw(m, -1); vfx(m.u, 'burst', 'ไม่ถูกทำลาย POWER -1', '#38bdf8'); log(r, '🛡 รัททาทุย 2 หัว: POWER -1 แทนการถูกทำลาย'); return false; });
}
function bt4Sweep(r) {   // 018: POWER = 0 ทำลายทันที
  r.p.forEach((q, qi) => q.av.filter(a => a.id === 'BT04-018' && !noFx(r, a) && !a.z18 && P(r, a) === 0).forEach(a => { a.z18 = 1; r.g.q.push(() => { delete a.z18; if (find(r, a.u) && P(r, a) === 0) { log(r, '💥 รัททาทุย 2 หัว POWER = 0 ถูกทำลาย'); kill(r, qi, a.u); } }); }));
}
const mods = (r, i) => r.p[i].mg.filter(m => B[m.id].st === 'Modification').map(m => m.u);
Object.assign(MG, {
  'BT04-042': { cond: r => allAv(r).length === 6, run: (r, i) => {   // Grand Rumble !!!!
    const A = allAv(r).map(a => a.x), nums = [1, 2, 3, 4, 5, 6], asg = new Map();
    const step = k => { if (k >= A.length) { const d = 1 + Math.floor(Math.random() * 6); log(r, '🎲 Grand Rumble: ทอยได้ ' + d); fx({ k: 'vfx', u: null, t: 'burst', txt: '🎲 ' + d, c: '#facc15' });
        A.forEach(a => { if (asg.get(a.u) !== d) { vfx(a.u, 'burst', 'ถูกทำลาย', '#ef4444'); destroyAv(r, a.u); } else vfx(a.u, 'aura', 'รอด! เลข ' + d, '#22c55e'); }); return; }
      if (k === A.length - 1) { asg.set(A[k].u, nums[0]); return step(k + 1); }
      ask(r, i, { text: 'กำหนดเลข 1-6 ให้ ' + nmOf(A[k]) + ' (' + A.length + ' ใบ ห้ามซ้ำ)', choices: nums.map(n => 'เลข ' + n), cb: q => { asg.set(A[k].u, nums[q]); nums.splice(q, 1); step(k + 1); } }); };
    step(0); } },
  'BT04-043': { steps: [{ key: 's', pay: 1, text: 'เซ่นไหว้ Avatar เครื่องจักร บนสนามเรา 1 ใบ', opts: myAv(isRobot) }, { key: 't', text: 'เลือก Avatar บนสนาม 1 ใบ ทำลาย', opts: (r, i) => allAvT(r, i) }],   // แผนการ : ถอยรถชน
    run: (r, i, cx) => { vfx(cx.pick.t[0], 'burst', 'ถอยรถชน!', '#ef4444'); destroyAv(r, cx.pick.t[0]); log(r, '🚗 ถอยรถชน: ทำลาย Avatar'); } },
  'BT04-045': { run: (r, i) => {   // ใครเจ๋งกว่า !
    const pick = (who, cb) => { const L = r.p[who].hand.filter(isAv).map(c => c.u); if (!L.length) { log(r, '🃏 ' + r.p[who].name + ' ไม่มีการ์ดที่มี Cost: แสดงมือทั้งหมด (' + r.p[who].hand.map(c => B[c.id].n).join(', ') + ')'); return cb(null); }
      ask(r, who, { text: 'ใครเจ๋งกว่า: เลือกแสดงการ์ดที่มี Cost บนมือ 1 ใบ', opts: L, cb: us => cb(r.p[who].hand.find(c => c.u === us[0])) }); };
    pick(i, a => pick(1 - i, b => { if (!a || !b) return;
      const ca = B[a.id].c || 0, cb2 = B[b.id].c || 0; log(r, '⚔ ' + B[a.id].n + ' (Cost ' + ca + ') vs ' + B[b.id].n + ' (Cost ' + cb2 + ')');
      if (ca === cb2) { [[i, a], [1 - i, b]].forEach(([w, c]) => { const q = fromZone(r, w, 'hand', c.u); if (q) { r.p[w].deck.push(q); shuf(r.p[w].deck); } }); return log(r, 'Cost เท่ากัน: ทั้งสองกลับเข้า Deck แล้วสับ'); }
      const [lw, lc] = ca < cb2 ? [i, a] : [1 - i, b]; const q = fromZone(r, lw, 'hand', lc.u); if (q) { r.p[lw].hell.push(q); log(r, '🗑 ' + r.p[lw].name + ' ทิ้ง ' + B[q.id].n + ' ลงนรก'); } })); } },
  'BT04-047': { cond: (r, i) => r.p[i].av.some(isTruth), steps: [{ key: 'c', text: 'แสดงการ์ดจาก Deck 1 ใบ (หลังสับจะวางไว้บนสุด)', opts: (r, i) => r.p[i].deck.map(c => c.u) }],   // ความจริงงงงงงง
    run: (r, i, cx) => { const p = r.p[i], c = fromZone(r, i, 'deck', cx.pick.c[0]); shuf(p.deck); if (c) { p.deck.push(c); log(r, '🔮 ' + p.name + ': แสดง ' + B[c.id].n + ' สับ Deck แล้ววางไว้บนสุด'); fx({ k: 'scout', i, ids: [c.kd || c.id] }); } } },
  'BT04-049': { react: 'never' },   // เอาไปอยู่ด้วย: ทำงานอัตโนมัติผ่าน bt4Death (ถามเมื่อ Avatar {ผี} ถูกทำลายโดยการ์ดฝ่ายตรงข้าม)
  'BT04-051': { react: 1, cond: r => mods(r, 0).length > 0 && mods(r, 1).length > 0,   // ลดราคาล้นตลาด
    steps: [{ key: 'a', text: 'เลือก Modification Magic ของเรา 1 ใบ ส่งลงนรก', opts: (r, i) => mods(r, i) }, { key: 'b', text: 'เลือก Modification Magic ของฝ่ายตรงข้าม 1 ใบ ส่งลงนรก', opts: (r, i) => mods(r, 1 - i) }],
    run: (r, i, cx) => { destroyAny(r, cx.pick.a[0]); destroyAny(r, cx.pick.b[0]); log(r, '🏷 ลดราคาล้นตลาด: Modification ฝ่ายละ 1 ใบ ลงนรก'); } },
  'BT04-052': { react: 'atkav', steps: [{ key: 't', text: 'เลือก Avatar ที่กำลังต่อสู้ 1 ใบ (สลับ Cost↔POWER จนจบการต่อสู้)', opts: (r, i, cx) => [cx.pend.u, cx.pend.tg].filter(u => { const f = find(r, u); return f && f.z === 'av'; }) }],   // กลับหลังหัน !!!
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { t.c.sw = 1; vfx(t.c.u, 'aura', 'กลับหลังหัน!', '#f97316'); log(r, '🔄 กลับหลังหัน: ' + nmOf(t.c) + ' สลับ Cost↔POWER'); } } },
  'BT04-055': { mod: 1 },   // ดาบพิฆาตสวรรค์: Cost +2 (costNow) / ถ้า Cost ≥ 6 POWER +1 (mod04)
  'BT04-056': { mod: 1, tgf: x => (nmOf(x).includes('ทหาร') || nmOf(x).includes('รด.')) && symOf(x) === 'คน' },   // ปืนเล็กยาว: POWER +3 (ใน P)
  'BT04-058': {}, 'BT04-059': {}, 'BT04-060': {},   // Land แบบต่อเนื่อง: ผลอยู่ใน lifeDown / canPlaceAv+bt4AtkBonus / P
});
Object.assign(CANON, { 'BT04-053': 'KD04-014',
  'BT05-058': 'KD02-017', 'PRMO-100': 'KD02-017', 'SL02-007': 'KD02-017',   // อย่าให้มีครั้งที่ 2 (ฉบับพิมพ์ซ้ำ)
  'ODY1-069': 'SD05-020', 'PRMO-056': 'SD05-020', 'SL01-006': 'SD05-020', 'CC02-061': 'SD05-020' });   // ชายจากอนาคต (ฉบับพิมพ์ซ้ำ)
CARDS.forEach(c => { if (!/^(PRMO|FPRO|ODY1|CC0)/.test(c.id) || CANON[c.id]) return; const t = CARDS.find(o => o.id.startsWith('BT04-') && o.n === c.n && o.e === c.e && o.t === c.t && o.c === c.c && o.p === c.p && o.s === c.s); if (t) CANON[c.id] = CANON[t.id] || t.id; });   // พิมพ์ซ้ำ (PRMO ฯลฯ) ที่ข้อความเหมือน BT04 ทุกตัวอักษร ใช้สกิลเดียวกัน
{ const w = d => { if (d.__w) return; d.__w = 1; if (d.steps) d.steps = d.steps.map(s => ({ ...s, opts: (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return s.opts(...a); } finally { MGX--; MGWHO = o; } } })); if (d.run) { const f = d.run; d.run = (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return f(...a); } finally { MGX--; MGWHO = o; } }; } };   // 016 ริกกี้ คุณตา: ไม่รับผลจาก Magic ฝ่ายตรงข้าม
  Object.keys(MG).forEach(k => w(MG[k])); }

/* ===== BOT: โหมดเล่นกับบอท (ง่าย/กลาง/ยาก) =====
   บอทเป็นผู้เล่นฝั่ง 2 ที่ไม่มี WebSocket รันในเซิร์ฟเวอร์ และสั่งงานผ่าน act() ตัวเดียวกับผู้เล่นจริง
   จึงถูกบังคับด้วยกฎเกมชุดเดียวกัน (ถ้า act() โยน error บอทจะลองทางเลือกสำรองแทน) */
const BOT_LV = { 1: { n: 'ง่าย', win: 30 }, 2: { n: 'กลาง', win: 50 }, 3: { n: 'ยาก', win: 80 } }, BOT_LOSE = 10;
const botDeck = () => preDeck(pick(Object.keys(ST).filter(k => /^SD0[1-8]$/.test(k))));
const botIdx = r => r.p.findIndex(p => p.bot);
// คะแนนความ "มีค่า" ของการ์ด (ใช้เทียบเป้าหมาย / เลือกใบที่จะจ่ายเป็น Cost)
const botCv = (r, x) => { if (x.tk) return (x.tk.p || 0) + 1; const d = B[x.id]; if (!d) return 0; const f = find(r, x.u);
  return (f && f.z === 'av' ? P(r, x) : (d.p || 0)) + (d.c || 0) * .6 + (d.t === 'Avatar' ? 1 : 0) + (d.t === 'Magic' && f && f.z === 'hand' ? (BOT_REACT.has(d.id) ? 3.5 : 1.5) : 0); };   // ยาก: Magic/React บนมือมีค่า ไม่เอาไปจ่าย Cost ง่ายๆ
const botSync = r => { bc(r); settle(r).catch(() => { }); };
function botAct(r, k, m) {
  const bt = r.bot;
  try { act(r, k, m); bt.fail = 0; botSync(r); return true; }
  catch (e) { bt.fail++; if (typeof e !== 'string') console.error('bot', e); botSync(r); return false; }
}
// เลือกการ์ดบนมือจ่ายเป็น Cost: ชุดที่ Gem พอและ "เสียของน้อยที่สุด"
function botPay(r, k, card) {
  const c = B[card.id], me = r.p[k]; if (!c.c) return { us: [], keep: 0 };
  const av = c.t === 'Avatar';
  const pool = me.hand.filter(h => h.u !== card.u && B[h.id].g && !(B[h.id].gc && c.col && B[h.id].gc !== c.col) && !(me.noCost || []).includes(B[h.id].n) && !(h.id === 'SD08-010' && !(av && isRat(card)))).slice(0, 10);
  let best = null;
  for (let m = 1; m < (1 << pool.length); m++) {
    let sum = 0, keep = 0, n = 0;
    for (let j = 0; j < pool.length; j++) if (m >> j & 1) { sum += B[pool[j].id].g; keep += botCv(r, pool[j]); n++; }
    if (sum < c.c) continue;
    const sc = keep + (sum - c.c) * 1.5 + n * .2;
    if (!best || sc < best.sc) best = { sc, keep, us: pool.filter((_, j) => m >> j & 1).map(h => h.u) };
  }
  return best;
}
function botMull(r, k) {
  const me = r.p[k], us = r.bot.lv === 1 ? [] : me.hand.filter(h => B[h.id].t === 'Avatar' && B[h.id].c >= 5).slice(0, 2).map(h => h.u);
  return botAct(r, k, { t: 'mull', us });
}
function botMain(r, k) {
  const g = r.g, me = r.p[k], bt = r.bot, lv = bt.lv, T = bt.tried, ops = [];
  me.hand.forEach(h => {
    const d = B[h.id]; if (!d || T.has('s' + h.u)) return;
    if (d.t === 'Avatar') { if (h.id === 'SD03-003' || (g.lim && g.lim[k] && d.s !== g.lim[k]) || !canPlaceAv(r, k, h)) return; }
    else if (d.t === 'Construct') { if (me.co.length >= 3 || me.co.some(x => B[x.id].n === d.n)) return; }
    else return;
    const pay = botPay(r, k, h); if (!pay) return;
    ops.push({ h, d, pay, gain: botCv(r, h) - pay.keep * .45 + (d.t === 'Avatar' && me.av.length < 3 ? 2 : 0) - (d.t === 'Construct' ? 1.5 : 0) });
  });
  ops.sort((a, b) => b.gain - a.gain);
  const o = lv === 1 ? (ops.length && Math.random() < .75 ? pick(ops) : null) : ops.find(x => x.gain > (lv === 3 ? -1.5 : -2.5));
  if (o) { T.add('s' + o.h.u); return botAct(r, k, { t: o.d.t === 'Avatar' ? 'summon' : 'build', u: o.h.u, pay: o.pay.us }); }
  if (lv >= 2) {
    for (const h of me.hand) {   // ร่าย Magic (เฉพาะที่ระบบรองรับ ไม่ใช่ React)
      const d = B[h.id]; if (!d || d.t !== 'Magic' || d.st === 'React' || d.id === 'BT02-041' || T.has('m' + h.u)) continue;   // BT02-041 หงาย LIFE ตัวเองทุกใบ บอทไม่ใช้
      if (!(MG[d.id] || d.st === 'Modification') || g.used[k][d.st]) continue;
      T.add('m' + h.u); if (lv === 2 && Math.random() < .4) continue;
      if (botAct(r, k, { t: 'cast', u: h.u })) return true;
    }
    for (const [x, z] of [...me.av.map(x => [x, 'av']), ...me.mg.map(x => [x, 'mg']), ...me.co.map(x => [x, 'co'])]) {   // ใช้ความสามารถ
      if (T.has('u' + x.u) || !abOf(r, k, x, z)) continue;
      T.add('u' + x.u); if (botAct(r, k, { t: 'use', u: x.u })) return true;
    }
  }
  return botAct(r, k, { t: 'next' });
}
function botBattle(r, k) {
  const g = r.g, me = r.p[k], op = r.p[1 - k], bt = r.bot, lv = bt.lv, T = bt.tried, opts = [];
  const ready = me.av.filter(a => !a.tired && !T.has('a' + a.u)).length;   // ตัวที่ยังตีได้ในเทิร์นนี้
  const stall = g.n >= 14;                                                  // เกมนิ่งนานแล้ว -> ต้องกดดัน
  const ahead = me.av.length > op.av.length;                                // เรามี Avatar มากกว่า -> แลกได้
  const supOk = q => !q.tired && !q.tk && !T.has('a' + q.u) && (/สามัคคี|แทงหลัง/.test(B[q.id].e || '') || hasKw(r, q, 'สามัคคี')) && (/แทงหลัง/.test(B[q.id].e || '') || !op.co.some(x => x.id === 'SD07-020'));
  me.av.forEach(a => {
    if (a.tired || T.has('a' + a.u)) return;
    if ((a.id === 'BT02-024' && !noFx(r, a)) || ((a.id === 'BT02-029' || a.id === 'SD04-004') && !(a.wr && a.wr.length))) return;
    const pa = P(r, a), my = botCv(r, a);
    if (!a.nolife && pa > 0 && (!op.av.length || kick(r, a)) && !(a.id === 'SD06-003' && !hasCamp(r, k)))
      opts.push({ a, tg: 'life', sc: op.life.every(l => l.up) ? 1000 : 8 + pa + (lv === 3 && !op.av.length && ready >= op.life.filter(l => !l.up).length ? 100 : 0) });   // ยาก: ถ้าทุกตัวที่พร้อมตี LIFE ที่เหลือได้หมด = ปิดเกม   // LIFE หงายหมด = ชนะทันที
    op.av.forEach(d => {
      const pd = P(r, d), dv = botCv(r, d), clear = lv === 3 && op.av.length <= ready ? 3 : 0;   // ยาก: ถ้ากวาดสนามได้ จะเปิดทางตี LIFE
      if (pa > pd) opts.push({ a, tg: d.u, sc: 2 + dv + clear - (lv === 3 ? (pa - pd) * .15 : 0) });   // ยาก: ใช้ตัวที่แรงพอดี เก็บตัวแรงไว้ตีเป้าใหญ่/LIFE                                  // ชนะและไม่ตาย
      else if (pa === pd && pa > 0 && lv >= 2 && (dv >= my - .5 || ahead || stall || (lv === 3 && clear))) opts.push({ a, tg: d.u, sc: 1 + dv - my * .5 + clear });  // กลาง/ยาก: แลกเมื่อคุ้ม/ได้เปรียบ/เกมนิ่ง
      else if (lv === 1 && Math.random() < .3) opts.push({ a, tg: d.u, sc: .1 });                 // ง่าย: บางทีก็ตีมั่ว
      if (lv === 3 && pa <= pd && dv >= 2.5) {   // ยาก: เรียกสามัคคี/แทงหลังมารวมพลัง ถ้าทำให้ชนะเป้าที่มีค่าได้
        const S2 = me.av.filter(q => q.u !== a.u && supOk(q)).map(q => ({ q, b: P(r, q) + (/แทงหลัง/.test(B[q.id].e || '') ? 1 : 0) })).sort((x, y) => y.b - x.b);
        let tot = 0; const us = []; for (const s2 of S2) { if (pa + tot > pd) break; tot += s2.b; us.push(s2.q.u); }
        if (us.length && pa + tot > pd) opts.push({ a, tg: d.u, sup: us, sc: 2 + dv - us.length * 1.2 });
      }
    });
    op.co.forEach(d => { const pd = (B[d.id].p || 0) + (d.pw || 0); if (pa > pd) opts.push({ a, tg: d.u, sc: 1.5 + pd * .3 }); });
  });
  if (!opts.length) { me.av.forEach(a => T.add('a' + a.u)); return false; }
  opts.sort((x, y) => y.sc - x.sc);
  const o = lv === 1 ? pick(opts.slice(0, 3)) : opts[0];
  T.add('a' + o.a.u); (o.sup || []).forEach(u => T.add('a' + u)); botAct(r, k, { t: 'atk', u: o.a.u, tg: o.tg, sup: o.sup || [] }); return true;
}
function botEnd(r, k) {
  const me = r.p[k];
  if (me.hand.length > 7) return botAct(r, k, { t: 'discardm', us: me.hand.slice().sort((a, b) => botCv(r, a) - botCv(r, b)).slice(0, me.hand.length - 7).map(c => c.u) });
  return botAct(r, k, { t: 'next' });
}
// เลือกเป้าหมายตอบคำถามของสกิล: จ่าย Cost -> ใบของเราที่ไม่สำคัญ / ทำลาย-ลด POWER -> ศัตรูที่แรงสุด / อื่นๆ -> ใบของเราที่ดีสุด
function botSel(r, k, a) {
  const cs = a.cards || [], own = u => { const c = cs.find(x => x.u === u); return c ? c.i === k : true; };
  const val = u => { const f = allCards(r, u); return f ? botCv(r, f.c) : 0; };
  const t = a.text || '', n = a.n, min = a.min;
  const cost = /ฝ่ายเรา|ทิ้ง|ส่ง.*ลงนรก|เซ่นไหว้|เป็น Cost|ให้อีกฝ่าย/.test(t), harm = !cost && /ทำลาย|POWER -|ยึด|ศัตรู|กลับขึ้นมือ/.test(t);
  let pool = a.opts.slice(), cnt;
  if (cost) { const o = pool.filter(own); if (o.length >= min) pool = o; pool.sort((x, y) => val(x) - val(y)); cnt = min; }
  else if (harm) { const e = pool.filter(u => !own(u)); if (e.length) { pool = e.sort((x, y) => val(y) - val(x)); cnt = n; } else { pool.sort((x, y) => val(x) - val(y)); cnt = min; } }
  else { const o = pool.filter(own); if (o.length) pool = o; pool.sort((x, y) => val(y) - val(x)); cnt = n; }
  cnt = Math.max(min, Math.min(n, cnt));
  if (pool.length < cnt) pool = a.opts.slice();
  const bm = t.match(/Cost รวมไม่เกิน\s*(\d+)/);   // มีงบ Cost -> เลือกตามลำดับความสำคัญแต่ไม่เกินงบ
  if (bm) { let sum = 0; const out = []; for (const u of pool) { const f = allCards(r, u), cc = f && B[f.c.id] ? (B[f.c.id].c || 0) : 0; if (out.length < n && sum + cc <= +bm[1]) { out.push(u); sum += cc; } } return out; }
  return pool.slice(0, cnt);
}
function botAsk(r, k) {
  const a = r.g.ask, lv = r.bot.lv, rnd = lv === 1 && Math.random() < .4, bt = r.bot;
  bt.ar = (bt.ak === a.text ? bt.ar + 1 : 1); bt.ak = a.text;   // คำถามเดิมวนซ้ำ = คำตอบเราไม่ผ่านเงื่อนไขในใจเซิร์ฟเวอร์ -> ตอบแบบ "ไม่เลือก" กันลูป
  if (bt.ar >= 3 && !a.yn && !a.choices) { bt.ar = 0; if (botAct(r, k, { t: 'pick', us: a.opts.slice(0, a.min) })) return; if (a.cancel) return botAct(r, k, { t: 'pick', cancel: 1 }); }
  let m;
  if (a.choices) m = { t: 'pick', i: rnd ? Math.floor(Math.random() * a.choices.length) : 0 };
  else if (a.yn) {
    const tx = a.text || ''; let y = /ทิ้งการ์ดทั้งหมด/.test(tx) ? +(lv === 3 && r.p[k].hand.length <= 2) : (rnd ? +(Math.random() < .5) : 1);
    if (/^อู๊ดลูกเสือ: เซ่นไหว้/.test(tx)) { const h = a.hint || {}, at = find(r, h.u), tg = find(r, h.tg); y = +(lv >= 2 && !!at && !!tg && P(r, at.c) >= P(r, tg.c)); }   // เซ่นไหว้ก็ต่อเมื่อเป้าจะตาย
    if (/^คนรวย:/.test(tx)) y = +(lv >= 2);
    m = { t: 'pick', yes: y };
  }
  else m = { t: 'pick', us: botSel(r, k, a) };
  if (botAct(r, k, m)) return;
  if (a.cancel) return botAct(r, k, { t: 'pick', cancel: 1 });           // ตอบไม่ได้ -> ยกเลิก ไม่ให้เกมค้าง
  if (!a.yn && !a.choices) return botAct(r, k, { t: 'pick', us: a.opts.slice(0, a.min) });
  if (a.yn) botAct(r, k, { t: 'pick', yes: 0 });
}
function botStep(r, k) {
  const g = r.g, bt = r.bot, me = r.p[k];
  if (g.ask) { if (g.ask.who === k) botAsk(r, k); return; }
  if (g.pend) {
    if (g.pend.who === k) { if (bt.lv === 3 && botReact(r, k)) return; botAct(r, k, { t: 'pass' }); }
    else if (!hasReact(r, g.pend.who)) { passReact(r); botSync(r); }   // ผู้เล่นไม่มี React บนมือ -> ข้ามช่วงตอบโต้ให้ ไม่ต้องรอ/กด Pass
    return;
  }
  if (g.phase === 'pick') { if (g.dw === k) botAct(r, k, { t: 'first', v: bt.lv === 1 ? +(Math.random() < .5) : 1 }); return; }
  if (g.phase === 'mull') { if (!me.m && (g.turn === k || r.p[g.turn].m)) botMull(r, k); return; }
  if (g.turn !== k) return;
  if (g.phase === 'main') return botMain(r, k);
  if (g.phase === 'battle') { if (!botBattle(r, k)) botAct(r, k, { t: 'next' }); return; }
  if (g.phase === 'end') return botEnd(r, k);
}
const BOT_REACT = new Set(['BT03-047', 'SD01-017', 'BT01-039', 'BT02-049', 'SD06-014', 'BT02-054', 'SD07-016', 'SD05-020', 'BT01-041']);
function botReact(r, k) {
  const g = r.g, p = g.pend, me = r.p[k], T = r.bot.tried; if (g.used[k].React) return false;
  const atF = p.k === 'atk' ? find(r, p.u) : null, tgF = p.k === 'atk' && p.tk === 'av' ? find(r, p.tg) : null;
  for (const h of me.hand) {
    const d = B[h.id]; if (!d || d.t !== 'Magic' || d.st !== 'React' || !BOT_REACT.has(h.id)) continue;
    const key = 'r' + h.u + ':' + (p.u || (p.ev && p.ev.u)); if (T.has(key)) continue;
    const def = MG[h.id]; if (!def || !reactOK(r, k, d, def)) continue;
    let go = false;
    if (h.id === 'SD01-017') { const f = p.ev && find(r, p.ev.u); go = !!f && botCv(r, f.c) >= 3; }
    else if (h.id === 'BT01-039') go = !!atF && botCv(r, atF.c) >= 2.5;
    else if (h.id === 'BT02-049') go = me.hand.length <= 5;
    else if (h.id === 'SD06-014' || h.id === 'BT02-054') { const red = 2 * (me.av.length + me.mg.length + me.co.length + me.hand.length - 1); go = !!atF && !!tgF && P(r, atF.c) >= P(r, tgF.c) && P(r, atF.c) - red < P(r, tgF.c); }
    else if (h.id === 'BT03-047') { const f = p.ev && p.ev.k === 'summon' && find(r, p.ev.u); go = !!f && f.i !== k && botCv(r, f.c) >= 3; }
    else if (h.id === 'SD07-016') go = !!atF && !!tgF && P(r, atF.c) >= P(r, tgF.c) && botCv(r, tgF.c) >= 3;
    else go = !!p.ev && p.ev.k === 'cast';   // ชายจากอนาคต: ยกเลิก Magic ของอีกฝ่าย
    if (!go) continue;
    T.add(key); if (botAct(r, k, { t: 'cast', u: h.u })) return true;
  }
  return false;
}
function botTick() {
  const now = Date.now();
  for (const c in rooms) {
    const r = rooms[c], g = r.g; if (!r.bot || !g || g.over) continue;
    const bt = r.bot, k = botIdx(r), hu = r.p[1 - k];
    if (!hu.ws || hu.ws.readyState !== 1 || hu.dc || now < bt.at) continue;
    bt.at = now + (bt.lv === 3 ? 500 : 800) + Math.random() * 500;
    CR = r; if (bt.tn !== g.n) { bt.tn = g.n; bt.tried = new Set(); }
    try { botStep(r, k); } catch (e) { console.error('bot', e); bt.fail++; }
    if (bt.fail >= 10 && !g.over) { bt.fail = 0; console.error('bot stuck -> surrender', c); botAct(r, k, { t: 'surrender' }); }
  }
}
setInterval(botTick, 300);

srv.listen(process.env.PORT || 3000, () => console.log('ready'));
// กันหลุดเอง: ส่ง ping ทุก 25 วิ ให้ proxy ไม่ตัด WebSocket ที่นิ่งๆ (เช่นเล่นกับบอท)
setInterval(() => { try { wss.clients.forEach(w => { if (w.readyState === 1) w.ping(); }); } catch (e) { } }, 25000);
// กัน Render หลับระหว่างมีห้องเปิดอยู่ (ห้องเก็บในหน่วยความจำ ถ้าเซิร์ฟเวอร์หลับ/รีสตาร์ท ห้องจะหาย)
if (process.env.RENDER_EXTERNAL_URL) setInterval(() => { if (Object.keys(rooms).length) fetch(process.env.RENDER_EXTERNAL_URL + '/health').catch(() => { }); }, 6 * 60 * 1000);
process.on('SIGTERM', () => console.log('SIGTERM: server restarting, rooms lost:', Object.keys(rooms).length));
if (process.env.BOT_TEST) module.exports = { kdMulti, kdProto, kdRich, rooms, act, inst, find, P, B, view, sview, runQ, wss, shuf, destroyCo, pack, mig, pushFst, friendStat, userWs, kill, resolveAtk, passTurn, startTurn, putAv, kdNarai, kdAfter, exileAv, kdLife, fxSummon, summonFree, ask, hit, setBt, open };