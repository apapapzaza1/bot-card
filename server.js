const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf8'));
const B = {}; CARDS.forEach(c => B[c.id] = c);
const srv = http.createServer((q, r) => {
  const j = q.url.split('?')[0] === '/cards.json';
  r.writeHead(200, { 'Content-Type': j ? 'application/json' : 'text/html;charset=utf-8' });
  fs.createReadStream(path.join(__dirname, j ? 'cards.json' : 'index.html')).pipe(r);
});
const wss = new WebSocketServer({ server: srv });
const rooms = {}; let UID = 1;
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const inst = id => ({ u: UID++, id, pw: 0, tired: false, gear: [] });
const ZN = ['hand', 'hell', 'av', 'mg', 'co'];
const E = s => { throw s; };

function mkDeck(text, rand, skip) {
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
    }
  }
  return { main, life };
}

const view = (r, i) => {
  const g = r.g, pub = p => ({ name: p.name, av: p.av, mg: p.mg, co: p.co, hell: p.hell, deck: p.deck.length, hn: p.hand.length, life: p.life.map(l => l.up ? l : { up: 0 }) });
  return { i, me: { ...pub(r.p[i]), hand: r.p[i].hand }, op: pub(r.p[1 - i]), mine: g.turn === i, phase: g.phase, land: g.land, log: g.log.slice(-40), over: g.over, ev: g.ev || null };
};
const bc = r => r.p.forEach((p, i) => {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(r.g ? { t: 's', s: view(r, i) } : { t: 'lobby', players: r.p.map(x => ({ name: x.name, ready: !!x.deck })) }));
});
const log = (r, s) => r.g.log.push(s);
const ev = (r, id) => { r.g.ev = { n: (r.g.ev ? r.g.ev.n : 0) + 1, id }; };
const draw = (r, p, n) => { for (let k = 0; k < n && p.deck.length; k++) p.hand.push(p.deck.pop()); if (!p.deck.length && !r.g.over) r.g.over = p.name + ' เด็คหมด แพ้!'; };
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
  if (k < 0) { r.g.over = atk.name + ' ชนะ! ' + d.name + ' ถูกโจมตีขณะสาหัส'; return; }
  d.life[k].up = 1; const c = B[d.life[k].id];
  log(r, d.name + ' LIFE หงาย: ' + c.n + ' — ' + c.e);
  if (d.life.every(l => l.up)) log(r, d.name + ' เข้าสถานะสาหัส!');
}

function act(r, i, m) {
  const g = r.g, me = r.p[i], op = r.p[1 - i], mine = g.turn === i;
  if (g.over) E('เกมจบแล้ว');
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
      ev(r, c.id); log(r, me.name + (av ? ' อัญเชิญ ' : ' ก่อสร้าง ') + c.n + ' — ' + c.e); break;
    }
    case 'cast': {
      const f = own(m.u), c = B[f.c.id]; if (f.z !== 'hand' || c.t !== 'Magic') E('ไม่ใช่ Magic ในมือ');
      if (c.st !== 'React') mainOnly();
      if (g.used[c.st]) E('ประเภท ' + c.st + ' ใช้ได้ 1 ครั้ง/เทิร์น'); g.used[c.st] = 1; take(r, m.u);
      if (c.st === 'Modification') { const t = find(r, m.tg); if (!t || t.z !== 'av') { me.hand.push(f.c); g.used[c.st] = 0; E('ต้องเลือก Avatar เป้าหมาย'); } t.c.gear.push(f.c); }
      else if (c.st === 'Land') { if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: f.c, o: i }; }
      else me.hell.push(f.c);
      ev(r, c.id); log(r, me.name + ' ร่าย ' + c.st + ': ' + c.n + ' — ' + c.e); break;
    }
    case 'atk': {
      if (!mine || g.phase !== 'battle') E('โจมตีได้เฉพาะ Battle Phase ของเรา');
      const a = own(m.u); if (a.z !== 'av' || a.c.tired) E('Avatar นี้โจมตีไม่ได้'); a.c.tired = true;
      const an = a.c.tk ? a.c.tk.n : B[a.c.id].n;
      if (m.tg === 'life') {
        if (op.av.length && !(B[a.c.id] || {}).e?.includes('เตะไข่')) { a.c.tired = false; E('ต้องกำจัด Avatar ศัตรูก่อน'); }
        log(r, an + ' โจมตี LIFE'); if (pw(a.c) > 0) hit(r, op, me); else log(r, 'Power 0 ไม่สร้างความเสียหาย');
      } else {
        const d = op.av.find(x => x.u === m.tg); if (!d) { a.c.tired = false; E('ไม่พบเป้าหมาย'); }
        const pa = pw(a.c), pd = pw(d), dn = d.tk ? d.tk.n : B[d.id].n;
        log(r, an + ' (' + pa + ') สู้ ' + dn + ' (' + pd + ')');
        if (pa === pd) { if (pa > 0) { kill(r, i, a.c.u); kill(r, 1 - i, d.u); log(r, 'ตายทั้งคู่'); } }
        else kill(r, pa > pd ? 1 - i : i, pa > pd ? d.u : a.c.u);
      } break;
    }
    case 'token': if (me.av.length >= 6) E('เต็ม 6'); me.av.push({ ...inst('TK'), tk: { n: String(m.n || 'Token').slice(0, 30), p: +m.p || 0 } }); log(r, me.name + ' สร้าง Token'); break;
    case 'move': { // เครื่องมือแก้ไข (เฟสนี้: ทำได้เลย + บันทึกให้อีกฝ่ายเห็น)
      const f = find(r, m.u); if (!f) E('ไม่พบการ์ด'); if (!ZN.includes(m.to)) E('โซนไม่ถูกต้อง');
      take(r, m.u); if (f.c.tk) { if (m.to === 'av') r.p[f.i].av.push(f.c); } else { f.c.tired = false; f.c.gear.forEach(x => r.p[f.i].hell.push(x)); f.c.gear = []; r.p[f.i][m.to].push(f.c); }
      log(r, '[แก้ไข] ' + me.name + ' ย้าย ' + (f.c.tk ? 'Token' : B[f.c.id].n) + ' → ' + m.to); break;
    }
    case 'pw': { const f = find(r, m.u); if (!f) E('ไม่พบ'); f.c.pw += m.d > 0 ? 1 : -1; log(r, '[แก้ไข] ' + me.name + ' ปรับ Power ' + (m.d > 0 ? '+1' : '-1')); break; }
    case 'tire': { const f = find(r, m.u); if (!f) E('ไม่พบ'); f.c.tired = !f.c.tired; break; }
    case 'drawn': draw(r, me, 1); log(r, '[แก้ไข] ' + me.name + ' จั่ว 1'); break;
    default: E('คำสั่งไม่รู้จัก');
  }
}

wss.on('connection', ws => {
  let r, i;
  const err = s => ws.send(JSON.stringify({ err: String(s) }));
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      if (m.t === 'join') {
        const code = String(m.room || '').toUpperCase().slice(0, 8), name = String(m.name || '').slice(0, 20) || 'ผู้เล่น';
        if (!code) E('ใส่รหัสห้อง');
        r = rooms[code] = rooms[code] || { p: [], g: null };
        i = r.p.findIndex(p => p.name === name);
        if (i < 0) { if (r.p.length >= 2) E('ห้องเต็ม'); i = r.p.length; r.p.push({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], life: [] }); }
        r.p[i].ws = ws; bc(r);
      } else if (m.t === 'deck') {
        if (!r || r.g) E('ตั้งเด็คไม่ได้');
        const d = mkDeck(m.text || '', m.rand, m.skip), p = r.p[i];
        p.deck = shuf(d.main.map(inst)); p.life = d.life.map(id => ({ ...inst(id), up: 0 })); p.hand = [];
        if (r.p.length === 2 && r.p.every(x => x.deck)) {
          r.p.forEach(x => { x.deck.forEach(c => c); draw({ g: {} }, x, 5); });
          r.g = { turn: Math.floor(Math.random() * 2), phase: 'mull', n: 0, used: {}, land: null, log: ['เริ่มเกม! เลือกเปลี่ยนมือหรือเก็บทั้งหมด'], over: null };
          log(r, r.p[r.g.turn].name + ' ได้เริ่มก่อน');
        }
        bc(r);
      } else if (r && r.g) { act(r, i, m); bc(r); }
    } catch (e) { err(e && e.message ? 'ผิดพลาด' : e); }
  });
});
srv.listen(process.env.PORT || 3000, () => console.log('ready'));
