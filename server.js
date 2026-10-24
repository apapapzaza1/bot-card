const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf8'));
const B = {}; CARDS.forEach(c => B[c.id] = c);
const MT = { '.json': 'application/json', '.html': 'text/html;charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const srv = http.createServer((q, r) => {
  let f = path.basename(q.url.split('?')[0]) || 'index.html';
  if (!MT[path.extname(f)] || f === 'package.json' || !fs.existsSync(path.join(__dirname, f))) f = 'index.html';
  r.writeHead(200, { 'Content-Type': MT[path.extname(f)] });
  fs.createReadStream(path.join(__dirname, f)).pipe(r);
});
const crypto = require('crypto');
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY, SEC = process.env.SECRET || crypto.createHash('sha256').update('bot:' + (process.env.SUPABASE_KEY || 'dev')).digest('hex'), ADMIN = (process.env.ADMIN_USER || '').toLowerCase();
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, mem = {};
const dbGet = async n => { if (!SB) return mem[n]; const a = await (await fetch(`${SB}/rest/v1/users?name=eq.${encodeURIComponent(n)}&select=d`, { headers: H })).json(); return a[0] && a[0].d; };
const dbPut = async (n, d) => { if (!SB) { mem[n] = d; return; } const r = await fetch(`${SB}/rest/v1/users`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ name: n, d }) }); if (!r.ok) throw 'บันทึกข้อมูลไม่สำเร็จ'; };
const hash = (pw, s) => crypto.scryptSync(pw, s, 32).toString('hex');
const sign = n => { const p = n + '|' + (Date.now() + 90 * 864e5); return Buffer.from(p).toString('base64') + '.' + crypto.createHmac('sha256', SEC).update(p).digest('hex'); };
const unsign = t => { try { const [b, s] = t.split('.'), p = Buffer.from(b, 'base64').toString(); if (crypto.createHmac('sha256', SEC).update(p).digest('hex') !== s) return; const [n, e] = p.split('|'); return +e > Date.now() ? n : null; } catch (e) { } };
const prof = (n, d) => ({ name: n, gems: d.gems, cards: d.cards, admin: n === ADMIN, decks: d.decks || {}, fr: d.fr || [], rq: d.rq || [], pity: d.pity || 0, bought: d.bought || [] });
const ST = JSON.parse(fs.readFileSync(path.join(__dirname, 'starters.json'), 'utf8'));
const giveSt = (d, k) => ST[k].main.concat(ST[k].life).forEach(([id, n, r]) => { for (let j = 0; j < n; j++) add(d, { id, r }); });
const SETS = ['BT01', 'BT02', 'BT03', 'BT04', 'BT05', 'BT06', 'BT07', 'BT08', 'BT09', 'BT10', 'BT11'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const add = (d, x) => { const k = x.id + '|' + x.r; d.cards[k] = (d.cards[k] || 0) + 1; };
function pack(set, gar) { // สมมติฐาน: 3 Common + 1 Rare + 1 ช่องลุ้น (ปรับอัตราได้ที่นี่)
  const R = []; CARDS.forEach(c => c.id.startsWith(set + '-') && c.v.forEach(r => R.push({ id: c.id, r })));
  const by = r => R.filter(x => x.r === r), w = () => { const x = Math.random(); return gar ? (x < .7 ? 'UR' : 'SCR') : x < .62 ? 'R' : x < .9 ? 'SR' : x < .98 ? 'UR' : 'SCR'; };
  const g = r => { const a = by(r); return a.length ? pick(a) : pick(by('C').length ? by('C') : R); };
  return [g('C'), g('C'), g('C'), g('R'), g(w())];
}
function preDeck(s) { const x = ST[s]; return { main: x.main.flatMap(([id, n]) => Array(n).fill(id)), life: x.life.map(([id]) => id) }; }
async function pickDeck(m, user, ban) {
  if (m.mine) { const u = await dbGet(user), k = u.decks && u.decks[m.mine]; if (!k) E('ไม่พบเด็ค'); return mkDeck([...k.main, ...k.life].map(i => i + ' x1').join(' '), 0, 0, ban); }
  if (m.pre) { const u = await dbGet(user); if (!ST[m.pre] || !(/^SD0[1-3]$/.test(m.pre) || (u.bought || []).includes(m.pre))) E('ยังไม่มีเด็คนี้'); return preDeck(m.pre); }
  return mkDeck(m.text || '', m.rand, m.skip, ban);
}
async function settle(r) { const g = r.g; if (!g.over || g.paid || g.win == null) return; g.paid = 1;
  for (let k = 0; k < 2; k++) { const w = r.p[k].ws; if (!w || !w.user) continue; const d = await dbGet(w.user); d.gems += k === g.win ? 150 : 50; await dbPut(w.user, d); w.send(JSON.stringify({ t: 'me', me: prof(w.user, d) })); } }
const wss = new WebSocketServer({ server: srv });
const rooms = {}; let UID = 1;
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const inst = id => ({ u: UID++, id, pw: 0, tired: false, gear: [] });
const ZN = ['hand', 'hell', 'av', 'mg', 'co'];
const E = s => { throw s; };

const BAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'banlist.json'), 'utf8'));
function checkBan(main) {
  const cnt = {}; main.forEach(i => { const n = B[i].n; cnt[n] = (cnt[n] || 0) + 1; if (B[i].o === 'ลำเอียง') E('ห้ามใช้การ์ดลำเอียง: ' + n); });
  for (const n in cnt) { if (BAN.ban.includes(n)) E('การ์ดบาป ห้ามใส่: ' + n); if (BAN.lim[n] && cnt[n] > BAN.lim[n]) E('การ์ดบาป จำกัด ' + BAN.lim[n] + ' ใบ: ' + n); }
  for (const [a, b] of BAN.pairs) if (cnt[a] && cnt[b]) E('ห้ามใส่คู่กัน: ' + a + ' + ' + b);
}
function mkDeck(text, rand, skip, ban) {
  let main = [], life = [];
  if (rand) {
    const col = shuf(['แดง', 'ฟ้า', 'เขียว', 'ม่วง'])[0], cnt = {};
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
      if (main.length !== 50) E('Main Deck ต้อง 50 ใบ (มี ' + main.length + ')');
      if (life.length !== 5 || new Set(life.map(i => B[i].n)).size !== 5) E('LIFE ต้อง 5 ใบชื่อไม่ซ้ำ');
      const cnt = {}; main.forEach(i => cnt[B[i].n] = (cnt[B[i].n] || 0) + 1);
      for (const i of main) if (cnt[B[i].n] > (B[i].lim || (B[i].o === 'Only #1' ? 1 : 4))) E('การ์ดซ้ำเกินกำหนด: ' + B[i].n);
      if (main.filter(i => B[i].o === 'Only #1').length !== 1) E('ต้องมี Only#1 พอดี 1 ใบ');
      if (ban) checkBan(main);
    }
  }
  return { main, life };
}

const view = (r, i) => {
  const g = r.g, pub = p => ({ name: p.name, av: p.av, mg: p.mg, co: p.co, hell: p.hell, deck: p.deck.length, hn: p.hand.length, life: p.life.map(l => l.up ? l : { up: 0 }) });
  return { i, me: { ...pub(r.p[i]), hand: r.p[i].hand }, op: pub(r.p[1 - i]), mine: g.turn === i, phase: g.phase, land: g.land, log: g.log.slice(-40), over: g.over, ev: g.ev || null, dw: g.dw, pend: g.pend ? { mine: g.pend.who === i, k: g.pend.k, until: g.pend.until } : null };
};
const bc = r => r.p.forEach((p, i) => {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(r.g ? { t: 's', s: view(r, i) } : { t: 'lobby', clock: r.cfg.clock, react: r.cfg.react, ban: r.cfg.ban, players: r.p.map(x => ({ name: x.name, ready: !!x.deck })) }));
});
const log = (r, s) => r.g.log.push(s);
const ev = (r, id) => { r.g.ev = { n: (r.g.ev ? r.g.ev.n : 0) + 1, id }; };
const draw = (r, p, n) => { for (let k = 0; k < n && p.deck.length; k++) p.hand.push(p.deck.pop()); if (!p.deck.length && !r.g.over) { r.g.over = p.name + ' เด็คหมด แพ้!'; r.g.win = r.p ? 1 - r.p.indexOf(p) : null; } };
const pw = x => (x.tk ? x.tk.p : B[x.id].p) + x.pw;
const find = (r, u) => { for (let i = 0; i < 2; i++) for (const z of ZN) { const k = r.p[i][z].findIndex(c => c.u === u); if (k >= 0) return { i, z, k, c: r.p[i][z][k] }; } return null; };
const take = (r, u) => { const f = find(r, u); if (!f) E('ไม่พบการ์ด'); r.p[f.i][f.z].splice(f.k, 1); return f; };
const kill = (r, i, u) => { const f = take(r, u); const p = r.p[f.i]; f.c.gear.forEach(g => p.hell.push(g)); f.c.gear = []; if (!f.c.tk) p.hell.push(f.c); };

function payOK(c, pay) {
  if (!c.c) { if (pay.length) E('Cost 0 ไม่ต้องจ่าย'); return; }
  const gs = pay.map(x => { const d = B[x.id]; if (!d.g) E('การ์ด Gem 0 ใช้จ่ายไม่ได้'); if (d.gc && d.gc !== c.col) E('สี Gem ไม่ตรง: ' + d.n); return d.g; });
  const sum = gs.reduce((a, b) => a + b, 0);
  if (sum < c.c) E('Gem ไม่พอ (' + sum + '/' + c.c + ')');
  if (gs.some(g => sum - g >= c.c)) E('จ่ายเกินจำเป็น (มีการ์ดที่ไม่ต้องทิ้ง)');
}
function startTurn(r) {
  const g = r.g, p = r.p[g.turn]; g.used = {};
  p.av.forEach(a => a.tired = false);
  draw(r, p, g.n === 0 ? 2 : p.hand.length < 3 ? 3 - p.hand.length : 1);
  g.phase = 'main'; log(r, '— เทิร์นของ ' + p.name + ' —');
}
function hit(r, d, atk) {
  const k = d.life.findIndex(l => !l.up);
  if (k < 0) { r.g.over = atk.name + ' ชนะ! ' + d.name + ' ถูกโจมตีขณะสาหัส'; r.g.win = r.p.indexOf(atk); return; }
  d.life[k].up = 1; const c = B[d.life[k].id];
  log(r, d.name + ' LIFE หงาย: ' + c.n + ' — ' + c.e);
  if (d.life.every(l => l.up)) log(r, d.name + ' เข้าสถานะสาหัส!');
}

function act(r, i, m) {
  const g = r.g, me = r.p[i], op = r.p[1 - i], mine = g.turn === i;
  if (g.over && m.t !== 'chat') E('เกมจบแล้ว');
  if (g.pend && !['chat', 'pass'].includes(m.t) && !(i === g.pend.who && ['dview', 'dmove', 'dpos', 'dshuf', 'cast', 'move', 'pw', 'tire', 'token', 'drawn', 'discard'].includes(m.t))) E('รอการตอบโต้ (React) ก่อน');
  const mainOnly = () => { if (!mine || g.phase !== 'main') E('ทำได้เฉพาะ Main Phase ของเรา'); };
  const own = u => { const f = find(r, u); if (!f || f.i !== i) E('ไม่ใช่การ์ดของเรา'); return f; };
  const pays = () => (m.pay || []).map(u => { const f = own(u); if (f.z !== 'hand') E('ต้องจ่ายด้วยการ์ดในมือ'); return f.c; });
  switch (m.t) {
    case 'mull': {
      if (g.phase !== 'mull' || me.m) E('เปลี่ยนมือไม่ได้');
      const us = m.us || [], cs = us.map(u => take(r, u).c);
      cs.forEach(c => me.deck.unshift(c)); draw(r, me, cs.length); shuf(me.deck); me.m = true;
      if (r.p.every(p => p.m)) { g.phase = 'x'; startTurn(r); } break;
    }
    case 'next':
      if (!mine) E('ไม่ใช่เทิร์นเรา');
      if (g.phase === 'main') g.phase = g.n === 0 ? 'end' : 'battle';
      else if (g.phase === 'battle') g.phase = 'end';
      else { if (me.hand.length > 7) E('มือเกิน 7 ใบ ต้องทิ้งก่อน'); g.turn = 1 - i; g.n++; startTurn(r); }
      break;
    case 'discard': { const f = own(m.u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); take(r, m.u); me.hell.push(f.c); log(r, me.name + ' ทิ้ง ' + B[f.c.id].n); break; }
    case 'summon': case 'build': {
      mainOnly(); const f = own(m.u), c = B[f.c.id], av = m.t === 'summon';
      if (f.z !== 'hand' || c.t !== (av ? 'Avatar' : 'Construct')) E('ประเภทการ์ดไม่ถูกต้อง');
      if (av ? me.av.filter(x => !x.tk).length >= 4 : me.co.length >= 3) E(av ? 'Avatar เต็ม 4 ใบ' : 'Construct เต็ม 3 ใบ');
      if (av && me.av.length >= 6) E('Avatar+Token เต็ม 6');
      if (!av && me.co.some(x => B[x.id].n === c.n)) E('Construct ชื่อซ้ำ');
      const ps = pays(); payOK(c, ps);
      ps.forEach(p => { take(r, p.u); me.hell.push(p); }); take(r, m.u); me[av ? 'av' : 'co'].push(f.c);
      ev(r, c.id); log(r, me.name + (av ? ' อัญเชิญ ' : ' ก่อสร้าง ') + c.n + ' — ' + c.e); open(r, { who: 1 - i, k: 'ev' }); break;
    }
    case 'cast': {
      const f = own(m.u), c = B[f.c.id]; if (f.z !== 'hand' || c.t !== 'Magic') E('ไม่ใช่ Magic ในมือ');
      if (c.st !== 'React') mainOnly();
      if (g.used[c.st]) E('ประเภท ' + c.st + ' ใช้ได้ 1 ครั้ง/เทิร์น'); g.used[c.st] = 1; take(r, m.u);
      if (c.st === 'Modification') { const t = find(r, m.tg); if (!t || t.z !== 'av') { me.hand.push(f.c); g.used[c.st] = 0; E('ต้องเลือก Avatar เป้าหมาย'); } t.c.gear.push(f.c); }
      else if (c.st === 'Land') { if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: f.c, o: i }; }
      else me.hell.push(f.c);
      ev(r, c.id); log(r, me.name + ' ร่าย ' + c.st + ': ' + c.n + ' — ' + c.e); if (c.st !== 'React') open(r, { who: 1 - i, k: 'ev' }); break;
    }
    case 'atk': {
      if (!mine || g.phase !== 'battle') E('โจมตีได้เฉพาะ Battle Phase ของเรา');
      const a = own(m.u); if (a.z !== 'av' || a.c.tired) E('Avatar นี้โจมตีไม่ได้');
      if (m.tg === 'life') { if (op.av.length && !(((B[a.c.id] || {}).e) || '').includes('เตะไข่')) E('ต้องกำจัด Avatar ศัตรูก่อน'); }
      else if (!op.av.some(x => x.u === m.tg)) E('ไม่พบเป้าหมาย');
      a.c.tired = true; log(r, (a.c.tk ? a.c.tk.n : B[a.c.id].n) + ' ประกาศโจมตี ' + (m.tg === 'life' ? 'LIFE' : 'Avatar'));
      open(r, { who: 1 - i, k: 'atk', ai: i, u: m.u, tg: m.tg }); break;
    }
    case 'oe': { if (g.phase !== 'dice' || i !== 0) E('ตอนนี้เลือกคู่/คี่ไม่ได้'); const d = 1 + Math.floor(Math.random() * 6); g.dw = (d % 2 === 1) === (m.v === 'odd') ? 0 : 1; log(r, me.name + ' เลือก' + (m.v === 'odd' ? 'คี่' : 'คู่') + ' · ทอยได้ ' + d + ' · ' + r.p[g.dw].name + ' ชนะ เลือกลำดับได้'); g.phase = 'pick'; break; }
    case 'first': { if (g.phase !== 'pick' || i !== g.dw) E('ไม่ใช่สิทธิ์ของคุณ'); g.turn = m.v ? i : 1 - i; log(r, r.p[g.turn].name + ' ได้เริ่มก่อน'); g.phase = 'mull'; break; }
    case 'pass': { if (!g.pend || g.pend.who !== i) E('ไม่มีหน้าต่าง React'); passReact(r); break; }
    case 'token': if (me.av.length >= 6) E('เต็ม 6'); me.av.push({ ...inst('TK'), tk: { n: String(m.n || 'Token').slice(0, 30), p: +m.p || 0 } }); log(r, me.name + ' สร้าง Token'); break;
    case 'move': { // เครื่องมือแก้ไข (เฟสนี้: ทำได้เลย + บันทึกให้อีกฝ่ายเห็น)
      const f = find(r, m.u); if (!f) E('ไม่พบการ์ด'); if (!ZN.includes(m.to)) E('โซนไม่ถูกต้อง');
      take(r, m.u); if (f.c.tk) { if (m.to === 'av') r.p[f.i].av.push(f.c); } else { f.c.tired = false; f.c.gear.forEach(x => r.p[f.i].hell.push(x)); f.c.gear = []; r.p[f.i][m.to].push(f.c); }
      log(r, '[แก้ไข] ' + me.name + ' ย้าย ' + (f.c.tk ? 'Token' : B[f.c.id].n) + ' → ' + m.to); break;
    }
    case 'pw': { const f = find(r, m.u); if (!f) E('ไม่พบ'); f.c.pw += m.d > 0 ? 1 : -1; log(r, '[แก้ไข] ' + me.name + ' ปรับ Power ' + (m.d > 0 ? '+1' : '-1')); break; }
    case 'tire': { const f = find(r, m.u); if (!f) E('ไม่พบ'); f.c.tired = !f.c.tired; break; }
    case 'drawn': draw(r, me, 1); log(r, '[แก้ไข] ' + me.name + ' จั่ว 1'); break;
    case 'dview': { const n = +m.n | 0, L = (n > 0 ? me.deck.slice(-n) : me.deck.slice()).reverse(); me.ws && me.ws.send(JSON.stringify({ t: 'dv', cards: L.map(c => ({ u: c.u, id: c.id })) })); log(r, me.name + ' ดูเด็ค' + (n > 0 ? ' (' + n + ' ใบบนสุด)' : ' (ทั้งเด็ค)')); break; }
    case 'dmove': {
      const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบการ์ดในเด็ค'); if (!['hand', 'hell', 'av', 'mg', 'co'].includes(m.to)) E('โซนไม่ถูกต้อง');
      const [c] = me.deck.splice(k, 1); me[m.to].push(c); log(r, me.name + ' ย้าย ' + B[c.id].n + ' จากเด็ค → ' + m.to);
      if (!me.deck.length && !g.over) { g.over = me.name + ' เด็คหมด แพ้!'; g.win = 1 - i; } break;
    }
    case 'dpos': { const k = me.deck.findIndex(c => c.u === m.u); if (k < 0) E('ไม่พบการ์ดในเด็ค'); const [c] = me.deck.splice(k, 1); m.top ? me.deck.push(c) : me.deck.unshift(c); log(r, me.name + ' วางการ์ดไว้' + (m.top ? 'บนสุด' : 'ใต้') + 'เด็ค'); break; }
    case 'dshuf': shuf(me.deck); log(r, me.name + ' สับเด็ค 🔀'); break;
    case 'chat': log(r, '💬 ' + me.name + ': ' + String(m.x || '').slice(0, 200)); break;
    default: E('คำสั่งไม่รู้จัก');
  }
}

const open = (r, p) => { p.until = r.cfg.react ? Date.now() + r.cfg.react * 1000 : 0; r.g.pend = p; };
function resolveAtk(r, p) {
  const me = r.p[p.ai], op = r.p[1 - p.ai], f = find(r, p.u);
  if (!f || f.i !== p.ai || f.z !== 'av') return log(r, 'การโจมตีถูกยกเลิก');
  const a = f.c, an = a.tk ? a.tk.n : B[a.id].n;
  if (p.tg === 'life') {
    if (op.av.length && !(((B[a.id] || {}).e) || '').includes('เตะไข่')) return log(r, 'โจมตี LIFE ไม่ได้ (ศัตรูยังมี Avatar)');
    log(r, an + ' โจมตี LIFE'); if (pw(a) > 0) hit(r, op, me); else log(r, 'Power 0 ไม่สร้างความเสียหาย');
  } else {
    const d = op.av.find(x => x.u === p.tg); if (!d) return log(r, 'เป้าหมายหายไป การโจมตีล้มเหลว');
    const pa = pw(a), pd = pw(d), dn = d.tk ? d.tk.n : B[d.id].n;
    log(r, an + ' (' + pa + ') สู้ ' + dn + ' (' + pd + ')');
    if (pa === pd) { if (pa > 0) { kill(r, p.ai, a.u); kill(r, 1 - p.ai, d.u); log(r, 'ตายทั้งคู่'); } }
    else kill(r, pa > pd ? 1 - p.ai : p.ai, pa > pd ? d.u : a.u);
  }
}
function passReact(r) { const p = r.g.pend; r.g.pend = null; if (p && p.k === 'atk') resolveAtk(r, p); }
function begin(r) {
  r.p.forEach(x => { draw({ g: {} }, x, 5); x.t = (r.cfg.clock || 0) * 60000; x.rm = 0; x.dc = null; x.m = false; });
  r.g = { turn: 0, phase: 'dice', pend: null, n: 0, used: {}, land: null, log: ['เริ่มเกม! เจ้าห้องเลือกคี่หรือคู่'], over: null };
}
async function rematch(r, i) {
  r.p[i].rm = 1; if (!r.rmT) r.rmT = Date.now();
  if (r.p.every(x => x.rm)) {
    for (const x of r.p) { const d = await pickDeck(x.last, x.name, r.cfg.ban); x.deck = shuf(d.main.map(inst)); x.life = d.life.map(id => ({ ...inst(id), up: 0 })); x.hand = []; x.hell = []; x.av = []; x.mg = []; x.co = []; }
    r.rmT = 0; begin(r);
  } else { const o = r.p[1 - i].ws; o && o.readyState === 1 && o.send(JSON.stringify({ t: 'rmq' })); }
  bc(r);
}
setInterval(() => {
  const now = Date.now();
  for (const c in rooms) {
    const r = rooms[c], g = r.g;
    if (!g) { if (r.exp && now > r.exp) { r.p.forEach(p => p.ws && p.ws.readyState === 1 && p.ws.send(JSON.stringify({ err: 'ห้องหมดอายุ' }))); delete rooms[c]; } continue; }
    if (g.over) { g.oa = g.oa || now; if ((r.rmT && now - r.rmT > 10000) || now - g.oa > 6e5) { r.p.forEach(p => p.ws && p.ws.readyState === 1 && p.ws.send(JSON.stringify({ t: 'rmx' }))); delete rooms[c]; } continue; }
    r.p.forEach((p, k) => { if (p.dc && now - p.dc > 12e4) { g.over = p.name + ' หลุดการเชื่อมต่อเกิน 2 นาที แพ้'; g.win = 1 - k; } });
    if (g.pend && g.pend.until && now > g.pend.until) { passReact(r); bc(r); settle(r).catch(() => { }); }
    if (!g.over && r.cfg.clock && ['main', 'battle', 'end'].includes(g.phase)) {
      const p = r.p[g.turn]; p.t -= 1000; if (p.t <= 0) { g.over = p.name + ' หมดเวลา แพ้'; g.win = 1 - g.turn; }
      r.p.forEach(x => x.ws && x.ws.readyState === 1 && x.ws.send(JSON.stringify({ t: 'clk', a: r.p.map(y => y.t) })));
    }
    if (g.over) { bc(r); settle(r).catch(() => { }); }
  }
}, 1000);
wss.on('connection', ws => {
  let r, i;
  ws.on('close', () => { if (r && r.p[i] && r.p[i].ws === ws) { r.p[i].dc = Date.now(); if (r.g && !r.g.over) { log(r, '⚠ ' + r.p[i].name + ' หลุดการเชื่อมต่อ (รอ 2 นาที)'); bc(r); } } });
  const err = s => ws.send(JSON.stringify({ err: String(s) }));
  ws.on('message', async raw => {
    try {
      const m = JSON.parse(raw);
      if (m.t === 'reg' || m.t === 'login' || m.t === 'tok') {
        let n = String(m.name || '').trim().toLowerCase().slice(0, 16), d;
        if (m.t === 'tok') { n = unsign(String(m.tok)); if (!n) E('เซสชันหมดอายุ'); d = await dbGet(n); if (!d) E('ไม่พบบัญชี'); }
        else {
          if (!/^[a-z0-9_\u0E00-\u0E7F]{3,16}$/.test(n)) E('ชื่อ 3-16 ตัว (a-z 0-9 _ หรือไทย)'); d = await dbGet(n); const pw = String(m.pw || '');
          if (m.t === 'reg') {
            if (d) E('ชื่อนี้ถูกใช้แล้ว'); if (pw.length < 4) E('รหัสผ่านอย่างน้อย 4 ตัว');
            const s = crypto.randomBytes(8).toString('hex'); d = { s, h: hash(pw, s), gems: 0, cards: {}, codes: [] };
            ['SD01', 'SD02', 'SD03'].forEach(x => giveSt(d, x));
            await dbPut(n, d);
          } else if (!d || d.h !== hash(pw, d.s)) E('ชื่อหรือรหัสผ่านไม่ถูกต้อง');
        }
        ws.user = n; ws.send(JSON.stringify({ t: 'auth', tok: sign(n), me: prof(n, d) })); return;
      }
      if (!ws.user) E('ต้องล็อกอินก่อน');
      if (m.t === 'mkcode') {
        if (ws.user !== ADMIN) E('เฉพาะแอดมิน'); const c = String(m.c || '').trim().toUpperCase(); if (!/^[A-Z0-9]{3,20}$/.test(c)) E('โค้ด 3-20 ตัว A-Z 0-9');
        const T = (await dbGet('sys:codes')) || {}; T[c] = { gems: Math.max(0, +m.gems | 0), art: Math.min(50, Math.max(0, +m.art | 0)) };
        await dbPut('sys:codes', T); ws.send(JSON.stringify({ note: 'สร้างโค้ด ' + c + ' แล้ว' })); return;
      }
      const me_ = d => ws.send(JSON.stringify({ t: 'me', me: prof(ws.user, d) }));
      if (m.t === 'buyst') {
        const d = await dbGet(ws.user); d.bought = d.bought || [];
        if (!ST[m.set] || /^SD0[1-3]$/.test(m.set)) E('ไม่มีสินค้า'); if (d.bought.includes(m.set)) E('ซื้อแล้ว'); if (d.gems < 1500) E('Gem ไม่พอ');
        d.gems -= 1500; d.bought.push(m.set); giveSt(d, m.set);
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'savedeck') {
        const d = await dbGet(ws.user), own = {}; Object.entries(d.cards).forEach(([k, v]) => { const i = k.split('|')[0]; own[i] = (own[i] || 0) + v; });
        const main = (m.main || []).map(String), life = (m.life || []).map(String), cnt = {};
        [...main, ...life].forEach(i => { if (!B[i]) E('ไม่พบการ์ด ' + i); cnt[i] = (cnt[i] || 0) + 1; });
        for (const i in cnt) if (cnt[i] > (own[i] || 0)) E('การ์ดไม่พอ: ' + B[i].n);
        if (life.some(i => B[i].t !== 'Life') || main.some(i => B[i].t === 'Life')) E('ประเภทการ์ดไม่ถูกต้อง');
        mkDeck([...main, ...life].map(i => i + ' x1').join(' '), 0, !!m.draft);
        const nm = String(m.name || 'เด็คใหม่').slice(0, 20); d.decks = d.decks || {};
        if (!d.decks[nm] && Object.keys(d.decks).length >= 20) E('เด็คเต็ม 20 ชุด'); d.decks[nm] = { main, life };
        await dbPut(ws.user, d); me_(d); return;
      }
      if (m.t === 'fadd') {
        const t = String(m.name || '').trim().toLowerCase(); if (t === ws.user) E('เพิ่มตัวเองไม่ได้');
        const o = await dbGet(t), d = await dbGet(ws.user); if (!o) E('ไม่พบผู้ใช้'); if ((d.fr || []).includes(t)) E('เป็นเพื่อนกันแล้ว');
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
        const ps = []; for (let k = 0; k < n; k++) { d.pity = (d.pity || 0) + 1; const p = pack(m.set, d.pity >= 20); if (['UR', 'SCR'].includes(p[4].r)) d.pity = 0; p.forEach(x => add(d, x)); ps.push(p); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d) })); return;
      }
      if (m.t === 'code') {
        const d = await dbGet(ws.user), c = String(m.c || '').trim().toUpperCase();
        const K = { BOTFANMADE: { gems: 5555 }, SOCOOL: { art: 5 }, ...((await dbGet('sys:codes')) || {}) }, X = K[c]; if (!X) E('โค้ดไม่ถูกต้อง'); if (d.codes.includes(c)) E('ใช้โค้ดนี้ไปแล้ว'); d.codes.push(c);
        let ps = []; d.gems += X.gems || 0;
        if (X.art) { const A = []; CARDS.forEach(x => x.v.forEach(r => ['PR', 'CBR', 'SCR'].includes(r) && A.push({ id: x.id, r }))); const p = []; for (let k = 0; k < X.art; k++) { const x = pick(A); add(d, x); p.push(x); } for (let k = 0; k < p.length; k += 5) ps.push(p.slice(k, k + 5)); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d), note: X.gems ? 'ได้รับ ' + X.gems + ' Gem' : '' })); return;
      }
      if (m.t === 'join') {
        const code = String(m.room || '').toUpperCase().slice(0, 8), name = ws.user;
        if (!code) E('ใส่รหัสห้อง');
        r = rooms[code];
        if (!r) { if (!m.create) E('ไม่พบห้อง หรือรหัสหมดอายุแล้ว'); r = rooms[code] = { p: [], g: null, code, exp: Date.now() + 18e4, cfg: { clock: [5, 10, 20].includes(+m.clock) ? +m.clock : 0, react: [10, 20, 30].includes(+m.react) ? +m.react : 0, ban: String(m.ban) !== '0' } }; }
        i = r.p.findIndex(p => p.name === name);
        if (i < 0) { if (r.p.length >= 2) E('ห้องเต็ม'); i = r.p.length; r.p.push({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], life: [] }); }
        r.p[i].ws = ws; if (r.p.length === 2) r.exp = 0; if (r.p[i].dc) { r.p[i].dc = null; if (r.g) log(r, '✔ ' + name + ' กลับมาแล้ว'); } bc(r);
      } else if (m.t === 'deck') {
        if (!r || r.g) E('ตั้งเด็คไม่ได้');
        const d = await pickDeck(m, ws.user, r.cfg.ban), p = r.p[i];
        p.last = m; p.deck = shuf(d.main.map(inst)); p.life = d.life.map(id => ({ ...inst(id), up: 0 })); p.hand = [];
        if (r.p.length === 2 && r.p.every(x => x.deck)) begin(r);
        bc(r);
      } else if (m.t === 'rm' && r && r.g && r.g.over) { await rematch(r, i);
      } else if (r && r.g) { act(r, i, m); bc(r); settle(r).catch(() => { }); }
    } catch (e) { err(e && e.message ? 'ผิดพลาด' : e); }
  });
});
srv.listen(process.env.PORT || 3000, () => console.log('ready'));
