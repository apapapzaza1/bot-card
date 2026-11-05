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
// ===== ระบบโปรไฟล์ / เลเวล / ประวัติ / สถิติ =====
const PF_NEED = L => 200 + 50 * L;   // EXP ที่ต้องใช้จากเลเวล L ไป L+1
const pfLv = xp => { let L = 1, x = Math.max(0, xp | 0); while (x >= PF_NEED(L)) { x -= PF_NEED(L); L++; } return { lv: L, cur: x, need: PF_NEED(L) }; };
const pfView = d => { const p = d.pf || {}, st = p.st || {}, l = pfLv(p.xp); return { xp: p.xp | 0, lv: l.lv, cur: l.cur, need: l.need, hist: p.hist || [], st: { g: st.g | 0, w: st.w | 0, l: st.l | 0, s: st.s | 0, b: st.b | 0 } }; };
// รางวัลทุก 5 เลเวล: Gem 500 (+250 ทุก 5 เลเวลที่เพิ่ม) + ผง 300 (+150) ; ทุก 10 เลเวล: การ์ดอาร์ท (เลเวล/10 ใบ) SEC 65% / UR 25% / UBR 10%
const pfReward = L => { if (L % 5) return null; const k = L / 5; return { lv: L, gems: 500 + 250 * (k - 1), dust: 300 + 150 * (k - 1), n: L % 10 ? 0 : L / 10 }; };
const PF_ART_W = [['SEC', 65], ['UR', 25], ['UBR', 10]];
const pfArt = () => { let x = Math.random() * 100, r = 'SEC'; for (const [t, w] of PF_ART_W) { if ((x -= w) < 0) { r = t; break; } }
  const pool = rr => { const A = []; CARDS.forEach(c => (c.v || []).includes(rr) && A.push({ id: c.id, r: rr })); return A; };
  let A = pool(r); if (!A.length) A = pool('SEC'); if (!A.length) A = pool('UR'); return A.length ? pick(A) : null; };
// EXP: PvP ชนะ 100 / แพ้ 50 ; บอท ชนะ 40 / แพ้ 20 (น้อยกว่าครึ่ง)
function pfGain(d, win, bot, opName) {
  const p = d.pf = d.pf || { xp: 0, hist: [], st: {} }, st = p.st = p.st || {};
  const xp = bot ? (win ? 40 : 20) : (win ? 100 : 50), l0 = pfLv(p.xp).lv; p.xp = (p.xp | 0) + xp; const l1 = pfLv(p.xp).lv, rw = [];
  for (let L = l0 + 1; L <= l1; L++) { const o = pfReward(L); if (!o) continue; d.gems += o.gems; d.dust = (d.dust || 0) + o.dust; o.cards = []; for (let k = 0; k < o.n; k++) { const c = pfArt(); if (c) { add(d, c); o.cards.push(c); } } rw.push(o); }
  st.g = (st.g | 0) + 1; if (win) { st.w = (st.w | 0) + 1; st.s = (st.s | 0) + 1; st.b = Math.max(st.b | 0, st.s); } else { st.l = (st.l | 0) + 1; st.s = 0; }
  p.hist = [{ t: Date.now(), w: win ? 1 : 0, op: String(opName || '').slice(0, 24), bot: bot ? 1 : 0 }, ...(p.hist || [])].slice(0, 20);
  return { xp, l0, l1, rw };
}
const prof = (n, d) => ({ name: n, pic: d.pic || null, pf: pfView(d), gems: d.gems, dust: d.dust || 0, cards: d.cards, admin: n === ADMIN, decks: d.decks || {}, fr: d.fr || [], rq: d.rq || [], qn: qRed(d), pity: d.pity || 0, pityCC: d.pityCC || 0, bought: d.bought || [], skins: d.skins || [], eq: d.eq || {}, ban: (() => { try { return BAN; } catch (e) { return null; } })() });
const ST = JSON.parse(fs.readFileSync(path.join(__dirname, 'starters.json'), 'utf8'));
const giveSt = (d, k) => ST[k].main.concat(ST[k].life).forEach(([id, n, r]) => { for (let j = 0; j < n; j++) add(d, { id, r }); });
const SETS = ['BT01','BT02','BT03','BT04','BT05','BT06','BT07','BT08','BT09','BT10','CC01','CC02'];
// BOC (CC): ซองละ 5 ใบ ใบ 1-4 = SR, ใบที่ 5 = ช่องลุ้น · ราคา 200/1,800 · การันตีแยกจาก BT (ทุก 20 ซอง)
const isCC = set => /^CC/.test(set), CC_PITY = 20;
const CCW = { SR: 90, UR: 7, SEC: 2.5, PR: .5 }, CCG = { UR: 90, SEC: 9, PR: 1 };
const pick = a => a[Math.floor(Math.random() * a.length)];
const add = (d, x) => { const k = x.id + '|' + x.r; d.cards[k] = (d.cards[k] || 0) + 1; };
const RT = ['C','R','SR','UR','SEC','PR','UBR','USEC'];
// ระบบคราฟ/ย่อย: ผงวิเศษ
const DUST = { C: 50, R: 100, SR: 150, UR: 200, SEC: 250, PR: 250, UBR: 250, USEC: 250 };   // ผงที่ได้ตอนย่อย (ต่อใบ)
const CRAFT_R = ['C', 'R', 'SR', 'UR'];   // คราฟได้เฉพาะระดับนี้ (SEC ขึ้นไปคราฟไม่ได้)
const CRAFT_OWN = 1000, CRAFT_NEW_DUST = 1500, CRAFT_NEW_GEM = 2500, DUST_KEEP = 4;   // ย่อยได้เฉพาะใบที่เกิน 4
/* ===================== ระบบเควส (รายวัน / รายสัปดาห์ / ชาเลนจ์ / ความสำเร็จ) =====================
   - ตัวนับ (metric): g เล่นครบ, w ชนะ, wf ชนะภายใน 12 เทิร์น, sm อัญเชิญ Avatar, bd ก่อสร้าง Construct, mg ใช้ Magic,
     ak โจมตี, us ใช้ความสามารถ, s5 อัญเชิญ Avatar Cost 5+, op เปิดซอง, cr คราฟการ์ด, st ชนะติดต่อกัน (เฉพาะความสำเร็จ)
   - โหมด (mode): any ทุกโหมด / bot เล่นกับบอท / pvp เล่นกับเพื่อน / hard บอทระดับยาก
   - รีเซ็ตตามเวลาไทย (UTC+7): รายวัน 00:00 ทุกวัน, รายสัปดาห์ 00:00 คืนวันอาทิตย์ (เริ่มสัปดาห์ใหม่วันจันทร์)
   - ปรับเควส/รางวัลได้ที่ตาราง QD (รายวัน) QW (รายสัปดาห์) QCH_DEF (ชาเลนจ์ตั้งต้น) QACH (ความสำเร็จ) ในบล็อกนี้ที่เดียว */
const QM = { any: '', bot: ' (เล่นกับบอท)', pvp: ' (เล่นกับเพื่อน)', hard: ' (เล่นกับบอทระดับยาก)' };
const QMN = { any: 'ทุกโหมด', bot: 'เล่นกับบอท', pvp: 'เล่นกับเพื่อน', hard: 'บอทระดับยาก' };
const QT = { g: 'เล่นให้ครบ N เกม', w: 'ชนะ N เกม', wf: 'ชนะภายใน 12 เทิร์น N เกม', sm: 'อัญเชิญ Avatar N ใบ', bd: 'ก่อสร้าง Construct N ใบ', mg: 'ใช้ Magic N ใบ', ak: 'โจมตีด้วย Avatar N ครั้ง', us: 'ใช้ความสามารถ N ครั้ง', s5: 'อัญเชิญ Avatar Cost 5 ขึ้นไป N ใบ', op: 'เปิดซองการ์ด N ซอง', cr: 'คราฟการ์ด N ใบ', st: 'ชนะติดต่อกัน N เกม' };
const QNOMODE = ['op', 'cr', 'st'];   // ตัวนับที่ไม่แยกโหมด
const qText = (m, md, n) => QT[m].replace('N', n.toLocaleString('en-US')) + (QNOMODE.includes(m) ? '' : (QM[md] || ''));
// รายวัน: [metric, mode, เป้า, Gem, ผง, การ์ดอาร์ท] — สุ่มมา 10 ข้อ/วัน
const QD = [
  ['g', 'any', 1, 30, 0], ['g', 'any', 3, 60, 0], ['g', 'bot', 2, 30, 0], ['g', 'pvp', 1, 50, 0], ['g', 'pvp', 2, 80, 0],
  ['w', 'any', 1, 50, 0], ['w', 'any', 2, 90, 40], ['w', 'bot', 1, 40, 0], ['w', 'pvp', 1, 70, 0], ['w', 'hard', 1, 100, 40],
  ['sm', 'any', 5, 30, 0], ['sm', 'any', 10, 50, 0], ['sm', 'any', 15, 70, 40], ['sm', 'bot', 8, 40, 0], ['sm', 'pvp', 8, 60, 0],
  ['bd', 'any', 2, 30, 0], ['bd', 'any', 4, 60, 0],
  ['mg', 'any', 3, 30, 0], ['mg', 'any', 6, 50, 0], ['mg', 'any', 10, 80, 40],
  ['ak', 'any', 5, 30, 0], ['ak', 'any', 10, 50, 0], ['ak', 'any', 15, 80, 40],
  ['us', 'any', 5, 40, 0], ['wf', 'any', 1, 90, 40], ['op', 'any', 1, 50, 0], ['op', 'any', 3, 100, 40], ['s5', 'any', 2, 50, 0]];
// รายสัปดาห์ (ยากกว่ารายวัน รางวัลมากกว่า) — สุ่มมา 30 ข้อ/สัปดาห์
const QW = [
  ['g', 'any', 10, 150, 50], ['g', 'any', 20, 250, 100], ['g', 'any', 30, 350, 150], ['g', 'pvp', 8, 250, 100], ['g', 'pvp', 15, 400, 150], ['g', 'bot', 12, 200, 50],
  ['w', 'any', 5, 200, 100], ['w', 'any', 10, 350, 150], ['w', 'any', 15, 500, 200, 1], ['w', 'pvp', 5, 300, 100], ['w', 'pvp', 10, 500, 200], ['w', 'bot', 8, 200, 50],
  ['w', 'hard', 3, 250, 100], ['w', 'hard', 6, 400, 150], ['w', 'hard', 10, 550, 250, 1],
  ['sm', 'any', 40, 200, 50], ['sm', 'any', 80, 300, 100], ['sm', 'any', 120, 450, 150], ['sm', 'pvp', 40, 300, 100], ['sm', 'bot', 50, 200, 50],
  ['bd', 'any', 10, 200, 50], ['bd', 'any', 20, 350, 100],
  ['mg', 'any', 20, 200, 50], ['mg', 'any', 40, 350, 100], ['mg', 'any', 60, 500, 150],
  ['ak', 'any', 30, 200, 50], ['ak', 'any', 60, 350, 100], ['ak', 'any', 100, 500, 150],
  ['us', 'any', 30, 250, 100], ['us', 'any', 60, 400, 150],
  ['wf', 'any', 2, 250, 100], ['wf', 'any', 4, 450, 200, 1],
  ['op', 'any', 5, 300, 100], ['op', 'any', 10, 500, 200], ['op', 'any', 20, 800, 300, 1],
  ['cr', 'any', 1, 300, 0], ['cr', 'any', 3, 600, 0],
  ['s5', 'any', 10, 250, 50], ['s5', 'any', 20, 450, 100]];
// ชาเลนจ์ตั้งต้น (แอดมินเพิ่ม/ลบเองได้ในเกม) — ครั้งเดียวต่อบัญชี ไม่รีเซ็ต นับตั้งแต่ชาเลนจ์ถูกเพิ่ม
const QCH_DEF = [
  { name: 'นักล่าบอทระดับยาก', m: 'w', md: 'hard', need: 30, gems: 3000, dust: 1000, art: 1 },
  { name: 'ราชาแห่งสนาม', m: 'w', md: 'pvp', need: 50, gems: 5000, dust: 2000, art: 2 },
  { name: 'สายฟ้าแลบ', m: 'wf', md: 'any', need: 20, gems: 4000, dust: 1500, art: 1 },
  { name: 'จอมอัญเชิญ', m: 'sm', md: 'any', need: 500, gems: 3000, dust: 1000, art: 1 },
  { name: 'จอมเวทย์ประจำสนาม', m: 'mg', md: 'any', need: 300, gems: 3000, dust: 1000, art: 1 },
  { name: 'นักสะสมตัวยง', m: 'op', md: 'any', need: 100, gems: 6000, dust: 2500, art: 2 }];
// ความสำเร็จ (ตลอดบัญชี): ขั้นแรกง่าย ขั้นต่อไปยากขึ้น รางวัลเพิ่มตามขั้น
const QACH = [
  { id: 'a_w', ic: '🏆', name: 'ชนะสะสม', m: 'w', md: 'any', tiers: [1, 5, 10, 25, 50, 100, 200, 350, 500, 750, 1000] },
  { id: 'a_g', ic: '🎮', name: 'นักสู้ตัวยง (เล่นสะสม)', m: 'g', md: 'any', tiers: [5, 10, 25, 50, 100, 200, 350, 500, 750, 1000] },
  { id: 'a_h', ic: '🤖', name: 'ผู้พิชิตบอทระดับยาก', m: 'w', md: 'hard', tiers: [1, 3, 5, 10, 20, 35, 50, 75, 100] },
  { id: 'a_p', ic: '👥', name: 'คู่ปรับเพื่อนฝูง (ชนะเล่นกับเพื่อน)', m: 'w', md: 'pvp', tiers: [1, 3, 5, 10, 20, 35, 50, 75, 100, 150, 200] },
  { id: 'a_s', ic: '🔥', name: 'ชนะรวด', m: 'st', md: 'any', tiers: [2, 3, 4, 5, 7, 10, 15, 20] },
  { id: 'a_f', ic: '⚡', name: 'สายฟ้าแลบ (ชนะภายใน 12 เทิร์น)', m: 'wf', md: 'any', tiers: [1, 3, 5, 10, 20, 35, 50, 100] },
  { id: 'a_sm', ic: '🧙', name: 'นักอัญเชิญ', m: 'sm', md: 'any', tiers: [10, 50, 100, 250, 500, 1000, 2000, 3500, 5000] },
  { id: 'a_bd', ic: '🏗', name: 'นักก่อสร้าง', m: 'bd', md: 'any', tiers: [5, 20, 50, 100, 250, 500, 1000, 2000] },
  { id: 'a_mg', ic: '✨', name: 'จอมเวทย์', m: 'mg', md: 'any', tiers: [10, 50, 100, 250, 500, 1000, 2000, 3500] },
  { id: 'a_ak', ic: '⚔', name: 'นักรบสายบุก', m: 'ak', md: 'any', tiers: [20, 100, 250, 500, 1000, 2500, 5000, 8000] },
  { id: 'a_us', ic: '🎯', name: 'เจ้าแห่งความสามารถ', m: 'us', md: 'any', tiers: [10, 50, 100, 250, 500, 1000, 2500] },
  { id: 'a_s5', ic: '🦖', name: 'ยักษ์ใหญ่ (Avatar Cost 5+)', m: 's5', md: 'any', tiers: [5, 25, 100, 250, 500, 1000] },
  { id: 'a_op', ic: '📦', name: 'นักเปิดซอง', m: 'op', md: 'any', tiers: [1, 5, 10, 25, 50, 100, 200, 400, 700, 1000] },
  { id: 'a_cr', ic: '🔮', name: 'ช่างคราฟ', m: 'cr', md: 'any', tiers: [1, 3, 5, 10, 20, 40, 80] }];
const qAchR = t => ({ gems: 100 + 125 * t, dust: t >= 1 ? 100 * t : 0, art: (t >= 3 && (t - 3) % 3 === 0) ? 1 : 0 });   // รางวัลต่อขั้น (t เริ่มที่ 0)
const Q_ART_W = [['SEC', 70], ['PR', 20], ['UBR', 10]];   // การ์ดอาร์ทสุ่ม SEC 70% / PR 20% / UBR 10%
function qArt() {
  let x = Math.random() * 100, r = 'SEC'; for (const [t, w] of Q_ART_W) { if ((x -= w) < 0) { r = t; break; } }
  const pool = rr => { const A = []; CARDS.forEach(c => (c.v || []).includes(rr) && A.push({ id: c.id, r: rr })); return A; };
  let A = pool(r); for (const t of ['SEC', 'PR', 'UBR']) if (!A.length) A = pool(t);
  return A.length ? pick(A) : null;
}
const qTH = () => { const t = Date.now() + 7 * 36e5, day = Math.floor(t / 864e5), wk = Math.floor((day + 3) / 7); return { day, wk, dEnd: (day + 1) * 864e5 - 7 * 36e5 - Date.now(), wEnd: (wk * 7 - 3 + 7) * 864e5 - 7 * 36e5 - Date.now() }; };
function qRng(seed) { let a = 0; for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function qPick(len, n, seed) { const R = qRng(seed), I = Array.from({ length: len }, (_, i) => i); for (let i = I.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [I[i], I[j]] = [I[j], I[i]]; } return I.slice(0, Math.min(n, len)); }
let QCH = null, QCHDIRTY = 0;
let CODELOCK = Promise.resolve();
const codeLock = fn => { const p = CODELOCK.then(fn); CODELOCK = p.catch(() => {}); return p; };
const codesMsg = T => JSON.stringify({ t: 'codes', list: Object.entries(T || {}).map(([c, x]) => ({ c, gems: x.gems | 0, dust: x.dust | 0, art: x.art | 0, max: x.max | 0, u: x.u | 0, exp: x.exp | 0, t: x.t | 0 })).sort((a, b) => b.t - a.t) });
async function qCh() {   // รายการชาเลนจ์ (เก็บใน sys:challenges) — โหลดครั้งแรกแล้วแคช
  if (QCH) return QCH; const o = await dbGet('sys:challenges');
  if (o && Array.isArray(o.list)) QCH = o.list; else { QCH = QCH_DEF.map((c, k) => ({ ...c, id: 'c' + (1000 + k), t: 0 })); await dbPut('sys:challenges', { list: QCH }); }
  return QCH;
}
function qInit(d) {   // เตรียม/รีเซ็ตข้อมูลเควสของผู้เล่น (รีเซ็ตเมื่อข้ามวัน/สัปดาห์)
  const T = qTH(), q = d.qs = d.qs || {};
  if (!q.lt) { const st = (d.pf && d.pf.st) || {}; q.lt = { 'g:any': st.g | 0, 'w:any': st.w | 0 }; }
  if (q.day !== T.day) { q.day = T.day; q.dp = {}; q.dc = []; }
  if (q.wk !== T.wk) { q.wk = T.wk; q.wp = {}; q.wc = []; }
  q.cp = q.cp || {}; q.ch = q.ch || []; q.ac = q.ac || {};
  return q;
}
function qAdd(d, m, n, modes) {
  if (!(n > 0)) return; const q = qInit(d), MD = modes || ['any'];
  MD.forEach(md => { const k = m + ':' + md; q.dp[k] = (q.dp[k] | 0) + n; q.wp[k] = (q.wp[k] | 0) + n; q.lt[k] = (q.lt[k] | 0) + n; });
  (QCH || []).forEach(c => { if (c.m === m && MD.includes(c.md) && !q.ch.includes(c.id)) q.cp[c.id] = (q.cp[c.id] | 0) + n; });
}
const qModes = r => { const md = ['any', r.bot ? 'bot' : 'pvp']; if (r.bot && r.bot.lv === 3) md.push('hard'); return md; };
function qGame(d, r, k, win) {   // เรียกตอนเกมจบ: โอนตัวนับในเกมเข้าบัญชี
  const g = r.g, md = qModes(r), c = r.p[k].qc || {}; r.p[k].qc = {};
  Object.entries(c).forEach(([m, n]) => qAdd(d, m, n, md));
  if (g.n >= 3) { qAdd(d, 'g', 1, md); if (win) { qAdd(d, 'w', 1, md); if (g.n <= 12) qAdd(d, 'wf', 1, md); } }   // เกมที่ยอมแพ้ตั้งแต่ต้นไม่นับ
}
function qView(d, admin) {
  const q = qInit(d), T = qTH(), mk = (tx, p, n, o, cl, id) => ({ id, tx, p: Math.min(n, p | 0), n, gems: o.gems | 0, dust: o.dust | 0, art: o.art | 0, cl: cl ? 1 : 0 });
  const dI = qPick(QD.length, 10, 'D' + T.day), wI = qPick(QW.length, 30, 'W' + T.wk);
  const dl = dI.map(i => { const t = QD[i]; return mk(qText(t[0], t[1], t[2]), q.dp[t[0] + ':' + t[1]], t[2], { gems: t[3], dust: t[4], art: t[5] }, q.dc.includes(i), i); }).sort((a, b) => a.gems - b.gems);
  const wl = wI.map(i => { const t = QW[i]; return mk(qText(t[0], t[1], t[2]), q.wp[t[0] + ':' + t[1]], t[2], { gems: t[3], dust: t[4], art: t[5] }, q.wc.includes(i), i); }).sort((a, b) => a.gems - b.gems);
  const cl = (QCH || []).map(c => Object.assign(mk((c.name ? c.name + ' — ' : '') + qText(c.m, c.md, c.need), q.cp[c.id], c.need, c, q.ch.includes(c.id), c.id), { lim: c.lim | 0, cn: c.cn | 0, full: (c.lim | 0) > 0 && (c.cn | 0) >= (c.lim | 0) && !q.ch.includes(c.id) ? 1 : 0 }));
  const al = QACH.map(a => {
    const cur = a.m === 'st' ? ((d.pf && d.pf.st && d.pf.st.b) | 0) : (q.lt[a.m + ':' + a.md] | 0), t = q.ac[a.id] | 0;
    if (t >= a.tiers.length) return { id: a.id, ic: a.ic, tx: a.name, p: cur, n: a.tiers[a.tiers.length - 1], tier: a.tiers.length, of: a.tiers.length, done: 1, cl: 1, gems: 0, dust: 0, art: 0 };
    const o = qAchR(t); return { id: a.id, ic: a.ic, tx: a.name + ' — ' + qText(a.m, a.md, a.tiers[t]), p: Math.min(cur, a.tiers[t]), n: a.tiers[t], tier: t + 1, of: a.tiers.length, gems: o.gems, dust: o.dust, art: o.art, cl: 0 };
  });
  const rd = x => x.filter(y => !y.cl && !y.full && y.p >= y.n).length, R = { d: rd(dl), w: rd(wl), c: rd(cl), a: rd(al) };
  const v = { d: dl, w: wl, c: cl, a: al, rd: R, red: R.d + R.w + R.c + R.a, rs: { d: T.dEnd, w: T.wEnd } };
  if (admin) v.meta = { m: Object.keys(QT).filter(k => k !== 'st').map(k => [k, QT[k]]), md: Object.keys(QMN).map(k => [k, QMN[k]]) };
  return v;
}
const qRed = d => { try { return qView(d).red; } catch (e) { return 0; } };
function qGive(d, o, cards) { d.gems += o.gems | 0; d.dust = (d.dust || 0) + (o.dust | 0); for (let k = 0; k < (o.art | 0); k++) { const c = qArt(); if (c) { add(d, c); cards.push(c); } } }
function qClaim(d, kind, id, all) {   // รับรางวัล: คืน { gems, dust, cards, n }
  const q = qInit(d), V = qView(d), tot = { gems: 0, dust: 0, cards: [], n: 0 }, give = o => { qGive(d, o, tot.cards); tot.gems += o.gems | 0; tot.dust += o.dust | 0; tot.n++; };
  const L = (V[kind] || []).filter(x => all || String(x.id) === String(id));
  for (const x of L) {
    if (kind === 'a') {
      const a = QACH.find(z => z.id === x.id); if (!a) continue;
      const cur = a.m === 'st' ? ((d.pf && d.pf.st && d.pf.st.b) | 0) : (q.lt[a.m + ':' + a.md] | 0);
      while ((q.ac[a.id] | 0) < a.tiers.length && cur >= a.tiers[q.ac[a.id] | 0]) { give(qAchR(q.ac[a.id] | 0)); q.ac[a.id] = (q.ac[a.id] | 0) + 1; }
      continue;
    }
    if (x.cl || x.full || x.p < x.n) continue;
    if (kind === 'd') q.dc.push(x.id); else if (kind === 'w') q.wc.push(x.id); else if (kind === 'c') { const cc = (QCH || []).find(z => z.id === x.id); if (cc && (cc.lim | 0) > 0) { if ((cc.cn | 0) >= (cc.lim | 0)) continue; cc.cn = (cc.cn | 0) + 1; QCHDIRTY = 1; } q.ch.push(x.id); } else continue;
    give(x);
  }
  return tot;
}
async function qHandle(ws, m) {   // ข้อความ WebSocket ของระบบเควส (คืน true ถ้าจัดการแล้ว)
  if (m.t !== 'qget' && m.t !== 'qclaim' && m.t !== 'qchadd' && m.t !== 'qchdel') return false;
  await qCh(); const d = await dbGet(ws.user), adm = ws.user === ADMIN, sendQ = () => ws.send(JSON.stringify({ t: 'qs', q: qView(d, adm) }));
  if (m.t === 'qget') { sendQ(); return true; }
  if (m.t === 'qclaim') {
    const k = ['d', 'w', 'c', 'a'].includes(m.k) ? m.k : E('ประเภทเควสผิด'), tot = qClaim(d, k, m.id, !!m.all); if (!tot.n) E('ยังรับรางวัลไม่ได้');
    if (QCHDIRTY) { QCHDIRTY = 0; await dbPut('sys:challenges', { list: QCH }); }
    await dbPut(ws.user, d); const note = '🎁 รับรางวัลเควส' + (tot.gems ? ' 💎 ' + tot.gems.toLocaleString('en-US') : '') + (tot.dust ? ' ✨ ' + tot.dust.toLocaleString('en-US') : '') + (tot.cards.length ? ' 🃏 ' + tot.cards.length + ' ใบ' : '');
    sendQ(); if (tot.cards.length) { const ps = []; for (let i = 0; i < tot.cards.length; i += 5) ps.push(tot.cards.slice(i, i + 5)); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d), note })); } else ws.send(JSON.stringify({ t: 'me', me: prof(ws.user, d), note }));
    return true;
  }
  if (!adm) E('เฉพาะแอดมิน');
  const L = QCH;
  if (m.t === 'qchadd') {
    const M = String(m.m), MD = QNOMODE.includes(M) ? 'any' : String(m.md); if (!QT[M] || M === 'st' || !QM[MD] && MD !== 'any') E('ชนิดชาเลนจ์ไม่ถูกต้อง');
    const cl = (v, hi) => Math.min(hi, Math.max(0, +v | 0)), need = cl(m.need, 1e6); if (!need) E('ใส่จำนวนเป้าหมาย');
    L.push({ id: 'c' + Date.now().toString(36), name: String(m.name || '').trim().slice(0, 40), m: M, md: MD, need, gems: cl(m.gems, 1e6), dust: cl(m.dust, 1e6), art: cl(m.art, 20), lim: cl(m.lim, 1e6), cn: 0, t: Date.now() });
    await dbPut('sys:challenges', { list: L }); QCH = L; sendQ(); ws.send(JSON.stringify({ note: 'เพิ่มชาเลนจ์แล้ว' })); return true;
  }
  const k = L.findIndex(c => c.id === String(m.id)); if (k < 0) E('ไม่พบชาเลนจ์');
  L.splice(k, 1); await dbPut('sys:challenges', { list: L }); QCH = L; sendQ(); ws.send(JSON.stringify({ note: 'ลบชาเลนจ์แล้ว' })); return true;
}
function qCount(r, i, m, pre) {   // นับการลงการ์ด/โจมตี ระหว่างเกม (เก็บไว้ในห้อง แล้วโอนเข้าบัญชีตอนเกมจบ)
  const w = r.p[i] && r.p[i].ws; if (!w || !w.user) return;   // นับเฉพาะผู้เล่นจริง
  const c = r.p[i].qc = r.p[i].qc || {}, up = k => { c[k] = (c[k] | 0) + 1; };
  if (m.t === 'summon') { up('sm'); if (pre.id && B[pre.id] && (B[pre.id].c | 0) >= 5) up('s5'); }
  else if (m.t === 'build') up('bd'); else if (m.t === 'cast') up('mg'); else if (m.t === 'atk') up('ak'); else if (m.t === 'use') up('us');
}
/* ===================== จบระบบเควส ===================== */

const RW = { R: 92, SR: 7, UR: .8, SEC: .15, PR: .03, UBR: .015, USEC: .005 };
const CW = { R: 70, SR: 24, UR: 4.5, SEC: 1, PR: .3, UBR: .15, USEC: .05 };
const GW = { UR: 90, SEC: 8.5, PR: 1, UBR: .4, USEC: .1 };
function eff(av, W) { const o = {}; for (const t of RT) { const w = W[t]; if (!w) continue; let k = RT.indexOf(t); while (k > 0 && !av.has(RT[k])) k--; const tt = av.has(RT[k]) ? RT[k] : 'C'; o[tt] = (o[tt] || 0) + w; } return o; }
function pack(set, gar) {
  const R = []; CARDS.forEach(c => c.id.startsWith(set + '-') && c.v.forEach(r => R.push({ id: c.id, r })));
  const av = new Set(R.map(x => x.r)), by = r => R.filter(x => x.r === r);
  if (isCC(set)) { const W = gar ? CCG : CCW, e = Object.entries(W).filter(([t]) => av.has(t)), tot = e.reduce((a, [, w]) => a + w, 0); let x = Math.random() * tot, t5 = 'SR'; for (const [t, w] of e) if ((x -= w) < 0) { t5 = t; break; } const g = r => { const a = by(r); return a.length ? pick(a) : pick(R); }; return [g('SR'), g('SR'), g('SR'), g('SR'), g(t5)]; }
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
  await qCh().catch(() => { });
  for (let k = 0; k < 2; k++) { const w = r.p[k].ws; if (!w || !w.user) continue; const gn = r.bot ? (k === g.win ? BOT_LV[r.bot.lv].win : BOT_LOSE) : (k === g.win ? 150 : 50); const d = await dbGet(w.user); d.gems += gn; const pfx = pfGain(d, k === g.win, !!r.bot, r.p[1 - k].name); try { qGame(d, r, k, k === g.win); } catch (e) { console.log('quest err', e); } await dbPut(w.user, d); w.send(JSON.stringify({ t: 'me', me: prof(w.user, d), gain: gn, pfx })); } }
const wss = new WebSocketServer({ server: srv });
const rooms = {}; let UID = 1, DRN = 0, BTN = 0, DCN = 0;
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/* ===== KD: การ์ดพิมพ์ซ้ำ (reprint) ใช้สกิลเดิมของการ์ดต้นฉบับ: instance เก็บ id ต้นฉบับ + kd = id จริง (ใช้แสดงรูป) ===== */
const CANON = { 'KD01-006': 'SD01-002', 'KD01-008': 'BT02-008', 'KD01-010': 'BT01-004', 'KD01-013': 'BT01-038', 'KD01-014': 'BT02-045', 'KD01-015': 'SD08-013', 'KD01-017': 'SD01-017', 'KD01-018': 'BT02-054', 'KD01-019': 'SD01-020', 'KD01-020': 'BT02-060',
  'KD02-003': 'SD03-001', 'KD02-004': 'BT01-016', 'KD02-006': 'SD03-002', 'KD02-007': 'SD03-003', 'KD02-008': 'SD03-004', 'KD02-009': 'BT01-015', 'KD02-015': 'BT02-046', 'KD02-016': 'SD08-013', 'KD02-018': 'BT01-041', 'KD02-020': 'BT02-058',
  'KD03-003': 'BT02-009', 'KD03-004': 'BT03-026', 'KD03-007': 'BT02-010', 'KD03-008': 'BT03-014', 'KD03-011': 'BT02-012', 'KD03-012': 'BT01-038', 'KD03-013': 'BT03-044', 'KD03-014': 'BT03-042', 'KD03-016': 'SD01-017',
  'KD04-003': 'BT03-004', 'KD04-005': 'BT03-006', 'KD04-006': 'BT03-007', 'KD04-007': 'BT03-005', 'KD04-013': 'BT03-051', 'KD04-018': 'BT01-038', 'KD04-019': 'BT01-041', 'KD04-020': 'BT03-049' };
Object.assign(CANON, {'CC01-002': 'KD01-005', 'CC01-004': 'KD01-007', 'CC01-021': 'BT03-003', 'CC01-022': 'BT01-001', 'CC01-023': 'BT02-005', 'CC01-025': 'BT01-009', 'CC01-026': 'BT01-011', 'CC01-027': 'BT02-012', 'CC01-028': 'SD03-002', 'CC01-029': 'SD03-003', 'CC01-030': 'BT02-022', 'CC01-031': 'BT02-024', 'CC01-032': 'BT02-025', 'CC01-033': 'SD04-002', 'CC01-034': 'SD04-003', 'CC01-048': 'KD03-018', 'CC01-052': 'SD01-017', 'CC01-053': 'SD02-017', 'CC01-054': 'SD04-014', 'CC01-055': 'SD04-019', 'CC01-056': 'BT01-038', 'CC01-057': 'BT01-036', 'CC01-058': 'BT01-042', 'CC01-059': 'BT01-050', 'CC01-060': 'BT02-058', 'CC02-021': 'BT01-002', 'CC02-022': 'KD04-009', 'CC02-024': 'BT04-001', 'CC02-025': 'BT05-008', 'CC02-026': 'BT02-014', 'CC02-027': 'BT03-018', 'CC02-028': 'BT03-011', 'CC02-030': 'BT03-017', 'CC02-031': 'BT05-019', 'CC02-032': 'BT01-020', 'CC02-033': 'BT01-021', 'CC02-034': 'BT03-020', 'CC02-035': 'BT05-028', 'CC02-036': 'BT04-023', 'CC02-037': 'BT02-029', 'CC02-038': 'BT03-034', 'CC02-040': 'BT05-042', 'CC02-053': 'BT04-041', 'CC02-054': 'BT02-052', 'CC02-055': 'BT03-050', 'CC02-056': 'BT05-060', 'CC02-057': 'BT03-052', 'CC02-059': 'BT01-047', 'CC02-060': 'BT01-049', 'FPRO-001': 'BT08-038', 'FPRO-003': 'BT07-023', 'FPRO-007': 'BT04-010', 'ODY1-006': 'SD01-001', 'ODY1-008': 'BT01-003', 'ODY1-009': 'BT01-002', 'ODY1-011': 'BT01-006', 'ODY1-012': 'BT01-007', 'ODY1-013': 'BT02-002', 'ODY1-014': 'BT02-003', 'ODY1-015': 'SD01-003', 'ODY1-016': 'SD01-004', 'ODY1-017': 'BT01-008', 'ODY1-018': 'BT01-009', 'ODY1-020': 'BT01-011', 'ODY1-021': 'BT01-012', 'ODY1-022': 'BT01-013', 'ODY1-024': 'BT02-012', 'ODY1-025': 'BT02-015', 'ODY1-026': 'SD02-004', 'ODY1-027': 'BT01-016', 'ODY1-029': 'BT01-020', 'ODY1-030': 'BT01-015', 'ODY1-031': 'BT01-018', 'ODY1-032': 'BT01-019', 'ODY1-033': 'BT01-021', 'ODY1-034': 'BT02-017', 'ODY1-035': 'BT02-021', 'ODY1-036': 'SD03-002', 'ODY1-062': 'BT04-040', 'ODY1-067': 'BT01-036', 'ODY1-068': 'BT01-038', 'ODY1-070': 'BT01-042', 'ODY1-071': 'BT01-045', 'ODY1-072': 'BT01-046', 'ODY1-073': 'BT01-040', 'ODY1-074': 'BT01-050', 'ODY1-075': 'SD01-016', 'ODY1-076': 'SD02-017', 'ODY1-077': 'KD02-019', 'ODY1-078': 'BT01-037', 'ODY1-079': 'BT01-043', 'ODY1-081': 'BT01-047', 'ODY1-083': 'BT01-049', 'ODY1-084': 'BT01-039', 'ODY1-086': 'BT02-045', 'ODY1-087': 'BT02-050', 'ODY1-088': 'SD01-018', 'ODY1-089': 'SD02-018', 'PRMO-003': 'SD01-017', 'PRMO-004': 'BT01-043', 'PRMO-005': 'SD02-017', 'PRMO-006': 'BT01-012', 'PRMO-007': 'BT01-046', 'PRMO-008': 'BT01-045', 'PRMO-009': 'SD01-001', 'PRMO-011': 'BT02-009', 'PRMO-012': 'BT02-022', 'PRMO-013': 'BT02-028', 'PRMO-014': 'BT02-043', 'PRMO-016': 'BT02-015', 'PRMO-017': 'BT02-024', 'PRMO-019': 'BT01-038', 'PRMO-020': 'SD03-001', 'PRMO-022': 'SD01-003', 'PRMO-024': 'BT03-026', 'PRMO-025': 'BT03-024', 'PRMO-026': 'BT03-029', 'PRMO-027': 'SD01-002', 'PRMO-028': 'BT03-047', 'PRMO-030': 'SD05-001', 'PRMO-031': 'BT03-060', 'PRMO-033': 'BT04-011', 'PRMO-034': 'BT04-017', 'PRMO-035': 'BT01-040', 'PRMO-036': 'BT04-021', 'PRMO-037': 'BT04-009', 'PRMO-038': 'SD04-004', 'PRMO-040': 'SD01-005', 'PRMO-041': 'BT02-056', 'PRMO-043': 'BT03-010', 'PRMO-044': 'BT02-046', 'PRMO-045': 'BT01-048', 'PRMO-047': 'BT05-027', 'PRMO-048': 'BT05-022', 'PRMO-049': 'BT05-035', 'PRMO-050': 'BT01-050', 'PRMO-054': 'BT05-006', 'PRMO-0562': 'BT04-004', 'PRMO-059': 'BT04-044', 'PRMO-060': 'BT05-024', 'PRMO-061': 'BT06-015', 'PRMO-062': 'BT05-007', 'PRMO-064': 'BT05-031', 'PRMO-065': 'SD02-001', 'PRMO-066': 'SD02-002', 'PRMO-067': 'SD02-003', 'PRMO-068': 'BT01-039', 'PRMO-069': 'BT04-049', 'PRMO-071': 'BT05-025', 'PRMO-072': 'BT06-016', 'PRMO-073': 'BT05-029', 'PRMO-074': 'BT06-009', 'PRMO-076': 'BT07-022', 'PRMO-077': 'BT05-041', 'PRMO-079': 'BT01-020', 'PRMO-083': 'BT06-025', 'PRMO-084': 'BT05-030', 'PRMO-085': 'BT05-003', 'PRMO-087': 'BT04-003', 'PRMO-090': 'BT07-051', 'PRMO-095': 'BT08-061', 'PRMO-096': 'SD07-007', 'PRMO-101': 'SD08-013', 'PRMO-102': 'SD07-006', 'PRMO-103': 'BT07-068', 'PRMO-104': 'SD06-018', 'PRMO-105': 'SD06-003', 'PRMO-106': 'BT07-035', 'PRMO-107': 'BT09-056', 'PRMO-108': 'BT08-024', 'PRMO-109': 'BT07-043', 'PRMO-110': 'SD07-016', 'PRMO-114': 'BT07-021', 'PRMO-115': 'BT05-039', 'PRMO-119': 'SD01-017', 'SL01-001': 'BT03-035', 'SL01-002': 'BT01-017', 'SL01-003': 'SD01-001', 'SL01-004': 'SD01-002', 'SL01-005': 'SD01-003', 'SL01-007': 'SD08-013', 'SL01-008': 'BT02-008', 'SL02-001': 'BT07-006', 'SL02-002': 'BT07-013', 'SL02-003': 'BT05-017', 'SL02-004': 'BT08-020', 'SL02-008': 'BT06-053', 'SL02-009': 'BT06-003', 'SL02-010': 'BT06-004'});   // การ์ดพิมพ์ซ้ำ (CC/ODY1/PRMO/FPRO/SL) ที่ไม่มี handler ของตัวเอง → ใช้สกิลของใบต้นฉบับ (instance เก็บ kd = id จริงไว้แสดงรูป)
const inst = id => CANON[id] ? { u: UID++, id: CANON[id], kd: id, pw: 0, tired: false } : { u: UID++, id, pw: 0, tired: false };
const ZN = ['hand','hell','av','mg','co','dk'];
const E = s => { throw s; };
let CR = null, FXN = 0;
const fx = o => { if (!CR || !CR.g) return; const g = CR.g; (g.fxl = g.fxl || []).push({ n: ++FXN, ...o }); if (g.fxl.length > 20) g.fxl.shift(); };
function sweep(r) { chk052(r); bt4Sweep(r); r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) { const m = p.mg[k]; if (m.at != null && !r.p.some(q => q.av.some(a => a.u === m.at))) { p.mg.splice(k, 1); delete m.at; p.hell.push(m); mgHellTrig(r, p, m); } } }); }
function mgHellTrig(r, p, m) { if (['ตีแม่', 'ตีพ่อ'].includes(B[m.id].n.trim())) { const pi = r.p.indexOf(p); fx({ k: 'say', id: m.id, t: 'หงาย LIFE' }); log(r, '🪓 ' + B[m.id].n.trim() + ' ตกนรก: หงาย LIFE ใบบนสุดของ ' + p.name); lifeUp(r, pi); } }

/* ===== ENGINE: กฎ v3.2 + สกิล SD01-08 + BT01-02 ===== */
const nmOf = x => x.tk ? x.tk.n : (x.nmo || ccName(x) || B[x.id].n) + ccAlias(x) + ((x.id === 'BT09-015' && !x.tk) ? ' / ทหารหิมะ' : '') + ((CR && CR.p.some(q => q.mg.some(m => m.at === x.u && m.id === 'BT07-064'))) ? ' / Super Air' : '');
const symOf = x => x.tk ? (x.tk.s || '') : x.sy ? x.sy : (CR && CR.p.some(q => q.mg.some(m => m.at === x.u && m.id === 'BT05-063'))) ? (B[x.id].s || '') : (CR && CR.p.some(q => q.mg.some(m => m.at === x.u && m.id === 'BT05-066'))) ? 'เครื่องจักร' : (x.wr && x.wr.some(w => w.id === 'BT03-021' || w.id === 'CC01-014')) ? 'ผี' : (CR && CR.g && CR.g.land && CR.g.land.c.id === 'BT02-060' && CR.p.some(q => q.av.includes(x))) ? 'เทพ' : (B[x.id].s || '');
const isAv = x => !x.tk && B[x.id] && B[x.id].t === 'Avatar';
const TRIO = ['กุ่ย', 'ฮอล', 'นาย'];
const allAv = r => { const a = []; r.p.forEach((p, i) => p.av.forEach(x => a.push({ i, x }))); return a; };
const addPw = (x, n) => { n = bt8Snow(x, n); if (n < 0 && MGX > 0 && CR && is016(x) && CR.p.some(q => q.av.includes(x)) && CR.p.findIndex(q => q.av.includes(x)) !== MGWHO && !noFx(CR, x)) return; if (n < 0 && x.hero != null && CR && CR.g && x.hero === CR.g.n) return; x.pw = (x.pw || 0) + n; if (n > 0) x.bc = (x.bc || 0) + 1; n && fx({ k: 'buff', u: x.u, v: n }); };
const addTp = (x, n) => { n = bt8Snow(x, n); if (n < 0 && MGX > 0 && CR && is016(x) && CR.p.some(q => q.av.includes(x)) && CR.p.findIndex(q => q.av.includes(x)) !== MGWHO && !noFx(CR, x)) return; if (n < 0 && x.hero != null && CR && CR.g && x.hero === CR.g.n) return; x.tp = (x.tp || 0) + n; if (n > 0) x.bc = (x.bc || 0) + 1; n && fx({ k: 'buff', u: x.u, v: n }); };
const lose = (r, i, why) => { if (r.g.over) return; r.g.over = r.p[i].name + ' ' + why + ' แพ้!'; r.g.win = 1 - i; };

// [MERGED] SD07/SD08 helpers
const colOf = x => x.tk ? (x.tk.col || '') : (B[x.id].col || '');
const KP8 = new Set(['BT08-005', 'BT08-006', 'BT08-018', 'BT08-035']);   // BT08: "#Avatar ใบนี้ถือว่ามีชื่อ ขุนพล"
const isKP = x => isAv(x) && (symOf(x) === 'ต่างชาติ' || also9(x, 'ต่างชาติ')) && (B[x.id].n.includes('ขุนพล') || KP8.has(x.id));
const isRat = x => isAv(x) && symOf(x) === 'รัททาทุย';
const isRat1 = x => isRat(x) && B[x.id].c === 1 && B[x.id].g === 1 && B[x.id].p === 1;
const guanOn = (r, i) => r.p[i].av.some(a => a.id === 'SD07-001');
const protectedFrom0 = (r, who, x) => who !== undefined && !x.tk && ((isKP(x) && x.id !== 'SD07-001' && guanOn(r, r.p.findIndex(p => p.av.includes(x))) && r.p.findIndex(p => p.av.includes(x)) !== who) || (x.hero === r.g.n && r.p.findIndex(p => p.av.includes(x)) !== who));
let MGX = 0, MGWHO = -1;   // MGX>0 = กำลังประมวลผล Magic, MGWHO = ผู้ร่าย Magic นั้น
const is016 = x => !!x && !x.tk && (x.id === 'BT04-016' || x.id === 'CC02-029');   // ริกกี้ คุณตา / คุณตาใจดี
const mg016 = (r, f) => !!(f && f.z === 'av' && MGX > 0 && (is016(f.c) || f.c.mgProt >= r.g.n || bt8Rg(r, f.c)) && f.i !== MGWHO && !noFx(r, f.c));   // Magic ฝ่ายตรงข้ามกำลังจะมีผลกับ 016
const protectedFrom = (r, who, x, mg) => protectedFrom0(r, who, x) || bt8Prot(r, who, x, mg) || bt9Prot(r, who, x, mg) || bt10Prot(r, who, x, mg) || (who !== undefined && (is016(x) || x.mgProt >= r.g.n) && (MGX > 0 || mg) && r.p.findIndex(q => q.av.includes(x)) !== who && !noFx(r, x));
const allAvT = (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x)).map(a => a.x.u);
const canPlaceAv = (r, i, c) => { if (bt9NoPlace(r, i, c) || cc2NoPlace(r, i, c)) return false; if (c.id === 'KD02-001' && !c.kdOK) return false; if (r.g.sa5 && r.g.sa5.i === i && r.g.sa5.n === r.g.n && !B[c.id].n.includes('Super Air')) return false; if (c.id === 'BT05-017' && r.p[i].av.some(a => a.id === 'BT05-017')) return false; if (c.id === 'BT08-011' && r.p[i].av.some(a => a.id === 'BT08-011')) return false; if (c.id === 'BT06-006' && r.p[i].av.some(a => a.id === 'BT06-006')) return false; const p = r.p[i], L = r.g.land, cap = ((L && L.o === i && L.c.id === 'SD08-017' && p.av.every(isRat) && isRat(c)) || (L && L.o === i && L.c.id === 'BT04-059' && p.av.every(a => symOf(a) === 'รัททาทุย') && symOf(c) === 'รัททาทุย')) ? 6 : 4; return p.av.filter(x => !x.tk).length < cap && p.av.length < 6; };
const addHold = (x, v, until) => { (x.hd = x.hd || []).push({ v, until }); if (v > 0) x.bc = (x.bc || 0) + 1; fx({ k: 'buff', u: x.u, v }); };
function endTurnFx(r) {
  const g = r.g; bt10End(r); ccEnd(r);   // BT10
  r.p.forEach(q => q.av.forEach(a => { if (a.hd) a.hd = a.hd.filter(h => h.until > g.n); }));
  r.p.forEach(q => q.av.slice().forEach(a => { if (a.ctl) { const to = a.ctl.from; take(r, a.u); delete a.ctl; delete a.nolife;
    if (canPlaceAv(r, to, a)) { a.tired = false; r.p[to].av.push(a); log(r, '↩ ' + nmOf(a) + ' กลับไปฝั่งเจ้าของ'); } else r.p[to].hell.push(a); } }));
}
function summonAny(r, i, u, from, src) {
  const p = r.p[i], k = p[from].findIndex(h => h.u === u); if (k < 0) return false; const c = p[from][k]; if (from === 'hell' && c.h40) return false; if (cc2SumBlock(r, from, c)) return false; delete c.jt; delete c.mute17; noteSum(r, i, c); c.fh = from === 'hell' ? 1 : 0; bt10Src(c, src);
  if (from === 'hell') { const jn = r.p.flatMap(q => q.av).find(a => a.id === 'BT05-012' && !noFx(r, a)); if (jn) { vfx(jn.u, 'aura', 'อัญเชิญจากนรกไม่ได้', '#ef4444'); log(r, '🚫 เจนนี่ อย่าบู้บี้เลขา: อัญเชิญ Avatar จากนรกไม่ได้'); return false; } }   // BT05-012
  if (!canPlaceAv(r, i, c)) { log(r, 'Avatar เต็ม อัญเชิญ ' + B[c.id].n + ' ไม่ได้'); return false; }
  p[from].splice(k, 1); c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; p.av.push(c); heroMk(r, i, c); ev(r, c.kd || c.id); fx({ k: 'summon', u: c.u });
  log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + ' จาก' + ({ deck: ' Deck', hell: 'นรก', hand: 'มือ' }[from] || ''));
  if (c.id === 'BT05-004' && src && isKnight(src)) r.g.q.unshift(() => { const q = r.p[1 - i], opts = [...q.av.filter(a => !protectedFrom(r, i, a, 1)), ...q.co, ...q.mg].map(x => x.u); if (!opts.length) return log(r, 'ทริสทัน: ไม่มีเป้าหมายบนสนามฝ่ายตรงข้าม'); ask(r, i, { text: 'ทริสทัน: ทำลายการ์ด 1 ใบบนสนามฝ่ายตรงข้าม', opts, cb: us => { vfx(us[0], 'burst', 'ทำลาย', '#ef4444'); destroyAny(r, us[0]); } }); });   // BT05-004
  if (src && isKP(src)) {
    if (c.id === 'SD07-003') r.g.q.unshift(() => { const opts = []; r.p.forEach(q => { q.av.forEach(x => opts.push(x.u)); q.co.forEach(x => opts.push(x.u)); q.mg.forEach(x => opts.push(x.u)); }); ask(r, i, { text: 'แฮหัวตุ้น: ทำลายการ์ดบนสนาม 1 ใบ', opts, cb: us => destroyAny(r, us[0]) }); });
    if (c.id === 'SD07-004') r.g.q.unshift(() => { draw(r, p, 1); log(r, '✨ แฮหัวเอี๋ยน: จั่ว 1 ใบ'); });
  }
  return true;
}
function destroyAny(r, u) { const f = find(r, u); if (!f) return; if (f.z === 'av') { const fi = f.i, fu = f.c.u; kill(r, fi, fu); } else { if (f.z === 'mg' && f.c.mgAv && isMTree10(f.c) && r.g.turn !== f.i && r.p[f.i].mg.some(m => m.id === 'BT10-042' && m.mgAv)) return log(r, '🥭 ผู้พิทักษ์แห่งภาคีมะม่วง: ต้นมะม่วงบน Magic Zone ไม่ถูกทำลายจากความสามารถการ์ดฝ่ายตรงข้าม'); take(r, u); if (!f.c.tk) r.p[f.i].hell.push(f.c); log(r, '💥 ทำลาย ' + nmOf(f.c)); } }
function buildFree(r, i, c, from) {
  const p = r.p[i], k = p[from].findIndex(h => h.u === c.u); if (k < 0) return false;
  if (p.co.length >= 3 || (p.co.some(x => B[x.id].n === B[c.id].n) && B[c.id].n.trim() !== 'เรือรบโบราณ')) { log(r, 'ก่อสร้าง ' + B[c.id].n + ' ไม่ได้'); return false; }
  p[from].splice(k, 1); p.co.push(c); ev(r, c.kd || c.id); log(r, '🏗 ' + p.name + ': ก่อสร้าง ' + B[c.id].n);
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
    log(r, '🔍 สอดแนม 3 ใบ');
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
    fxPaid03(r, i, pc, summoned); kdPaid(r, i, pc, summoned); bt4Paid(r, i, pc, summoned); bt5Paid(r, i, pc, summoned);
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
    if (L === 'BT06-062' && nmOf(x).includes('นาค') && s === 'สัตว์มหัศจรรย์') v += 1;   // BT06-062 ถ้ำนาคา
    if (L === 'BT04-060' && ['ผี', 'เปรต', 'เอเลี่ยน', 'กะปอม'].includes(s)) v += 1;   // BT04-060: ผี เปรต เอเลี่ยน ไดโนเสาร์(กะปอม) +1
    if (x.id === 'SD07-002') v += 1;
    if (campTxt(x) && r.p[f.i].co.some(c => c.id === 'BT10-073')) v += 1;   // BT10-073
    v += mod456(r, x, f) + mod03(r, x, f) + mod04(r, x, f) + mod05(r, x, f) + mod07(r, x, f) + mod08(r, x, f) + modCC1(r, x, f) + modCC2(r, x, f);
    r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u) {
      if (m.id === 'SD01-016') v += 1;
      if (m.id === 'SD04-019') v += m.cp || 0;   // ถาดหลุม: +2/-2 สะสมถาวร
      if (B[m.id].n.trim() === 'ตีแม่') v += 2;   // ตีแม่: POWER +2 ให้ Avatar ที่สวมใส่
      if ((m.id === 'SD03-018' || m.id === 'KD02-019') && s === 'นรก') v += 1;
      if (m.id === 'SD07-018') v += B[x.id].n.startsWith('กวนอู') ? 2 : 1;
      if (m.id === 'SD08-016') v += p.av.filter(isRat).length;
      if (m.id === 'BT04-056') v += 3;
      if (m.id === 'BT06-054') v += 2;
    } }));
    { const L2 = r.g.land; if (L2 && L2.o === f.i && L2.c.id === 'SD07-019' && new Set(p.av.map(colOf).filter(Boolean)).size >= 4) v += 2; }
    p.co.forEach(k => {
      if (k.id === 'SD07-020' && !x.tk && B[x.id].n.includes('ขุนพล') && isCol(x, 'ม่วง')) v += 1;
      if (k.id === 'SD08-019' && isRat1(x)) v += 1;
      if (k.id === 'BT06-064' && r.g.turn === f.i && r.g.phase === 'battle') v += 1;   // BT06-064
    });
    (x.hd || []).forEach(h => { if (h.until >= r.g.n) v += h.v; });
    if (x.id === 'SD03-005' || (x.id === 'BT08-023' && x.gain8 === 'SD03-005')) v += new Set(p.hell.filter(h => isAv(h) && isNir(h)).map(h => B[h.id].n)).size;
  }
  if (x.id === 'BT04-008' && f && f.z === 'av' && !noFx(r, x)) v += r.p[1 - f.i].hand.length;   // BT04-008 ลูกคนรวย: POWER = จำนวนการ์ดบนมือฝ่ายตรงข้าม (base 0)
  if (f && f.z === 'av') v = bt6P(r, x, f, v);
  if (f && f.z === 'av' && r.g.land && r.g.land.c.id === 'BT07-067') v = Math.floor(Math.max(0, v) / 2);   // BT07-067 หมู่บ้านเห็ด: ลดครึ่ง ปัดลง
  v -= neg053(r, x);
  return Math.max(0, v);
}
const kick = (r, a) => a.kk === r.g.n || (!a.tk && a.hero === r.g.n) || a.k31 === r.g.n || (a.id === 'BT04-032' && r.p.some(q => q.av.includes(a) && q.av.some(x => nmOf(x).includes('พระเจ้านิโคไล')))) || /เตะไข่/.test(a.tk || a.id === 'BT04-032' || B7NK[a.id] ? '' : B[a.id].e) || (a.id === 'BT07-025' && !noFx(r, a) && hasHn(r, r.p.findIndex(q => q.av.includes(a)))) || (a.id === 'BT09-038' && !a.tk && hasKw(r, a, 'เตะไข่')) || r.p.some(q => q.mg.some(m => m.at === a.u && B[m.id].e.includes('เตะไข่') && (m.id !== 'BT08-059' || B[a.id].n.includes('มอเดรด'))));
const allCards = (r, u) => { for (let i = 0; i < 2; i++) for (const z of [...ZN, 'deck']) { const c = r.p[i][z].find(x => x.u === u); if (c) return { i, z, c }; } return null; };
function runQ(r) { CR = r; const g = r.g; let n = 0; if (g && g.pendAfter && !g.ask && !g.pend) { const f = g.pendAfter; g.pendAfter = null; try { f(); } catch (e) { console.error('fx', e); } } while (g && !g.over && !g.ask && !g.pend && g.q.length && n++ < 100) { const f = g.q.shift(); try { f(r); } catch (e) { console.error('fx', e); } } try { bt6Own(r); bt6Cage(r); } catch (e) { console.error('bt6', e); } try { bt5Sand(r); } catch (e) { console.error('sand', e); } sweep(r); }
function ask(r, who, o) {
  const opts = (o.yn || o.choices) ? [] : o.opts;
  if (!o.yn && !o.choices && !opts.length) { o.none && o.none(); return false; }
  const n = Math.min(o.n || 1, opts.length), min = Math.min(o.min == null ? n : o.min, n);
  r.g.ask = { src: HAND_SRC, who, text: o.text, hint: o.hint, rps: !!o.rps, opts, n, min, cancel: !!o.cancel, yn: !!o.yn, choices: o.choices || null, cb: o.cb, onCancel: o.onCancel,
    cards: opts.map(u => { const f = allCards(r, u); return f ? { u, id: f.c.kd || f.c.id, ar: f.c.ar, tk: f.c.tk ? f.c.tk.n : null, i: f.i, z: f.z } : { u }; }) };
  return true;
}
// ===== ไพรมอล รัททาทุย (SD08-001) สกิล 2: อัตโนมัติ เทิร์นละครั้ง เมื่อจะออกจากสนาม เนรเทศ {รัททาทุย} ในนรก 5 ใบ → ไม่ออกจากสนาม =====
// คืน true = เปิดหน้าต่างถามแล้ว (ผู้เรียกต้อง return) ; retry = ทำต่อแบบเดิมถ้าผู้เล่นไม่ใช้/ยกเลิก
// เป่ายิ้งฉุบ: ทั้งสองฝ่ายเลือกเอง (ลับ) → เปิดพร้อมกัน + แอนิเมชัน → เสมอเป่าใหม่จนกว่าจะมีผู้ชนะ
function rpsDuel(r, i, done) {
  const K = ['r', 'p', 's'], N = { r: 'ค้อน', p: 'กระดาษ', s: 'กรรไกร' }, CH = ['✊ ค้อน', '✋ กระดาษ', '✌ กรรไกร'];
  let rd = 0;
  const round = () => {
    rd++; const pk = {};
    const choose = (who, nxt) => ask(r, who, { rps: true, text: 'เป่ายิ้งฉุบ' + (rd > 1 ? ' (เสมอ เป่าใหม่ รอบที่ ' + rd + ')' : '') + ': เลือก ค้อน / กระดาษ / กรรไกร', choices: CH, cb: k => { if (!K[k]) return choose(who, nxt); pk[who] = K[k]; nxt(); } });
    choose(i, () => choose(1 - i, () => {
      const a = pk[i], b = pk[1 - i];
      if (a === b) { fx({ k: 'rps', a, b, i, w: -1 }); log(r, '✊ เป่ายิ้งฉุบ: ' + r.p[i].name + ' ' + N[a] + ' vs ' + r.p[1 - i].name + ' ' + N[b] + ' → เสมอ เป่าใหม่'); return round(); }
      const w = ((K.indexOf(a) - K.indexOf(b) + 3) % 3 === 1) ? i : 1 - i;
      fx({ k: 'rps', a, b, i, w });
      log(r, '✊ เป่ายิ้งฉุบ: ' + r.p[i].name + ' ' + N[a] + ' vs ' + r.p[1 - i].name + ' ' + N[b] + ' → ' + r.p[w].name + ' ชนะ');
      done(w);
    }));
  };
  round();
}
function primalSave(r, f0, retry) {
  if (!f0 || f0.z !== 'av' || f0.c.id !== 'SD08-001' || f0.c.tk || f0.c.prBy || r.g.ask || noFx(r, f0.c) || f0.c.pr2 === r.g.n) return false;
  const p = r.p[f0.i], L = () => p.hell.filter(c => !c.tk && symOf(c) === 'รัททาทุย'), u = f0.c.u;
  if (L().length < 5) return false;
  const go = () => { const c = find(r, u); if (c) c.c.prBy = 1; try { retry(); } finally { if (c) delete c.c.prBy; } };
  ask(r, f0.i, { yn: true, text: 'ไพรมอล รัททาทุย: จะออกจากสนาม — เนรเทศการ์ด {รัททาทุย} ในนรก 5 ใบ เพื่อไม่ให้ออกจากสนามไหม? (เทิร์นละครั้ง)', cb: y => {
    if (!y) return go();
    const O = L().map(c => c.u);
    if (O.length < 5 || !find(r, u)) return go();
    ask(r, f0.i, { text: 'ไพรมอล รัททาทุย: เลือกการ์ด {รัททาทุย} ในนรก 5 ใบ เพื่อเนรเทศ (กดยกเลิก = ไม่ใช้สกิล)', opts: O, n: 5, min: 5, cancel: true, onCancel: go, cb: us => {
      const f1 = find(r, u); if (!f1 || f1.z !== 'av') return;
      if (us.length < 5) return go();
      us.forEach(x => { const q = p.hell.findIndex(h => h.u === x); if (q >= 0) { const c = p.hell.splice(q, 1)[0]; p.dk.push(c); fx({ k: 'exile', u: c.u, id: c.kd || c.id }); } });
      f1.c.pr2 = r.g.n; vfx(f1.c.u, 'burst', '🌀 เนรเทศ 5 ใบ — ไม่ออกจากสนาม', '#38bdf8');
      log(r, '🛡 ไพรมอล รัททาทุย: เนรเทศ {รัททาทุย} 5 ใบจากนรก — ไม่ออกจากสนาม');
    } });
  } });
  return true;
}
const sendHell = (r, u) => { const f0 = find(r, u); if (f0 && f0.z === 'hand') (r.g.dh9 = r.g.dh9 || {})[f0.i] = r.g.n; if (mg016(r, f0)) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม'); if (w62(r, f0, () => sendHell(r, u))) return; if (f0 && f0.z === 'av' && !BYP33 && bt6Sub33(r, f0, () => { BYP33 = 1; try { sendHell(r, u); } finally { BYP33 = 0; } })) return; if (f0 && f0.z === 'av' && f0.c.hero === r.g.n && !r.g.inB) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลความสามารถ'); if (f0 && f0.z === 'av' && f0.c.mgImm >= r.g.n && !r.g.inB && r.g.turn !== f0.i) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนามด้วย Magic'); if (primalSave(r, f0, () => sendHell(r, u))) return; const f = take(r, u); if (!f.c.tk) r.p[f.i].hell.push(f.c); };
const destroyAv = (r, u) => { const f = find(r, u); if (f && f.z === 'av') kill(r, f.i, u); };
const bounce = (r, u) => { const f0 = find(r, u); if (mg016(r, f0)) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม'); if (w62(r, f0, () => bounce(r, u))) return; if (f0 && f0.z === 'av' && !BYP33 && bt6Sub33(r, f0, () => { BYP33 = 1; try { bounce(r, u); } finally { BYP33 = 0; } })) return; if (f0 && f0.z === 'av' && f0.c.hero === r.g.n) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลความสามารถ'); if (primalSave(r, f0, () => bounce(r, u))) return; const f = take(r, u); fx({ k: 'bounce', u }); if (!f.c.tk) { f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; f.c.tired = false; r.p[f.i].hand.push(f.c); } };
function summonFree(r, i, c) {
  const p = r.p[i]; if (!canPlaceAv(r, i, c)) { log(r, 'Avatar เต็ม อัญเชิญไม่ได้'); return false; }
  const k = p.hell.findIndex(h => h.u === c.u); if (k < 0) return false; p.hell.splice(k, 1);
  c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; c.fh = 1; p.av.push(c); heroMk(r, i, c); ev(r, c.kd || c.id); fx({ k: 'summon', u: c.u }); log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + ' จากนรก'); return true;
}
function mill(r, i, n, src) {
  if (src && !src.tk && isAv(src)) { const sf = find(r, src.u); if (sf && sf.z === 'av' && odOn8(r, 1 - sf.i, 'BT08-032')) return log(r, '💊 ชาโค่ล Overdose: ธรณีสูบ ของ ' + nmOf(src) + ' ทำไม่ได้'); }
  const p = r.p[i]; if (src) p.av.forEach(a => { if (a.id === 'SD03-004' && src.id !== 'SD03-004') n += 2; });
  const cs = []; for (let k = 0; k < n && p.deck.length; k++) cs.push(p.deck.pop());
  cs.forEach(c => p.hell.push(c)); if (cs.length) (r.g.m10 = r.g.m10 || {})[i] = r.g.n; cs.length && fx({ k: 'mill', i, ids: cs.map(c => c.id) }); log(r, '🕳 ' + p.name + ': ธรณีสูบ ' + cs.length + ' ใบ (' + cs.map(c => B[c.id].n).join(', ') + ')');
  cs.forEach(c => { if (c.id === 'SD03-018' || c.id === 'KD02-019' || c.id === 'BT10-067') c.mh = r.g.n; });
  { const ms = src || (r.g.curMg && r.g.curMg.card) || null, pg = !!(ms && !ms.tk && isAv(ms) && symOf(ms) === 'เทพ' && colOf(ms) === 'ม่วง'), mgc = !!(ms && !ms.tk && B[ms.id].t === 'Magic');
    cs.forEach(c => {
      if (c.id === 'BT05-027' && (pg || mgc)) r.g.q.unshift(() => { if (!p.hell.includes(c)) return; ask(r, i, { yn: true, text: 'บรุนฮิลด์ ถูกธรณีสูบ: อัญเชิญจากนรกลง Avatar Zone ไหม?', cb: y => { if (y && p.hell.includes(c) && summonAny(r, i, c.u, 'hell')) { vfx(c.u, 'burst', 'อัญเชิญ', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); });   // BT05-027
      if (c.id === 'BT05-026' && pg && r.g.land && B[r.g.land.c.id].n.trim() === 'แอสการ์ดคือสถานที่ไม่ใช่ผู้คน' && p.av.some(a => !a.tk && isAv(a) && symOf(a) === 'เทพ' && colOf(a) === 'ม่วง')) r.g.q.unshift(() => { if (!p.hell.includes(c)) return; ask(r, i, { yn: true, text: 'เฮล่า ถูกธรณีสูบ (แอสการ์ดฯ อยู่บนสนาม): อัญเชิญทันทีโดยไม่ต้องจ่าย Cost ไหม?', cb: y => { if (y && p.hell.includes(c) && summonAny(r, i, c.u, 'hell')) { vfx(c.u, 'burst', 'เฮล่า มาแล้ว', '#7c3aed'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); });   // BT05-026
      if (c.id === 'BT08-063' && (pg || mgc)) r.g.q.unshift(() => { const q = p.hell.indexOf(c); if (q < 0) return; p.hell.splice(q, 1); p.hand.push(c); vfx(c.u, 'aura', '🌈 บิฟร็อสต์ ขึ้นมือ', '#a855f7'); log(r, '🌈 บิฟร็อสต์ สะพานสายรุ้ง: ถูกธรณีสูบ นำขึ้นมือ'); });   // BT08-063
      if (c.id === 'BT08-053' && (pg || mgc)) r.g.q.unshift(() => { if (!p.hell.includes(c)) return; const L2 = p.hell.filter(h => isAv(h) && B[h.id].n.includes('เทพธิดาแห่งวัลฮัลลา')).map(h => h.u); if (!L2.length) return; ask(r, i, { text: 'การสละชีพของเทพธิดา ถูกธรณีสูบ: เลือก "เทพธิดาแห่งวัลฮัลลา" จากนรก อัญเชิญลงสนาม', opts: L2, cb: us => { if (summonAny(r, i, us[0], 'hell')) vfx(us[0], 'burst', '🙏 เทพธิดา', '#a855f7'); } }); });   // BT08-053
      if (c.id === 'BT08-069') r.g.q.unshift(() => { if (p.hell.includes(c)) buildFree(r, i, c, 'hell'); });   // BT08-069 ถูกธรณีสูบ ก่อสร้างเอง
      bt6Mill(r, i, c, pg, mgc);
    }); }
  if (cs.length && landIs(r, 'BT08-063')) { const lo = r.g.land.o; r.g.q.unshift(() => { const o = r.p[lo].av.filter(a => !a.tk).map(a => a.u); if (!o.length) return; ask(r, lo, { text: 'บิฟร็อสต์ สะพานสายรุ้ง: เลือก Avatar ของเรา 1 ใบ ได้รับ สามัคคี จนจบเทิร์น', opts: o, cb: us => { const t = find(r, us[0]); if (t) { t.c.sm8 = r.g.n; vfx(t.c.u, 'aura', '🌈 สามัคคี', '#a855f7'); log(r, '🌈 บิฟร็อสต์: ' + nmOf(t.c) + ' ได้รับ สามัคคี จนจบเทิร์น'); } } }); }); }   // BT08-063
  const nemo = cs.filter(c => c.id === 'BT01-018'); if (nemo.length) { nemo.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } }); shuf(p.deck); log(r, '🔁 นีโม่ กลับเข้า Deck แล้วสับ'); }
  if (cs.some(c => c.id === 'BT01-015')) r.g.q.unshift(() => { log(r, '💀 นายนิรยบาล เต๋า: ทั้งสองฝ่ายธรณีสูบ 2 ใบ'); mill(r, 0, 2); mill(r, 1, 2); });
  if (!p.deck.length) return lose(r, i, 'เด็คหมด');
  cs.filter(c => c.id === 'SD03-003').forEach(c => r.g.q.unshift(() => ask(r, i, { yn: true, text: 'นายนิรยบาล แว่น ถูกธรณีสูบ — อัญเชิญลง Avatar Zone จากนรกไหม?', cb: y => y && summonFree(r, i, c) })));
  kdMill(r, i, cs, src);
}
function tutor(r, i, pred, label) {
  if (bt10NoAdd(r, i) || ccNoAdd(r, i)) return log(r, '🌙 ตอนนี้นำการ์ดจาก Deck ขึ้นมือด้วยความสามารถไม่ได้ (' + label + ')');
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
  fxAtk03(r, i, a, tg, tk); fxAtk2(r, i, a); atkTrig(r, i, a); bt4Atk(r, i, a, tg, tk); bt6AtkS2(r, i, a, tg, tk); bt7Atk(r, i, a, tg, tk);
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
function hell33OK(r, i, c) { const p = r.p[i], g = r.g; return g.turn === i && g.phase === 'main' && !g.ask && !g.pend && p.hand.length > 0 && p.av.filter(a => !a.tk && B[a.id].n.includes('วานร')).length >= 3 && canPlaceAv(r, i, c) && !r.p.some(q => q.av.some(a => a.id === 'BT05-012' && !noFx(r, a))); }
function handCost(r, i, c) {   // Cost ปัจจุบันบนมือ (null = ใช้ค่าปกติ)
  const b = B[c.id]; if (c.id === 'BT10-074' && new Set(r.p[i].av.filter(a => !a.tk && B[a.id].n.includes('แก๊งขยะ')).map(a => nm9(a))).size >= 2) return 0; if (b && c.id === 'BT07-072' && hasHn(r, i)) return 0; if (!b || b.t !== 'Avatar') return null; const p = r.p[i];
  if (c.id === 'BT05-002') return Math.max(0, b.c - p.hell.filter(h => !h.tk && B[h.id].t === 'Avatar' && B[h.id].n.includes('แมลงปอ')).length);
  if (c.id === 'BT05-010' && p.av.some(a => symOf(a) === 'เปรต')) return 0;
  if (c.id === 'BT07-018') return Math.max(0, b.c - p.hell.filter(h => !h.tk && B[h.id].t === 'Avatar' && B[h.id].n.includes('ทหารหิมะ')).length);   // BT07-018 ราชาหิมะ บิง
  if (bt6Land(r, 'BT06-061', i) && b.n.includes('แบงค์')) return Math.max(0, b.c - 1);   // BT06-061 สภาพแบงค์
  if (c.id === 'BT05-018' && p.av.some(a => a.id === 'BT05-017') && !p.av.some(a => B[a.id].n === 'ของขวัญที่เมียทิ้งไว้ให้')) return 0;
  if (c.id === 'BT08-008' && p.mg.filter(m => !m.tk && B[m.id].t === 'Magic' && B[m.id].st === 'Modification' && B[m.id].n.startsWith('ดาบศักดิ์สิทธิ์')).length >= 2) return 4;   // BT08-008
  if (c.id === 'BT08-011' && r.p[1 - i].av.some(a => !a.tk && B[a.id].n.includes('เจค นักฆ่ามือเก๋า'))) return 0;   // BT08-011
  if (c.id === 'BT08-022' && p.hell.filter(h => !h.tk && B[h.id].n.includes('ทหารหิมะ')).length >= 10) return Math.max(0, b.c - 2);   // BT08-022
  if (b.n.includes('พี่บูม แก๊งขยะ') && r.g.b10c && r.g.b10c[i] === r.g.n) return Math.max(0, b.c - 1);   // BT10-013
  return null;
}
const hasRishi = (r, i) => r.p[i].av.some(a => a.id === 'BT05-011' && !noFx(r, a));
function reactOK(r, i, c, def) { if (def && def.react === 'bp5') { const p = r.g.pend; return !!(p && p.who === i && p.k === 'atk' && r.g.atkN && r.g.atkN.n === r.g.n && r.g.atkN.c === 1 && !(r.g.noReact && r.g.noReact.who === i)); } if (reactOK0(r, i, c, def)) return true;   // BT05-011 ฤๅษี: เพิ่มเงื่อนไข React ฤษี
  const p = r.g.pend; return !!(p && p.who === i && c.s === 'ฤษี' && hasRishi(r, i) && r.g.turn !== i && !(r.g.noReact && r.g.noReact.who === i) && (p.k === 'atk' || (p.ev && (p.ev.k === 'use' || p.ev.k === 'cast')))); }
function reactOK0(r, i, c, def) { const p = r.g.pend; if (!p || p.who !== i) return false; if (r.g.noReact && r.g.noReact.who === i) return false;
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
  const steps = bt8CampF(r, i, f.c, bt7WearF(c, ((S0) => def.mod ? bt6WearSteps(r, i, S0) : S0)(def.steps || (def.mod ? [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ' + c.n, opts: (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x, 1) && (!def.tgf || def.tgf(a.x))).map(a => a.x.u) }] : []))));
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
  if (def.mod) { t = find(r, ctx.pick.tg[0]); if (!t || t.z !== 'av') E('เป้าหมายหาย'); card.at = t.c.u; me.mg.push(card); bt8Wear(r, i, card, t.c); }
  else if (c.st === 'Land') { if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: card, o: i }; }
  else me.hell.push(card);
  ev(r, card.kd || card.id, card.ar); bt10Cast(r, i, c); g.curMg = { card, i }; g.q.push(() => { g.curMg = null; }); log(r, me.name + ' ร่าย ' + c.st + ': ' + c.n + (t ? ' → ' + nmOf(t.c) : ''));
  if (c.t === 'Magic' && c.s === 'ฤษี') rishiFx(r);
  bt7Spell(r, i, c); bt8Spell(r, i, c); ccRedirect(r, i, c, ctx, def);
  if (c.t === 'Magic' && !def.mod && c.st !== 'React' && c.st !== 'Land') {   // BT04-030 มาติเนซ: รถถังที่สวมใส่ตกเป็นเป้าหมายของ Magic ฝ่ายตรงข้าม → ทำลายตัวเองเพื่อยกเลิก
    const w030 = q => (q.wr || []).some(w => (CANON[w.id] || w.id) === 'BT04-030'), tkOf = x => ({ i: x.i, c: x.c, z: 'av' });
    const picked = Object.values(ctx.pick).flat().map(u => find(r, u)).filter(x => x && x.z === 'av' && x.i !== i && isTank(x.c) && w030(x.c));   // เป็นหนึ่งในเป้าหมาย (เลือกหลายเป้าหมายได้)
    const mass = c.st === 'Normal' && (MASS030.has(CANON[c.id] || c.id) || /(ทำลาย|ส่ง)[^\n]*(Avatar|การ์ด)[^\n]*(ทุกใบ|ทั้งหมด)/.test(c.e || ''));   // Magic ที่กระทบทั้งสนาม
    const tk = picked[0] || (mass ? r.p[1 - i].av.filter(x => isTank(x) && w030(x)).map(x => ({ i: 1 - i, c: x, z: 'av' }))[0] : null), massOnly = !picked.length;
    if (tk) { const w = tk.c.wr.find(q => (CANON[q.id] || q.id) === 'BT04-030');
      ask(r, tk.i, { yn: true, text: 'มาติเนซ Tank Ranger: ' + nmOf(tk.c) + (massOnly ? ' ได้รับผลของ Magic "' : ' ตกเป็นเป้าหมายของ Magic "') + c.n + (massOnly ? '" ที่กระทบทั้งสนาม' : '"') + ' — ทำลาย มาติเนซ จากสภาพสวมใส่ เพื่อยกเลิกความสามารถของ Magic ใบนั้นไหม?', cb: y => { if (!y) return; const k = tk.c.wr.indexOf(w); if (k < 0) return; tk.c.wr.splice(k, 1); r.p[tk.i].hell.push(w); ctx.cancelled = 1; vfx(tk.c.u, 'burst', 'มาติเนซ ยกเลิก Magic', '#22c55e'); log(r, '🛡 มาติเนซ Tank Ranger: ทำลายตัวเองจากสภาพสวมใส่ ยกเลิกความสามารถของ ' + c.n); } }); } }
  if (c.st === 'React' || r049(r, i, c)) kdReactGate(r, i, c, cancelled => { if (!cancelled) def.run && (HAND_SRC = ctx.card, def.run(r, i, ctx)); const p = g.pend; if (p && p.who === i) { g.pend = null; if (p.k === 'atk' && !p.cancel) { if (g.ask) g.pendAfter = () => resolveAtk(r, p); else resolveAtk(r, p); } } });
  else { if (def.run) g.q.push(() => ctx.cancelled ? log(r, '❌ ' + c.n + ' ถูกยกเลิก') : (HAND_SRC = ctx.card, def.run(r, i, ctx))); open(r, { who: 1 - i, k: 'ev', ev: { k: 'cast', id: card.kd || c.id, i, cx: ctx } }); }
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
  if (x.tk) return false; if (kw === 'โล่มนุษย์' || kw === 'ลูกฮึด') { const f9 = find(r, x.u); if (f9 && f9.z === 'av' && odOn8(r, 1 - f9.i, 'BT08-033')) return false; }   // BT08-033 Overdose
  if ((B[x.id].e || '').includes(kw) && isAv(x) && !(B7NK[x.id] && B7NK[x.id].includes(kw)) && !(kw === 'สามัคคี' && (x.id === 'BT05-004' || x.id === 'BT05-013')) && !(kw === 'เตะไข่' && x.id === 'BT05-037')) return true;
  const f = find(r, x.u); if (!f || f.z !== 'av') return false;
  if (kw === 'โล่มนุษย์' && (x.wr || []).some(w => w.id === 'BT06-032')) return true;   // BT06-032
  if (kw === 'สามัคคี' && x.sg3 === r.g.n) return true;
  if (kw === 'ลูกฮึด' && x.hb5 === r.g.n) return true;   // BT05-062
  if (kw === 'สามัคคี' && isAv(x) && B[x.id].c <= 2 && r.p[f.i].co.some(c => c.id === 'BT06-067')) return true;   // BT06-067
  if (kw === 'เตะไข่' && x.id === 'BT05-037' && !noFx(r, x) && r.p[f.i].av.some(a => a.id === 'BT05-054')) return true;   // BT05-037 ตราบที่คุม เครื่องบิน Super Air
  if (kw === 'สามัคคี' && x.id === 'BT05-004' && !noFx(r, x) && r.p[f.i].av.some(a => a.u !== x.u && isKnight(a))) return true;   // BT05-004
  if (kw === 'สามัคคี' && ['คน', 'ต้นไม้'].includes(symOf(x)) && r.p[f.i].av.some(a => a.id === 'BT05-013' && !noFx(r, a))) return true;   // BT05-013
  if (kw === 'ลูกฮึด' && hasEq(r, x, 'SD06-016')) return true;
  if ((kw === 'สามัคคี' || kw === 'โล่มนุษย์') && campTxt(x) && hasCamp(r, f.i)) return true;
  if (kw === 'โล่มนุษย์' && campTxt(x) && r.p[f.i].co.some(c => c.id === 'BT10-073')) return true;   // BT10-073
  if (kw === 'ลูกฮึด' && (B[x.id].n || '').includes('แก๊งขยะ') && r.p[f.i].co.some(c => c.id === 'BT10-074')) return true;   // BT10-074
  if (kw === 'สามัคคี' && symOf(x) === 'แมลง' && landIs(r, 'BT02-059')) return true;
  if (kw === 'สามัคคี' && ccFishAv(x) && r.p[f.i].av.some(a => a.id === 'CC01-006' && !noFx(r, a))) return true;   // CC01-006 ไตรตัน
  if (kw === 'สามัคคี' && landOf(r, 'BT07-069', f.i) && isPolice(x) && (symOf(x) === 'หุ่นยนต์' || also9(x, 'หุ่นยนต์'))) return true;   // สถานีตำรวจ
  if (kw === 'โล่มนุษย์' && landOf(r, 'BT07-069', f.i) && isPolice(x) && symOf(x) === 'ผี') return true;
  if (kw === 'ลูกฮึด' && r.p[f.i].co.some(k => k.id === 'BT07-071')) return true;   // เสาธง
  if (kw === 'โล่มนุษย์' && isAv(x) && nmOf(x).includes('ผีเสื้อ') && (symOf(x) === 'สัตว์มหัศจรรย์' || also9(x, 'สัตว์มหัศจรรย์')) && r.p[f.i].av.some(a => a.id === 'BT07-033' && !noFx(r, a))) return true;   // เดซี่
  if ((kw === 'ลูกฮึด' || kw === 'โล่มนุษย์') && x.id === 'BT07-037' && !noFx(r, x) && isCrit(r, f.i) && r.p[f.i].av.some(a => nmOf(a).includes('ตั๊กแตนหยิน'))) return true;   // ตั๊กแตนหยาง (สาหัส)
  if (kw === 'โล่มนุษย์' && x.hs7 >= r.g.n) return true;   // ยานรายการ
  if (kw === 'เตะไข่' && x.id === 'BT07-025' && !noFx(r, x) && hasHn(r, f.i)) return true;   // BT07-025 ตราบที่คุม พี่หน่วง
  if (kw === 'สามัคคี' && x.sm8 === r.g.n) return true;   // BT08-063 บิฟร็อสต์
  if (kw === 'สามัคคี' && isPeopleF(x) && r.p[f.i].co.some(k => k.id === 'BT08-068')) return true;   // BT08-068 ยิมทมิฬ
  if (kw === 'ลูกฮึด' && hasEq(r, x, 'BT08-061') && isCol(x, 'เขียว')) return true;   // BT08-061 ขวาน 7 สี (เขียว)
  if (kw === 'เตะไข่' && hasEq(r, x, 'BT08-059') && B[x.id].n.includes('มอเดรด')) return true;   // BT08-059 (มอเดรด)
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
function putAv(r, i, c, o = {}) { delete c.mute17; delete c.jt; delete c.fh; noteSum(r, i, c);
  const p = r.p[i];
  if (!canPlaceAv(r, i, c)) { log(r, 'Avatar เต็ม อัญเชิญ ' + B[c.id].n + ' ไม่ได้ (ลงนรก)'); p.hell.push(c); return false; }
  c.tired = !!o.tired; c.pw = 0; c.tp = 0; c.bp = 0; delete c.exp; p.av.push(c); heroMk(r, i, c); ev(r, c.kd || c.id); fx({ k: 'summon', u: c.u });
  log(r, '✨ ' + p.name + ': อัญเชิญ ' + B[c.id].n + (o.tired ? ' (สภาพนอน)' : ''));
  if (o.sm) r.g.q.push(() => fxSummon(r, i, c)); return true;
}
const fromZone = (r, i, z, u) => { const a = r.p[i][z], k = a.findIndex(c => c.u === u); return k < 0 || (z === 'hell' && a[k].h40) ? null : a.splice(k, 1)[0]; };
const canWear = (t, card) => !(t.wr || []).some(w => B[w.id].n === B[card.id].n) && !(t.id === 'BT08-043' && !B[card.id].n.includes('Tank Ranger'));
const tanksFor = (r, i, card) => r.p[i].av.filter(t => isTank(t) && t.u !== card.u && canWear(t, card)).map(t => t.u);
function wearOn(r, i, t, card) { if (wearBlock7(t, card)) { r.p[i].hell.push(card); return log(r, '🚫 ' + nmOf(t) + ' สวมใส่ ' + B[card.id].n + ' ไม่ได้ — ส่งลงนรก'); } t.wr = t.wr || []; t.wr.push(card); card.tired = false; fx({ k: 'buff', u: t.u, v: 0 }); if (B[card.id].n.includes('โอตะ')) vfx(t.u, 'aura', '🎀 สวมใส่ ' + B[card.id].n, '#f472b6'); log(r, '🪖 ' + nmOf(t) + ' สวมใส่ ' + B[card.id].n); }
function wearChoose(r, i, card) {
  const L = tanksFor(r, i, card);
  if (!L.length) { log(r, 'ไม่มีรถถังที่สวมได้ → ' + B[card.id].n + ' ลงนรก'); return r.p[i].hell.push(card); }
  if (L.length === 1) return wearOn(r, i, find(r, L[0]).c, card);
  ask(r, i, { text: 'เลือกรถถังที่จะสวม ' + B[card.id].n, opts: L, cb: us => wearOn(r, i, find(r, us[0]).c, card) });
}
function scout(r, i, n, o) {
  if (o.by && !o.by.tk && isAv(o.by)) { const sf = find(r, o.by.u); if (sf && sf.z === 'av' && odOn8(r, 1 - sf.i, 'BT08-032')) { log(r, '💊 ชาโค่ล Overdose: สอดแนม ของ ' + nmOf(o.by) + ' ทำไม่ได้'); return o.then(null, []); } }
  const p = r.p[i]; if (o.by && isAv(o.by) && symOf(o.by) === 'กะปอม') n += p.av.filter(x => (CANON[x.id] || x.id) === 'BT04-011' && !noFx(r, x)).length;   // BT04-011: สอดแนมของ {กะปอม} +1 ต่อเทอราโนดอน 1 ใบ (นับตัวเองด้วย)
  const seen = p.deck.slice(-n).reverse(); bt4Seen(r, i, seen, o); if (o.migSrc) kdMigScout(r, i, seen); const ok = seen.filter(c => p.deck.includes(c) && o.pred(c)).map(c => c.u);
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ'); seen.length && fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) });
  const fin = u => {
    if (u != null && ccNoAdd(r, i)) { log(r, '🐱 แมวนิค: นำการ์ดขึ้นมือจาก Deck ด้วยความสามารถไม่ได้'); u = null; }
    let got = null; if (u != null) { const k = p.deck.findIndex(c => c.u === u); got = p.deck.splice(k, 1)[0]; }
    const rest = seen.filter(c => c !== got && p.deck.includes(c));
    if (o.rest === 'bottom') { rest.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...rest); log(r, '⬇ นำการ์ดที่เหลือไว้ใต้ Deck'); } else if (o.rest === 'shuffle') shuf(p.deck);
    o.then(got, seen);
  };
  if (!ok.length) return fin(null);
  ask(r, i, { text: o.text, opts: ok, n: 1, min: 1, cb: us => fin(us[0]) });
}
function startUse(r, i, card, def) {
  const ctx = { pick: {}, card }, steps = bt8CampF(r, i, card, def.steps || []);
  for (const s of steps) if (s.opts(r, i, ctx).length < (s.min == null ? (s.n || 1) : s.min)) E('เงื่อนไขการใช้ไม่ครบ');
  let k = 0;
  const next = () => {
    if (k >= steps.length) { steps.forEach(s => s.pay && (ctx.pick[s.key] || []).forEach(u => sendHell(r, u))); card.us = r.g.n; fx({ k: 'say', id: card.id, t: 'ความสามารถ' }); log(r, '⚡ ' + r.p[i].name + ' ใช้ความสามารถ ' + B[card.id].n); def.run && (HAND_SRC = ctx.card, def.run(r, i, ctx)); return; }
    const s = steps[k++], used = Object.values(ctx.pick).flat();
    ask(r, i, { text: s.text, opts: s.opts(r, i, ctx).filter(u => !used.includes(u)), n: s.n || 1, min: s.min, cancel: true, cb: us => { ctx.pick[s.key] = us; next(); }, none: next });
  };
  next();
}
const otaExileOK = (r, i, c) => r.p[i].hand.filter(h => h.u !== c.u).length >= 1 && r.p[i].deck.some(isMim);
const wearSk = (r, i, host, w) => { const g = r.g, o = []; if (g.turn !== i || g.ask || g.pend || g.phase !== 'main') return o;   // สกิลของ Avatar ที่อยู่ในสภาพสวมใส่ (แสดงในแถว Magic Zone)
  if (w.us !== g.n && (WEAR_IDOL.includes(w.id) || w.id === 'SD06-008') && canPlaceAv(r, i, w)) o.push({ k: 'unwear', t: 'อัญเชิญลง Avatar Zone' });
  if (w.id === 'KD03-002' && otaExileOK(r, i, w)) o.push({ k: 'exile', t: 'เนรเทศ + ทิ้งมือ 1 ใบ: นำ บีมมิ ขึ้นมือ' });
  return o; };
const extraSk = (r, i, x) => { const g = r.g; if (g.turn !== i || g.ask || g.pend || g.phase !== 'main' || noFx(r, x)) return []; return x.id === 'KD03-002' && otaExileOK(r, i, x) ? [{ k: 'exile', t: 'เนรเทศ + ทิ้งมือ 1 ใบ: นำ บีมมิ ขึ้นมือ' }] : []; };
function exileOta(r, i, c, host) { const p = r.p[i];
  ask(r, i, { text: 'โอตะคูล่า: เลือกการ์ดบนมือ 1 ใบที่จะทิ้ง (ยกเลิก = ไม่ใช้)', opts: p.hand.filter(h => h.u !== c.u).map(h => h.u), cancel: true, cb: us => {
    sendHell(r, us[0]);
    if (host) { const k = (host.wr || []).indexOf(c); if (k < 0) return; host.wr.splice(k, 1); } else if (find(r, c.u) && find(r, c.u).z === 'av') take(r, c.u); else if (!fromZone(r, i, 'hand', c.u)) return;
    p.dk.push(c); log(r, '🌀 เนรเทศ ' + B[c.id].n); tutor(r, i, isMim, 'Avatar บีมมิ'); } }); }
const abOf = (r, i, x, z) => { if (z === 'mg' && isPole(x) && has33(r, i)) z = 'av'; const d = AB[x.id] || AB[bt8Gain(x)] || (z === 'av' && (x.wr || []).some(w => WEAR_IDOL.includes(w.id)) ? AB_R : null); const base = r.g.turn === i && !r.g.ask && !r.g.pend, ok = base && r.g.phase === 'main', okE = base && r.g.phase === 'end';
  if (d && d.z === z && (d.end ? okE : ok) && x.us !== r.g.n) return 1;
  if (d && d.any && d.z === z && !r.g.ask && !r.g.pend && !r.g.over && ['main', 'battle', 'end'].includes(r.g.phase) && x.us !== r.g.n && (!d.can || d.can(r, i, x))) return 2;
  const a2 = ABIL[x.id]; /* ความสามารถแบบ ABIL (เช่น โดมรัททาทุย) ต้องแสดงปุ่มด้วย */
  if (a2 && a2.zone === z && ((a2.end ? okE : ok) || (a2.any && !r.g.ask && !r.g.pend && r.g.phase === 'main') || (a2.bp && a2.bp(r, i) && base && ['main', 'battle'].includes(r.g.phase))) && !(a2.once && x.ou === r.g.n)) return 1;
  return 0; };
// ✨ glOf: เช็ก "กดใช้สกิลได้จริงตอนนี้" (เฉพาะเทิร์นเรา) เพื่อให้ฝั่ง client เรืองแสงการ์ด
// ทำซ้ำเงื่อนไขของ case 'use' เฉพาะส่วนที่เช็กได้โดยไม่มีผลข้างเคียง (ไม่เรียก ask/open/E)
const glOf = (r, i, x, z) => {
  try {
    if (r.g.turn !== i || !abOf(r, i, x, z)) return 0;
    let zz = z; if (zz === 'mg' && isPole(x) && has33(r, i)) zz = 'av';
    if (zz === 'av' && bt6Banned(r, i, x)) return 0;
    if (!hospOK(r, i, x)) return 0;
    const a2 = ABIL[x.id];
    if (a2 && a2.zone === zz) { if (a2.once && x.ou === r.g.n) return 0; if (a2.cond && !a2.cond(r, i, x)) return 0; return 1; }
    const def = AB[x.id] || AB[bt8Gain(x)] || ((x.wr || []).some(w => w.id === 'BT02-010') ? AB_R : null);
    if (!def || def.z !== zz) return 0;
    if (noFx(r, x) || x.us === r.g.n) return 0;
    if (def.can && !def.can(r, i, x)) return 0;
    const steps = bt8CampF(r, i, x, def.steps || []), ctx = { pick: {}, card: x };
    for (const s of steps) if (s.opts(r, i, ctx).length < (s.min == null ? (s.n || 1) : s.min)) return 0;
    return 1;
  } catch (e) { return 1; }   // เช็กพลาด -> ถือว่ากดได้ตาม ab เดิม (ไม่ซ่อนสกิลที่ใช้ได้)
};
const myAv = f => (r, i, cx) => r.p[i].av.filter(a => f(a, cx)).map(a => a.u);
const wearUse = { z: 'av', can: (r, i, c) => tanksFor(r, i, c).length > 0, steps: [{ key: 't', text: 'เลือก Avatar รถถังที่จะสวมใส่', opts: (r, i, cx) => tanksFor(r, i, cx.card) }],
  run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } };
const hospOK = (r, i, x) => { const h = r.g.hosp; return !(h && h.n === r.g.n && h.i === i && h.names.includes(B[x.id].n)); };
const AB = {
  'BT01-050': { z: 'land',
    steps: [{ key: 'd', pay: 1, text: 'โรงบาล: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) },
      { key: 't', text: 'โรงบาล: เลือก Avatar Cost ไม่เกิน 3 จากนรก ขึ้นมือ', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && !c.tk && B[c.id].c <= 3).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); if (!c) return; r.p[i].hand.push(c); const g = r.g; if (!g.hosp || g.hosp.n !== g.n || g.hosp.i !== i) g.hosp = { n: g.n, i, names: [] }; g.hosp.names.push(B[c.id].n); if (cx.card.kd === 'CC01-059') g.hosp.atk = 1; log(r, '🏥 ' + B[c.id].n + ' ขึ้นมือ (เทิร์นนี้อัญเชิญ/ใช้สกิลไม่ได้ รวมการ์ดชื่อเดียวกัน)'); } },
  'SD04-001': wearUse, 'SD04-002': wearUse, 'SD04-003': wearUse,
  'SD06-008': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.u !== c.u && canWear(a, c)), steps: [{ key: 't', text: 'เลือก Avatar ที่จะสวมใส่ บุญช่วย', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && canWear(a, cx.card)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); } },
  'SD04-019': { z: 'mg', run: (r, i, cx) => { const t = find(r, cx.card.at); if (!t) return; const h = Math.random() < .5; fx({ k: 'coin', h }); cx.card.cp = (cx.card.cp || 0) + (h ? 2 : -2);   // สะสมถาวรตราบที่ยังสวมอยู่ (เก็บที่การ์ด ไม่หายตอนจบเทิร์น)
    vfx(t.c.u, 'aura', (h ? 'POWER +2 ถาวร' : 'POWER -2 ถาวร'), h ? '#22c55e' : '#ef4444'); log(r, '🪙 ถาดหลุม: ทอยเหรียญ ' + (h ? 'หัว' : 'ก้อย') + ' — ' + nmOf(t.c) + ' POWER ' + (h ? '+2' : '-2') + ' ถาวร (รวมจากถาดหลุม ' + (cx.card.cp > 0 ? '+' : '') + cx.card.cp + ')'); } },
  'SD04-020': { z: 'land', steps: [{ key: 't', text: 'เลือก Avatar {คน} ของเรา 1 ใบ เปลี่ยนเป็นสภาพนอน', opts: myAv(a => symOf(a) === 'คน') }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); t && (t.c.tired = true); const p = r.p[i], c = p.deck[p.deck.length - 1]; if (!c) return;
      ask(r, i, { yn: true, text: 'สอดแนม: ใบบนสุดคือ ' + B[c.id].n + ' — ไว้บนสุดต่อไหม? (ไม่ = ใต้ Deck)', cb: y => { if (!y) { p.deck.pop(); p.deck.unshift(c); log(r, '⬇ นำไว้ใต้ Deck'); } } }); } },
  'SD05-005': { z: 'av', can: (r, i, c) => !c.tired, steps: [{ key: 't', text: 'เลือก บึงทมิฬ People ใบอื่น', opts: myAv((a, cx) => isPeopleF(a) && a.u !== cx.card.u) }],
    run: (r, i, cx) => { cx.card.tired = true; const t = find(r, cx.pick.t[0]); if (t) { t.c.ward = r.g.n + 2; log(r, '🛡 ' + nmOf(t.c) + ' ไม่ถูกทำลาย 1 ครั้ง'); } } },
  'SD05-014': { z: 'land', steps: [{ key: 't', text: 'เลือก Avatar ของเรา 1 ใบ เปลี่ยนเป็นสภาพนอน', opts: myAv(a => !a.tired) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) t.c.tired = true; draw(r, r.p[i], 1); log(r, '✨ ' + r.p[i].name + ': จั่ว 1 ใบ'); } },
  'SD05-018': { z: 'mg', can: (r, i) => !r.g.used[i].Land,
    run: (r, i, cx) => { const p = r.p[i]; take(r, cx.card.u); p.hell.push(cx.card); const c = p.deck.find(x => x.id === 'SD05-014'); if (!c) { log(r, 'ไม่พบ บึงทมิฬ ใน Deck'); return shuf(p.deck); }
      p.deck.splice(p.deck.indexOf(c), 1); if (r.g.land) r.p[r.g.land.o].hell.push(r.g.land.c); r.g.land = { c, o: i }; r.g.used[i].Land = 1; shuf(p.deck); ev(r, c.kd || c.id); log(r, '🌊 วาง บึงทมิฬ ลง Land Magic Zone'); } },
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
    const fin = u => { if (u != null) p.hand.push(fromZone(r, i, 'deck', u)); shuf(p.deck); }, ok = seen.filter(c => isAv(c) && (symOf(c) === 'ปลา' || also9(c, 'ปลา'))).map(c => c.u);
    if (!ok.length) return fin(null); ask(r, i, { text: 'จุติ: เลือก Avatar {ปลา} 1 ใบ ขึ้นมือ', opts: ok, cb: us => fin(us[0]) }); },
  'SD05-006': (r, i) => { const p = r.p[i], awake = landIs(r, 'SD05-014'); let k = 0;
    const step = () => { if (k++ >= 2) return shuf(p.deck); const L = p.deck.filter(c => isPeople(c)).map(c => c.u); if (!L.length) return shuf(p.deck);
      ask(r, i, { text: 'จุติ: เลือก บึงทมิฬ People จาก Deck (' + k + '/2)', opts: L, cb: us => { putAv(r, i, fromZone(r, i, 'deck', us[0]), { tired: !awake }); r.g.q.unshift(step); } }); };
    step(); },
  'SD06-004': (r, i) => { const p = r.p[i]; if (p.hand.length < 2 || p.co.length >= 3 || p.co.some(c => c.id === 'SD06-018') || !p.deck.some(c => c.id === 'SD06-018')) return;
    ask(r, i, { text: 'จุติ: ทิ้งการ์ดบนมือ 2 ใบ เพื่อก่อสร้าง ค่ายบางระจัน จาก Deck (ยกเลิก = ไม่ใช้)', opts: p.hand.map(c => c.u), n: 2, cancel: true,
      cb: us => { us.forEach(u => sendHell(r, u)); const c = p.deck.find(x => x.id === 'SD06-018'); p.co.push(fromZone(r, i, 'deck', c.u)); shuf(p.deck); ev(r, c.kd || c.id); log(r, '🏕 ' + p.name + ': ก่อสร้าง ค่ายบางระจัน'); } }); },
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
  bt6Death(r, f);
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
    if (rr && !r.g.used[f.i].React) r.g.q.unshift(() => ask(r, f.i, { yn: true, text: 'ใช้ รัททาท่วม (React): อัญเชิญรัททาทุย (Cost1/Gem1/Power1) สูงสุด 2 ใบ จาก Deck?', cb: y => { if (!y) return; take(r, rr.u); p.hell.push(rr); r.g.used[f.i].React = 1; ev(r, rr.kd || rr.id); log(r, p.name + ' ใช้ React: รัททาท่วม');
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
  if (a.id === 'SD05-002' && find(r, a.u) && a.k52 !== r.g.n && !noFx(r, a) && r.p[i].av.some(x => x.u !== a.u && isPeopleF(x))) {   // สั่งใช้ (เทิร์นละครั้ง): ถามก่อน แล้วทอยเต๋า
    ask(r, i, { yn: true, text: 'คุณเค้นท์ (สั่งใช้): ทอยลูกเต๋า 1 ครั้ง ถ้าออกเลขคี่ คุณเค้นท์ที่นอนอยู่จะกลับเป็นสภาพตื่น — ใช้ไหม?', cb: y => {
      if (!y || !find(r, a.u) || a.k52 === r.g.n) return; a.k52 = r.g.n; fx({ k: 'say', id: a.id, t: 'ทอยลูกเต๋า' }); const d = bt6Dice(r, i);
      if (d % 2) { if (a.tired) { a.tired = false; vfx(a.u, 'aura', '🎲 ' + d + ' คี่ → ตื่น', '#22c55e'); log(r, '✨ คุณเค้นท์ ออกเลขคี่ กลับเป็นสภาพตื่น'); } else log(r, 'คุณเค้นท์ ออกเลขคี่ (ตื่นอยู่แล้ว)'); } else { vfx(a.u, 'aura', '🎲 ' + d + ' คู่', '#94a3b8'); log(r, 'คุณเค้นท์ ออกเลขคู่ — ไม่มีผล'); } } }); }
}
function afterBattle(r, p, a, d, res, pa, pd) {
  bt7After(r, p, a); ccAfterBattle(r, p, a); cc2After(r, p, a, d, res);
  const df = Math.abs((pa || 0) - (pd || 0)); kdAfter(r, p, a, d, res); bt4Win(r, p, a, d, res); bt8Win(r, p, a, d, res); bt6Win(r, p, a, d, res);
  if (res === 'win') winFx(r, p.ai, a, df); if (res === 'lose') winFx(r, 1 - p.ai, d, df);
  if (res !== 'lose' && res !== 'both') surviveFx(r, p.ai, a);
  if (res === 'win' && a && find(r, a.u)) r.p.forEach(q => q.mg.forEach(m => { if (m.at === a.u && B[m.id].n.trim() === 'ตีพ่อ' && m.wk !== r.g.n && a.tired) { m.wk = r.g.n; a.tired = false; fx({ k: 'say', id: m.id, t: 'กลับมาตื่น' }); log(r, '✨ ตีพ่อ: ' + nmOf(a) + ' ทำลาย Avatar สำเร็จ กลับมาสภาพตื่น'); } }));   // 1 ครั้ง/เทิร์น
  if (res !== 'win' && res !== 'both' && d.id === 'BT02-027' && find(r, d.u) && !noFx(r, d)) { fx({ k: 'say', id: d.id, t: 'สุ่มคว่ำ LIFE' }); lifeDown(r, 1 - p.ai); }
}
function wall(r, i) {
  const p = r.p[i], c = p.co.find(x => x.id === 'SD06-020'); if (!c || c.us === r.g.n || p.av.length || !p.hand.length) return;
  ask(r, i, { yn: true, text: 'กำแพงด่านสุดท้าย: ทิ้งการ์ดบนมือ 1 ใบ เพื่อสอดแนมไหม?', cb: y => { if (!y) return;
    ask(r, i, { text: 'เลือกการ์ดบนมือที่จะทิ้ง', opts: p.hand.map(x => x.u), cancel: true, cb: us => { sendHell(r, us[0]); c.us = r.g.n;
      const n = 1 + (p.co.some(x => x.id === 'SD06-019') ? 2 : 0), seen = p.deck.splice(-n).reverse(); log(r, '🔎 สอดแนม ' + seen.length + ' ใบ');
      seen.forEach(x => { if (campTxt(x) && B[x.id].c <= 4) putAv(r, i, x); else { p.hand.push(x); log(r, '✋ ' + B[x.id].n + ' ขึ้นมือ'); } }); } }); } });
}
function destroyCo(r, u) {
  const f = find(r, u); if (!f || f.z !== 'co') return; if (bt10CoGuard(r, f)) return log(r, '🌕 ดวงจันทร์วันเพ็ญ: ไม่สามารถถูกทำลายด้วยความสามารถของการ์ด');
  if (r.g.ask) return r.g.q.push(() => destroyCo(r, u));
  const i = f.i, p = r.p[i], done = () => { const h = find(r, u); if (!h || h.z !== 'co') return; take(r, u); p.hell.push(h.c); fx({ k: 'die', u, id: h.c.id }); log(r, '💥 Construct ' + B[h.c.id].n + ' ถูกทำลาย'); onConDie(r, i, h.c); };
  if (f.c.id === 'SD06-018' && !r.g.used[i].dhamma) {
    const m = [...p.hand, ...p.av].filter(c => c.id === 'SD06-007');
    if (m.length) return ask(r, i, { yn: true, text: 'อาจารย์ธรรมโชติ: ส่งกลับใต้ Deck เพื่อให้ ค่ายบางระจัน ไม่ถูกทำลาย?', cb: y => { if (!y) return done(); r.g.used[i].dhamma = 1; const c = m[0]; take(r, c.u); p.deck.unshift(c); log(r, '🛡 อาจารย์ธรรมโชติ กลับใต้ Deck — ค่ายบางระจัน ไม่ถูกทำลาย'); } });
  }
  if (bt6ConGuard(r, i, f.c, done)) return;
  done();
}
function shieldStep(r, p) {
  const d = r.p[p.who], atkF = find(r, p.u);
  const lipo = atkF && atkF.c.id === 'SD07-007';
  const lipoSide = r.p[p.ai] && r.p[p.ai].av.some(x => x.id === 'SD07-007');
  const L = (p.tk === 'co' || (atkF && atkF.c.hero === r.g.n) || (atkF && r.p.some(q => q.mg.some(m => m.at === atkF.c.u && m.id === 'BT05-064')))) ? [] : d.av.filter(a => !a.tired && a.u !== p.tg && (hasKw(r, a, 'โล่มนุษย์') || lipoSide)).map(a => a.u);
  if (!L.length) return open1(r, p);
  const go = () => r.g.q.unshift(() => open1(r, p));
  ask(r, p.who, { text: 'โล่มนุษย์: เลือก Avatar โล่มนุษย์ (สภาพตื่น) เพื่อรับการโจมตีแทน' + (lipo ? ' — ลิโป้โจมตี ต้องใช้!' : ' — ยกเลิก = ไม่ใช้'), opts: L, n: 1, min: lipo ? 1 : 0, cancel: !lipo, onCancel: go,
    cb: us => {
      if (!us.length) return go();
      const s = find(r, us[0]); if (!s || s.c.tired) return go();
      s.c.tired = true; bt10Tank(r, p.who, s.c); p.tg = s.c.u; p.tk = 'av';
      if (s.c.id === 'SD05-004') { s.c.bp = (s.c.bp || 0) + 2; p.sh = s.c.u; }
      log(r, '🛡 โล่มนุษย์: ' + nmOf(s.c) + ' รับการโจมตีแทน');
      if (lipoSide) { const L2 = d.av.filter(x => !protectedFrom(r, p.ai, x)).map(x => x.u);
        r.g.q.unshift(() => ask(r, p.ai, { text: 'ลิโป้: ทำลาย Avatar ศัตรู 1 ใบ (ไม่ทำก็ได้)', opts: L2, n: 1, min: 0, cb: u2 => u2.length && destroyAv(r, u2[0]) })); }
      go();
    } });
}
const shieldThen = shieldStep;
function endTurn456(r) {
  const g = r.g, prev = 1 - g.turn; bt4End(r, prev); bt6End(r, prev); bt7EndTurn(r, prev);
  r.p[prev].av.filter(a => a.id === 'BT01-007' && !noFx(r, a)).forEach(a => { const run = () => { a.pw = (a.pw || 0) + 1; a.bc = (a.bc || 0) + 1; fx({ k: 'buff', u: a.u, v: 1 }); log(r, '🐸 แม่กบ POWER +1'); }; if (!autoGuard(r, prev, a, () => true, run)) run(); });
  r.p.forEach((q, qi) => q.av.filter(a => a.ctl != null && a.oo != null && a.oo !== qi).forEach(a => { const o = a.oo; delete a.ctl; delete a.oo; q.av.splice(q.av.indexOf(a), 1); if (canPlaceAv(r, o, a)) { a.tired = false; r.p[o].av.push(a); log(r, '↩ ' + nmOf(a) + ' กลับไปฝั่งเจ้าของ'); } else { r.p[o].hell.push(a); log(r, nmOf(a) + ' กลับไม่ได้ (Avatar เต็ม) ลงนรก'); } }));
  r.p[prev].av.filter(a => a.id === 'BT02-017' && !noFx(r, a)).forEach(a => { const run = () => { if (!find(r, a.u)) return; take(r, a.u); r.p[prev].deck.unshift(a); fx({ k: 'say', id: a.id, t: 'กลับใต้ Deck' }); log(r, '📤 แรงงานทาสออฟฟิศ กลับไปใต้ Deck'); }; if (!autoGuard(r, prev, a, () => true, run)) run(); });
  r.p.forEach(q => q.av.filter(a => a.endDie).forEach(a => { delete a.endDie; log(r, '💥 ความกล้าหาญ: ' + nmOf(a) + ' ถูกทำลาย'); kill(r, 0, a.u, 1); })); r.p.forEach(q => { q.co.forEach(c => { if (c.pb) { c.pw = (c.pw || 0) - c.pb; c.pb = 0; } });
    q.av.slice().forEach(a => { if (a.ward && g.n >= a.ward) delete a.ward; if (a.exp && g.n >= a.exp) { log(r, '👻 ' + nmOf(a) + ' กลับลงนรก'); sendHell(r, a.u); } }); });
}
const myAvEq = f => (r, i) => r.p[i].av.filter(f).map(a => a.u);
const oneHand = (n, t) => ({ key: 'c', camp: 1, n, pay: 1, text: t, opts: (r, i, cx) => r.p[i].hand.filter(c => c.u !== cx.card.u).map(c => c.u) });
Object.assign(MG, {
  'SD04-014': { run: (r, i) => { const sm = (w, pred, t) => { const p = r.p[w], L = p.deck.filter(c => isAv(c) && B[c.id].c <= 5 && pred(c)).map(c => c.u);
      if (!L.length) { log(r, p.name + ': ไม่มี Avatar ให้อัญเชิญ'); return shuf(p.deck); } ask(r, w, { text: t, opts: L, cb: us => { putAv(r, w, fromZone(r, w, 'deck', us[0])); shuf(p.deck); } }); };
    sm(i, c => isTank(c), 'เลือก Avatar "รถถัง" (Cost ≤5) จาก Deck อัญเชิญ'); r.g.q.push(() => sm(1 - i, () => true, 'เลือก Avatar (Cost ≤5) จาก Deck ของเรา อัญเชิญ')); } },
  'SD04-015': { run: (r, i) => lifeDown(r, i) },
  'SD04-016': { run: (r, i) => { const p = r.p[i], c = p.deck.pop(); if (!c) return; log(r, '🔎 สอดแนม 1 ใบ');
    if (isAv(c) && symOf(c) === 'คน' && B[c.id].c <= 3) putAv(r, i, c); else { p.deck.unshift(c); log(r, '⬇ ใส่ไว้ใต้ Deck'); } } },
  'SD04-017': { react: 'atk', steps: [{ key: 'k', pay: 1, text: 'เลือก Avatar "รถถัง" ของเรา 1 ใบ ทำลายเป็น Cost', opts: myAvEq(isTank) }], run: (r, i) => { r.p[1 - i].av.slice().forEach(a => destroyAv(r, a.u)); log(r, '💥 ทำลาย Avatar ทุกใบของศัตรู'); } },
  'SD04-018': { react: 'atkTank', run: (r, i, cx) => { const p = r.p[i], tg = cx.pend.tg, at = cx.pend.u;
    scout(r, i, 5, { text: 'เลือก Avatar {คน} ที่ติดชื่อ "Tank Ranger" 1 ใบ สวมให้รถถังที่ถูกโจมตี', pred: c => isAv(c) && symOf(c) === 'คน' && B[c.id].n.includes('Tank Ranger') && !isTank(c), rest: 'bottom',
      then: c => { const t = find(r, tg); if (c && t && t.z === 'av' && canWear(t.c, c)) { wearOn(r, i, t.c, c); destroyAv(r, at); log(r, '💥 ทำลาย Avatar ที่สั่งโจมตี'); } else { if (c) { p.deck.unshift(c); } log(r, 'สวมใส่ไม่สำเร็จ'); } } }); } },
  'SD04-019': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ถาดหลุม', opts: (r, i) => allAvT(r, i) }] },
  'SD05-015': { steps: [{ key: 't', text: 'เลือก Avatar {ปลา} ในนรกเรา', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && (symOf(c) === 'ปลา' || also9(c, 'ปลา'))).map(c => c.u) }], run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); c && putAv(r, i, c, { tired: !landIs(r, 'SD05-014') }); } },
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
    run: (r, i, cx) => { const f = find(r, cx.pick.t[0]); if (!f || f.z !== 'av') return; if (f.c.id === 'BT06-037' && !noFx(r, f.c)) return log(r, '🛡 สว นาโนแมชชีน ไม่สามารถถูกเปลี่ยนการควบคุมได้'); const me = r.p[i]; if (!canPlaceAv(r, i, f.c)) return log(r, 'Avatar เต็ม'); take(r, f.c.u); const c = f.c; c.ctl = { from: f.i }; c.nolife = 1; c.tired = false; me.av.push(c); log(r, '🕴 ยึด ' + nmOf(c) + ' จนจบเทิร์น (ตี LIFE ไม่ได้)'); } },
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
  'BT01-040': { react: 'never' },   // หมอมาแล้วววว: ถามอัตโนมัติตอน Avatar จะถูกทำลาย (kill) เหมือน ถวาย
   'BT01-041': { react: 'cast', run: (r) => { const p = r.g.pend; if (p && p.ev) { /* cancelled flag handled via cx */ } } },
  'BT01-042': { react: 'never' },   // ริกกี้ นักปลอมแปลง: ถามอัตโนมัติหลัง Avatar ถูกทำลายจากการต่อสู้ (rickyFx)
   'BT01-043': {}, 'BT01-044': {}, 'BT01-045': {}, 'BT01-046': {}, 'BT01-047': {}, 'BT01-048': {}, 'BT01-049': {}, 'BT01-050': {},
});

/* ===== BT02 ===== */
const nmHas = (x, t) => nm2(x).includes(t);
const noFx = (r, x) => { if (!x || !isAv(x)) return false; const f = find(r, x.u); if (!f || f.z !== 'av') return false; if (x.hero === r.g.n) return false; if (x.mute17) return true; if (bt8Mute(r, x, f)) return true; if (x.nf === r.g.n || (x.nfr && x.nfr.includes(r.g.n))) return true; if (hasEq(r, x, 'BT02-056')) return true; const n = r.g.nofx; return !!(n && n[f.i] === r.g.n); };
function lifeUp(r, i) { const d = r.p[i], l = d.life.find(x => !x.up); if (!l) return false; l.up = 1; fx({ k: 'life', i }); (d.lf = d.lf || []).push(l.id); log(r, '❤ หงาย LIFE ' + d.name + ': ' + B[l.id].n); bt8Life(r, i); if (d.life.every(x => x.up)) log(r, d.name + ' สาหัส!'); return true; }
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
  'BT02-012': (r, i) => { const g = r.g; if (g.land) { r.p[g.land.o].hell.push(g.land.c); g.land = null; log(r, '💥 ทำลาย Land Magic'); } const p = r.p[i], L = p.deck.filter(c => B[c.id].t === 'Magic' && B[c.id].st === 'Land').map(c => c.u); const fin = u => { if (u != null) { g.land = { c: fromZone(r, i, 'deck', u), o: i }; ev(r, g.land.c.kd || g.land.c.id); log(r, '🌍 วาง ' + B[g.land.c.id].n + ' ลง Land Magic Zone'); } shuf(p.deck); }; if (!L.length) return fin(null); ask(r, i, { text: 'เลือก Land Magic จาก Deck มาเล่น', opts: L, cb: us => fin(us[0]) }); },
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
  if (nf) return; const c = f.c; bt10Die(r, f);   // BT10 คำสั่งเสีย
  if (c.id === 'BT01-012') { const q = r.p[f.i], l = q.life.find(x => x.up); if (l) { l.up = 0; const k = q.lf ? q.lf.lastIndexOf(l.id) : -1; if (k >= 0) q.lf.splice(k, 1); log(r, '❤ ลูกแม่ศรีนวล: คว่ำ LIFE ใบบนสุดที่หงายอยู่กลับ'); } }
  if (c.id === 'BT01-013') r.g.q.push(() => { const L = r.p[f.i].hell.filter(x => isAv(x) && isAnimal(x) && B[x.id].c <= 4).map(x => x.u); L.length && ask(r, f.i, { text: 'คำสั่งเสีย: เลือก Avatar {สัตว์} Cost ไม่เกิน 4 จากนรก นำกลับขึ้นมือ', opts: L, cb: us => { const x = fromZone(r, f.i, 'hell', us[0]); if (x) { r.p[f.i].hand.push(x); log(r, '♻ นำ ' + B[x.id].n + ' กลับขึ้นมือ'); } } }); });
  if (c.id === 'BT02-013') r.g.q.push(() => { const L = r.p.flatMap(q => q.mg.map(m => m.u)); if (L.length) return ask(r, f.i, { text: 'คำสั่งเสีย: เลือก MAGIC บนสนาม 1 ใบ ทำลาย', opts: L, cb: us => sendHell(r, us[0]) }); if (r.g.land) { r.p[r.g.land.o].hell.push(r.g.land.c); r.g.land = null; log(r, '💥 ทำลาย Land Magic'); } });
}
Object.assign(MG, {
  'BT02-042': { run: (r, i) => { r.p[i].av.forEach(a => a.tired = true); const sum = allAv(r).filter(a => a.x.tired).reduce((s, a) => s + P(r, a.x), 0); log(r, '🗳 ประชามติ: Avatar ฝ่ายเราเป็นสภาพนอน ผลรวม POWER นอน = ' + sum); const L = allAv(r).filter(a => P(r, a.x) < sum).map(a => a.x.u); ask(r, i, { text: 'เลือก Avatar ที่ POWER ต่ำกว่า ' + sum + ' ทำลาย', opts: L, cb: us => destroyAv(r, us[0]) }); } },
  'BT02-043': { run: (r, i) => rpsDuel(r, i, w => ask(r, w, { text: 'ชนะเป่ายิ้งฉุบ: เลือก Avatar 1 ใบบนสนาม ทำลาย', opts: allAv(r).map(x => x.x.u), cb: us => destroyAv(r, us[0]) })) },
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
  if (r.p.some(q => q.mg.some(m => m.at === f.c.u && m.id === 'BT07-065'))) { log(r, '🛡 ' + nmOf(f.c) + ' สวมใส่ ปลอกคอซื่อสัตย์ ไม่ถูกเปลี่ยนการควบคุม'); return false; }
  if (f.c.id === 'KD04-001') { log(r, '🛡 ราชันย์หุ่นนักรบผู้กล้า ไม่สามารถถูกเปลี่ยนการควบคุมได้'); return false; }
  if (f.c.id === 'BT06-037' && !noFx(r, f.c)) { log(r, '🛡 สว นาโนแมชชีน ไม่สามารถถูกเปลี่ยนการควบคุมได้'); return false; }
  if (f.c.id === 'BT04-003' && !r.g.nutOK && !noFx(r, f.c)) { log(r, '🛡 ไอ้นัท - คนใจเด็ด ไม่ถูกเปลี่ยนการควบคุม'); return false; }
  if (f.c.hero === r.g.n) { log(r, '🛡 ' + nmOf(f.c) + ' ไม่รับผลความสามารถ'); return false; }
  if (!canPlaceAv(r, i, f.c)) { log(r, 'Avatar เต็ม เปลี่ยนการควบคุมไม่ได้'); return false; }
  r.p[f.i].av.splice(f.k, 1); if (f.c.oo == null) f.c.oo = f.i; f.c.tired = false; me.av.push(f.c); log(r, '✨ ' + me.name + ' ยึด ' + nmOf(f.c) + ' มาฝั่งเรา'); return true;
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
  if (bt9Forgive(r, i, id)) return;   // BT09-004 DJ ปีโป้
  if (lifeFx2(r, i, id)) return;
  if (kdLife(r, i, id)) return;
  const c = B[id], p = r.p[i];
  if (id === 'SD06-022') { p.co.forEach(x => { x.pw = (x.pw || 0) + 1; x.pb = (x.pb || 0) + 1; }); return log(r, '❤ ' + c.n + ': Construct ทุกใบ POWER +1 จนจบเทิร์น'); }
  if (id === 'SD06-023') return ask(r, i, { text: c.n + ': เลือก Construct ในนรกเรา 1 ใบ ขึ้นมือ', opts: p.hell.filter(x => x.id && B[x.id].t === 'Construct').map(x => x.u), cb: us => { p.hand.push(fromZone(r, i, 'hell', us[0])); log(r, '❤ นำ Construct ขึ้นมือ'); } });
  if (id === 'SD06-024') return scout(r, i, 5, { text: c.n + ': เลือก Construct 1 ใบ ขึ้นมือ', pred: x => B[x.id].t === 'Construct', rest: 'bottom', then: x => x && p.hand.push(x) });
  if (/จั่วการ์ด 1 ใบ/.test(c.e) && /main phase/i.test(c.e)) { draw(r, p, 1); log(r, '❤ ' + c.n + ': ' + p.name + ' จั่ว 1 ใบ'); } else log(r, '❤ LIFE ' + c.n + ': ' + c.e + ' (ใช้เอง)');
};

// ===== แบนลิสต์ + กฎการสร้างเด็ค (ตามหนังสือกฎ v3.2) =====
const nk = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();          // normalize ชื่อ (ช่องว่างซ้ำ/ท้ายชื่อ)
const CNAME = {}; CARDS.forEach(c => { CNAME[nk(c.n)] = c.n; });                  // ชื่อ normalize -> ชื่อจริงบนการ์ด
const normBan = o => {
  o = o || {}; const nm = s => { const k = nk(s); return CNAME[k] || k; };
  const ban = [...new Set((Array.isArray(o.ban) ? o.ban : []).map(nm).filter(Boolean))];
  const lim = {}; Object.entries(o.lim || {}).forEach(([n, v]) => { v = v | 0; if (v >= 1 && v <= 3) lim[nm(n)] = v; }); ban.forEach(n => delete lim[n]);
  const pairs = (Array.isArray(o.pairs) ? o.pairs : []).filter(p => Array.isArray(p) && p.length === 2 && nk(p[0]) && nk(p[1]) && nk(p[0]) !== nk(p[1])).map(p => [nm(p[0]), nm(p[1])]);
  const cond = (Array.isArray(o.cond) ? o.cond : []).filter(c => c && typeof c === 'object' && c.msg && (c.if || c.ifOnlyName)).map(c => ({ ...c, ...(c.if ? { if: nm(c.if) } : {}), ...(c.ifOnlyName ? { ifOnlyName: nm(c.ifOnlyName) } : {}) }));
  return { asof: String(o.asof || '').slice(0, 20), ban, lim, pairs, cond, upd: +o.upd || 0 };
};
const BAN_FILE = path.join(__dirname, 'banlist.json');
let BAN = normBan(JSON.parse(fs.readFileSync(BAN_FILE, 'utf8')));
(async () => { try { const s = await dbGet('sys:banlist'); if (s && Array.isArray(s.ban)) { BAN = normBan(s); console.log('banlist: โหลดจากฐานข้อมูล (แอดมินแก้ไว้)', BAN.asof); } } catch (e) { console.log('banlist load error', e); } })();
const pushBan = () => wss.clients.forEach(w => { if (w.user && w.readyState === 1) w.send(JSON.stringify({ t: 'ban', ban: BAN })); });
// กฎประจำตัว "#การ์ดใบนี้นับเป็นชื่อ X" (X ไม่มีเครื่องหมาย "…") = ชื่อหลักที่ 2 ต้องนับรวมกันในโควตา 4 ใบ ; ถ้ามี "…" = ชื่อเสริม ไม่นับ
const extraName = c => { const e = c.e || '', k = e.indexOf('#'); if (k < 0) return ''; const m = /นับเป็นชื่อ\s*([^"“”#\n]+?)\s*(?:#|$)/.exec(e.slice(k)); return m ? nk(m[1]) : ''; };
const limOf = c => c.lim || (/ได้มากสุด 50 ใบ/.test(c.e || '') ? 50 : (c.o === 'Only #1' ? 1 : 4));
const namesOf = c => { const x = extraName(c), a = [nk(c.n)]; if (x && x !== a[0]) a.push(x); return a; };
const LIMNAME = {}; CARDS.forEach(c => { const n = nk(c.n); LIMNAME[n] = Math.min(LIMNAME[n] || 99, limOf(c)); });
const countNames = main => { const cnt = {}; main.forEach(i => namesOf(B[i]).forEach(n => { cnt[n] = (cnt[n] || 0) + 1; })); return cnt; };
const sumV = V => V.slice(0, 3).join(' · ') + (V.length > 3 ? ' (+' + (V.length - 3) + ' ข้อ)' : '');
// กฎจัดเด็คพื้นฐาน → คืนรายการข้อผิดทั้งหมด (ไม่หยุดที่ข้อแรก)
function deckViol(main, life) {
  const V = [], cnt = countNames(main), seen = new Set();
  if (main.length !== 50) V.push('Main ต้อง 50 ใบ (มี ' + main.length + ')');
  if (life.length !== 5 || new Set(life.map(i => nk(B[i].n))).size !== life.length) V.push('LIFE ต้อง 5 ใบ ชื่อไม่ซ้ำ');
  main.forEach(i => namesOf(B[i]).forEach((n, k) => { if (seen.has(n)) return; const l = k ? (LIMNAME[n] || 4) : limOf(B[i]); if (cnt[n] > l) { seen.add(n); V.push('ซ้ำเกิน ' + l + ' ใบ: ' + n + (k || cnt[n] !== main.filter(x => nk(B[x].n) === n).length ? ' (นับรวมชื่อหลักที่ 2 = ' + cnt[n] + ')' : '')); } }));
  const o1 = main.filter(i => B[i].o === 'Only #1').length, f = main[0], all50 = main.length === 50 && main.every(i => nk(B[i].n) === nk(B[f].n)) && limOf(B[f]) === 50;   // การ์ดที่ใส่ได้ 50 ใบ เลือกไม่ใส่ Only#1 ได้
  if (!all50 && o1 !== 1) V.push(o1 ? 'ใส่ Only#1 ได้แค่ 1 ใบ (มี ' + o1 + ')' : 'ต้องมี Only#1 1 ใบ');
  return V;
}
// กฎแบนลิสต์ → คืนรายการข้อผิดทั้งหมด
function banViol(main) {
  const V = [], cnt = countNames(main), lim = {}, bn = new Set(BAN.ban.map(nk));
  Object.entries(BAN.lim).forEach(([n, v]) => { lim[nk(n)] = v; });
  [...new Set(main.filter(i => B[i].o === 'ลำเอียง').map(i => nk(B[i].n)))].forEach(n => V.push('ห้ามใช้การ์ดลำเอียง: ' + n));
  for (const n in cnt) { if (bn.has(n)) V.push('การ์ดบาป ห้ามใส่: ' + n); if (lim[n] && cnt[n] > lim[n]) V.push('จำกัด ' + lim[n] + ' ใบ: ' + n + ' (มี ' + cnt[n] + ')'); }
  for (const [a, b] of BAN.pairs) if (cnt[nk(a)] && cnt[nk(b)]) V.push('เลือกใส่ได้อย่างใดอย่างหนึ่ง: ' + a + ' / ' + b);
  const only = main.find(i => B[i].o === 'Only #1'), av = main.filter(i => B[i].t === 'Avatar').map(i => B[i]), fmt = bad => ' — ผิดที่: ' + [...new Set(bad.map(d => nk(d.n)))].slice(0, 3).join(', ');
  for (const c of BAN.cond) {
    if (c.if && cnt[nk(c.if)]) {
      if (c.avatarsText) { const bad = av.filter(d => !d.n.includes(c.avatarsText) && !(d.e || '').includes(c.avatarsText)); if (bad.length) V.push(c.msg + fmt(bad)); }
      if (c.onlySymbol && (!only || B[only].s !== c.onlySymbol)) V.push(c.msg);
    }
    if (c.ifOnlyName && only && nk(B[only].n) === nk(c.ifOnlyName) && c.avatarsSymbol) { const bad = av.filter(d => d.s !== c.avatarsSymbol && !(d.e || '').includes('symbol ' + c.avatarsSymbol)); if (bad.length) V.push(c.msg + fmt(bad)); }
  }
  return V;
}
function checkBan(main) { const V = banViol(main); if (V.length) E(sumV(V)); }
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
      const V = deckViol(main, life); if (V.length) E(sumV(V));
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
  CR = r; const g = r.g, pub = p => ({ name: p.name, pic: p.pic || null, lv: p.lv || 0, eq: p.eq || {}, av: p.av.map(x => ({ ...x, wr: undefined, wn: (x.wr || []).map(w => w.id), wl: (x.wr || []).map(w => ({ u: w.u, id: w.id, kd: w.kd, ar: w.ar, sk: r.p.indexOf(p) === i ? wearSk(r, i, x, w) : [] })), xs: r.p.indexOf(p) === i ? extraSk(r, i, x) : [], cp: P(r, x), ab: abOf(r, r.p.indexOf(p), x, 'av'), gl: r.p.indexOf(p) === i ? glOf(r, i, x, 'av') : 0, sg: hasKw(r, x, 'สามัคคี') ? 1 : 0 })), mg: p.mg.map(x => ({ ...x, ab: abOf(r, r.p.indexOf(p), x, 'mg'), gl: r.p.indexOf(p) === i ? glOf(r, i, x, 'mg') : 0 })), co: p.co.map(x => ({ ...x, ab: abOf(r, r.p.indexOf(p), x, 'co'), gl: r.p.indexOf(p) === i ? glOf(r, i, x, 'co') : 0 })), hell: p.hell.map(c => c.id === 'BT05-064' ? { ...c, hab: hell64OK(r, r.p.indexOf(p)) ? 1 : 0 } : c.id === 'BT05-033' ? { ...c, hab: hell33OK(r, r.p.indexOf(p), c) ? 1 : 0 } : ABIL[c.id] && ABIL[c.id].zone === 'hell' ? { ...c, hab: kdHellAb(r, r.p.indexOf(p), c) } : c), dk: p.dk, deck: p.deck.length, dt: dtop03(r, p), hn: p.hand.length, life: p.life.map(l => l.up ? l : { up: 0 }) });
  return { i, rv10: bt10Reveal(r, i), odc: r.p[1 - i].dc ? Math.max(0, DC_MS - (Date.now() - r.p[1 - i].dc)) : 0, dc: g.dc || null, md: r.p.map(p => !!p.m), me: { ...pub(r.p[i]), hand: r.p[i].hand.map(c => { const o = KD_HAND[c.id] ? { ...c, ab: kdHandAb(r, i, c) } : c, cc = handCost(r, i, c); return cc != null ? { ...o, cc } : o; }), hell: r.p[i].hell.map(c => c.id === 'BT05-033' && hell33OK(r, i, c) ? { ...c, ab: 1 } : (/^(BT09-|CC02-)/.test(c.id) && ABIL[c.id] && ABIL[c.id].zone === 'hell') ? { ...c, hab: kdHellAb(r, i, c) } : c) }, op: pub(r.p[1 - i]), mine: g.turn === i, phase: g.phase, land: g.land && { c: { ...g.land.c, ab: abOf(r, g.land.o, g.land.c, 'land'), gl: g.land.o === i ? glOf(r, i, g.land.c, 'land') : 0 }, o: g.land.o }, log: g.log.slice(-40), over: g.over, ev: g.ev || null, evw: g.evw ? { n: g.evw.n, me: !!g.evw.ok[i], op: !!g.evw.ok[1 - i] } : null, dw: g.dw, dr: g.dr || null, bt: g.bt || null, fx: (g.fxl || []).map(f => f.k === 'scout' && f.i !== i ? { ...f, ids: f.ids.map(() => 'back') } : f), tn: g.n, ru: g.used && g.used[i] && g.used[i].React ? 1 : 0, ask: g.ask ? { mine: g.ask.who === i, text: g.ask.text, opts: g.ask.who === i ? g.ask.opts : [], n: g.ask.n, min: g.ask.min, cancel: g.ask.cancel, yn: g.ask.yn, choices: g.ask.choices, rps: g.ask.rps, cards: g.ask.who === i ? g.ask.cards : null } : null, won: g.over ? (g.win == null ? null : g.win === i) : null, pend: g.pend ? { mine: g.pend.who === i, can: g.pend.who === i ? reactList(r, i) : undefined, ev: g.pend.ev ? { k: g.pend.ev.k, id: g.pend.ev.id } : null, k: g.pend.k, until: g.pend.until, u: g.pend.u, tg: g.pend.tg, ai: g.pend.ai } : null };
};
const sview = r => { const v = view(r, 0); v.spec = 1; v.evw = null; v.mine = false; v.tp = r.g.turn; v.me.hn = r.p[0].hand.length; v.me.hand = []; v.ru = 1; if (v.ask) v.ask = { ...v.ask, mine: false, opts: [], cards: null }; if (v.pend) v.pend = { ...v.pend, mine: false }; return v; };
const bc = r => { (r.spec || []).forEach(w => { if (r.g && w.readyState === 1) w.send(JSON.stringify({ t: 's', s: sview(r) })); }); bc0(r); };
const bc0 = r => r.p.forEach((p, i) => {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(r.g ? { t: 's', s: view(r, i) } : { t: 'lobby', code: r.code, bot: r.bot ? r.bot.lv : 0, owner: r.p[0] && r.p[0].name, exp: r.exp ? Math.max(0, r.exp - Date.now()) : 0, clock: r.cfg.clock, react: r.cfg.react, ban: r.cfg.ban, players: r.p.map(x => ({ name: x.name, ready: !!x.deck, pic: x.pic || null, lv: x.lv || 0 })) }));
});
const log = (r, s) => r.g.log.push(s);
const ev = (r, id, ar) => { r.g.ev = { n: (r.g.ev ? r.g.ev.n : 0) + 1, id, ar: ar || null }; r.g.evw = { n: r.g.ev.n, ok: r.p.map(p => !!p.bot), t0: Date.now() }; };   // ป๊อปอัปรอทั้งสองฝ่ายกดข้าม (บอทกดอัตโนมัติ)
const evDone = r => { const g = r.g, w = g.evw; if (!w) return; const d = Date.now() - w.t0; if (g.pend) { if (g.pend.until) g.pend.until += d; if (g.pend.fk) g.pend.fk += d; } g.evw = null; };   // เลื่อนตัวจับเวลา React ตามเวลาที่หยุดรอ
const evAck = (r, i) => { const w = r.g && r.g.evw; if (!w) return; w.ok[i] = true; if (w.ok.every(Boolean)) evDone(r); };
const draw = (r, p, n) => { DRAWING++; try { for (let k = 0; k < n && p.deck.length; k++) { const c0 = p.deck.pop(); p.hand.push(c0); if (c0 && c0.id === 'BT06-013' && r && r.p && r.g) bt6Drew(r, p, c0); } } finally { DRAWING--; } if (!p.deck.length && !r.g.over) { r.g.over = p.name + ' เด็คหมด แพ้!'; r.g.win = r.p ? 1 - r.p.indexOf(p) : null; } };
const pw = x => (x.tk ? x.tk.p : B[x.id].p) + x.pw;
const find = (r, u) => { for (let i = 0; i < 2; i++) for (const z of ZN) { const k = r.p[i][z].findIndex(c => c.u === u); if (k >= 0) return { i, z, k, c: r.p[i][z][k] }; } return null; };
const release = (r, u) => r.p.forEach(p => { for (let k = p.mg.length - 1; k >= 0; k--) if (p.mg[k].at === u) { const [g] = p.mg.splice(k, 1); delete g.at; p.hell.push(g); mgHellTrig(r, p, g); } });
const take = (r, u) => { const f = find(r, u); if (!f) E('ไม่พบการ์ด'); if (f.z === 'hell' && f.c.h40) E('การ์ดใบนี้ไม่สามารถถูกนำออกจากนรกได้ (หมอเลิฟ ฟันเหยิน)'); r.p[f.i][f.z].splice(f.k, 1); if (f.z === 'av') { delete f.c.half; delete f.c.kdSwap; release(r, u); if (f.c.wr && f.c.wr.length) { f.c.wr.forEach(w => { delete w.nmo; if (ccWoo(r, f, w)) return; r.p[f.i].hell.push(w); }); f.c.wr = []; } } if (f.z === 'mg' && f.c.id === 'BT10-060' && f.c.at) { const u60 = f.c.at; r.g.q.push(() => { const t = find(r, u60); if (t && t.z === 'av') { log(r, '🛸 ผู้มาเยือนออกจากสนาม: ส่ง ' + nmOf(t.c) + ' ลงนรก'); sendHell(r, u60); } }); } if (f.z === 'mg' && f.c.id === 'BT01-042' && f.c.at) { const ua = f.c.at; r.g.q.push(() => { const t = find(r, ua); if (!t || t.z !== 'av') return; const o = t.c.oo != null ? t.c.oo : 1 - t.i; const x = take(r, ua).c; delete x.oo; Object.assign(x, { pw: 0, tp: 0, bp: 0, tired: false }); if (!x.tk) r.p[o].hand.push(x); log(r, '🎭 ริกกี้ นักปลอมแปลง ถูกทำลาย: ' + nmOf(x) + ' กลับขึ้นมือเจ้าของ'); }); }
 delete f.c.at; delete f.c.cx; delete f.c.jt; delete f.c.fh; if (f.z === 'hand') delete f.c.stl; if (f.z === 'av' && f.c.id === 'BT05-054A') { f.c.id = 'BT05-054'; delete f.c.kd; } return f; };
let DRNO = 0;
const isDoc = c => !!c && !c.tk && B[c.id] && B[c.id].t === 'Magic' && B[c.id].n.trim() === 'หมอมาแล้วววว';
const kill = (r, i, u, ns) => {
  const f0 = find(r, u), nf0 = !!(f0 && f0.z === 'av' && noFx(r, f0.c));
  if (mg016(r, f0)) return log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม');
  if (f0 && f0.z === 'av' && f0.c.id === 'BT06-037' && MGX > 0 && !noFx(r, f0.c)) { vfx(f0.c.u, 'aura', '🛡 ไม่ถูกทำลาย', '#64748b'); return log(r, '🛡 สว นาโนแมชชีน: ไม่ถูกทำลายจากความสามารถของ Magic Card'); }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && (bt9Save(r, i, u, f0) || bt10Save(r, i, u, f0))) return;   // BT09-060 Skill : Second Energy
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && f0.c.id === 'BT06-033' && bt6Sub33(r, f0, () => kill(r, i, u, 1))) return;
  if (f0 && f0.z === 'av' && !ns && f0.c.id !== 'SD06-005' && campTxt(f0.c) && hasCamp(r, f0.i) && !r.g.ask) {
    const g5 = r.p[f0.i].av.find(a => a.id === 'SD06-005');
    if (g5) { ask(r, f0.i, { yn: true, text: 'พันเรือง: ทำลาย พันเรือง แทน ' + nmOf(f0.c) + ' ไหม?', cb: y => y ? kill(r, f0.i, g5.u, 1) : kill(r, i, u, 1) }); return; }
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.inB && w62(r, f0, () => kill(r, i, u, ns))) return;
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && B[f0.c.id].s === 'สัตว์' && r.p[f0.i].hand.some(h => h.id === 'BT07-041') && r.p[f0.i].hand.length >= 2 && canPlaceAv(r, f0.i, r.p[f0.i].hand.find(h => h.id === 'BT07-041'))) {   // BT07-041 คาบู ช่วยด้วย
    const hp = r.p[f0.i], kb = hp.hand.find(h => h.id === 'BT07-041');
    ask(r, f0.i, { yn: true, text: 'คาบู ช่วยด้วย: ทิ้งการ์ด 1 ใบ เพื่ออัญเชิญ คาบู จากมือ และยกเลิกการทำลาย ' + nmOf(f0.c) + ' ไหม?', cb: y => { if (!y) return kill(r, i, u, 1);
      ask(r, f0.i, { text: 'เลือกการ์ดบนมือ 1 ใบ ที่จะทิ้ง', opts: hp.hand.filter(h => h !== kb).map(h => h.u), cb: us => { sendHell(r, us[0]); if (summonAny(r, f0.i, kb.u, 'hand', kb)) { vfx(kb.u, 'burst', '🛡 คาบูช่วย!', '#22c55e'); log(r, '🛡 คาบู ช่วยด้วย: ยกเลิกการทำลาย ' + nmOf(f0.c)); r.g.q.unshift(() => fxSummon(r, f0.i, kb)); } } }); } }); return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && nmOf(f0.c).includes('พี่หน่วง') && r.p[f0.i].hand.some(h => h.id === 'BT07-061') && r.p[f0.i].co.some(k => k.id === 'BT07-072')) {   // BT07-061 ขอจบรายการแต่เพียงเท่านี้
    const hp = r.p[f0.i];
    ask(r, f0.i, { yn: true, text: 'ขอจบรายการแต่เพียงเท่านี้: ส่ง ยานรายการ ลงนรก เพื่อนำ ' + nmOf(f0.c) + ' ขึ้นมือแทนการถูกทำลายไหม?', cb: y => { if (!y) return kill(r, i, u, 1); const co = hp.co.find(k => k.id === 'BT07-072'), mg = hp.hand.find(h => h.id === 'BT07-061'); if (!co || !mg || !find(r, u)) return;
      take(r, co.u); hp.hell.push(co); take(r, mg.u); hp.hell.push(mg); const f1 = take(r, u); Object.assign(f1.c, { pw: 0, tp: 0, bp: 0, tired: false }); hp.hand.push(f1.c); vfx(f1.c.u, 'aura', '🎬 ขอจบรายการ', '#a855f7'); fx({ k: 'say', id: 'BT07-061', t: 'ขึ้นมือแทน' }); log(r, '🎬 ขอจบรายการแต่เพียงเท่านี้: ' + nmOf(f1.c) + ' ขึ้นมือแทนการถูกทำลาย'); } }); return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && f0.c.id === 'BT05-054' && r.p[f0.i].av.some(a => a.id === 'BT05-038' && !noFx(r, a))) {
    const ps = r.p[f0.i].av.find(a => a.id === 'BT05-038' && !noFx(r, a));
    ask(r, f0.i, { yn: true, text: 'ผู้โดยสาร Super Air: ทำลาย ผู้โดยสาร แทน เครื่องบิน Super Air ไหม?', cb: y => { if (!y) return kill(r, i, u, 1); vfx(ps.u, 'burst', 'รับแทน!', '#22c55e'); log(r, '🛡 ผู้โดยสาร Super Air ถูกทำลายแทน เครื่องบิน'); kill(r, f0.i, ps.u, 1); } }); return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && f0.c.id === 'BT05-001' && f0.c.jt && !noFx(r, f0.c) && r.p[f0.i].hand.length) {
    ask(r, f0.i, { yn: true, text: 'กุ่ย นักเอาตัวรอด (พอดี): ทิ้งการ์ดบนมือ 1 ใบ เพื่อไม่ให้ถูกทำลายไหม?', cb: y => { if (!y) return kill(r, i, u, 1);
      ask(r, f0.i, { text: 'เลือกการ์ดบนมือ 1 ใบ ที่จะทิ้ง', opts: r.p[f0.i].hand.map(c => c.u), cb: us => { const c = fromZone(r, f0.i, 'hand', us[0]); if (c) r.p[f0.i].hell.push(c); vfx(f0.c.u, 'aura', '🛡 ไม่ถูกทำลาย', '#f87171'); fx({ k: 'say', id: 'BT05-001', t: 'ไม่ถูกทำลาย' }); log(r, '🛡 กุ่ย นักเอาตัวรอด: ทิ้ง ' + (c ? B[c.id].n : '-') + ' → ไม่ถูกทำลาย'); } }); } }); return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && f0.c.id === 'BT03-024' && !noFx(r, f0.c) && f0.c.us24 !== r.g.n) {
    ask(r, f0.i, { yn: true, text: 'บัลเดอร์: ธรณีสูบ Deck ตัวเอง 9 ใบ แทนการถูกทำลายไหม?', cb: y => { if (!y) return kill(r, i, u, 1); f0.c.us24 = r.g.n; vfx(f0.c.u, 'aura', 'ธรณีสูบ 9 ใบ แทน', '#fde047'); log(r, '🛡 บัลเดอร์: ธรณีสูบ 9 ใบ แทนการถูกทำลาย'); mill(r, f0.i, 9); } }); return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && nmOf(f0.c) === 'หุ่นนักรบผู้กล้า : ไม้ท์เกรน' && !noFx(r, f0.c)) {
    const g7 = r.p[f0.i].av.find(a => a.id === 'BT03-007' && a.u !== f0.c.u && !noFx(r, a));
    if (g7) { ask(r, f0.i, { yn: true, text: 'อากาศยานผู้กล้า: ทำลาย อากาศยานผู้กล้า แทน ' + nmOf(f0.c) + ' ไหม?', cb: y => { if (!y) return kill(r, i, u, 1); vfx(g7.u, 'burst', 'รับแทน!', '#38bdf8'); log(r, '🛡 อากาศยานผู้กล้า ถูกทำลายแทน ' + nmOf(f0.c)); kill(r, f0.i, g7.u, 1); } }); return; }
  }
  if (f0 && f0.z === 'av' && !ns && DRNO !== u && !r.g.ask && !(r.g.used && r.g.used[f0.i] && r.g.used[f0.i].React) && !(r.g.noReact && r.g.noReact.who === f0.i) && r.p[f0.i].hand.some(isDoc)) {   // หมอมาแล้วววว (React: Avatar จะถูกทำลาย → ไม่ถูกทำลาย)
    const dc = r.p[f0.i].hand.find(isDoc);
    ask(r, f0.i, { yn: true, text: 'หมอมาแล้วววว: ใช้ React ให้ ' + nmOf(f0.c) + ' ไม่ถูกทำลายไหม?', cb: y => { if (!y) { DRNO = u; try { return kill(r, i, u, ns); } finally { DRNO = 0; } }
      const h = fromZone(r, f0.i, 'hand', dc.u); if (!h) return kill(r, i, u, 1); r.p[f0.i].hell.push(h); r.g.used[f0.i].React = 1; ev(r, h.kd || h.id, h.ar); vfx(f0.c.u, 'aura', '🩺 ไม่ถูกทำลาย', '#ef4444'); log(r, '🩺 หมอมาแล้วววว: ' + nmOf(f0.c) + ' ไม่ถูกทำลาย'); } });
    return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && !(r.g.used && r.g.used[f0.i] && r.g.used[f0.i].React) && r.p[f0.i].hand.some(c => c.id === 'BT02-051')) {
    ask(r, f0.i, { yn: true, text: 'ถวาย: ทิ้งการ์ดทั้งหมดบนมือ เพื่อให้ ' + nmOf(f0.c) + ' ไม่ถูกทำลาย?', cb: y => { if (!y) return kill(r, i, u, 1); r.g.used[f0.i].React = 1; fx({ k: 'say', id: 'BT02-051', t: 'ไม่ถูกทำลาย' }); r.p[f0.i].hand.slice().forEach(c => sendHell(r, c.u)); log(r, '🙏 ถวาย: ' + nmOf(f0.c) + ' ไม่ถูกทำลาย'); } });
    return;
  }
  if (f0 && f0.z === 'av' && !ns && !r.g.inB && !r.g.ask && isKP(f0.c) && isCol(f0.c, 'แดง') && bt8Kill(r, i, u, f0)) return;
  if (f0 && f0.z === 'av' && !ns && !r.g.ask && hasEq(r, f0.c, 'BT08-060')) {
    const w60 = r.p.flatMap(q => q.mg).find(m => m.at === f0.c.u && m.id === 'BT08-060');
    if (w60) { ask(r, f0.i, { yn: true, text: 'ดาบศักดิ์สิทธิ์ เอกซ์คาลิเบอร์: ทำลายดาบแทน ' + nmOf(f0.c) + ' ที่จะออกจากสนามไหม?', cb: y => { if (!y) return kill(r, i, u, 1); const q = r.p.find(z => z.mg.includes(w60)); if (!q) return; q.mg.splice(q.mg.indexOf(w60), 1); delete w60.at; q.hell.push(w60); vfx(f0.c.u, 'burst', '🗡 ดาบรับแทน!', '#f97316'); log(r, '🛡 เอกซ์คาลิเบอร์: ถูกทำลายแทน ' + nmOf(f0.c)); } }); return; }
  }
  if (f0 && f0.z === 'av') {
    if (f0.c.nb02 >= r.g.n && r.g.inB) { vfx(f0.c.u, 'ring', '🛡 ไม่ถูกทำลายจากการต่อสู้', '#22c55e'); log(r, '🛡 หมีเหลือง: ' + nmOf(f0.c) + ' ไม่ถูกทำลายจากการต่อสู้'); return; }
    if (f0.c.id === 'CC02-001' && r.g.inB && !ns && !noFx(r, f0.c) && !r.g.ask && cc2Mods(r, f0.c).length) { const ms = cc2Mods(r, f0.c);
      ask(r, f0.i, { yn: true, text: 'มหาราชาสีนิล: นำ Modification ที่สวมใส่ทั้งหมด (' + ms.length + ' ใบ) ลงนรก เพื่อไม่ให้ถูกทำลายไหม?', cb: y => { if (!y) return kill(r, i, u, 1);
        ms.forEach(m => r.p.forEach(q => { const k = q.mg.indexOf(m); if (k >= 0) { q.mg.splice(k, 1); delete m.at; q.hell.push(m); } })); vfx(f0.c.u, 'ring', '🛡 โล่มนุษย์ ไม่ถูกทำลาย', '#ef4444'); log(r, '🛡 มหาราชาสีนิล: ส่ง Modification ลงนรก — ไม่ถูกทำลาย'); } }); return; }
    if (f0.c.hero === r.g.n && !r.g.inB) { log(r, '🛡 ' + nmOf(f0.c) + ' ไม่รับผลความสามารถ (ช่วยโลกใบนี้ไว้)'); return; }
    if (f0.c.imm === r.g.n) { log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกทำลายในเทิร์นนี้'); return; }
    if (r.g.noBD && r.g.noBD.who === f0.i && r.g.noBD.n === r.g.n && r.g.inB) { vfx(f0.c.u, 'aura', '🛡 พระคุ้มครอง', '#fbbf24'); log(r, '🛡 พระคุ้มครอง: ' + nmOf(f0.c) + ' ไม่ถูกทำลายจากการต่อสู้'); return; }   // BT05-057
    if (f0.z === 'av' && !r.g.inB && r.g.turn !== f0.i && bt10Prot(r, 1 - f0.i, f0.c, false)) { vfx(f0.c.u, 'aura', '🛡 ดินแดนยุติธรรม', '#fbbf24'); log(r, '🛡 ดินแดนยุติธรรม: ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนามโดยความสามารถการ์ดฝ่ายตรงข้าม'); return; }
    if (f0.c.mgImm >= r.g.n && !r.g.inB && r.g.turn !== f0.i) { vfx(f0.c.u, 'aura', 'ไม่ถูกนำออกจากสนาม', '#ef4444'); log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนามด้วย Magic (น้องส้ม ชู้วันชัย)'); return; }   // BT05-009
    if (r.g.inB) { const q = r.p.find(q => q.mg.some(m => m.at === f0.c.u && m.id === 'BT02-055')); if (q) { const k = q.mg.findIndex(m => m.at === f0.c.u && m.id === 'BT02-055'), [cd] = q.mg.splice(k, 1); delete cd.at; q.hell.push(cd); fx({ k: 'say', id: 'BT02-055', t: 'ไม่ถูกทำลาย' }); log(r, '🛡 ประกันชั้นต่ำ: ' + nmOf(f0.c) + ' ไม่ถูกทำลาย'); return; } }
    const k10 = (f0.c.wr || []).findIndex(w => w.id === 'BT02-010');
    if (k10 >= 0 && nmHas(f0.c, 'ไอดอล')) { r.p[f0.i].hell.push(f0.c.wr.splice(k10, 1)[0]); log(r, '🛡 ทำลาย โอตะ รุ่นก่อตั้ง แทน ' + nmOf(f0.c)); return; }
    if (f0.c.ward) { delete f0.c.ward; log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกทำลาย (คุณพยาบาล)'); return; }
    { const ws14 = r.p[f0.i].mg.filter(m => m.id === 'KD04-014' && m.at === f0.c.u && m.u14 !== r.g.n); if (ws14.length && !nf0 && (r.g.inB || r.g.turn !== f0.i)) { ws14.forEach(w => { w.u14 = r.g.n; }); const ds = ws14.map(() => 1 + Math.floor(Math.random() * 6)), ev14 = ds.filter(d => d % 2 === 0).length; fx({ k: 'dice', i: f0.i, v: ds[0], vs: ds }); log(r, '🎲 ไบโพล่า ชิลด์ ' + ds.length + ' ใบ ทอยลูกเต๋า ' + ds.length + ' ลูกพร้อมกัน: ' + ds.join(', ') + (ev14 ? ' (มีเลขคู่ ' + ev14 + ' ลูก)' : ' (ไม่มีเลขคู่)')); if (ev14) { vfx(f0.c.u, 'burst', 'ไม่ถูกนำออกจากสนาม (ทอยได้คู่)', '#38bdf8'); log(r, '🛡 ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนาม'); return; } } }
    if (primalSave(r, f0, () => kill(r, i, u, 1))) return;   // SD08-001 ไพรมอล: สกิล 2
    if (f0.c.id === 'KD01-005' && !f0.c.half && !nf0) { f0.c.half = 1; const dv = Math.floor((B[f0.c.id].p || 0) / 2); f0.c.pw = (f0.c.pw || 0) - dv; fx({ k: 'say', id: f0.c.id, t: 'POWER ตั้งต้นลดครึ่ง แทนการถูกทำลาย' }); fx({ k: 'buff', u: f0.c.u, v: -dv }); log(r, '🛡 ' + nmOf(f0.c) + ': POWER ตั้งต้น -' + dv + ' แทนการถูกทำลาย'); return; }
    const k = (f0.c.wr || []).findIndex(w => w.id === 'SD04-002');
    if (k >= 0) { r.p[f0.i].hell.push(f0.c.wr.splice(k, 1)[0]); log(r, '🛡 ทำลาย จ่ามะนาว แทน ' + nmOf(f0.c)); return; }
  }
  const f = take(r, u); fx({ k: 'die', u, id: f.c.tk ? null : (f.c.kd || f.c.id), nm: f.c.tk ? f.c.tk.n : null }); if (!f.c.tk) { const rp = bt6Rep(r, f); if (rp === 'bot') r.p[f.i].deck.unshift(f.c); else if (rp === 'deck') { r.p[f.i].deck.push(f.c); shuf(r.p[f.i].deck); } else r.p[f.i].hell.push(f.c); }
  deathFx(r, f, nf0);
};
function payOK(c, pay, me) {
  if (!c.c) { if (pay.length) E('Cost 0 ไม่ต้องจ่าย'); return; }
  const gs = pay.map(x => { const d = B[x.id]; if (me && me.noCost && me.noCost.includes(d.n)) E('ใช้เป็น Cost ไม่ได้: ' + d.n); const gv = giantG(c, d, me); if (gv) return gv; if (!d.g) E('การ์ด Gem 0 ใช้จ่ายไม่ได้'); if (d.gc && c.col && d.gc !== c.col && !bt9Colorless(c, d) && !(CR && d.t === 'Avatar' && d.n.includes('แบงค์') && bt6Land(CR, 'BT06-061', CR.p.indexOf(me)))) E('สี Gem ไม่ตรง: ' + d.n); /* Gem ขาว(ไม่มีสี)จ่ายได้ทุกสี / การ์ดไม่มีสีรับ Gem ทุกสี */ return d.g; });
  const sum = gs.reduce((a, b) => a + b, 0);
  if (sum < c.c) E('Gem ไม่พอ (' + sum + '/' + c.c + ')');
}
function startTurn(r) {
  const g = r.g, p = r.p[g.turn]; g.used = [{}, {}]; g.noReact = null;
  p.av.forEach(a => { if (!(a.hold && a.hold >= g.n) && !cc19Lock(r, a) && !a.nw48) a.tired = false; });
  let cnt = g.n === 0 ? 2 : p.hand.length < 3 ? 3 - p.hand.length : (p.av.some(a => a.id === 'BT10-035' && !noFx(r, a)) ? 2 : 1); if (bt10NoDraw(r, p)) cnt = 0;   // BT10-035/057
  const queen = g.n < 2 ? p.deck.find(c => c.id === 'BT01-008') : null;   // Draw Phase แรกของผู้เล่น
  const fin = swap => {
    g.dpOn = g.n;
    const b4 = p.hand.length;
    if (swap === 'st65') { /* รูปปั้นพระอิศวร: ไม่จั่วปกติ */ }
    else if (swap) { p.deck.splice(p.deck.indexOf(queen), 1); p.hand.push(queen); draw(r, p, cnt - 1); shuf(p.deck); log(r, '👑 ' + p.name + ': นำ รัททาทุย นางพญา จาก Deck ขึ้นมือแทนการจั่ว'); }
    else draw(r, p, cnt);
    const got = p.hand.length - b4; g.dr = { n: ++DRN, who: g.turn, c: got };
    log(r, '— เทิร์น ' + p.name + ' —'); log(r, p.name + ' จั่ว ' + got + ' ใบ');
    (p.lf || []).splice(0).forEach(id => lifeFx(r, g.turn, id)); bt7Draw(r, g.turn); bt7Back(r, g.turn);
    startFx456(r); bt6Start(r); g.drawWin = g.n; bt10MainStart(r);
  };
  g.phase = 'main';
  if (!queen && p.co.some(c => c.id === 'BT06-065') && p.deck.length >= 2) ask(r, g.turn, { yn: true, text: 'รูปปั้นพระอิศวร: สอดแนม 2 ใบ นำ Symbol เทพ 1 ใบขึ้นมือ แทนการจั่วปกติไหม?', cb: y => y ? bt6Statue(r, g.turn, fin) : fin(false) });
  else if (queen) ask(r, g.turn, { yn: true, text: 'รัททาทุย นางพญา: นำการ์ดใบนี้จาก Deck ขึ้นมือแทนการจั่ว 1 ใบ?', cb: y => fin(!!y) }); else fin(false);
}
function hit(r, d, atk) {
  const k = d.life.findIndex(l => !l.up);
  if (k < 0) { r.g.over = atk.name + ' ชนะ!'; r.g.win = r.p.indexOf(atk); return 'KO'; }
  d.life[k].up = 1; fx({ k: 'life', i: r.p.indexOf(d) }); (d.lf = d.lf || []).push(d.life[k].id); bt8Life(r, r.p.indexOf(d)); const c = B[d.life[k].id];
  log(r, d.name + ' LIFE: ' + c.n + ' — ' + c.e);
  if (d.life.every(l => l.up)) log(r, d.name + ' สาหัส!');
  return d.life[k].id;
}
function passTurn(r, i) {
  if (r.p[i].hand.length > 7) E('มือเกิน 7 ต้องทิ้งก่อน');
  bt6Back(r, i);
  if (bt6CafeOK(r, i)) { r.g.cafe = r.g.n; return ask(r, i, { yn: true, text: 'คาเฟ่หมาแมว (End Phase): สั่งใช้ไหม?', cb: y => y ? bt6Cafe(r, i, () => passTurn(r, i)) : passTurn(r, i) }); }
  if (!kdSwapList(r).length) return passTurn1(r, i);
  const step = () => { const w = kdSwapList(r)[0]; if (!w) return passTurn1(r, i); kdSwap(r, w.qi, w.a, step); };
  step();
}
function passTurn1(r, i) {
  const g = r.g; g.noReact = null; bt8End(r, i);
  r.p.forEach(q => q.av.forEach(a => { a.tp = 0; a.bp = 0; a.bs = null; })); g.turn = 1 - i; g.n++; endTurn456(r); endTurnFx(r); loki03(r, i); startTurn(r);
}
function act(r, i, m) {
  CR = r; const g = r.g, me = r.p[i], op = r.p[1 - i], mine = g.turn === i; g.inB = 0;
  if (g.over && m.t !== 'chat') E('เกมจบแล้ว');
  if (g.drawWin === g.n && (['summon', 'build', 'cast', 'atk'].includes(m.t) || (m.t === 'use' && !(find(r, m.u) && find(r, m.u).c.id === 'BT06-070')))) g.drawWin = -1;
  if (g.ask) { if (!['chat', 'pick', 'surrender'].includes(m.t)) E('รอเลือกให้เสร็จก่อน'); if (m.t === 'pick' && g.ask.who !== i) E('รออีกฝ่ายเลือก'); }
  else if (g.pend && !['chat','pass','surrender'].includes(m.t) && !(i === g.pend.who && ['dview','dmove','dpos','dshuf','cast','discard','atkresp'].includes(m.t))) E('รอ React ก่อน');
  const mainOnly = () => { if (!mine || g.phase !== 'main') E('เฉพาะ Main Phase'); };
  const own = u => { const f = find(r, u); if (!f || f.i !== i) E('ไม่ใช่การ์ดของเรา'); return f; };
  const pays = () => (m.pay || []).map(u => { if (u === m.u) E('ใช้การ์ดใบนี้เป็น Cost ของตัวเองไม่ได้'); const f = own(u); if (f.z !== 'hand') E('ต้องจ่ายด้วยการ์ดในมือ'); return f.c; });
  SEQ++; HAND_SRC = null; switch (m.t) {
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
      if (!mine) E('ไม่ใช่เทิร์นเรา'); if (g.phase === 'battle' || m.fin) { bt8Force(r, i); ccMustAtk(r, i); }
      if (m.fin) { if (g.phase === 'dice' || g.phase === 'pick' || g.phase === 'mull') E('ยังจบเทิร์นไม่ได้'); if (me.hand.length > 7) { const need = me.hand.length - 7, us = [...new Set((m.disc || []).map(Number))]; if (us.length === need) { us.forEach(u => { const f = own(u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); }); us.forEach(u => { const f = take(r, u); me.hell.push(f.c); }); log(r, me.name + ' ทิ้ง ' + us.length + ' ใบ (มือเกิน 7)'); passTurn(r, i); } else { g.phase = 'end'; log(r, me.name + ': มือเกิน 7 ต้องทิ้ง ' + need + ' ใบ'); } } else passTurn(r, i); break; }
      if (g.phase === 'main') { g.phase = g.n === 0 ? 'end' : 'battle'; if (g.phase === 'battle') enterBattle03(r); else bt7End(r, i); }
      else if (g.phase === 'battle') { g.phase = 'end'; bt7End(r, i); }
      else passTurn(r, i);
      break;
    case 'discard': { const f = own(m.u); if (f.z !== 'hand') E('ทิ้งได้เฉพาะมือ'); take(r, m.u); me.hell.push(f.c); log(r, me.name + ' ทิ้ง ' + B[f.c.id].n); break; }
    case 'summon': case 'build': {
      const f = own(m.u), c = B[f.c.id], av = m.t === 'summon', hall0 = av && f.z === 'hand' && f.c.stl && E('การ์ดที่ขโมยมา ใช้เป็น Cost อัญเชิญ Avatar ได้เท่านั้น'), hall = av && f.c.id === 'BT05-023' && f.z === 'hand' && g.pend && g.pend.who === i && g.pend.k === 'atk' && !me.bot; if (!hall) mainOnly();
      if (f.z !== 'hand' || c.t !== (av ? 'Avatar' : 'Construct')) E('ประเภทผิด');
      if (f.c.id === 'SD03-003') E('การ์ดนี้ลงสนามจากบนมือไม่ได้');
      if (!hospOK(r, i, f.c)) E('โรงบาล: เทิร์นนี้อัญเชิญการ์ดชื่อนี้ไม่ได้');
      if (f.c.id === 'BT04-005') E('ยายกบ 1954 อัญเชิญแบบจ่าย Cost ไม่ได้ (สั่งใช้ จากมือ โดยส่ง กบ ลงนรก)');
      if (f.c.id === 'KD02-001') E('เมฟิสโตเฟเลส อัญเชิญได้ด้วยความสามารถของตัวเองเท่านั้น (สั่งใช้ จากมือ)');
      if (av && g.lim && g.lim[i] && symOf(f.c) !== g.lim[i]) E('เทิร์นนี้อัญเชิญได้เฉพาะ Avatar ' + g.lim[i]);
      if (av ? !canPlaceAv(r, i, f.c) : me.co.length >= 3) E(av ? 'Avatar เต็ม' : 'Construct เต็ม 3');
      if (!av && me.co.some(x => B[x.id].n === c.n)) E('Construct ชื่อซ้ำ');
      const ps = pays(), ecc = (av || f.c.id === 'BT07-072' || f.c.id === 'BT10-074') ? handCost(r, i, f.c) : null, cEff = ecc != null ? { ...c, c: ecc } : c; payOK(cEff, ps, me); const gsum = ps.reduce((a, q) => a + (giantG(cEff, B[q.id], me) || B[q.id].g || 0), 0); ps.forEach(q => { if (B[q.id].n === 'ตุ๊กตารัททาทุย' && !(av && isRat(f.c))) E('ตุ๊กตารัททาทุย ใช้จ่ายได้เฉพาะ Avatar รัททาทุย'); if (q.id === 'KD01-004' && !(av && symOf(f.c) === 'เทพ')) E('พระลักษมี ใช้เป็น Cost ได้เฉพาะ Avatar เทพ'); { const cr3 = COST03[q.id]; if (cr3 && !(av && cr3.ok(f.c))) E(cr3.msg); } });
      ps.forEach(p => { take(r, p.u); me.hell.push(p); }); take(r, m.u); me[av ? 'av' : 'co'].push(f.c); if (av) heroMk(r, i, f.c); if (av && cEff.c > 0 && gsum === cEff.c) { f.c.jt = 1; log(r, '🎯 พอดี! ' + nmOf(f.c) + ' อัญเชิญด้วย Gem พอดี Cost (' + gsum + ')'); } else delete f.c.jt; if (av) noteSum(r, i, f.c); if (av) bt7Cost(r, i, f.c, ps); if (av) bt10Cost(r, i, f.c, ps);   // ระบบ พอดี
      if (av) { g.q.push(() => costFx(r, i, ps, f.c)); g.q.push(() => fxSummon(r, i, f.c)); } else g.q.push(() => { if (f.c.id === 'SD08-018') summonRat1(r, i); });
      g.q.push(() => fxPaid(r, i, ps, f.c));
      if (hall) { g.pend.tg = f.c.u; g.pend.tk = 'av'; vfx(f.c.u, 'burst', 'ย้ายเป้าหมาย!', '#a855f7'); fx({ k: 'say', id: f.c.kd || f.c.id, t: 'อัญเชิญตอบโต้' }); log(r, '🛡 นักรบ ฮอล: อัญเชิญตอบโต้ — เปลี่ยนเป้าหมายการโจมตีมาที่ ฮอล'); }
      ev(r, f.c.kd || f.c.id, f.c.ar); log(r, me.name + (av ? ' อัญเชิญ ' : ' ก่อสร้าง ') + c.n); open(r, { who: 1 - i, k: 'ev', ev: { k: av ? 'summon' : 'build', u: f.c.u, i, cost: c.c, id: f.c.kd || f.c.id } }); break;
    }
    case 'cast': {
      const f = own(m.u), c = B[f.c.id]; if (c.t !== 'Magic') E('ไม่ใช่ Magic'); cc2CastBlock(r, i, c);
      if (f.c.stl) E('การ์ดที่ขโมยมา ใช้เป็น Cost อัญเชิญ Avatar ได้เท่านั้น');
      const def0 = MG[c.id] || (c.st === 'Modification' ? { mod: 1 } : {}), def = (c.st === 'Modification' && !Object.keys(def0).filter(k => k !== '__w').length) ? { mod: 1 } : def0;   // Modification ที่ลงทะเบียนเป็น {} (เช่น ตีแม่/ตีพ่อ BT01) ต้องสวมใส่ Avatar ได้
      if (!(f.z === 'hand' || (f.z === 'hell' && f.c.mh === g.n && c.st === 'Modification' && !g.used[i].Modification && mine && g.phase === 'main'))) E('ใช้จากโซนนี้ไม่ได้');
      if (c.st === 'React' || r049(r, i, c)) { if (!reactOK(r, i, c, def)) E('ใช้ React ตอนนี้ไม่ได้'); } else if (!mine && c.s === 'ฤษี' && ['Normal', 'Modification', 'Land'].includes(c.st) && hasRishi(r, i) && g.phase === 'main' && !g.ask && !g.pend) { /* BT05-011 ฤๅษี: ใช้ได้ในเทิร์นฝ่ายตรงข้าม */ } else mainOnly();
      const m2 = (g.mod2 && g.mod2.who === i && g.mod2.n === g.n && c.st === 'Modification') ? g.mod2 : null;
      if (m2 && !c.n.startsWith('อาวุธหุ่นนักรบผู้กล้า')) E('ฐานซีทันยาน: เทิร์นนี้ใช้ได้เฉพาะ Modification "อาวุธหุ่นนักรบผู้กล้า"');
      const extra = !!(m2 && g.used[i].Modification && !m2.second), x30 = !extra && c.st === 'Normal' && (isSpell(c) || (g.x30 && g.x30.any && c.id !== g.x30.not)) && g.used[i].Normal && g.x30 && g.x30.n === g.n && g.x30.who === i && !g.x30.done;
      if (c.st === 'Land' && landIs(r, 'BT08-064') && g.land.o !== i && r.p[g.land.o].av.some(a => a.id === 'BT08-027' && !noFx(r, a))) E('กัฟแดน: ฝ่ายตรงข้ามใช้ Land Magic ไม่ได้');
      if (g.used[i][c.st] && !extra && !x30 && !(c.st === 'Magic' && false) && !(r.p[i].co.some(k => k.id === 'BT06-069') && (c.id === 'SD04-016' || c.id === 'PRMO-021'))) E(c.st + ' ใช้ได้ 1 ครั้ง/เทิร์น');
      if (extra) m2.second = 1; if (x30) g.x30.done = 1;
      if (!MG[c.id]) log(r, '⚠ ' + c.n + ': ระบบยังไม่รองรับเอฟเฟกต์ — ทำเองตามข้อความการ์ด');
      startCast(r, i, f, c, def, m.tg != null ? Number(m.tg) : null); g.q.push(() => weaponTrig03(r, c)); break;
    }
    case 'pick': {
      const a = g.ask; HAND_SRC = (a && a.src) || null; if (!a) E('ไม่มีให้เลือก');
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
      if (m.tg === 'life' && op.co.some(x => x.id === 'BT06-068')) E('ป้อมยามสามัคคี: ฝ่ายตรงข้ามโจมตี LIFE ไม่ได้');
      if (a.c.id === 'BT02-024' && !noFx(r, a.c)) E('เสามงคลโจมตีไม่ได้');
      if (a.c.id === 'CC01-018' && !noFx(r, a.c)) E('เสามงคล ทรงจีน โจมตีไม่ได้');
      if (a.c.id === 'CC01-013' && !noFx(r, a.c)) E('เจนนี่ โจมตีไม่ได้');
      if (r.g.hosp && r.g.hosp.atk && !hospOK(r, i, a.c)) E('โรงบาล: การ์ดชื่อนี้โจมตีไม่ได้ในเทิร์นนี้');
      if ((a.c.id === 'BT07-032' || (a.c.id === 'BT07-022' && a.c.ao7 !== g.n) || (a.c.wr || []).some(w => w.id === 'BT07-073')) && !noFx(r, a.c)) E('Avatar ใบนี้โจมตีไม่ได้');
      if (a.c.id === 'BT07-042' && !noFx(r, a.c) && !me.av.some(x => x.u !== a.c.u && nmOf(x).includes('วานร'))) E('บัวนิด โจมตีได้เฉพาะเมื่อควบคุม Avatar "วานร" ใบอื่น');
      if (a.c.id === 'BT04-029' && !noFx(r, a.c)) E('เสามงคล ทรงโรมัน โจมตีไม่ได้');
      if ((a.c.id === 'BT06-034' || a.c.id === 'BT06-038') && !noFx(r, a.c)) E('Avatar ใบนี้โจมตีไม่ได้');
      if (bt6Banned(r, i, a.c)) E('อาเธอร์: Avatar ชื่อนี้โจมตีไม่ได้ในเทิร์นนี้');
      if (bt9NoAtk(r, a.c)) E('Avatar นี้โจมตีไม่ได้'); if (a.c.noatk === g.n) E('Avatar นี้เปลี่ยนการควบคุม สั่งโจมตีไม่ได้ในเทิร์นนี้');
      if (a.c.id === 'BT03-009' && !noFx(r, a.c) && me.hand.length) E('จีสัส โจมตีได้เฉพาะเมื่อไม่มีการ์ดบนมือ');
      if (a.c.id === 'BT02-029' && !(a.c.wr && a.c.wr.length)) E('รถถังต้องมี Avatar สวมใส่ก่อนจึงโจมตีได้');
      if (g.onlyBug && g.onlyBug.n === g.n && g.onlyBug.i === i && !isInsect(r, a.c)) E('เทิร์นนี้โจมตีได้เฉพาะ Avatar {แมลง}');
      if (a.c.id === 'SD04-004' && !(a.c.wr && a.c.wr.length)) E('รถถังต้องมี Avatar สวมใส่ก่อนจึงโจมตีได้');
      if (a.c.id === 'BT08-043' && !noFx(r, a.c) && (a.c.wr || []).filter(w => B[w.id].t === 'Avatar').length < 2) E('รถถังเฟืองเหล็กต้องมี Avatar สวมใส่ 2 ใบขึ้นไปจึงโจมตีได้');
      if (a.c.id === 'SD06-003' && m.tg === 'life' && !hasCamp(r, i)) E('ทองเหม็นตี LIFE ไม่ได้ ถ้าไม่ได้ควบคุม ค่ายบางระจัน');
      let tk = 'av';
      if (m.tg === 'life') { if (op.av.some(x => x.id === 'BT10-026' && linked9(r, x))) E('จอมเวทย์ เดสสึหวา (Link): เลือกเป้าหมายโจมตีอื่นนอกจากการ์ดใบนี้ไม่ได้'); if (op.av.length && !kick(r, a.c)) E('ต้องกำจัด Avatar ก่อน'); tk = 'life'; }
      else if (op.av.some(x => x.u === m.tg)) tk = 'av';
      else if (op.co.some(x => x.u === m.tg)) tk = 'co';
      else E('ไม่พบเป้าหมาย');
      if (tk === 'av') { const tgt = op.av.find(x => x.u === m.tg); if (tgt && (kdUntarget(r, 1 - i, tgt) || bt9AtkBlock(r, a.c, tgt))) E('Avatar นี้ถูกเลือกเป็นเป้าหมายการโจมตีไม่ได้'); }
      if (tk === 'co') { const tc = op.co.find(x => x.u === m.tg); if (tc && tc.id === 'BT08-068' && op.av.some(x => B[x.id].n.includes('วอเตอร์แมน'))) E('ยิมทมิฬถูกเลือกเป็นเป้าหมายการโจมตีไม่ได้'); if (tc && tc.id === 'BT10-072' && op.av.some(x => nmOf(x).includes('จอมเวทย์'))) E('หอสมุดจอมเวทย์ถูกเลือกเป็นเป้าหมายการโจมตีไม่ได้'); if (op.av.some(x => x.id === 'BT10-026' && linked9(r, x))) E('จอมเวทย์ เดสสึหวา (Link): เลือกเป้าหมายโจมตีอื่นนอกจากการ์ดใบนี้ไม่ได้'); }
      const sup = [...new Set((m.sup || []).map(Number))].filter(u => u !== a.c.u).map(u => { const q = own(u);
        if (q.z !== 'av' || q.c.tired || q.c.tk) E('สนับสนุนไม่ได้: ' + nmOf(q.c));
        const e = B[q.c.id].e || '';
        if (!/สามัคคี|แทงหลัง/.test(e) && !hasKw(r, q.c, 'สามัคคี')) E('สามัคคี/แทงหลังไม่ได้: ' + nmOf(q.c)); if (bt9SupBlock(r, q.c, a.c)) E('โลกิ ใช้สามัคคีได้เฉพาะให้ "ธอร์"');
        if (!/แทงหลัง/.test(e) && op.co.some(x => x.id === 'SD07-020')) E('ด่านเฮาโลก๋วน: ฝ่ายตรงข้ามใช้สามัคคีไม่ได้');
        return q.c; });
      sup.forEach(q => {
        const e = B[q.id].e || '', bs = /แทงหลัง/.test(e);
        const add = P(r, q) + (bs ? 1 : 0); a.c.bp = (a.c.bp || 0) + add; q.tired = true;
        if (bs) { (a.c.bs = a.c.bs || []).push(colOf(q)); if (q.id === 'SD07-006' && isCol(a.c, 'แดง') && q.ou !== g.n) { q.ou = g.n; q.tired = false; log(r, '✨ ซุนเซ็ก กลับมาตื่น'); } }
        fx({ k: 'buff', u: a.c.u, v: add }); log(r, (bs ? '🗡 ' : '🤝 ') + nmOf(q) + (bs ? ' แทงหลัง +' : ' สามัคคี +') + add); bt10Sup(r, i, q, a.c, bs);
      });
      if (g.land && g.land.c.id === 'SD02-020' && TRIO.includes(nmOf(a.c))) { a.c.bp = (a.c.bp || 0) + 2; fx({ k: 'buff', u: a.c.u, v: 2 }); log(r, '🏠 สมชายห้องเช่า: POWER +2'); }
      if (g.land && g.land.o === i && g.land.c.id === 'SD08-017' && isRat(a.c)) { a.c.bp = (a.c.bp || 0) + 2; fx({ k: 'buff', u: a.c.u, v: 2 }); log(r, '🏠 พิภพรัททาทุย: POWER +2'); }
      a.c.tired = true; log(r, nmOf(a.c) + ' โจมตี ' + (tk === 'life' ? 'LIFE' : tk === 'co' ? 'Construct' : 'Avatar')); if (!g.atkC || g.atkC.n !== g.n) g.atkC = { n: g.n, c: 0 }; g.atkC.c++;
      if ((a.c.id === 'SD06-002' || a.c.k31 === g.n) && tk === 'life' && op.av.length) g.q.push(() => ask(r, i, { text: 'เตะไข่: เลือก Avatar ฝ่ายเรา 1 ใบ ทำลาย', opts: me.av.map(x => x.u), cb: us => destroyAv(r, us[0]) }));
      g.atkN = (g.atkN && g.atkN.n === g.n) ? { n: g.n, c: g.atkN.c + 1 } : { n: g.n, c: 1 };
      bt6Atk(r, i, a.c, m.tg, tk);
      if (a.c.id === 'BT06-022' && !noFx(r, a.c) && bankNames(r, i) >= 10) { g.noReact = { who: 1 - i, b5: 1 }; vfx(a.c.u, 'aura', 'ห้าม React', '#f59e0b'); log(r, '🏦 แบงค์ผู้พิชิต (10 ชื่อ): ฝ่ายตรงข้ามใช้ React ไม่ได้จนจบการต่อสู้'); }
      if (me.mg.some(mm => mm.at === a.c.u && mm.id === 'BT05-065')) { g.noReact = { who: 1 - i, b5: 1 }; vfx(a.c.u, 'aura', 'ห้าม React', '#38bdf8'); log(r, '🚫 กระบองแสง: ฝ่ายตรงข้ามใช้ React ไม่ได้จนจบการต่อสู้'); }
      if (a.c.id === 'BT05-032' && !noFx(r, a.c)) { addTp(a.c, 3); vfx(a.c.u, 'aura', 'POWER +3', '#a855f7'); log(r, '⚔ เจ๊หมวย: ประกาศโจมตี POWER +3'); }
      if (a.c.id === 'BT05-044' && !noFx(r, a.c)) { addTp(a.c, 1); vfx(a.c.u, 'aura', 'POWER +1', '#22c55e'); log(r, '⚔ อาจารย์หลี: โจมตี POWER +1 จนจบเทิร์น'); }
      if (tk === 'av') { const t32 = op.av.find(x => x.u === m.tg); if (t32 && t32.id === 'BT05-032' && !noFx(r, t32)) { addTp(t32, -3); vfx(t32.u, 'aura', 'POWER -3', '#ef4444'); log(r, '🛡 เจ๊หมวย: ถูกเล็งเป้าหมาย POWER -3'); } }
      if (a.c.id === 'BT05-017' && !noFx(r, a.c) && me.hell.some(c => !c.tk && B[c.id].n === 'ของขวัญที่เมียทิ้งไว้ให้')) g.q.push(() => { if (!op.hand.length) return log(r, 'เจค: ฝ่ายตรงข้ามไม่มีการ์ดบนมือ'); const c = op.hand.splice(Math.floor(Math.random() * op.hand.length), 1)[0]; op.hell.push(c); vfx(a.c.u, 'burst', 'สุ่มทิ้ง!', '#38bdf8'); log(r, '🎯 เจค นักฆ่ามือเก๋า: สุ่มทิ้งการ์ดบนมือ ' + op.name + ' (' + B[c.id].n + ')'); });   // BT05-017
      g.q.push(() => bt8Redir(r, i, a.c, m.tg, tk, (ntg, ntk) => { m.tg = ntg; tk = ntk; }));
      g.q.push(() => fx({ k: 'atkp', i, a: a.c.u, tg: m.tg, tk })); g.q.push(() => fxAtk(r, i, a.c, m.tg, tk));
      g.q.push(() => a.c.id === 'BT02-023' && !noFx(r, a.c) ? chooseTg(r, i, a.c, { who: 1 - i, k: 'atk', ai: i, u: m.u }) : shieldStep(r, { who: 1 - i, k: 'atk', ai: i, u: m.u, tg: m.tg, tk }));
      break;
    }
    case 'xuse': {   // สกิลเสริม: ตัวสวมใส่ (unwear/exile) และสกิลที่ 2 ของ Avatar
      mainOnly(); let c = null, host = null;
      const fa = me.av.find(a => a.u === m.u); if (fa) c = fa; else for (const a of me.av) { const w = (a.wr || []).find(w => w.u === m.u); if (w) { c = w; host = a; break; } }
      if (!c) E('ไม่พบการ์ด');
      if (m.k === 'unwear') { if (!host || !wearSk(r, i, host, c).some(x => x.k === 'unwear')) E('อัญเชิญตอนนี้ไม่ได้'); host.wr.splice(host.wr.indexOf(c), 1); c.us = g.n; log(r, '⚡ ' + me.name + ' อัญเชิญ ' + B[c.id].n + ' จากสภาพสวมใส่'); putAv(r, i, c); }
      else if (m.k === 'exile') { if (host ? !wearSk(r, i, host, c).some(x => x.k === 'exile') : !extraSk(r, i, c).length) E('ใช้สกิลนี้ตอนนี้ไม่ได้'); exileOta(r, i, c, host); }
      else E('ไม่มีสกิลนี้'); break; }
    case 'use': {
      { const f0 = find(r, m.u), d0 = f0 && (AB[f0.c.id] || ABIL[f0.c.id]); if (d0 && d0.end) { if (!mine || g.phase !== 'end') E('เฉพาะ End Phase'); } else if (d0 && d0.any && !g.ask && !g.pend && ['main', 'battle', 'end'].includes(g.phase)) { /* สั่งใช้ได้ในเทิร์นใครก็ได้ */ } else mainOnly(); } let f = find(r, m.u), z;
      if (f && f.i === i) z = f.z; else if (g.land && g.land.o === i && g.land.c.u === m.u) { f = { i, z: 'land', c: g.land.c }; z = 'land'; } else E('ไม่ใช่การ์ดของเรา');
      if (z === 'hell' && f.c.id === 'BT05-064') {   // อาลอนไดร์ท: ธรณีสูบ 1 ใบ แล้วนำตัวเองจากนรกไปสวมใส่ อัศวินโต๊ะกลม
        if (!hell64OK(r, i)) E('ต้องยังไม่ใช้ Modification Magic เทิร์นนี้ และมี "อัศวินโต๊ะกลม" บน Avatar Zone');
        const cu = f.c.u; ask(r, i, { text: 'อาลอนไดร์ท: เลือก "อัศวินโต๊ะกลม" ที่จะสวมใส่ (ธรณีสูบ 1 ใบ)', opts: me.av.filter(isKnight).map(a => a.u), cancel: true, cb: us => { const t = find(r, us[0]), c2 = me.hell.find(h => h.u === cu); if (!t || !c2) return; mill(r, i, 1, c2); const k = me.hell.indexOf(c2); if (k < 0) return; me.hell.splice(k, 1); me.mg.push(c2); c2.at = t.c.u; g.used[i].Modification = 1; vfx(t.c.u, 'aura', '🗡 อาลอนไดร์ท', '#f97316'); log(r, '🗡 ดาบศักดิ์สิทธิ์ อาลอนไดร์ท: ธรณีสูบ 1 ใบ แล้วสวมใส่ให้ ' + nmOf(t.c)); } }); break;
      }
      if (z === 'hell' && f.c.id === 'BT05-033') {   // ลุงไนท์: สั่งใช้จากนรก ทิ้งมือ 1 ใบ → อัญเชิญตัวเอง
        if (!hell33OK(r, i, f.c)) E('ต้องคุม Avatar "วานร" 3 ใบ, มีการ์ดบนมือ และมีที่ว่างใน Avatar Zone');
        const cu = f.c.u; ask(r, i, { text: 'ลุงไนท์: ทิ้งการ์ดจากมือ 1 ใบ เพื่ออัญเชิญ ลุงไนท์ จากนรก', opts: me.hand.map(c => c.u), cancel: true, cb: us => { const d = fromZone(r, i, 'hand', us[0]); if (!d) return; me.hell.push(d); const c2 = me.hell.find(h => h.u === cu);
          if (c2 && summonAny(r, i, cu, 'hell')) { vfx(cu, 'burst', 'ราชาวานรกลับมา!', '#22c55e'); fx({ k: 'say', id: 'BT05-033', t: 'อัญเชิญจากนรก' }); r.g.q.unshift(() => fxSummon(r, i, c2)); } } }); break;
      }
      if (z === 'mg' && isPole(f.c) && has33(r, i)) z = 'av';
      if (z === 'av' && bt6Banned(r, i, f.c)) E('อาเธอร์: Avatar ชื่อนี้ใช้ความสามารถไม่ได้ในเทิร์นนี้');
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
      const def = AB[f.c.id] || AB[bt8Gain(f.c)] || ((f.c.wr || []).some(w => w.id === 'BT02-010') ? AB_R : null); if (!def || def.z !== z) E('การ์ดนี้ไม่มีความสามารถที่สั่งใช้ได้'); if (noFx(r, f.c)) E('ความสามารถถูกยกเลิก');
      if (f.c.us === g.n) E('ใช้ได้เทิร์นละครั้ง'); if (def.can && !def.can(r, i, f.c)) E('เงื่อนไขการใช้ไม่ครบ');
      if (richGuard(r, i, f, m)) break;
      startUse(r, i, f.c, def); break;
    }
    case 'oe': { if (g.phase !== 'dice' || i !== 0) E('ตอนนี้ไม่ได้'); const d = 1 + Math.floor(Math.random() * 6); g.dw = (d % 2 === 1) === (m.v === 'odd') ? 0 : 1; g.dc = { n: ++DCN, d, v: m.v, w: g.dw }; log(r, me.name + ' ทอย ' + d + ' · ' + r.p[g.dw].name + ' ชนะ'); g.phase = 'pick'; break; }
    case 'first': { if (g.phase !== 'pick' || i !== g.dw) E('ไม่ใช่สิทธิ์'); g.turn = m.v ? i : 1 - i; log(r, r.p[g.turn].name + ' เริ่มก่อน'); g.phase = 'mull'; break; }
    case 'atkresp': {   // BT05-044 อาจารย์หลี: ย้ายเป้าหมายการโจมตีมาที่การ์ดนี้ (เทิร์นละครั้ง)
      const p0 = g.pend; if (!p0 || p0.who !== i || (p0.k !== 'atk' && !(p0.k === 'ev' && p0.ev && (p0.ev.k === 'cast' || p0.ev.k === 'use')))) E('ไม่มีหน้าต่างตอบโต้การโจมตี'); const f = own(m.u);
      if (f.c.id === 'BT06-007') { bt6Kay(r, i, f); break; }
      if (f.c.id === 'BT08-036') { bt8Kong(r, i, f); break; }
      if (f.c.id === 'BT10-001') { bt10Ganesh(r, i, f); break; }
      if (f.c.id === 'BT08-018') { bt8Cho(r, i, f); break; }
      if (f.z !== 'av' || f.c.id !== 'BT05-044' || noFx(r, f.c)) E('ใช้ไม่ได้'); if (f.c.ou === g.n) E('ใช้ได้เทิร์นละครั้ง'); if (p0.tg === f.c.u) E('การโจมตีเล็งการ์ดนี้อยู่แล้ว');
      f.c.ou = g.n; p0.tg = f.c.u; p0.tk = 'av'; vfx(f.c.u, 'burst', '🛡 ย้ายเป้ามาที่นี่', '#22c55e'); fx({ k: 'say', id: f.c.kd || f.c.id, t: 'ย้ายเป้าหมาย' }); log(r, '🛡 อาจารย์หลี: ย้ายเป้าหมายการโจมตีมาที่ตัวเอง'); break;
    }
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
const canReact = (r, w, c) => { const d = B[c.id]; if (d && d.t === 'Magic' && cc2ODLock(r, w)) return false; if (!d || d.t !== 'Magic' || (d.st !== 'React' && !r049(r, w, c))) return false; const def = MG[c.id]; if (!def) return true; try { if (!reactOK(r, w, d, def)) return false; if (def.cond && !def.cond(r, w)) return false; const p = r.g.pend, cx = { ev: p && p.ev, pend: p, pick: {}, card: c }; for (const s of (def.steps || [])) if (s.opts(r, w, cx).length < (s.min == null ? (s.n || 1) : s.min)) return false; } catch (e) { return true; } return true; };
const atkRespList = (r, w) => { const p = r.g.pend; if (!p || (p.k !== 'atk' && !(p.k === 'ev' && p.ev && (p.ev.k === 'cast' || p.ev.k === 'use'))) || p.who !== w || r.p[w].bot || (r.g.noReact && r.g.noReact.who === w)) return []; if (p.k !== 'atk') return r.p[w].av.filter(a => bt8KongOK(r, w, a) || bt10GaOK(r, w, a)).map(a => a.u); const d = r.p[w], L = [], gem = d.hand.reduce((a, c) => a + (B[c.id].g || 0), 0);
  d.hand.forEach(c => { if (c.id === 'BT05-023' && canPlaceAv(r, w, c) && gem >= 3) L.push(c.u); });   // ฮอล: อัญเชิญตอบโต้
  d.av.forEach(a => { if (a.id === 'BT05-044' && !noFx(r, a) && a.ou !== r.g.n && p.tg !== a.u) L.push(a.u); });   // อาจารย์หลี: ย้ายเป้า
  d.av.forEach(a => { if (bt6KayOK(r, w, a)) L.push(a.u); });   // BT06-007 เคย์
  d.av.forEach(a => { if (bt8ChoOK(r, w, a)) L.push(a.u); });   // BT08-018 โจโฉ
  return L; };
const reactList = (r, w) => ((!r.g.pend || (r.g.noReact && r.g.noReact.who === w) || r.g.used[w].React) ? [] : r.p[w].hand.filter(c => canReact(r, w, c)).map(c => c.u)).concat(atkRespList(r, w));
const hasReact = (r, w) => reactList(r, w).length > 0;
const open = (r, p) => { if (r.g.over) return; p.until = Date.now() + (r.cfg.react || 15) * 1000; r.g.pend = p; };
const setBt = (r, o) => { r.g.bt = { n: ++BTN, ...o }; };
function resolveAtk(r, p) {
  const me = r.p[p.ai], op = r.p[1 - p.ai], f = find(r, p.u);
  if (!f || f.i !== p.ai || f.z !== 'av') return log(r, 'การโจมตีถูกยกเลิก');
  const a = f.c, an = nmOf(a); r.g.curAtk = a; r.g.curDef = p.tk === 'av' ? (op.av.find(x => x.u === p.tg) || null) : null;
  if (p.tk === 'av') { const d0 = op.av.find(x => x.u === p.tg); if (d0 && d0.id === 'SD03-002') { mill(r, 1 - p.ai, 2, d0); addTp(d0, 1); log(r, '✨ พ่อจีจ้า POWER +1'); } }
  if (p.tk === 'av') { const d1 = op.av.find(x => x.u === p.tg); if (d1 && d1.id === 'SD05-001') { const n = tiredCnt(r); addTp(d1, n); log(r, '✨ คุณจิระ POWER +' + n); } }
  if (p.tk === 'av') { const d1 = op.av.find(x => x.u === p.tg), t41 = x => isTank(x) && (x.wr || []).some(w => w.id === 'BT05-041');
    if (d1 && t41(a) && (symOf(d1) === 'ต่างชาติ' || also9(d1, 'ต่างชาติ'))) { vfx(d1.u, 'burst', 'ใต้ Deck!', '#22c55e'); log(r, '🪖 จ่ายุทธ Tank Ranger: ' + nmOf(d1) + ' ถูกนำเข้าใต้ Deck'); const w = take(r, d1.u); op.deck.unshift(w.c); return; }
    if (d1 && t41(d1) && (symOf(a) === 'ต่างชาติ' || also9(a, 'ต่างชาติ'))) { vfx(a.u, 'burst', 'ใต้ Deck!', '#22c55e'); log(r, '🪖 จ่ายุทธ Tank Ranger: ' + nmOf(a) + ' ถูกนำเข้าใต้ Deck'); const w = take(r, a.u); me.deck.unshift(w.c); return; } }   // BT05-041
  if (a.id === 'BT05-021' && p.tk === 'av' && !noFx(r, a)) { const d0 = op.av.find(x => x.u === p.tg); if (d0 && symOf(d0) === 'นรก') { vfx(d0.u, 'burst', 'นรกสเลเยอร์!', '#38bdf8'); fx({ k: 'say', id: a.id, t: 'ทำลายเป้าหมาย' }); log(r, '⚔ นีโม่ นรกสเลเยอร์: ทำลาย ' + nmOf(d0) + ' (Avatar {นรก} ที่เป็นเป้า)'); destroyAv(r, d0.u); return; } }   // BT05-021
  if (r.g.over) return;
  r.g.inB = 1;
  kdMulti(r, p, a);
  let pa = P(r, a) + bt4AtkBonus(r, a) + cc2AtkBonus(r, a); const base = { ai: p.ai, aid: a.tk ? null : (a.kd || a.id), an, pa };
  const cleanup = () => {
    if (find(r, a.u)) a.bp = 0;
    if (p.sh) { const q = find(r, p.sh); q && (q.c.bp = 0); }
    (p.tmp || []).forEach(t => { const q = find(r, t.u); q && (q.c.tp = (q.c.tp || 0) - t.v); });
    r.g.inB = 0; r.g.noReact = null; bt6After(r, a);
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
    if (pa > 0 && p.noDmg) { setBt(r, { ...base, tg: 'life', res: 'zero' }); }
    else if (pa > 0) { const x = bt6Hit(r, op, me, a); if (x !== 'KO' && !op.av.length) r.g.q.push(() => wall(r, 1 - p.ai)); setBt(r, { ...base, tg: 'life', res: x === 'KO' ? 'ko' : 'life', cid: x === 'KO' ? null : x }); }
    else { log(r, 'Power 0 ไม่เสียหาย'); setBt(r, { ...base, tg: 'life', res: 'zero' }); }
    if (p.tk !== 'av') surviveFx(r, p.ai, a);
    doPierce();
  } else if (p.tk === 'co') {
    const d = op.co.find(x => x.u === p.tg); if (!d) { r.g.inB = 0; return log(r, 'เป้าหาย'); }
    const pd = (B[d.id].p || 0) + (d.pw || 0) + bt8CoP(r, 1 - p.ai, d), dn = B[d.id].n; let res = 'none';
    log(r, an + ' (' + pa + ') โจมตี Construct ' + dn + ' (' + pd + ')');
    if (pa > pd) { const killCo = () => { if (!find(r, d.u)) return; take(r, d.u); fx({ k: 'die', u: d.u, id: d.id }); op.hell.push(d); onConDie(r, 1 - p.ai, d); log(r, dn + ' ถูกทำลาย'); }; if (bt6ConGuard(r, 1 - p.ai, d, killCo)) res = 'none'; else { killCo(); res = 'win'; } } else log(r, 'Power ไม่เกิน Construct — ไม่มีอะไรเกิดขึ้น');
    setBt(r, { ...base, tg: 'av', dn, did: d.id, pd, res });
    doPierce();
  } else {
    const d = op.av.find(x => x.u === p.tg); if (!d) { r.g.inB = 0; return log(r, 'เป้าหาย'); }
    let pd = P(r, d); const dn = nmOf(d);
    if (hasEq(r, a, 'SD05-017') && d.tired) { addTp(a, 1); addTp(d, -1); pa += 1; pd = Math.max(0, pd - 1); base.pa = pa; log(r, '🔱 ปืนฉมวก: POWER +1 / เป้าหมาย -1'); }
    { const w57a = bt6Wears(r, a, 'BT06-057'), w57d = bt6Wears(r, d, 'BT06-057'); if (w57a && pd > 0) { pd -= 1; log(r, '🧘 กองถ่ายฤาษี: POWER ฝ่ายตรงข้าม -1'); } if (w57d && pa > 0) { pa -= 1; base.pa = pa; log(r, '🧘 กองถ่ายฤาษี: POWER ฝ่ายตรงข้าม -1'); } }
    if (a.id === 'SD08-002') { addPw(d, -1); pd = Math.max(0, pd - 1); log(r, '✨ รัททาทุย พาหะ: ' + dn + ' POWER -1 ถาวร'); }
    if (d.id === 'SD08-002') { addPw(a, -1); pa = Math.max(0, pa - 1); base.pa = pa; log(r, '✨ รัททาทุย พาหะ: ' + an + ' POWER -1 ถาวร'); }
    if (a.id === 'BT03-034' && !noFx(r, a)) { pa += 2; pd = Math.max(0, pd - 2); vfx(a.u, 'aura', 'พาลี +2 / ศัตรู -2', '#22c55e'); log(r, '🐒 พาลี: ' + an + ' +2 / ' + dn + ' -2'); }
    if (d.id === 'BT03-034' && !noFx(r, d)) { pd += 2; pa = Math.max(0, pa - 2); vfx(d.u, 'aura', 'พาลี +2 / ศัตรู -2', '#22c55e'); log(r, '🐒 พาลี: ' + dn + ' +2 / ' + an + ' -2'); }
    if ((a.id === 'BT04-001' && !noFx(r, a)) || (d.id === 'BT04-001' && !noFx(r, d))) { const bp0 = x => x.tk ? (x.tk.p || 0) : (B[x.id].p || 0); pa = bp0(a); pd = bp0(d); vfx((a.id === 'BT04-001' ? a : d).u, 'aura', 'POWER ตั้งต้น', '#ef4444'); log(r, '🦴 จอมหักกระดูก: Avatar ที่ต่อสู้ POWER กลับเป็นค่าตั้งต้น'); }
    if (a.id === 'CC02-001' && !noFx(r, a)) { pa += 2; vfx(a.u, 'rise', 'POWER +2', '#ef4444'); log(r, '👑 มหาราชาสีนิล: ต่อสู้ POWER +2'); }
    if (d.id === 'CC02-001' && !noFx(r, d)) { pd += 2; vfx(d.u, 'rise', 'POWER +2', '#ef4444'); log(r, '👑 มหาราชาสีนิล: ต่อสู้ POWER +2'); }
    [pa, pd] = bt4Swap(r, a, d, pa, pd);
    r.g.curDef = d;
    base.pa = pa;
    log(r, an + ' (' + pa + ') สู้ ' + dn + ' (' + pd + ')');
    let kl = [];
    if (pa === pd) { if (pa > 0) { const ta = hasKw(r, a, 'ลูกฮึด'), td = hasKw(r, d, 'ลูกฮึด'); kl = ta && !td ? [d.u] : td && !ta ? [a.u] : [a.u, d.u]; } else log(r, 'เสมอ (0)'); }
    else kl = pa > pd ? [d.u] : [a.u];
    if (a.kdLose) { delete a.kdLose; if (!kl.includes(a.u)) kl.push(a.u); }
    kl = kl.filter(u => { const m = u === a.u ? a : d, o = u === a.u ? d : a; if (m.id === 'BT03-028' && !noFx(r, m) && costNow(r, o) < costNow(r, m)) { vfx(m.u, 'burst', 'ไม่ถูกทำลาย', '#22c55e'); log(r, '🛡 พระเจ้านิโคไล: ไม่ถูกทำลายจากการต่อสู้กับ Avatar ที่ Cost น้อยกว่า'); return false; }
      if (m.id === 'BT06-037' && !noFx(r, m) && (u === a.u ? pd : pa) < 10) { vfx(m.u, 'aura', '🛡 ไม่ถูกทำลาย', '#64748b'); log(r, '🛡 สว นาโนแมชชีน: ไม่ถูกทำลายจากการต่อสู้กับ Avatar ที่ POWER น้อยกว่า 10'); return false; } return true; });
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
        const dead = u => results.some(x => x.u === u && x.died);
        const ka = dead(a.u), kd = dead(d.u);
        return finish(ka && kd ? 'both' : kd ? 'win' : ka ? 'lose' : 'none');
      }
      const u = kl[idx];
      const inAv = () => { const q = find(r, u); return !!q && q.z === 'av'; };   // find() นับนรกด้วย → ต้องเช็กว่ายังอยู่บน Avatar Zone หรือไม่
      const wasThere = inAv();
      kill(r, u === a.u ? p.ai : 1 - p.ai, u);
      const died = wasThere && !inAv();
      results.push({ u, died });
      // if guard triggered ask, next kill will run in queue after answer
      if (r.g.ask) { r.g.q.push(() => { const e = results.find(x => x.u === u); if (e) e.died = wasThere && !inAv(); killSeq(idx + 1, results); }); return; }   // ตัดสินว่าตายจริงหรือไม่ หลังผู้เล่นตอบ (เช่น หมอมาแล้วววว/ถวาย)
      killSeq(idx + 1, results);
    };
    killSeq(0, []);
  }
}
function passReact(r) { CR = r; const p = r.g.pend; r.g.pend = null; if (p && p.k === 'atk') { resolveAtk(r, p); if (r.g.noReact && r.g.noReact.b5) r.g.noReact = null; } runQ(r); }
function begin(r) {
  r.p.forEach(x => { hookHand(x); hookDeck(x); });
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
setInterval(() => { for (const c in rooms) { const r = rooms[c], g = r.g; if (!g || g.over || !g.pend || g.ask || g.evw) continue; const w = g.pend.who; if (r.p[w] && r.p[w].bot) continue; try { if (!hasReact(r, w)) { const now = Date.now(); if (!g.pend.fk) g.pend.fk = now + 1000 + Math.floor(Math.random() * 1000); else if (now >= g.pend.fk) { passReact(r); bc(r); settle(r).catch(() => { }); } } } catch (e) { } } }, 300);   // ไม่มี React: หน่วงคงที่ 1.5 วิ (กันอีกฝ่ายเดาว่ามีการ์ด React)
setInterval(() => {
  const now = Date.now();
  if ((++FTK) % 2 === 0) for (const w of wss.clients) { try { pushFst(w); } catch (e) { } }
  for (const c in rooms) {
    const r = rooms[c], g = r.g;
    if (!g) { if (r.exp && now > r.exp) { r.p.forEach(p => p.ws && p.ws.readyState === 1 && p.ws.send(JSON.stringify({ err: 'ห้องหมดอายุ' }))); dropRoom(c); } continue; }
    if (g.over) { g.oa = g.oa || now; if ((r.rmT && now - r.rmT > 10000) || now - g.oa > 6e5) { r.p.forEach(p => p.ws && p.ws.readyState === 1 && p.ws.send(JSON.stringify({ t: 'rmx' }))); dropRoom(c); } continue; }
    r.p.forEach((p, k) => { if (!g.over && p.dc && now - p.dc > DC_MS) { g.over = p.name + ' หลุด 3 นาที แพ้'; g.win = 1 - k; LOST[p.name] = { op: r.p[1 - k].name, at: now }; } });
    if (g.evw) { const w = g.evw; r.p.forEach((p, k) => { if (!w.ok[k] && (p.dc || !p.ws || p.ws.readyState !== 1) && now - w.t0 > 3000) w.ok[k] = true; }); if (now - w.t0 > 30000) w.ok.fill(true); if (w.ok.every(Boolean)) { evDone(r); bc(r); } }   // หลุด: รอ 3 วิ แล้วข้ามแทน (กันค้าง 30 วิ)
    if (!g.evw && g.pend && g.pend.until && now > g.pend.until) { passReact(r); bc(r); settle(r).catch(() => { }); }
    if (!g.over && !g.evw && r.cfg.clock && ['main','battle','end'].includes(g.phase)) {
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
      if (m.t === 'setpic') {   // เปลี่ยนรูปโปรไฟล์ (ต้องมีการ์ดใบนั้นจริง) ; k = 'id|rarity' หรือ '' = ไม่ใช้รูป
        const d = await dbGet(ws.user), k = String(m.k || ''); if (k) { const id = k.split('|')[0]; if (!B[id] || !((d.cards || {})[k] > 0)) E('คุณไม่มีการ์ดใบนี้'); }
        d.pic = k || null; await dbPut(ws.user, d); Object.values(rooms).forEach(q => q.p.forEach(p => { if (p.name === ws.user) p.pic = d.pic; }));
        ws.send(JSON.stringify({ t: 'me', me: prof(ws.user, d), note: 'เปลี่ยนรูปโปรไฟล์แล้ว' })); return;
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
      if (await qHandle(ws, m)) return;
      if (m.t === 'banset' || m.t === 'banreset') {   // แอดมินแก้ไข/รีเซ็ตแบนลิสต์ (เก็บถาวร + ประกาศให้ผู้เล่นออนไลน์ทันที)
        if (ws.user !== ADMIN) E('เฉพาะแอดมิน');
        if (m.t === 'banreset') { BAN = normBan(JSON.parse(fs.readFileSync(BAN_FILE, 'utf8'))); await dbPut('sys:banlist', { reset: 1, upd: Date.now() }); }
        else {
          const x = m.ban || {}, bad = [], chk = n => { if (!CNAME[nk(n)]) bad.push(nk(n)); };
          (x.ban || []).forEach(chk); Object.keys(x.lim || {}).forEach(chk); (x.pairs || []).forEach(p => (p || []).forEach(chk)); (x.cond || []).forEach(c => { if (c && c.if) chk(c.if); if (c && c.ifOnlyName) chk(c.ifOnlyName); });
          if (bad.length) E('ไม่พบการ์ดชื่อ: ' + [...new Set(bad)].slice(0, 5).join(', '));
          const nb = normBan(x); nb.upd = Date.now(); BAN = nb; await dbPut('sys:banlist', BAN);
        }
        console.log('banlist แก้โดย', ws.user, m.t, 'ban', BAN.ban.length, 'lim', Object.keys(BAN.lim).length);
        pushBan(); ws.send(JSON.stringify({ note: m.t === 'banreset' ? 'รีเซ็ตแบนลิสต์เป็นไฟล์ banlist.json แล้ว' : 'บันทึกแบนลิสต์ (' + (BAN.asof || 'ไม่ระบุเดือน') + ') และประกาศให้ผู้เล่นแล้ว' })); return;
      }
      if (m.t === 'mkcode') {
        if (ws.user !== ADMIN) E('เฉพาะแอดมิน');
        const c = String(m.c || '').trim().toUpperCase(); if (!/^[A-Z0-9]{3,20}$/.test(c)) E('โค้ดต้องเป็น A-Z หรือ 0-9 ยาว 3-20 ตัว');
        const now = Date.now(), ttl = Math.min(525600, Math.max(0, +m.ttl | 0)); let exp = 0;
        if (ttl > 0) exp = now + ttl * 6e4; else if (+m.exp) { if (+m.exp <= now) E('เวลาหมดอายุต้องเป็นเวลาในอนาคต'); exp = Math.min(+m.exp, now + 366 * 864e5); }
        const gems = Math.max(0, +m.gems | 0), dust = Math.max(0, +m.dust | 0), art = Math.min(50, Math.max(0, +m.art | 0)); if (!gems && !dust && !art) E('ต้องใส่รางวัลอย่างน้อย 1 อย่าง');
        await codeLock(async () => {
          const T = (await dbGet('sys:codes')) || {}; T[c] = { gems, dust, art, max: Math.min(1e6, Math.max(0, +m.max | 0)), u: 0, exp, t: now };
          await dbPut('sys:codes', T); ws.send(JSON.stringify({ note: 'สร้างโค้ด ' + c + ' แล้ว' })); ws.send(codesMsg(T));
        }); return;
      }
      if (m.t === 'codelist' || m.t === 'delcode') {
        if (ws.user !== ADMIN) E('เฉพาะแอดมิน');
        await codeLock(async () => {
          const T = (await dbGet('sys:codes')) || {};
          if (m.t === 'delcode') { const c = String(m.c || '').trim().toUpperCase(); if (!T[c]) E('ไม่พบโค้ด'); delete T[c]; await dbPut('sys:codes', T); }
          ws.send(codesMsg(T));
        }); return;
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
        const SK = { board: { classic: 0, slate: 300, wood: 300, neon: 400, bot1: 2500, dark: 3750, chalk: 3750, adv: 3750, constr: 5000, shrinesky: 5000, ratinv: 5000, hellneon: 6250, space: 6250, warb: 6250, hellgate: 7500, montb: 7500, bankb: 7500, idolb: 7500 }, card: { black: 0, crimson: 300, gold: 400, ocean: 300, blue: 2500, purple: 2500, green: 2500, red: 2500, sun: 2500, violet: 3750, line: 3750, shrine: 3750, soi: 3750, ghost: 5000, galaxy: 5000, holo: 5000, rat: 5000, flame: 6250, dino: 6250, war: 6250, montho: 7500, sweeney: 7500, idol: 7500, bank: 7500 } };
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
      if (m.t === 'dust') {   // ย่อยการ์ด → ผงวิเศษ (เก็บไว้ ≥4 ใบ/ระดับ และไม่ต่ำกว่าที่เด็คที่บันทึกไว้ใช้)
        const d = await dbGet(ws.user), id = String(m.id), r = String(m.r), k = id + '|' + r, have = (d.cards && d.cards[k]) || 0;
        if (!B[id] || !DUST[r]) E('ย่อยการ์ดนี้ไม่ได้');
        let keep = DUST_KEEP; Object.values(d.decks || {}).forEach(dk => { keep = Math.max(keep, (dk.vr && dk.vr[k]) || 0); });
        const ok = Math.max(0, have - keep), n = m.all ? ok : Math.min(ok, Math.max(0, m.n | 0));
        if (n < 1) E('ย่อยได้เฉพาะใบที่เกิน ' + keep + ' ใบ (มี ' + have + ')');
        d.cards[k] = have - n; if (!d.cards[k]) delete d.cards[k];
        const got = n * DUST[r]; d.dust = (d.dust || 0) + got;
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'me', me: prof(ws.user, d), note: '🟣 ย่อย ' + n + ' ใบ ได้ ' + got + ' ผง' })); return;
      }
      if (m.t === 'craft') {   // คราฟการ์ด: มีแล้ว = 1000 ผง / ยังไม่มี = 2500 Gem + 1500 ผง
        const d = await dbGet(ws.user), id = String(m.id), r = String(m.r), k = id + '|' + r;
        if (!B[id] || !(B[id].v || []).includes(r)) E('ไม่พบการ์ด');
        if (/^(PRMO|FPRO|ODY1|CC0)/.test(id)) E('การ์ดโปรโม/พิเศษ คราฟไม่ได้');
        if (!CRAFT_R.includes(r)) E('การ์ดระดับ ' + r + ' คราฟไม่ได้');
        const own = ((d.cards && d.cards[k]) || 0) > 0, gem = own ? 0 : CRAFT_NEW_GEM, du = own ? CRAFT_OWN : CRAFT_NEW_DUST;
        if ((d.dust || 0) < du) E('ผงไม่พอ (ต้องใช้ ' + du + ')'); if (d.gems < gem) E('Gem ไม่พอ (ต้องใช้ ' + gem + ')');
        d.gems -= gem; d.dust = (d.dust || 0) - du; add(d, { id, r });
        await qCh(); qAdd(d, 'cr', 1);
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'me', me: prof(ws.user, d), note: '🔮 คราฟ ' + B[id].n.trim() + ' (' + r + ') สำเร็จ' })); return;
      }
      if (m.t === 'open') {
        const d = await dbGet(ws.user), n = m.n === 10 ? 10 : 1, cc = isCC(String(m.set)), cost = (n === 10 ? 900 : 100) * (cc ? 2 : 1);
        if (!SETS.includes(m.set)) E('ไม่มีชุดนี้'); if (d.gems < cost) E('Gem ไม่พอ'); d.gems -= cost;
        const ps = []; const pk = cc ? 'pityCC' : 'pity', lim = cc ? CC_PITY : 50; for (let k = 0; k < n; k++) { d[pk] = (d[pk] || 0) + 1; const p = pack(m.set, d[pk] >= lim); if (p.some(x => ['UR','SEC','PR','UBR','USEC'].includes(x.r))) d[pk] = 0; p.forEach(x => add(d, x)); ps.push(p); }
        await qCh(); qAdd(d, 'op', n);
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d) })); return;
      }
      if (m.t === 'code') { await codeLock(async () => { let SC;
        const d = await dbGet(ws.user), c = String(m.c || '').trim().toUpperCase();
        const K = { BOTFANMADE: { gems: 5555 }, SOCOOL: { art: 5 }, AMUJI: { gems: 111111 }, RATEDOWN: { gems: 555 }, SKINCARD: { gems: 2500 }, SKINBOARD: { gems: 2500 }, WUPDATE: { gems: 1000 }, DUST: { dust: 555 }, QUEST: { gems: 500, dust: 150 }, PROFILE: { art: 1 }, ...(SC = (await dbGet('sys:codes')) || {}) }, X = K[c]; if (!X) E('โค้ดผิด'); if (d.codes.includes(c)) E('ใช้แล้ว'); if (SC[c]) { if (X.exp && Date.now() > X.exp) E('โค้ดนี้หมดอายุแล้ว'); if (X.max > 0 && (X.u | 0) >= X.max) E('โค้ดนี้มีผู้รับครบจำนวนแล้ว'); X.u = (X.u | 0) + 1; await dbPut('sys:codes', SC); } d.codes.push(c);
        let ps = []; d.gems += X.gems || 0; d.dust = (d.dust || 0) + (X.dust || 0);
        if (X.art) { const A = []; CARDS.forEach(x => x.v.forEach(r => ['PR','UBR','SEC'].includes(r) && A.push({ id: x.id, r }))); const p = []; for (let k = 0; k < X.art; k++) { const x = pick(A); add(d, x); p.push(x); } for (let k = 0; k < p.length; k += 5) ps.push(p.slice(k, k + 5)); }
        await dbPut(ws.user, d); ws.send(JSON.stringify({ t: 'packs', ps, me: prof(ws.user, d), note: [X.gems ? 'ได้ ' + X.gems + ' Gem' : '', X.dust ? 'ได้ ' + X.dust + ' ผง' : ''].filter(Boolean).join(' · ') })); return;
      }); return;
      }
      if (m.t === 'bot') {
        if (rjRoom(ws.user)) E('มีเกมค้างอยู่ กดกลับเข้าเกมก่อน');
        Object.keys(rooms).filter(c => rooms[c].bot && !rooms[c].g && rooms[c].p[0] && rooms[c].p[0].name === ws.user).forEach(c => dropRoom(c));
        const lv = [1, 2, 3].includes(+m.lvl) ? +m.lvl : 2, code = 'BOT' + Math.random().toString(36).slice(2, 6).toUpperCase();
        const mkP = name => ({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], dk: [], life: [], lf: [], noCost: [] });
        r = rooms[code] = { p: [mkP(ws.user), mkP('บอท (' + BOT_LV[lv].n + ')')], g: null, code, exp: Date.now() + 18e5, cfg: { clock: 0, react: 0, ban: true }, bot: { lv, tried: new Set(), at: 0, fail: 0, tn: -1 } };
        i = 0; const bp = r.p[1], bd = botDeck(); bp.bot = 1; bp.eq = {}; bp.deck = shuf(bd.main.map(inst)); bp.life = shuf(bd.life.map(id => ({ ...inst(id), up: 0 })));
        r.p[0].ws = ws; { const ud = await dbGet(ws.user); r.p[0].eq = (ud && ud.eq) || {}; r.p[0].pic = (ud && ud.pic) || null; r.p[0].lv = ud ? pfLv(ud.pf && ud.pf.xp).lv : 1; }
        bc(r); return;
      }
      if (m.t === 'join') {
        const code = String(m.room || '').toUpperCase().slice(0, 8), name = ws.user;
        if (!code) E('ใส่รหัสห้อง');
        r = rooms[code];
        if (!r) { if (!m.create) E('ไม่พบห้อง'); r = rooms[code] = { p: [], g: null, code, exp: Date.now() + 18e4, cfg: { clock: [5,10,20].includes(+m.clock) ? +m.clock : 0, react: [10,20,30].includes(+m.react) ? +m.react : 0, ban: String(m.ban) !== '0' } }; }
        i = r.p.findIndex(p => p.name === name);
        if (i < 0) { if (r.p.length >= 2) E('ห้องเต็ม'); i = r.p.length; r.p.push({ name, deck: null, hand: [], hell: [], av: [], mg: [], co: [], dk: [], life: [], lf: [], noCost: [] }); }
        r.p[i].ws = ws; delete LOST[name]; { const ud = await dbGet(name); r.p[i].eq = (ud && ud.eq) || {}; r.p[i].pic = (ud && ud.pic) || null; r.p[i].lv = ud ? pfLv(ud.pf && ud.pf.xp).lv : 1; } if (r.p.length === 2) r.exp = 0; if (r.p[i].dc) { r.p[i].dc = null; if (r.g) log(r, '✔ ' + name + ' กลับมา'); } bc(r);
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
      } else if (m.t === 'evok' && r && r.g) { evAck(r, i); bc(r);
      } else if (r && r.g) { if (r.g.evw && !r.g.over && !['chat', 'surrender', 'dview'].includes(m.t)) E('รอป๊อปอัปปิดก่อน'); act(r, i, m); bc(r); settle(r).catch(() => { }); }
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
  'BT03-006': { ok: c => (symOf(c) === 'หุ่นยนต์' || also9(c, 'หุ่นยนต์')) && isCol(c, 'แดง'), msg: 'ยานเกราะผู้กล้า ใช้เป็น Cost ได้เฉพาะ Avatar หุ่นยนต์สีแดง' },
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
    fx({ k: 'scout', i, ids: seenAll.map(c => c.kd || c.id) }); log(r, '🔎 ' + me.name + ': สอดแนม ' + seenAll.length + ' ใบ');
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
    if (d && (symOf(d) === 'หุ่นยนต์' || also9(d, 'หุ่นยนต์'))) { vfx(a.u, 'shake'); vfx(d.u, 'burst', 'ทำลายเป้าหมาย', '#ef4444'); log(r, '💥 จ่างู: ทำลาย ' + nmOf(d)); destroyAv(r, d.u); } }
}
function weaponTrig03(r, c) {
  if (c.st !== 'Modification' || !c.n.startsWith('อาวุธหุ่นนักรบผู้กล้า')) return;
  bt8Weapon(r, c);
  allAv(r).forEach(({ i, x }) => { if (x.id === 'BT03-004' && x.us4 !== r.g.n && !noFx(r, x)) { x.us4 = r.g.n; draw(r, r.p[i], 1); vfx(x.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ไมเกรน: ' + r.p[i].name + ' จั่ว 1 ใบ'); } });
}
function rickyFx(r, f) {   // BT01-042 ริกกี้ นักปลอมแปลง (React): Avatar เราถูกทำลายจากการต่อสู้ → ยึด Avatar สภาพนอนของอีกฝ่ายมาถาวร + ไปเป็น Modification
  const c = f.c, i = f.i, p = r.p[i];
  if (c.tk || !r.g.inB || !B[c.id] || B[c.id].t !== 'Avatar') return;
  const h = p.hand.find(x => !x.tk && B[x.id].n.trim() === 'ริกกี้ นักปลอมแปลง');
  if (!h || (r.g.used[i] && r.g.used[i].React) || (r.g.noReact && r.g.noReact.who === i)) return;
  const T = () => r.p[1 - i].av.filter(a => a.tired && !protectedFrom(r, i, a, 1) && canPlaceAv(r, i, a)).map(a => a.u);
  r.g.q.unshift(() => { if (!p.hand.includes(h) || r.g.used[i].React || !T().length) return;
    ask(r, i, { yn: true, text: 'ริกกี้ นักปลอมแปลง: ' + nmOf(c) + ' ถูกทำลายจากการต่อสู้ — ใช้ React ยึด Avatar สภาพนอนของฝ่ายตรงข้ามมาถาวรไหม?', cb: y => { if (!y) return;
      ask(r, i, { text: 'เลือก Avatar สภาพนอนของฝ่ายตรงข้ามที่จะยึดมา', opts: T(), cancel: true, cb: us => { const t = find(r, us[0]); if (!t || !p.hand.includes(h)) return;
        if (!stealCard(r, i, t.c.u)) return;
        const hc = fromZone(r, i, 'hand', h.u); if (!hc) return; hc.at = t.c.u; p.mg.push(hc); r.g.used[i].React = 1; ev(r, hc.kd || hc.id, hc.ar);
        vfx(t.c.u, 'aura', '🎭 ยึดมาถาวร', '#38bdf8'); log(r, '🎭 ริกกี้ นักปลอมแปลง: ยึด ' + nmOf(t.c) + ' มาฝั่ง ' + p.name + ' (ถ้าริกกี้ถูกทำลาย Avatar กลับขึ้นมือเจ้าของ)'); } }); } }); });
}
function deathFx03(r, f) {
  const c = f.c, g = r.g, p = r.p[f.i];
  if (c.tk) return;
  deathFx04(r, f); bt4Death(r, f); bt5Death(r, f); bt7Death(r, f); bt8Death(r, f); ccDeath(r, f); cc2Death(r, f); rickyFx(r, f);
  if (c.id === 'BT03-020' && c.drac) { delete c.drac; c.rv = { n: g.n }; log(r, '🧛 แดรกคูลา: จะกลับมาในเทิร์นถัดไปของเรา ช่วง Battle Phase'); }
  if (c.id === 'BT03-014') r.g.q.push(() => { draw(r, p, 1); log(r, '✨ โอตะปุส คำสั่งเสีย: ' + p.name + ' จั่ว 1 ใบ'); });
}
function enterBattle03(r) {
  const g = r.g, i = g.turn, p = r.p[i]; bt6Bs(r);
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
    if (!me.av.some(a => (symOf(a) === 'หุ่นยนต์' || also9(a, 'หุ่นยนต์')) && nmOf(a).includes('ผู้กล้า'))) return;
    const c = op.deck[op.deck.length - 1]; if (!c) return;
    fx({ k: 'scout', i, ids: [c.kd || c.id] }); op.deck.pop();
    if (isAv(c)) { op.hell.push(c); log(r, '🔎 สอดแนม Deck ศัตรู: ' + B[c.id].n + ' เป็น Avatar → ลงนรก'); vfx(x.u, 'burst', 'ลงนรก', '#ef4444'); if (!op.deck.length) lose(r, 1 - i, 'เด็คหมด'); }
    else { op.deck.unshift(c); log(r, '🔎 สอดแนม Deck ศัตรู 1 ใบ → ไว้ใต้ Deck'); } },
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
  if (f && f.z === 'av') c -= r.p[1 - f.i].av.filter(a => a.id === 'BT03-029' && !noFx(r, a)).length; c -= r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && m.id === 'BT03-054').length, 0); c += 2 * r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && m.id === 'BT04-055').length, 0); c += bt9CostD(r, x, f, c); c += bt10CostD(r, x); return Math.max(0, c); };
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
    r.p[i].av.splice(r.p[i].av.indexOf(a), 1); r.p[1 - i].av.push(a); a.noatk = g.n; a.tired = false;
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
  if (B[x.id].n.includes('วานร') && r.p[f.i].av.some(a => a.id === 'BT05-034' && a.u !== x.u && !noFx(r, a))) v += r.p[f.i].av.filter(a => a.id === 'BT05-034' && a.u !== x.u && !noFx(r, a)).length;   // BT05-034
  v -= r.p[1 - f.i].av.filter(a => a.id === 'BT05-039' && !noFx(r, a)).length;   // BT05-039 Avatar ฝ่ายตรงข้ามทุกใบ -1
  v += r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && m.id === 'BT05-064').length, 0);   // BT05-064
  if (x.id === 'BT05-002' && !noFx(r, x)) v += r.p.flatMap(q => q.av).filter(a => a.u !== x.u && B[a.id].n.includes('แมลงปอ')).length;   // BT05-002
  if ((x.wr || []).some(w => w.id === 'BT05-007')) v += 1;   // BT05-007 ผู้สวมใส่ +1
  if (x.id === 'BT05-006' && x.tired && !noFx(r, x)) v += r.p[f.i].av.filter(a => a.u !== x.u && isPet(a)).length;   // BT05-006 ตราบเท่าที่นอน +1 ต่อ หมา/แมว {สัตว์} ใบอื่น
  { const nS = r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && m.id === 'BT03-051').length, 0); if (nS) v += nS * (nmOf(x).includes('หุ่นนักรบผู้กล้า') ? 3 : 1); }   // อีโบล่า ซอร์ด: สวมซ้ำหลายใบ POWER บวกซ้อนกัน
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
  const g = r.g; if (g.land) r.p[g.land.o].hell.push(g.land.c); g.land = { c: card, o: i }; g.used[i].Land = 1; ev(r, card.kd || card.id);
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
  'BT03-051': { mod: 1, tgf: a => (symOf(a) === 'หุ่นยนต์' || also9(a, 'หุ่นยนต์')) },
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

function fxSummon(r, i, x) { HAND_SRC = x; if (noFx(r, x)) return; if ((B[x.id].e || '').includes('จุติ') && odOn8(r, 1 - i, 'BT08-031')) return log(r, '💊 พูรินอล Overdose: จุติ ของ ' + nmOf(x) + ' ทำไม่ได้'); if (autoGuard(r, i, x, /จุติ/, () => fxSummon0(r, i, x))) return; fxSummon0(r, i, x); }
function deathFx(r, f, nf, s55) { if (!nf && B[f.c.id] && /คำสั่งเสีย/.test(B[f.c.id].e || '') && odOn8(r, 1 - f.i, 'BT08-031')) return log(r, '💊 พูรินอล Overdose: คำสั่งเสีย ของ ' + nmOf(f.c) + ' ทำไม่ได้'); if (!s55 && !nf && !f.c.tk && bt8Q055(r, f, () => deathFx(r, f, nf, true))) return; if (!nf && autoGuard(r, f.i, f.c, /คำสั่งเสีย/, () => deathFx0(r, f, nf))) return; deathFx0(r, f, nf); }
function fxAtk(r, i, a, tg, tk) { bt8Atk(r, i, a, tg, tk); if (noFx(r, a)) return; if (autoGuard(r, i, a, c => ATK_TRIG.has(c.id), () => fxAtk0(r, i, a, tg, tk))) return; fxAtk0(r, i, a, tg, tk); }

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
  if (primalSave(r, f, () => exileAv(r, u))) return;
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
    if (c.id === 'KD04-004' || (c.id === 'BT06-009' && c === a)) r.g.q.push(() => kdProto(r, wi, c));
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
    log(r, '🔎 สอดแนม ' + seen.length + ' ใบขึ้นมือ ผลรวม Cost ' + sum);
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
let BYP33 = 0;
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
    g.used[o].kd17 = 1; take(r, k.u); r.p[o].hell.push(k); ev(r, k.kd || k.id); fx({ k: 'say', id: k.kd || k.id, t: 'ยกเลิกผล React!' });
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
const otaOf = x => (x.wr || []).filter(w => B[w.id].n.includes('โอตะ') || w.nmo === 'โอตะ');
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
const kdUntarget = (r, owner, x) => (x.id === 'BT08-035' && !noFx(r, x) && r.p[owner].av.some(a => a.u !== x.u && isKP(a) && isCol(a, 'เขียว'))) || (x.id === 'BT05-038' && !noFx(r, x) && r.p[owner].av.some(a => a.id === 'BT05-054')) || (x.id === 'KD03-005' || x.id === 'BT04-009') && !noFx(r, x) && otaOf(x).length > 0 && r.p[owner].av.some(a => a.u !== x.u && isIdol(a) && B[a.id].n !== B[x.id].n);
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
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ'); seen.length && fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) });
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
  const p = r.p[wi]; if (!onAv(r, w.u)) return; const mig = p.deck.find(c => c.kd === 'KD04-003' || (!c.tk && B[c.id].n.trim() === 'หุ่นนักรบผู้กล้า : ไมเกรน')); if (!mig) return;
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
const isAnimal = x => symOf(x) === 'สัตว์' || (x.id === 'BT09-007' && !x.tk) || ((x.id === 'BT04-007' || x.id === 'BT06-017') && !x.tk);   // BT04-007: เป็น Symbol สัตว์ ด้วย
const BT4A = {
  'BT04-002': (r, i, a) => {   // ครูสงบ: ประกาศโจมตี → ทำลาย Modification ฝ่ายตรงข้าม 1 ใบ
    const L = r.p[1 - i].mg.filter(m => B[m.id].st === 'Modification').map(m => m.u); if (!L.length) return;
    ask(r, i, { text: 'ครูสงบ: เลือก Modification Magic ของฝ่ายตรงข้าม 1 ใบ ทำลาย (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => {
      fx({ k: 'say', id: a.id, t: 'ทำลาย Modification' }); vfx(a.u, 'shake', 'ทำลาย Modification', '#ef4444'); log(r, '💥 ครูสงบ: ทำลาย Modification ของฝ่ายตรงข้าม'); destroyAny(r, us[0]);
    } });
  },
};
function bt4Atk(r, i, a, tg, tk) { bt10AtkAny(r, i, a, tg, tk); if (noFx(r, a)) return; const f = BT4A[a.id] || (a.id === 'BT08-023' && a.gain8 && BT4A[a.gain8]); f && f(r, i, a, tg, tk); }
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
    const F = () => p.hell.filter(c => isAv(c) && (symOf(c) === 'ปลา' || also9(c, 'ปลา'))).map(c => c.u);
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
        p.hand.splice(p.hand.indexOf(h), 1); p.hell.push(h); r.g.used[f.i].React = 1; ev(r, h.kd || h.id); log(r, p.name + ' ใช้ React: เอาไปอยู่ด้วย');
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
  log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ'); seen.length && fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) });
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
  if (pc.id === 'BT04-023' && isCol(summoned, 'ม่วง')) r.g.q.push(() => { const s = bt4Peek(r, i, 1, null), c = s[0]; if (!c) return;
    ask(r, i, { text: 'วิไลวรรณ: ' + B[c.id].n + ' — วางไว้บนสุดของ Deck หรือส่งลงนรก?', choices: ['ไว้บนสุด', 'ส่งลงนรก'], cb: k => { if (k === 1) { const q = p.deck.indexOf(c); if (q >= 0) { p.deck.splice(q, 1); p.hell.push(c); log(r, '🕳 ส่ง ' + B[c.id].n + ' ลงนรก'); } } } }); });
  if (pc.id === 'BT04-035' && isPet(summoned)) r.g.q.push(() => ask(r, i, { text: 'แฟรงกี้: เลือก Avatar {สัตว์} 1 ใบ POWER +2 จนจบเทิร์น', opts: animalAv(r, i), cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, 2); vfx(t.c.u, 'aura', 'POWER +2', '#22c55e'); } } }));
}
function bt4End(r, prev) {   // End Phase: เสามงคล + ล้างธง
  r.p.forEach(q => q.av.forEach(a => { delete a.sw; })); bt5End(r, prev);
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
  'BT05-058': 'KD02-017', 'BT05-070': 'KD04-016', 'BT05-071': 'KD02-024', 'BT05-072': 'KD04-022', 'BT05-073': 'KD02-023', 'BT05-074': 'SD08-021', 'BT05-075': 'KD01-025', 'PRMO-100': 'KD02-017', 'SL02-007': 'KD02-017',   // อย่าให้มีครั้งที่ 2 (ฉบับพิมพ์ซ้ำ)
  'ODY1-069': 'SD05-020', 'PRMO-056': 'SD05-020', 'SL01-006': 'SD05-020', 'CC02-061': 'SD05-020' });   // ชายจากอนาคต (ฉบับพิมพ์ซ้ำ)
CARDS.forEach(c => { if (!/^(PRMO|FPRO|ODY1|CC0)/.test(c.id) || CANON[c.id]) return; const t = CARDS.find(o => o.id.startsWith('BT04-') && o.n === c.n && o.e === c.e && o.t === c.t && o.c === c.c && o.p === c.p && o.s === c.s); if (t) CANON[c.id] = CANON[t.id] || t.id; });   // พิมพ์ซ้ำ (PRMO ฯลฯ) ที่ข้อความเหมือน BT04 ทุกตัวอักษร ใช้สกิลเดียวกัน
{ const w = d => { if (d.__w) return; d.__w = 1; if (d.steps) d.steps = d.steps.map(s => ({ ...s, opts: (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return s.opts(...a); } finally { MGX--; MGWHO = o; } } })); if (d.run) { const f = d.run; d.run = (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return f(...a); } finally { MGX--; MGWHO = o; } }; } };   // 016 ริกกี้ คุณตา: ไม่รับผลจาก Magic ฝ่ายตรงข้าม
  Object.keys(MG).forEach(k => w(MG[k])); }

/* ===== BOT: โหมดเล่นกับบอท (ง่าย/กลาง/ยาก) =====
   บอทเป็นผู้เล่นฝั่ง 2 ที่ไม่มี WebSocket รันในเซิร์ฟเวอร์ และสั่งงานผ่าน act() ตัวเดียวกับผู้เล่นจริง
   จึงถูกบังคับด้วยกฎเกมชุดเดียวกัน (ถ้า act() โยน error บอทจะลองทางเลือกสำรองแทน) */
const BOT_LV = { 1: { n: 'ง่าย', win: 30 }, 2: { n: 'กลาง', win: 50 }, 3: { n: 'ยาก', win: 80 } }, BOT_LOSE = 10;

/* ===== BT05 รอบ 1: Avatar แดง/ฟ้า ===== */
function bt5Paid(r, i, pc, summoned) {   // 008 / 009 / 019: ถูกจ่ายเป็น Cost
  const p = r.p[i];
  if (pc.id === 'BT05-008' && isCol(summoned, 'แดง')) { addTp(summoned, 1); vfx(summoned.u, 'aura', 'POWER +1', '#ef4444'); fx({ k: 'say', id: pc.id, t: 'POWER +1' }); log(r, '✨ โจอี้ นักบอลขาหัก: ' + nmOf(summoned) + ' POWER +1 จนจบเทิร์น'); }
  if (pc.id === 'BT05-009' && symOf(summoned) === 'เปรต') { summoned.mgImm = r.g.n + 1; vfx(summoned.u, 'aura', '🛡 ไม่ถูกนำออกด้วย Magic', '#f472b6'); fx({ k: 'say', id: pc.id, t: 'ไม่ถูกนำออกจากสนาม' }); log(r, '🛡 น้องส้ม ชู้วันชัย: ' + nmOf(summoned) + ' ไม่ถูกนำออกจากสนามด้วย Magic จนจบเทิร์นถัดไปของฝ่ายตรงข้าม'); }
  if (pc.id === 'BT05-042' && isCol(summoned, 'เขียว')) { summoned.mgProt = r.g.n + 1; vfx(summoned.u, 'aura', '🛡 ไม่รับผล Magic ศัตรู', '#22c55e'); fx({ k: 'say', id: pc.id, t: 'ไม่รับผล Magic' }); log(r, '🛡 วีรชนชีวภาพ: ' + nmOf(summoned) + ' ไม่รับผลจาก Magic ฝ่ายตรงข้าม จนจบเทิร์นถัดไปของฝ่ายตรงข้าม'); }
  if (pc.id === 'BT05-019' && isCol(summoned, 'ฟ้า')) r.g.q.push(() => { const s = bt4Peek(r, i, 1, null), c = s[0]; if (!c) return;
    if (isAv(c) && symOf(c) === symOf(summoned)) { p.deck.splice(p.deck.indexOf(c), 1); p.hand.push(c); vfx(summoned.u, 'aura', 'สอดแนม → ขึ้นมือ', '#22c55e'); log(r, '✨ บอสทุเรียน: ' + B[c.id].n + ' Symbol ตรงกัน ขึ้นมือ'); } else log(r, 'บอสทุเรียน: ' + B[c.id].n + ' ไม่ใช่ Avatar Symbol เดียวกัน วางไว้ที่เดิม'); });
}
const isCol = (x, col) => colOf(x) === col || (x.id === 'BT09-006' && col === 'ม่วง') || x.id === 'BT05-016' || (x.id === 'BT08-020' && col === 'ม่วง') || (x.id === 'BT10-011' && col === 'เขียว') || (x.id === 'BT10-022' && col === 'แดง');   // BT05-016 โคลัมบัส ถือเป็น Avatar ทุกสี
const isKnight = c => isAv(c) && B[c.id].n.includes('อัศวินโต๊ะกลม');
Object.assign(SUM, {
  'BT05-003': (r, i, x) => {   // เบดิเวียร์
    const p = r.p[i], sw = p.deck.find(c => !c.tk && B[c.id].t === 'Magic' && B[c.id].n.trim().startsWith('ดาบศักดิ์สิทธิ์'));   // ชื่อจริงมีต่อท้าย เช่น ดาบศักดิ์สิทธิ์ เอกซ์คาลิเบอร์
    if (sw) { p.deck.splice(p.deck.indexOf(sw), 1); p.hell.push(sw); vfx(x.u, 'aura', '🗡 ส่ง ดาบศักดิ์สิทธิ์ ลงนรก', '#f97316'); log(r, '✨ เบดิเวียร์: ส่ง ดาบศักดิ์สิทธิ์ จาก Deck ลงนรก'); } else log(r, 'จุติ เบดิเวียร์: ไม่พบ ดาบศักดิ์สิทธิ์ ใน Deck');
    shuf(p.deck); addTp(x, 1);
    const K = p.hell.filter(isKnight).map(c => c.u); vfx(x.u, 'aura', 'POWER +1', '#f97316');
    if (K.length) ask(r, i, { text: 'จุติ: เลือก Avatar "อัศวินโต๊ะกลม" จากนรก วางไว้บนสุดของ Deck (ยกเลิก = ไม่ใช้)', opts: K, cancel: true, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return; p.deck.push(c); log(r, '⬆ เบดิเวียร์: วาง ' + B[c.id].n + ' ไว้บนสุดของ Deck'); } });
  },
  'BT05-014': (r, i, x) => {   // ลานเซลอต
    const p = r.p[i], seen = bt4Peek(r, i, 2, x), K = seen.filter(isKnight).map(c => c.u);
    if (!K.length) { shuf(p.deck); return log(r, 'จุติ ลานเซลอต: ไม่พบ อัศวินโต๊ะกลม'); }
    ask(r, i, { text: 'สอดแนม: เลือก Avatar "อัศวินโต๊ะกลม" 1 ใบ อัญเชิญลงสนาม', opts: K, cb: us => {
      const c = p.deck.find(k => k.u === us[0]); if (c && summonAny(r, i, c.u, 'deck', x)) { vfx(c.u, 'burst', 'อัญเชิญ', '#38bdf8');
        if (isCol(c, 'แดง')) { p.av.filter(isKnight).forEach(a => { addTp(a, 1); vfx(a.u, 'aura', 'POWER +1', '#ef4444'); }); log(r, '🔥 ลานเซลอต: อัศวินโต๊ะกลมทุกใบ POWER +1 จนจบเทิร์น'); }
        else if (isCol(c, 'ฟ้า')) { draw(r, p, 1); vfx(x.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ ลานเซลอต: จั่ว 1 ใบ'); } }
      shuf(p.deck); } });
  },
  'BT05-020': (r, i, x) => {   // บึงทมิฬ
    const p = r.p[i], O = p.av.filter(a => a.u !== x.u && isAv(a) && (symOf(a) === 'ปลา' || also9(a, 'ปลา'))).map(a => a.u);
    if (!O.length) return log(r, 'จุติ บึงทมิฬ: ไม่มี Avatar {ปลา} ใบอื่นบนสนาม');
    ask(r, i, { text: 'จุติ: นำ Avatar {ปลา} ใบอื่น 1 ใบ กลับเข้าใต้ Deck เพื่อสอดแนม 5 ใบ (ยกเลิก = ไม่ใช้)', opts: O, cancel: true, cb: us => {
      const t = take(r, us[0]); p.deck.unshift(t.c); vfx(x.u, 'aura', 'ปลา กลับใต้ Deck', '#38bdf8'); log(r, '⬇ บึงทมิฬ: นำ ' + nmOf(t.c) + ' กลับเข้าใต้ Deck');
      r.g.q.unshift(() => { const seen = bt4Peek(r, i, 5, x), F = seen.filter(c => isAv(c) && (symOf(c) === 'ปลา' || also9(c, 'ปลา'))).map(c => c.u);
        const rest = () => { const R = seen.filter(c => p.deck.includes(c)); R.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...R); log(r, '⬇ บึงทมิฬ: นำการ์ดที่เหลือไว้ใต้ Deck'); };
        if (!F.length) return rest();
        ask(r, i, { text: 'สอดแนม: เลือก Avatar {ปลา} สูงสุด 2 ใบ อัญเชิญลงสนาม', opts: F, n: 2, min: 0, cb: us2 => { us2.forEach(u => { if (summonAny(r, i, u, 'deck', x)) vfx(u, 'burst', 'อัญเชิญ', '#38bdf8'); }); rest(); } }); }); } });
  },
  'BT05-022': (r, i, x) => {   // แมว-น้ำมะลิ
    const p = r.p[i], seen = bt4Peek(r, i, 3, x), O = seen.filter(isPet).map(c => c.u);
    if (!O.length) { shuf(p.deck); return log(r, 'จุติ แมว-น้ำมะลิ: ไม่พบ หมา/แมว {สัตว์}'); }
    ask(r, i, { text: 'สอดแนม: เลือก Avatar "หมา"/"แมว" {สัตว์} 1 ใบ ขึ้นมือ', opts: O, cb: us => {
      const c = p.deck.find(k => k.u === us[0]); if (c) {
        if (nmOf(c) === 'หมานมเย็น' && summonAny(r, i, c.u, 'deck', x)) { vfx(c.u, 'burst', 'อัญเชิญ จุติ', '#f59e0b'); r.g.q.unshift(() => fxSummon(r, i, c)); }
        else { p.deck.splice(p.deck.indexOf(c), 1); p.hand.push(c); vfx(x.u, 'aura', 'ขึ้นมือ', '#f59e0b'); log(r, '✨ แมว-น้ำมะลิ: นำ ' + B[c.id].n + ' ขึ้นมือ'); } }
      shuf(p.deck); } });
  },
});
Object.assign(AB, {
  'BT05-005': { z: 'av', steps: [], run: (r, i, cx) => {   // เทพารักษ์งมขวาน
    const p = r.p[i], L = p.hell.filter(c => !c.tk && B[c.id].t === 'Magic' && B[c.id].st === 'Modification' && B[c.id].n.trim() === 'ขวาน').map(c => c.u);
    if (!L.length) return log(r, 'เทพารักษ์งมขวาน: ไม่มี Modification Magic "ขวาน" ในนรก');
    ask(r, i, { text: 'เลือก Modification Magic "ขวาน" จากนรก 1 ใบ ขึ้นมือ', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.hand.push(c); vfx(cx.card.u, 'aura', 'งมขวาน → ขึ้นมือ', '#38bdf8'); log(r, '✨ เทพารักษ์งมขวาน: นำ ขวาน จากนรกขึ้นมือ'); } } }); } },
});

function bt5End(r, prev) { const q = r.p[prev]; q.hand.filter(c => c.stl).forEach(c => { q.hand.splice(q.hand.indexOf(c), 1); delete c.stl; r.p[1 - prev].hand.push(c); log(r, '↩ รับซื้อของโจร: คืน ' + B[c.id].n + ' ให้ ' + r.p[1 - prev].name); }); if (q.b5up && q.b5up.length) { q.b5up.forEach(l => { if (q.life.includes(l)) l.up = 0; }); fx({ k: 'life', i: prev }); log(r, '🔻 น้องนาว: คว่ำ LIFE ที่หงายด้วยความสามารถ ' + q.b5up.length + ' ใบ'); } q.b5up = []; }
Object.assign(SUM, {
  'BT05-007': (r, i, x) => {   // โฟเบีย
    const p = r.p[i], need = ['โดรนสอดแนมผู้กล้า : เก๊าท์', 'ยานเกราะผู้กล้า : ไดบาเรีย', 'อากาศยานผู้กล้า : แอร์ซิด รีฟลักซ์'];
    const chk = () => { const pk = need.map(n => p.hell.find(h => !h.tk && B[h.id].n.trim() === n)), mg = p.deck.find(c => !c.tk && B[c.id].t === 'Avatar' && B[c.id].n.trim() === 'หุ่นนักรบผู้กล้า : ไมเกรน' && B[c.id].c <= 5); return pk.every(Boolean) && mg ? { pk, mg } : null; };
    if (!chk()) return log(r, 'จุติ โฟเบีย: เงื่อนไขไม่ครบ (ต้องมี เก๊าท์/ไดบาเรีย/แอร์ซิด รีฟลักซ์ ในนรก และ ไมเกรน Cost ≤5 ใน Deck)');
    ask(r, i, { yn: true, text: 'จุติ โฟเบีย: นำ เก๊าท์ + ไดบาเรีย + แอร์ซิด รีฟลักซ์ จากนรกกลับ Deck เพื่ออัญเชิญ ไมเกรน แล้วสวมใส่ โฟเบีย ไหม?', cb: y => {
      const o = y && chk(); if (!o) return;
      o.pk.forEach(c => { p.hell.splice(p.hell.indexOf(c), 1); p.deck.push(c); });
      if (summonAny(r, i, o.mg.u, 'deck', x)) { shuf(p.deck); const t = find(r, o.mg.u), me = find(r, x.u); vfx(o.mg.u, 'burst', 'อัญเชิญ', '#38bdf8');
        if (t && me && me.z === 'av') { const w = take(r, x.u); wearOn(r, i, t.c, w.c); vfx(t.c.u, 'aura', 'POWER +1 (โฟเบีย)', '#f87171'); } }
      else shuf(p.deck); } });
  },
});
Object.assign(AB, {
  'BT05-002': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.u !== c.u && B[a.id].n.includes('แมลงปอ')),
    steps: [{ key: 'c', text: 'เซ่นไหว้ Avatar "แมลงปอ" ใบอื่น 1 ใบ', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && B[a.id].n.includes('แมลงปอ')).map(a => a.u) }],
    run: (r, i, cx) => { const p = r.p[i], f = sac(r, cx.pick.c[0]); if (!f) return; const nm = B[f.c.id].n;
      r.g.q.unshift(() => { const L = p.hell.filter(h => !h.tk && B[h.id].t === 'Avatar' && B[h.id].n.includes('แมลงปอ') && B[h.id].n !== nm).map(h => h.u); if (!L.length) return log(r, 'แมลงปอนางพญา: ไม่มี Avatar "แมลงปอ" ชื่อไม่ซ้ำในนรก');
        ask(r, i, { text: 'เลือก Avatar "แมลงปอ" ที่ชื่อไม่ซ้ำ จากนรก อัญเชิญ จุติ', opts: L, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'hell', cx.card)) { vfx(c.u, 'burst', 'อัญเชิญ จุติ', '#f97316'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); }); } },
  'BT05-010': { z: 'av', can: (r, i) => r.p[i].life.some(l => !l.up), steps: [],
    run: (r, i, cx) => { const q = r.p[i], free = q.life.filter(l => !l.up).length;
      const go = n => { const before = q.life.filter(l => !l.up); for (let k = 0; k < n; k++) lifeUp(r, i); const fl = before.filter(l => l.up); q.b5up = (q.b5up || []).concat(fl); vfx(cx.card.u, 'aura', '❤ หงาย LIFE ' + fl.length, '#f472b6'); };
      if (free < 2) return go(1);
      ask(r, i, { text: 'น้องนาว: หงาย LIFE กี่ใบ (คว่ำกลับเมื่อจบเทิร์น)', choices: ['1 ใบ', '2 ใบ'], cb: k => go(k + 1) }); } },
});

/* ===== BT05 รอบ 2: Avatar ม่วง/เขียว ===== */
const isOta = c => c.nmo === 'โอตะ' || B[c.id].n.includes('โอตะ');
function bt5Death(r, f) {   // คำสั่งเสีย 023 / 029
  const c = f.c, p = r.p[f.i];
  { const A = r.g.curAtk; if (r.g.inB && A && !c.tk) { const ai = r.p.findIndex(q => q.av.includes(A)); if (ai >= 0 && ai !== f.i && r.p.some(q => q.mg.some(m => m.at === A.u && m.id === 'BT05-065'))) r.g.q.push(() => { if (r.p[f.i].av.length && A.tired) { A.tired = false; vfx(A.u, 'aura', 'ตื่น!', '#38bdf8'); log(r, '⚔ กระบองแสง: ' + nmOf(A) + ' กลับเป็นสภาพตื่น'); } }); } }
  if (c.tk) return;
  if (c.id === 'BT05-023') r.g.q.push(() => { draw(r, p, 1); fx({ k: 'say', id: c.id, t: 'จั่ว 1' }); log(r, '✨ นักรบ ฮอล คำสั่งเสีย: ' + p.name + ' จั่ว 1 ใบ'); });
  if (c.id === 'BT05-029') r.g.q.push(() => scout(r, f.i, 5, { text: 'คำสั่งเสีย จาบับวา: เลือก Avatar {คน} 1 ใบ ขึ้นมือ', pred: x => isAv(x) && symOf(x) === 'คน', rest: 'bottom', by: c, then: x => { if (x) { p.hand.push(x); log(r, '✨ จาบับวา: นำ ' + B[x.id].n + ' ขึ้นมือ'); } } }));
}
Object.assign(SUM, {
  'BT05-024': (r, i, x) => {   // มีมมิ
    const p = r.p[i]; if (!p.av.some(a => B[a.id].n.includes('แดรกคูลา'))) return log(r, 'จุติ มีมมิ: ไม่มี แดรกคูลา บน Avatar Zone');
    const m = p.deck.find(c => !c.tk && B[c.id].t === 'Magic' && B[c.id].n.trim() === 'ปราสาทแดรก');
    if (m) { p.deck.splice(p.deck.indexOf(m), 1); p.hand.push(m); vfx(x.u, 'aura', '🏰 ปราสาทแดรก ขึ้นมือ', '#a855f7'); log(r, '✨ มีมมิ: นำ ปราสาทแดรก ขึ้นมือ'); } else log(r, 'มีมมิ: ไม่พบ ปราสาทแดรก ใน Deck');
    shuf(p.deck);
  },
  'BT05-025': (r, i, x) => {   // เฟรย่า (พอดี)
    if (!x.jt) return log(r, 'เฟรย่า: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i], L = p.hell.filter(h => !h.tk && isAv(h) && symOf(h) === 'เทพ' && colOf(h) === 'ม่วง').map(h => h.u);
    if (L.length < 3) return log(r, 'จุติ เฟรย่า: ในนรกมี Avatar {เทพ} สีม่วงไม่ครบ 3 ใบ');
    ask(r, i, { text: 'จุติ (พอดี): เลือก Avatar {เทพ} สีม่วง 3 ใบ จากนรก กลับเข้า Deck แล้วจั่ว 1 ใบ', opts: L, n: 3, min: 3, cancel: true, cb: us => { us.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c) p.deck.push(c); }); shuf(p.deck); draw(r, p, 1); vfx(x.u, 'aura', '3 ใบกลับ Deck + จั่ว 1', '#a855f7'); log(r, '✨ เฟรย่า: นำ 3 ใบกลับ Deck แล้วจั่ว 1 ใบ'); } });
  },
  'BT05-031': (r, i, x) => {   // ทัตดนัยซัง (พอดี)
    if (!x.jt) return log(r, 'ทัตดนัยซัง: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i], op = r.p[1 - i], idols = () => p.av.filter(a => isIdol(a)).map(a => a.u), T = allAvT(r, i).filter(u => op.av.some(a => a.u === u));
    if (!T.length || !idols().length) return log(r, 'จุติ ทัตดนัยซัง: ไม่มีเป้าหมาย หรือไม่มี Avatar "ไอดอล" ของเรา');
    ask(r, i, { text: 'จุติ: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ เปลี่ยนชื่อเป็น "โอตะ" แล้วสวมใส่ให้ Avatar "ไอดอล" ของเรา', opts: T, cb: us => { const tf = find(r, us[0]), I = idols(); if (!tf || !I.length) return;
      ask(r, i, { text: 'เลือก Avatar "ไอดอล" ที่จะสวมใส่ให้', opts: I, cb: us2 => { const idl = find(r, us2[0]); if (!idl) return; const w = take(r, tf.c.u); w.c.nmo = 'โอตะ'; wearOn(r, i, idl.c, w.c); vfx(idl.c.u, 'aura', '🎀 โอตะ!', '#f472b6'); fx({ k: 'say', id: 'BT05-031', t: 'ปั้นโอตะ' });
        if (p.av.some(a => a.id === 'BT05-043')) { const D = p.deck.filter(c => isAv(c) && B[c.id].n.includes('ไอดอล')).map(c => c.u); if (D.length) ask(r, i, { text: 'มยุราซัง: เลือก Avatar "ไอดอล" จาก Deck ขึ้นมือ (ยกเลิก = ไม่เอา)', opts: D, cancel: true, cb: us3 => { const c = fromZone(r, i, 'deck', us3[0]); if (c) { p.hand.push(c); log(r, '✨ นำ ' + B[c.id].n + ' ขึ้นมือ'); } shuf(p.deck); } }); } } }); } });
  },
  'BT05-033': (r, i, x) => {   // ลุงไนท์ ราชาวานร
    const p = r.p[i], seen = bt4Peek(r, i, 5, x), O = seen.filter(c => isAv(c) && B[c.id].n.includes('วานร') && B[c.id].c <= 4).map(c => c.u);
    const rest = () => { const R = seen.filter(c => p.deck.includes(c)); R.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...R); log(r, '⬇ ลุงไนท์: นำการ์ดที่เหลือไว้ใต้ Deck'); };
    if (!O.length) return rest();
    ask(r, i, { text: 'สอดแนม: เลือก Avatar "วานร" Cost ≤ 4 อัญเชิญลงสนาม', opts: O, cb: us => { const c = p.deck.find(k => k.u === us[0]); if (c && summonAny(r, i, c.u, 'deck', x)) vfx(c.u, 'burst', 'อัญเชิญ', '#22c55e'); rest(); } });
  },
  'BT05-035': (r, i, x) => {   // คุณเชิดชัย Super Air
    const p = r.p[i], seen = bt4Peek(r, i, 5, x), isM = c => !c.tk && B[c.id].t === 'Magic' && ['เครื่องบิน Super Air', 'รหัสดำ'].includes(B[c.id].n.trim()), isA = c => isAv(c) && B[c.id].n.includes('Super Air') && symOf(c) === 'คน';
    const O = seen.filter(c => isM(c) || isA(c)).map(c => c.u);
    const rest = () => { const R = seen.filter(c => p.deck.includes(c)); R.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...R); log(r, '⬇ นำการ์ดที่เหลือไว้ใต้ Deck'); };
    if (!O.length) return rest();
    ask(r, i, { text: 'สอดแนม: เลือก Magic เครื่องบิน Super Air/รหัสดำ 1 ใบ และ/หรือ Avatar "Super Air" {คน} 1 ใบ ขึ้นมือ', opts: O, n: 2, min: 0, cb: us => {
      let gm = false, ga = false; us.forEach(u => { const c = p.deck.find(k => k.u === u); if (!c) return; if (isM(c) && !gm) gm = true; else if (isA(c) && !ga) ga = true; else return; p.deck.splice(p.deck.indexOf(c), 1); p.hand.push(c); log(r, '✨ คุณเชิดชัย: นำ ' + B[c.id].n + ' ขึ้นมือ'); }); vfx(x.u, 'aura', 'สอดแนม → ขึ้นมือ', '#22c55e'); rest(); } });
  },
  'BT05-041': (r, i, x) => {   // จ่ายุทธ Tank Ranger
    const p = r.p[i], op = r.p[1 - i]; if (!p.av.some(isTank)) return;
    const T = op.av.filter(a => isAv(a) && (symOf(a) === 'ต่างชาติ' || also9(a, 'ต่างชาติ')) && !protectedFrom(r, i, a)).map(a => a.u); if (!T.length) return log(r, 'จุติ จ่ายุทธ: ไม่มี Avatar {ต่างชาติ} ฝ่ายตรงข้าม');
    ask(r, i, { text: 'จุติ: เลือก Avatar {ต่างชาติ} ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: T, cb: us => { vfx(us[0], 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, us[0]); } });
  },
});
Object.assign(AB, {
  'BT05-026': { z: 'av', steps: [{ key: 'a', text: 'เลือก Avatar {เทพ} สีม่วง 1 ใบ ใน Avatar Zone ของเรา (POWER เพิ่มตามจำนวนที่ธรณีสูบ)', opts: (r, i) => r.p[i].av.filter(a => !a.tk && isAv(a) && symOf(a) === 'เทพ' && colOf(a) === 'ม่วง').map(a => a.u) }],
    run: (r, i, cx) => { const p = r.p[i], mx = Math.min(5, p.deck.length); if (!mx) return log(r, 'เฮล่า: Deck ไม่เหลือให้ธรณีสูบ');
      ask(r, i, { text: 'เฮล่า: ธรณีสูบกี่ใบ (สูงสุด 5)', choices: Array.from({ length: mx }, (_, k) => (k + 1) + ' ใบ'), cb: k => { const n = k + 1, t = find(r, cx.pick.a[0]); mill(r, i, n, cx.card); if (t && t.z === 'av') { addTp(t.c, n); vfx(t.c.u, 'aura', 'POWER +' + n, '#7c3aed'); log(r, '💀 เฮล่า: ' + nmOf(t.c) + ' POWER +' + n + ' จนจบเทิร์น'); } } }); } },
  'BT05-028': { z: 'av', can: (r, i) => r.p[i].hand.length > 0, steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดจากบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], L = p.hell.map(c => c.u), fin = () => { draw(r, p, 1); vfx(cx.card.u, 'aura', 'จั่ว 1', '#a855f7'); };
      if (!L.length) return fin();
      ask(r, i, { text: 'เลือกการ์ดในนรก 1 ใบ นำกลับเข้าใต้ Deck', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.deck.unshift(c); log(r, '⬇ Ecycle: นำ ' + B[c.id].n + ' กลับเข้าใต้ Deck'); } fin(); } }); } },
  'BT05-030': { z: 'av', steps: [{ key: 'a', text: 'เลือก Avatar {สัตว์} ใน Avatar Zone ของเรา นำขึ้นมือ', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && symOf(a) === 'สัตว์').map(a => a.u) }],
    run: (r, i, cx) => { bounce(r, cx.pick.a[0]); if (cx.pick.a[0] !== cx.card.u) { addTp(cx.card, 2); vfx(cx.card.u, 'aura', 'POWER +2', '#a855f7'); log(r, '✨ หมาชาไทย: POWER +2'); } } },
  'BT05-036': { z: 'av', steps: [], run: (r, i, cx) => { const p = r.p[i], m = p.deck.find(c => !c.tk && B[c.id].t === 'Magic' && B[c.id].n.trim() === 'ตั๋วยืน');
    if (m) { p.deck.splice(p.deck.indexOf(m), 1); p.hand.push(m); vfx(cx.card.u, 'aura', '🎫 ตั๋วยืน ขึ้นมือ', '#22c55e'); log(r, '✨ กระเป๋าเครื่องบิน: นำ ตั๋วยืน ขึ้นมือ'); } else log(r, 'กระเป๋าเครื่องบิน: ไม่พบ ตั๋วยืน ใน Deck'); shuf(p.deck); } },
  'BT05-041': { ...wearUse },
  'BT05-043': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.u !== c.u && isIdol(a)),
    steps: [{ key: 't', text: 'เลือก Avatar "ไอดอล" ใบอื่น ที่จะสวมใส่ "โอตะ"', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && isIdol(a)).map(a => a.u) }],
    run: (r, i, cx) => { const p = r.p[i], t = find(r, cx.pick.t[0]); if (!t) return; const tat = p.av.some(a => a.id === 'BT05-031');
      const H = p.hell.filter(c => !c.tk && isAv(c) && isOta(c)).map(c => ({ u: c.u, z: 'hell' })), D = tat ? p.deck.filter(c => !c.tk && isAv(c) && isOta(c)).map(c => ({ u: c.u, z: 'deck' })) : [], all = H.concat(D);
      if (!all.length) return log(r, 'มยุราซัง: ไม่มี Avatar "โอตะ" ในนรก' + (tat ? '/Deck' : ''));
      ask(r, i, { text: 'เลือก Avatar "โอตะ" ' + (tat ? 'จากนรกหรือ Deck ' : 'จากนรก ') + 'มาสวมใส่ให้ ' + nmOf(t.c), opts: all.map(o => o.u), cb: us => { const o = all.find(q => q.u === us[0]), c = o && fromZone(r, i, o.z, o.u); if (!c) return; if (o.z === 'deck') shuf(p.deck); wearOn(r, i, t.c, c); vfx(t.c.u, 'aura', '🎀 สวมใส่ โอตะ', '#f472b6'); } }); } },
});

/* ===== BT05 รอบ 3: Magic / Land + ระบบ "ถูกนำขึ้นมือ" (generic) ===== */
let SEQ = 0, DRAWING = 0, HAND_SRC = null;
const HAND_HOOKS = [];   // fn(r, i, card, { src, fromDeck }) — ถูกเรียกทุกครั้งที่การ์ดถูกนำขึ้นมือโดยไม่ใช่การจั่ว (src = การ์ดต้นทางของความสามารถ ถ้ารู้)
function hookHand(p) {
  const arr = p.hand; if (arr.__hk) return; Object.defineProperty(arr, '__hk', { value: 1 }); const push = Array.prototype.push;
  Object.defineProperty(arr, 'push', { configurable: true, writable: true, value: function (...cs) {
    const n = push.apply(this, cs);
    if (!DRAWING && CR && CR.g && CR.g.phase !== 'dice') { const i = CR.p.findIndex(q => q.hand === this); if (i >= 0) cs.forEach(c => { const fd = c._fd === SEQ; delete c._fd; HAND_HOOKS.forEach(h => { try { h(CR, i, c, { src: HAND_SRC, fromDeck: fd }); } catch (e) { console.error('hand hook', e); } }); }); }
    return n; } });
}
function hookDeck(p) {
  const arr = p.deck; if (arr.__hk) return; Object.defineProperty(arr, '__hk', { value: 1 });
  const pop = Array.prototype.pop, splice = Array.prototype.splice;
  Object.defineProperty(arr, 'pop', { configurable: true, writable: true, value: function () { const c = pop.call(this); if (c) c._fd = SEQ; return c; } });
  Object.defineProperty(arr, 'splice', { configurable: true, writable: true, value: function (...a) { const out = splice.apply(this, a); out.forEach(c => { c._fd = SEQ; }); return out; } });
}
HAND_HOOKS.push((r, i, c, info) => {   // BT05-026 เฮล่า: ถูกนำขึ้นมือด้วย Avatar {เทพ} ม่วง → อัญเชิญฟรี (เงื่อนไขเดียวกับตอนถูกธรณีสูบ)
  if (c.id !== 'BT05-026' || !info.src) return; const ms = info.src, p = r.p[i];
  const pg = !ms.tk && isAv(ms) && symOf(ms) === 'เทพ' && colOf(ms) === 'ม่วง';
  if (pg && r.g.land && B[r.g.land.c.id].n.trim() === 'แอสการ์ดคือสถานที่ไม่ใช่ผู้คน' && p.av.some(a => !a.tk && isAv(a) && symOf(a) === 'เทพ' && colOf(a) === 'ม่วง'))
    r.g.q.unshift(() => { if (!p.hand.includes(c)) return; ask(r, i, { yn: true, text: 'เฮล่า ถูกนำขึ้นมือ (แอสการ์ดฯ อยู่บนสนาม): อัญเชิญทันทีโดยไม่ต้องจ่าย Cost ไหม?', cb: y => { if (y && p.hand.includes(c) && summonAny(r, i, c.u, 'hand')) { vfx(c.u, 'burst', 'เฮล่า มาแล้ว', '#7c3aed'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); });
});
HAND_HOOKS.push((r, i, c, info) => {   // BT05-060 เหน็บกินมือ: ฝ่ายตรงข้ามนำการ์ดจาก Deck ขึ้นมือด้วยความสามารถ → ยกเลิก
  if (!info.fromDeck || !info.src) return; const o = 1 - i, m = r.p[o].hand.find(x => x.id === 'BT05-060'); if (!m || (r.g.noReact && r.g.noReact.who === o)) return;
  r.g.q.unshift(() => { if (!r.p[i].hand.includes(c) || !r.p[o].hand.includes(m)) return;
    ask(r, o, { yn: true, text: 'เหน็บกินมือ: ' + r.p[i].name + ' นำ ' + B[c.id].n + ' จาก Deck ขึ้นมือด้วยความสามารถ — ใช้ยกเลิกไหม?', cb: y => { if (!y) return; const k = r.p[o].hand.indexOf(m), h = r.p[i].hand.indexOf(c); if (k < 0) return;
      r.p[o].hand.splice(k, 1); r.p[o].hell.push(m); if (h >= 0) { r.p[i].hand.splice(h, 1); r.p[i].deck.push(c); } vfx(m.u, 'burst', 'เหน็บกินมือ!', '#ef4444'); fx({ k: 'say', id: 'BT05-060', t: 'ยกเลิก' }); log(r, '🚫 เหน็บกินมือ: ยกเลิกการนำ ' + B[c.id].n + ' ขึ้นมือ (คืนบนสุด Deck)'); } }); });
});
const giantG0 = (c, d, me) => (c.t === 'Construct' && d.id === 'BT06-021') ? 5 : (CR && CR.g.land && CR.g.land.c.id === 'BT05-069' && CR.p[CR.g.land.o] === me && c.t === 'Avatar' && c.s === 'ยักษ์' && d.t === 'Avatar' && d.s === 'ยักษ์' && d.p > 0) ? d.p : 0;   // BT05-069
B['BT05-054A'] = { ...B['BT05-054'], id: 'BT05-054A', t: 'Avatar', st: null, s: 'หุ่นยนต์', c: 5, g: 0, p: 5, e: '' };
function noteSum(r, i, c) { ccNote(r, i, c); bt8Enter(r, i, c); const g = r.g; bt10Note(r, i, c); if (!g.sm5 || g.sm5.n !== g.n) g.sm5 = { n: g.n, o: [false, false] }; if (!B[c.id].n.includes('Super Air')) g.sm5.o[i] = true; }
const hell64OK = (r, i) => { const g = r.g, p = r.p[i]; return g.turn === i && g.phase === 'main' && !g.ask && !g.pend && !g.used[i].Modification && p.av.some(isKnight) && p.deck.length > 0; };
const restBottom = (r, i, seen) => { const p = r.p[i], R = seen.filter(c => p.deck.includes(c)); R.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...R); log(r, '⬇ นำการ์ดที่เหลือไว้ใต้ Deck'); };
const hasPlane = (r, i) => r.p[i].av.some(a => a.id === 'BT05-054A');
function bt5Sand(r) {   // BT05-068 ทรายดูด
  const L = r.g && r.g.land; if (!L || L.c.id !== 'BT05-068' || r.g.over || r.g.sand) return; r.g.sand = 1;
  try { r.p.forEach(q => q.av.slice().forEach(a => { if (P(r, a) === 0) { vfx(a.u, 'burst', '⏳ ทรายดูด', '#d97706'); log(r, '⏳ ทรายดูด: ' + nmOf(a) + ' POWER 0 ถูกทำลาย'); destroyAv(r, a.u); } })); } finally { r.g.sand = 0; }
}
const myAvs = (r, i) => r.p[i].av.map(a => a.u);
Object.assign(MG, {
  'BT05-049': { run: (r, i) => { const op = r.p[1 - i]; if (!op.hand.length) return log(r, 'รับซื้อของโจร: ฝ่ายตรงข้ามไม่มีการ์ดบนมือ'); const c = op.hand.splice(Math.floor(Math.random() * op.hand.length), 1)[0]; c.stl = 1; r.p[i].hand.push(c); vfx(c.u, 'burst', '🕵 ขโมย', '#f59e0b'); log(r, '🕵 รับซื้อของโจร: ' + r.p[i].name + ' สุ่มหยิบ ' + B[c.id].n + ' จากมือ ' + op.name + ' (ใช้เป็น Cost ได้เท่านั้น คืนเมื่อจบเทิร์น)'); } },
  'BT05-050': { run: (r, i) => { const p = r.p[i], seen = bt4Peek(r, i, 5, null), O = seen.filter(c => isAv(c) && (symOf(c) === 'ต่างชาติ' || also9(c, 'ต่างชาติ'))).map(c => c.u);
    if (!O.length) return restBottom(r, i, seen);
    ask(r, i, { text: 'สอดแนม: เลือก Avatar {ต่างชาติ} 1 ใบ ขึ้นมือ', opts: O, cb: us => { const c = p.deck.find(k => k.u === us[0]); if (!c) return restBottom(r, i, seen);
      const fin = field => { if (field && summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); } else { p.deck.splice(p.deck.indexOf(c), 1); p.hand.push(c); } restBottom(r, i, seen); };
      if (B[c.id].c <= 2 && canPlaceAv(r, i, c)) ask(r, i, { yn: true, text: 'Cost ≤ 2: อัญเชิญ ' + B[c.id].n + ' ลง Avatar Zone แทนการขึ้นมือไหม?', cb: y => fin(y) }); else fin(false); } }); } },
  'BT05-051': { steps: [{ key: 't', text: 'เลือก Avatar ที่อยู่ในสภาพนอน 1 ใบ นำกลับเข้า Deck', opts: (r, i) => allAvT(r, i).filter(u => { const f = find(r, u); return f && f.c.tired; }) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; const o = r.p[t.i], w = take(r, t.c.u); if (!w.c.tk) { o.deck.push(w.c); shuf(o.deck); draw(r, o, 1); vfx(w.c.u, 'burst', 'ไปนอนใน Deck', '#a855f7'); log(r, '😴 ง่วงมากก็ไปนอน: ' + nmOf(w.c) + ' กลับเข้า Deck — ' + o.name + ' จั่ว 1'); } } },
  'BT05-052': { steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i, cx) => r.p[i].hand.filter(c => !cx || !cx.card || c.u !== cx.card.u).map(c => c.u) }],
    run: (r, i) => { const p = r.p[i]; if (!p.deck.length) return; const c = p.deck[Math.floor(Math.random() * p.deck.length)]; vfx(c.u, 'aura', '👻 Jump Scare', '#a855f7');
      if (isAv(c) && B[c.id].c <= 5) { if (summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); log(r, '👻 Jump Scare: สุ่มได้ ' + B[c.id].n + ' อัญเชิญลงสนาม'); } }
      else if (!isAv(c)) { p.deck.splice(p.deck.indexOf(c), 1); p.hell.push(c); log(r, '👻 Jump Scare: สุ่มได้ ' + B[c.id].n + ' ไม่ใช่ Avatar ลงนรก'); }
      else log(r, '👻 Jump Scare: สุ่มได้ ' + B[c.id].n + ' Cost เกิน 5 ไม่เกิดผล');
      shuf(p.deck); } },
  'BT05-053': { cond: (r, i) => r.p[1 - i].av.length >= 5, run: (r, i) => { const L = r.p[1 - i].av.slice(); vfx(L[0] && L[0].u, 'burst', '🎰 บ่อนแตก!', '#ef4444'); log(r, '🎰 บ่อนแตก: ทำลาย Avatar ทุกใบของฝ่ายตรงข้าม'); L.forEach(a => destroyAv(r, a.u)); } },
  'BT05-054': { cond: (r, i) => { const g = r.g; return !(g.sm5 && g.sm5.n === g.n && g.sm5.o[i]) && r.p[i].av.length < 6; },
    run: (r, i, cx) => { const p = r.p[i], c = fromZone(r, i, 'hell', cx.card.u); if (!c) return; c.id = 'BT05-054A'; c.kd = 'BT05-054';
      if (!canPlaceAv(r, i, c)) { c.id = 'BT05-054'; delete c.kd; p.hell.push(c); return log(r, '✈ เครื่องบิน Super Air: Avatar Zone เต็ม'); }
      putAv(r, i, c, { tired: false }); r.g.sa5 = { i, n: r.g.n }; vfx(c.u, 'burst', '✈ เครื่องบินขึ้นบิน!', '#22c55e'); fx({ k: 'say', id: 'BT05-054', t: 'Super Air' }); log(r, '✈ เครื่องบิน Super Air: เปลี่ยนเป็น Avatar {หุ่นยนต์} Cost 5 POWER 5 — เทิร์นนี้อัญเชิญได้เฉพาะ "Super Air"'); } },
  'BT05-055': { cond: (r, i) => hasPlane(r, i), steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i, cx) => r.p[i].hand.filter(c => !cx || !cx.card || c.u !== cx.card.u).map(c => c.u) }],
    run: (r, i) => { const p = r.p[i]; let n = 0; for (let k = 0; k < 2; k++) { const c = p.deck.find(x => isAv(x) && B[x.id].n.trim() === 'ผู้โดยสาร Super Air'); if (c && summonAny(r, i, c.u, 'deck')) { n++; vfx(c.u, 'burst', 'อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } shuf(p.deck); log(r, '🎫 ตั๋วยืน: อัญเชิญ ผู้โดยสาร Super Air ' + n + ' ใบ'); } },
  'BT05-056': { run: (r, i) => { const p = r.p[i], sh = p.life.length > 0 && p.life.every(l => l.up);
    const m1 = next => { const T = p.av.filter(a => isAv(a) && symOf(a) === 'เปรต').map(a => a.u); if (!T.length) { log(r, 'พลังแห่งการตีพ่อตีแม่: ไม่มี Avatar {เปรต} ให้สวมใส่'); return next && next(); }
      ask(r, i, { text: 'เลือก Avatar {เปรต} ที่จะสวมใส่ ตีพ่อ + ตีแม่ จาก Deck', opts: T, cb: us => { const t = find(r, us[0]); if (t) { ['ตีพ่อ', 'ตีแม่'].forEach(n => { const c = p.deck.find(x => !x.tk && B[x.id].t === 'Magic' && B[x.id].n.trim() === n); if (c) { p.deck.splice(p.deck.indexOf(c), 1); p.mg.push(c); c.at = t.c.u; log(r, '🪖 ' + nmOf(t.c) + ' สวมใส่ ' + n); } }); shuf(p.deck); vfx(t.c.u, 'aura', 'ตีพ่อ + ตีแม่', '#f472b6'); } next && next(); } }); };
    const m2 = () => { const D = p.deck.filter(c => isAv(c) && symOf(c) === 'เปรต').map(c => c.u); if (!D.length) return log(r, 'พลังแห่งการตีพ่อตีแม่: ไม่มี Avatar {เปรต} ใน Deck');
      ask(r, i, { text: 'เลือก Avatar {เปรต} จาก Deck ขึ้นมือ', opts: D, cb: us => { const c = fromZone(r, i, 'deck', us[0]); if (c) { p.hand.push(c); log(r, '✨ นำ ' + B[c.id].n + ' ขึ้นมือ'); } shuf(p.deck); } }); };
    if (sh) return m1(m2);
    ask(r, i, { text: 'เลือกปฏิบัติ: เลือก 1 ข้อ', choices: ['1) สวมใส่ ตีพ่อ+ตีแม่ ให้ {เปรต}', '2) ค้น Avatar {เปรต} ขึ้นมือ'], cb: k => k === 0 ? m1() : m2() }); } },
  'BT05-057': { react: 'bp5', steps: [{ key: 'p', pay: 1, text: 'ส่ง Avatar บน Avatar Zone ของเรา 1 ใบ ลงนรก', opts: myAvs }], run: (r, i) => { r.g.noBD = { who: i, n: r.g.n }; vfx(r.p[i].av[0] && r.p[i].av[0].u, 'aura', '🙏 พระคุ้มครอง', '#fbbf24'); log(r, '🙏 พระคุ้มครอง: Avatar ของ ' + r.p[i].name + ' ไม่ถูกทำลายจากการต่อสู้ในเทิร์นนี้'); } },
  'BT05-059': { react: 1, cond: (r, i) => { const A = r.p[i].av, a35 = A.find(a => a.id === 'BT05-035'), pl = A.find(a => a.id === 'BT05-054A'); if (!a35 || !pl) return false; const O = A.filter(a => a !== a35 && a !== pl && B[a.id].n.includes('Super Air') && isAv(a)), nm = new Set(O.map(a => B[a.id].n)); return nm.size >= 2; },
    run: (r, i) => { const me = r.p[i], op = r.p[1 - i], A = me.av, a35 = A.find(a => a.id === 'BT05-035'), pl = A.find(a => a.id === 'BT05-054A'); if (!a35 || !pl) return;
      const seenN = new Set(['คุณเชิดชัย Super Air', 'เครื่องบิน Super Air']), O = []; A.forEach(a => { if (a !== a35 && a !== pl && isAv(a) && B[a.id].n.includes('Super Air') && !seenN.has(B[a.id].n) && O.length < 2) { seenN.add(B[a.id].n); O.push(a); } });
      if (O.length < 2) return log(r, 'รหัสดำ: เงื่อนไขไม่ครบ'); [a35, pl, ...O].forEach(a => sendHell(r, a.u));
      const down = op.life.filter(l => !l.up).length; vfx(op.life[0] && op.life[0].u, 'burst', '🔓 รหัสดำ', '#ef4444');
      if (down <= 2) { r.g.over = me.name + ' ชนะทันที (รหัสดำ)'; r.g.win = i; log(r, '🏆 รหัสดำ: ' + op.name + ' มี LIFE คว่ำ ' + down + ' ใบ — ' + me.name + ' ชนะทันที!'); return; }
      for (let k = 0; k < 3; k++) lifeUp(r, 1 - i); log(r, '🔓 รหัสดำ: หงาย LIFE ของ ' + op.name + ' 3 ใบ'); } },
  'BT05-060': { react: 'never' },
  'BT05-061': { react: 'atk', cond: (r, i) => r.p[1 - i].av.filter(a => a.tired).length >= 2, steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายตรงข้ามที่อยู่ในสภาพนอน 1 ใบ ทำลาย', opts: (r, i) => r.p[1 - i].av.filter(a => a.tired && !protectedFrom(r, i, a, 1)).map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { vfx(t.c.u, 'burst', '🏚 เพดานถล่ม', '#78716c'); destroyAv(r, t.c.u); } } },
  'BT05-062': { steps: [{ key: 't', text: 'เลือก Avatar 1 ใบ ได้รับ ลูกฮึด จนจบเทิร์น', opts: (r, i) => allAvT(r, i) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { t.c.hb5 = r.g.n; vfx(t.c.u, 'aura', '💪 ลูกฮึด', '#f97316'); log(r, '💪 ฮึบบบบ: ' + nmOf(t.c) + ' ได้รับ ลูกฮึด จนจบเทิร์น'); } } },
  'BT05-063': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar {หุ่นยนต์} ที่จะสวมใส่ GHD โคลค', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && (symOf(a) === 'หุ่นยนต์' || also9(a, 'หุ่นยนต์'))).map(a => a.u) }] },
  'BT05-064': { mod: 1, steps: [{ key: 'tg', text: 'เลือก "อัศวินโต๊ะกลม" ที่จะสวมใส่ อาลอนไดร์ท', opts: (r, i) => r.p[i].av.filter(isKnight).map(a => a.u) }] },
  'BT05-065': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ กระบองแสง คทาวุธ', opts: myAvs }] },
  'BT05-066': { steps: [{ key: 't', text: 'เลือก Avatar Cost ≤ 3 ในนรกเรา อัญเชิญ', opts: (r, i) => r.p[i].hell.filter(c => !c.tk && isAv(c) && B[c.id].c <= 3).map(c => c.u) }, { key: 'd', pay: 1, text: 'ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i, cx) => r.p[i].hand.filter(c => !cx || !cx.card || c.u !== cx.card.u).map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], c = p.hell.find(h => h.u === cx.pick.t[0]), w = p.hell.find(h => h.u === cx.card.u); if (!c || !w) return;
      if (!summonAny(r, i, c.u, 'hell')) return log(r, 'มนุษย์ดัดแปลง: อัญเชิญไม่สำเร็จ');
      p.hell.splice(p.hell.indexOf(w), 1); p.mg.push(w); w.at = c.u; vfx(c.u, 'burst', '🤖 ดัดแปลง → เครื่องจักร', '#64748b'); log(r, '🤖 มนุษย์ดัดแปลง: อัญเชิญ ' + B[c.id].n + ' แล้วสวมใส่ (Symbol เครื่องจักร)'); r.g.q.unshift(() => fxSummon(r, i, c)); } },
});
Object.assign(AB, {
  'BT05-067': { z: 'land', can: (r, i) => r.p[i].hand.some(c => isAv(c) && B[c.id].n.includes('Tank Ranger') && symOf(c) === 'คน') && r.p[i].av.some(isTank),
    steps: [{ key: 'a', text: 'เลือก Avatar "Tank Ranger" {คน} บนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.filter(c => isAv(c) && B[c.id].n.includes('Tank Ranger') && symOf(c) === 'คน').map(c => c.u) }, { key: 't', text: 'เลือก Avatar "รถถัง" ที่จะสวมใส่', opts: (r, i, cx) => r.p[i].av.filter(a => isTank(a)).map(a => a.u) }],
    run: (r, i, cx) => { const p = r.p[i], c = fromZone(r, i, 'hand', cx.pick.a[0]), t = find(r, cx.pick.t[0]); if (c && t) { wearOn(r, i, t.c, c); vfx(t.c.u, 'aura', '🪖 Hot Zone', '#ef4444'); } else if (c) p.hand.push(c); } },
});

/* ===== BT06 ชุด 1A: Magic (Normal) ===== */
const bt6Names = (r, i, pred) => { const seen = new Set(), out = []; r.p[i].deck.forEach(c => { if (!pred(c) || seen.has(B[c.id].n)) return; seen.add(B[c.id].n); out.push(c.u); }); return out; };
function bt6Dice(r, i) { const v = 1 + Math.floor(Math.random() * 6); fx({ k: 'dice', i, v }); log(r, '🎲 ' + r.p[i].name + ' ทอยลูกเต๋าได้ ' + v + (v % 2 ? ' (คี่)' : ' (คู่)')); return v; }
Object.assign(MG, {
  'BT06-045': { run: (r, i) => { const p = r.p[i], hs = p.hand.slice(); hs.forEach(c => sendHell(r, c.u)); vfx(null, 'burst', '📖 งานวิจัย', '#f59e0b'); log(r, '📖 งานวิจัยของพระพรหม: ' + p.name + ' ทิ้งการ์ดบนมือ ' + hs.length + ' ใบ');
      if (p.av.some(a => isAv(a) && nmOf(a).includes('พระพรหม'))) tutor(r, i, () => true, 'การ์ดที่ต้องการ');
      else if (hs.length >= 3) { draw(r, p, 5); log(r, '✨ จั่วการ์ด 5 ใบ'); } } },
  'BT06-046': { cond: (r, i) => { const o = r.p[1 - i]; return o.av.length + o.co.length > 0; },
    run: (r, i) => { const o = r.p[1 - i], A = () => o.av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u), C = () => o.co.map(c => c.u), both = r.p[i].av.some(a => isAv(a) && nmOf(a).includes('พระอิศวร'));
      const hitA = () => ask(r, i, { text: 'คำสั่งของพระอิศวร: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ POWER -2', opts: A(), cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, -2); vfx(t.c.u, 'aura', 'POWER -2', '#ef4444'); log(r, '⚡ ' + nmOf(t.c) + ' POWER -2'); } } });
      const hitC = () => ask(r, i, { text: 'คำสั่งของพระอิศวร: เลือก Construct ฝ่ายตรงข้าม 1 ใบ POWER -2', opts: C(), cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, -2); vfx(t.c.u, 'aura', 'POWER -2', '#ef4444'); log(r, '⚡ ' + B[t.c.id].n + ' POWER -2'); } } });
      if (both) { hitA(); r.g.q.unshift(() => hitC()); return; }
      const ch = [], fn = []; if (A().length) { ch.push('1) Avatar ฝ่ายตรงข้าม 1 ใบ POWER -2'); fn.push(hitA); } if (C().length) { ch.push('2) Construct ฝ่ายตรงข้าม 1 ใบ POWER -2'); fn.push(hitC); }
      if (ch.length === 1) return fn[0](); if (ch.length) ask(r, i, { choices: ch, text: 'คำสั่งของพระอิศวร: เลือกปฏิบัติ', cb: k => fn[k]() }); } },
  'BT06-047': { cond: (r, i) => r.p[i].av.length > 0,
    run: (r, i) => { const n = r.p[i].av.some(a => isAv(a) && nmOf(a).includes('พระนารายณ์')) ? 3 : 1;
      ask(r, i, { text: 'จิตมุ่งมั่นของพระนารายณ์: เลือก Avatar ฝ่ายเรา' + (n > 1 ? ' สูงสุด 3 ใบ' : ' 1 ใบ') + ' POWER +1 จนจบเทิร์น', opts: r.p[i].av.map(a => a.u), n, min: 1, cb: us => us.forEach(u => { const t = find(r, u); if (t) { addTp(t.c, 1); vfx(t.c.u, 'aura', 'POWER +1', '#38bdf8'); } }) }); } },
  'BT06-048': { cond: (r, i) => { const p = r.p[i], g = r.g; return p.life.length > 0 && p.life.every(l => l.up) && g.h48 !== g.n; },   // สถานะสาหัส: LIFE หงายครบ
    run: (r, i) => { const g = r.g; g.h48 = g.n; draw(r, r.p[i], 4); g.used[i].Normal = 0; vfx(null, 'burst', '🔥 เฮือกสุดท้าย', '#ef4444'); log(r, '🔥 เฮือกสุดท้าย: จั่ว 4 ใบ และใช้ Normal Magic ที่ไม่ใช่ เฮือกสุดท้าย ได้อีก 1 ใบ'); } },
  'BT06-049': { cond: (r, i) => new Set(r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('พลเอก')).map(nmOf)).size >= 3,
    steps: [0, 1, 2].map(k => ({ key: 'g' + k, pay: 1, text: 'ส่ง Avatar \"พลเอก\" (ชื่อไม่ซ้ำ) ' + (k + 1) + '/3 ลงนรก', opts: (r, i, cx) => { const used = ['g0', 'g1', 'g2'].flatMap(q => (cx.pick[q] || []).map(u => nmOf(find(r, u).c))); return r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('พลเอก') && !used.includes(nmOf(a))).map(a => a.u); } })),
    run: (r, i) => { const o = r.p[1 - i], p = r.p[i];
      [...o.av, ...o.co, ...o.mg, ...o.hand].map(c => c.u).forEach(u => sendHell(r, u)); if (r.g.land && r.g.land.o === 1 - i) { o.hell.push(r.g.land.c); r.g.land = null; }
      vfx(null, 'burst', '💥 แผนลับ', '#dc2626'); log(r, '💥 แผนลับของเหล่าพลเอก: ส่งการ์ดบนสนามและบนมือของ ' + o.name + ' ลงนรก');
      const okc = c => isAv(c) && (B[c.id].n.includes('ทหาร') || B[c.id].n.includes('รด.')), put = [];
      const step = () => { const O = bt6Names(r, i, c => okc(c) && !put.includes(B[c.id].n) && canPlaceAv(r, i, c));
        if (put.length >= 3 || !O.length) { shuf(p.deck); return; }
        ask(r, i, { yn: false, text: 'อัญเชิญ Avatar \"ทหาร\"/\"รด.\" จาก Deck (' + (put.length + 1) + '/3) — เลือก 1 ใบ', opts: O, n: 1, min: put.length ? 0 : 0, cancel: true, onCancel: () => shuf(p.deck),
          cb: us => { const c = p.deck.find(x => x.u === us[0]); if (c && summonAny(r, i, c.u, 'deck')) { put.push(B[c.id].n); vfx(c.u, 'burst', 'อัญเชิญ', '#16a34a'); r.g.q.unshift(() => fxSummon(r, i, c)); } r.g.q.unshift(step); } }); };
      step(); } },
  'BT06-051': { steps: [{ key: 'a', pay: 1, text: 'ส่ง Avatar บน Avatar Zone ฝ่ายเรา 1 ใบลงนรก (เป็นเงื่อนไขของสกิล)', opts: myAvs }],
    run: (r, i) => { const v = bt6Dice(r, i), o = r.p[1 - i];
      if (v % 2 === 0) ask(r, i, { text: '🎲 ออกคู่ (' + v + '): เลือก Avatar ฝ่ายตรงข้าม 2 ใบ ทำลาย', opts: o.av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u), n: 2, cb: us => us.forEach(u => { vfx(u, 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, u); }) });
      else ask(r, i, { text: '🎲 ออกคี่ (' + v + '): เลือก Avatar ฝ่ายเรา 1 ใบ ทำลาย', opts: myAvs(r, i), n: 1, cb: us => { vfx(us[0], 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, us[0]); } }); } },
});

/* ===== BT06 ชุด 1B: React / Modification / Land / Construct ===== */
const bt6Wears = (r, x, id) => r.p.some(q => q.mg.some(m => m.at === x.u && m.id === id));
const bt6Land = (r, id, i) => !!(r.g.land && r.g.land.c.id === id && (i == null || r.g.land.o === i));
const bt6Goddess = c => isAv(c) && B[c.id].n.includes('เทพธิดาแห่งวัลฮัลลา');
const bt6DogCat = a => isAv(a) && symOf(a) === 'สัตว์' && (nmOf(a).includes('หมา') || nmOf(a).includes('แมว'));
const bt6Sahat = (r, i) => { const p = r.p[i]; return p.life.length > 0 && p.life.every(l => l.up); };
function bt6Atk(r, i, a, tg, tk) {   // เรียกหลังประกาศโจมตี (Modification ที่สวมใส่)
  const g = r.g;
  r.p.forEach(q => q.mg.forEach(m => { if (m.at !== a.u) return;
    if (m.id === 'BT06-056') { a.bp = (a.bp || 0) + 5; a.k56 = g.n; vfx(a.u, 'aura', '💣 POWER +5', '#ef4444'); log(r, '💣 เท่ระเบิด: ' + nmOf(a) + ' POWER +5 จนจบการต่อสู้ แล้วจะถูกทำลาย'); }
    if (m.id === 'BT06-055') { if (m.k55 !== g.n) { m.k55 = g.n; m.n55 = 0; } if (m.n55 >= 4) return; m.n55++;
      const top = r.p[i].deck.slice(-2); mill(r, i, 2, m);
      if (top.some(c => B[c.id].t === 'Magic') && a.tired) { a.tired = false; vfx(a.u, 'aura', '🔮 ตื่น', '#a855f7'); log(r, '🔮 ไสยเวท ย้อนกลับ: เจอ Magic — ' + nmOf(a) + ' เปลี่ยนจากนอนเป็นตื่น'); } }
  }));
}
function bt6After(r, a) { if (a && a.k56 === r.g.n) { a.k56 = 0; if (find(r, a.u)) { vfx(a.u, 'burst', '💥 ระเบิด', '#ef4444'); log(r, '💥 เท่ระเบิด: ทำลาย ' + nmOf(a)); destroyAv(r, a.u); } } }
function bt6Cage(r) {   // BT06-059 นรกในกรง
  const g = r.g; if (!g || g.over || g.ask || g.pend || !bt6Land(r, 'BT06-059')) return;
  for (const i of [g.turn, 1 - g.turn]) { const p = r.p[i]; if (p.av.length > 3) { const ex = p.av.length - 3;
    return ask(r, i, { text: 'นรกในกรง: Avatar เกิน 3 ใบ — เลือก ' + ex + ' ใบ ส่งลงนรก', opts: p.av.map(a => a.u), n: ex, min: ex, cb: us => us.forEach(u => { vfx(u, 'burst', '⛓ นรกในกรง', '#6b7280'); sendHell(r, u); }) }); } }
}
function bt6Own(r) {   // BT06-066: การ์ดที่ยืมมาเมื่อออกจากสนามกลับนรกเจ้าของเดิม
  r.p.forEach((q, qi) => { q.hell.filter(c => c.ow != null && c.ow !== qi).forEach(c => { q.hell.splice(q.hell.indexOf(c), 1); const o = c.ow; delete c.ow; delete c.nmo; delete c.sy; r.p[o].hell.push(c); }); });
}
function bt6Mill(r, i, c, pg, mgc) {   // BT06-052: ถูกธรณีสูบด้วย Avatar เทพม่วง/Magic → นำขึ้นมือ
  bt6Mill2(r, i, c, pg, mgc);
  const p = r.p[i];
  if (c.id === 'BT06-052' && (pg || mgc)) r.g.q.unshift(() => { const k = p.hell.indexOf(c); if (k < 0) return; p.hell.splice(k, 1); p.hand.push(c); vfx(c.u, 'aura', 'ขึ้นมือ', '#a855f7'); log(r, '🔔 เสียงเรียกแห่งวัลฮัลลา ถูกธรณีสูบ — นำขึ้นมือ'); });
}
function bt6ConGuard(r, i, d, destroyFn) {   // BT06-050 ช่างมาแล้ววว (React: Construct จะถูกทำลาย)
  const g = r.g, p = r.p[i], m = p.hand.find(c => c.id === 'BT06-050');
  if (!m || (g.noReact && g.noReact.who === i) || (g.used && g.used[i] && g.used[i].React) || p.bot) return false;
  ask(r, i, { yn: true, text: 'ช่างมาแล้ววว: ' + B[d.id].n + ' จะถูกทำลาย — ใช้ React ให้ไม่ถูกทำลายไหม?', cb: y => {
    if (y && p.hand.includes(m)) { take(r, m.u); p.hell.push(m); g.used[i].React = 1; vfx(d.u, 'aura', '🏗 ช่างมาแล้ว!', '#f59e0b'); log(r, '🏗 ' + p.name + ' ใช้ ช่างมาแล้ววว: ' + B[d.id].n + ' ไม่ถูกทำลาย'); }
    else destroyFn(); } });
  return true;
}
function bt6Valley(r, i) {   // BT06-069: ใบดำใบแดง → สอดแนม 3
  const p = r.p[i], seen = bt4Peek(r, i, 3, null); if (!seen || !seen.length) return;
  const O = seen.filter(c => isAv(c) && symOf(c) === 'คน' && B[c.id].c <= 4 && isCol(c, 'เขียว') && canPlaceAv(r, i, c)).map(c => c.u);
  const rest = pk => { const R = seen.filter(c => c.u !== pk); R.forEach(c => { const k = p.deck.indexOf(c); if (k >= 0) p.deck.splice(k, 1); p.deck.unshift(c); }); };
  if (!O.length) { rest(null); return; }
  ask(r, i, { text: 'หุบเขา 3 พลเอก: เลือก Avatar {คน} Cost ≤ 4 สีเขียว 1 ใบ อัญเชิญ (ที่เหลือใส่ใต้ Deck)', opts: O, cancel: true, onCancel: () => rest(null), cb: us => { const c = seen.find(x => x.u === us[0]); const k = p.deck.indexOf(c); if (c && k >= 0 && summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ', '#16a34a'); r.g.q.unshift(() => fxSummon(r, i, c)); } rest(us[0]); } });
}
const bt6CafeOK = (r, i) => bt6Land(r, 'BT06-060', i) && r.g.cafe !== r.g.n && r.p[i].av.some(bt6DogCat);
function bt6Cafe(r, i, done) {   // BT06-060 คาเฟ่หมาแมว (End Phase)
  const p = r.p[i];
  ask(r, i, { text: 'คาเฟ่หมาแมว: เลือก Avatar หมา/แมว 1 ใบบนสนาม กลับเข้า Deck', opts: p.av.filter(bt6DogCat).map(a => a.u), cb: us => {
    const f = take(r, us[0]); if (!f) return done(); const nm = nmOf(f.c); f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; delete f.c.wr; p.deck.push(f.c); log(r, '🐾 คาเฟ่หมาแมว: ' + nm + ' กลับเข้า Deck');
    const seen = new Set(), O = []; p.deck.forEach(c => { if (c.u !== f.c.u && bt6DogCat(c) && B[c.id].n !== B[f.c.id].n && !seen.has(B[c.id].n) && canPlaceAv(r, i, c)) { seen.add(B[c.id].n); O.push(c.u); } });
    const plus = () => { const T = p.av.filter(bt6DogCat); if (!T.length) return done(); ask(r, i, { text: 'คาเฟ่หมาแมว: เลือก Avatar หมา/แมว 1 ใบ POWER +1 (ถาวร)', opts: T.map(a => a.u), cb: u2 => { const t = find(r, u2[0]); if (t) { t.c.pw = (t.c.pw || 0) + 1; vfx(t.c.u, 'aura', 'POWER +1', '#f59e0b'); } done(); } }); };
    const after = () => { shuf(p.deck); plus(); };
    if (!O.length) return after();
    ask(r, i, { text: 'คาเฟ่หมาแมว: เลือก Avatar หมา/แมว (ชื่อไม่ซ้ำ) จาก Deck อัญเชิญ', opts: O, cancel: true, onCancel: after, cb: u3 => { const c = p.deck.find(x => x.u === u3[0]); if (c && summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ', '#16a34a'); r.g.q.unshift(() => fxSummon(r, i, c)); } after(); } }); } });
}
function bt6Statue(r, i, fin) {   // BT06-065 รูปปั้นพระอิศวร (แทนการจั่ว)
  const p = r.p[i], seen = bt4Peek(r, i, 2, null) || [];
  const rest = pk => seen.filter(c => c.u !== pk).forEach(c => { const k = p.deck.indexOf(c); if (k >= 0) p.deck.splice(k, 1); p.deck.unshift(c); });
  const O = seen.filter(c => B[c.id].s === 'เทพ').map(c => c.u);
  if (!O.length) { rest(null); log(r, '🗿 รูปปั้นพระอิศวร: ไม่พบ Symbol เทพ — ทั้งหมดไว้ล่าง Deck'); return fin('st65'); }
  ask(r, i, { text: 'รูปปั้นพระอิศวร: เลือกการ์ด Symbol เทพ 1 ใบขึ้นมือ (ที่เหลือไว้ล่าง Deck)', opts: O, cb: us => { const c = seen.find(x => x.u === us[0]), k = p.deck.indexOf(c); if (c && k >= 0) { p.deck.splice(k, 1); p.hand.push(c); } rest(us[0]); log(r, '🗿 รูปปั้นพระอิศวร: นำ ' + (c ? B[c.id].n : '-') + ' ขึ้นมือ'); fin('st65'); } });
}
Object.assign(MG, {
  'BT06-050': { react: 'never' },   // ทำงานผ่าน bt6ConGuard
  'BT06-052': { react: 'atk', cond: (r, i) => bt6Sahat(r, i) && r.p[i].deck.length >= 5,
    run: (r, i, cx) => { const p = r.p[i]; mill(r, i, 5, cx.card); if (cx.pend) cx.pend.cancel = 1; vfx(null, 'burst', '🔔 วัลฮัลลา', '#a855f7'); log(r, '🔔 เสียงเรียกแห่งวัลฮัลลา: ยกเลิกการโจมตี');
      r.g.q.unshift(() => { const O = p.hell.filter(bt6Goddess).map(c => c.u); if (!O.length) return;
        ask(r, i, { text: 'เลือก เทพธิดาแห่งวัลฮัลลา สูงสุด 4 ใบ จากนรก อัญเชิญลง Avatar Zone', opts: O, n: Math.min(4, O.length), min: 0, cb: us => us.forEach(u => { const c = p.hell.find(x => x.u === u); if (c && canPlaceAv(r, i, c) && summonAny(r, i, u, 'hell')) { vfx(u, 'burst', 'อัญเชิญ', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); } }) }); }); } },
  'BT06-053': { react: 'atkAv', run: (r, i, cx) => { const t = cx.pend && find(r, cx.pend.tg); if (t) { addTp(t.c, 2); vfx(t.c.u, 'aura', 'POWER +2', '#38bdf8'); log(r, '💪 พลังแฝง: ' + nmOf(t.c) + ' POWER +2 จนจบเทิร์น'); } } },
  'BT06-054': { mod: 1, tgf: a => isAv(a) && nmOf(a).includes('นาค') && (symOf(a) === 'สัตว์มหัศจรรย์' || also9(a, 'สัตว์มหัศจรรย์')) },
  'BT06-055': { mod: 1 },
  'BT06-056': { mod: 1, tgf: a => isAv(a) && (nmOf(a).includes('ทหาร') || nmOf(a).includes('รด.')) },
  'BT06-057': { mod: 1, tgf: a => isAv(a) && symOf(a) === 'ฤษี' },
  'BT06-058': { mod: 1, tgf: a => isKnight(a) },
  'BT06-059': {}, 'BT06-060': {}, 'BT06-061': {}, 'BT06-062': {}, 'BT06-063': {},
});
Object.assign(AB, {
  'BT06-063': { z: 'land', can: (r, i) => r.p[i].deck.length >= 2, steps: [],
    run: (r, i, cx) => { const p = r.p[i]; mill(r, i, 2, cx.card); r.g.q.unshift(() => { const O = p.hell.filter(bt6Goddess).map(c => c.u); if (!O.length) return;
      ask(r, i, { text: 'ประตูวัลฮัลลา: เลือก เทพธิดาแห่งวัลฮัลลา 1 ใบจากนรก นำขึ้นมือ', opts: O, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.hand.push(c); vfx(c.u, 'aura', 'ขึ้นมือ', '#a855f7'); log(r, '🚪 ประตูวัลฮัลลา: นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }); }); } },
  'BT06-066': { z: 'co', can: (r, i) => r.p[i].av.some(a => isAv(a) && nmOf(a).includes('มนุษย์ดาว R18')) && r.p[1 - i].hell.some(c => isAv(c) && B[c.id].c >= 5),
    steps: [{ key: 't', text: 'ยานสำรวจ R18: เลือก Avatar Cost 5 ขึ้นไปในนรกฝ่ายตรงข้าม', opts: (r, i) => r.p[1 - i].hell.filter(c => isAv(c) && B[c.id].c >= 5).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, 1 - i, 'hell', cx.pick.t[0]); if (!c) return; c.ow = 1 - i; c.nmo = 'ข้ารับใช้ของ มนุษย์ดาว R18'; c.sy = 'เอเลี่ยน'; r.p[i].mg.push(c); vfx(c.u, 'burst', '👽 ข้ารับใช้', '#22c55e'); log(r, '👽 ยานสำรวจ R18: นำ ' + B[c.id].n + ' จากนรกฝ่ายตรงข้ามมาไว้ที่ Magic Zone (ข้ารับใช้ของ มนุษย์ดาว R18)'); } },
});
Object.assign(ABIL, {
  'BT06-070': { zone: 'co', once: 1, hint: 'ใช้ได้เฉพาะ Draw Phase และต้องมี LIFE ที่หงายอยู่', label: 'ทำลายตู้ แล้วคว่ำ LIFE 1 ใบ',
    cond: (r, i) => r.g.drawWin === r.g.n && r.p[i].life.some(l => l.up),
    run: (r, i, c) => { const p = r.p[i], U = p.life.filter(l => l.up);
      take(r, c.u); p.hell.push(c); fx({ k: 'die', u: c.u, id: c.id }); log(r, '💥 ตู้วารีบำบัด ถูกทำลาย (ค่าใช้)');
      ask(r, i, { choices: U.map(l => B[l.id].n), text: 'ตู้วารีบำบัด: เลือก LIFE ที่หงายอยู่ 1 ใบ เพื่อคว่ำ', cb: k => { const l = U[k]; if (!l) return; l.up = 0; fx({ k: 'life', i }); log(r, '💧 ตู้วารีบำบัด: คว่ำ LIFE ' + B[l.id].n); } }); } },
  'BT06-058': { zone: 'hell', hint: 'ต้องยังไม่ใช้ Modification Magic เทิร์นนี้ มี "อัศวินโต๊ะกลม" และ Deck อย่างน้อย 1 ใบ', label: 'ธรณีสูบ 1 ใบ แล้วสวมใส่ อัศวินโต๊ะกลม',
    cond: (r, i) => r.g.turn === i && r.g.phase === 'main' && !r.g.used[i].Modification && r.p[i].av.some(isKnight) && r.p[i].deck.length > 0,
    run: (r, i, c) => { const p = r.p[i], cu = c.u; ask(r, i, { text: 'ดาบศักดิ์สิทธิ์ แกลลาติน: เลือก "อัศวินโต๊ะกลม" ที่จะสวมใส่ (ธรณีสูบ 1 ใบ)', opts: p.av.filter(isKnight).map(a => a.u), cancel: true, cb: us => { const t = find(r, us[0]), c2 = p.hell.find(h => h.u === cu); if (!t || !c2) return; mill(r, i, 1, c2); const k = p.hell.indexOf(c2); if (k < 0) return; p.hell.splice(k, 1); p.mg.push(c2); c2.at = t.c.u; r.g.used[i].Modification = 1; vfx(t.c.u, 'aura', '🗡 แกลลาติน', '#f97316'); log(r, '🗡 แกลลาติน: ธรณีสูบ 1 ใบ แล้วสวมใส่ให้ ' + nmOf(t.c)); } }); } },
});
['SD04-016', 'PRMO-021'].forEach(id => { const d = MG[id]; if (!d || !d.run) return; const o = d.run; d.run = (r, i, cx) => r.p[i].co.some(c => c.id === 'BT06-069') ? bt6Valley(r, i) : o(r, i, cx); });


/* ===== BT06 ชุด 2: Avatar 001-040 ===== */
const SERV = 'ข้ารับใช้ของ มนุษย์ดาว R18';
const isServ = x => !!x && isAv(x) && nmOf(x) === SERV;
const isPole = x => !!x && isAv(x) && nmOf(x).includes('เสามงคล');
const has33 = (r, i) => r.p[i].av.some(a => a.id === 'BT06-033' && !noFx(r, a));
const poleMg = (r, i) => has33(r, i) ? r.p[i].mg.filter(isPole) : [];
const banks = x => !!x && isAv(x) && nmOf(x).includes('แบงค์');
const bankNames = (r, i) => new Set(r.p[i].hell.filter(banks).map(nmOf)).size;
const bt6Naga = a => isAv(a) && nmOf(a).includes('นาค') && (symOf(a) === 'สัตว์มหัศจรรย์' || also9(a, 'สัตว์มหัศจรรย์'));
const bt6Swords = (r, i) => r.p[i].mg.filter(m => !m.tk && B[m.id].t === 'Magic' && B[m.id].st === 'Modification' && B[m.id].n.includes('ดาบศักดิ์สิทธิ์')).map(m => m.u);
const bt6NotOnly = c => !/only/i.test(B[c.id].o || '');
const bt6Banned = (r, i, x) => !!(r.g.ban6 && r.g.ban6.n === r.g.n && r.g.ban6.i === i && !x.tk && nmOf(x) === r.g.ban6.name);
const bt6Trio = (a, me) => a.u !== me.u && isAv(a) && TRIO.some(t => nm2(a) === t || nm2(a).startsWith(t + ' '));

function bt6P(r, x, f, v) {   // POWER ต่อเนื่องของ BT06 Avatar
  const i = f.i, p = r.p[i], g = r.g;
  if (!x.tk && !noFx(r, x)) {
    if (x.id === 'BT06-008' && r.p.reduce((n, q) => n + q.mg.filter(m => m.at === x.u && B[m.id].n.trim() === 'น้ำใจ').length, 0) >= 4) v += 10 - (B[x.id].p || 0);
    if (x.id === 'BT06-015') v += [...p.av, ...p.mg].filter(isServ).length;
    if (x.id === 'BT06-020') v += p.av.filter(a => bt6Trio(a, x)).length;
    if (x.id === 'BT06-022' && bankNames(r, i) >= 5) v += 2;
  }
  if ((x.wr || []).some(w => w.id === 'BT06-032')) v += 1;
  if (x.eq4 === g.n && x.eqS != null) { const s = find(r, x.eqS); if (s && s.z === 'av' && s.c.id === 'BT06-004' && !noFx(r, s.c)) v = P(r, s.c); }
  return v;
}
function bt6Bs(r) {   // เริ่ม Battle Phase: 001 / 002
  const g = r.g, i = g.turn;
  r.p[i].av.forEach(a => { if (a.tk || noFx(r, a) || P(r, a) < 7) return;
    if (a.id === 'BT06-001') { a.k1 = g.n; vfx(a.u, 'aura', '🐉 LIFE ไม่ทำงาน', '#38bdf8'); log(r, '🐉 วิรูฬ นาคเกล็ดทอง: POWER ≥ 7 — เทิร์นนี้ LIFE Card ที่ถูกหงายจากการโจมตีของใบนี้ ความสามารถไม่ทำงาน'); }
    if (a.id === 'BT06-002') { a.k2 = g.n; vfx(a.u, 'aura', '🐉 ความเสียหาย 2 ใบ', '#a855f7'); log(r, '🐉 ฉัพพยา นาคเกล็ดรุ้ง: POWER ≥ 7 — เทิร์นนี้โจมตี LIFE สำเร็จ ทำความเสียหาย 2 ใบ'); } });
}
function bt6Hit(r, d, atk, a) {
  const x = hit(r, d, atk); if (x === 'KO' || !a || a.tk || noFx(r, a)) return x;
  if (a.id === 'BT06-001' && a.k1 === r.g.n) { const k = (d.lf || []).lastIndexOf(x); if (k >= 0) d.lf.splice(k, 1); log(r, '🐉 วิรูฬ: LIFE Card ที่ถูกหงาย ความสามารถไม่ทำงาน'); }
  if (a.id === 'BT06-002' && a.k2 === r.g.n) { log(r, '🐉 ฉัพพยา: ทำความเสียหายต่อ LIFE Card อีก 1 ใบ'); const y = hit(r, d, atk); if (y === 'KO') return 'KO'; }
  if (a.id === 'BT10-020' && a.s20) { log(r, '🗡 เตียวคับ: ทำความเสียหายต่อ LIFE Card อีก 1 ใบ'); const y2 = hit(r, d, atk); if (y2 === 'KO') return 'KO'; }
  bt10Hit(r, d, atk, a);
  return x;
}
function bt6AtkS2(r, i, a, tg, tk) {   // ประกาศโจมตี: 039
  if (a.id === 'BT06-039' && tk === 'av') { const d = r.p[1 - i].av.find(x => x.u === tg); if (d && symOf(d) === 'กะปอม') { fx({ k: 'say', id: a.id, t: 'ทำลายเป้าหมาย' }); log(r, '🦖 เรนะ นักล่าไดโนเสาร์: ทำลาย ' + nmOf(d)); destroyAv(r, d.u); } }
}
function bt6Win(r, p, a, d, res) {   // ทำลาย Avatar ฝ่ายตรงข้ามจากการต่อสู้สำเร็จ
  const L = []; if (res === 'win') L.push([a, d, p.ai, true]); if (res === 'lose') L.push([d, a, 1 - p.ai, false]);
  L.forEach(([w, l, wi, isAtk]) => { if (!w || w.tk || noFx(r, w) || !find(r, w.u)) return;
    if (w.id === 'BT06-004' && isAtk) { vfx(w.u, 'aura', 'หงาย LIFE', '#38bdf8'); log(r, '👑 อนันต์: ฝ่ายตรงข้ามหงาย LIFE 1 ใบ'); lifeUp(r, 1 - wi); }
    if (w.id === 'BT06-022' && bankNames(r, wi) >= 7) { vfx(w.u, 'aura', 'หงาย LIFE', '#f59e0b'); log(r, '🏦 แบงค์ผู้พิชิต (7 ชื่อ): หงาย LIFE ฝ่ายตรงข้าม 1 ใบ'); lifeUp(r, 1 - wi); }
    if (w.id === 'BT06-014' && !l.tk) { const o = r.p[1 - wi], k = o.hell.indexOf(l); if (k >= 0) { o.hell.splice(k, 1); l.ow = 1 - wi; l.nmo = SERV; l.sy = 'เอเลี่ยน'; l.pw = 0; l.tp = 0; l.bp = 0; l.tired = false; r.p[wi].mg.push(l); vfx(l.u, 'burst', '👽 ข้ารับใช้', '#22c55e'); log(r, '👽 สวีนนีย์: นำ ' + B[l.id].n + ' มาไว้ที่ Magic Zone เป็น ' + SERV); } } });
}
function bt6Rep(r, f) {   // แทนการลงนรก (คืนค่า 'bot' | 'deck' | null)
  const c = f.c, g = r.g;
  if (c.id === 'BT06-030' && f.z === 'av' && !noFx(r, c)) { vfx(c.u, 'burst', 'กลับใต้ Deck', '#ef4444'); log(r, '🔱 อาม่อน No.7: ถูกทำลาย กลับเข้าใต้สุดของ Deck แทนการลงนรก'); return 'bot'; }
  if (g.inB && g.curAtk && g.curDef && (c === g.curAtk || c === g.curDef)) { const w = c === g.curAtk ? g.curDef : g.curAtk;
    if (w.id === 'BT06-025' && !w.tk && !noFx(r, w)) { vfx(c.u, 'burst', 'กลับเข้า Deck', '#a855f7'); log(r, '🧛 เลอติ๊ก: ' + nmOf(c) + ' ถูกส่งกลับเข้า Deck แทนการลงนรก'); return 'deck'; } }
  return null;
}
function bt6Sub33(r, f0, redo) {   // 033: จะออกจากสนาม → ส่งเสามงคลใบอื่นแทนได้
  if (!f0 || f0.z !== 'av' || f0.c.id !== 'BT06-033' || noFx(r, f0.c) || r.g.ask) return false;
  const O = [...r.p[f0.i].av, ...r.p[f0.i].mg].filter(a => a.u !== f0.c.u && isPole(a)).map(a => a.u); if (!O.length) return false;
  ask(r, f0.i, { yn: true, text: 'เสาซินแสมงคล จะออกจากสนาม: ส่ง Avatar "เสามงคล" ใบอื่นในสนามลงนรกแทนไหม?', cb: y => { if (!y) return redo();
    ask(r, f0.i, { text: 'เลือก Avatar "เสามงคล" ที่จะส่งลงนรกแทน', opts: O.filter(u => find(r, u)), cancel: true, onCancel: redo, cb: us => { vfx(f0.c.u, 'aura', '🛡 ส่งเสามงคลแทน', '#22c55e'); log(r, '🛡 เสาซินแสมงคล: ส่ง ' + nmOf(find(r, us[0]).c) + ' ลงนรกแทน'); sendHell(r, us[0]); } }); } });
  return true;
}
function bt6Death(r, f) {   // คำสั่งเสีย + ปฏิกิริยาเมื่อ Avatar ถูกทำลาย
  const c = f.c, i = f.i, p = r.p[i];
  if (c.id === 'BT06-011') scout(r, i, 3, { text: 'คำสั่งเสีย: เลือก Avatar "ไดโนกาฬสินธุ์" Cost ≤ 3 (ไม่ใช่ สุธีธรนีซอรัส) อัญเชิญลง Avatar Zone', pred: x => isAv(x) && B[x.id].n.startsWith('ไดโนกาฬสินธุ์') && !B[x.id].n.includes('สุธีธรนีซอรัส') && B[x.id].c <= 3 && canPlaceAv(r, i, x), rest: 'shuffle', then: x => { if (x) putAv(r, i, x, { sm: 1 }); } });
  if (c.id === 'BT06-014') { const O = p.mg.filter(isServ).map(x => x.u); if (O.length) ask(r, 1 - i, { text: 'คำสั่งเสียของ สวีนนีย์: เลือก "ข้ารับใช้ของ มนุษย์ดาว R18" ใน Magic Zone ฝ่ายตรงข้าม 1 ใบ ส่งลงนรกเจ้าของเดิม', opts: O, cb: us => { vfx(us[0], 'burst', 'กลับนรก', '#ef4444'); sendHell(r, us[0]); } }); }
  if (isAv(c) && nmOf(c).startsWith('จ่ามะนาว') && B[c.id].c <= 3 && p.hand.some(h => h.id === 'BT06-018')) r.g.q.push(() => bt6Iron(r, i));
}
function bt6Iron(r, i) {   // 018 จ่ามะนาวแขนเหล็ก (สั่งใช้จากมือ)
  const p = r.p[i], m = p.hand.find(h => h.id === 'BT06-018'); if (!m || !canPlaceAv(r, i, m)) return;
  const free = bt6Sahat(r, i);
  ask(r, i, { yn: true, text: 'จ่ามะนาวแขนเหล็ก: จ่ามะนาว Cost ≤ 3 ถูกทำลาย — อัญเชิญจากมือ' + (free ? ' (สถานะสาหัส: ไม่ต้องจ่าย Cost)' : ' โดยจ่าย Cost 4') + ' ไหม?', cb: y => { if (!y || !p.hand.includes(m)) return;
    const go = ps => { ps.forEach(q => { const k = p.hand.indexOf(q); if (k >= 0) { p.hand.splice(k, 1); p.hell.push(q); } }); if (summonAny(r, i, m.u, 'hand')) { vfx(m.u, 'burst', '🛡 แขนเหล็ก!', '#ef4444'); r.g.q.unshift(() => fxSummon(r, i, m)); if (ps.length) r.g.q.push(() => fxPaid(r, i, ps, m)); } };
    if (free) return go([]);
    const pay = () => { const O = p.hand.filter(h => h.u !== m.u && !h.stl).map(h => h.u); if (!O.length) return log(r, 'จ่ามะนาวแขนเหล็ก: ไม่มีการ์ดจ่าย Cost');
      ask(r, i, { text: 'เลือกการ์ดบนมือเป็น Cost (Gem รวม ≥ 4 สีตรง/ไม่มีสี)', opts: O, n: O.length, min: 1, cancel: true, cb: us => { const ps = us.map(u => p.hand.find(h => h.u === u)).filter(Boolean); try { payOK(B[m.id], ps, p); } catch (e) { log(r, '❌ จ่าย Cost ไม่ถูกต้อง: ' + e); return pay(); } go(ps); } }); };
    pay(); } });
}
function bt6Back(r, i) {   // 016: ข้ารับใช้ที่ถูกอัญเชิญกลับ Magic Zone ตอนจบเทิร์น
  const p = r.p[i]; p.av.filter(a => a.sb16 === r.g.n).forEach(a => { const f = take(r, a.u); delete f.c.sb16; f.c.pw = 0; f.c.tp = 0; f.c.bp = 0; p.mg.push(f.c); vfx(f.c.u, 'aura', 'กลับ Magic Zone', '#22c55e'); log(r, '👽 ' + nmOf(f.c) + ' กลับไป Magic Zone'); });
}
function bt6End(r, prev) {   // End Phase: 034 + เสามงคล ทรงโรมัน ใน Magic Zone
  const g = r.g, p = r.p[prev];
  p.av.filter(a => a.end34 === g.n - 1).forEach(a => { delete a.end34; vfx(a.u, 'burst', 'ลงนรก', '#6b7280'); log(r, '🌳 เสามงคล ทรงญี่ปุ่น: ส่ง ' + nmOf(a) + ' ลงนรก (End Phase)'); sendHell(r, a.u); });
  poleMg(r, prev).filter(a => a.id === 'BT04-029').forEach(a => g.q.push(() => { const L = p.hell.filter(h => isAv(h) && B[h.id].n.startsWith('ผู้เจริญ')).map(h => h.u); if (!L.length) return;
    ask(r, prev, { text: 'เสามงคล (Magic Zone): อัญเชิญ Avatar "ผู้เจริญ" 1 ใบ จากนรก', opts: L, cb: us => { if (summonAny(r, prev, us[0], 'hell')) vfx(a.u, 'aura', 'อัญเชิญ ผู้เจริญ', '#22c55e'); } }); }));
}
function bt6Start(r) {   // หลัง Draw Phase: 024 กลับลงสนาม + เสามงคลใน Magic Zone จั่วเพิ่ม
  const g = r.g, i = g.turn, p = r.p[i];
  p.mg.filter(c => c.s24 && c.s24 < g.n && isAv(c)).forEach(c => { const k = p.mg.indexOf(c); if (k < 0) return; p.mg.splice(k, 1); delete c.s24; c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; noteSum(r, i, c); p.av.push(c); ev(r, c.kd || c.id); fx({ k: 'summon', u: c.u }); log(r, '✨ ' + p.name + ': พี่หน่วง กลับลง Avatar Zone (ไม่จำกัดจำนวน)'); g.q.push(() => fxSummon(r, i, c)); });
  poleMg(r, i).filter(a => a.id === 'BT02-024').forEach(a => { fx({ k: 'say', id: a.id, t: 'จั่วเพิ่ม 1' }); draw(r, p, 1); log(r, '🌳 เสามงคล (Magic Zone): จั่วเพิ่ม 1 ใบ'); });
}
function bt6Drew(r, p, c) {   // 013: จั่วใน Draw Phase
  const i = r.p.indexOf(p), g = r.g; if (i < 0 || g.turn !== i || !(g.dpOn === g.n || g.drawWin === g.n)) return;
  if (!(g.land && B[g.land.c.id].n.trim() === 'บึงทมิฬ')) return; bt6Blue(r, i, c);
}
function bt6Blue(r, i, c) {
  const p = r.p[i], g = r.g;
  g.q.push(() => { if (!p.hand.includes(c) || !canPlaceAv(r, i, c)) return;
    ask(r, i, { yn: true, text: 'บึงทมิฬ คุณบลูลอบสเตอร์: แสดงการ์ดนี้ให้ฝ่ายตรงข้ามดู และอัญเชิญลง Avatar Zone (ฟรี) ไหม?', cb: y => { if (!y || !p.hand.includes(c)) return;
      vfx(c.u, 'aura', '🐟 แสดงการ์ด', '#38bdf8'); log(r, '🐟 ' + p.name + ' แสดง ' + B[c.id].n + ' ให้ฝ่ายตรงข้ามดู');
      if (summonAny(r, i, c.u, 'hand')) { vfx(c.u, 'burst', 'อัญเชิญ', '#38bdf8'); r.g.q.unshift(() => { fxSummon(r, i, c); r.g.q.unshift(() => ask(r, i, { text: 'บึงทมิฬ คุณบลูลอบสเตอร์: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: foeAvT(r, i), cb: us => { vfx(us[0], 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, us[0]); } })); }); } } }); });
}
HAND_HOOKS.push((r, i, c, info) => {   // 013: ถูกนำขึ้นมือด้วยความสามารถของ "บึงทมิฬ" ใน Draw Phase
  if (c.id !== 'BT06-013' || !info.src || info.src.tk || !nm2(info.src).startsWith('บึงทมิฬ')) return;
  const g = r.g; if (g.turn === i && (g.dpOn === g.n || g.drawWin === g.n)) bt6Blue(r, i, c);
});
function bt6Mill2(r, i, c, pg, mgc) {   // 027 / 028 / 030: ถูกธรณีสูบ
  const p = r.p[i];
  if (c.id === 'BT06-027' && (pg || mgc)) r.g.q.unshift(() => { if (!p.hell.includes(c)) return; const O = p.hell.filter(h => bt6Goddess(h) && B[h.id].c <= 4 && B[h.id].n.trim() !== 'สกัลด์ เทพธิดาแห่งวัลฮัลลา' && canPlaceAv(r, i, h)).map(h => h.u);
    ask(r, i, { text: 'สกัลด์ ถูกธรณีสูบ: เลือก "เทพธิดาแห่งวัลฮัลลา" Cost ≤ 4 จากนรก อัญเชิญลง Avatar Zone', opts: O, cb: us => { const h = p.hell.find(x => x.u === us[0]); if (h && summonAny(r, i, h.u, 'hell')) { vfx(h.u, 'burst', 'อัญเชิญ', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, h)); } } }); });
  if (c.id === 'BT06-028' && (pg || mgc)) r.g.q.unshift(() => { const k = p.hell.indexOf(c); if (k < 0) return; p.hell.splice(k, 1); p.hand.push(c); vfx(c.u, 'aura', 'ขึ้นมือ', '#a855f7'); log(r, '🔔 โอลรุน ถูกธรณีสูบ — นำกลับขึ้นมือ'); });
  if (c.id === 'BT06-030') r.g.q.unshift(() => { if (!p.hell.includes(c) || !canPlaceAv(r, i, c)) return; if (summonAny(r, i, c.u, 'hell')) { vfx(c.u, 'burst', '🔱 อาม่อน No.7', '#ef4444'); r.g.q.unshift(() => fxSummon(r, i, c)); } });
}
function bt6Bottom(r, i, cs, done) {   // เรียงการ์ดไว้ใต้ Deck
  const p = r.p[i]; cs = cs.filter(c => p.deck.includes(c)); cs.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); const ord = [];
  const step = () => { const R = cs.filter(c => !ord.includes(c));
    if (!R.length) { ord.slice().reverse().forEach(c => p.deck.unshift(c)); if (ord.length) log(r, '⬇ ' + p.name + ': นำการ์ดที่เหลือ ' + ord.length + ' ใบ เรียงไว้ใต้ Deck'); return done && done(); }
    if (R.length === 1) { ord.push(R[0]); return step(); }
    ask(r, i, { text: 'เรียงการ์ดไว้ใต้ Deck: เลือกการ์ดที่จะวางเป็น "ใบล่างสุด" ลำดับที่ ' + (ord.length + 1), opts: R.map(c => c.u), cb: us => { ord.push(cs.find(c => c.u === us[0])); step(); } }); };
  step();
}
function bt6Kay(r, i, f) {   // 007 เคย์ (ตอบโต้ตอนอัศวินโต๊ะกลมถูกโจมตี)
  const a = f.c; if (!bt6KayOK(r, i, a)) E('เงื่อนไขการใช้ไม่ครบ');
  ask(r, i, { text: 'เคย์: เลือก Modification "ดาบศักดิ์สิทธิ์" บนสนามฝ่ายเรา 1 ใบ ส่งลงนรก', opts: bt6Swords(r, i), cancel: true, cb: us => {
    ask(r, i, { text: 'เคย์: เลือก "อัศวินโต๊ะกลม" 1 ใบ POWER +2 จนจบเทิร์น', opts: r.p[i].av.filter(isKnight).map(x => x.u), cancel: true, cb: u2 => { a.ou = r.g.n; sendHell(r, us[0]); const t = find(r, u2[0]); if (t) { addTp(t.c, 2); vfx(t.c.u, 'aura', '⚔ POWER +2', '#38bdf8'); log(r, '⚔ เคย์: ส่งดาบศักดิ์สิทธิ์ลงนรก — ' + nmOf(t.c) + ' POWER +2 จนจบเทิร์น'); } } }); } });
}
const bt6KayOK = (r, i, a) => { const p = r.g.pend; if (!p || p.k !== 'atk' || p.who !== i || p.tk !== 'av' || a.id !== 'BT06-007' || noFx(r, a) || a.ou === r.g.n || r.g.turn === i) return false; const t = r.p[i].av.find(x => x.u === p.tg); return !!t && isKnight(t) && bt6Swords(r, i).length > 0; };
function bt6WearSteps(r, i, steps) {   // 005 รีวิวแมน (สวมใส่ได้ทุกเงื่อนไข) / 038 แมมมอธ (สวมใส่ไม่ได้)
  return steps.map(s => s.key !== 'tg' ? s : { ...s, opts: (...a) => { let L = s.opts(...a).filter(u => { const f = find(r, u); return !(f && f.c.id === 'BT06-038' && !noFx(r, f.c)); });
    r.p[i].av.forEach(x => { if (x.id === 'BT06-005' && !noFx(r, x) && !L.includes(x.u) && !protectedFrom(r, i, x, 1)) L.push(x.u); }); return L; } });
}

Object.assign(KD_HAND, { 'BT06-033': 1 });
Object.assign(SUM, {
  'BT06-003': (r, i) => { const p = r.p[i]; ask(r, i, { text: 'จุติ: เลือก Avatar "นาค" {สัตว์มหัศจรรย์} 1 ใบใน Avatar Zone เรา POWER +2', opts: p.av.filter(bt6Naga).map(a => a.u), cb: us => { const t = find(r, us[0]); if (t) { addPw(t.c, 2); vfx(t.c.u, 'aura', 'POWER +2', '#22c55e'); log(r, '🐉 เอรา: ' + nmOf(t.c) + ' POWER +2'); } } }); },
  'BT06-006': (r, i, x) => { const p = r.p[i], S = p.deck.filter(c => isModC(c) && B[c.id].n.includes('ดาบศักดิ์สิทธิ์')).map(c => c.u); if (S.length < 2) return log(r, 'อาเธอร์: ใน Deck มี ดาบศักดิ์สิทธิ์ ไม่ถึง 2 ใบ');
    ask(r, i, { text: 'จุติ: เลือก Modification "ดาบศักดิ์สิทธิ์" จาก Deck 2 ใบ ส่งลงนรก', opts: S, n: 2, min: 2, cancel: true, cb: us => { us.forEach(u => { const c = fromZone(r, i, 'deck', u); if (c) p.hell.push(c); }); log(r, '🗡 อาเธอร์: ส่ง ดาบศักดิ์สิทธิ์ 2 ใบจาก Deck ลงนรก');
      r.g.q.unshift(() => { const O = bt6Names(r, i, c => isKnight(c) && canPlaceAv(r, i, c)); if (!O.length) return shuf(p.deck);
        ask(r, i, { text: 'เลือก Avatar "อัศวินโต๊ะกลม" จาก Deck อัญเชิญลง Avatar Zone', opts: O, cb: u2 => { const c = p.deck.find(k => k.u === u2[0]); if (c && summonAny(r, i, c.u, 'deck', x)) { r.g.ban6 = { n: r.g.n, i, name: nmOf(c) }; vfx(c.u, 'burst', '🗡 อัศวินโต๊ะกลม', '#f97316'); log(r, '🗡 อาเธอร์: อัญเชิญ ' + B[c.id].n + ' — Avatar ชื่อเดียวกันของเราโจมตี/ใช้ความสามารถไม่ได้จนจบเทิร์น'); r.g.q.unshift(() => fxSummon(r, i, c)); } shuf(p.deck); }, none: () => shuf(p.deck) }); }); } }); },
  'BT06-008': (r, i, x) => { let n = 0; r.p.forEach(q => q.mg.forEach(m => { if (B[m.id].n.trim() === 'น้ำใจ' && m.at != null && m.at !== x.u && r.p[i].av.some(a => a.u === m.at)) { m.at = x.u; n++; } })); if (n) { vfx(x.u, 'aura', 'รวมน้ำใจ ' + n, '#f59e0b'); log(r, '🙏 ยอดนักบุญ: นำ น้ำใจ ' + n + ' ใบจาก Avatar ใบอื่นมาสวมใส่'); } },
  'BT06-010': (r, i) => ask(r, i, { text: 'จุติ: เลือก Avatar 1 ใบ POWER -2 จนจบเทิร์น', opts: allAvT(r, i), cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, -2); vfx(t.c.u, 'aura', 'POWER -2', '#ef4444'); log(r, '⚡ ' + nmOf(t.c) + ' POWER -2'); } } }),
  'BT06-012': (r, i, x) => { const p = r.p[i], cols = [...new Set(p.av.filter(a => a.u !== x.u).map(colOf).filter(c => ['แดง', 'ฟ้า', 'ม่วง', 'เขียว'].includes(c)))]; if (!cols.length) return log(r, 'กัปตัน 7 สี: ไม่มี Avatar สี แดง/ฟ้า/ม่วง/เขียว ใบอื่น');
    const act = c => { if (c === 'แดง') { addPw(x, 2); vfx(x.u, 'aura', 'POWER +2', '#ef4444'); log(r, '🎨 กัปตัน 7 สี (แดง): POWER +2'); }
      else if (c === 'ฟ้า') { draw(r, p, 1); log(r, '🎨 กัปตัน 7 สี (ฟ้า): จั่ว 1 ใบ'); }
      else if (c === 'ม่วง') { mill(r, i, 1, x); r.g.q.unshift(() => ask(r, i, { text: 'กัปตัน 7 สี (ม่วง): เลือกการ์ด 1 ใบจากนรก นำกลับเข้าใต้ Deck', opts: p.hell.map(h => h.u), cb: us => { const h = fromZone(r, i, 'hell', us[0]); if (h) { p.deck.unshift(h); log(r, '⬇ นำ ' + B[h.id].n + ' กลับเข้าใต้ Deck'); } } })); }
      else { x.imm = r.g.n; vfx(x.u, 'aura', '🛡 ไม่ถูกทำลาย', '#22c55e'); log(r, '🎨 กัปตัน 7 สี (เขียว): ไม่ถูกทำลายจนจบเทิร์นนี้'); } };
    if (cols.length === 1) return act(cols[0]); ask(r, i, { choices: cols.map(c => 'สี' + c), text: 'กัปตัน 7 สี: เลือกปฏิบัติ 1 อย่าง', cb: k => act(cols[k]) }); },
  'BT06-026': (r, i, x) => { if (!x.jt) return log(r, 'แอชวิค: ไม่ได้อัญเชิญด้วย Gem พอดี Cost — จุติไม่ทำงาน'); const p = r.p[i];
    const O = p.hell.filter(c => isAv(c) && ['ผี', 'เปรต', 'เอเลี่ยน'].includes(symOf(c)) && B[c.id].c <= 5 && canPlaceAv(r, i, c)).map(c => c.u);
    ask(r, i, { text: 'จุติ (พอดี): เลือก Avatar {ผี}/{เปรต}/{เอเลี่ยน} Cost ≤ 5 จากนรก อัญเชิญลง Avatar Zone', opts: O, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'hell')) { vfx(c.u, 'burst', 'อัญเชิญ', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); },
  'BT06-033': (r, i) => { const p = r.p[i], O = p.hell.filter(isPole).map(c => c.u); ask(r, i, { text: 'จุติ: เลือก Avatar "เสามงคล" ได้สูงสุด 3 ใบจากนรก ไปไว้ที่ Magic Zone', opts: O, n: Math.min(3, O.length), min: 0, cb: us => us.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c) { p.mg.push(c); vfx(c.u, 'aura', '→ Magic Zone', '#22c55e'); log(r, '🌳 ' + B[c.id].n + ' ไป Magic Zone'); } }), none: () => { } }); },
  'BT06-035': (r, i) => { const p = r.p[i]; scout(r, i, 5, { text: 'จุติ: เลือก Construct 1 ใบจากที่สอดแนม ขึ้นมือ', pred: c => !c.tk && B[c.id].t === 'Construct', rest: 'none', then: (c, seen) => { if (c) { p.hand.push(c); log(r, '✋ นำ ' + B[c.id].n + ' ขึ้นมือ'); } bt6Bottom(r, i, seen.filter(s => s !== c)); } }); },
  'BT06-036': (r, i) => { const N = r.p[i].av.filter(isNico).map(a => a.u); if (!N.length) return log(r, 'เสนาธิการ: ไม่มี ราชาอาณาจักรของแพง พระเจ้านิโคไล บน Avatar Zone');
    ask(r, i, { text: 'จุติ: เลือก "ราชาอาณาจักรของแพง พระเจ้านิโคไล" บน Avatar Zone เรา 1 ใบ', opts: N, cb: us => { const n = find(r, us[0]); if (!n) return; const cost = costNow(r, n.c), O = foeAvT(r, i).filter(u => { const f = find(r, u); return f && costNow(r, f.c) < cost; });
      ask(r, i, { text: 'ทำลาย Avatar ฝ่ายตรงข้ามที่ Cost น้อยกว่า ' + cost + ' (1 ใบ)', opts: O, cb: u2 => { vfx(u2[0], 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, u2[0]); } }); } }); },
  'BT06-040': (r, i, x) => { const p = r.p[i], cats = () => p.hell.filter(c => isAv(c) && B[c.id].n.trim() === 'แมวมัทฉะ' && canPlaceAv(r, i, c)).map(c => c.u), pet = a => nmOf(a).includes('หมา') || nmOf(a).includes('แมว');
    const o1 = cats().length > 0, o2 = p.av.filter(a => a.u !== x.u && isAv(a) && pet(a)).length >= 2 && p.deck.some(c => c.id === 'BT06-060'), ch = [], fn = [];
    if (o1) { ch.push('1) อัญเชิญ แมวมัทฉะ จากนรก'); fn.push(() => ask(r, i, { text: 'เลือก แมวมัทฉะ จากนรก อัญเชิญลง Avatar Zone', opts: cats(), cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'hell')) { vfx(c.u, 'burst', 'อัญเชิญ', '#f59e0b'); r.g.q.unshift(() => fxSummon(r, i, c)); } } })); }
    if (o2) { ch.push('2) นำ Land คาเฟ่หมาแมว จาก Deck ขึ้นมือ'); fn.push(() => tutor(r, i, c => c.id === 'BT06-060', 'คาเฟ่หมาแมว')); }
    if (!ch.length) return log(r, 'แมวเก็นไมฉะ: ไม่มีตัวเลือกที่ใช้ได้'); if (ch.length === 1) return fn[0](); ask(r, i, { choices: ch, text: 'จุติ: เลือกปฏิบัติ 1 อย่าง', cb: k => fn[k]() }); },
});
Object.assign(AB, {
  'BT06-004': { z: 'av', steps: [], run: (r, i, cx) => { const x = cx.card; let n = 0; r.p[i].av.forEach(a => { if (a.u !== x.u && bt6Naga(a)) { a.eq4 = r.g.n; a.eqS = x.u; n++; vfx(a.u, 'aura', 'POWER = อนันต์', '#fbbf24'); } }); log(r, '👑 อนันต์: Avatar นาค {สัตว์มหัศจรรย์} ใบอื่น ' + n + ' ใบ มี POWER เท่ากับอนันต์ จนจบเทิร์น'); } },
  'BT06-016': { z: 'av', can: (r, i) => r.p[i].mg.some(c => isServ(c) && canPlaceAv(r, i, c)), steps: [{ key: 't', text: 'จอย: เลือก "ข้ารับใช้ของ มนุษย์ดาว R18" ใน Magic Zone 1 ใบ อัญเชิญลง Avatar Zone', opts: (r, i) => r.p[i].mg.filter(c => isServ(c) && canPlaceAv(r, i, c)).map(c => c.u) }],
    run: (r, i, cx) => { const c = r.p[i].mg.find(m => m.u === cx.pick.t[0]); if (c && summonAny(r, i, c.u, 'mg')) { c.sb16 = r.g.n; vfx(c.u, 'burst', '👽 ข้ารับใช้', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } },
  'BT06-019': { z: 'av', can: (r, i) => r.p[i].av.some(isPole), steps: [{ key: 't', text: 'ผู้เจริญระดับสูงสุด: เลือก Avatar "เสามงคล" บน Avatar Zone 1 ใบ ย้ายไป Magic Zone', opts: (r, i) => r.p[i].av.filter(isPole).map(a => a.u) }],
    run: (r, i, cx) => { const f = find(r, cx.pick.t[0]); if (!f || f.z !== 'av') return; const t = take(r, f.c.u); t.c.pw = 0; t.c.tp = 0; t.c.bp = 0; r.p[i].mg.push(t.c); vfx(t.c.u, 'aura', '→ Magic Zone', '#22c55e'); log(r, '🌳 ' + nmOf(t.c) + ' ย้ายไป Magic Zone'); } },
  'BT06-023': { z: 'av', can: (r, i) => r.p[i].deck.length >= 3 && r.p[i].deck.some(c => banks(c) && bt6NotOnly(c)), steps: [],
    run: (r, i, cx) => { const x = cx.card, p = r.p[i]; sac(r, x.u); mill(r, i, 3, x);
      r.g.q.unshift(() => { const O = bt6Names(r, i, c => banks(c) && bt6NotOnly(c) && canPlaceAv(r, i, c)); if (!O.length) return shuf(p.deck);
        ask(r, i, { text: 'อู๊ด คุณแม่: เลือก Avatar "แบงค์" (ไม่ใช่ Only) จาก Deck อัญเชิญลง Avatar Zone', opts: O, cb: us => { const c = p.deck.find(k => k.u === us[0]); if (c && summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ', '#f59e0b'); r.g.q.unshift(() => fxSummon(r, i, c)); } shuf(p.deck); }, none: () => shuf(p.deck) }); }); } },
  'BT06-024': { z: 'av', can: (r, i) => r.p[i].hand.length >= 2 && r.p[1 - i].av.length > 0, steps: [{ key: 'd', pay: 1, n: 2, text: 'พี่หน่วง: ทิ้งการ์ดบนมือ 2 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }, { key: 't', text: 'พี่หน่วง: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ', opts: (r, i) => foeAvT(r, i) }],
    run: (r, i, cx) => { const x = cx.card, t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av' || !find(r, x.u)) return; const tf = take(r, t.c.u), xf = take(r, x.u);
      tf.c.ow = 1 - i; tf.c.pw = 0; tf.c.tp = 0; tf.c.bp = 0; tf.c.tired = false; xf.c.s24 = r.g.n; xf.c.pw = 0; xf.c.tp = 0; xf.c.bp = 0; r.p[i].mg.push(tf.c, xf.c);
      vfx(tf.c.u, 'burst', '🌀 ถูกเก็บเข้า Magic Zone', '#a855f7'); log(r, '🌀 พี่หน่วง: นำ ' + nmOf(tf.c) + ' และตัวเองเข้า Magic Zone — เริ่ม Main Phase ถัดไปจะกลับลงสนาม'); } },
  'BT06-029': { z: 'av', can: (r, i) => r.p[i].deck.length >= 3, steps: [], run: (r, i, cx) => { mill(r, i, 3, cx.card); const f = find(r, cx.card.u); if (f && f.z === 'av') { addPw(cx.card, 1); vfx(cx.card.u, 'aura', 'POWER +1', '#a855f7'); log(r, '⚡ ซีกรุน: POWER +1'); } } },
  'BT06-031': { z: 'av', steps: [], run: (r, i, cx) => { const x = cx.card;
      ask(r, i, { choices: ['1) เซ่นไหว้ Avatar ใบนี้ จั่ว 2 ใบ', '2) ได้รับ เตะไข่ จนจบเทิร์น แล้วทำลาย Avatar ใบนี้ใน End Phase'], text: 'งี่เง่า และ งอแง: เลือกปฏิบัติ', cb: k => { if (k === 0) { sac(r, x.u); draw(r, r.p[i], 2); log(r, '✨ เซ่นไหว้ งี่เง่า และ งอแง: จั่ว 2 ใบ'); } else { x.k31 = r.g.n; x.endDie = 1; vfx(x.u, 'aura', '🥚 เตะไข่', '#ef4444'); log(r, '🥚 งี่เง่า และ งอแง: ได้รับ เตะไข่ จนจบเทิร์น และจะถูกทำลายใน End Phase'); } } }); } },
  'BT06-032': { z: 'av', can: (r, i, c) => r.p[i].av.some(a => a.id === 'BT05-054A' && canWear(a, c)), steps: [{ key: 't', text: 'พีเจี้ยน 3000: เลือก "เครื่องบิน Super Air" ที่จะสวมใส่', opts: (r, i, cx) => r.p[i].av.filter(a => a.id === 'BT05-054A' && canWear(a, cx.card)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); vfx(t.c.u, 'aura', '🕊 โล่มนุษย์ + POWER +1', '#38bdf8'); } },
  'BT06-034': { z: 'av', can: (r, i) => r.p[i].hand.some(c => isAv(c) && nmOf(c).includes('ผู้เจริญ') && canPlaceAv(r, i, c)), steps: [{ key: 'a', text: 'เลือก Avatar "ผู้เจริญ" จากมือ 1 ใบ อัญเชิญลง Avatar Zone', opts: (r, i) => r.p[i].hand.filter(c => isAv(c) && nmOf(c).includes('ผู้เจริญ') && canPlaceAv(r, i, c)).map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], c = p.hand.find(h => h.u === cx.pick.a[0]); if (c && summonAny(r, i, c.u, 'hand')) { c.end34 = r.g.n; addTp(c, 1); vfx(c.u, 'burst', 'อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } },
});
Object.assign(ABIL, {
  'BT06-022': { zone: 'hell', hint: 'ต้องมี Avatar "แบงค์" 4 ใบบน Avatar Zone ฝ่ายเรา', label: 'ส่ง แบงค์ 4 ใบ แล้วอัญเชิญจากนรก', cond: (r, i) => r.g.turn === i && r.g.phase === 'main' && r.p[i].av.filter(banks).length >= 4,
    run: (r, i, c) => { const p = r.p[i], cu = c.u; ask(r, i, { text: 'แบงค์ผู้พิชิต: เลือก Avatar "แบงค์" 4 ใบบน Avatar Zone ส่งลงนรก', opts: p.av.filter(banks).map(a => a.u), n: 4, min: 4, cancel: true, cb: us => { us.forEach(u => sendHell(r, u)); const m = p.hell.find(h => h.u === cu); if (m && summonAny(r, i, cu, 'hell')) { vfx(cu, 'burst', '🏦 แบงค์ผู้พิชิต!', '#f59e0b'); r.g.q.unshift(() => fxSummon(r, i, m)); } } }); } },
  'BT06-033': { zone: 'hand', hint: 'ต้องมี Avatar "ซินแส" และ "เสามงคล" (คนละใบ) บน Avatar Zone ฝ่ายเรา', label: 'ส่ง ซินแส + เสามงคล ลงนรก แล้วอัญเชิญจากมือ',
    cond: (r, i) => { if (!(r.g.turn === i && r.g.phase === 'main')) return false; const A = r.p[i].av.filter(isAv); return A.some(s => nmOf(s).includes('ซินแส') && A.some(q => q !== s && isPole(q))); },
    run: (r, i, c) => { const p = r.p[i], cu = c.u;
      ask(r, i, { text: 'เสาซินแสมงคล: เลือก Avatar "ซินแส" 1 ใบ ส่งลงนรก', opts: p.av.filter(a => isAv(a) && nmOf(a).includes('ซินแส') && p.av.some(q => q !== a && isPole(q))).map(a => a.u), cancel: true, cb: u1 =>
        ask(r, i, { text: 'เลือก Avatar "เสามงคล" 1 ใบ ส่งลงนรก', opts: p.av.filter(a => isPole(a) && a.u !== u1[0]).map(a => a.u), cancel: true, cb: u2 => { sendHell(r, u1[0]); sendHell(r, u2[0]); const m = p.hand.find(h => h.u === cu); if (m && summonAny(r, i, cu, 'hand')) { vfx(cu, 'burst', '🌳 เสาซินแสมงคล', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, m)); } } }) }); } },
});

/* ===== BT07 รอบ 1: Avatar (เฉพาะใบที่ใช้กลไกเดิมของ engine) ===== */
const B7NK = { 'BT07-023': ['สามัคคี', 'เตะไข่', 'โล่มนุษย์'], 'BT07-025': ['เตะไข่'], 'BT07-033': ['โล่มนุษย์'], 'BT07-037': ['ลูกฮึด', 'โล่มนุษย์'] };   // ข้อความมีคำ keyword แต่ไม่ได้ "มี" keyword นั้นเอง
ATK_TRIG.add('BT07-010'); ATK_TRIG.add('BT07-035');
const isGar = c => !c.tk && ((isAv(c) && B[c.id].n.includes('ครุฑ')) || B[c.id].n.trim() === 'ขนมณี แฟลร์');
const isGarAv = c => isAv(c) && B[c.id].n.includes('ครุฑ') && B[c.id].c <= 4;
const isSpell = c => !c.tk && B[c.id].t === 'Magic' && B[c.id].n.startsWith('คาถา');
const hasHn = (r, i) => r.p[i].av.some(a => !a.tk && nmOf(a).includes('พี่หน่วง') && !noFx(r, a));
const b7Used = (r, i, k) => { const g = r.g; return !!(g.b7 && g.b7.n === g.n && g.b7.k[i + k]); };   // "ใช้ความสามารถของ Avatar ชื่อนี้ได้เทิร์นละ 1 ครั้ง"
const b7Mark = (r, i, k) => { const g = r.g; if (!g.b7 || g.b7.n !== g.n) g.b7 = { n: g.n, k: {} }; g.b7.k[i + k] = 1; };
function mod07(r, x, f) {   // ต่อเนื่อง (POWER)
  if (x.tk) return 0; let v = 0; const me = r.p[f.i];
  if (landOf(r, 'BT07-069', f.i) && isPolice(x) && symOf(x) === 'คน') v += 2;   // สถานีตำรวจ
  if (r.g.land && r.g.land.c.id === 'BT07-070' && isAv(x) && (B[x.id].e || '').includes('โดนใจ')) v += 1;   // งานเลี้ยงโดนใจ
  if ((x.wr || []).some(w => w.id === 'BT07-073')) v += 2;   // บัลลังก์ตั๊กแตน (ผู้สวมใส่)
  if (tkt(x)) v += me.av.filter(a => a !== x && (a.wr || []).some(w => w.id === 'BT07-073')).length;
  if (isAv(x) && nmOf(x).includes('ผีเสื้อ') && (symOf(x) === 'สัตว์มหัศจรรย์' || also9(x, 'สัตว์มหัศจรรย์')) && me.av.some(a => a.id === 'BT07-033' && !noFx(r, a))) v += 1;   // เดซี่
  if (!x.id.startsWith('BT07-') || noFx(r, x)) return v;
  if (x.id === 'BT07-019') v += 2 * me.av.filter(a => !a.tk && nmOf(a).includes('ทหารหิมะ')).length + 3 * me.av.filter(a => !a.tk && nmOf(a).includes('ราชาหิมะ')).length;   // ชีหลิน
  if (x.id === 'BT07-026' && hasHn(r, f.i)) v += 2;   // ทนายกิ๊บ
  if (x.id === 'BT07-024' && hasHn(r, f.i)) v += 1;   // คุณเก่งพลังช้าง
  if (x.id === 'BT07-001') v += r.p.reduce((a, q) => a + q.life.filter(l => l.up).length, 0);   // วันชัยเปรตรุ่นพ่อ
  if (x.id === 'BT07-037' && me.av.some(a => nmOf(a).includes('ตั๊กแตนหยิน'))) v += me.life.filter(l => l.up).length;   // ตั๊กแตนหยาง
  return v;
}
function bt7SumGar(r, i, src, then) {   // อัญเชิญ Avatar "ครุฑ" Cost ≤ 4 จาก Deck แล้วสับ
  const p = r.p[i], L = p.deck.filter(isGarAv).map(c => c.u);
  if (!L.length) { shuf(p.deck); return log(r, 'ไม่มี Avatar "ครุฑ" Cost 4 หรือต่ำกว่าใน Deck (สับ Deck)'); }
  ask(r, i, { text: 'เลือก Avatar "ครุฑ" Cost ≤ 4 จาก Deck อัญเชิญลง Avatar Zone', opts: L, cb: us => { const c = p.deck.find(k => k.u === us[0]), ok = c && summonAny(r, i, c.u, 'deck', src); shuf(p.deck); if (ok) { vfx(c.u, 'burst', '🦅 อัญเชิญครุฑ', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); if (then) then(c); } } });
}
function bt7Atk(r, i, a, tg, tk) {   // อัตโนมัติ เมื่อประกาศโจมตี
  if (a.id === 'BT07-035' && tk === 'av') { const d = r.p[1 - i].av.find(x => x.u === tg); if (d) bt7Guess(r, i, 'เอนโว่', (ok, top, op) => { if (ok) { const t = fromZone(r, 1 - i, 'deck', top.u); if (t) op.hell.push(t); if (find(r, d.u)) { vfx(d.u, 'burst', '💥 ทำลาย', '#ef4444'); destroyAv(r, d.u); } } }); }
  if (a.id === 'BT07-010' && tk === 'av') { const d = r.p[1 - i].av.find(x => x.u === tg); if (d && P(r, d) <= 3) { fx({ k: 'say', id: a.id, t: 'ทำลายเป้าหมาย' }); vfx(d.u, 'burst', 'POWER ≤ 3 ถูกทำลาย', '#ef4444'); log(r, '💥 น้องไอซ์ จี่สมอง: ทำลาย ' + nmOf(d) + ' (POWER ' + P(r, d) + ')'); destroyAv(r, d.u); } }
}
function bt7Death(r, f) {   // คำสั่งเสีย
  const c = f.c, p = r.p[f.i]; if (c.tk) return;
  if (c.id === 'BT07-023') r.g.q.push(() => { const L = mgAvs(r, f.i).map(m => m.u); if (!L.length) return; ask(r, 1 - f.i, { text: 'คำสั่งเสีย พี่หน่วง: เลือก Avatar ใน Magic Zone ฝ่ายตรงข้าม 1 ใบ กลับขึ้นมือเจ้าของ', opts: L, cb: us => { const m = r.p[f.i].mg.find(k => k.u === us[0]); if (m) { const o = mgOut(r, m, 'hand'); log(r, '↩ ' + B[m.id].n + ' กลับขึ้นมือเจ้าของ'); } } }); });
  if (c.id === 'BT07-009') r.g.q.push(() => scout(r, f.i, 3, { text: 'คำสั่งเสีย เจมี่: เลือก อาวุธชีวภาพ เอ็มตัวเต็ง 1 ใบ ขึ้นมือ', pred: x => isAv(x) && B[x.id].n.trim() === 'อาวุธชีวภาพ เอ็มตัวเต็ง', rest: 'bottom', by: c, then: x => { if (x) { p.hand.push(x); log(r, '✨ เจมี่: นำ ' + B[x.id].n + ' ขึ้นมือ'); } } }));
  if (c.id === 'BT07-011') r.g.q.push(() => { const L = r.p[1 - f.i].mg.map(m => m.u); if (!L.length) return log(r, 'คำสั่งเสีย ไอ้แม๊ก: ไม่มีการ์ดใน Magic Zone ฝ่ายตรงข้าม');
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือกการ์ดใน Magic Zone ฝ่ายตรงข้าม 1 ใบ กลับขึ้นมือเจ้าของ', opts: L, cb: us => { vfx(us[0], 'aura', 'กลับขึ้นมือ', '#38bdf8'); log(r, '✨ ไอ้แม๊ก: นำการ์ดใน Magic Zone ฝ่ายตรงข้ามกลับขึ้นมือ'); bounce(r, us[0]); } }); });
  if (c.id === 'BT07-017') r.g.q.push(() => { const L = p.hell.filter(h => !h.tk && isAv(h) && B[h.id].n.trim() === 'วอเตอร์แมน').map(h => h.u);
    const fin = () => { shuf(p.deck); draw(r, p, 1); fx({ k: 'say', id: c.id, t: 'จั่ว 1' }); log(r, '✨ คุณตะพาบ: สับ Deck แล้วจั่ว 1 ใบ'); };
    if (!L.length) { log(r, 'คำสั่งเสีย คุณตะพาบ: ไม่มี วอเตอร์แมน ในนรก'); return fin(); }
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือก วอเตอร์แมน จากนรก กลับเข้า Deck', opts: L, cb: us => { const q = fromZone(r, f.i, 'hell', us[0]); if (q) { p.deck.push(q); log(r, '⬆ นำ วอเตอร์แมน กลับเข้า Deck'); } fin(); } }); });
}
function bt7Spell(r, i, c) {   // 029 จอมเวทย์ กาลู: อัตโนมัติ เทิร์นละครั้ง เมื่อมีการใช้ "คาถา" → จั่ว 1 / 063 ไม้กายสิทธิ์ POWER +1
  if (!isSpell(c)) return;
  r.p.forEach(q => q.mg.filter(m => m.id === 'BT07-063' && m.at).forEach(m => { const t = find(r, m.at); if (t && t.z === 'av') { addTp(t.c, 1); vfx(t.c.u, 'aura', '🪄 POWER +1', '#a855f7'); log(r, '🪄 ไม้กายสิทธิ์: ' + nmOf(t.c) + ' POWER +1 (มีการใช้ คาถา)'); } }));
  r.p.forEach((q, qi) => q.av.filter(a => a.id === 'BT07-029' && !noFx(r, a)).forEach(a => { if (b7Used(r, qi, 'กาลู:auto')) return; b7Mark(r, qi, 'กาลู:auto');
    r.g.q.push(() => { draw(r, q, 1); fx({ k: 'say', id: a.id, t: 'จั่ว 1' }); vfx(a.u, 'aura', '🪄 คาถา → จั่ว 1', '#a855f7'); log(r, '✨ จอมเวทย์ กาลู: มีการใช้ คาถา — ' + q.name + ' จั่ว 1 ใบ'); }); }));
}
Object.assign(SUM, {
  'BT07-003': (r, i, x) => {   // เจ้าแม่กาลี
    const L = r.p[1 - i].av.filter(a => !a.tk && symOf(a) === 'เทพ' && !protectedFrom(r, i, a)).map(a => a.u);
    if (!L.length) { draw(r, r.p[i], 1); vfx(x.u, 'aura', 'ไม่ได้ทำลาย → จั่ว 1', '#facc15'); return log(r, '✨ เจ้าแม่กาลี: ไม่มี Avatar {เทพ} ให้ทำลาย — ' + r.p[i].name + ' จั่ว 1 ใบ'); }
    ask(r, i, { text: 'จุติ: เลือก Avatar {เทพ} ของฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: L, cb: us => { vfx(us[0], 'burst', 'กาลี ทำลาย!', '#ef4444'); log(r, '💥 เจ้าแม่กาลี: ทำลาย ' + nmOf(find(r, us[0]).c)); destroyAv(r, us[0]); } }); },
  'BT07-005': (r, i, x) => {   // ฤๅษีพระเจ้าตา (พอดี)
    if (!x.jt) return log(r, 'ฤๅษีพระเจ้าตา: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    vfx(x.u, 'aura', 'ค้น Magic ฤๅษี', '#f97316'); tutor(r, i, c => !c.tk && B[c.id].t === 'Magic' && B[c.id].s === 'ฤษี', 'Magic Symbol ฤๅษี'); },
  'BT07-009': (r, i, x) => scout(r, i, 7, { text: 'จุติ: เลือก อาวุธชีวภาพ เอ็มตัวเต็ง 1 ใบ ขึ้นมือ', pred: c => isAv(c) && B[c.id].n.trim() === 'อาวุธชีวภาพ เอ็มตัวเต็ง', rest: 'bottom', by: x, then: c => { if (c) { r.p[i].hand.push(c); log(r, '✨ เจมี่: นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }),
  'BT07-014': (r, i, x) => {   // ครุฑวัสสวัส
    const p = r.p[i], L = p.hell.filter(isGar).map(c => c.u); if (!L.length) return log(r, 'จุติ ครุฑวัสสวัส: ไม่มี "ครุฑ"/ขนมณี แฟลร์ ในนรก');
    ask(r, i, { text: 'จุติ: เลือก "ครุฑ"/ขนมณี แฟลร์ ในนรก 1 ใบ กลับใต้ Deck (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return; p.deck.unshift(c); log(r, '⬇ ครุฑวัสสวัส: นำ ' + B[c.id].n + ' กลับใต้ Deck'); bt7SumGar(r, i, x); } }); },
  'BT07-015': (r, i, x) => {   // ครุฑสัจจะ
    const p = r.p[i], L = p.hand.filter(isGar).map(c => c.u); if (!L.length) return log(r, 'จุติ ครุฑสัจจะ: ไม่มี "ครุฑ"/ขนมณี แฟลร์ บนมือ');
    ask(r, i, { text: 'จุติ: ทิ้ง "ครุฑ"/ขนมณี แฟลร์ จากมือ 1 ใบ ลงนรก (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => { sendHell(r, us[0]); log(r, '🗑 ครุฑสัจจะ: ทิ้งการ์ดจากมือลงนรก'); bt7SumGar(r, i, x); } }); },
  'BT07-038': (r, i, x) => {   // วาฬทมิฬ ก้า
    const p = r.p[i];
    if (!p.av.some(a => isAv(a) && nmOf(a).includes('ตั๊กแตน')) || p.life.filter(l => l.up).length < 2) return log(r, 'จุติ วาฬทมิฬ ก้า: ไม่มี Avatar "ตั๊กแตน" หรือ LIFE หงายไม่ถึง 2 ใบ');
    const L = p.hell.filter(h => !h.tk && B[h.id].n.includes('ตั๊กแตน')).map(h => h.u); if (!L.length) return log(r, 'วาฬทมิฬ ก้า: ไม่มี "ตั๊กแตน" ในนรก');
    ask(r, i, { text: 'จุติ: เลือกการ์ด "ตั๊กแตน" 1 ใบ จากนรก ขึ้นมือ', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.hand.push(c); vfx(x.u, 'aura', '🦗 ตั๊กแตน ขึ้นมือ', '#22c55e'); log(r, '✨ วาฬทมิฬ ก้า: นำ ' + B[c.id].n + ' จากนรกขึ้นมือ'); } } }); },
  'BT07-039': (r, i, x) => {   // ตั๊กแตนหญิง
    const p = r.p[i]; if (!p.life.some(l => !l.up)) return log(r, 'จุติ ตั๊กแตนหญิง: ไม่มี LIFE ที่คว่ำอยู่ให้หงาย');
    ask(r, i, { yn: true, text: 'จุติ: หงาย LIFE Card ใบบนสุด 1 ใบ เพื่อนำ "ตั๊กแตน" จาก Deck ขึ้นมือ?', cb: y => { if (!y) return; lifeUp(r, i); vfx(x.u, 'aura', '❤ หงาย LIFE', '#f472b6'); tutor(r, i, c => !c.tk && B[c.id].n.includes('ตั๊กแตน'), 'การ์ด "ตั๊กแตน"'); } }); },
});
Object.assign(AB, {
  'BT07-004': { z: 'av', steps: [{ key: 't', text: 'พรีวิวบอย: เลือก Avatar ของเรา 1 ใบ (POWER ใบนี้ + POWER ของใบที่เลือก จนจบเทิร์น)', opts: (r, i) => r.p[i].av.map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; const v = P(r, t.c); addTp(cx.card, v); vfx(cx.card.u, 'aura', 'POWER +' + v, '#ef4444'); log(r, '✨ พรีวิวบอย: POWER +' + v + ' (ตาม ' + nmOf(t.c) + ') จนจบเทิร์น'); } },
  'BT07-008': { z: 'av', steps: [], run: (r, i, cx) => { const op = r.p[1 - i]; draw(r, op, 1); vfx(cx.card.u, 'aura', 'ศัตรูจั่ว 1', '#ef4444'); log(r, '✨ จ่านิ่ง: ' + op.name + ' จั่ว 1 ใบ');
    if (!op.hand.length) return; ask(r, 1 - i, { text: 'ตำรวจไซบอร์ค จ่านิ่ง: แสดงการ์ดจากมือ 1 ใบ แล้วนำไปไว้บนสุดของ Deck', opts: op.hand.map(c => c.u), cb: us => { const c = fromZone(r, 1 - i, 'hand', us[0]); if (c) { op.deck.push(c); fx({ k: 'scout', i: 1 - i, ids: [c.kd || c.id] }); log(r, '🔎 ' + op.name + ' แสดง ' + B[c.id].n + ' แล้ววางไว้บนสุดของ Deck'); } } }); } },
  'BT07-013': { z: 'av', steps: [{ key: 'h', text: 'ครุฑเวนไตย: เลือก "ครุฑ" (ไม่ใช่ ครุฑเวนไตย เจ้ากำลัง) หรือ ขนมณี แฟลร์ ในนรก 1 ใบ กลับใต้ Deck', opts: (r, i) => r.p[i].hell.filter(c => isGar(c) && B[c.id].n.trim() !== 'ครุฑเวนไตย เจ้ากำลัง').map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.h[0]); if (!c) return; r.p[i].deck.unshift(c); addTp(cx.card, 3); vfx(cx.card.u, 'aura', 'POWER +3', '#38bdf8'); log(r, '✨ ครุฑเวนไตย: นำ ' + B[c.id].n + ' กลับใต้ Deck — POWER +3 จนจบเทิร์น'); } },
  'BT07-029': { z: 'av', can: (r, i) => r.p[i].hand.length > 0, steps: [{ key: 'd', pay: 1, text: 'จอมเวทย์ กาลู: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => b7Used(r, i, 'กาลู:ab') ? [] : r.p[i].hand.map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i]; b7Mark(r, i, 'กาลู:ab'); const H = p.hell.filter(isSpell).map(c => ({ u: c.u, z: 'hell' })), D = p.deck.filter(isSpell).map(c => ({ u: c.u, z: 'deck' })), all = H.concat(D);
      if (!all.length) { shuf(p.deck); return log(r, 'จอมเวทย์ กาลู: ไม่มี Magic "คาถา" ใน Deck/นรก'); }
      ask(r, i, { text: 'เลือก Magic "คาถา" จาก Deck หรือ นรก 1 ใบ ขึ้นมือ', opts: all.map(o => o.u), cb: us => { const o = all.find(q => q.u === us[0]), c = o && fromZone(r, i, o.z, o.u); if (!c) return; p.hand.push(c); if (o.z === 'deck') shuf(p.deck); vfx(cx.card.u, 'aura', '📜 คาถา ขึ้นมือ', '#a855f7'); log(r, '✨ จอมเวทย์ กาลู: นำ ' + B[c.id].n + ' ขึ้นมือ'); } }); } },
});
/* ===== BT07 รอบ 2: Magic / Construct / Life ===== */
const landOf = (r, id, i) => !!(r.g.land && r.g.land.c.id === id && r.g.land.o === i);
const isPolice = a => !a.tk && nmOf(a).includes('ตำรวจ');
const isBank = c => isAv(c) && B[c.id].n.includes('แบงค์');
const hasWiz = (r, i) => r.p[i].av.some(a => isAv(a) && nmOf(a).includes('จอมเวท'));
Object.assign(LIFEX, { 'BT07-074': { z: 'hell', must: 1, max: 2 } });   // ไม่นะ มณโท ! (075 ใช้ระบบจั่วเดิม)
Object.assign(MG, {
  'BT07-048': { cond: (r, i) => r.p[i].av.some(isPolice), steps: [{ key: 'h', text: 'แสดง Avatar "ตำรวจ" บนมือ 1 ใบ ให้ฝ่ายตรงข้ามดู', opts: (r, i) => r.p[i].hand.filter(c => isAv(c) && B[c.id].n.includes('ตำรวจ')).map(c => c.u) },
      { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ นำไปไว้บนสุดของ Deck เจ้าของ', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u) }],
    run: (r, i, cx) => { const h = r.p[i].hand.find(c => c.u === cx.pick.h[0]); if (h) { fx({ k: 'scout', i, ids: [h.kd || h.id] }); log(r, '🔎 ' + r.p[i].name + ' แสดง ' + B[h.id].n); }
      const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; const f = take(r, t.c.u); vfx(t.c.u, 'aura', '👮 หยุด!! → บนสุดของ Deck', '#38bdf8'); if (!f.c.tk) { Object.assign(f.c, { pw: 0, tp: 0, bp: 0, tired: false }); r.p[f.i].deck.push(f.c); } log(r, '👮 หยุด!! นี่ตำรวจ: ' + nmOf(f.c) + ' ไปไว้บนสุดของ Deck เจ้าของ'); } },
  'BT07-050': { run: (r, i) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && B[c.id].n.includes('ทหารหิมะ')).map(c => c.u);
    const fin = () => { shuf(p.deck); if (p.hell.filter(h => isAv(h) && B[h.id].n.includes('หิมะ')).length >= 10) { draw(r, p, 1); log(r, '❄ ราคาชาติที่คุณขาย: นรกมี Avatar "หิมะ" ≥ 10 ใบ จั่ว 1 ใบ'); } };
    if (!L.length) { log(r, 'ราคาชาติที่คุณขาย: ไม่มี "ทหารหิมะ" ใน Deck'); return fin(); }
    ask(r, i, { text: 'เลือก "ทหารหิมะ" 2 ใบ จาก Deck ส่งลงนรก', opts: L, n: 2, min: Math.min(2, L.length), cb: us => { us.forEach(u => { const c = fromZone(r, i, 'deck', u); if (c) p.hell.push(c); }); log(r, '❄ ส่ง ทหารหิมะ ' + us.length + ' ใบ จาก Deck ลงนรก'); fin(); }, none: fin }); } },
  'BT07-051': { cond: (r, i) => hasWiz(r, i), steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ POWER -3 (ถ้าเหลือ 0 ทำลาย)', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; addTp(t.c, -3); vfx(t.c.u, 'aura', 'POWER -3', '#a855f7'); log(r, '🪄 ปลดอาวุสสิวะ: ' + nmOf(t.c) + ' POWER -3');
      if (P(r, t.c) <= 0) { vfx(t.c.u, 'burst', 'POWER 0 ถูกทำลาย', '#ef4444'); destroyAv(r, t.c.u); } } },
  'BT07-053': { cond: (r, i) => r.p[i].life.length > 0 && r.p[i].life.every(l => l.up), steps: [{ key: 't', text: 'เลือก "ตั๊กแตนหยิน" หรือ "ตั๊กแตนหยาง" จากนรก อัญเชิญ', opts: (r, i) => r.p[i].hell.filter(c => !c.tk && isAv(c) && ['ตั๊กแตนหยิน', 'ตั๊กแตนหยาง'].includes(B[c.id].n.trim())).map(c => c.u) }],
    run: (r, i, cx) => { const c = r.p[i].hell.find(h => h.u === cx.pick.t[0]); if (c && summonAny(r, i, c.u, 'hell', cx.card)) { vfx(c.u, 'burst', '🦗 อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } },
  'BT07-056': { run: (r) => { const L = allAv(r).filter(a => a.x.fh).map(a => a.x.u); if (!L.length) return log(r, 'กลับบ้านเก่า: ไม่มี Avatar ที่ถูกอัญเชิญจากนรก'); L.forEach(u => { vfx(u, 'burst', 'กลับบ้านเก่า', '#78716c'); destroyAv(r, u); }); log(r, '🏚 กลับบ้านเก่า: ทำลาย Avatar ที่อัญเชิญจากนรก ' + L.length + ' ใบ'); } },
  'BT07-057': { run: (r, i) => tutor(r, i, c => !c.tk && B[c.id].t === 'Magic' && B[c.id].n.startsWith('แผนการ') && B[c.id].n.trim() !== 'ลิสต์แผนการ', 'Magic "แผนการ"') },
  'BT07-058': { cond: (r, i) => r.p[i].av.some(a => isAv(a) && nmOf(a).includes('แบงค์')), run: (r, i) => { const p = r.p[i];
    scout(r, i, 5, { text: 'แบงค์ Portal: เลือก Avatar "แบงค์" 1 ใบ ขึ้นมือ', pred: isBank, rest: 'none', by: null, then: (got, seen) => { if (got) { p.hand.push(got); log(r, '✨ แบงค์ Portal: นำ ' + B[got.id].n + ' ขึ้นมือ'); }
      const rem = seen.filter(c => c !== got && p.deck.includes(c) && isBank(c)).map(c => c.u); if (!rem.length) return shuf(p.deck);
      ask(r, i, { text: 'แบงค์ Portal: เลือก Avatar "แบงค์" อีก 1 ใบ ส่งลงนรก (ที่เหลือกลับ Deck แล้วสับ)', opts: rem, cb: us => { const c = fromZone(r, i, 'deck', us[0]); if (c) { p.hell.push(c); log(r, '🗑 แบงค์ Portal: ส่ง ' + B[c.id].n + ' ลงนรก'); } shuf(p.deck); }, none: () => shuf(p.deck) }); } }); } },
  'BT07-059': { react: 'atk', cond: (r, i) => r.p[i].av.some(a => isAv(a) && nmOf(a).includes('ครุฑ')) && r.p[1 - i].av.length > 0,
    steps: [{ key: 'g', text: 'เลือก Avatar "ครุฑ" ของเรา 1 ใบ ทำลาย (เป็น Cost)', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('ครุฑ')).map(a => a.u) },
      { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้ามสูงสุด 2 ใบ ทำลาย', n: 2, min: 1, opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u) }],
    run: (r, i, cx) => { vfx(cx.pick.g[0], 'burst', 'พันปักษา', '#38bdf8'); destroyAv(r, cx.pick.g[0]); cx.pick.t.forEach(u => { const t = find(r, u); if (t && t.z === 'av') { vfx(u, 'burst', 'ถูกทำลาย', '#ef4444'); destroyAv(r, u); } }); log(r, '🦅 พันปักษา: ทำลาย Avatar ฝ่ายตรงข้าม ' + cx.pick.t.length + ' ใบ'); } },
  'BT07-060': { react: 'atkAv', cond: (r, i) => { const p = r.g.pend; return !!(p && p.tk === 'av' && hasWiz(r, i) && r.p[i].av.some(a => a.u === p.tg && isAv(a) && nmOf(a).includes('จอมเวท')) && r.p[i].hell.some(isSpell)); },
    steps: [{ key: 's', text: 'เลือก "คาถา" ในนรก 1 ใบ กลับเข้าใต้ Deck', opts: (r, i) => r.p[i].hell.filter(isSpell).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.s[0]); if (c) r.p[i].deck.unshift(c); if (cx.pend) cx.pend.cancel = 1; log(r, '🛑 คาถา สตอปปุ: ยกเลิกการโจมตี'); } },
  'BT07-063': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar "จอมเวท" ที่จะสวมใส่ ไม้กายสิทธิ์', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('จอมเวท')).map(a => a.u) }] },
  'BT07-065': { mod: 1, steps: [{ key: 'tg', text: 'เลือก Avatar ที่จะสวมใส่ ปลอกคอซื่อสัตย์', opts: myAvs }] },
  'BT07-067': {}, 'BT07-069': {},   // Land แบบต่อเนื่อง: ผลอยู่ใน P / hasKw / mod07
});
Object.assign(AB, {
  'BT07-066': { z: 'land', can: (r, i) => hasPlane(r, i) && r.p[i].hand.length > 0, steps: [{ key: 'd', pay: 1, text: 'อาคารผู้โดยสารชั้นต่ำ: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => hasPlane(r, i) ? r.p[i].hand.map(c => c.u) : [] }],
    run: (r, i, cx) => { const p = r.p[i], isPax = c => !c.tk && isAv(c) && B[c.id].n.includes('ผู้โดยสาร Super Air'), H = p.hell.filter(isPax).map(c => ({ u: c.u, z: 'hell' })), D = p.deck.filter(isPax).map(c => ({ u: c.u, z: 'deck' })), all = H.concat(D);
      if (!all.length) return log(r, 'อาคารผู้โดยสารฯ: ไม่มี "ผู้โดยสาร Super Air" ในนรก/Deck');
      ask(r, i, { text: 'เลือก "ผู้โดยสาร Super Air" จากนรกหรือ Deck อัญเชิญ', opts: all.map(o => o.u), cb: us => { const o = all.find(q => q.u === us[0]), c = o && p[o.z].find(k => k.u === o.u); if (c && summonAny(r, i, c.u, o.z, cx.card)) { if (o.z === 'deck') shuf(p.deck); vfx(c.u, 'burst', '✈ ผู้โดยสาร', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); } },
  'BT07-068': { z: 'land', steps: [{ key: 't', text: 'ดินแดนหิมะสีเทา: เลือก Avatar "หิมะ" {ชาวต่างชาติ} ของเรา 1 ใบ', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('หิมะ') && (symOf(a) === 'ต่างชาติ' || also9(a, 'ต่างชาติ'))).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; const n = Math.floor(r.p[i].hell.filter(h => isAv(h) && B[h.id].n.includes('ทหารหิมะ')).length / 2); addTp(t.c, n); vfx(t.c.u, 'aura', '❄ POWER +' + n, '#38bdf8'); log(r, '❄ ดินแดนหิมะสีเทา: ' + nmOf(t.c) + ' POWER +' + n + ' จนจบเทิร์น'); } },
});
Object.assign(ABIL, {
  'BT07-072': { zone: 'co', once: 1, label: 'ให้ Avatar โล่มนุษย์ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', run: (r, i, x) => { ask(r, i, { text: 'ยานรายการ: เลือก Avatar 1 ใบ ได้รับ โล่มนุษย์ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', opts: allAv(r).map(a => a.x.u), cb: us => { const t = find(r, us[0]); if (!t || t.z !== 'av') return; t.c.hs7 = r.g.n + 1; vfx(t.c.u, 'aura', '🛡 โล่มนุษย์', '#a855f7'); log(r, '🛡 ยานรายการ: ' + nmOf(t.c) + ' ได้รับ โล่มนุษย์ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม'); } }); } },
});
{ const w = d => { if (d.__w) return; d.__w = 1; if (d.steps) d.steps = d.steps.map(s => ({ ...s, opts: (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return s.opts(...a); } finally { MGX--; MGWHO = o; } } })); if (d.run) { const f = d.run; d.run = (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return f(...a); } finally { MGX--; MGWHO = o; } }; } };   // เหมือนกับ BT04: Magic ฝ่ายตรงข้ามไม่มีผลกับ ริกกี้ คุณตา
  Object.keys(MG).filter(k => k.startsWith('BT07-')).forEach(k => w(MG[k])); }
/* ===== BT07 รอบ 3: ที่เหลือ (End Phase / Magic Zone / LIFE / ประกาศประเภท ฯลฯ) ===== */
const tkt = a => isAv(a) && (nmOf(a).includes('ตั๊กแตน') || (B[a.id].e || '').includes('ตั๊กแตน'));
const isCrit = (r, i) => r.p[i].life.length > 0 && r.p[i].life.every(l => l.up);
const hasThrone = (r, i) => r.p[i].co.some(k => k.id === 'BT07-073') || r.p[i].av.some(a => (a.wr || []).some(w => w.id === 'BT07-073'));
const bt7G = (c, d, me) => {   // Gem พิเศษ: 006 (6 GEM ให้ อนันต์ ราชาแห่งนาค) / 007 (8 GEM ไร้สี)
  if (d.id === 'BT07-006' && c.n && c.n.trim() === 'อนันต์ ราชาแห่งนาค') return 6;
  if (d.id === 'BT07-007' && me && me.hell && new Set(me.hell.filter(h => !h.tk && B[h.id].t === 'Avatar').map(h => B[h.id].n.trim())).size >= 10) return 8;
  return 0; };
const giantG = (c, d, me) => bt7G(c, d, me) || giantG0(c, d, me) || bt9G(c, d);
COST03['BT07-006'] = { ok: c => (symOf(c) === 'สัตว์มหัศจรรย์' || also9(c, 'สัตว์มหัศจรรย์')), msg: 'อนันตวดี ใช้เป็น Cost ได้เฉพาะ Avatar {สัตว์มหัศจรรย์}' };
function bt7Cost(r, i, c, ps) { const n = ps.filter(q => q.id === 'BT07-006').length; if (n && nmOf(c).includes('นาค') && (symOf(c) === 'สัตว์มหัศจรรย์' || also9(c, 'สัตว์มหัศจรรย์'))) { addTp(c, 3 * n); vfx(c.u, 'aura', '🐍 POWER +' + 3 * n, '#ef4444'); log(r, '🐍 อนันตวดี: ' + nmOf(c) + ' POWER +' + 3 * n + ' จนจบเทิร์น'); } }
function toMg(r, i, u) {   // นำ Avatar ไปไว้ Magic Zone ของผู้เล่น i
  const f = find(r, u); if (!f || f.z !== 'av' || f.c.tk) return null; const own = f.c.oo != null ? f.c.oo : f.i; take(r, u); delete f.c.ctl; delete f.c.oo;
  Object.assign(f.c, { pw: 0, tp: 0, bp: 0, tired: false, mgAv: 1, mgOwner: own }); r.p[i].mg.push(f.c); fx({ k: 'say', id: f.c.kd || f.c.id, t: 'ไป Magic Zone' }); vfx(f.c.u, 'aura', '🌀 ไป Magic Zone', '#a855f7'); return f.c; }
function mgOut(r, c, to) {   // Avatar ใน Magic Zone → มือ/นรก ของเจ้าของ
  r.p.forEach(q => { const k = q.mg.indexOf(c); if (k >= 0) q.mg.splice(k, 1); }); const o = c.mgOwner != null ? c.mgOwner : 0; delete c.mgAv; delete c.mgOwner; r.p[o][to].push(c); return o; }
const mgAvs = (r, i, foreign) => r.p[i].mg.filter(m => m.mgAv && (!foreign || m.mgOwner !== i));
const typeAsk = (r, i, text, cb) => ask(r, i, { text, choices: ['Avatar', 'Magic', 'Construct', 'Life'], cb: k => cb(['Avatar', 'Magic', 'Construct', 'Life'][k]) });
function bt7Guess(r, i, srcName, win) {   // ประกาศประเภทการ์ดบนสุดของ Deck ฝ่ายตรงข้าม แล้วสอดแนม 1 ใบ
  const op = r.p[1 - i]; if (!op.deck.length) return log(r, srcName + ': Deck ฝ่ายตรงข้ามหมด');
  typeAsk(r, i, srcName + ': ประกาศประเภทของการ์ดบนสุดของ Deck ฝ่ายตรงข้าม', t => { const top = op.deck[op.deck.length - 1]; fx({ k: 'scout', i, ids: [top.kd || top.id] }); const ok = B[top.id].t === t;
    log(r, '🔎 ' + srcName + ': ประกาศ ' + t + ' · สอดแนมเจอ ' + B[top.id].n + (ok ? ' ✔ ถูก' : ' ✘ ผิด')); win(ok, top, op); }); }
function bt7After(r, p, a) {   // 028 ไอ้ดำ: หลังจบการต่อสู้
  if (!a || (a.id !== 'BT07-028' && !(a.id === 'BT08-023' && a.gain8 === 'BT07-028')) || noFx(r, a) || a.ou7 === r.g.n || !find(r, a.u)) return; const i = p.ai, L = r.p[i].av.filter(x => x.u !== a.u).map(x => x.u); if (!L.length) return;
  ask(r, i, { yn: true, text: 'ไอ้ดำ จากนรก: เซ่นไหว้ Avatar ใบอื่น 1 ใบ เพื่อเปลี่ยนเป็นสภาพตื่น?', cb: y => { if (!y) return; ask(r, i, { text: 'เลือก Avatar ที่จะเซ่นไหว้', opts: L, cb: us => { a.ou7 = r.g.n; sac(r, us[0]); a.tired = false; vfx(a.u, 'aura', '🔥 ตื่น', '#a855f7'); log(r, '🔥 ไอ้ดำ: เซ่นไหว้แล้วเปลี่ยนเป็นสภาพตื่น'); } }); } }); }
function bt7Draw(r, i) {   // 040 หมอเลิฟ: Draw Phase ที่ 2 หลังทำงาน → การ์ดในนรกขึ้นมือ
  ccDrawPhase(r, i);
  const p = r.p[i]; p.hell.filter(c => c.h40).forEach(c => { c.h40++; if (c.h40 > 2) { p.hell.splice(p.hell.indexOf(c), 1); delete c.h40; p.hand.push(c); log(r, '🩺 หมอเลิฟ: ' + B[c.id].n + ' ขึ้นมือ (Draw Phase ที่ 2)'); } }); }
function bt7End(r, i) {   // เข้า End Phase ของเรา
  const g = r.g, p = r.p[i]; if (g.e72 === g.n) return; g.e72 = g.n; ccEndPhase(r, i); cc2EndPhase(r, i);
  if (p.co.some(k => k.id === 'BT07-072') && hasHn(r, i) && mgAvs(r, i, 1).length) { draw(r, p, 1); log(r, '🚀 ยานรายการ: มี Avatar ฝ่ายตรงข้ามใน Magic Zone — จั่ว 1 ใบ'); } }
Object.assign(SUM, {
  'BT07-002': (r, i, x) => { const p = r.p[i]; if (!p.hand.length) return log(r, 'จุติ พระแม่อุมาเทวี: ไม่มีการ์ดบนมือให้ทิ้ง');
    ask(r, i, { text: 'จุติ: ทิ้งการ์ดจากมือ 1 ใบ เพื่อนำการ์ด Symbol เทพ (ไม่ใช่ Only) จากนรกขึ้นมือ (ยกเลิก = ไม่ใช้)', opts: p.hand.map(c => c.u), cancel: true, cb: us => { sendHell(r, us[0]); const L = p.hell.filter(c => !c.tk && B[c.id].s === 'เทพ' && B[c.id].o !== 'Only #1').map(c => c.u); if (!L.length) return;
      ask(r, i, { text: 'เลือกการ์ด Symbol เทพ จากนรก ขึ้นมือ', opts: L, cb: u2 => { const c = fromZone(r, i, 'hell', u2[0]); if (c) { p.hand.push(c); log(r, '✨ พระแม่อุมาเทวี: นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }); } }); },
  'BT07-023': (r, i, x) => { const p = r.p[i], isY = c => !c.tk && B[c.id].n.trim() === 'ยานรายการ เถียงทันหน่วง', all = p.deck.filter(isY).map(c => ({ u: c.u, z: 'deck' })).concat(p.hell.filter(isY).map(c => ({ u: c.u, z: 'hell' })));
    if (!all.length) return log(r, 'จุติ พี่หน่วง: ไม่มี ยานรายการ ใน Deck/นรก');
    ask(r, i, { text: 'จุติ: เลือก ยานรายการ เถียงทันหน่วง จาก Deck หรือนรก ขึ้นมือ', opts: all.map(o => o.u), cb: us => { const o = all.find(q => q.u === us[0]), c = o && fromZone(r, i, o.z, o.u); if (c) { p.hand.push(c); if (o.z === 'deck') shuf(p.deck); log(r, '✨ พี่หน่วง: นำ ยานรายการ ขึ้นมือ'); } } }); },
  'BT07-024': (r, i, x) => { const L = mgAvs(r, i, 1).map(m => m.u); if (!L.length) return log(r, 'จุติ คุณเก่งพลังช้าง: ไม่มี Avatar ฝ่ายตรงข้ามใน Magic Zone เรา');
    ask(r, i, { text: 'จุติ: ทำลาย Avatar ฝ่ายตรงข้ามที่อยู่ใน Magic Zone เรา 1 ใบ (ไม่เลือกก็ได้)', opts: L, n: 1, min: 0, cb: us => { const m = us.length && r.p[i].mg.find(k => k.u === us[0]); if (!m) return; mgOut(r, m, 'hell'); x.pw = (x.pw || 0) + 3; vfx(x.u, 'burst', 'POWER +3', '#a855f7'); log(r, '💥 คุณเก่งพลังช้าง: ทำลาย ' + B[m.id].n + ' ใน Magic Zone — POWER +3'); } }); },
  'BT07-031': (r, i, x) => { const p = r.p[i]; if (b7Used(r, i, 'เบล่า:sum') || !p.av.some(a => a !== x && isAv(a) && nmOf(a).includes('จอมเวทย์') && nmOf(a) !== nmOf(x))) return log(r, 'จุติ จอมเวทย์ เบล่า: เงื่อนไขไม่ครบ');
    const L = p.hell.filter(c => !c.tk && B[c.id].st === 'Normal' && isSpell(c)).map(c => c.u); if (!L.length) return log(r, 'จุติ จอมเวทย์ เบล่า: ไม่มี Normal Magic "คาถา" ในนรก'); b7Mark(r, i, 'เบล่า:sum');
    ask(r, i, { text: 'จุติ: เลือก Normal Magic "คาถา" ในนรก แล้วสั่งใช้ผลความสามารถ', opts: L, cb: us => { const c = p.hell.find(k => k.u === us[0]), d = c && MG[c.id]; if (!d) return log(r, 'ยังไม่รองรับผลการ์ดใบนี้'); try { if (d.cond && !d.cond(r, i)) return log(r, 'จอมเวทย์ เบล่า: ' + B[c.id].n + ' ใช้ไม่ได้ (เงื่อนไขไม่ครบ)'); startUse(r, i, c, d); } catch (e) { log(r, 'จอมเวทย์ เบล่า: ใช้ผล ' + B[c.id].n + ' ไม่ได้'); } } }); },
  'BT07-036': (r, i, x) => { const p = r.p[i]; lifeUp(r, i); const U = p.life.filter(l => l.up); if (!U.length) return;
    ask(r, i, { text: 'จุติ: เลือก LIFE Card ของเรา 1 ใบ ให้คว่ำ (คว่ำได้แม้สาหัส)', choices: U.map((l, k) => (k + 1) + ') ' + B[l.id].n), cb: k => { const l = U[k]; if (!l) return; l.up = 0; const j = (p.lf || []).indexOf(l.id); if (j >= 0) p.lf.splice(j, 1); fx({ k: 'life', i }); vfx(x.u, 'aura', '❤ คว่ำ LIFE', '#22c55e'); log(r, '❤ ตั๊กแตนหยิน: คว่ำ LIFE ' + B[l.id].n); } }); },
  'BT07-040': (r, i, x) => { const p = r.p[i]; if (!p.deck.length) return log(r, 'จุติ หมอเลิฟ: Deck หมด');
    ask(r, i, { text: 'จุติ: เลือกการ์ดจาก Deck 1 ใบ แสดงให้ฝ่ายตรงข้ามดู แล้วส่งลงนรก (จะขึ้นมือใน Draw Phase ที่ 2 ของเรา)', opts: p.deck.map(c => c.u), cb: us => { const c = fromZone(r, i, 'deck', us[0]); if (!c) return; fx({ k: 'scout', i, ids: [c.kd || c.id] }); c.h40 = 1; p.hell.push(c); shuf(p.deck); log(r, '🩺 หมอเลิฟ: ส่ง ' + B[c.id].n + ' ลงนรก (ขึ้นมือ Draw Phase ที่ 2)'); } }); },
});
Object.assign(AB, {
  'BT07-001': { z: 'av', can: (r, i) => r.p[i].life.some(l => !l.up), steps: [], run: (r, i, cx) => { const l = r.p[i].life.find(x => !x.up); if (!l) return; lifeUp(r, i); vfx(cx.card.u, 'aura', '❤ ใช้ผล LIFE', '#ef4444'); log(r, '❤ วันชัยเปรต: ใช้ผล LIFE ' + B[l.id].n + ' ทันที'); lifeFx(r, i, l.id); } },
  'BT07-022': { z: 'av', steps: [{ key: 't', text: 'ชาช่าจัง: เลือก Avatar "ไอดอล" ของเราที่สวมใส่ "โอตะ" อยู่ 1 ใบ (ทำลาย โอตะ 1 ใบ)', opts: (r, i) => r.p[i].av.filter(a => isIdol(a) && (a.wr || []).some(isOtaC)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; const ot = (t.c.wr || []).filter(isOtaC);
      const go = o => { t.c.wr.splice(t.c.wr.indexOf(o), 1); r.p[i].hell.push(o); cx.card.ao7 = r.g.n; vfx(cx.card.u, 'aura', '⚔ โจมตีได้', '#38bdf8'); log(r, '💥 ชาช่าจัง: ทำลาย ' + B[o.id].n + ' — เทิร์นนี้โจมตีได้'); };
      if (ot.length === 1) return go(ot[0]); ask(r, i, { text: 'เลือก โอตะ ที่จะทำลาย', opts: ot.map(o => o.u), cb: us => { const o = ot.find(k => k.u === us[0]); o && go(o); } }); } },
  'BT07-023': { z: 'av', can: (r, i) => r.p[i].co.some(k => k.id === 'BT07-072') && r.p[i].hand.length > 0, steps: [{ key: 'd', pay: 1, text: 'พี่หน่วง: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }, { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้ามที่มี สามัคคี / เตะไข่ / โล่มนุษย์ / คำสั่งเสีย 1 ใบ ไปไว้ Magic Zone เรา', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a) && ['สามัคคี', 'เตะไข่', 'โล่มนุษย์', 'คำสั่งเสีย'].some(k => hasKw(r, a, k))).map(a => a.u) }],
    run: (r, i, cx) => { const c = toMg(r, i, cx.pick.t[0]); if (c) log(r, '🌀 พี่หน่วง: นำ ' + B[c.id].n + ' ไปไว้ Magic Zone ของเรา'); } },
  'BT07-030': { z: 'av', can: (r, i) => !b7Used(r, i, 'อะปัด:ab'), steps: [], run: (r, i, cx) => { b7Mark(r, i, 'อะปัด:ab'); r.g.x30 = { n: r.g.n, who: i, done: 0 }; vfx(cx.card.u, 'aura', '🪄 ใช้ คาถา เพิ่ม 1 ใบ', '#a855f7'); log(r, '🪄 จอมเวทย์ อะปัด: เทิร์นนี้ใช้ Normal Magic "คาถา" เพิ่มได้ 1 ใบ'); } },
  'BT07-032': { z: 'av', end: 1, steps: [{ key: 't', text: 'เอ็มตัวเต็ง: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ทำลาย แล้วทำความเสียหายใส่ LIFE ใบบนสุด 1 ครั้ง', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t && t.z === 'av') { vfx(t.c.u, 'burst', '💥 ทำลาย', '#ef4444'); destroyAv(r, t.c.u); } r.g.q.push(() => { const d = r.p[1 - i]; const res = hit(r, d, r.p[i]); vfx(d.life[0] && d.life[0].u, 'burst', '💔 LIFE', '#ef4444'); log(r, '💔 เอ็มตัวเต็ง: ทำความเสียหายใส่ LIFE ' + d.name + (res === 'KO' ? ' — KO!' : '')); }); } },
  'BT07-033': { z: 'av', end: 1, steps: [{ key: 't', text: 'เดซี่: เลือก Avatar "ผีเสื้อ" {สัตว์มหัศจรรย์} จาก Deck อัญเชิญ', opts: (r, i) => r.p[i].deck.filter(c => isAv(c) && B[c.id].n.includes('ผีเสื้อ') && B[c.id].s === 'สัตว์มหัศจรรย์').map(c => c.u) }],
    run: (r, i, cx) => { const c = r.p[i].deck.find(k => k.u === cx.pick.t[0]); const ok = c && summonAny(r, i, c.u, 'deck', cx.card); shuf(r.p[i].deck); if (ok) { vfx(c.u, 'burst', '🦋 อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } },
  'BT07-036': { z: 'av', can: (r, i) => hasThrone(r, i) && r.p[i].hand.length > 0 && r.p[i].life.some(l => l.up), steps: [{ key: 'd', pay: 1, text: 'ตั๊กแตนหยิน: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i, cx) => { const U = r.p[i].life.filter(l => l.up); if (!U.length) return; ask(r, i, { text: 'เลือก LIFE Card ที่หงายอยู่ 1 ใบ สั่งใช้ผลความสามารถ', choices: U.map((l, k) => (k + 1) + ') ' + B[l.id].n), cb: k => { const l = U[k]; if (!l) return; vfx(cx.card.u, 'aura', '❤ ใช้ผล LIFE', '#22c55e'); log(r, '❤ ตั๊กแตนหยิน: ใช้ผล LIFE ' + B[l.id].n); lifeFx(r, i, l.id); } }); } },
  'BT07-043': { z: 'av', end: 1, steps: [], run: (r, i, cx) => { const d = 1 + Math.floor(Math.random() * 6); vfx(cx.card.u, 'aura', '🎲 ' + d, '#38bdf8'); log(r, '🎲 แมรี่: ทอยลูกเต๋าได้ ' + d + ' — สอดแนม ' + d + ' ใบ');
    scout(r, i, d, { text: 'แมรี่: เลือก Avatar 1 ใบ จากที่สอดแนม ขึ้นมือ (ที่เหลือไว้ใต้สุดของ Deck)', pred: c => isAv(c), rest: 'bottom', by: cx.card, then: c => { if (c) { r.p[i].hand.push(c); log(r, '✨ แมรี่: นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }); } },
});
Object.assign(ABIL, {
  'BT07-021': { zone: 'hand', label: 'แสดง + ทิ้งการ์ดที่ GEM รวม 3 → อัญเชิญ (POWER ตั้งต้น 3)', hint: 'ต้องมีที่ว่างใน Avatar Zone และมีการ์ดมี GEM บนมือ', cond: (r, i, c) => canPlaceAv(r, i, c) && r.p[i].hand.some(h => h.u !== c.u && B[h.id].g > 0),
    run: (r, i, c) => { const p = r.p[i], L = p.hand.filter(h => h.u !== c.u && B[h.id].g > 0).map(h => h.u); fx({ k: 'scout', i, ids: [c.kd || c.id] });
      ask(r, i, { text: 'อัศวินแบงค์: เลือกการ์ดบนมือที่จะทิ้ง ให้ GEM รวมกัน = 3 พอดี', opts: L, n: L.length, min: 1, cancel: true, cb: us => { const sum = us.reduce((a, u) => a + B[p.hand.find(h => h.u === u).id].g, 0); if (sum !== 3) return log(r, 'อัศวินแบงค์: GEM รวม ' + sum + ' ไม่เท่ากับ 3 — ยกเลิก');
        us.forEach(u => sendHell(r, u)); if (summonAny(r, i, c.u, 'hand', c)) { c.pw = (c.pw || 0) - ((B[c.id].p || 0) - 3); c.b21 = 1; vfx(c.u, 'burst', '⚔ POWER ตั้งต้น 3', '#38bdf8'); log(r, '⚔ อัศวินแบงค์: อัญเชิญ (POWER ตั้งต้น 3)'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); } },
  'BT07-034': { zone: 'hand', once: 1, label: 'ประกาศประเภทการ์ดบนสุด Deck ศัตรู → สอดแนม', hint: 'Deck ฝ่ายตรงข้ามหมด', cond: (r, i, c) => r.p[1 - i].deck.length > 0 && canPlaceAv(r, i, c),
    run: (r, i, c) => bt7Guess(r, i, 'ไซเฮย์', (ok, top, op) => { if (ok) { const t = fromZone(r, 1 - i, 'deck', top.u); if (t) op.hell.push(t); if (summonAny(r, i, c.u, 'hand', c)) { vfx(c.u, 'burst', '👮 อัญเชิญฟรี', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } else { sendHell(r, c.u); log(r, '🗑 ไซเฮย์: ทายผิด ทิ้งการ์ดใบนี้'); } }) },
  'BT07-073': { zone: 'co', once: 1, label: 'สวมใส่ให้ Avatar "ตั๊กแตน"', run: (r, i, x) => { const L = r.p[i].av.filter(a => tkt(a) && !(a.wr || []).some(w => w.id === 'BT07-073')).map(a => a.u); if (!L.length) { x.ou = 0; return log(r, 'บัลลังก์ตั๊กแตน: ไม่มี Avatar "ตั๊กแตน" ให้สวมใส่'); }
    ask(r, i, { text: 'บัลลังก์ตั๊กแตนศตวรรษ: เลือก Avatar "ตั๊กแตน" ที่จะสวมใส่', opts: L, cb: us => { const t = find(r, us[0]); if (!t || !find(r, x.u)) return; take(r, x.u); wearOn(r, i, t.c, x); vfx(t.c.u, 'aura', '👑 บัลลังก์ POWER +2', '#22c55e'); log(r, '👑 บัลลังก์ตั๊กแตน: ' + nmOf(t.c) + ' สวมใส่ (POWER +2, โจมตีไม่ได้)'); } }); } },
});
Object.assign(MG, {
  'BT07-052': { cond: (r, i) => r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('จอมเวท')).length >= 2, steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม POWER ≥ 5 ส่งไป Magic Zone ของฝ่ายตรงข้าม(เจ้าของ Magic)', opts: (r, i) => r.p[1 - i].av.filter(a => P(r, a) >= 5 && !protectedFrom(r, i, a, 1)).map(a => a.u) }],
    run: (r, i, cx) => { const c = toMg(r, i, cx.pick.t[0]); if (c) log(r, '🌀 สัตตูหลีกปาย: นำ ' + B[c.id].n + ' ไปไว้ Magic Zone'); } },
  'BT07-054': { cond: (r, i) => r.p[i].av.some(a => nmOf(a).includes('เสาซินแสมงคล')) && r.p[i].hand.length >= 7, steps: [{ key: 'd', pay: 1, n: 7, min: 7, text: 'ทิ้งการ์ดบนมือ 7 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }, { key: 't', text: 'เลือก Avatar "เสามงคล" จากนรก ไปไว้ Magic Zone เรา', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && B[c.id].n.includes('เสามงคล')).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.t[0]); if (!c) return; Object.assign(c, { mgAv: 1, mgOwner: i }); r.p[i].mg.push(c); vfx(c.u, 'aura', '🏛 Magic Zone', '#f97316'); log(r, '🏛 พลังแห่งควางสิริมงคง: นำ ' + B[c.id].n + ' ไว้ Magic Zone'); } },
  'BT07-055': { cond: (r, i) => r.p[i].av.some(a => isIdol(a) && (a.wr || []).some(isOtaC)) && r.p[i].deck.some(c => isAv(c) && nmHas(c, 'ไอดอล')), steps: [{ key: 't', text: 'เลือก Avatar "ไอดอล" ที่สวมใส่ "โอตะ" อยู่ 1 ใบ', opts: (r, i) => r.p[i].av.filter(a => isIdol(a) && (a.wr || []).some(isOtaC)).map(a => a.u) }],
    run: (r, i, cx) => { const p = r.p[i], t = find(r, cx.pick.t[0]); if (!t) return; const old = t.c, ot = old.wr.filter(isOtaC); old.wr = old.wr.filter(w => !isOtaC(w)); take(r, old.u); Object.assign(old, { pw: 0, tp: 0, bp: 0, tired: false }); p.deck.push(old);
      const L = p.deck.filter(c => isAv(c) && nmHas(c, 'ไอดอล') && B[c.id].n.trim() !== B[old.id].n.trim()).map(c => c.u);
      const fin = c => { if (c && summonAny(r, i, c.u, 'deck', cx.card)) { ot.forEach(o => wearOn(r, i, c, o)); vfx(c.u, 'burst', '🎤 เปลี่ยนเมน', '#f472b6'); log(r, '🎤 เปลี่ยนเมน: ' + B[c.id].n + ' รับ โอตะ ' + ot.length + ' ใบ'); r.g.q.unshift(() => fxSummon(r, i, c)); } else ot.forEach(o => p.hell.push(o)); shuf(p.deck); };
      if (!L.length) return fin(null); ask(r, i, { text: 'เลือก Avatar "ไอดอล" คนละชื่อจาก Deck อัญเชิญ (โอตะที่สวมใส่จะย้ายตาม)', opts: L, cb: us => fin(p.deck.find(k => k.u === us[0])) }); } },
  'BT07-070': {},
});
{ const w = d => { if (d.__w) return; d.__w = 1; if (d.steps) d.steps = d.steps.map(s => ({ ...s, opts: (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return s.opts(...a); } finally { MGX--; MGWHO = o; } } })); if (d.run) { const f = d.run; d.run = (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return f(...a); } finally { MGX--; MGWHO = o; } }; } };
  ['BT07-052', 'BT07-054', 'BT07-055'].forEach(k => w(MG[k])); }
/* ===== BT07 รอบ 4: ใบที่เหลือ (012 / 027 / 049 / 062 / 064 + 002 / 022 / 037 / 040 ส่วนที่ขาด) ===== */
const r049 = (r, i, c) => (c.id === 'BT07-049' && r.g.turn !== i && r.p[i].av.some(isPolice)) || (c.id === 'BT08-051' && (r.g.turn !== i || r.g.phase === 'battle')) || (c.id === 'BT09-057' && (r.g.turn !== i || r.g.phase === 'battle'));   // ใช้เป็น React ถ้ามี "ตำรวจ"
const wearBlock7 = (t, card) => !!(CR && t && !noFx(CR, t) && ((t.id === 'BT09-008' && !/อาวุ[ธร]ของเพมมุ/.test(B[card.id].n)) || (t.id === 'BT07-022' && !isOtaC(card)) || (t.id === 'BT07-037' && B[card.id].s !== 'แมลง')));
const bt7WearF = (c, steps) => steps.map(s => s.key === 'tg' ? { ...s, opts: (...a) => s.opts(...a).filter(u => { const f = find(a[0], u); return !(f && wearBlock7(f.c, c)); }) } : s);
function w62(r, f0, redo) {   // BT07-062 ขนมณี แฟลร์: แทนการถูกนำออกจากสนามด้วยความสามารถ
  if (!f0 || f0.z !== 'av' || r.g.inB) return false; if (f0.c.n62) { delete f0.c.n62; return false; }
  const m = r.p.flatMap(q => q.mg).find(k => k.at === f0.c.u && k.id === 'BT07-062'); if (!m || r.g.ask) return false;
  ask(r, f0.i, { yn: true, text: 'ขนมณี แฟลร์: ส่งการ์ดนี้ในสภาพสวมใส่ลงนรก เพื่อให้ ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนามไหม?', cb: y => { if (y) { const q = r.p.find(q => q.mg.includes(m)); q.mg.splice(q.mg.indexOf(m), 1); r.p[f0.i].hell.push(m); vfx(f0.c.u, 'aura', '🛡 ขนมณี แฟลร์', '#38bdf8'); log(r, '🛡 ขนมณี แฟลร์: ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนาม'); } else { f0.c.n62 = 1; redo(); } } });
  return true; }
function bt7EndTurn(r, prev) {   // 012: Avatar ที่ได้รับ "เมื่อจบเทิร์น นำขึ้นมือ"
  r.p[prev].av.filter(a => a.eh7).forEach(a => { delete a.eh7; if (!find(r, a.u)) return; const f = take(r, a.u); Object.assign(f.c, { pw: 0, tp: 0, bp: 0, tired: false }); r.p[prev].hand.push(f.c); log(r, '↩ ' + nmOf(f.c) + ' กลับขึ้นมือ (จบเทิร์น)'); }); }
function bt7Back(r, i) {   // 027: คืน Avatar ที่ยึดไว้ เมื่อจบ Draw Phase ของเจ้าของ
  r.p.forEach((q, qi) => q.av.filter(a => a.c7 && a.oo === i && qi !== i).forEach(a => { delete a.c7; delete a.oo; q.av.splice(q.av.indexOf(a), 1); a.tired = false; if (canPlaceAv(r, i, a)) { r.p[i].av.push(a); log(r, '↩ ' + nmOf(a) + ' กลับไปฝั่งเจ้าของ (จบ Draw Phase)'); } else r.p[i].hell.push(a); })); }
Object.assign(SUM, {
  'BT07-027': (r, i, x) => {   // พี่วัฒน์ BGN (พอดี จุติ)
    if (!x.jt) return log(r, 'พี่วัฒน์ BGN: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ'); if (b7Used(r, i, 'วัฒน์')) return log(r, 'พี่วัฒน์ BGN: ใช้ความสามารถได้เทิร์นละ 1 ครั้ง'); b7Mark(r, i, 'วัฒน์');
    const hand5 = (k, done) => { const q = r.p[k], n = q.hand.length; if (n < 5) { draw(r, q, 5 - n); log(r, '🃏 ' + q.name + ' จั่ว ' + (5 - n) + ' ใบ'); return done(); } if (n > 5) return ask(r, k, { text: 'พี่วัฒน์ BGN: ทิ้งการ์ดบนมือ ' + (n - 5) + ' ใบ ให้เหลือ 5 ใบ', opts: q.hand.map(c => c.u), n: n - 5, min: n - 5, cb: us => { us.forEach(u => sendHell(r, u)); done(); } }); done(); };
    hand5(i, () => hand5(1 - i, () => { const sm = k => r.p[k].hand.reduce((a, c) => a + (B[c.id].g || 0), 0), s0 = sm(0), s1 = sm(1);
      [0, 1].forEach(k => fx({ k: 'scout', i: k, ids: r.p[k].hand.map(c => c.kd || c.id) })); log(r, '🔎 พี่วัฒน์ BGN: GEM รวมบนมือ ' + r.p[0].name + ' = ' + s0 + ' / ' + r.p[1].name + ' = ' + s1); if (s0 === s1) return log(r, 'GEM เท่ากัน — ไม่มีผู้ได้สิทธิ์');
      const w = s0 < s1 ? 0 : 1, q = r.p[w];
      ask(r, w, { text: 'พี่วัฒน์ BGN: คุณมี GEM น้อยกว่า — เลือกปฏิบัติ 1 อย่าง', choices: ['1) นำการ์ด 2 ใบ จากใต้ Deck ขึ้นมือ', '2) Avatar ทุกใบของเรา POWER +2', '3) ควบคุม Avatar ฝ่ายตรงข้าม 1 ใบ จนจบ Draw Phase ถัดไปของเจ้าของ'], cb: k => {
        if (k === 0) { const g = q.deck.splice(0, 2); g.forEach(c => q.hand.push(c)); log(r, '✨ ' + q.name + ' นำการ์ด ' + g.length + ' ใบ จากใต้ Deck ขึ้นมือ'); }
        else if (k === 1) { q.av.forEach(a => { a.pw = (a.pw || 0) + 2; fx({ k: 'buff', u: a.u, v: 2 }); }); log(r, '✨ ' + q.name + ': Avatar ทุกใบ POWER +2'); }
        else { const L = r.p[1 - w].av.filter(a => !protectedFrom(r, w, a)).map(a => a.u); if (!L.length) return log(r, 'ไม่มี Avatar ให้ควบคุม'); ask(r, w, { text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ควบคุมจนจบ Draw Phase ถัดไปของเจ้าของ', opts: L, cb: us => { const t = find(r, us[0]); if (t && stealCard(r, w, t.c.u)) { t.c.c7 = 1; t.c.tired = false; vfx(t.c.u, 'aura', '🕹 ควบคุม', '#a855f7'); log(r, '🕹 พี่วัฒน์ BGN: ควบคุม ' + nmOf(t.c) + ' จนจบ Draw Phase ถัดไปของเจ้าของ'); } } }); } } }); })); },
});
Object.assign(AB, {
  'BT07-012': { z: 'av', can: (r, i) => r.p[i].hell.some(isGar), steps: [{ key: 'g', n: 3, min: 1, text: 'ครุฑสุบรรณ: เลือก "ครุฑ"/ขนมณี แฟลร์ จากนรก สูงสุด 3 ใบ กลับเข้า Deck', opts: (r, i) => r.p[i].hell.filter(isGar).map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], us = cx.pick.g || []; us.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c) p.deck.push(c); }); const n = us.length; log(r, '⬆ ครุฑสุบรรณ: นำการ์ดกลับเข้า Deck ' + n + ' ใบ');
      bt7SumGar(r, i, cx.card, c => { if (n === 1) { c.eh7 = 1; log(r, '↩ ' + nmOf(c) + ' ได้รับ "เมื่อจบเทิร์น นำขึ้นมือ"'); } if (n >= 3) { addTp(c, 2); vfx(c.u, 'aura', 'POWER +2', '#38bdf8'); } }); } },
  'BT07-002': { z: 'av', any: 1, can: (r, i) => r.p[1 - i].av.some(a => nmOf(a).includes('พระอิศวร') && a.oo != null && a.oo !== 1 - i) && r.p[i].deck.concat(r.p[i].hand).some(c => !c.tk && B[c.id].n.trim() === 'เจ้าแม่กาลี'), steps: [],
    run: (r, i, cx) => { const p = r.p[i], isK = c => !c.tk && B[c.id].n.trim() === 'เจ้าแม่กาลี'; sendHell(r, cx.card.u); const all = p.hand.filter(isK).map(c => ({ u: c.u, z: 'hand' })).concat(p.deck.filter(isK).map(c => ({ u: c.u, z: 'deck' })));
      if (!all.length) return; ask(r, i, { text: 'พระแม่อุมาเทวี: เลือก เจ้าแม่กาลี จาก Deck หรือบนมือ อัญเชิญ (จุติ)', opts: all.map(o => o.u), cb: us => { const o = all.find(q => q.u === us[0]), c = o && p[o.z].find(k => k.u === o.u); if (c && summonAny(r, i, c.u, o.z, cx.card)) { if (o.z === 'deck') shuf(p.deck); vfx(c.u, 'burst', '🔱 อัญเชิญ', '#ef4444'); r.g.q.unshift(() => fxSummon(r, i, c)); } else if (o.z === 'deck') shuf(p.deck); } }); } },
});
Object.assign(MG, {
  'BT07-049': { steps: [{ key: 't', text: 'เพ้อเจ้อ: เลือก Avatar 1 ใบ บนสนาม ปรับ POWER กลับเป็น POWER ตั้งต้น', opts: (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x, 1)).map(a => a.x.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; const x = t.c; x.pw = x.b21 ? -((B[x.id].p || 0) - 3) : 0; x.tp = 0; x.bp = 0; fx({ k: 'buff', u: x.u, v: 0 }); vfx(x.u, 'aura', '🔄 POWER ตั้งต้น', '#a855f7'); log(r, '🔄 เพ้อเจ้อ: ' + nmOf(x) + ' กลับเป็น POWER ตั้งต้น'); } },
  'BT07-062': { mod: 1, tgf: a => isAv(a) && B[a.id].n.includes('ครุฑ') && (symOf(a) === 'สัตว์มหัศจรรย์' || also9(a, 'สัตว์มหัศจรรย์')) },
  'BT07-064': { mod: 1 },
});
{ const w = d => { if (d.__w) return; d.__w = 1; if (d.steps) d.steps = d.steps.map(s => ({ ...s, opts: (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return s.opts(...a); } finally { MGX--; MGWHO = o; } } })); if (d.run) { const f = d.run; d.run = (...a) => { const o = MGWHO; MGX++; MGWHO = a[1]; try { return f(...a); } finally { MGX--; MGWHO = o; } }; } };
  w(MG['BT07-049']); }
/* ===== BT08 SKILL + ANIMATION (ระดับกลาง) — เฉพาะการ์ดที่ใช้กลไกเดิมของ engine ได้ ===== */
// ใบที่ทำแล้ว (✅ ครบ / 🟡 บางส่วน) ดูรายการสรุปใน BT08_NOTES.md
const nm8 = c => B[c.id].n.trim();
const isSword8 = m => !m.tk && B[m.id].t === 'Magic' && B[m.id].st === 'Modification' && B[m.id].n.startsWith('ดาบศักดิ์สิทธิ์');
const swords8 = (r, i) => r.p[i].mg.filter(isSword8);
const isMag8 = c => !c.tk && B[c.id].t === 'Magic';
const isMod8 = c => isMag8(c) && B[c.id].st === 'Modification';
// ปุ่ม "ยืนยัน" ที่บล็อกการใช้ความสามารถ (กันกดแล้วเสีย เทิร์นละครั้ง) ถ้าเงื่อนไขไม่ครบ
const need8 = (cond, text) => ({ key: 'ok', text, opts: (r, i, cx) => cond(r, i, cx) ? [cx.card.u] : [] });

/* ---------- POWER ต่อเนื่อง ---------- */
function mod08(r, x, f) {
  if (x.tk) return 0;
  let v = 0; const p = r.p[f.i], b = B[x.id] || {};
  if (x.id === 'BT08-008' && !noFx(r, x)) v += new Set(swords8(r, f.i).map(nm8)).size;   // กาลาฮัด: +1 ต่อชื่อดาบที่ไม่ซ้ำ
  if (x.id === 'BT08-009' && !noFx(r, x) && r.g.phase === 'battle' && r.g.turn === f.i) v += Math.floor(p.hell.filter(h => !h.tk && nm8(h) === 'เอเจ้นท์สมูท').length / 2);   // เอเจ้นท์สมูท
  if (x.id === 'BT08-013' && !noFx(r, x)) v += p.life.filter(l => l.up).length;   // เปรตรัททาทุย: +1 ต่อ LIFE ที่หงาย
  if ((b.n || '').includes('จ๊กก๊ก')) v += p.av.filter(a => a.id === 'BT08-035' && !noFx(r, a)).length;   // เล่าปี่: จ๊กก๊ก +1 (นับตัวเองด้วย)
  if (b.c === 0 && p.co.some(k => k.id === 'BT08-067')) v += 1;   // สนามของนักวิ่งตัวจริง: Avatar Cost 0 +1
  if (p.co.some(k => k.id === 'BT08-068') && isPeopleF(x)) v += 1;   // ยิมทมิฬ: บึงทมิฬ People +1
  if (r.g.phase === 'battle' && r.g.turn === f.i && p.co.some(k => k.id === 'BT08-069') && symOf(x) === 'เทพ' && colOf(x) === 'ม่วง') v += nm8(x).startsWith('โอดิน') ? 3 : 1;   // บัลลังก์โอดิน
  r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u && m.id === 'BT08-060') v += 2; }));   // เอกซ์คาลิเบอร์: ผู้สวมใส่ +2
  { const A = r.g.inB ? r.g.curAtk : null, D = r.g.inB ? r.g.curDef : null, op = (A && D) ? (x === A ? D : x === D ? A : null) : null;   // 062 เนยถั่ว / 010 เซอร์นัท
    if (op) { if (hasEq(r, op, 'BT08-062')) v -= 1; if (x.id === 'BT08-010' && !noFx(r, x) && isCol(op, 'ม่วง')) v += 3; } }
  if ((b.n || '').includes('เลอติ๊ก เด็กไม่ชอบแดรคคูลา') && p.av.some(a => a.id === 'BT08-010' && !noFx(r, a))) v += 2;   // 010
  { const n4 = p.av.filter(a => a.id === 'BT08-004' && !noFx(r, a)).length;   // 004 น้าเอี๊ยด
    if (n4) { if (x.id !== 'BT08-004' && campTxt(x)) v += n4; v += n4 * p.mg.filter(m => m.at === x.u && (B[m.id].e || '').includes('ค่ายบางระจัน')).length; } }
  return v;
}

/* ---------- จุติ / ถูกอัญเชิญ ---------- */
function rikky8(r, i, sentName) {   // อัญเชิญ จุติ Avatar "ริกกี้" {แมลง} ชื่อต่างจากใบที่ส่งไป จาก Deck
  const p = r.p[i], L = p.deck.filter(c => isAv(c) && B[c.id].n.includes('ริกกี้') && symOf(c) === 'แมลง' && B[c.id].n !== sentName && /จุติ/.test(B[c.id].e || '')).map(c => c.u);
  if (!L.length) { shuf(p.deck); return log(r, 'ริกกี้: ไม่พบ Avatar "ริกกี้" {แมลง} ที่มี จุติ และชื่อต่างกัน ใน Deck'); }
  ask(r, i, { text: 'เลือก Avatar "ริกกี้" {แมลง} จุติ (ชื่อไม่ซ้ำ) จาก Deck อัญเชิญลงสนาม', opts: L, cb: us => { const c = p.deck.find(k => k.u === us[0]); if (c && summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', '🔪 ริกกี้ มาแล้ว', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); } shuf(p.deck); } });
}
const GIANT_RATS8 = ['รัททาทุย นางพญา', 'รัททาทุย พ่อพันธุ์'];
Object.assign(SUM, {
  'BT08-001': (r, i, x) => {   // หุ่นนักรบผู้กล้าปีศาจ : อีวิลไมเกรน — จุติ ธรณีสูบ 5 → นำ อาวุธหุ่นนักรบผู้กล้า จากนรกขึ้นมือ
    const p = r.p[i]; if (!p.deck.length) return;
    ask(r, i, { yn: true, text: 'จุติ: ธรณีสูบ 5 ใบ เพื่อนำ "อาวุธหุ่นนักรบผู้กล้า" 1 ใบ จากนรกขึ้นมือไหม?', cb: y => { if (!y) return; mill(r, i, 5, x); vfx(x.u, 'aura', '💀 ธรณีสูบ 5', '#ef4444');
      const L = p.hell.filter(c => isMod8(c) && B[c.id].n.startsWith('อาวุธหุ่นนักรบผู้กล้า')).map(c => c.u); if (!L.length) return log(r, 'จุติ อีวิลไมเกรน: ไม่พบ อาวุธหุ่นนักรบผู้กล้า ในนรก');
      ask(r, i, { text: 'เลือก อาวุธหุ่นนักรบผู้กล้า จากนรก ขึ้นมือ', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.hand.push(c); vfx(x.u, 'aura', '⚔ อาวุธขึ้นมือ', '#ef4444'); log(r, '⚔ อีวิลไมเกรน: นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }); } });
  },
  'BT08-006': (r, i, x) => {   // จิวยี่ — สอดแนม 5 เลือก เรือรบโบราณ ก่อสร้าง (ที่เหลือไว้ใต้ Deck)
    const p = r.p[i];
    scout(r, i, 5, { by: x, text: 'จุติ: เลือก Construct "เรือรบโบราณ" ก่อสร้างลง Construct Zone', rest: 'bottom',
      pred: c => !c.tk && B[c.id].t === 'Construct' && nm8(c) === 'เรือรบโบราณ' && p.co.length < 3 && p.co.filter(k => nm8(k) === 'เรือรบโบราณ').length < 3,
      then: got => { if (!got) return log(r, 'จุติ จิวยี่: ไม่พบ เรือรบโบราณ'); p.hand.push(got); if (buildFree(r, i, got, 'hand')) vfx(x.u, 'aura', '🚢 ก่อสร้าง เรือรบโบราณ', '#ef4444'); else { p.hand.splice(p.hand.indexOf(got), 1); p.deck.unshift(got); } } });
  },
  'BT08-012': (r, i, x) => {   // หมอเสริมศักดิ์ — จุติ สอดแนม 5 ได้ Magic หมอมาแล้วววว
    const p = r.p[i];
    scout(r, i, 5, { by: x, text: 'จุติ: เลือก Magic "หมอมาแล้วววว" 1 ใบ ขึ้นมือ', rest: 'shuffle', pred: c => isMag8(c) && nm8(c) === 'หมอมาแล้วววว', then: got => { if (got) { p.hand.push(got); vfx(x.u, 'aura', '🩺 หมอมาแล้ว', '#ef4444'); log(r, '🩺 หมอเสริมศักดิ์: นำ ' + B[got.id].n + ' ขึ้นมือ'); } } });
  },
  'BT08-013': (r, i, x) => {   // เปรตรัททาทุย — ถูกอัญเชิญ: เซ่นไหว้ นางพญา/พ่อพันธุ์ → อัญเชิญรัททาทุยจากนรก
    const p = r.p[i], S = p.av.filter(a => isAv(a) && GIANT_RATS8.includes(nm8(a))).map(a => a.u), H = () => p.hell.filter(h => isAv(h) && symOf(h) === 'รัททาทุย' && !GIANT_RATS8.includes(nm8(h))).map(h => h.u);
    if (!S.length || !H().length) return log(r, 'เปรตรัททาทุย: เงื่อนไขการเซ่นไหว้ไม่ครบ');
    ask(r, i, { text: 'เซ่นไหว้ รัททาทุย นางพญา/พ่อพันธุ์ 1 ใบ เพื่ออัญเชิญ {รัททาทุย} จากนรก (ยกเลิก = ไม่ใช้)', opts: S, cancel: true, cb: us => { sac(r, us[0]); r.g.q.push(() => { const L = H(); if (!L.length) return;
      ask(r, i, { text: 'เลือก Avatar {รัททาทุย} จากนรก อัญเชิญลงสนาม', opts: L, cb: u2 => { if (summonAny(r, i, u2[0], 'hell')) vfx(u2[0], 'burst', '🐀 อัญเชิญ', '#38bdf8'); } }); }); } });
  },
  'BT08-015': (r, i, x) => {   // ริกกี้ เชฟมัมมามิย่า — จุติ: Avatar ศัตรู POWER -2
    const O = r.p[1 - i].av.filter(a => !protectedFrom0(r, i, a)).map(a => a.u);
    ask(r, i, { text: 'จุติ: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ POWER -2', opts: O, cb: us => { const t = find(r, us[0]); if (t) { addPw(t.c, -2); vfx(t.c.u, 'aura', 'POWER -2', '#ef4444'); log(r, '🍳 ริกกี้ เชฟมัมมามิย่า: ' + nmOf(t.c) + ' POWER -2'); } } });
  },
  'BT08-018': (r, i, x) => {   // โจโฉ — จุติ: อัญเชิญ จุติ ขุนพลสีฟ้า {ต่างชาติ} จากมือ  (🟡 ส่วน สั่งใช้/อัตโนมัติ ยังไม่ทำ)
    const p = r.p[i], L = p.hand.filter(c => isKP(c) && colOf(c) === 'ฟ้า' && /จุติ/.test(B[c.id].e || '') && canPlaceAv(r, i, c)).map(c => c.u);
    ask(r, i, { text: 'จุติ: เลือก Avatar "ขุนพล" สีฟ้า {ต่างชาติ} (จุติ) จากมือ อัญเชิญลงสนาม', opts: L, cancel: true, cb: us => { const c = p.hand.find(k => k.u === us[0]); if (c && summonAny(r, i, c.u, 'hand')) { vfx(c.u, 'burst', '🏯 อัญเชิญ', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); } } });
  },
  'BT08-020': (r, i, x) => {   // เตียวเลี้ยว — จุติ: สอดแนม 5 เลือก ขุนพล {ต่างชาติ} สีเดียวกัน (ฟ้า/ม่วง) ขึ้นมือ
    const p = r.p[i];
    scout(r, i, 5, { by: x, text: 'จุติ: เลือก Avatar "ขุนพล" {ต่างชาติ} สีฟ้า/ม่วง 1 ใบ ขึ้นมือ', rest: 'shuffle', pred: c => isKP(c) && ['ฟ้า', 'ม่วง'].includes(colOf(c)), then: got => { if (got) { p.hand.push(got); vfx(x.u, 'aura', 'ขึ้นมือ', '#38bdf8'); log(r, '✨ เตียวเลี้ยว: นำ ' + B[got.id].n + ' ขึ้นมือ'); } } });
  },
  'BT08-023': (r, i, x) => {   // มฤตยูเทวี — จุติ: ได้ความสามารถของ Avatar {นรก} Cost 5 ในนรก (ถ้ามี จุติ แสดงผลทันที)
    const p = r.p[i], L = p.hell.filter(h => isAv(h) && symOf(h) === 'นรก' && B[h.id].c === 5).map(h => h.u);
    ask(r, i, { text: 'จุติ: เลือก Avatar {นรก} Cost 5 ในนรก เพื่อรับความสามารถ', opts: L, cb: us => { const h = p.hell.find(k => k.u === us[0]); if (!h) return; const id = CANON[h.id] || h.id; x.gain8 = id; vfx(x.u, 'aura', '🔥 รับความสามารถ ' + B[h.id].n, '#a855f7'); log(r, '🔥 มฤตยูเทวี: ได้รับความสามารถของ ' + B[h.id].n);
      if (id !== 'BT08-023') { if (SUM[id]) { fx({ k: 'say', id, t: 'จุติ' }); SUM[id](r, i, x); } else if ((B[id].e || '').includes('จุติ')) { const sh = Object.create(x); sh.id = id; fx({ k: 'say', id, t: 'จุติ' }); fxSummon0(r, i, sh); } } } });
  },
  'BT08-024': (r, i, x) => {   // อีสานสลิงเกอร์ ปิ๊ก — จุติ ธรณีสูบ 3 : นำ โคกอีสานนูน จาก Deck/นรก ขึ้นมือ
    const p = r.p[i]; if (p.deck.length < 1) return;
    ask(r, i, { yn: true, text: 'จุติ: ธรณีสูบ 3 ใบ เพื่อนำ Land "โคกอีสานนูน" จาก Deck หรือนรก ขึ้นมือไหม?', cb: y => { if (!y) return; mill(r, i, 3, x);
      const L = [...p.deck, ...p.hell].filter(c => isMag8(c) && nm8(c) === 'โคกอีสานนูน').map(c => c.u); if (!L.length) { shuf(p.deck); return log(r, 'ปิ๊ก: ไม่พบ โคกอีสานนูน'); }
      ask(r, i, { text: 'เลือก โคกอีสานนูน ขึ้นมือ', opts: L, cb: us => { const fd = p.deck.some(c => c.u === us[0]), c = fromZone(r, i, fd ? 'deck' : 'hell', us[0]); if (c) { p.hand.push(c); vfx(x.u, 'aura', '🌳 โคกอีสานนูน ขึ้นมือ', '#a855f7'); log(r, '🌳 ปิ๊ก: นำ โคกอีสานนูน ขึ้นมือ'); } if (fd) shuf(p.deck); } }); } });
  },
  'BT08-028': (r, i, x) => {   // พี่ไท่ น้องเฟิง — จุติ ทิ้งมือ 2: อัญเชิญ Avatar Cost ≤1 Symbol ไม่ซ้ำ 3 ใบ จาก Deck (1 ครั้ง/เกม, เทิร์นแรกสุด)
    const p = r.p[i];
    if (p.u28) return log(r, 'พี่ไท่ น้องเฟิง: ใช้ความสามารถได้ 1 ครั้งต่อเกมเท่านั้น');
    if (r.g.n > 1) return log(r, 'พี่ไท่ น้องเฟิง: ใช้ได้เฉพาะเทิร์นแรกสุดของผู้ใช้');
    if (p.hand.length < 2) return log(r, 'พี่ไท่ น้องเฟิง: มือไม่พอทิ้ง 2 ใบ');
    ask(r, i, { text: 'จุติ: ทิ้งการ์ดบนมือ 2 ใบ เพื่ออัญเชิญ Avatar Cost ≤1 (Symbol ไม่ซ้ำ) 3 ใบจาก Deck (ยกเลิก = ไม่ใช้)', opts: p.hand.map(c => c.u), n: 2, min: 2, cancel: true, cb: us => {
      p.u28 = 1; us.forEach(u => sendHell(r, u)); const used = new Set();
      const step = k => { if (k >= 3) { shuf(p.deck); return; } const L = p.deck.filter(c => isAv(c) && B[c.id].c <= 1 && !used.has(symOf(c)) && canPlaceAv(r, i, c)).map(c => c.u); if (!L.length) { shuf(p.deck); return; }
        ask(r, i, { text: 'อัญเชิญ Avatar Cost ≤1 จาก Deck (' + (k + 1) + '/3)', opts: L, cb: u2 => { const c = p.deck.find(z => z.u === u2[0]); if (c) { used.add(symOf(c)); if (summonAny(r, i, c.u, 'deck')) vfx(c.u, 'burst', '🌪 อัญเชิญ', '#a855f7'); } step(k + 1); } }); };
      step(0); } });
  },
  'BT08-034': (r, i, x) => {   // ฮากลิ้ง วานรกับหมา — จุติ: สอดแนม 7 เลือกการ์ด "โดนใจ" ขึ้นมือ
    const p = r.p[i];
    scout(r, i, 7, { by: x, text: 'จุติ: เลือกการ์ด "โดนใจ" 1 ใบ ขึ้นมือ', rest: 'shuffle', pred: c => !c.tk && B[c.id].n.includes('โดนใจ'), then: got => { if (got) { p.hand.push(got); vfx(x.u, 'aura', '💘 โดนใจ ขึ้นมือ', '#22c55e'); log(r, '✨ ฮากลิ้ง: นำ ' + B[got.id].n + ' ขึ้นมือ'); } } });
  },
  'BT08-037': (r, i, x) => {   // จูล่ง — จุติ ถ้าไม่มี Avatar ใบอื่น: อัญเชิญ ขุนพลเขียว {ต่างชาติ} จากนรก (🟡 ส่วนสั่งใช้จากมือยังไม่ทำ)
    const p = r.p[i]; if (p.av.some(a => a.u !== x.u)) return log(r, 'จุติ จูล่ง: มี Avatar ใบอื่นบนสนาม ไม่เข้าเงื่อนไข');
    const L = p.hell.filter(h => isKP(h) && isCol(h, 'เขียว') && B[h.id].n !== B[x.id].n).map(h => h.u);
    ask(r, i, { text: 'จุติ: เลือก Avatar "ขุนพล" สีเขียว {ต่างชาติ} จากนรก อัญเชิญลงสนาม', opts: L, cb: us => { if (summonAny(r, i, us[0], 'hell')) vfx(us[0], 'burst', '🐉 อัญเชิญ', '#22c55e'); } });
  },
});

/* ---------- ความสามารถสั่งใช้ (Avatar / Land) ---------- */
Object.assign(AB, {
  'BT08-005': { z: 'av', steps: [   // ซุนกวน — คืน ง่อก๊ก/พลเดินทัพ 2 ใบใต้ Deck : ทำลายการ์ดบนสนาม 1 ใบ
    { key: 'h', n: 2, text: 'ซุนกวน: เลือก Avatar "ง่อก๊ก"/"พลเดินทัพ" ในนรก 2 ใบ กลับใต้ Deck', opts: (r, i) => r.p[i].hell.filter(h => isAv(h) && /ง่อก๊ก|พลเดินทัพ/.test(B[h.id].n)).map(h => h.u) },
    { key: 't', text: 'ซุนกวน: เลือกการ์ดบนสนาม 1 ใบ ทำลาย', opts: (r, i) => [...allAvT(r, i), ...r.p.flatMap(q => [...q.co, ...q.mg].map(c => c.u))] }],
    run: (r, i, cx) => { const p = r.p[i]; cx.pick.h.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c) p.deck.unshift(c); }); const t = find(r, cx.pick.t[0]); if (t) { vfx(t.c.u, 'burst', '🐯 ทำลาย', '#ef4444'); destroyAny(r, t.c.u); } } },
  'BT08-026': { z: 'av', steps: [need8(r => landIs(r, 'BT08-065'), 'เปอร์: ต้องมี Land โคกอีสานนูน (กดเลือกตัวเองเพื่อยืนยัน)')],   // เปอร์ — ธรณีสูบ 3 : POWER +2
    run: (r, i, cx) => { mill(r, i, 3, cx.card); addTp(cx.card, 2); vfx(cx.card.u, 'aura', 'POWER +2', '#a855f7'); log(r, '💀 เปอร์: POWER +2 จนจบเทิร์น'); } },
  'BT08-038': { z: 'av', steps: [{ key: 's', text: 'มณโฑ: เลือก Avatar {ยักษ์} ของเรา 1 ใบ เซ่นไหว้', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && (symOf(a) === 'ยักษ์' || a.id === 'BT08-038')).map(a => a.u) }],   // มณโฑ
    run: (r, i, cx) => { const p = r.p[i], t = find(r, cx.pick.s[0]); if (!t) return; const pw = P(r, t.c), nm = B[t.c.id].n; sac(r, t.c.u);
      r.g.q.push(() => { const L = p.hell.filter(h => isAv(h) && symOf(h) === 'ยักษ์' && B[h.id].p === pw && B[h.id].n !== nm).map(h => h.u); if (!L.length) return log(r, 'มณโฑ: ไม่มี Avatar {ยักษ์} POWER ' + pw + ' ชื่อต่างกันในนรก');
      ask(r, i, { text: 'มณโฑ: เลือก Avatar {ยักษ์} POWER ' + pw + ' จากนรก อัญเชิญ (POWER +2 จนจบเทิร์น)', opts: L, cb: us => { if (summonAny(r, i, us[0], 'hell')) { const s = find(r, us[0]); s && addTp(s.c, 2); vfx(us[0], 'burst', '👹 อัญเชิญ +2', '#22c55e'); } } }); }); } },
  'BT08-039': { z: 'av', steps: [], run: (r, i, cx) => {   // ราชา รด. — สอดแนม 2 นำ ทหาร/รด. {คน} เข้าสนาม  (🟡 ส่วน POWER +1 อัตโนมัติยังไม่ทำ)
    const p = r.p[i]; scout(r, i, 2, { by: cx.card, text: 'ราชา รด.: เลือก Avatar "ทหาร"/"รด." {คน} 1 ใบ อัญเชิญลงสนาม', rest: 'shuffle', pred: c => isAv(c) && /ทหาร|รด\./.test(B[c.id].n) && symOf(c) === 'คน' && nm8(c) !== 'ราชา รด.' && canPlaceAv(r, i, c),
      then: got => { if (!got) return; p.deck.push(got); if (summonAny(r, i, got.u, 'deck')) vfx(got.u, 'burst', '🎖 เข้าสนาม', '#22c55e'); shuf(p.deck); } }); } },
  'BT08-065': { z: 'land', steps: [need8((r, i) => r.p[i].av.some(a => B[a.id] && B[a.id].n.startsWith('อีสานสลิงเกอร์')) && r.p[i].hell.length >= 6, 'โคกอีสานนูน: ต้องมี อีสานสลิงเกอร์ บนสนาม และนรกมีการ์ด ≥6 ใบ (กดเลือกการ์ดเพื่อยืนยัน)'),   // โคกอีสานนูน (ความสามารถที่ 1)
    { key: 'h', n: 6, text: 'โคกอีสานนูน: เลือกการ์ดในนรก 6 ใบ (Magic ได้ไม่เกิน 2 ใบ) นำกลับเข้า Deck', opts: (r, i) => r.p[i].hell.map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], cs = cx.pick.h.map(u => p.hell.find(c => c.u === u)).filter(Boolean); if (cs.filter(isMag8).length > 2) return log(r, '🌳 โคกอีสานนูน: เลือก Magic เกิน 2 ใบ ไม่เกิดผล');
      cs.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } }); shuf(p.deck); r.g.dk8 = { n: r.g.n, c: ((r.g.dk8 && r.g.dk8.n === r.g.n ? r.g.dk8.c : 0) + cs.length) }; draw(r, p, 1); vfx(cx.card.u, 'aura', '🌳 คืน 6 ใบ จั่ว 1', '#a855f7'); log(r, '🌳 โคกอีสานนูน: คืน ' + cs.length + ' ใบเข้า Deck แล้วจั่ว 1 ใบ'); } },
});
ABIL['BT08-066'] = { zone: 'co', once: 1, label: 'เรือรบโบราณ: สอดแนม 5 / คืน พลเดินทัพ เข้า Deck', cond: () => true, run: (r, i, x) => {
  const p = r.p[i];
  ask(r, i, { text: 'เรือรบโบราณ: เลือกปฏิบัติ', choices: ['1) สอดแนม 5 ใบ เลือก พลเดินทัพ/ขุนพล (POWER ≤2)', '2) นำ พลเดินทัพ 1 ใบ จากนรก กลับเข้า Deck'], cb: k => {
    if (k === 0) return scout(r, i, 5, { text: 'เลือก พลเดินทัพ/ขุนพล {ต่างชาติ} POWER ≤2 1 ใบ', rest: 'bottom', pred: c => isAv(c) && (nm8(c) === 'พลเดินทัพ' || isKP(c)) && (symOf(c) === 'ต่างชาติ' || also9(c, 'ต่างชาติ')) && B[c.id].p <= 2,
      then: got => { if (!got) return log(r, 'เรือรบโบราณ: ไม่พบเป้าหมาย'); const toHand = () => { p.hand.push(got); log(r, '🚢 เรือรบโบราณ: ' + B[got.id].n + ' ขึ้นมือ'); };
        if (!canPlaceAv(r, i, got)) return toHand(); ask(r, i, { text: 'เรือรบโบราณ: ' + B[got.id].n + ' — ขึ้นมือ หรือ อัญเชิญลงสนาม?', choices: ['ขึ้นมือ', 'อัญเชิญลงสนาม'], cb: m => { if (m === 0) return toHand(); p.deck.push(got); if (summonAny(r, i, got.u, 'deck')) vfx(got.u, 'burst', '🚢 อัญเชิญ', '#ef4444'); else { p.deck.splice(p.deck.indexOf(got), 1); toHand(); } } }); } });
    const L = p.hell.filter(h => isAv(h) && nm8(h) === 'พลเดินทัพ').map(h => h.u); if (!L.length) return log(r, 'เรือรบโบราณ: ไม่มี พลเดินทัพ ในนรก');
    ask(r, i, { text: 'เลือก พลเดินทัพ จากนรก กลับเข้า Deck', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.deck.push(c); shuf(p.deck); vfx(x.u, 'aura', '🚢 พลเดินทัพ กลับ Deck', '#ef4444'); } } }); } }); } };
ABIL['BT08-069'] = { zone: 'co', once: 1, label: 'ทำลาย บัลลังก์โอดิน : นำ โอดิน จากนรกขึ้นมือ', cond: (r, i) => r.p[i].hell.some(h => isAv(h) && nm8(h).startsWith('โอดิน')), run: (r, i, x) => {
  const p = r.p[i], L = p.hell.filter(h => isAv(h) && nm8(h).startsWith('โอดิน')).map(h => h.u); if (!L.length) return log(r, 'บัลลังก์โอดิน: ไม่มี โอดิน ในนรก');
  ask(r, i, { text: 'บัลลังก์โอดิน: เลือก โอดิน จากนรก ขึ้นมือ (ทำลายการ์ดนี้)', opts: L, cancel: true, cb: us => { destroyCo(r, x.u); const c = fromZone(r, i, 'hell', us[0]); if (c) { p.hand.push(c); vfx(c.u, 'aura', '⚡ โอดิน ขึ้นมือ', '#a855f7'); log(r, '⚡ บัลลังก์โอดิน: นำ ' + B[c.id].n + ' ขึ้นมือ'); } } }); } };

/* ---------- Magic ---------- */
Object.assign(MG, {
  'BT08-048': { steps: [{ key: 'd', pay: 1, text: 'ขายแดก !!!: ทิ้ง Modification Magic จากมือ 1 ใบ', opts: (r, i, cx) => r.p[i].hand.filter(c => isMod8(c) && (!cx || !cx.card || c.u !== cx.card.u)).map(c => c.u) }], run: (r, i) => { draw(r, r.p[i], 2); log(r, '💸 ขายแดก: ' + r.p[i].name + ' จั่ว 2 ใบ'); } },
  'BT08-049': { cond: (r, i) => r.p[i].deck.length <= 15 && r.p[i].hell.some(c => nm8(c) !== 'แหมกำบ่อ้าย'), steps: [{ key: 'h', n: 5, min: 1, text: 'แหมกำบ่อ้าย: เลือกการ์ดในนรกสูงสุด 5 ใบ นำกลับเข้า Deck', opts: (r, i) => r.p[i].hell.filter(c => nm8(c) !== 'แหมกำบ่อ้าย').map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i]; cx.pick.h.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c) p.deck.push(c); }); shuf(p.deck); log(r, '♻ แหมกำบ่อ้าย: นำการ์ด ' + cx.pick.h.length + ' ใบ กลับเข้า Deck แล้วสับ'); } },
  'BT08-050': { steps: [{ key: 't', text: 'ขอดูดดดดดด: เลือก Avatar ฝ่ายตรงข้าม POWER -1', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u) }, { key: 'm', text: 'ขอดูดดดดดด: เลือก Avatar ของเรา POWER +1', opts: (r, i) => r.p[i].av.map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]), m = find(r, cx.pick.m[0]); if (t) { addTp(t.c, -1); vfx(t.c.u, 'aura', 'POWER -1', '#ef4444'); } if (m) { addTp(m.c, 1); vfx(m.c.u, 'aura', 'POWER +1', '#22c55e'); } log(r, '🚬 ขอดูดดดดดด: ศัตรู -1 / เรา +1 จนจบเทิร์น'); } },
  'BT08-051': { react: 1, cond: (r, i) => r.p[i].av.some(a => isAv(a) && B[a.id].n.includes('ริกกี้')), steps: [{ key: 's', pay: 1, text: 'หนังมนุษย์ ชุดแก้แค้น: ส่ง Avatar "ริกกี้" จากสนามเรา 1 ใบ ลงนรก', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && B[a.id].n.includes('ริกกี้')).map(a => a.u) }],
    run: (r, i, cx) => { const h = find(r, cx.pick.s[0]); rikky8(r, i, h ? B[h.c.id].n : ''); } },
  'BT08-052': { cond: (r, i) => r.p[i].life.filter(l => !l.up).length >= 2, run: (r, i) => { const p = r.p[i]; lifeUp(r, i); lifeUp(r, i);
    const L = p.deck.filter(c => isAv(c) && B[c.id].n.includes('Overdose') && B[c.id].c <= 5 && canPlaceAv(r, i, c)).map(c => c.u); if (!L.length) { shuf(p.deck); return log(r, 'Overdose: ไม่พบ Avatar "Overdose" Cost ≤5 ใน Deck'); }
    ask(r, i, { text: 'Overdose: เลือก Avatar "Overdose" Cost ≤5 จาก Deck อัญเชิญลงสนาม', opts: L, cb: us => { if (summonAny(r, i, us[0], 'deck')) vfx(us[0], 'burst', '💊 Overdose', '#22c55e'); shuf(p.deck); } }); } },
  'BT08-053': { cond: (r, i) => r.p[i].av.some(a => isAv(a) && B[a.id].n.includes('เทพธิดาแห่งวัลฮัลลา')), steps: [{ key: 's', text: 'การสละชีพของเทพธิดา: เลือก Avatar "เทพธิดาแห่งวัลฮัลลา" ของเรา ทำลาย', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && B[a.id].n.includes('เทพธิดาแห่งวัลฮัลลา')).map(a => a.u) }, { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u) }],   // (🟡 ส่วนถูกธรณีสูบยังไม่ทำ)
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); vfx(cx.pick.s[0], 'burst', '🙏 สละชีพ', '#a855f7'); destroyAv(r, cx.pick.s[0]); if (t) { vfx(t.c.u, 'burst', 'ทำลาย', '#a855f7'); destroyAv(r, t.c.u); } } },
  'BT08-054': { react: 'atk', steps: [{ key: 'm', text: 'โจมตีตัวฉันให้โดนถ้าหากเธอทำได้: เลือก Avatar ของเรา 1 ใบ เป็นเป้าหมายใหม่', opts: (r, i) => r.p[i].av.map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.m[0]); if (!t || !cx.pend) return; cx.pend.tg = t.c.u; cx.pend.tk = 'av'; vfx(t.c.u, 'burst', '🎯 ย้ายเป้า', '#38bdf8'); log(r, '🎯 โจมตีตัวฉัน: เปลี่ยนเป้าหมายการโจมตีมาที่ ' + nmOf(t.c)); } },
  'BT08-056': { react: 'atk', cond: (r, i) => r.p[i].av.length > 0 && r.p[1 - i].av.length > 0, run: (r, i, cx) => {   // ลุ้นเยี่ยวเหนียว: ทอยเต๋า ใครน้อยสุด Avatar ตัวเองกลับใต้ Deck (เสมอ = ทอยใหม่)
    let d0, d1, n = 0; do { d0 = 1 + Math.floor(Math.random() * 6); d1 = 1 + Math.floor(Math.random() * 6); n++; } while (d0 === d1 && n < 20);
    log(r, '🎲 ลุ้นเยี่ยวเหนียว: ' + r.p[i].name + ' ทอย ' + d0 + ' / ' + r.p[1 - i].name + ' ทอย ' + d1); const lo = d0 < d1 ? i : (d1 < d0 ? 1 - i : -1); if (lo < 0) return log(r, 'ลุ้นเยี่ยวเหนียว: ทอยเสมอ ไม่เกิดผล');
    r.p[lo].av.slice().forEach(a => { const w = take(r, a.u); if (!w.c.tk) { w.c.pw = 0; w.c.tp = 0; w.c.bp = 0; r.p[lo].deck.unshift(w.c); } vfx(a.u, 'burst', '⬇ ใต้ Deck', '#ef4444'); }); log(r, '⬇ ลุ้นเยี่ยวเหนียว: Avatar ทั้งหมดของ ' + r.p[lo].name + ' กลับใต้ Deck');
    if (cx.pend && !find(r, cx.pend.u)) cx.pend.cancel = 1; } },
  'BT08-057': { react: 'atk', run: (r, i, cx) => { if (cx.pend) cx.pend.cancel = 1; log(r, '🛑 แหม่อ้ายก็~~~: ยกเลิกการประกาศโจมตี'); } },
  'BT08-059': { mod: 1, steps: [{ key: 'tg', text: 'ดาบศักดิ์สิทธิ์ คาเรนต์: เลือก Avatar "อัศวินโต๊ะกลม" ที่จะสวมใส่', opts: (r, i) => r.p[i].av.filter(isKnight).map(a => a.u) }] },   // 🟡 เตะไข่ (มอเดรด) + ทำลาย Magic เมื่อชนะ; ส่วนใช้จากนรกยังไม่ทำ
  'BT08-060': { mod: 1, steps: [{ key: 'tg', text: 'ดาบศักดิ์สิทธิ์ เอกซ์คาลิเบอร์: เลือก "อาเธอร์ ราชาแห่งอัศวินโต๊ะกลม" ที่จะสวมใส่', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && nm8(a).startsWith('อาเธอร์')).map(a => a.u) }] },   // 🟡 POWER +2 (ส่วนทำลายแทน/ใช้จากนรกยังไม่ทำ)
  'BT08-061': { mod: 1 },
  'BT08-063': {}, 'BT08-065': {},
});

/* ---------- Hook ---------- */
function bt8Atk(r, i, a, tg, tk) {   // ขวาน 7 สี: เมื่อโจมตี ตามสี Avatar
  if (a.id === 'BT08-010' && !noFx(r, a) && (a.wr || []).some(w => w.id === 'BT10-008') && a.u8d !== r.g.n) { a.u8d = r.g.n; draw(r, r.p[i], 1); vfx(a.u, 'aura', '🃏 จั่ว 1 (ไอ้นัท)', '#ef4444'); log(r, '🃏 เซอร์นัท (ไอ้นัท คนบ้าจั่ว): โจมตี จั่ว 1 ใบ'); }
  if (a.tk || !hasEq(r, a, 'BT08-061')) return; const col = colOf(a), p = r.p[i];
  if (col === 'แดง') { a.bp = (a.bp || 0) + 2; vfx(a.u, 'aura', '🪓 POWER +2', '#ef4444'); log(r, '🪓 ขวาน 7 สี (แดง): ' + nmOf(a) + ' POWER +2 จนจบการต่อสู้'); }
  else if (col === 'ฟ้า') { draw(r, p, 1); vfx(a.u, 'aura', '🪓 จั่ว 1', '#38bdf8'); log(r, '🪓 ขวาน 7 สี (ฟ้า): ' + p.name + ' จั่ว 1 ใบ'); }
  else if (col === 'ม่วง') { mill(r, i, 1, a); addTp(a, 1); vfx(a.u, 'aura', '🪓 ธรณีสูบ +1', '#a855f7'); log(r, '🪓 ขวาน 7 สี (ม่วง): ธรณีสูบ 1 ใบ POWER +1 จนจบเทิร์น'); }
}
function bt8Win(r, p, a, d, res) {   // Avatar ทำลาย Avatar ฝ่ายตรงข้ามสำเร็จจากการต่อสู้
  if (res !== 'win' && res !== 'lose') return;
  const wi = res === 'win' ? p.ai : 1 - p.ai, w = res === 'win' ? a : d; if (!w || w.tk || !find(r, w.u) || noFx(r, w)) return; const me = r.p[wi];
  const lo = res === 'win' ? d : a, lt = (lo && !lo.tk && B[lo.id]) ? (B[lo.id].e || '') : '';   // Overdose: ผลเมื่อทำลาย Avatar ที่มีความสามารถเฉพาะ
  if (w.id === 'BT08-031' && /จุติ|คำสั่งเสีย/.test(lt)) { const U = me.life.filter(x => x.up); if (U.length) { const q = U[Math.floor(Math.random() * U.length)]; q.up = 0; vfx(w.u, 'aura', '💊 คว่ำ LIFE', '#22c55e'); log(r, '💊 พูรินอล: สุ่มคว่ำ LIFE ของ ' + me.name + ' 1 ใบ'); } }
  if (w.id === 'BT08-032' && /ธรณีสูบ|สอดแนม/.test(lt)) { me.av.filter(OD8).forEach(x => addPw(x, 1)); vfx(w.u, 'aura', '💊 Overdose +1', '#22c55e'); log(r, '💊 ชาโค่ล: Avatar Overdose ทุกใบ POWER +1'); }
  if (w.id === 'BT08-033' && /โล่มนุษย์|ลูกฮึด/.test(lt)) { lifeUp(r, 1 - wi); vfx(w.u, 'aura', '💊 หงาย LIFE ศัตรู', '#22c55e'); log(r, '💊 เซตาม่อน: หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); }
  if (w.id === 'BT08-014') ask(r, wi, { yn: true, text: 'ริกกี้ ฆาตกรถลกหนัง: ส่งตัวเองลงนรก เพื่ออัญเชิญ จุติ "ริกกี้" {แมลง} (ชื่อต่าง) จาก Deck ไหม?', cb: y => { if (!y || !find(r, w.u)) return; const nm = B[w.id].n; vfx(w.u, 'burst', '🔪 สลับตัว', '#38bdf8'); sendHell(r, w.u); rikky8(r, wi, nm); } });
  if (w.id === 'BT08-016') ask(r, wi, { yn: true, text: 'ริกกี้ คุณหมอ: นำ Magic "หนังมนุษย์ ชุดแก้แค้น" จาก Deck ขึ้นมือไหม?', cb: y => { if (!y) return; const c = me.deck.find(k => isMag8(k) && nm8(k) === 'หนังมนุษย์ ชุดแก้แค้น'); if (c) { me.deck.splice(me.deck.indexOf(c), 1); me.hand.push(c); vfx(w.u, 'aura', '🩺 หนังมนุษย์ ขึ้นมือ', '#38bdf8'); log(r, '🩺 ริกกี้ คุณหมอ: นำ หนังมนุษย์ ชุดแก้แค้น ขึ้นมือ'); } else log(r, 'ริกกี้ คุณหมอ: ไม่พบ หนังมนุษย์ ใน Deck'); shuf(me.deck); } });
  if (w.id === 'BT08-026' && r.g.phase === 'main' && landIs(r, 'BT08-065')) { lifeUp(r, 1 - wi); vfx(w.u, 'aura', '❤ หงาย LIFE ศัตรู', '#a855f7'); log(r, '❤ เปอร์: หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); }
  if (w.id === 'BT08-042' && w.us8 !== r.g.n && w.tired && me.av.some(x => x.u !== w.u && B[x.id].n.includes('วานร')) && me.hand.length) ask(r, wi, { yn: true, text: 'ปีศาจวานร: ทิ้งการ์ดบนมือ 1 ใบ เพื่อเปลี่ยนเป็นสภาพตื่นไหม?', cb: y => { if (!y) return; ask(r, wi, { text: 'เลือกการ์ดบนมือที่จะทิ้ง', opts: me.hand.map(c => c.u), cb: us => { sendHell(r, us[0]); w.us8 = r.g.n; w.tired = false; vfx(w.u, 'aura', '🐒 ตื่น!', '#22c55e'); log(r, '🐒 ปีศาจวานร: กลับเป็นสภาพตื่น'); } }); } });
  if (hasEq(r, w, 'BT08-059')) { const L = r.p[1 - wi].mg.map(m => m.u); if (L.length) ask(r, wi, { text: 'ดาบศักดิ์สิทธิ์ คาเรนต์: เลือก Magic ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: L, cb: us => { vfx(us[0], 'burst', '🗡 ทำลาย', '#ef4444'); destroyAny(r, us[0]); } }); }
}
function bt8Death(r, f) {   // คำสั่งเสีย
  const c = f.c, p = r.p[f.i]; if (c.tk) return;
  { const m37 = p.hand.find(h => h.id === 'BT08-037'); if (m37 && B[c.id] && B[c.id].n.includes('จ๊กก๊ก')) r.g.q.push(() => bt8Pay(r, f.i, m37, 'จูล่ง: Avatar "จ๊กก๊ก" ' + nmOf(c) + ' ถูกทำลาย')); }
  bt8Rat(r, f);
  if (c.id === 'BT08-009') r.g.q.push(() => scout(r, f.i, 3, { by: c, text: 'คำสั่งเสีย: เลือก เอเจ้นท์สมูท 1 ใบ ขึ้นมือ', rest: 'bottom', pred: x => !x.tk && nm8(x) === 'เอเจ้นท์สมูท', then: got => { if (got) { p.hand.push(got); log(r, '🕶 เอเจ้นท์สมูท: นำ เอเจ้นท์สมูท ขึ้นมือ'); } } }));
  if (c.id === 'BT08-012') r.g.q.push(() => { const L = p.hell.filter(h => h.u !== c.u && isAv(h) && (B[h.id].c <= 2 || nm8(h) === 'พยาบาล เอ๋')).map(h => h.u); if (!L.length) return log(r, 'คำสั่งเสีย หมอเสริมศักดิ์: ไม่มีเป้าหมายในนรก');
    ask(r, f.i, { text: 'คำสั่งเสีย: เลือก Avatar Cost ≤2 หรือ พยาบาล เอ๋ จากนรก อัญเชิญลงสนาม', opts: L, cb: us => { if (summonAny(r, f.i, us[0], 'hell')) vfx(us[0], 'burst', '🩺 อัญเชิญ', '#ef4444'); } }); });
}
function bt8End(r, i) {   // End Phase ของผู้เล่น i
  const p = r.p[i]; p.av.forEach(a => { if (a.id === 'BT08-041' && a.us8 !== r.g.n && !noFx(r, a) && p.av.filter(x => B[x.id].n.includes('วานร')).length >= 3) { a.us8 = r.g.n; draw(r, p, 2); vfx(a.u, 'aura', '🐵 จั่ว 2', '#22c55e'); log(r, '🐵 ศาสตราจารย์วานร: ' + p.name + ' จั่ว 2 ใบ'); } });
}
function bt8Weapon(r, c) {   // อีวิลไมเกรน: เมื่อมีการใช้ Modification "อาวุธหุ่นนักรบผู้กล้า"
  allAv(r).forEach(({ i, x }) => { if (x.id !== 'BT08-001' || x.us8 === r.g.n || noFx(r, x)) return; const op = r.p[1 - i]; if (!op.deck.length) return;
    ask(r, i, { yn: true, text: 'อีวิลไมเกรน: สอดแนม Deck ฝ่ายตรงข้าม 1 ใบ (Magic → ลงนรก / อื่นๆ → ใต้ Deck) ไหม?', cb: y => { if (!y || !op.deck.length) return; x.us8 = r.g.n; const t = op.deck.pop();
      if (isMag8(t)) { op.hell.push(t); log(r, '👁 อีวิลไมเกรน: สอดแนม ' + B[t.id].n + ' (Magic) ส่งลงนรก'); vfx(x.u, 'aura', '👁 Magic → นรก', '#ef4444'); } else { op.deck.unshift(t); log(r, '👁 อีวิลไมเกรน: สอดแนม ' + B[t.id].n + ' นำไว้ใต้ Deck'); vfx(x.u, 'aura', '👁 ไว้ใต้ Deck', '#ef4444'); } } }); });
}

/* ===== BT08 รอบ 2: ใบที่ใช้กลไกเดิม (Land/สวมใส่/untarget/mill/kill) ===== */
const isArthur8 = a => isAv(a) && nm8(a).startsWith('อาเธอร์');
function bt8Prot(r, who, x, mg) {   // 035 เล่าปี่: ไม่ถูกเลือกเป็นเป้า Magic ฝ่ายตรงข้าม ตราบที่มี ขุนพลเขียว {ต่างชาติ} ใบอื่น
  if (who === undefined || x.tk || x.id !== 'BT08-035' || !(MGX > 0 || mg)) return false;
  const oi = r.p.findIndex(q => q.av.includes(x)); if (oi < 0 || oi === who || noFx(r, x)) return false;
  return r.p[oi].av.some(a => a.u !== x.u && isKP(a) && isCol(a, 'เขียว'));
}
function bt8Wear(r, i, card, t) {   // 017 มอเดรด: เมื่อ ดาบศักดิ์สิทธิ์ ถูกสวมใส่ให้ใบนี้ (เทิร์นละครั้ง)
  if (t.id !== 'BT08-017' || !isSword8(card) || t.us8 === r.g.n || noFx(r, t)) return;
  r.g.q.push(() => { const p = r.p[i]; if (!find(r, t.u)) return;
    const S = p.av.filter(a => a.u !== t.u).map(a => a.u), H = () => p.hell.filter(h => isAv(h) && B[h.id].n.includes('อัศวินโต๊ะกลม') && colOf(h) === 'ฟ้า' && /จุติ/.test(B[h.id].e || '') && canPlaceAv(r, i, h)).map(h => h.u);
    if (!S.length || !H().length) return;
    ask(r, i, { text: 'มอเดรด: เซ่นไหว้ Avatar ใบอื่น 1 ใบ เพื่ออัญเชิญ จุติ "อัศวินโต๊ะกลม" สีฟ้า จากนรก (ยกเลิก = ไม่ใช้)', opts: S, cancel: true, cb: us => { t.us8 = r.g.n; sac(r, us[0]);
      r.g.q.push(() => { const L = H(); if (!L.length) return; ask(r, i, { text: 'เลือก "อัศวินโต๊ะกลม" สีฟ้า (จุติ) จากนรก อัญเชิญลงสนาม', opts: L, cb: u2 => { if (summonAny(r, i, u2[0], 'hell')) { const c = p.av.find(a => a.u === u2[0]); vfx(u2[0], 'burst', '🗡 อัญเชิญ', '#38bdf8'); c && r.g.q.unshift(() => fxSummon(r, i, c)); } } }); }); } }); });
}
function wearFromHell8(r, i, c, pred, ml) {   // 059/060: สั่งใช้จากนรก สวมใส่ให้ Avatar (นับเป็นการใช้ Modification Magic)
  const p = r.p[i], T = p.av.filter(a => pred(a) && canWear(a, c)).map(a => a.u); if (!T.length) return log(r, 'ไม่มี Avatar ที่สวมใส่ ' + B[c.id].n + ' ได้');
  ask(r, i, { text: 'เลือก Avatar ที่จะสวมใส่ ' + B[c.id].n + ' จากนรก', opts: T, cancel: true, cb: us => { const t = find(r, us[0]); if (!t || p.hell.indexOf(c) < 0) return; if (ml) mill(r, i, ml, c);
    const k = p.hell.indexOf(c); if (k < 0) return; p.hell.splice(k, 1); p.mg.push(c); c.at = t.c.u; r.g.used[i].Modification = 1; vfx(t.c.u, 'aura', '🗡 สวมใส่ ' + B[c.id].n, '#f97316'); log(r, '🗡 ' + B[c.id].n + ' จากนรก → สวมใส่ ' + nmOf(t.c)); bt8Wear(r, i, c, t.c); } });
}
ABIL['BT08-059'] = { zone: 'hell', label: 'ธรณีสูบ 1 ใบ สวมใส่ คาเรนต์ จากนรกให้ อัศวินโต๊ะกลม', cond: (r, i) => !r.g.used[i].Modification && r.p[i].av.some(isKnight) && r.p[i].deck.length > 1, run: (r, i, c) => wearFromHell8(r, i, c, isKnight, 1) };
ABIL['BT08-060'] = { zone: 'hell', label: 'สวมใส่ เอกซ์คาลิเบอร์ จากนรกให้ อาเธอร์', cond: (r, i) => r.p[i].av.some(isArthur8), run: (r, i, c) => wearFromHell8(r, i, c, isArthur8, 0) };
Object.assign(SUM, {
  'BT08-010': (r, i, x) => {   // เซอร์นัท — จุติ: นำ ไอ้นัท จากนรกมาสวมใส่ (🟡 รับสกิลของไอ้นัท ยังไม่ทำ)
    const p = r.p[i], L = p.hell.filter(h => isAv(h) && B[h.id].n.startsWith('ไอ้นัท')).map(h => h.u); if (!L.length) return log(r, 'จุติ เซอร์นัท: ไม่พบ ไอ้นัท ในนรก');
    ask(r, i, { text: 'จุติ: เลือก "ไอ้นัท" จากนรก มาสวมใส่ เซอร์นัท', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { wearOn(r, i, x, c); vfx(x.u, 'aura', '🗡 สวมใส่ ' + B[c.id].n, '#ef4444'); } } });
  },
  'BT08-030': (r, i, x) => {   // เต่า — จุติ: หา อ่อ กระต่ายตาย ใน LIFE แล้วเลือกปฏิบัติ
    const p = r.p[i], isR = l => B[l.id] && B[l.id].n.trim() === 'อ่อ กระต่ายตาย'; let ok = p.life.some(l => l.up && isR(l));
    if (!ok) { const l = p.life.find(k => !k.up && isR(k)); if (l) { l.up = 1; fx({ k: 'life', i }); log(r, '❤ เต่า: เปิด LIFE ค้นหาและหงาย ' + B[l.id].n); ok = true; }
      const idx = p.life.map((k, n) => k.up ? -1 : n).filter(n => n >= 0), objs = shuf(idx.map(n => p.life[n])); idx.forEach((n, k) => { p.life[n] = objs[k]; }); log(r, '🔀 เต่า: สับ LIFE ที่คว่ำและวางคืน'); }
    if (!ok) return log(r, 'จุติ เต่า: ไม่พบ อ่อ กระต่ายตาย ใน LIFE');
    ask(r, i, { text: 'จุติ เต่า: เลือกปฏิบัติ', choices: ['1) ทำลาย Avatar ศัตรูที่ POWER น้อยกว่า', '2) นำ Modification เนยถั่ว จาก Deck มาสวมใส่'], cb: k => {
      if (k === 0) { const O = r.p[1 - i].av.filter(a => P(r, a) < P(r, x) && !protectedFrom0(r, i, a)).map(a => a.u); return ask(r, i, { text: 'เลือก Avatar ศัตรูที่ POWER น้อยกว่า เต่า เพื่อทำลาย', opts: O, cb: us => { vfx(us[0], 'burst', '🐢 ทำลาย', '#22c55e'); destroyAv(r, us[0]); } }); }
      const c = p.deck.find(d => isMod8(d) && nm8(d) === 'เนยถั่ว'); if (!c) { shuf(p.deck); return log(r, 'เต่า: ไม่พบ เนยถั่ว ใน Deck'); }
      p.deck.splice(p.deck.indexOf(c), 1); p.mg.push(c); c.at = x.u; shuf(p.deck); vfx(x.u, 'aura', '🥜 สวมใส่ เนยถั่ว', '#22c55e'); log(r, '🥜 เต่า: นำ เนยถั่ว จาก Deck มาสวมใส่'); } });
  },
});
Object.assign(MG, { 'BT08-062': { mod: 1, steps: [{ key: 'tg', text: 'เนยถั่ว: เลือก "เต่า" ที่จะสวมใส่', opts: (r, i) => r.p[i].av.filter(a => isAv(a) && nm8(a) === 'เต่า').map(a => a.u) }] } });

/* ===== BT08 รอบ 3: ส่วนที่เหลือทั้งหมด (Overdose / ค่ายบางระจัน / ไอดอล / ตอบโต้ / บังคับโจมตี ฯลฯ) ===== */
const OD8 = x => !!x && !x.tk && isAv(x) && /Overdose/.test(B[x.id].n);
const odSide8 = (r, i) => r.p[i].av.some(OD8);   // ฝั่ง i มี Avatar "Overdose" บนสนาม
const odOn8 = (r, i, id) => r.p[i].av.some(a => a.id === id) && r.p[i].life.filter(l => l.up).length >= 3;   // อยู่ในสถานะ Overdose (LIFE หงาย ≥3)
function bt8Mute(r, x, f) { return !OD8(x) && odSide8(r, f.i); }   // "#Avatar ทุกใบฝ่ายเราใช้ความสามารถไม่ได้ ยกเว้น Overdose"
const bt8Camp = (r, i) => r.p[i].av.some(a => a.id === 'BT08-002' && !noFx(r, a));   // ไอ้ชิด: ตัด Cost ทิ้งมือของการ์ดที่มี ค่ายบางระจัน
function bt8CampF(r, i, card, steps) { return (card && (B[card.id].e || '').includes('ค่ายบางระจัน') && bt8Camp(r, i)) ? steps.filter(s => !(s.pay && s.key === 'c' && s.camp)) : steps; }
const bt8Rg = (r, x) => x.rg8 >= r.g.n && r.g.curMg && B[r.g.curMg.card.id].st === 'React';   // เณรคู: ไม่รับผล React Magic
function bt8Snow(x, n) {   // หลินอัน: ผลลด POWER จาก Avatar ฝ่ายตรงข้าม ที่กระทบ Avatar "หิมะ" → เป็นเพิ่มแทน
  if (n >= 0 || !CR || MGX > 0 || !x || x.tk || !isAv(x) || !nmOf(x).includes('หิมะ')) return n;
  const oi = CR.p.findIndex(q => q.av.includes(x)); if (oi < 0 || CR.g.turn === oi) return n;
  return CR.p[oi].av.some(a => a.id === 'BT08-022' && !noFx(CR, a)) ? -n : n;
}
const bt8Soldier = (r, x) => { if (!x || x.tk || !isAv(x) || symOf(x) !== 'คน' || colOf(x) !== 'เขียว') return false; const f = find(r, x.u); return !!(f && f.z === 'av' && r.p[f.i].av.some(a => a.id === 'BT08-040' && !noFx(r, a))); };
const nmT8 = (r, x) => nmOf(x) + (bt8Soldier(r, x) ? ' ทหาร' : '');   // จ่าอเวจี: ได้รับชื่อ "ทหาร"
const bt8Gain = x => x.gain8 || null;
function bt8CoP(r, i, d) { return B[d.id].n.includes('ค่ายบางระจัน') && r.p[i].av.some(a => a.id === 'BT08-004' && !noFx(r, a)) ? 2 : 0; }   // น้าเอี๊ยด: Construct ค่ายบางระจัน +2
function bt8Enter(r, i, c) {   // ราชา รด.: เมื่อมี ทหาร/รด. เข้ามาใน Avatar Zone POWER +1
  if (!c || c.tk || !isAv(c)) return; const nm = nmT8(r, c); if (!/ทหาร|รด\./.test(nm) && !bt8Soldier(r, c)) return;
  r.p[i].av.forEach(a => { if (a.id === 'BT08-039' && !noFx(r, a)) { addPw(a, 1); vfx(a.u, 'aura', '🎖 POWER +1', '#22c55e'); log(r, '🎖 ราชา รด.: มี ทหาร/รด. เข้าสนาม POWER +1'); } });
}
function bt8Life(r, i) {   // โจโฉ: เมื่อ LIFE เราถูกหงาย (เทิร์นละครั้ง) สอดแนมตามจำนวน LIFE ที่หงาย → อัญเชิญ "วุยก๊ก"
  const p = r.p[i]; p.av.forEach(a => { if (a.id !== 'BT08-018' || a.u8 === r.g.n || noFx(r, a)) return; a.u8 = r.g.n;
    r.g.q.push(() => { const n = p.life.filter(l => l.up).length; if (!n) return; vfx(a.u, 'aura', '🏯 สอดแนม ' + n, '#38bdf8');
      scout(r, i, n, { by: a, text: 'โจโฉ: เลือก Avatar "วุยก๊ก" 1 ใบ อัญเชิญลง Avatar Zone', rest: 'shuffle', pred: c => isAv(c) && B[c.id].n.includes('วุยก๊ก') && canPlaceAv(r, i, c), then: got => { if (!got) return; p.deck.push(got); if (summonAny(r, i, got.u, 'deck')) vfx(got.u, 'burst', '🏯 วุยก๊ก', '#38bdf8'); else p.deck.splice(p.deck.indexOf(got), 1), p.hand.push(got); shuf(p.deck); } }); }); });
}
const bt8ChoOK = (r, i, a) => { const p = r.g.pend; if (!p || p.k !== 'atk' || p.who !== i || p.tk !== 'av' || a.id !== 'BT08-018' || noFx(r, a) || r.g.turn === i) return false; const t = r.p[i].av.find(x => x.u === p.tg); return !!t && isKP(t) && colOf(t) === 'ฟ้า' && r.p[i].life.some(l => !l.up); };
function bt8Cho(r, i, f) {   // โจโฉ: ตอบโต้ — หงาย LIFE ใบบนสุด + ยกเลิกการโจมตี
  const a = f.c; if (!bt8ChoOK(r, i, a)) E('เงื่อนไขการใช้ไม่ครบ'); const p = r.g.pend;
  lifeUp(r, i); p.cancel = 1; r.g.pend = null; vfx(a.u, 'burst', '🏯 ยกเลิกโจมตี', '#38bdf8'); fx({ k: 'say', id: a.id, t: 'ยกเลิกการโจมตี' }); log(r, '🏯 โจโฉ: หงาย LIFE ใบบนสุด และยกเลิกการโจมตี');
}
const LB8 = x => B[x.id].n.startsWith('เล่าปี่ ผู้นำคุณธรรมแห่งจ๊กก๊ก');
const bt8KongOK = (r, i, a) => { const p = r.g.pend; if (!p || p.k !== 'ev' || !p.ev || p.ev.k !== 'cast' || p.who !== i || a.id !== 'BT08-036' || noFx(r, a) || a.ou === r.g.n || !r.p[i].hand.length || !B[p.ev.id] || B[p.ev.id].t !== 'Magic') return false;
  const av = r.p[i].av; return av.some(LB8) && av.every(x => x.u === a.u || LB8(x) || (isKP(x) && isCol(x, 'เขียว'))); };
function bt8Kong(r, i, f) {   // ขงเบ้ง: ทิ้งมือ 1 ใบ ยกเลิกการใช้ Magic ของฝ่ายตรงข้าม
  const a = f.c; if (!bt8KongOK(r, i, a)) E('เงื่อนไขการใช้ไม่ครบ'); const p0 = r.g.pend, p = r.p[i];
  ask(r, i, { text: 'ขงเบ้ง: ทิ้งการ์ดบนมือ 1 ใบ เพื่อยกเลิกการใช้ Magic นี้', opts: p.hand.map(c => c.u), cancel: true, cb: us => { if (!r.g.pend || r.g.pend !== p0) return; a.ou = r.g.n; sendHell(r, us[0]); if (p0.ev.cx) p0.ev.cx.cancelled = 1; vfx(a.u, 'burst', '🪭 ยกเลิก Magic', '#22c55e'); fx({ k: 'say', id: a.id, t: 'ยกเลิก Magic' }); log(r, '🪭 ขงเบ้ง: ยกเลิกการใช้ Magic'); } });
}
function bt8Force(r, i) {   // สุมาอี้: ผู้เล่นฝ่ายตรงข้ามต้องสั่ง Avatar โจมตีอย่างน้อย 1 ครั้งเสมอ ถ้าทำได้
  const g = r.g, op = r.p[1 - i]; if (g.n === 0 || (g.atkC && g.atkC.n === g.n && g.atkC.c > 0)) return;
  const s = op.av.find(a => a.id === 'BT08-019' && !noFx(r, a)); if (!s || !op.av.some(a => a.id === 'BT08-018')) return;
  if (!op.av.every(a => a.u === s.u || (isKP(a) && colOf(a) === 'ฟ้า'))) return;
  const can = r.p[i].av.some(a => !a.tired && a.noatk !== g.n && !['BT02-024', 'BT04-029'].includes(a.id) && !(a.id === 'BT03-009' && r.p[i].hand.length) && !(['BT02-029', 'SD04-004'].includes(a.id) && !(a.wr && a.wr.length)) && !(a.id === 'BT08-043' && (a.wr || []).filter(w => B[w.id].t === 'Avatar').length < 2));
  if (can) E('สุมาอี้: ต้องสั่ง Avatar โจมตีอย่างน้อย 1 ครั้ง (ถ้าทำได้)');
}
function bt8Redir(r, i, a, tg, tk, set) {   // ปิ่น: ธรณีสูบ 3 แล้วย้ายเป้าหมายไป LIFE ฝ่ายตรงข้ามได้
  if (a.id !== 'BT08-025' || noFx(r, a) || r.g.phase !== 'battle' || !landIs(r, 'BT08-065') || tk === 'life' || r.p[i].deck.length < 4) return;
  ask(r, i, { yn: true, text: 'ปิ่น: ธรณีสูบ 3 ใบ แล้วย้ายเป้าหมายการโจมตีไปที่ LIFE Card ฝ่ายตรงข้ามไหม?', cb: y => { if (!y) return; mill(r, i, 3, a); set('life', 'life'); vfx(a.u, 'aura', '🎯 โจมตี LIFE', '#a855f7'); log(r, '🎯 ปิ่น: ย้ายเป้าหมายไปที่ LIFE Card ฝ่ายตรงข้าม'); } });
}
function bt8Kill(r, i, u, f0) {   // จิวท่าย: ออกจากสนามโดยความสามารถของการ์ด → ทิ้งจิวท่ายจากมือ ไม่ถูกนำออก
  const p = r.p[f0.i], m = p.hand.find(h => h.id === 'BT08-007'); if (!m) return false;
  ask(r, f0.i, { yn: true, text: 'จิวท่าย: ' + nmOf(f0.c) + ' จะออกจากสนามโดยความสามารถของการ์ด — ทิ้ง จิวท่าย จากมือเพื่อไม่ให้ถูกนำออกไหม?', cb: y => { if (!y) return kill(r, i, u, 1); if (!p.hand.includes(m)) return kill(r, i, u, 1); sendHell(r, m.u); vfx(f0.c.u, 'aura', '🛡 จิวท่าย', '#ef4444'); log(r, '🛡 จิวท่าย: ' + nmOf(f0.c) + ' ไม่ถูกนำออกจากสนาม'); if (f0.c.id === 'BT08-005') { draw(r, p, 1); log(r, '🛡 ซุนกวน: จั่ว 1 ใบ'); } } });
  return true;
}
function bt8Pay(r, i, m, title, then) {   // จ่าย Cost อัญเชิญจากมือ (เหมือน bt6Iron)
  const p = r.p[i]; if (!m || !canPlaceAv(r, i, m)) return;
  ask(r, i, { yn: true, text: title + ' — อัญเชิญ ' + B[m.id].n + ' จากมือ โดยจ่าย Cost ไหม?', cb: y => { if (!y || !p.hand.includes(m)) return;
    const go = ps => { ps.forEach(q => { const k = p.hand.indexOf(q); if (k >= 0) { p.hand.splice(k, 1); p.hell.push(q); } }); if (summonAny(r, i, m.u, 'hand')) { vfx(m.u, 'burst', '✨ อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, m)); if (ps.length) r.g.q.push(() => fxPaid(r, i, ps, m)); } };
    const pay = () => { const O = p.hand.filter(h => h.u !== m.u && !h.stl).map(h => h.u); if (!O.length) return log(r, B[m.id].n + ': ไม่มีการ์ดจ่าย Cost');
      ask(r, i, { text: 'เลือกการ์ดบนมือเป็น Cost (Gem รวม ≥ ' + B[m.id].g + ' สีตรง/ไม่มีสี)', opts: O, n: O.length, min: 1, cancel: true, cb: us => { const ps = us.map(u => p.hand.find(h => h.u === u)).filter(Boolean); try { payOK(B[m.id], ps, p); } catch (e) { log(r, '❌ จ่าย Cost ไม่ถูกต้อง: ' + e); return pay(); } go(ps); } }); };
    pay(); } });
}
function bt8Q055(r, f, cont) {   // แผนการ : ตอกฝาโลง — ยกเลิกความสามารถ คำสั่งเสีย ของฝ่ายตรงข้าม
  if (!/คำสั่งเสีย/.test(B[f.c.id] ? (B[f.c.id].e || '') : '')) return false; const w = 1 - f.i, c = r.p[w].hand.find(h => h.id === 'BT08-055'); if (!c) return false;
  ask(r, w, { yn: true, text: 'แผนการ : ตอกฝาโลง — ' + nmOf(f.c) + ' ของฝ่ายตรงข้ามจะใช้ คำสั่งเสีย ใช้ Magic นี้ยกเลิกความสามารถนั้นไหม?', cb: y => { if (!y || !r.p[w].hand.includes(c)) return cont(); sendHell(r, c.u); vfx(f.c.u, 'burst', '⚰ ตอกฝาโลง', '#a855f7'); log(r, '⚰ แผนการ : ตอกฝาโลง: ยกเลิก คำสั่งเสีย ของ ' + nmOf(f.c)); } });
  return true;
}
function bt8Rat(r, f) {   // รัททาทุยเกาะหน้า (React): เมื่อ Avatar {รัททาทุย} ถูกทำลาย
  const c = f.c; if (!c || c.tk || !B[c.id] || B[c.id].t !== 'Avatar' || symOf(c) !== 'รัททาทุย') return; const i = f.i, p = r.p[i], m = p.hand.find(h => h.id === 'BT08-058'); if (!m) return;
  const O = () => r.p[1 - i].av.filter(a => B[a.id].c <= 5 && !protectedFrom(r, i, a, 1)).map(a => a.u); if (!O().length) return;
  r.g.q.push(() => ask(r, i, { yn: true, text: 'รัททาทุยเกาะหน้า: ' + nmOf(c) + ' ถูกทำลาย — ใช้ Magic นี้ทำลาย Avatar ฝ่ายตรงข้าม Cost ≤5 แล้วอัญเชิญ {รัททาทุย} Cost1 Gem1 POWER1 จาก Deck ไหม?', cb: y => { if (!y || !p.hand.includes(m)) return;
    sendHell(r, m.u); log(r, '🐀 ' + p.name + ' ใช้ รัททาทุยเกาะหน้า');
    ask(r, i, { text: 'เลือก Avatar ฝ่ายตรงข้าม Cost ≤5 เพื่อทำลาย', opts: O(), cb: us => { vfx(us[0], 'burst', '🐀 ทำลาย', '#ef4444'); destroyAv(r, us[0]);
      r.g.q.push(() => { const L = p.deck.filter(d => isAv(d) && B[d.id].s === 'รัททาทุย' && B[d.id].c === 1 && B[d.id].g === 1 && B[d.id].p === 1 && canPlaceAv(r, i, d)).map(d => d.u); if (!L.length) { shuf(p.deck); return log(r, 'รัททาทุยเกาะหน้า: ไม่พบ Avatar {รัททาทุย} Cost1 Gem1 POWER1'); }
        ask(r, i, { text: 'เลือก Avatar {รัททาทุย} Cost1 Gem1 POWER1 จาก Deck อัญเชิญลงสนาม', opts: L, cb: u2 => { if (summonAny(r, i, u2[0], 'deck')) vfx(u2[0], 'burst', '🐀 อัญเชิญ', '#38bdf8'); shuf(p.deck); } }); }); } }); } }));
}
function bt8Spell(r, i, c) {   // โรงเรียนเวทย์มนต์: เมื่อมีการใช้ "คาถา" → นำ Magic จากนรกมาวางคว่ำบน Magic Zone
  if (!isSpell(c) || !landOf(r, 'BT08-064', r.g.land && r.g.land.o)) return; const o = r.g.land.o, p = r.p[o];
  r.g.q.push(() => { const L = p.hell.filter(isMag8).map(h => h.u); if (!L.length) return; ask(r, o, { text: 'โรงเรียนเวทย์มนต์: เลือก Magic Card 1 ใบจากนรก วางคว่ำบน Magic Zone (เป็น Gem)', opts: L, cancel: true, cb: us => { const h = fromZone(r, o, 'hell', us[0]); if (!h) return; h.fd8 = 1; p.mg.push(h); vfx(h.u, 'aura', '🎴 วางคว่ำ', '#a855f7'); log(r, '🎴 โรงเรียนเวทย์มนต์: วาง Magic คว่ำบน Magic Zone'); } }); });
}

/* ---------- Avatar: สั่งใช้ / จุติ ---------- */
Object.assign(AB, {
  'BT08-003': { z: 'av', steps: [need8((r, i) => r.p[i].co.some(k => B[k.id].n.includes('ค่ายบางระจัน')), 'เณรคู: ต้องมี Construct "ค่ายบางระจัน" (กดเลือกตัวเองเพื่อยืนยัน)'), { key: 'c', camp: 1, pay: 1, text: 'เณรคู: ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i, cx) => r.p[i].hand.filter(c => c.u !== cx.card.u).map(c => c.u) }],
    run: (r, i) => { r.p[i].av.filter(campTxt).forEach(a => { a.rg8 = r.g.n; vfx(a.u, 'aura', '🛡 ไม่รับผล React', '#ef4444'); }); log(r, '🛡 เณรคู: Avatar ค่ายบางระจัน ไม่รับผล React Magic ฝ่ายตรงข้ามจนจบเทิร์น'); } },
  'BT08-021': { z: 'av', steps: [{ key: 't', text: 'โอตะท๊อปโดเนท: เลือก Avatar "ไอดอล" ที่จะสวมใส่', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== cx.card.u && isIdol(a) && canWear(a, cx.card)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]), f = find(r, cx.card.u); if (!t || !f || f.z !== 'av') return; take(r, cx.card.u); wearOn(r, i, t.c, cx.card); vfx(t.c.u, 'aura', '🎧 สวมใส่ โอตะ', '#38bdf8'); log(r, '🎧 โอตะท๊อปโดเนท: สวมใส่ให้ ' + nmOf(t.c)); } },
  'BT08-029': { z: 'av', steps: [need8((r, i, cx) => (cx.card.u29 === r.g.n ? cx.card.c29 || 0 : 0) < (r.p[i].av.some(a => B[a.id].n.includes('ทัตดนัยซัง')) ? 2 : 1) && r.p[i].av.filter(a => a.u !== cx.card.u && isIdol(a) && otaOf(a).length).length >= 1 && r.p[1 - i].av.length > 0, 'เนียจัง: ต้องมีโอตะที่สวมใส่ ไอดอล 2 ใบ (โอตะท๊อปโดเนท นับ 2) และฝ่ายตรงข้ามมี Avatar (กดเลือกตัวเองเพื่อยืนยัน)'),
    { key: 'i', n: 2, min: 1, text: 'เนียจัง: เลือก Avatar "ไอดอล" 2 ใบที่มี โอตะ สวมใส่ (โอตะท๊อปโดเนท นับเป็น 2) เพื่อทำลายโอตะ', opts: (r, i, cx) => r.p[i].av.filter(a => isIdol(a) && otaOf(a).length).map(a => a.u) },
    { key: 't', text: 'เนียจัง: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ เปลี่ยนชื่อเป็น "โอตะ" และนำมาสวมใส่ เนียจัง', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom0(r, i, a)).map(a => a.u) }],
    run: (r, i, cx) => { const x = cx.card, w = cx.pick.i.map(u => find(r, u)).filter(Boolean), need = w.reduce((s, q) => s + (otaOf(q.c).some(o => o.id === 'BT08-021') ? 2 : 1), 0);
      if (need < 2 && w.length < 2) { log(r, 'เนียจัง: โอตะที่ทำลายไม่ครบ 2 ใบ'); x.us = 0; return; }
      w.forEach(q => { const o = otaOf(q.c)[0]; const k = q.c.wr.indexOf(o); if (k >= 0) { q.c.wr.splice(k, 1); r.p[i].hell.push(o); } }); x.c29 = (x.u29 === r.g.n ? x.c29 || 0 : 0) + 1; x.u29 = r.g.n;
      if (x.c29 < (r.p[i].av.some(a => B[a.id].n.includes('ทัตดนัยซัง')) ? 2 : 1)) x.us = 0;
      const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; const e = take(r, t.c.u); e.c.nmo = 'โอตะ'; e.c.pw = 0; e.c.tp = 0; e.c.bp = 0; wearOn(r, i, x, e.c); vfx(x.u, 'aura', '🎧 โอตะ ใหม่', '#a855f7'); log(r, '🎧 เนียจัง: เปลี่ยน ' + B[e.c.id].n + ' เป็น "โอตะ" แล้วสวมใส่'); } },
  'BT08-064': { z: 'land', steps: [{ key: 'a', text: 'โรงเรียนเวทย์มนต์: เลือก Avatar "จอมเวทย์" จากมือ', opts: (r, i) => r.p[i].hand.filter(c => isAv(c) && B[c.id].n.includes('จอมเวท') && canPlaceAv(r, i, c)).map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], m = p.hand.find(h => h.u === cx.pick.a[0]); if (!m) return; const fd = p.mg.filter(q => q.fd8);
      const finish = (gems, ps) => { gems.forEach(q => { const k = p.mg.indexOf(q); if (k >= 0) { p.mg.splice(k, 1); delete q.fd8; p.hell.push(q); } }); ps.forEach(q => { const k = p.hand.indexOf(q); if (k >= 0) { p.hand.splice(k, 1); p.hell.push(q); } });
        if (summonAny(r, i, m.u, 'hand')) { vfx(m.u, 'burst', '🏫 จอมเวทย์', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, m)); if (ps.length) r.g.q.push(() => fxPaid(r, i, ps, m)); } };
      const pay = gems => { const need = Math.max(0, (B[m.id].g || 0) - gems.length); if (!need) return finish(gems, []); const O = p.hand.filter(h => h.u !== m.u && !h.stl).map(h => h.u); if (!O.length) return log(r, 'โรงเรียนเวทย์มนต์: ไม่มีการ์ดจ่าย Gem เพิ่ม');
        ask(r, i, { text: 'ขาด Gem อีก ' + need + ' — เลือกการ์ดบนมือเป็น Cost', opts: O, n: O.length, min: 1, cancel: true, cb: us => { const ps = us.map(u => p.hand.find(h => h.u === u)).filter(Boolean); try { payOK({ ...B[m.id], g: need }, ps, p); } catch (e) { log(r, '❌ จ่าย Cost ไม่ถูกต้อง: ' + e); return pay(gems); } finish(gems, ps); } }); };
      if (!fd.length) return pay([]);
      ask(r, i, { text: 'โรงเรียนเวทย์มนต์: เลือก Magic ที่คว่ำอยู่ ลงนรกเป็น Gem (ใบละ 1) — ไม่เลือกก็ได้', opts: fd.map(q => q.u), n: fd.length, min: 0, cancel: true, cb: us => pay(us.map(u => p.mg.find(q => q.u === u)).filter(Boolean)), none: () => pay([]) }); } },
  'BT08-065': { z: 'land', steps: [need8((r, i) => bt8K65(r, i).length > 0, 'โคกอีสานนูน: เงื่อนไขการใช้ยังไม่ครบ (กดเลือกการ์ดเพื่อยืนยัน)')],   // รวม 2 ความสามารถ (เทิร์นละครั้งต่อความสามารถ)
    run: (r, i, cx) => { const modes = bt8K65(r, i), go = k => { const x = cx.card; x['u65' + k] = r.g.n; if (k === 1) bt8K651(r, i, x); else bt8K652(r, i, x); r.g.q.push(() => { x.us = bt8K65(r, i).length ? 0 : r.g.n; }); };
      if (modes.length === 1) return go(modes[0]); ask(r, i, { text: 'โคกอีสานนูน: เลือกความสามารถ', choices: ['1) คืนการ์ด 6 ใบจากนรกเข้า Deck แล้วจั่ว 1', '2) ให้ อีสานสลิงเกอร์ ต่อสู้กับ Avatar ฝ่ายตรงข้าม'], cb: k => go(modes[k] || modes[0]) }); } },
});
const bt8Sl = (r, i) => r.p[i].av.filter(a => B[a.id].n.startsWith('อีสานสลิงเกอร์'));
function bt8K65(r, i) { const x = r.g.land && r.g.land.c, o = []; if (!x || x.id !== 'BT08-065') return o; const p = r.p[i];
  if (x.u651 !== r.g.n && bt8Sl(r, i).length && p.hell.length >= 6 && p.hell.filter(c => !isMag8(c)).length + Math.min(2, p.hell.filter(isMag8).length) >= 6) o.push(1);
  if (x.u652 !== r.g.n && r.g.dk8 && r.g.dk8.n === r.g.n && r.g.dk8.c >= 6 && bt8Sl(r, i).length && r.p[1 - i].av.length) o.push(2); return o; }
function bt8K651(r, i, x) { const p = r.p[i];
  ask(r, i, { text: 'โคกอีสานนูน: เลือก Magic ในนรกไม่เกิน 2 ใบ (ไม่เลือกก็ได้)', opts: p.hell.filter(isMag8).map(c => c.u), n: 2, min: 0, cancel: true, cb: ms => { const need = 6 - ms.length, O = p.hell.filter(c => !ms.includes(c.u) && !isMag8(c)).map(c => c.u); if (O.length < need) return log(r, 'โคกอีสานนูน: การ์ดที่ไม่ใช่ Magic ไม่พอ');
    ask(r, i, { text: 'เลือกการ์ดในนรกอีก ' + need + ' ใบ (ที่ไม่ใช่ Magic)', opts: O, n: need, min: need, cancel: true, cb: us => { const cs = [...ms, ...us].map(u => p.hell.find(c => c.u === u)).filter(Boolean); cs.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } }); shuf(p.deck); r.g.dk8 = { n: r.g.n, c: ((r.g.dk8 && r.g.dk8.n === r.g.n) ? r.g.dk8.c : 0) + cs.length }; draw(r, p, 1); vfx(x.u, 'aura', '🌳 คืน ' + cs.length + ' ใบ จั่ว 1', '#a855f7'); log(r, '🌳 โคกอีสานนูน: คืน ' + cs.length + ' ใบเข้า Deck แล้วจั่ว 1 ใบ'); } }); }, none: () => bt8K651b(r, i, x) });
}
function bt8K651b(r, i, x) { const p = r.p[i], O = p.hell.filter(c => !isMag8(c)).map(c => c.u); if (O.length < 6) return log(r, 'โคกอีสานนูน: การ์ดไม่พอ');
  ask(r, i, { text: 'เลือกการ์ดในนรก 6 ใบ (ที่ไม่ใช่ Magic)', opts: O, n: 6, min: 6, cancel: true, cb: us => { const cs = us.map(u => p.hell.find(c => c.u === u)).filter(Boolean); cs.forEach(c => { p.hell.splice(p.hell.indexOf(c), 1); p.deck.push(c); }); shuf(p.deck); r.g.dk8 = { n: r.g.n, c: ((r.g.dk8 && r.g.dk8.n === r.g.n) ? r.g.dk8.c : 0) + cs.length }; draw(r, p, 1); vfx(x.u, 'aura', '🌳 คืน 6 จั่ว 1', '#a855f7'); log(r, '🌳 โคกอีสานนูน: คืน 6 ใบ จั่ว 1'); } });
}
function bt8K652(r, i, x) { const p = r.p[i];
  ask(r, i, { text: 'โคกอีสานนูน: เลือก "อีสานสลิงเกอร์" ของเรา 1 ใบ', opts: bt8Sl(r, i).map(a => a.u), cancel: true, cb: us => {
    ask(r, i, { text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ที่จะต่อสู้', opts: r.p[1 - i].av.map(a => a.u), cancel: true, cb: u2 => { const a = find(r, us[0]), t = find(r, u2[0]); if (!a || !t) return; vfx(a.c.u, 'burst', '⚔ ต่อสู้!', '#a855f7'); log(r, '⚔ โคกอีสานนูน: ' + nmOf(a.c) + ' ต่อสู้กับ ' + nmOf(t.c) + ' (ไม่เปลี่ยนเป็นสภาพนอน / ห้ามใช้ React Magic)');
      const tired = a.c.tired; r.g.q.push(() => { fx({ k: 'atkp', i, a: a.c.u, tg: t.c.u, tk: 'av' }); try { resolveAtk(r, { who: 1 - i, k: 'atk', ai: i, u: a.c.u, tg: t.c.u, tk: 'av' }); } finally { const q = find(r, a.c.u); if (q && q.z === 'av') q.c.tired = tired; } }); } }); } });
}
Object.assign(SUM, {
  'BT08-029': (r, i, x) => {   // เนียจัง — จุติ ถ้า LIFE หงาย ≥3 หรือมี มยุราซัง: อัญเชิญ ทัตดนัยซัง จากมือ/Deck
    const p = r.p[i]; if (p.life.filter(l => l.up).length < 3 && !p.av.some(a => B[a.id].n.startsWith('มยุราซัง'))) return log(r, 'จุติ เนียจัง: เงื่อนไขไม่ครบ (LIFE หงาย ≥3 หรือมี มยุราซัง)');
    const L = [...p.hand.map(c => ['hand', c]), ...p.deck.map(c => ['deck', c])].filter(([, c]) => isAv(c) && B[c.id].n.startsWith('ทัตดนัยซัง') && canPlaceAv(r, i, c)); if (!L.length) return log(r, 'จุติ เนียจัง: ไม่พบ ทัตดนัยซัง ในมือ/Deck');
    ask(r, i, { text: 'จุติ: เลือก "ทัตดนัยซัง" จากมือ/Deck อัญเชิญลงสนาม', opts: L.map(([, c]) => c.u), cb: us => { const e = L.find(([, c]) => c.u === us[0]); if (e && summonAny(r, i, e[1].u, e[0])) { vfx(e[1].u, 'burst', '🎤 ทัตดนัยซัง', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, e[1])); } if (e && e[0] === 'deck') shuf(p.deck); } });
  },
});
{ const o4 = SUM['SD06-004']; SUM['SD06-004'] = (r, i, x) => { if (!bt8Camp(r, i)) return o4(r, i, x); const p = r.p[i]; if (p.co.length >= 3 || p.co.some(c => c.id === 'SD06-018') || !p.deck.some(c => c.id === 'SD06-018')) return;
  ask(r, i, { yn: true, text: 'จุติ: ก่อสร้าง ค่ายบางระจัน จาก Deck (ไอ้ชิด: ไม่ต้องทิ้งการ์ดบนมือ) ไหม?', cb: y => { if (!y) return; const c = p.deck.find(k => k.id === 'SD06-018'); p.co.push(fromZone(r, i, 'deck', c.u)); shuf(p.deck); ev(r, c.kd || c.id); log(r, '🏕 ' + p.name + ': ก่อสร้าง ค่ายบางระจัน (ไอ้ชิดตัด Cost)'); } }); }; }
WEAR_IDOL.push('BT08-021');

/* ===================================================================
   BT09 — SKILL + ANIMATION (ระดับกลาง)
   บล็อกแยก: ใช้ registry เดิม (SUM / AB / ABIL / MG / BT4A / ATK_TRIG) และเอฟเฟกต์เดิม (vfx aura/burst, fx say)
   ไม่แก้ฟังก์ชันเดิม ยกเว้น 1 จุดใน const kick (เตะไข่ของ BT09-038)
   ห่อ P() และ hasKw() ด้วยการ reassign เพื่อไม่ต้องแตะโค้ดเดิม
   =================================================================== */
const nm9 = c => (B[c.id].n || '').replace(/\s+/g, ' ').trim();
const onAv9 = (r, x) => { const f = find(r, x.u); return !!(f && f.z === 'av'); };
const isFruit9 = c => !c.tk && isAv(c) && nm9(c).startsWith('ภูติผลไม้');
const isHoHua9 = x => isAv(x) && nmOf(x).includes('แห่หัว');
const PJ9 = 'พี่โปจิ';   // ใบที่ถูกอัญเชิญด้วยความสามารถของ พี่โปจิ จะมี flag x.pj9 = 1 (ล้างเมื่อเห็นว่าออกจากสนามแล้ว)
const LAND9 = 'BT09-071';  // ป่าพงไพร เผ่าพงศ์พันธุ์
const sumFx9 = (r, i, c, from, src, txt, col) => { if (!summonAny(r, i, c.u, from, src)) return false; vfx(c.u, 'burst', txt || 'อัญเชิญ', col || '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); return true; };

/* ---------- POWER ต่อเนื่อง (ห่อ P) ---------- */
const _P9 = P;
P = function (r, x) {
  let v = _P9(r, x);
  if (x.tk) return v;
  const f = find(r, x.u);
  if (!f || f.z !== 'av') { if (x.pj9) delete x.pj9; return v; }
  if (x.id === 'BT09-002' && !noFx(r, x)) v += r.p[f.i].av.filter(a => a.u !== x.u && isHoHua9(a)).length * (x.pj9 ? 2 : 1);   // เนอร์เกิ้ล เนียร์
  if (landIs(r, LAND9) && isFruit9(x)) v += 2;                                                                                  // ป่าพงไพร: ภูติผลไม้ +2
  r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u && m.id === 'BT09-066') v += 1; }));                                    // หอกศักดิ์สิทธิ์ เอ็ดดา
  return Math.max(0, v);
};

/* ---------- คีย์เวิร์ดแบบมีเงื่อนไข (ห่อ hasKw) ---------- */
Object.assign(B7NK, { 'BT09-034': ['ลูกฮึด', 'โล่มนุษย์'], 'BT09-036': ['โล่มนุษย์'], 'BT09-038': ['เตะไข่'] });
const B9K = {
  'BT09-036': { 'โล่มนุษย์': (r, x) => onAv9(r, x) && !noFx(r, x) && landIs(r, LAND9) },
  'BT09-038': { 'เตะไข่': (r, x) => { const f = find(r, x.u); return !!f && f.z === 'av' && !noFx(r, x) && landIs(r, LAND9) && r.p[1 - f.i].life.some(l => !l.up); } },
};
const _hasKw9 = hasKw;
hasKw = function (r, x, kw) {
  if (!x.tk && (kw === 'ลูกฮึด' || kw === 'โล่มนุษย์') && x.b9k >= r.g.n && onAv9(r, x)) return true;   // ปอนด์ ให้ ลูกฮึด/โล่มนุษย์ จนจบเทิร์นฝ่ายตรงข้าม
  const d = !x.tk && B9K[x.id] && B9K[x.id][kw];
  if (d) return !!d(r, x);
  return _hasKw9(r, x, kw);
};

/* ---------- ATTACK TRIGGER ---------- */
ATK_TRIG.add('BT09-040');
BT4A['BT09-040'] = (r, i, a, tg, tk) => {   // จ่ายุทธ ทหารรักชาติ: โจมตี Avatar {ต่างชาติ} → ทำลายเป้าหมาย
  if (tk !== 'av') return;
  const d = r.p[1 - i].av.find(x => x.u === tg);
  if (d && ((symOf(d) === 'ต่างชาติ' || also9(d, 'ต่างชาติ')) || d.id === 'BT09-015')) { fx({ k: 'say', id: a.id, t: 'ทำลายเป้าหมาย' }); vfx(d.u, 'burst', '💥 ทหารรักชาติ', '#ef4444'); log(r, '💥 จ่ายุทธ ทหารรักชาติ: ทำลาย ' + nmOf(d)); destroyAv(r, d.u); }
};

/* ---------- จุติ ---------- */
Object.assign(SUM, {
  'BT09-011': (r, i, x) => {   // เจ้าหญิงรวงข้าว (จุติ; ส่วนต่อเนื่อง Link อยู่ใน P() ด้านล่าง)
    const p = r.p[i], isWpn = c => !c.tk && B[c.id].t === 'Magic' && /อาวุ[ธร]ของเพมมุ/.test(B[c.id].n);
    const L = [...p.dk.filter(c => !c.tk && isAv(c) && nm9(c).startsWith('เมย์ แวมไพร์โกธิค')), ...p.hell.filter(isWpn)].map(c => c.u);
    if (!L.length) return log(r, 'จุติ เจ้าหญิงรวงข้าว: ไม่พบ เมย์ แวมไพร์โกธิค (มิติมืด) หรือ อาวุธของเพมมุ (นรก)');
    ask(r, i, { text: 'จุติ: เลือก เมย์ แวมไพร์โกธิค (มิติมืด) หรืออาวุธของเพมมุ (นรก) 1 ใบ กลับเข้า Deck', opts: L, cb: us => {
      let k = p.dk.findIndex(c => c.u === us[0]), c = null;
      if (k >= 0) c = p.dk.splice(k, 1)[0]; else { k = p.hell.findIndex(c2 => c2.u === us[0]); if (k >= 0) c = p.hell.splice(k, 1)[0]; }
      if (!c) return; p.deck.push(c); shuf(p.deck); draw(r, p, 1); vfx(x.u, 'aura', '↩ กลับ Deck + จั่ว 1', '#f97316'); log(r, '✨ เจ้าหญิงรวงข้าว: นำ ' + B[c.id].n + ' กลับเข้า Deck แล้วสับ จากนั้นจั่ว 1 ใบ'); } });
  },
  'BT09-023': (r, i, x) => {   // ริน บันนี่เกิร์ล
    const T = allAvT(r, i).filter(u => { const f = find(r, u); return f && f.z === 'av' && f.i !== i && P(r, f.c) === 0; });
    if (!T.length) return log(r, 'จุติ ริน บันนี่เกิร์ล: ไม่มี Avatar ฝ่ายตรงข้ามที่ POWER 0');
    ask(r, i, { text: 'จุติ: เลือก Avatar ฝ่ายตรงข้ามที่ POWER 0 เปลี่ยนการควบคุมมาฝั่งเรา แล้ว POWER +1', opts: T, cb: us => {
      const f = find(r, us[0]); if (!f || f.z !== 'av') return;
      if (stealCard(r, i, f.c.u)) { addPw(f.c, 1); vfx(f.c.u, 'burst', '🐰 ยึดมาแล้ว!', '#a855f7'); vfx(f.c.u, 'aura', 'POWER +1', '#a855f7'); log(r, '🐰 ริน บันนี่เกิร์ล: ' + nmOf(f.c) + ' POWER +1'); } } });
  },
  'BT09-027': (r, i, x) => {   // มิสเตอร์โบโบ้ (พอดี)
    if (!x.jt) return log(r, 'มิสเตอร์โบโบ้: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i]; if (!p.deck.length) return;
    const c = bt4Peek(r, i, 1, x)[0]; if (!c || !p.deck.includes(c)) return;
    if (isAv(c) && symOf(c) === 'เทพ') { if (!sumFx9(r, i, c, 'deck', x, 'อัญเชิญ จุติ', '#facc15')) log(r, 'มิสเตอร์โบโบ้: อัญเชิญ ' + B[c.id].n + ' ไม่ได้'); }
    else { p.deck.splice(p.deck.indexOf(c), 1); p.hell.push(c); vfx(c.u, 'aura', 'ลงนรก', '#a855f7'); log(r, '🕳 มิสเตอร์โบโบ้: ' + B[c.id].n + ' ไม่ใช่ Avatar {เทพ} — ทิ้งลงนรก'); }
  },
  'BT09-039': (r, i, x) => {   // ภูติผลไม้ มะขาม
    const p = r.p[i], isL = c => !c.tk && c.id === LAND9, L = [...p.deck.filter(isL), ...p.hell.filter(isL)].map(c => c.u);
    if (!L.length) return log(r, 'จุติ มะขาม: ไม่พบ ป่าพงไพร เผ่าพงศ์พันธุ์ ใน Deck/นรก');
    const go = u => { let c, fromDeck = false, k = p.deck.findIndex(c2 => c2.u === u); if (k >= 0) { c = p.deck.splice(k, 1)[0]; fromDeck = true; } else { k = p.hell.findIndex(c2 => c2.u === u); if (k >= 0) c = p.hell.splice(k, 1)[0]; }
      if (!c) return; p.hand.push(c); if (fromDeck) shuf(p.deck); vfx(x.u, 'aura', '🌳 ป่าพงไพร → ขึ้นมือ', '#22c55e'); log(r, '✨ มะขาม: นำ ป่าพงไพร เผ่าพงศ์พันธุ์ ขึ้นมือ'); };
    if (L.length === 1) return go(L[0]);
    ask(r, i, { text: 'จุติ: เลือก ป่าพงไพร เผ่าพงศ์พันธุ์ จาก Deck หรือ นรก ขึ้นมือ', opts: L, cb: us => go(us[0]) });
  },
});

/* ---------- สั่งใช้ (บนสนาม) ---------- */
Object.assign(AB, {
  'BT09-026': { z: 'av', steps: [], run: (r, i, cx) => {   // แมวดำ สมาชิกลัทธิแห่หัว
    const x = cx.card, op = r.p[1 - i];
    if (x.pj9) { if (!op.hell.length) return log(r, 'แมวดำ: นรกฝ่ายตรงข้ามว่าง'); const c = op.hell.shift(); op.dk.push(c); vfx(x.u, 'burst', '🌀 เนรเทศล่างสุดของนรก', '#a855f7'); log(r, '🌀 แมวดำ: เนรเทศ ' + B[c.id].n + ' (ใบล่างสุดของนรก ' + op.name + ')'); }
    else { vfx(x.u, 'aura', '🕳 ธรณีสูบ 1', '#a855f7'); mill(r, 1 - i, 1, x); } } },
  'BT09-034': { z: 'av', can: (r, i) => r.p[i].hell.length > 0 && r.p[i].av.some(isHoHua9),   // ปอนด์ สมาชิกลัทธิแห่หัว
    steps: [{ key: 'h', text: 'เนรเทศการ์ดในนรกเรา 1 ใบ', opts: (r, i) => r.p[i].hell.map(c => c.u) }, { key: 't', text: 'เลือก Avatar "แห่หัว" บน Avatar Zone เรา 1 ใบ', opts: (r, i) => r.p[i].av.filter(isHoHua9).map(a => a.u) }],
    run: (r, i, cx) => { const p = r.p[i], h = fromZone(r, i, 'hell', cx.pick.h[0]), t = find(r, cx.pick.t[0]); if (!h) return; p.dk.push(h); log(r, '🌀 ปอนด์: เนรเทศ ' + B[h.id].n + ' จากนรก'); if (!t || t.z !== 'av') return;
      t.c.b9k = r.g.n + 1; if (cx.card.pj9) t.c.mgProt = r.g.n + 1;
      vfx(t.c.u, 'aura', cx.card.pj9 ? '🛡 ลูกฮึด+โล่มนุษย์+กัน Magic' : '🛡 ลูกฮึด+โล่มนุษย์', '#38bdf8'); log(r, '🛡 ' + nmOf(t.c) + ' ได้รับ ลูกฮึด และ โล่มนุษย์' + (cx.card.pj9 ? ' และไม่รับผลจาก Magic ฝ่ายตรงข้าม' : '') + ' จนจบเทิร์นฝ่ายตรงข้าม'); } },
  'BT09-017': { z: 'av', steps: [], can: (r, i) => { const p = r.p[i]; return ['Avatar', 'Magic', 'Construct'].some(t => p.deck.some(c => !c.tk && B[c.id].t === t)); },   // พี่โปจิ เจ้าลัทธิแห่หัว
    run: (r, i, cx) => { const p = r.p[i], x = cx.card, ty = t => c => !c.tk && B[c.id].t === t;
      const M = [
        { t: '1) เนรเทศ Avatar จาก Deck → อัญเชิญ เนอร์เกิ้ล เนียร์', pick: ty('Avatar'), want: c => isAv(c) && nm9(c).startsWith('เนอร์เกิ้ล') },
        { t: '2) เนรเทศ Magic จาก Deck → อัญเชิญ แมวดำ', pick: ty('Magic'), want: c => isAv(c) && nm9(c).startsWith('แมวดำ สมาชิกลัทธิแห่หัว') },
        { t: '3) เนรเทศ Construct จาก Deck → อัญเชิญ ปอนด์', pick: ty('Construct'), want: c => isAv(c) && nm9(c).startsWith('ปอนด์ สมาชิกลัทธิแห่หัว') },
      ].filter(m => p.deck.some(w => m.want(w)) && p.deck.some(c => m.pick(c) && !m.want(c)) || (p.deck.filter(m.want).length > 0 && p.deck.filter(m.pick).length >= 2));
      if (!M.length) { shuf(p.deck); return log(r, 'พี่โปจิ: ไม่มีทางเลือกที่ทำได้ใน Deck'); }
      const go = m => { const O = p.deck.filter(m.pick).map(c => c.u);
        ask(r, i, { text: 'พี่โปจิ: เลือกการ์ดจาก Deck เพื่อเนรเทศ', opts: O, cb: us => { const k = p.deck.findIndex(c => c.u === us[0]); if (k < 0) return; const e = p.deck.splice(k, 1)[0]; p.dk.push(e); vfx(x.u, 'aura', '🌀 เนรเทศ ' + B[e.id].n, '#a855f7'); log(r, '🌀 พี่โปจิ: เนรเทศ ' + B[e.id].n + ' จาก Deck');
          const w = p.deck.find(m.want); if (w && sumFx9(r, i, w, 'deck', x, 'อัญเชิญ (ลัทธิแห่หัว)', '#a855f7')) { w.pj9 = 1; log(r, '✨ พี่โปจิ: อัญเชิญ ' + B[w.id].n + ' จาก Deck'); } else log(r, 'พี่โปจิ: อัญเชิญไม่ได้');
          shuf(p.deck); } }); };
      if (M.length === 1) go(M[0]); else ask(r, i, { text: 'พี่โปจิ: เลือกปฏิบัติ', choices: M.map(m => m.t), cb: k => go(M[k]) }); } },
});

/* ---------- สั่งใช้ (นรก / สิ่งก่อสร้าง) ---------- */
Object.assign(ABIL, {
  'BT09-003': { zone: 'hell', label: 'เนรเทศใบนี้: Avatar ของเรา 1 ใบ POWER +2 จนจบเทิร์น', cond: (r, i) => r.p[i].av.length > 0,   // นางฟ้าลูกซอง
    run: (r, i, x) => { const p = r.p[i];
      ask(r, i, { text: 'นางฟ้าลูกซอง: เลือก Avatar ของเรา 1 ใบ POWER +2 จนจบเทิร์น (ยกเลิก = ไม่ใช้)', opts: p.av.map(a => a.u), cancel: true, cb: us => { const t = find(r, us[0]), k = p.hell.indexOf(x); if (!t || t.z !== 'av' || k < 0) return;
        p.hell.splice(k, 1); p.dk.push(x); addTp(t.c, 2); vfx(t.c.u, 'aura', '🧚 POWER +2', '#facc15'); log(r, '🧚 นางฟ้าลูกซอง: เนรเทศตัวเอง — ' + nmOf(t.c) + ' POWER +2 จนจบเทิร์น'); } }); } },
  'BT09-072': { zone: 'co', once: 1, label: 'สลับการ์ดบนมือ 1 ใบ กับใบบนสุดของ Deck', hint: 'ต้องมี Avatar "ผู้รู้ความจริง" บน Avatar Zone และมีการ์ดบนมือ/Deck',   // โพเดียมสมาคมผู้รู้ความจริง
    cond: (r, i) => r.p[i].av.some(isTruth) && r.p[i].hand.length > 0 && r.p[i].deck.length > 0,
    run: (r, i, x) => { const p = r.p[i];
      ask(r, i, { text: 'โพเดียมฯ: เลือกการ์ดบนมือ 1 ใบ สลับกับใบบนสุดของ Deck', opts: p.hand.map(c => c.u), cancel: true, cb: us => { const h = fromZone(r, i, 'hand', us[0]), t = p.deck.pop(); if (!h || !t) { h && p.hand.push(h); t && p.deck.push(t); return; }
        p.deck.push(h); p.hand.push(t); vfx(x.u, 'aura', '🔄 สลับกับบนสุดของ Deck', '#38bdf8'); log(r, '🔄 โพเดียมสมาคมผู้รู้ความจริง: สลับการ์ดบนมือกับใบบนสุดของ Deck'); } }); } },
});

/* ---------- Magic ---------- */
Object.assign(MG, {
  'BT09-053': { cond: (r, i) => r.p[i].av.some(a => symOf(a) === 'ฤษี'),   // ขอให้ตีนไม่ติดพื้น
    steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ นำกลับขึ้นมือเจ้าของ', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; vfx(t.c.u, 'burst', '🕊 ตีนไม่ติดพื้น', '#38bdf8'); log(r, '🕊 ขอให้ตีนไม่ติดพื้น: ' + nmOf(t.c) + ' กลับขึ้นมือเจ้าของ'); bounce(r, t.c.u); } },
  'BT09-054': { cond: (r, i) => r.p[i].co.length > 0,   // แผนการตู้เย็นทับ
    steps: [{ key: 'k', text: 'เลือก Construct บนสนามเรา 1 ใบ', opts: (r, i) => r.p[i].co.map(c => c.u) },
      { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้ามที่ POWER ≤ POWER ของ Construct ที่เลือก เพื่อทำลาย', opts: (r, i, cx) => { const k = r.p[i].co.find(c => c.u === (cx.pick.k || [])[0]), thr = k ? (B[k.id].p || 0) : Math.max(0, ...r.p[i].co.map(c => B[c.id].p || 0)); return r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1) && P(r, a) <= thr).map(a => a.u); } }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return; vfx(t.c.u, 'burst', '🧊 ตู้เย็นทับ!', '#38bdf8'); log(r, '🧊 แผนการตู้เย็นทับ: ทำลาย ' + nmOf(t.c)); destroyAv(r, t.c.u); } },
  'BT09-056': { cond: (r, i) => [...r.p[i].deck, ...r.p[i].hell].some(c => !c.tk && isAv(c) && nm9(c).includes('เรื่องราว')),   // Skill : Full Drive
    run: (r, i, cx) => { const p = r.p[i], isStory = c => !c.tk && isAv(c) && nm9(c).includes('เรื่องราว');
      const after = () => { if (p.hell.filter(c => !c.tk && B[c.id].t === 'Magic').length >= 8) ask(r, i, { yn: true, text: 'Full Drive: นรกมี Magic ≥ 8 ใบ — จั่วการ์ด 1 ใบไหม?', cb: y => { if (y) { draw(r, p, 1); vfx(cx.card.u, 'aura', 'จั่ว 1', '#38bdf8'); log(r, '✨ Full Drive: จั่ว 1 ใบ'); } } }); };
      const fromDeck = () => { const L = p.deck.filter(isStory).map(c => c.u); if (!L.length) { shuf(p.deck); return after(); }
        ask(r, i, { text: 'Full Drive: เลือก Avatar "เรื่องราว" จาก Deck ขึ้นมือ', opts: L, cb: us => { const k = p.deck.findIndex(c => c.u === us[0]); if (k >= 0) { p.hand.push(p.deck.splice(k, 1)[0]); log(r, '✨ Full Drive: นำ Avatar เรื่องราว จาก Deck ขึ้นมือ'); } shuf(p.deck); after(); } }); };
      const fromHell = () => { const L = p.hell.filter(isStory).map(c => c.u); if (!L.length) return after();
        ask(r, i, { text: 'Full Drive: เลือก Avatar "เรื่องราว" จากนรก ขึ้นมือ', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.hand.push(c); log(r, '✨ Full Drive: นำ Avatar เรื่องราว จากนรกขึ้นมือ'); } after(); } }); };
      const hasD = p.deck.some(isStory), hasH = p.hell.some(isStory);
      if (hasD && hasH) ask(r, i, { text: 'Skill : Full Drive: เลือกปฏิบัติ', choices: ['1) จาก Deck ขึ้นมือ แล้วสับ', '2) จากนรก ขึ้นมือ'], cb: k => k === 0 ? fromDeck() : fromHell() }); else if (hasD) fromDeck(); else fromHell(); } },
  'BT09-058': { cond: (r, i) => r.p[i].deck.length >= 5 && r.p[i].av.some(a => nm9(a).startsWith('ธอร์') || nm9(a).startsWith('โลกิ')),   // Ah-ah, ah!
    run: (r, i, cx) => { const p = r.p[i]; vfx(cx.card.u, 'aura', '⚡ ธรณีสูบ 5', '#facc15'); mill(r, i, 5, cx.card);
      r.g.q.push(() => { const thor = p.av.some(a => nm9(a).startsWith('ธอร์')), loki = p.av.some(a => nm9(a).startsWith('โลกิ')), hh = n => p.hell.filter(c => !c.tk && isAv(c) && nm9(c).startsWith(n)).map(c => c.u);
        const m = []; if (thor && hh('โลกิ').length) m.push(['1) อัญเชิญ "โลกิ" จากนรก', 'โลกิ']); if (loki && hh('ธอร์').length) m.push(['2) อัญเชิญ "ธอร์" จากนรก', 'ธอร์']);
        if (!m.length) return log(r, 'Ah-ah, ah!: ไม่มี ธอร์/โลกิ ที่อัญเชิญได้');
        const go = n => ask(r, i, { text: 'Ah-ah, ah!: เลือก Avatar "' + n + '" จากนรก อัญเชิญลงสนาม', opts: hh(n), cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && sumFx9(r, i, c, 'hell', cx.card, 'อัญเชิญ', '#facc15')) log(r, '⚡ Ah-ah, ah!: อัญเชิญ ' + B[c.id].n + ' จากนรก'); } });
        if (m.length === 1) go(m[0][1]); else ask(r, i, { text: 'Ah-ah, ah!: เลือกปฏิบัติ', choices: m.map(x => x[0]), cb: k => go(m[k][1]) }); }); } },
  'BT09-066': { mod: 1, tgf: x => nmOf(x).includes('เทพธิดาแห่งวัลฮัลลา') },   // หอกศักดิ์สิทธิ์ เอ็ดดา (POWER +1 อยู่ใน P ที่ห่อไว้)
  'BT09-071': {},   // ป่าพงไพร เผ่าพงศ์พันธุ์ (Land — ผลอยู่ใน P / hasKw ที่ห่อไว้)
});

/* ===================================================================
   BT09 — รอบที่ 2 (เฉพาะใบที่ใช้กลไกเดิมได้) : 012 013 014 015* 019 037 052 073
   =================================================================== */
const isHero6 = c => !c.tk && isAv(c) && nm9(c).includes('วีรบุรุษ') && B[c.id].c === 6;

/* ---------- ห่อ deathFx0 : คำสั่งเสีย 037 ---------- */
const _d09 = deathFx0;
deathFx0 = function (r, f, nf) {
  _d09(r, f, nf);
  if (nf || f.c.tk || f.c.id !== 'BT09-037') return;
  const i = f.i, p = r.p[i];
  r.g.q.push(() => {   // มะเหมี่ยว: ถ้า Land = ป่าพงไพร → อัญเชิญ ภูติผลไม้ (ไม่ใช่มะเหมี่ยว) จากมือ แล้วจั่ว 1
    if (!landIs(r, LAND9)) return log(r, 'คำสั่งเสีย มะเหมี่ยว: ไม่มี ป่าพงไพร เผ่าพงศ์พันธุ์ บน Land Magic Zone');
    const L = p.hand.filter(c => isFruit9(c) && !nm9(c).startsWith('ภูติผลไม้ มะเหมี่ยว')).map(c => c.u);
    if (!L.length) return log(r, 'คำสั่งเสีย มะเหมี่ยว: ไม่มี ภูติผลไม้ บนมือ');
    ask(r, i, { text: 'คำสั่งเสีย: เลือก Avatar "ภูติผลไม้" (ไม่ใช่มะเหมี่ยว) จากมือ อัญเชิญลงสนาม', opts: L, cb: us => { const c = p.hand.find(h => h.u === us[0]);
      if (c && sumFx9(r, i, c, 'hand', f.c, 'อัญเชิญ', '#22c55e')) { draw(r, p, 1); vfx(c.u, 'aura', '🍈 จั่ว 1', '#22c55e'); log(r, '🍈 มะเหมี่ยว: อัญเชิญ ' + B[c.id].n + ' จากมือ แล้วจั่ว 1 ใบ'); } } });
  });
};

/* ---------- ห่อ rishiFx : สำนักภฤคุ 073 (เมื่อมีการใช้ Magic {ฤษี} ของใครก็ตาม) ---------- */
const _rishi9 = rishiFx;
rishiFx = function (r) {
  _rishi9(r);
  r.p.forEach(q => q.co.filter(c => c.id === 'BT09-073').forEach(c => r.g.q.push(() => { draw(r, q, 1); vfx(c.u, 'aura', '📖 จั่ว 1', '#38bdf8'); log(r, '📖 สำนักภฤคุ: ' + q.name + ' จั่ว 1 ใบ'); })));
};

/* ---------- โจมตี : หมาป่าเดียวดาย ---------- */
ATK_TRIG.add('BT09-019');
BT4A['BT09-019'] = (r, i, a) => { const n = r.p[i].av.filter(x => x.u !== a.u && isAnimal(x)).length; if (!n) return; addTp(a, n); vfx(a.u, 'aura', '🐺 POWER +' + n, '#f97316'); log(r, '🐺 หมาป่าเดียวดาย: POWER +' + n + ' จนจบเทิร์น'); };

Object.assign(SUM, {
  'BT09-019': (r, i, x) => {   // หมาป่าเดียวดาย: อัญเชิญ {สัตว์} กี่ใบก็ได้ Cost รวมไม่เกิน 5 จาก Deck
    const p = r.p[i]; let left = 5, n = 0;
    const fin = () => { shuf(p.deck); n && log(r, '🐺 หมาป่าเดียวดาย: อัญเชิญ {สัตว์} ' + n + ' ใบ จาก Deck'); };
    const more = () => { const L = p.deck.filter(c => !c.tk && isAv(c) && symOf(c) === 'สัตว์' && B[c.id].c <= left).map(c => c.u); if (!L.length) return fin();
      ask(r, i, { text: 'จุติ: เลือก Avatar {สัตว์} จาก Deck อัญเชิญ (Cost ที่เหลือ ' + left + ') — ยกเลิก = จบ', opts: L, cancel: true, onCancel: fin, none: fin, cb: us => { const c = p.deck.find(d => d.u === us[0]); if (!c) return fin();
        if (!sumFx9(r, i, c, 'deck', x, 'อัญเชิญ', '#f97316')) return fin(); left -= B[c.id].c; n++; r.g.q.push(more); } }); };
    more();
  },
  'BT09-012': (r, i, x) => {   // กุ่ย หน้าตาดี (พอดี) — Gem ไร้สี อยู่ใน bt9Colorless ท้ายไฟล์
    if (!x.jt) return log(r, 'กุ่ย หน้าตาดี: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i];
    scout(r, i, 7, { text: 'จุติ (พอดี): เลือก Avatar "วีรบุรุษ" Cost 6 จากที่สอดแนม ขึ้นมือ', pred: isHero6, rest: 'shuffle', by: x, then: got => { if (got) { p.hand.push(got); vfx(x.u, 'aura', '🦸 วีรบุรุษ → ขึ้นมือ', '#38bdf8'); log(r, '✨ กุ่ย หน้าตาดี: นำ ' + B[got.id].n + ' ขึ้นมือ'); } else log(r, 'กุ่ย หน้าตาดี: ไม่พบ วีรบุรุษ Cost 6 ในที่สอดแนม'); } });
  },
  'BT09-013': (r, i, x) => {   // ฮอล หน้าตาดี (พอดี)
    if (!x.jt) return log(r, 'ฮอล หน้าตาดี: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i], L = p.hell.filter(isHero6).map(c => c.u); if (!L.length) return log(r, 'จุติ ฮอล หน้าตาดี: ไม่มี วีรบุรุษ Cost 6 ในนรก');
    ask(r, i, { text: 'จุติ (พอดี): เลือก Avatar "วีรบุรุษ" Cost 6 จากนรก กลับเข้า Deck', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return; p.deck.push(c); shuf(p.deck); draw(r, p, 1); vfx(x.u, 'aura', '↩ กลับ Deck + จั่ว 1', '#38bdf8'); log(r, '✨ ฮอล หน้าตาดี: นำ ' + B[c.id].n + ' กลับ Deck แล้วสับ จากนั้นจั่ว 1 ใบ'); } });
  },
  'BT09-014': (r, i, x) => {   // นาย หน้าตาดี (พอดี)
    if (!x.jt) return log(r, 'นาย หน้าตาดี: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i], L = p.hell.filter(c => !c.tk && isAv(c) && /^(กุ่ย|ฮอล)(\s|$)/.test(nm9(c))).map(c => c.u); if (!L.length) return log(r, 'จุติ นาย หน้าตาดี: ไม่มี กุ่ย/ฮอล ในนรก');
    ask(r, i, { text: 'จุติ (พอดี): เลือก Avatar "กุ่ย" หรือ "ฮอล" จากนรก อัญเชิญลงสนาม', opts: L, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && sumFx9(r, i, c, 'hell', x, 'อัญเชิญ', '#38bdf8')) log(r, '✨ นาย หน้าตาดี: อัญเชิญ ' + B[c.id].n + ' จากนรก'); } });
  },
});

Object.assign(AB, {
  'BT09-015': { z: 'av', steps: [], can: (r, i, c) => r.p[i].deck.some(d => !d.tk && isAv(d) && nm9(d).includes('ทหารหิมะ') && B[d.id].p === 2),   // เพนกวินหิมะ เหลียง (ชื่อ/Symbol/4 GEM: nmOf, bt9G, ต่างชาติ ท้ายไฟล์)
    run: (r, i, cx) => { const p = r.p[i], x = cx.card, nmSn = c => !c.tk && isAv(c) && nm9(c).includes('ทหารหิมะ'), soldiers = () => p.deck.filter(c => nmSn(c) && B[c.id].p === 2);
      const king = () => p.deck.find(c => !c.tk && isAv(c) && nm9(c).startsWith('ราชาหิมะ')), queen = () => p.deck.find(c => !c.tk && isAv(c) && nm9(c).startsWith('ราชินีหิมะ'));
      if (!sac(r, x.u)) return; vfx(x.u, 'burst', '🐧 เซ่นไหว้', '#38bdf8');
      r.g.q.unshift(() => { const cnt = p.hell.filter(c => nmSn(c) || c.id === 'BT09-015').length, royal = cnt >= 12 && king() && queen();
        const soldierMode = () => { const S = soldiers().slice(0, 2); let k = 0; S.forEach(c => { if (sumFx9(r, i, c, 'deck', x, 'ทหารหิมะ', '#38bdf8')) k++; }); shuf(p.deck); log(r, '🐧 เหลียง: อัญเชิญ ทหารหิมะ ' + k + ' ใบ จาก Deck'); };
        const royalMode = () => { [king(), queen()].forEach(c => c && sumFx9(r, i, c, 'deck', x, 'ราชา/ราชินีหิมะ', '#38bdf8')); shuf(p.deck); log(r, '👑 เหลียง: นรกมี ทหารหิมะ ' + cnt + ' ใบ — อัญเชิญ ราชาหิมะ บิง และ ราชินีหิมะ แทน'); };
        if (royal && soldiers().length >= 1) ask(r, i, { text: 'เพนกวินหิมะ: เลือกปฏิบัติ', choices: ['1) อัญเชิญ ทหารหิมะ (POWER 2) 2 ใบ', '2) อัญเชิญ ราชาหิมะ บิง + ราชินีหิมะ'], cb: k => k === 0 ? soldierMode() : royalMode() });
        else if (royal) royalMode(); else soldierMode(); }); } },
});

Object.assign(MG, {
  'BT09-052': { cond: (r, i) => { const p = r.p[i], has = n => p.av.some(a => nm9(a).startsWith(n)), inDeck = n => p.deck.some(c => !c.tk && isAv(c) && nm9(c).startsWith(n)); return (has('เพมมุ') && inDeck('สไปรท์')) || (has('สไปรท์') && inDeck('เพมมุ')); },   // ผจญภัยด้วยกัน
    run: (r, i, cx) => { const p = r.p[i], has = n => p.av.some(a => nm9(a).startsWith(n)), inDeck = n => p.deck.some(c => !c.tk && isAv(c) && nm9(c).startsWith(n));
      const M = []; if (has('เพมมุ') && inDeck('สไปรท์')) M.push(['1) ถ้ามี "เพมมุ" → อัญเชิญ "สไปรท์" จาก Deck', 'สไปรท์']); if (has('สไปรท์') && inDeck('เพมมุ')) M.push(['2) ถ้ามี "สไปรท์" → อัญเชิญ "เพมมุ" จาก Deck', 'เพมมุ']);
      const go = n => { const c = p.deck.find(d => !d.tk && isAv(d) && nm9(d).startsWith(n)); if (c && sumFx9(r, i, c, 'deck', cx.card, 'ผจญภัยด้วยกัน', '#facc15')) log(r, '🤝 ผจญภัยด้วยกัน: อัญเชิญ ' + B[c.id].n + ' จาก Deck'); shuf(p.deck); };
      if (!M.length) return shuf(p.deck); if (M.length === 1) return go(M[0][1]); ask(r, i, { text: 'ผจญภัยด้วยกัน: เลือกปฏิบัติ', choices: M.map(x => x[0]), cb: k => go(M[k][1]) }); } },
});

/* ===================================================================
   BT09 — รอบที่ 3 (เฉพาะกลไกเดิม) : 051 057* 062 063*
   062 ใช้ react 'bp5' เดิม (หน้าต่างตอบโต้ตอนเข้าสู่ Battle Phase) + flag nf เดิม (สูญเสียความสามารถ)
   063 ใช้ react 'atkAv' + pend.tmp เดิม (แบบเดียวกับ BT02-053)
   =================================================================== */
Object.assign(MG, {
  'BT09-051': { run: (r, i, cx) => {   // ไม้กวาดปีกปักษา: ทำลายการ์ดบน Magic Zone ฝ่ายตรงข้ามทุกใบ (ในเอนจินนี้ การ์ดบน Magic Zone หงายทั้งหมด) แล้วจั่ว 1 ต่อทุกๆ 2 ใบ
    const op = r.p[1 - i], L = op.mg.slice(); if (!L.length) return log(r, '🧹 ไม้กวาดปีกปักษา: ไม่มีการ์ดบน Magic Zone ฝ่ายตรงข้าม');
    vfx(cx.card.u, 'burst', '🧹 กวาด Magic Zone', '#38bdf8'); L.forEach(m => sendHell(r, m.u)); log(r, '🧹 ไม้กวาดปีกปักษา: ทำลาย ' + L.length + ' ใบ');
    const k = Math.floor(L.length / 2); if (k > 0) ask(r, i, { yn: true, text: 'ทำลายไป ' + L.length + ' ใบ — จั่วการ์ด ' + k + ' ใบไหม?', cb: y => { if (y) { draw(r, r.p[i], k); log(r, '✨ ไม้กวาดปีกปักษา: จั่ว ' + k + ' ใบ'); } } }); } },
  'BT09-057': { cond: (r, i) => r.p[1 - i].mg.length > 0 || !!r.g.land,   // ไต้ฝุ่น (ทำเฉพาะการใช้ปกติ — ส่วน "ใช้ในเทิร์นฝ่ายตรงข้าม/Battle Phase ถือเป็น React" ยังไม่ทำ เพราะเป็น Magic Normal ที่ใช้เป็น React ได้ ซึ่งเอนจินยังไม่มี)
    run: (r, i, cx) => { const op = r.p[1 - i], M = op.mg.map(m => m.u);
      const m1 = () => ask(r, i, { text: 'ไต้ฝุ่น: เลือกการ์ดบน Magic Zone ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: M, cb: us => { const m = op.mg.find(x => x.u === us[0]); if (!m) return; vfx(m.u, 'burst', '🌪 ไต้ฝุ่น', '#38bdf8'); log(r, '🌪 ไต้ฝุ่น: ทำลาย ' + B[m.id].n); sendHell(r, m.u); } });
      const m2 = () => { const L = r.g.land; if (!L) return; vfx(cx.card.u, 'burst', '🌪 ทำลาย Land', '#38bdf8'); r.p[L.o].hell.push(L.c); r.g.land = null; log(r, '🌪 ไต้ฝุ่น: ทำลาย Land Magic ' + B[L.c.id].n); };
      if (M.length && r.g.land) ask(r, i, { text: 'ไต้ฝุ่น: เลือกปฏิบัติ', choices: ['1) ทำลายการ์ด 1 ใบ บน Magic Zone ฝ่ายตรงข้าม', '2) ทำลายการ์ด 1 ใบ บน Land Magic Zone'], cb: k => k === 0 ? m1() : m2() });
      else if (M.length) m1(); else m2(); } },
  'BT09-062': { react: 'bp5', run: (r, i, cx) => {   // ตัดเน็ต: Avatar ทุกใบทั้ง 2 ฝ่าย สูญเสียความสามารถ จนจบเทิร์น
    r.g.nofx = [r.g.n, r.g.n]; r.p.forEach(q => q.av.forEach(a => { a.nf = r.g.n; vfx(a.u, 'burst', '📵 ตัดเน็ต', '#64748b'); })); log(r, '📵 ตัดเน็ต: Avatar ทุกใบบนสนามทั้ง 2 ฝ่าย สูญเสียความสามารถจนจบเทิร์น'); } },
  'BT09-063': { react: 'atkAv', cond: (r, i) => { const p = r.g.pend, t = p && r.p[i].av.find(a => a.u === p.tg); return !!t && symOf(t) === 'ยักษ์'; },   // ลงกาโพรเทคชั่น (ทำเฉพาะตอนที่ยักษ์ฝ่ายเราถูกโจมตี)
    steps: [{ key: 't', text: 'เลือก Avatar {ยักษ์} ที่ไม่ได้ต่อสู้และอยู่ในสภาพตื่น เปลี่ยนเป็นสภาพนอน แล้วนำ POWER ไปเพิ่มให้ยักษ์ที่ต่อสู้', opts: (r, i, cx) => r.p[i].av.filter(a => a.u !== (cx.pend && cx.pend.tg) && !a.tired && symOf(a) === 'ยักษ์').map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]), tg = find(r, cx.pend.tg); if (!t || !tg) return; const v = P(r, t.c); t.c.tired = true; addTp(tg.c, v); (cx.pend.tmp = cx.pend.tmp || []).push({ u: tg.c.u, v });
      vfx(t.c.u, 'aura', '😴 นอน', '#94a3b8'); vfx(tg.c.u, 'aura', '🗿 POWER +' + v, '#ef4444'); log(r, '🗿 ลงกาโพรเทคชั่น: ' + nmOf(t.c) + ' นอน — ' + nmOf(tg.c) + ' POWER +' + v + ' จนจบการต่อสู้'); } },
});

/* ===================================================================
   BT09 — รอบสมบูรณ์ (ใบที่เหลือทั้งหมด)
   จุดเชื่อมใหม่ที่ใช้: ห่อ sweep / noteSum / bt8Win / bt6Bs / bt7End / bt6End / bt6After / castFinal
   และแก้โค้ดเดิมเล็กน้อย (มีคอมเมนต์ "BT09" กำกับ): canPlaceAv, costNow, protectedFrom, การตรวจโจมตี (kdUntarget/noatk),
   isAnimal, isCol, wearBlock7, lifeFx (004), sendHell (บันทึกการทิ้งมือ), kill (060)
   =================================================================== */
const nz9 = s => (s || '').replace(/[\s\u0E34\u0E35]/g, '');                         // ตัดช่องว่าง และ สระ ิ ี (โพลิกอน = โพลีกอน)
const hasN9 = (c, n) => !!c && nz9(nmOf(c)).includes(nz9(n));
const partner9 = c => { if (typeof PART10 !== 'undefined' && PART10[c.id]) return PART10[c.id]; const m = /\[(?:Link|link|คู่หู -)\s*([^\]]+?)\s*\]/.exec((B[c.id] || {}).e || ''); return m ? m[1] : null; };
const linked9 = (r, x) => { if (!x || x.tk || !isAv(x)) return false; const f = find(r, x.u); if (!f || f.z !== 'av' || noFx(r, x)) return false; const n = partner9(x); return !!n && r.p[f.i].av.some(y => y.u !== x.u && !y.tk && hasN9(y, n)); };
const isMagic9 = c => !c.tk && B[c.id].t === 'Magic';
const isSkill9 = c => isMagic9(c) && B[c.id].n.startsWith('Skill');
const isPoly9 = c => !c.tk && isAv(c) && hasN9(c, 'โพลีกอน');
const wiz9 = a => !a.tk && isAv(a) && (nmOf(a).includes('จอมเวท') || a.id === 'BT09-031');   // 031 นับเป็นชื่อ "จอมเวทย์"
const hand9 = (r, i, id) => r.p[i].hand.find(h => h.id === id);
const offer9 = (r, i, text, cb) => r.g.q.push(() => ask(r, i, { yn: true, text, cb: y => { if (y) cb(); } }));
const sumH9 = (r, i, c, from, txt, col) => { c.ok9 = 1; const ok = summonAny(r, i, c.u, from, c); delete c.ok9; if (!ok) return false; vfx(c.u, 'burst', txt || 'อัญเชิญ', col || '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); return true; };
const hellN9 = (r, i) => r.p[i].hell.length;

/* ---------- ข้อจำกัด / ค่าที่ถูกเรียกจากโค้ดเดิม ---------- */
const bt9NoPlace = (r, i, c) => {   // canPlaceAv
  if (c.id === 'BT09-032' && !c.ok9) return true;                                                           // วินดิโก้ อัญเชิญได้เฉพาะด้วยความสามารถของตัวเอง
  if (c.id !== 'BT09-035' && r.p[i].av.some(a => a.id === 'BT09-035' && !noFx(r, a))) return true;          // เนฟิล: ควบคุม Avatar ใบอื่นไม่ได้
  if (r.g.al18 && r.g.al18[i] && !c.tk && !(symOf(c) === 'เอเลี่ยน' && colOf(c) === 'ฟ้า')) return true;     // ตัวอะไรสักอย่าง: อัญเชิญได้แค่ {เอเลี่ยน} สีฟ้า
  if (landIs(r, 'BT09-069') && r.g.sc9 && r.g.sc9.n === r.g.n && r.g.sc9.c[i] >= 2) return true;             // ด่านตรวจเข้าเมือง: อัญเชิญได้ 2 ครั้งต่อเทิร์น
  return false;
};
const bt9CostD = (r, x, f, c) => {   // costNow
  let d = 0;
  if (f && f.z === 'av') d -= r.p[1 - f.i].co.filter(k => k.id === 'BT09-075').length;                       // ห้างโรงเกลือ: Avatar ฝ่ายตรงข้าม Cost -1
  if (f && f.z === 'hand' && x.id === 'BT09-018' && c > 2) d += Math.max(2, c - 2) - c;                     // ตัวอะไรสักอย่าง: ลด 2 แต่ไม่ต่ำกว่า 2
  return d;
};
const bt9Prot = (r, who, x, mg) => {   // protectedFrom: เลือกเป็นเป้าความสามารถไม่ได้
  if (who === undefined || x.tk || x.id !== 'BT09-011') return false; const f = find(r, x.u); if (!f || f.i === who) return false;
  return r.p[f.i].av.some(a => a.id === 'BT09-010' && linked9(r, a));                                        // เมย์ ที่ Link เจ้าหญิงรวงข้าว
};
const bt9AtkBlock = (r, atk, tgt) => {   // เป้าหมายการโจมตีที่เลือกไม่ได้
  if (bt10AtkBlock(r, atk, tgt) || cc2AtkBlock(r, atk, tgt)) return true;
  const f = find(r, tgt.u); if (!f || f.z !== 'av' || tgt.tk) return false; const me = r.p[f.i];
  if (tgt.id === 'BT09-029' && !noFx(r, tgt) && isCol(atk, 'เขียว')) return true;
  if (tgt.id === 'BT09-028' && !noFx(r, tgt) && isCol(atk, 'แดง')) return true;
  if (tgt.id === 'BT09-011' && me.av.some(a => a.id === 'BT09-010' && linked9(r, a))) return true;
  if (tgt.id !== 'BT09-007' && me.av.some(a => a.id === 'BT09-007' && !noFx(r, a) && linked9(r, a))) return true;             // โฮคุ (เฉพาะตอน Link): เลือกโจมตี Avatar ใบอื่นของเราไม่ได้ ยกเว้นโฮคุ
  return false;
};
const bt9NoAtk = (r, a) => (a.id === 'BT09-025' && !noFx(r, a)) || hasEq(r, a, 'BT09-065');                  // โลกิ / กระสอบ

/* ---------- ห่อ P : POWER ต่อเนื่อง ---------- */
const _P94 = P;
P = function (r, x) {
  let v = _P94(r, x); if (x.tk) return v;
  const f = find(r, x.u); if (!f || f.z !== 'av') return v; const me = r.p[f.i];
  if (!noFx(r, x)) {
    if (x.id === 'BT09-007' && me.av.some(a => a.u !== x.u && isPoly9(a))) v += 1;
    if (x.id === 'BT09-008' && r.p.some(q => q.mg.some(m => m.at === x.u))) v += 2;
    if (x.id === 'BT09-010' && linked9(r, x)) v += 3;                                                          // POWER ตั้งต้น 5
    if (x.id === 'BT09-031') { if (me.av.some(a => a.u !== x.u && isPoly9(a))) v += 2; else if (me.av.some(a => a.u !== x.u && wiz9(a))) v += 1; }
    if (x.id === 'BT09-043' && x.sk9) v += Math.floor(me.hell.filter(isMagic9).length / 2);
  }
  if (r.g.turn === f.i && ['เพมมุ', 'สไปรท์', 'เมย์ แวมไพร์โกธิค'].some(n => hasN9(x, n)) && linked9(r, x) && me.av.some(a => a.id === 'BT09-011' && !noFx(r, a))) v += 2;   // เจ้าหญิงรวงข้าว
  if (r.g.phase === 'battle' && symOf(x) === 'ยักษ์' && me.av.some(a => a.id === 'BT09-041' && !noFx(r, a))) v += 2;                                               // ท้าวเวสสุวรรณ
  if (x.id === 'BT09-020') v += (x.k20 || 0) * 3;
  return Math.max(0, v);
};

/* ---------- จุดเชื่อมเหตุการณ์ ---------- */
const _noteSum9 = noteSum;
noteSum = function (r, i, c) {
  _noteSum9(r, i, c); const g = r.g; if (!g.sc9 || g.sc9.n !== g.n) g.sc9 = { n: g.n, c: [0, 0] }; g.sc9.c[i]++;
  if (g.sc9.c[i] === 3 && !c.tk) { const o = 1 - i, k = hand9(r, o, 'BT09-032'); if (k && g.turn === i) offer9(r, o, 'วินดิโก้: ' + r.p[i].name + ' อัญเชิญ Avatar ใบที่ 3 ในเทิร์นนี้ — อัญเชิญ วินดิโก้ จากมือไหม?', () => { if (r.p[o].hand.includes(k) && sumH9(r, o, k, 'hand', '👻 วินดิโก้', '#7c3aed')) log(r, '👻 วินดิโก้: อัญเชิญจากมือ'); }); }
};

const lk9 = (r, i, x) => {   // เมื่อเข้าสู่สถานะ Link / {คู่หู}
  bt10Link(r, i, x);
  if (x.id === 'BT09-007') { const O = r.p[1 - i].av; if (!O.length) return; const mx = Math.max(...O.map(a => P(r, a))), T = O.filter(a => P(r, a) === mx && !protectedFrom(r, i, a)).map(a => a.u);
    r.g.q.push(() => { const go = u => { const t = find(r, u); if (t && t.z === 'av') { vfx(t.c.u, 'burst', '💥 โฮคุ', '#ef4444'); log(r, '💥 โฮคุ โพลีกอน (คู่หู): ทำลาย ' + nmOf(t.c) + ' (POWER สูงสุด)'); destroyAv(r, t.c.u); } }; if (T.length === 1) go(T[0]); else if (T.length) ask(r, i, { text: 'โฮคุ: เลือก Avatar POWER สูงสุด 1 ใบ ที่จะทำลาย', opts: T, cb: us => go(us[0]) }); }); }
  if (['BT09-024', 'BT09-025'].includes(x.id) || hasN9(x, 'ธอร์') || hasN9(x, 'โลกิ')) { const h = r.p[i].hell.find(c => c.id === 'BT09-064'); if (h && Math.floor(hellN9(r, i) / 10) >= 1 && (hasN9(x, 'ธอร์') || hasN9(x, 'โลกิ')))
    offer9(r, i, 'ค้อนโยเนียร์: ' + nmOf(x) + ' เข้าสู่สถานะ Link — นำการ์ดนี้จากนรกกลับใต้ Deck เพื่อทำลาย Avatar ฝ่ายตรงข้ามไหม?', () => { const k = r.p[i].hell.indexOf(h); if (k < 0 || r.g.h64 === r.g.n) return; r.g.h64 = r.g.n; r.p[i].hell.splice(k, 1); r.p[i].deck.unshift(h); vfx(h.u, 'aura', '🔨 ค้อนโยเนียร์', '#facc15'); thor9(r, i, 'ค้อนโยเนียร์', () => { }); }); }
};
const thor9 = (r, i, src, none) => {   // ทำลาย Avatar Cost ≤ 3+n ฝ่ายตรงข้าม n ใบ (n = ใบในนรกเรา ÷ 10)
  const n = Math.floor(hellN9(r, i) / 10), cap = 3 + n, T = () => r.p[1 - i].av.filter(a => costNow(r, a) <= cap && !protectedFrom(r, i, a)).map(a => a.u);
  if (n < 1 || !T().length) return none(false);
  ask(r, i, { text: src + ': เลือก Avatar Cost ≤ ' + cap + ' ฝ่ายตรงข้าม สูงสุด ' + n + ' ใบ ทำลาย', opts: T(), n, min: 1, cancel: true, onCancel: () => none(false), cb: us => { us.forEach(u => { const t = find(r, u); t && t.z === 'av' && (vfx(u, 'burst', '💥 ' + src, '#facc15'), destroyAv(r, u)); }); log(r, '💥 ' + src + ': ทำลาย Avatar ' + us.length + ' ใบ'); none(true); } });
};

const leave9 = (r, c, i, dz, di) => {   // Avatar ออกจากสนาม (c: การ์ด, i: เจ้าของเดิม, dz/di: ปลายทาง)
  const me = r.p[i];
  if (c.id === 'BT09-042' && dz === 'dk' && !c.drawn9) r.g.q.push(() => { draw(r, me, 1); vfx(c.u, 'aura', '📖 จั่ว 1', '#22c55e'); log(r, '📖 นักท่องเรื่องราว: ถูกเนรเทศ — จั่ว 1 ใบ'); });
  const k01 = hand9(r, i, 'BT09-001');
  if (k01 && dz === 'hell' && di === i && hasN9(c, 'พระอิศวร') && canPlaceAv(r, i, k01)) offer9(r, i, 'พระอิศวร วีลแชร์: ' + nmOf(c) + ' ถูกทำลายลงนรก — อัญเชิญ พระอิศวร วีลแชร์ จากมือไหม?', () => {
    if (!me.hand.includes(k01) || !sumH9(r, i, k01, 'hand', '🛕 วีลแชร์', '#ef4444')) return; const S = me.hell.filter(h => !h.tk && isAv(h) && hasN9(h, 'พระอิศวร')).map(h => h.u);
    r.g.q.push(() => ask(r, i, { text: 'เลือก Avatar "พระอิศวร" ในนรก — POWER ตั้งต้นของวีลแชร์ = ครึ่งหนึ่ง (ปัดลง)', opts: S, cb: us => { const s = me.hell.find(h => h.u === us[0]); if (!s) return; const v = Math.floor((B[s.id].p || 0) / 2); k01.pw = v - (B[k01.id].p || 0);
      const T = r.p[1 - i].av.filter(a => !protectedFrom(r, i, a)).map(a => a.u); ask(r, i, { text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ลด POWER ' + v, opts: T, cb: u2 => { const t = find(r, u2[0]); if (t) { addPw(t.c, -v); vfx(t.c.u, 'aura', 'POWER -' + v, '#ef4444'); log(r, '🛕 พระอิศวร วีลแชร์: POWER ตั้งต้น ' + v + ' — ' + nmOf(t.c) + ' POWER -' + v); } } }); } })); });
  const k41 = hand9(r, i, 'BT09-041');
  if (k41 && dz === 'hell' && di === i && symOf(c) === 'ยักษ์' && r.g.turn !== i && canPlaceAv(r, i, k41)) offer9(r, i, 'ท้าวเวสสุวรรณ: ' + nmOf(c) + ' ถูกทำลายโดยฝ่ายตรงข้าม — อัญเชิญ ท้าวเวสสุวรรณ จากมือไหม?', () => {
    if (!me.hand.includes(k41) || !sumH9(r, i, k41, 'hand', '🗿 เวสสุวรรณ', '#22c55e')) return; r.g.q.push(() => { const T = r.p[1 - i].av.filter(a => !protectedFrom(r, i, a)).map(a => a.u); T.length && ask(r, i, { text: 'ท้าวเวสสุวรรณ: ทำลาย Avatar ฝ่ายตรงข้าม 1 ใบ (ยกเลิก = ไม่ทำลาย)', opts: T, cancel: true, cb: us => destroyAv(r, us[0]) }); }); });
  const k16 = hand9(r, i, 'BT09-016');
  if (k16 && (symOf(c) === 'รัททาทุย' || nmOf(c).includes('นินจา')) && c !== k16 && canPlaceAv(r, i, k16)) offer9(r, i, 'รัททาทุย นินจา: Avatar ' + nmOf(c) + ' ออกจากสนาม — อัญเชิญ รัททาทุย นินจา จากมือโดยทิ้งการ์ดให้ GEM รวม 3 ไหม?', () => {
    let left = 3; const used = [], step = () => { const O = me.hand.filter(h => h !== k16 && !used.includes(h) && (B[h.id].g || 0) > 0 && B[h.id].g <= left).map(h => h.u); if (!O.length) return log(r, 'รัททาทุย นินจา: เลือกการ์ดทิ้งให้ GEM รวม 3 ไม่ได้ — ยกเลิก');
      ask(r, i, { text: 'เลือกการ์ดบนมือที่จะทิ้ง (GEM ที่เหลือต้องครบ ' + left + ')', opts: O, cancel: true, cb: us => { const h = me.hand.find(q => q.u === us[0]); used.push(h); left -= B[h.id].g; if (left > 0) return step(); used.forEach(q => sendHell(r, q.u)); if (me.hand.includes(k16) && sumH9(r, i, k16, 'hand', '🥷 นินจา', '#64748b')) log(r, '🥷 รัททาทุย นินจา: ทิ้งการ์ด ' + used.length + ' ใบ แล้วอัญเชิญ'); } }); }; step(); });
};

/* ---------- ห่อ sweep : ตรวจ Link / ออกจากสนาม / 033 / 035 ---------- */
const _sw94 = sweep;
sweep = function (r) {
  _sw94(r); const g = r.g; if (!g || g.over || g.in9) return; g.in9 = 1;
  try {
    const snap = g.s9 || (g.s9 = r.p.map(p => p.av.slice())), ev = [];
    r.p.forEach((p, i) => { snap[i].forEach(c => { if (!p.av.includes(c) && !c.tk) { const f = find(r, c.u); ev.push([c, i, f ? f.z : null, f ? f.i : null]); } }); snap[i] = p.av.slice(); });
    ev.forEach(([c, i, z, di]) => leave9(r, c, i, z, di));
    r.p.forEach((p, i) => p.av.forEach(x => { const l = linked9(r, x); if (l && !x.lk9) { x.lk9 = 1; lk9(r, i, x); } else if (!l) x.lk9 = 0;
      if (isFruit9(x) && landIs(r, LAND9) && !x.gain8) x.gain8 = 'BT09-071F'; else if (x.gain8 === 'BT09-071F' && !(isFruit9(x) && landIs(r, LAND9))) delete x.gain8;
      if (x.cp9 && x.cp9 !== g.n) { delete x.nmo; delete x.sy; x.cx = (x.cx || 0) - (x.cc9 || 0); x.cc9 = 0; x.cp9 = 0; }                          // สกินวอคเกอร์: คืนค่า
      if (x.id === 'BT09-035' && !noFx(r, x) && P(r, x) <= 0 && !x.dead9) { x.dead9 = 1; r.g.q.push(() => { log(r, '🗿 เนฟิล: POWER เหลือ 0 — ถูกทำลาย'); destroyAv(r, x.u); }); } }));
    if (g.q.length && !g.ask && !g.pend) { runQ(r); }
  } finally { g.in9 = 0; }
};

/* ---------- ห่อ bt8Win : ผลชนะการต่อสู้ ---------- */
const _w94 = bt8Win;
bt8Win = function (r, p, a, d, res) {
  _w94(r, p, a, d, res); if (res !== 'win' && res !== 'lose') return;
  const wi = res === 'win' ? p.ai : 1 - p.ai, w = res === 'win' ? a : d, lo = res === 'win' ? d : a, isAtk = res === 'win';
  if (!w || w.tk || !find(r, w.u) || noFx(r, w)) return; const me = r.p[wi], op = r.p[1 - wi];
  if (w.id === 'BT09-024' && linked9(r, w)) r.g.q.push(() => thor9(r, wi, 'ธอร์', ok => { if (!ok) { lifeUp(r, 1 - wi); vfx(w.u, 'aura', '❤ หงาย LIFE ศัตรู', '#facc15'); log(r, '⚡ ธอร์: ไม่ได้ทำลาย Avatar — หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); } }));
  if (w.k61 === r.g.n) { w.k61 = 0; lifeUp(r, 1 - wi); vfx(w.u, 'aura', '❤ หงาย LIFE ศัตรู', '#f59e0b'); log(r, '🏚 ทะลุบ้านทะลุโกศ: หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); }
  if (isAtk && hasEq(r, w, 'BT09-067') && lo && P(r, lo) <= P(r, w) - 2) { lifeUp(r, 1 - wi); vfx(w.u, 'aura', '🔫 หงาย LIFE', '#38bdf8'); log(r, '🔫 อาวุธของเพมมุ: เป้าหมาย POWER น้อยกว่า ≥2 — หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); }
  if (hasEq(r, w, 'BT09-068') && op.hell.length) r.g.q.push(() => ask(r, wi, { text: 'กระบองตำรวจ: เลือกการ์ดในนรกฝ่ายตรงข้าม 1 ใบ วางบนสุดของ Deck เขา', opts: op.hell.map(c => c.u), cb: us => { const k = op.hell.findIndex(c => c.u === us[0]); if (k >= 0) { const c = op.hell.splice(k, 1)[0]; op.deck.push(c); vfx(w.u, 'aura', '🚔 วางบน Deck', '#38bdf8'); log(r, '🚔 กระบองตำรวจ: วาง ' + B[c.id].n + ' บนสุดของ Deck ' + op.name); } } }));
  if (hasN9(w, 'ริกกี้')) me.co.filter(k => k.id === 'BT09-074' && k.ou !== r.g.n).forEach(k => { const h = me.hell.find(c => !c.tk && B[c.id].n.trim() === 'หนังมนุษย์ ชุดแก้แค้น'); if (!h) return; k.ou = r.g.n; me.hell.splice(me.hell.indexOf(h), 1); me.deck.push(h); shuf(me.deck); vfx(k.u, 'aura', '🧥 กลับ Deck', '#a855f7'); log(r, '🧥 ตู้เสื้อผ้าของริกกี้: นำ หนังมนุษย์ ชุดแก้แค้น จากนรกกลับเข้า Deck แล้วสับ'); });
  if (isAtk && w.g5 === r.g.n && me.deck.length) { const N = me.deck.filter(c => !c.tk && isAv(c) && nmOf(c).includes('นาค') && B[c.id].c === 3 && (symOf(c) === 'สัตว์มหัศจรรย์' || also9(c, 'สัตว์มหัศจรรย์'))).map(c => c.u);
    N.length && r.g.q.push(() => ask(r, wi, { text: 'กัณหา: เลือก Avatar "นาค" Cost 3 {สัตว์มหัศจรรย์} จาก Deck อัญเชิญ (ใช้ความสามารถอัตโนมัติทันที)', opts: N, cb: us => { const c = me.deck.find(q => q.u === us[0]); if (c && sumH9(r, wi, c, 'deck', '🐍 นาค', '#a855f7')) { shuf(me.deck); log(r, '🐍 กัณหา: อัญเชิญ ' + B[c.id].n + ' จาก Deck'); } } })); }
};

const _bs94 = bt6Bs;
bt6Bs = function (r) {   // เริ่ม Battle Phase: กัณหา POWER ≥ 7
  _bs94(r); const g = r.g; r.p[g.turn].av.forEach(a => { if (a.id === 'BT09-005' && !noFx(r, a) && P(r, a) >= 7) { a.g5 = g.n; vfx(a.u, 'aura', '🐍 ได้รับความสามารถ', '#a855f7'); log(r, '🐍 กัณหา: POWER ≥ 7 — ได้รับความสามารถอัญเชิญ นาค เมื่อโจมตีสำเร็จ'); } });
};
const _e94 = bt7End;
bt7End = function (r, i) {   // เข้า End Phase ของเรา
  _e94(r, i); r.p[i].av.forEach(a => { if (a.id === 'BT09-009' && !noFx(r, a) && linked9(r, a)) { if (a.tired) { a.tired = false; vfx(a.u, 'aura', '☀ ตื่น', '#38bdf8'); } (a.hd = a.hd || []).push({ v: 2, until: r.g.n + 1 }); vfx(a.u, 'aura', 'POWER +2', '#38bdf8'); log(r, '🐶 สไปรท์: End Phase — เปลี่ยนเป็นสภาพตื่น และ POWER +2 จนถึง Draw Phase ถัดไป'); } });
};
const _be94 = bt6End;
bt6End = function (r, prev) {   // นับ End Phase สำหรับ กระสอบ / สวนกล้วยหนีภาษี
  _be94(r, prev);
  r.p.forEach(q => q.mg.slice().forEach(m => { if (m.id === 'BT09-065') { m.e9 = (m.e9 || 0) + 1; if (m.e9 >= 4) { q.mg.splice(q.mg.indexOf(m), 1); delete m.at; delete m.e9; q.hell.push(m); log(r, '👜 กระสอบ: End Phase ที่ 4 — ส่งลงนรก'); } } }));
  const L = r.g.land; if (L && L.c.id === 'BT09-070') { L.e9 = (L.e9 || 0) + 1; if (L.e9 >= 4) { r.p[L.o].hell.push(L.c); r.g.land = null; log(r, '🍌 สวนกล้วยหนีภาษี: End Phase ที่ 4 — ส่งลงนรก'); } }
};
const _ba94 = bt6After;
bt6After = function (r, a) {   // จบการต่อสู้: เนฟิล นำ POWER ของคู่ต่อสู้มาลด POWER ตัวเอง
  _ba94(r, a); const g = r.g, cd = g.curDef;
  [[a, cd], [cd, a]].forEach(([n, o]) => { if (n && o && n.id === 'BT09-035' && !noFx(r, n) && find(r, n.u) && !n.tk) { const v = P(r, o); if (v > 0) { addPw(n, -v); vfx(n.u, 'aura', 'POWER -' + v, '#64748b'); log(r, '🗿 เนฟิล: จบการต่อสู้ — POWER -' + v); } } });
};
const _cf94 = castFinal;
castFinal = function (r, i, card, c, def, ctx, steps) {   // 044: ใช้ {react} "Skill" ชื่อไม่ซ้ำ เพิ่มได้อีก 1 ใบ
  const sk = c.st === 'React' && c.n.startsWith('Skill'), pre = sk && r.p[i].av.some(a => a.id === 'BT09-044' && a.sk9 && !noFx(r, a)), g = r.g;
  _cf94(r, i, card, c, def, ctx, steps);
  if (!sk) return; const t = g.t44 && g.t44.n === g.n ? g.t44 : (g.t44 = { n: g.n, names: [[], []], ex: [false, false] });
  if (pre && !t.names[i].includes(c.n) && !t.ex[i]) { t.ex[i] = true; g.used[i].React = 0; log(r, '📘 ขวัญตา ครุฑเจ้าเวหา: ใช้ {react} Skill เพิ่มได้อีก 1 ใบ'); } t.names[i].push(c.n);
};

/* ---------- 004 DJ ปีโป้ : พูด "ขอโทษ" / ยกโทษ ---------- */
const bt9Forgive = (r, i, id) => {   // lifeFx ถูกเรียกเมื่อ LIFE ของ i ถูกหงายจากการโจมตี — ถ้า Avatar ผู้โจมตีฝั่งตรงข้ามมี DJ ปีโป้
  const g = r.g, a = g.curAtk, w = 1 - i; if (g.fg9run === id + '|' + g.n + '|' + i || !a || !g.inB) return false;
  const dj = r.p[w].av.find(x => x.id === 'BT09-004' && !noFx(r, x)); if (!dj || !r.p[w].av.includes(a)) return false;
  const go = () => { g.fg9run = id + '|' + g.n + '|' + i; lifeFx(r, i, id); };
  fx({ k: 'say', id: dj.id, t: 'ขอโทษ' }); log(r, '🙇 DJ ปีโป้: ' + r.p[w].name + ' พูดว่า "ขอโทษ"');
  if (g.fg9 === g.n) { log(r, '🙏 ขอโทษสังคม: ' + r.p[i].name + ' ยกโทษให้เสมอ — ความสามารถของ LIFE Card ไม่ทำงาน'); return true; }
  ask(r, i, { yn: true, text: 'DJ ปีโป้ พูดว่า "ขอโทษ" — ยกโทษให้ไหม? (ยกโทษ = ความสามารถของ LIFE Card ' + B[id].n + ' ไม่ทำงาน)', cb: y => { if (y) { log(r, '🙏 ' + r.p[i].name + ' ยกโทษให้ — ความสามารถของ LIFE Card ไม่ทำงาน'); r.g.q.length && runQ(r); } else go(); } });
  return true;
};

/* ===================================================================
   BT09 — รอบสมบูรณ์ (2): ลงทะเบียนสกิลของใบที่เหลือ
   =================================================================== */
const SERV9 = SERV, isGhost9 = c => !c.tk && isAv(c) && nmOf(c).includes('วิญญาณร้าย');
const bt9Save = (r, i, u, f0) => {   // 060 Skill : Second Energy — Avatar "เรื่องราว" จะออกจากสนามโดยการ์ดฝ่ายตรงข้าม
  const me = r.p[f0.i], k = hand9(r, f0.i, 'BT09-060'); if (!k || r.g.turn === f0.i || f0.c.tk || !nmOf(f0.c).includes('เรื่องราว') || r.g.used[f0.i].React) return false;
  const G = me.hand.filter(h => h !== k && (B[h.id].g || 0) >= 1).map(h => h.u); if (!G.length) return false;
  ask(r, f0.i, { yn: true, text: 'Skill : Second Energy: ' + nmOf(f0.c) + ' จะออกจากสนาม — ทิ้งการ์ดบนมือ 1 ใบ (GEM ≥ 1) เป็น Cost เพื่อไม่ให้ออกจากสนามไหม?', cb: y => { if (!y) return kill(r, i, u, 1);
    ask(r, f0.i, { text: 'เลือกการ์ดบนมือที่จะทิ้งเป็น Cost', opts: G, cancel: true, onCancel: () => kill(r, i, u, 1), cb: us => { sendHell(r, us[0]); sendHell(r, k.u); r.g.used[f0.i].React = 1; vfx(f0.c.u, 'aura', '⚡ ไม่ออกจากสนาม', '#38bdf8'); log(r, '⚡ Second Energy: ' + nmOf(f0.c) + ' ไม่ออกจากสนาม');
      if (me.hell.filter(isMagic9).length >= 8) { const op = r.p[1 - f0.i]; r.g.q.push(() => ask(r, 1 - f0.i, { text: 'Second Energy: เลือกการ์ดในนรกของตนเอง 1 ใบ เนรเทศ', opts: op.hell.map(c => c.u), cb: u2 => { const c = fromZone(r, 1 - f0.i, 'hell', u2[0]); if (c) { op.dk.push(c); log(r, '🌀 ' + op.name + ' เนรเทศ ' + B[c.id].n + ' จากนรก'); } } })); } } }); } });
  return true;
};
const runMg9 = (r, i, card, def, done) => {   // ใช้ความสามารถของ Magic โดยไม่ต้องร่าย (031)
  const ctx = { pick: {}, card, pend: null, ev: null }, steps = def.steps || [];
  for (const s of steps) if (s.opts(r, i, ctx).length < (s.min == null ? (s.n || 1) : s.min)) return done(false);
  let k = 0; const next = () => { if (k >= steps.length) { HAND_SRC = card; def.run && def.run(r, i, ctx); return done(true); }
    const s = steps[k++], used = Object.values(ctx.pick).flat(); ask(r, i, { text: s.text, opts: s.opts(r, i, ctx).filter(u => !used.includes(u)), n: s.n || 1, min: s.min, cancel: true, onCancel: () => done(false), cb: us => { ctx.pick[s.key] = us; next(); }, none: next }); };
  next();
};
const isPeopleFruit = c => isFruit9(c);

/* ---------- ห่อ fxAtk : 010 เมย์ แวมไพร์โกธิค (สั่งใช้จากมือ เมื่อ เพมมุ/สไปรท์ ต่อสู้) ---------- */
const _fa94 = fxAtk;
fxAtk = function (r, i, a, tg, tk) {
  _fa94(r, i, a, tg, tk);
  const isPS = x => !!x && !x.tk && (hasN9(x, 'เพมมุ') || hasN9(x, 'สไปรท์')), offerFor = (w, fighter) => { const me = r.p[w], k = hand9(r, w, 'BT09-010'); if (!k || !isPS(fighter) || me.dk.some(c => !c.tk && B[c.id].n.startsWith('เมย์ แวมไพร์โกธิค'))) return null; return () => ask(r, w, { yn: true, text: 'เมย์ แวมไพร์โกธิค: ' + nmOf(fighter) + ' ต่อสู้ — เนรเทศ เมย์ จากมือ เพื่อให้ Avatar ที่ต่อสู้ POWER +4 จนจบเทิร์นไหม?', cb: y => { if (!y || !me.hand.includes(k)) return; me.hand.splice(me.hand.indexOf(k), 1); me.dk.push(k); addTp(fighter, 4); vfx(fighter.u, 'aura', '🧛 POWER +4', '#ef4444'); log(r, '🧛 เมย์ แวมไพร์โกธิค: ' + nmOf(fighter) + ' POWER +4 จนจบเทิร์น'); } }); };
  const d = tk === 'av' ? r.p[1 - i].av.find(x => x.u === tg) : null, o1 = offerFor(i, a), o2 = d ? offerFor(1 - i, d) : null;
  if (o1) r.g.q.unshift(() => { o1(); o2 && r.g.q.unshift(o2); }); else if (o2) r.g.q.unshift(o2);
};

/* ---------- ห่อ deathFx0 : 071 (คำสั่งเสียที่ได้รับ) / 035 ---------- */
const _d94 = deathFx0;
deathFx0 = function (r, f, nf) {
  _d94(r, f, nf);
  if (!nf && !f.c.tk && f.c.k71) { const p = r.p[f.i], k = p.hell.indexOf(f.c); if (k >= 0) { p.hell.splice(k, 1); p.dk.push(f.c); log(r, '🍈 ป่าพงไพร: ' + nmOf(f.c) + ' เนรเทศตัวเอง (คำสั่งเสีย)'); } delete f.c.k71; }
  if (!nf && !f.c.tk && f.c.id === 'BT09-035') { lifeUp(r, f.i); vfx(f.c.u, 'aura', '❤ หงาย LIFE เรา', '#64748b'); log(r, '🗿 เนฟิล (คำสั่งเสีย): หงาย LIFE Card ของฝ่ายเรา 1 ใบ'); }
};
const _hk94 = hasKw;
hasKw = function (r, x, kw) { if (kw === 'สามัคคี' && !x.tk && isFruit9(x) && landIs(r, LAND9) && onAv9(r, x) && !noFx(r, x)) return true; return _hk94(r, x, kw); };   // 071: ภูติผลไม้ ได้รับสามัคคี

/* ---------- จุติ / อัตโนมัติเมื่ออัญเชิญ ---------- */
Object.assign(SUM, {
  'BT09-018': (r, i, x) => { (r.g.al18 = r.g.al18 || [false, false])[i] = true; log(r, '👽 ตัวอะไรสักอย่าง: ในเกมนี้ ' + r.p[i].name + ' อัญเชิญได้แค่ Avatar {เอเลี่ยน} สีฟ้า'); },
  'BT09-035': (r, i, x) => { const O = r.p[i].av.filter(a => a !== x); if (!O.length) return; vfx(x.u, 'burst', '🗿 เนฟิล', '#64748b'); O.forEach(a => sendHell(r, a.u)); log(r, '🗿 เนฟิล: ส่ง Avatar ใบอื่นของเราลงนรกทั้งหมด'); },
  'BT09-032': (r, i, x) => { const op = r.p[1 - i]; if (op.av.length <= 1) return log(r, '👻 วินดิโก้: ฝ่ายตรงข้ามมี Avatar ไม่เกิน 1 ใบ'); vfx(x.u, 'burst', '👻 วินดิโก้', '#7c3aed');
    ask(r, 1 - i, { text: 'วินดิโก้: เลือก Avatar ของตนเอง 1 ใบ ที่จะอยู่ต่อ (ใบอื่นทั้งหมดลงนรก)', opts: op.av.map(a => a.u), cb: us => { op.av.filter(a => a.u !== us[0]).forEach(a => sendHell(r, a.u)); log(r, '👻 วินดิโก้: ' + op.name + ' เลือก ' + nmOf(op.av[0] || x) + ' — Avatar ใบอื่นลงนรกทั้งหมด'); } }); },
  'BT09-022': (r, i, x) => { const p = r.p[i], isC = c => !c.tk && isAv(c) && (symOf(c) === 'ไซเบอร์' || (symOf(c) === 'ปลา' || also9(c, 'ปลา')) || c.id === 'BT09-022') && B[c.id].c <= 5;
    scout(r, i, 3, { text: 'จุติ: เลือก Avatar {ไซเบอร์} หรือ {ปลา} Cost ≤ 5 จากที่สอดแนม อัญเชิญลงสนาม', pred: isC, rest: 'shuffle', by: x, then: got => { if (!got) return log(r, 'โซน่า โพลีกอน: ไม่พบ Avatar ที่อัญเชิญได้');
      p.hand.push(got); if (!summonAny(r, i, got.u, 'hand', x)) { log(r, 'โซน่า: อัญเชิญ ' + B[got.id].n + ' ไม่ได้'); return; } vfx(got.u, 'burst', 'อัญเชิญ', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, got)); if (hasN9(got, 'โฮคุ')) { draw(r, p, 1); log(r, '✨ โซน่า: อัญเชิญ โฮคุ โพลีกอน — จั่ว 1 ใบ'); } } }); },
  'BT09-020': (r, i, x) => { const O = r.p[1 - i].av.filter(a => !a.tk && P(r, a) < P(r, x) && !protectedFrom(r, i, a)).map(a => a.u); if (!O.length) return log(r, 'จุติ กัล มนุษย์ดาว: ไม่มี Avatar ที่ POWER น้อยกว่า');
    ask(r, i, { text: 'จุติ: เลือก Avatar ฝ่ายตรงข้ามที่ POWER น้อยกว่า เปลี่ยนการควบคุมไป Magic Zone ฝ่ายเรา เป็น "' + SERV9 + '"', opts: O, cb: us => { const c = toMg(r, i, us[0]); if (!c) return; c.nmo = SERV9; c.sy = 'เอเลี่ยน'; log(r, '👽 กัล มนุษย์ดาว R18: ' + B[c.id].n + ' กลายเป็น ' + SERV9 + ' ที่ Magic Zone'); } }); },
});

/* ---------- สั่งใช้ (บนสนาม / Magic Zone) ---------- */
Object.assign(AB, {
  'BT09-006': { z: 'av', steps: [], can: (r, i) => r.p[i].deck.some(c => !c.tk && isAv(c) && B[c.id].c <= 5 && (symOf(c) === 'เทพ' || symOf(c) === 'นรก' || isPoly9(c)) && !/only/i.test(B[c.id].o || '')),   // ลูเซีย โพลีกอน
    run: (r, i, cx) => { const p = r.p[i], O = p.deck.filter(c => !c.tk && isAv(c) && B[c.id].c <= 5 && (symOf(c) === 'เทพ' || symOf(c) === 'นรก' || isPoly9(c)) && !/only/i.test(B[c.id].o || '')).map(c => c.u);
      ask(r, i, { text: 'ลูเซีย: เลือก Avatar Cost ≤ 5 {เทพ}/{นรก}/"โพลิกอน" (ไม่ใช่ Only) จาก Deck แสดงแล้ววางบนสุดของ Deck', opts: O, cancel: true, cb: us => { const c = p.deck.find(q => q.u === us[0]); if (!c) return; p.deck.splice(p.deck.indexOf(c), 1); shuf(p.deck); p.deck.push(c); vfx(cx.card.u, 'aura', '🔎 ' + B[c.id].n, '#a855f7'); fx({ k: 'say', id: c.id, t: 'แสดงการ์ด' }); log(r, '🔎 ลูเซีย โพลีกอน: แสดง ' + B[c.id].n + ' แล้วสับ Deck วางไว้บนสุด'); } }); } },
  'BT09-008': { z: 'av', steps: [], can: (r, i, c) => r.p[i].deck.some(d => !d.tk && B[d.id].t === 'Magic' && B[d.id].st === 'Modification' && /อาวุ[ธร]ของเพมมุ/.test(B[d.id].n)),   // เพมมุ ยอดมนุษย์: IKUZO AIBOU
    run: (r, i, cx) => { const p = r.p[i], x = cx.card, w = p.deck.find(d => !d.tk && B[d.id].t === 'Magic' && B[d.id].st === 'Modification' && /อาวุ[ธร]ของเพมมุ/.test(B[d.id].n)); if (!w) return;
      fx({ k: 'say', id: x.id, t: 'IKUZO AIBOU!' }); p.deck.splice(p.deck.indexOf(w), 1); w.at = x.u; p.mg.push(w); bt8Wear(r, i, w, x); shuf(p.deck); vfx(x.u, 'burst', '🔫 IKUZO AIBOU', '#ef4444'); log(r, '🔫 เพมมุ: "IKUZO AIBOU" — นำ ' + B[w.id].n + ' จาก Deck มาสวมใส่ (ถือเป็นการใช้ Modification)'); } },
  'BT09-025': { z: 'av', steps: [], run: (r, i, cx) => { const v = 1 + Math.floor(hellN9(r, i) / 5); addTp(cx.card, v); vfx(cx.card.u, 'aura', '❄ POWER +' + v, '#38bdf8'); log(r, '❄ โลกิ: POWER +' + v + ' จนจบเทิร์น'); } },
  'BT09-022': { z: 'av', steps: [], can: (r, i, c) => !c.tired, run: (r, i, cx) => { cx.card.tired = true; draw(r, r.p[i], 1); vfx(cx.card.u, 'aura', '🐟 จั่ว 1', '#38bdf8'); log(r, '🐟 โซน่า โพลีกอน: เปลี่ยนเป็นสภาพนอน — จั่ว 1 ใบ'); } },
  'BT09-031': { z: 'av', can: (r, i) => r.p[i].hand.length > 1 || r.p[i].hand.length === 1,   // ลูเซเน่ โพลีกอน
    steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }, { key: 'm', text: 'เลือก Magic (ไม่ใช่ Only) ในนรกเรา 1 ใบ เพื่อเนรเทศแล้วใช้ความสามารถ', opts: (r, i) => r.p[i].hell.filter(c => isMagic9(c) && MG[c.id] && !/only/i.test(B[c.id].o || '')).map(c => c.u) }],
    run: (r, i, cx) => { const p = r.p[i], c = fromZone(r, i, 'hell', cx.pick.m[0]); if (!c) return; p.dk.push(c); vfx(cx.card.u, 'aura', '✨ ' + B[c.id].n, '#a855f7'); log(r, '✨ ลูเซเน่: เนรเทศ ' + B[c.id].n + ' แล้วใช้ความสามารถ'); r.g.curMg = { card: c, i }; runMg9(r, i, c, MG[c.id], () => { r.g.curMg = null; }); } },
  'BT09-033': { z: 'av', can: (r, i, c) => !!c.jt && r.p[1 - i].av.length > 0,   // สกินวอคเกอร์ (พอดี)
    steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ เพื่อคัดลอก ชื่อ/Cost/Gem/Symbol/POWER จนจบเทิร์น', opts: (r, i) => r.p[1 - i].av.filter(a => !protectedFrom(r, i, a)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]), x = cx.card; if (!t) return; x.nmo = nmOf(t.c); x.sy = symOf(t.c); x.cc9 = costNow(r, t.c) - (B[x.id].c || 0); x.cx = (x.cx || 0) + x.cc9; x.cp9 = r.g.n; const tp = x.tp || 0; const d = P(r, t.c) - (P(r, x) - 0); addTp(x, d);
      vfx(x.u, 'burst', '👤 สกินวอคเกอร์', '#7c3aed'); log(r, '👤 สกินวอคเกอร์: คัดลอก ' + nmOf(t.c) + ' (POWER ' + P(r, x) + ') จนจบเทิร์น'); } },
  'BT09-042': { z: 'av', any: 1, can: (r, i, c) => r.p[i].hand.some(h => !h.tk && isAv(h) && nmOf(h).includes('เรื่องราว') && B[h.id].c === 6),   // นักท่องเรื่องราว ขวัญตา
    steps: [{ key: 'k', text: 'แสดง Avatar "เรื่องราว" Cost 6 จากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.filter(h => !h.tk && isAv(h) && nmOf(h).includes('เรื่องราว') && B[h.id].c === 6).map(h => h.u) }],
    run: (r, i, cx) => { const p = r.p[i], x = cx.card, k = p.hand.find(h => h.u === cx.pick.k[0]); if (!k) return; fx({ k: 'say', id: k.id, t: 'แสดงการ์ด' });
      p.av.splice(p.av.indexOf(x), 1); release(r, x.u); p.dk.push(x); x.drawn9 = 1; draw(r, p, 1); log(r, '📖 นักท่องเรื่องราว: ถูกเนรเทศจาก Avatar Zone — จั่ว 1 ใบ'); vfx(x.u, 'aura', '🌀 เนรเทศ', '#22c55e'); log(r, '📖 นักท่องเรื่องราว: เนรเทศตัวเอง แล้วอัญเชิญ ' + B[k.id].n); k.sk9 = 1;
      if (!summonAny(r, i, k.u, 'hand', x)) { delete k.sk9; log(r, 'นักท่องเรื่องราว: อัญเชิญไม่ได้'); } else { vfx(k.u, 'burst', '📖 เรื่องราว', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, k)); } } },
  'BT09-043': { z: 'av', can: (r, i, c) => !!c.sk9 && r.p[i].hand.length > 0 && r.p[i].hell.some(isSkill9),
    steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }, { key: 'm', text: 'เลือก Magic "Skill" จากนรก ขึ้นมือ', opts: (r, i) => r.p[i].hell.filter(isSkill9).map(c => c.u) }],
    run: (r, i, cx) => { const c = fromZone(r, i, 'hell', cx.pick.m[0]); if (c) { r.p[i].hand.push(c); vfx(cx.card.u, 'aura', '📘 ' + B[c.id].n, '#22c55e'); log(r, '📘 ขวัญตา ราชาแห่งนาค: นำ ' + B[c.id].n + ' จากนรกขึ้นมือ'); } } },
  'BT09-021': { z: 'av', can: (r, i) => r.p[i].hand.length > 0 && r.p[1 - i].av.some(a => P(r, a) >= 8),   // คราเค่น ปลาหมึกปีศาจ
    steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }, { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้ามที่ POWER ≥ 8 ส่งไป Magic Zone ของฝ่ายตรงข้าม', opts: (r, i) => r.p[1 - i].av.filter(a => P(r, a) >= 8 && !protectedFrom(r, i, a)).map(a => a.u) }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; const c = toMg(r, 1 - i, t.c.u); if (c) { c.gain8 = 'BT09-021M'; vfx(c.u, 'burst', '🐙 คราเค่น', '#38bdf8'); log(r, '🐙 คราเค่น: ส่ง ' + B[c.id].n + ' ไปยัง Magic Zone ของ ' + r.p[1 - i].name); } } },
  'BT09-021M': { z: 'mg', steps: [], can: (r, i, c) => r.p[i].hand.length >= 2 && !!c.mgAv,   // ความสามารถที่ได้รับ: ทิ้งมือ 2 ใบ อัญเชิญจาก Magic Zone
    run: (r, i, cx) => { const c = cx.card, me = r.p[i]; if (me.hand.length < 2) return; ask(r, i, { text: 'เลือกการ์ดบนมือ 2 ใบ ที่จะทิ้งเพื่ออัญเชิญ ' + B[c.id].n + ' จาก Magic Zone', opts: me.hand.map(h => h.u), n: 2, min: 2, cancel: true, cb: us => { us.forEach(u => sendHell(r, u)); const o = mgOut(r, c, 'hand'); delete c.gain8; if (summonAny(r, o, c.u, 'hand', c)) { vfx(c.u, 'burst', '🐙 อัญเชิญกลับ', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, o, c)); } } }); } },
  'BT09-050': { z: 'mg', steps: [], can: (r, i) => true, run: (r, i, cx) => {   // บลัดดี้แมรี่
    const me = r.p[i], g = r.g; const a = bt6Dice(r, i), b = bt6Dice(r, i); if (a % 2 || b % 2) return log(r, '🎲 บลัดดี้แมรี่: ผลไม่ออกคู่ทั้ง 2 ครั้ง');
    const O = me.hell.filter(isGhost9).map(c => c.u); if (!O.length) return log(r, '🎲 บลัดดี้แมรี่: ออกคู่ 2 ครั้ง แต่ไม่มี วิญญาณร้าย ในนรก');
    ask(r, i, { text: 'บลัดดี้แมรี่: ออกคู่ 2 ครั้ง — เลือก วิญญาณร้าย 1 ใบ จากนรก เนรเทศ', opts: O, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return; me.dk.push(c); (g.w50 = g.w50 || [0, 0])[i]++; vfx(cx.card.u, 'burst', '🩸 เนรเทศ ' + g.w50[i] + '/3', '#ef4444'); log(r, '🩸 บลัดดี้แมรี่: เนรเทศ วิญญาณร้าย (' + g.w50[i] + '/3)');
      if (g.w50[i] >= 3 || me.dk.filter(isGhost9).length >= 3) { g.over = me.name + ' ชนะ! (บลัดดี้แมรี่: วิญญาณร้าย 3 ใบในมิติมืด)'; } } }); } },
  'BT09-071F': { z: 'av', can: (r, i, c) => landIs(r, LAND9) && isFruit9(c) && r.p[i].deck.length > 0 && r.p[i].hell.some(isFruit9),   // ป่าพงไพร: ภูติผลไม้ สามัคคี
    steps: [], run: (r, i, cx) => { const p = r.p[i], t = p.deck.pop(); if (!t) return; p.dk.push(t); const O = p.hell.filter(isFruit9).map(c => c.u); log(r, '🍈 ป่าพงไพร: เนรเทศการ์ดบนสุดของ Deck (' + B[t.id].n + ')');
      ask(r, i, { text: 'เลือก "ภูติผลไม้" จากนรก อัญเชิญ (ได้คำสั่งเสีย เนรเทศตัวเอง)', opts: O, cb: us => { const c = p.hell.find(q => q.u === us[0]); if (c && sumH9(r, i, c, 'hell', '🍈 อัญเชิญ', '#22c55e')) { c.k71 = 1; } } }); } },
});

/* ---------- สั่งใช้จากมือ / นรก ---------- */
Object.assign(ABIL, {
  'BT09-020': { zone: 'hand', label: 'ส่ง ข้ารับใช้ของ มนุษย์ดาว R18 (สูงสุด 2 ใบ) ลงนรก แล้วอัญเชิญ', cond: (r, i, c) => canPlaceAv(r, i, c),
    run: (r, i, x) => { const me = r.p[i], S = me.mg.filter(m => m.mgAv && nmOf(m) === SERV9).map(m => m.u);
      const go = n => { if (!summonAny(r, i, x.u, 'hand', x)) return; x.k20 = n; vfx(x.u, 'burst', '👽 กัล มนุษย์ดาว', '#22c55e'); log(r, '👽 กัล มนุษย์ดาว R18: ส่งข้ารับใช้ ' + n + ' ใบ — POWER ตั้งต้น +' + (n * 3)); r.g.q.unshift(() => fxSummon(r, i, x)); };
      if (!S.length) return go(0); ask(r, i, { text: 'เลือก "' + SERV9 + '" ที่จะส่งลงนรก (สูงสุด 2 ใบ ไม่เลือก = 0)', opts: S, n: 2, min: 0, cancel: true, onCancel: () => go(0), cb: us => { us.forEach(u => { const m = me.mg.find(q => q.u === u); if (m) { mgOut(r, m, 'hell'); delete m.nmo; delete m.sy; } }); go(us.length); } }); } },
  'BT09-030': { zone: 'hell', label: 'เนรเทศใบนี้ + ธรณีสูบ 3 : จั่ว 1 (ทิ้งมือด้วยความสามารถการ์ดเทิร์นนี้)', cond: (r, i) => !!(r.g.dh9 && r.g.dh9[i] === r.g.n) && r.p[i].deck.length >= 3,   // ลาพิเน่ โพลีกอน
    run: (r, i, x) => { const p = r.p[i], k = p.hell.indexOf(x); if (k < 0) return; p.hell.splice(k, 1); p.dk.push(x); const n0 = p.hell.length; vfx(x.u, 'aura', '🌀 ธรณีสูบ 3', '#a855f7'); mill(r, i, 3, x);
      r.g.q.push(() => { draw(r, p, 1); const M = p.hell.slice(n0).filter(isPoly9).map(c => c.u), Mx = p.hell.slice(n0).filter(c => !c.tk && /โพลีกอน|โพลิกอน/.test(B[c.id].n)).map(c => c.u); const O = M.length ? M : Mx; if (!O.length) return;
        ask(r, i, { text: 'ลาพิเน่: เลือกการ์ด "โพลิกอน" 1 ใบ จากที่ธรณีสูบ ขึ้นมือ', opts: O, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return; p.hand.push(c); log(r, '✨ ลาพิเน่: นำ ' + B[c.id].n + ' ขึ้นมือ');
          if (B[c.id].n.replace(/[\u0E34\u0E35]/g, '').includes('ลูเซเน่') && canPlaceAv(r, i, c)) ask(r, i, { yn: true, text: 'อัญเชิญ ลูเซเน่ โพลีกอน ลง Avatar Zone แทนไหม?', cb: y => { if (y && sumH9(r, i, c, 'hand', '🔮 ลูเซเน่', '#a855f7')) log(r, '🔮 ลาพิเน่: อัญเชิญ ลูเซเน่ โพลีกอน แทน'); } }); } }); }); } },
});

/* ---------- โจมตี : 044 ---------- */
ATK_TRIG.add('BT09-044');
BT4A['BT09-044'] = (r, i, a) => { if (!a.sk9) return; const p = r.p[i], O = p.deck.filter(isSkill9).map(c => c.u); if (!O.length) return; r.g.q.push(() => ask(r, i, { text: 'ครุฑเจ้าเวหา: เลือก Magic "Skill" จาก Deck ลงนรก แล้วสับ (ยกเลิก = ไม่ทำ)', opts: O, cancel: true, cb: us => { const k = p.deck.findIndex(c => c.u === us[0]); if (k >= 0) { p.hell.push(p.deck.splice(k, 1)[0]); shuf(p.deck); vfx(a.u, 'aura', '📘 Skill ลงนรก', '#22c55e'); log(r, '📘 ครุฑเจ้าเวหา: นำ Skill จาก Deck ลงนรก แล้วสับ'); } } })); };

/* ---------- Magic ---------- */
Object.assign(MG, {
  'BT09-049': { run: (r, i, cx) => { r.g.fg9 = r.g.n; vfx(cx.card.u, 'aura', '🙇 ขอโทษสังคม', '#facc15'); log(r, '🙇 ขอโทษสังคม: เทิร์นนี้ การขอโทษของ DJ ปีโป้ ได้รับการยกโทษเสมอ'); } },
  'BT09-050': { run: (r, i, cx) => { const me = r.p[i], c = cx.card, k = me.hell.indexOf(c); if (k >= 0) { me.hell.splice(k, 1); me.mg.push(c); vfx(c.u, 'aura', '🩸 วางบน Magic Zone', '#ef4444'); log(r, '🩸 บลัดดี้แมรี่: วางไว้บน Magic Zone'); } } },
  'BT09-055': { cond: (r, i) => r.p[i].av.some(wiz9),   // คาถา เสกควายเข้าท้อง
    run: (r, i, cx) => { const g = r.g, op = r.p[1 - i]; g.wz9 = g.wz9 || [0, 0];
      if (g.wz9[i] >= 3) { const F = [...op.av, ...op.co, ...op.mg].filter(c => !c.tk).map(c => c.u); const doHell = () => { if (op.hell.length) { const c = op.hell.pop(); op.dk.push(c); log(r, '🌀 เนรเทศ ' + B[c.id].n + ' จากนรกฝ่ายตรงข้าม'); } }, doHand = () => { if (op.hand.length) { const c = op.hand.splice(Math.floor(Math.random() * op.hand.length), 1)[0]; op.dk.push(c); log(r, '🌀 สุ่มเนรเทศ ' + B[c.id].n + ' จากมือฝ่ายตรงข้าม'); } };
        const fin = () => { doHell(); doHand(); vfx(cx.card.u, 'burst', '🐃 เสกควายเข้าท้อง', '#a855f7'); };
        if (F.length) return ask(r, i, { text: 'เสกควายเข้าท้อง (ร่างสมบูรณ์): เลือกการ์ดบนสนามฝ่ายตรงข้าม 1 ใบ เนรเทศ', opts: F, cancel: true, onCancel: fin, cb: us => { const f = find(r, us[0]); if (f) { take(r, f.c.u); op.dk.push(f.c); log(r, '🌀 เนรเทศ ' + B[f.c.id].n + ' จากสนามฝ่ายตรงข้าม'); } fin(); } }); return fin(); }
      const O = op.av.filter(a => P(r, a) <= 4 && !protectedFrom(r, i, a, 1)).map(a => a.u); if (!O.length) return log(r, 'เสกควายเข้าท้อง: ไม่มี Avatar ที่ POWER ≤ 4');
      const pick = () => ask(r, i, { text: 'เสกควายเข้าท้อง: เลือก Avatar ฝ่ายตรงข้าม (ผลรวม POWER ≤ 4) ที่จะทำลาย', opts: O, n: O.length, min: 1, cancel: true, cb: us => { const s = us.reduce((n, u) => n + P(r, find(r, u).c), 0); if (s > 4) { log(r, 'ผลรวม POWER ' + s + ' เกิน 4 — เลือกใหม่'); return pick(); } us.forEach(u => { vfx(u, 'burst', '🐃', '#a855f7'); destroyAv(r, u); }); g.wz9[i] += us.length; log(r, '🐃 เสกควายเข้าท้อง: ทำลาย ' + us.length + ' ใบ (สะสม ' + g.wz9[i] + '/3)'); } }); pick(); } },
  'BT09-059': { react: 'use', cond: (r, i) => r.p[i].av.length > 0 && r.p[i].av.every(a => nmOf(a).includes('เรื่องราว')),   // Skill : Hypersense
    run: (r, i, cx) => { const e = cx.ev, f = e && find(r, e.u); if (!f || f.z !== 'av') return; f.c.nf = r.g.n; vfx(f.c.u, 'burst', 'สูญเสียความสามารถ', '#22c55e'); log(r, '📘 Hypersense: ' + nmOf(f.c) + ' สูญเสียความสามารถทั้งหมดจนจบเทิร์น');
      if (r.p[i].hell.filter(isMagic9).length >= 8) ask(r, i, { yn: true, text: 'Hypersense: นรกมี Magic ≥ 8 — ทำลาย ' + nmOf(f.c) + ' ด้วยไหม?', cb: y => { if (y) destroyAv(r, f.c.u); } }); } },
  'BT09-061': { react: 'atk', steps: [{ key: 't', text: 'เลือก Avatar ของเราที่ POWER ≥ 8 และกำลังต่อสู้อยู่', opts: (r, i, cx) => { const p = cx.pend || r.g.pend, a = r.g.curAtk || (p && find(r, p.u) && find(r, p.u).c), D = p && p.tk === 'av' ? r.p[i].av.find(x => x.u === p.tg) : null; return [a, D].filter(x => x && r.p[i].av.includes(x) && P(r, x) >= 8).map(x => x.u); } }],
    run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; t.c.k61 = r.g.n; vfx(t.c.u, 'aura', '🏚 ทะลุบ้านทะลุโกศ', '#f59e0b'); log(r, '🏚 ทะลุบ้านทะลุโกศ: ถ้า ' + nmOf(t.c) + ' ทำลาย Avatar ฝ่ายตรงข้ามได้ — หงาย LIFE'); } },
  'BT09-064': { mod: 1, tgf: x => hasN9(x, 'ธอร์') },   // ค้อนโยเนียร์ (POWER +1 ผ่าน mod; สั่งใช้จากนรกผ่านเหตุการณ์ Link)
  'BT09-065': { mod: 1 },
  'BT09-067': { mod: 1, tgf: x => hasN9(x, 'เพมมุ'), cond: (r, i) => !r.p[i].mg.some(m => /อาวุ[ธร]ของเพมมุ/.test(B[m.id].n)) },
  'BT09-068': { mod: 1, tgf: x => !x.tk && isPolice(x) },
  'BT09-069': {}, 'BT09-070': { cond: () => true },
});
const _ls94 = startCast;
startCast = function (r, i, f, c, def, pre) { if (c.st === 'Land' && landIs(r, 'BT09-070') && c.id !== 'BT09-070') E('สวนกล้วยหนีภาษี: ผู้เล่นทุกคนไม่สามารถใช้ Land ได้'); return _ls94(r, i, f, c, def, pre); };

/* ===================================================================
   BT09 — ส่วนที่เหลือ: Gem ไร้สี (012-014), 4 GEM สีฟ้า (015), 057 เป็น React, 063 ฝั่งโจมตี,
   066 (ธรณีสูบ → สวมใส่), สามัคคีของโลกิ, กฎเด็ค 008/009
   =================================================================== */
const bt9Colorless = (c, d) => ['BT09-012', 'BT09-013', 'BT09-014'].includes(d.id) && /^(กุ่ย|ฮอล|นาย)(\s|$)/.test((c.n || '').trim());   // payOK: ถือเป็น Gem ไร้สี
const bt9G = (c, d) => (d.id === 'BT10-045' && /^ตำรวจ/.test((c.n || '').trim())) ? 5 : (d.id === 'BT09-015' && (c.n || '').trim().startsWith('ราชินีหิมะ')) ? 4 : 0;                                       // giantG: เหลียง = 4 GEM (ฟ้า)
const bt9SupBlock = (r, q, a) => q.id === 'BT09-025' && !noFx(r, q) && !hasN9(a, 'ธอร์');                                                   // โลกิ ให้สามัคคีได้เฉพาะ ธอร์

const payGem9 = (r, i, need, except, ok, cancel) => {   // ทิ้งการ์ดบนมือให้ GEM รวม ≥ need
  const me = r.p[i], used = []; let sum = 0;
  const step = () => { const O = me.hand.filter(h => h !== except && !used.includes(h) && (B[h.id].g || 0) > 0).map(h => h.u); if (!O.length) return cancel();
    ask(r, i, { text: 'เลือกการ์ดบนมือที่จะทิ้งเป็น Cost (GEM ที่เหลือ ' + (need - sum) + ')', opts: O, cancel: true, onCancel: cancel, cb: us => { const h = me.hand.find(q => q.u === us[0]); used.push(h); sum += B[h.id].g; if (sum < need) return step(); used.forEach(q => sendHell(r, q.u)); ok(); } }); };
  step();
};

/* ---------- 063 ฝั่งโจมตี: ยักษ์ของเราเป็นผู้โจมตี ---------- */
const _fa96 = fxAtk;
fxAtk = function (r, i, a, tg, tk) {
  _fa96(r, i, a, tg, tk);
  const me = r.p[i], k = hand9(r, i, 'BT09-063'); if (!k || a.tk || symOf(a) !== 'ยักษ์' || r.g.used[i].React) return;
  const O = me.av.filter(x => x.u !== a.u && !x.tired && symOf(x) === 'ยักษ์'); if (!O.length || !me.hand.some(h => h !== k && (B[h.id].g || 0) > 0)) return;
  r.g.q.unshift(() => ask(r, i, { yn: true, text: 'ลงกาโพรเทคชั่น: ' + nmOf(a) + ' โจมตี — ทิ้งการ์ดให้ GEM รวม 2 แล้วให้ยักษ์ตื่น 1 ใบ เปลี่ยนเป็นนอน และนำ POWER มาเพิ่มให้ผู้ต่อสู้ไหม?', cb: y => { if (!y) return;
    ask(r, i, { text: 'เลือก Avatar {ยักษ์} ที่ไม่ได้ต่อสู้และอยู่ในสภาพตื่น', opts: O.map(x => x.u), cancel: true, cb: us => { const t = find(r, us[0]); if (!t || !me.hand.includes(k)) return;
      payGem9(r, i, 2, k, () => { const v = P(r, t.c); t.c.tired = true; a.bp = (a.bp || 0) + v; sendHell(r, k.u); r.g.used[i].React = 1; vfx(t.c.u, 'aura', '😴 นอน', '#94a3b8'); vfx(a.u, 'aura', '🗿 POWER +' + v, '#ef4444'); log(r, '🗿 ลงกาโพรเทคชั่น: ' + nmOf(t.c) + ' นอน — ' + nmOf(a) + ' POWER +' + v + ' จนจบการต่อสู้'); }, () => log(r, 'ลงกาโพรเทคชั่น: จ่าย Cost ไม่ได้ — ยกเลิก')); } }); } }));
};

/* ---------- 066: ถูกธรณีสูบลงนรก → สวมใส่ให้ เทพธิดาแห่งวัลฮัลลา ---------- */
const _m96 = bt6Mill2;
bt6Mill2 = function (r, i, c, pg, mgc) {
  _m96(r, i, c, pg, mgc);
  if (!c || c.tk || c.id !== 'BT09-066') return; const p = r.p[i], T = p.av.filter(a => hasN9(a, 'เทพธิดาแห่งวัลฮัลลา') && !protectedFrom(r, i, a, 1)).map(a => a.u);
  if (!T.length || !p.hell.includes(c)) return;
  r.g.q.push(() => ask(r, i, { yn: true, text: 'หอกศักดิ์สิทธิ์ เอ็ดดา: ถูกธรณีสูบลงนรก — นำไปสวมใส่ให้ "เทพธิดาแห่งวัลฮัลลา" บนสนามไหม?', cb: y => { if (!y || !p.hell.includes(c)) return;
    const go = u => { const t = find(r, u); if (!t || t.z !== 'av') return; p.hell.splice(p.hell.indexOf(c), 1); c.at = t.c.u; p.mg.push(c); bt8Wear(r, i, c, t.c); vfx(t.c.u, 'aura', '🔱 สวมหอก เอ็ดดา', '#facc15'); log(r, '🔱 หอกศักดิ์สิทธิ์ เอ็ดดา: สวมใส่ให้ ' + nmOf(t.c)); };
    if (T.length === 1) go(T[0]); else ask(r, i, { text: 'เลือก "เทพธิดาแห่งวัลฮัลลา" ที่จะสวมใส่', opts: T, cb: us => go(us[0]) }); } }));
};

/* ---------- กฎเด็ค 008 / 009 ---------- */
const _cb96 = checkBan;
checkBan = function (main) {
  _cb96(main); const has = n => main.some(i => B[i].n.trim().startsWith(n));
  if (has('เพมมุ ยอดมนุษย์')) main.forEach(i => { const d = B[i]; if (d.t === 'Avatar' && (d.s === 'คน' || d.s === 'ต่างชาติ' || d.id === 'BT09-015') && !d.n.includes('เพมมุ')) E('เพมมุ ยอดมนุษย์: ไม่สามารถใส่ Avatar ชื่ออื่นที่เป็น {คน} หรือ {ต่างชาติ} ได้ (ยกเว้น เพมมุ) — ผิดที่: ' + d.n); });
  if (has('พญายม With The Shotgun') && !main.some(i => B[i].n.trim() === 'สุวาน')) E('พญายม With The Shotgun: ต้องใส่ Avatar "สุวาน" ไว้ใน Deck ด้วย 1 ใบ');
  if (has('สไปรท์ ยอดสุนัข') && !main.some(i => B[i].t === 'Avatar' && B[i].n.trim().startsWith('เพมมุ'))) E('สไปรท์ ยอดสุนัข: ต้องใส่ Avatar "เพมมุ" ไว้ใน Deck ด้วยเสมอ');
};
Object.assign(MG['BT09-057'], { react: 1 });

/* ===================================================================
   BT09 — ตรวจรอบสุดท้าย: สกิลที่ต้องอยู่ในสถานะ Link / {คู่หู} ต้องเช็กเงื่อนไขจริง
   008 009 007 022 024 025 028  (การ์ดอื่นที่มี [Link] ถูกเช็กไว้แล้วใน P(), bt9AtkBlock, lk9)
   =================================================================== */
const gateLink9 = (id, extra) => { const o = AB[id] && AB[id].can; AB[id].can = (r, i, c) => !!c && linked9(r, c) && (!o || o(r, i, c)); };
['BT09-008', 'BT09-022', 'BT09-025'].forEach(id => gateLink9(id));
Object.assign(B7NK, { 'BT09-009': ['โล่มนุษย์', 'ลูกฮึด', 'สามัคคี'] });   // 009: โล่มนุษย์/ลูกฮึด/สามัคคี มีเฉพาะตอน Link เพมมุ ยอดมนุษย์
B9K['BT09-009'] = { 'โล่มนุษย์': (r, x) => onAv9(r, x) && linked9(r, x), 'ลูกฮึด': (r, x) => onAv9(r, x) && linked9(r, x), 'สามัคคี': (r, x) => onAv9(r, x) && linked9(r, x) };
ATK_TRIG.add('BT09-028');
BT4A['BT09-028'] = (r, i, a, tg, tk) => {   // แบงค์ ตัวแดง [คู่หู - สตางค์]: เมื่อโจมตี Avatar สีแดง ส่ง Avatar เป้าหมายลงนรก
  if (tk !== 'av' || !linked9(r, a)) return; const d = r.p[1 - i].av.find(x => x.u === tg); if (!d || !isCol(d, 'แดง')) return;
  fx({ k: 'say', id: a.id, t: 'ส่งลงนรก' }); vfx(d.u, 'burst', '💥 แบงค์ ตัวแดง', '#ef4444'); log(r, '💥 แบงค์ ตัวแดง (คู่หู): โจมตี Avatar สีแดง — ส่ง ' + nmOf(d) + ' ลงนรก'); sendHell(r, d.u);
};


// BT09: "ถือว่าเป็น {symbol X} ด้วย" (015 ต่างชาติ / 022 ปลา / 030 สัตว์มหัศจรรย์)
function also9(x, sym) { return !!x && !x.tk && ((x.id === 'CC01-020' && !!CR && CR.p.some(q => q.av.includes(x)) && !noFx(CR, x)) || (x.id === 'BT09-015' && sym === 'ต่างชาติ') || (x.id === 'CC02-004' && sym === 'หุ่นยนต์') || (x.id === 'BT09-022' && sym === 'ปลา') || (x.id === 'BT09-030' && sym === 'สัตว์มหัศจรรย์')); }

/* =====================================================================
   ===== BT10 รอบที่ 1 (เริ่มบล็อก) — สกิลที่ใช้กลไกเดิม + อนิเมชันเดิม =====
   วางบล็อกนี้ก่อนบรรทัด srv.listen(...) ถ้าจะนำไปรวมกับไฟล์ล่าสุด
   ใช้ตาราง SUM / AB / MG / BT4A เดิม  ไม่เพิ่มกลไกใหม่
   การ์ดในรอบนี้: 002(จุติ+สั่งใช้) 003(สั่งใช้) 007 008 021 034 035(ดู hook ใน startTurn) 043 061 062
   ===================================================================== */
const bt10Name = (c, s) => !!c && !c.tk && B[c.id] && B[c.id].n.includes(s);
const bt10Only = c => /only/i.test((B[c.id] && B[c.id].o) || '');
const bt10Say = (x, t, c) => { fx({ k: 'say', id: x.id, t }); vfx(x.u, 'aura', t, c || '#38bdf8'); };
// นำการ์ดที่สอดแนมแล้ว (ที่เหลือ) เรียงเข้าใต้ Deck: เลือกใบล่างสุดก่อน แล้วไล่ขึ้นมา
function bt10Bottom(r, i, cs, done) {
  const p = r.p[i]; cs = cs.filter(c => p.deck.includes(c)); cs.forEach(c => p.deck.splice(p.deck.indexOf(c), 1));
  const bot = [], rem = () => cs.filter(c => !bot.includes(c));
  const fin = () => { bot.slice().reverse().forEach(c => p.deck.unshift(c)); if (cs.length) log(r, '⬇ ' + p.name + ': เรียงการ์ดที่เหลือ ' + cs.length + ' ใบ นำไว้ใต้ Deck'); done && done(); };
  const step = () => { const R = rem(); if (!R.length) return fin(); if (R.length === 1) { bot.push(R[0]); return fin(); }
    ask(r, i, { text: 'สอดแนม: เลือกการ์ดที่จะวางเป็น "ใบล่างสุด" ลำดับที่ ' + (bot.length + 1) + ' ของ Deck (นับขึ้นมาจากล่างสุด)', opts: R.map(c => c.u), cb: us => { bot.push(cs.find(c => c.u === us[0])); step(); } }); };
  step();
}
const bt10Hand = (r, i) => r.p[i].hand.map(c => c.u);

Object.assign(SUM, {
  // BT10-002 พระอิศวร นักเต้น — จุติ: สอดแนม 3 เลือก "พระแม่อุมาเทวี"/"พระอิศวร" ที่ไม่ใช่ Only ขึ้นมือ ที่เหลือเรียงใต้ Deck
  'BT10-002': (r, i, x) => {
    const p = r.p[i], seen = bt4Peek(r, i, 3, x);
    const L = seen.filter(c => p.deck.includes(c) && isAv(c) && !bt10Only(c) && (B[c.id].n.includes('พระแม่อุมาเทวี') || B[c.id].n.includes('พระอิศวร'))).map(c => c.u);
    const fin = got => bt10Bottom(r, i, seen.filter(c => c !== got));
    if (!L.length) { log(r, 'จุติ พระอิศวร: ไม่พบ พระแม่อุมาเทวี/พระอิศวร ที่ไม่ใช่ Only'); return fin(null); }
    ask(r, i, { text: 'จุติ: เลือก "พระแม่อุมาเทวี" หรือ "พระอิศวร" (ไม่ใช่ Only) 1 ใบจากที่สอดแนม ขึ้นมือ (ยกเลิก = ไม่นำ)', opts: L, cancel: true,
      cb: us => { const c = fromZone(r, i, 'deck', us[0]); c && p.hand.push(c); log(r, '✨ ' + p.name + ': นำ ' + (c ? B[c.id].n : '-') + ' ขึ้นมือ'); fin(c); }, onCancel: () => fin(null) });
  },
  // BT10-034 ตำรวจสัมภเวสี ทาย — จุติ: แสดง "ตำรวจ" จากมือ สอดแนม Deck ฝ่ายตรงข้าม 2 ใบ ทิ้ง 1 ลงนรก อีกใบวางไว้บนสุด
  'BT10-034': (r, i, x) => {
    const p = r.p[i], O = r.p[1 - i], L = p.hand.filter(c => bt10Name(c, 'ตำรวจ')).map(c => c.u);
    if (!L.length) return log(r, 'จุติ ตำรวจสัมภเวสี: ไม่มี "ตำรวจ" บนมือให้แสดง');
    ask(r, i, { text: 'จุติ: แสดงการ์ด "ตำรวจ" 1 ใบจากมือ เพื่อสอดแนม Deck ฝ่ายตรงข้าม 2 ใบ (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => {
      const sh = p.hand.find(c => c.u === us[0]); log(r, '🪪 ' + p.name + ' แสดง ' + (sh ? B[sh.id].n : 'ตำรวจ'));
      const seen = bt4Peek(r, 1 - i, 2, null); if (!seen.length) return log(r, 'Deck ฝ่ายตรงข้ามไม่มีการ์ด');
      ask(r, i, { text: 'เลือกการ์ด 1 ใบจาก Deck ฝ่ายตรงข้าม ส่งลงนรก (อีกใบวางไว้บนสุด)', opts: seen.map(c => c.u), cb: u2 => {
        const c = fromZone(r, 1 - i, 'deck', u2[0]); if (c) { O.hell.push(c); log(r, '🗑 ส่ง ' + B[c.id].n + ' ลงนรกฝ่ายตรงข้าม'); vfx(x.u, 'aura', 'ทิ้งลงนรก', '#a855f7'); }
        log(r, '⬆ การ์ดอีกใบวางไว้บนสุดของ Deck ฝ่ายตรงข้าม'); } });
    } });
  },
  // BT10-043 ไมยราพ — จุติ: อัญเชิญ Avatar {ยักษ์} Cost ≤3 ที่ไม่มี Text Box จาก Deck 2 ใบ แล้วสับ Deck
  'BT10-043': (r, i, x) => {
    const p = r.p[i], L = () => p.deck.filter(c => isAv(c) && symOf(c) === 'ยักษ์' && B[c.id].c <= 3 && !(B[c.id].e || '').trim()).map(c => c.u);
    let k = 0; const step = () => { if (k++ >= 2) return shuf(p.deck); const O = L(); if (!O.length) { log(r, 'จุติ ไมยราพ: ไม่พบ Avatar {ยักษ์} Cost ≤3 ที่ไม่มี Text Box เพิ่ม'); return shuf(p.deck); }
      ask(r, i, { text: 'จุติ: เลือก Avatar {ยักษ์} Cost ≤3 (ไม่มี Text Box) จาก Deck อัญเชิญลงสนาม (' + k + '/2)', opts: O, cb: us => { if (summonAny(r, i, us[0], 'deck')) vfx(us[0], 'burst', 'อัญเชิญ', '#ef4444'); step(); } }); };
    step();
  },
});

Object.assign(AB, {
  // BT10-002 พระอิศวร นักเต้น — เทิร์นละครั้ง สั่งใช้: จั่ว 1 แล้วเปลี่ยนการควบคุม Avatar ใบนี้ไปฝั่งฝ่ายตรงข้าม
  'BT10-002': { z: 'av', can: (r, i, c) => canPlaceAv(r, 1 - i, c), steps: [], run: (r, i, cx) => {
    const x = cx.card, f = find(r, x.u); draw(r, r.p[i], 1); bt10Say(x, 'จั่ว 1 ใบ', '#facc15'); log(r, '✨ ' + r.p[i].name + ': จั่ว 1 ใบ');
    if (!f || f.z !== 'av' || f.i !== i) return;
    if (!canPlaceAv(r, 1 - i, x)) return log(r, 'Avatar ฝ่ายตรงข้ามเต็ม เปลี่ยนการควบคุมไม่ได้');
    r.p[i].av.splice(f.k, 1); if (x.oo == null) x.oo = i; x.tired = false; r.p[1 - i].av.push(x); vfx(x.u, 'burst', 'เปลี่ยนการควบคุม', '#f43f5e'); log(r, '🔁 ' + nmOf(x) + ' ย้ายไปอยู่ฝั่ง ' + r.p[1 - i].name);
  } },
  // BT10-003 พี่บูม แก๊งขยะ — เทิร์นละครั้ง สั่งใช้ ทิ้งมือ 1: เลือกปฏิบัติ ค้น "พี่ซี๊ด แก๊งขยะ" หรือ "เบรกเกต แก๊งขยะ" ขึ้นมือ แล้วสับ
  'BT10-003': { z: 'av', can: (r, i) => r.p[i].hand.length > 0, steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => bt10Hand(r, i) }], run: (r, i, cx) => {
    const p = r.p[i], pick = nm => { const L = p.deck.filter(c => isAv(c) && B[c.id].n.includes(nm)).map(c => c.u);
      if (!L.length) { log(r, 'ไม่พบ "' + nm + '" ใน Deck'); return shuf(p.deck); }
      ask(r, i, { text: 'เลือก "' + nm + '" จาก Deck ขึ้นมือ', opts: L, cb: us => { const c = fromZone(r, i, 'deck', us[0]); c && p.hand.push(c); shuf(p.deck); log(r, '✨ ' + p.name + ': นำ ' + (c ? B[c.id].n : nm) + ' ขึ้นมือ'); } }); };
    bt10Say(cx.card, 'ความสามารถ', '#38bdf8');
    ask(r, i, { text: 'พี่บูม แก๊งขยะ: เลือกปฏิบัติ', choices: ['1) นำ "พี่ซี๊ด แก๊งขยะ" 1 ใบจาก Deck ขึ้นมือ', '2) นำ "เบรกเกต แก๊งขยะ" 1 ใบจาก Deck ขึ้นมือ'], cb: k => pick(k === 0 ? 'พี่ซี๊ด แก๊งขยะ' : 'เบรกเกต แก๊งขยะ') });
  } },
  // BT10-007 ตำรวจเอไอ มุเค — เทิร์นละครั้ง สั่งใช้: ประกาศประเภทการ์ดใบบนสุดของ Deck ฝ่ายตรงข้าม แล้วสอดแนม
  'BT10-007': { z: 'av', can: () => true, steps: [], run: (r, i, cx) => {
    const x = cx.card, O = r.p[1 - i], TY = ['Avatar', 'Magic', 'Construct', 'Life'];
    ask(r, i, { text: 'ตำรวจเอไอ มุเค: ประกาศประเภทของการ์ดใบบนสุดของ Deck ฝ่ายตรงข้าม', choices: ['Avatar', 'Magic', 'Construct', 'LIFE Card'], cb: k => {
      const want = TY[k]; log(r, '📢 ' + r.p[i].name + ' ประกาศ: ' + ['Avatar', 'Magic', 'Construct', 'LIFE Card'][k]);
      const seen = bt4Peek(r, 1 - i, 1, null); if (!seen.length) return log(r, 'Deck ฝ่ายตรงข้ามไม่มีการ์ด');
      const c = seen[0], hit = B[c.id].t === want;
      if (!hit) { addTp(x, -2); bt10Say(x, 'ทายผิด POWER -2', '#ef4444'); return log(r, '❌ ทายผิด (' + B[c.id].t + ') — ' + nmOf(x) + ' POWER -2 จนจบเทิร์น การ์ดอยู่ที่เดิม'); }
      log(r, '✅ ทายถูก (' + B[c.id].t + ')'); const T = foeAvT(r, i);
      const sendIt = () => { const d = fromZone(r, 1 - i, 'deck', c.u); if (d) { O.hell.push(d); log(r, '🗑 ส่ง ' + B[d.id].n + ' ลงนรกฝ่ายตรงข้าม'); } };
      if (!T.length) return sendIt();
      ask(r, i, { text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ POWER -2 จนจบเทิร์น', opts: T, cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, -2); vfx(t.c.u, 'aura', 'POWER -2', '#ef4444'); log(r, '🔻 ' + nmOf(t.c) + ' POWER -2'); } sendIt(); } });
    } });
  } },
  // BT10-021 แบงค์ ชาวดาวพฤหัส — เทิร์นละครั้ง สั่งใช้ ทิ้งมือ 1: เลือกปฏิบัติ แล้วสับ Deck
  'BT10-021': { z: 'av', can: (r, i) => r.p[i].hand.length > 0, steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ดบนมือ 1 ใบ', opts: (r, i) => bt10Hand(r, i) }], run: (r, i, cx) => {
    const p = r.p[i]; bt10Say(cx.card, 'ความสามารถ', '#38bdf8');
    const bank = (c, noOnly) => isAv(c) && B[c.id].n.includes('แบงค์') && !(noOnly && bt10Only(c));
    ask(r, i, { text: 'แบงค์ ชาวดาวพฤหัส: เลือกปฏิบัติ', choices: ['1) เลือก "แบงค์" ที่ไม่ใช่ Only 1 ใบจาก Deck ขึ้นมือ', '2) ส่ง "แบงค์" 1 ใบจาก Deck ลงนรก'], cb: k => {
      const L = p.deck.filter(c => bank(c, k === 0)).map(c => c.u);
      if (!L.length) { log(r, 'ไม่พบ "แบงค์" ที่เลือกได้ใน Deck'); return shuf(p.deck); }
      ask(r, i, { text: k === 0 ? 'เลือก "แบงค์" จาก Deck ขึ้นมือ' : 'เลือก "แบงค์" จาก Deck ส่งลงนรก', opts: L, cb: us => { const c = fromZone(r, i, 'deck', us[0]); if (c) { k === 0 ? p.hand.push(c) : p.hell.push(c); log(r, (k === 0 ? '✨ นำ ' : '🗑 ส่ง ') + B[c.id].n + (k === 0 ? ' ขึ้นมือ' : ' ลงนรก')); } shuf(p.deck); } });
    } });
  } },
});

Object.assign(BT4A, {
  // BT10-008 ไอ้นัท - คนบ้าจั่ว — เทิร์นละครั้ง อัตโนมัติ เมื่อ Avatar ใบนี้โจมตี: จั่ว 1 ใบ
  'BT10-008': (r, i, a) => { if (a.ou === r.g.n) return; a.ou = r.g.n; draw(r, r.p[i], 1); bt10Say(a, 'จั่ว 1 ใบ', '#facc15'); log(r, '✨ ไอ้นัท: ' + r.p[i].name + ' จั่ว 1 ใบ'); },
});
ATK_TRIG.add('BT10-008');

Object.assign(MG, {
  // BT10-061 นารายณ์ 10 ปาง — ทิ้งมือ 1: สอดแนม 3 เลือก Avatar "นารายณ์" {เทพ} Cost ≤6 ขึ้นมือ ที่เหลือเรียงใต้ Deck
  'BT10-061': { steps: [oneHand(1, 'ทิ้งการ์ดบนมือ 1 ใบ')], run: (r, i) => {
    const p = r.p[i], seen = bt4Peek(r, i, 3, null);
    const L = seen.filter(c => p.deck.includes(c) && isAv(c) && symOf(c) === 'เทพ' && B[c.id].n.includes('นารายณ์') && B[c.id].c <= 6).map(c => c.u);
    const fin = got => bt10Bottom(r, i, seen.filter(c => c !== got));
    if (!L.length) { log(r, 'นารายณ์ 10 ปาง: ไม่พบ Avatar "นารายณ์" {เทพ} Cost ≤6'); return fin(null); }
    ask(r, i, { text: 'เลือก Avatar "นารายณ์" {เทพ} Cost ≤6 1 ใบจากที่สอดแนม ขึ้นมือ (ยกเลิก = ไม่นำ)', opts: L, cancel: true,
      cb: us => { const c = fromZone(r, i, 'deck', us[0]); c && p.hand.push(c); log(r, '✨ ' + p.name + ': นำ ' + (c ? B[c.id].n : '-') + ' ขึ้นมือ'); fin(c); }, onCancel: () => fin(null) });
  } },
  // BT10-062 ทะลวงส้วม — เซ่นไหว้ Avatar "สิ่งปฏิกูล" 1 ใบ: จั่ว 3 แล้วทิ้งมือ 1
  'BT10-062': { steps: [{ key: 's', pay: 1, text: 'เซ่นไหว้ Avatar "สิ่งปฏิกูล" 1 ใบบน Avatar Zone เรา', opts: (r, i) => r.p[i].av.filter(a => nmOf(a).includes('สิ่งปฏิกูล')).map(a => a.u) }], run: (r, i) => {
    const p = r.p[i]; draw(r, p, 3); log(r, '✨ ' + p.name + ': จั่ว 3 ใบ');
    if (!p.hand.length) return;
    ask(r, i, { text: 'ทะลวงส้วม: ทิ้งการ์ดบนมือ 1 ใบ', opts: bt10Hand(r, i), cb: us => sendHell(r, us[0]) });
  } },
});
/* ===== จบบล็อก BT10 รอบที่ 1 ===== */

/* =====================================================================
   ===== BT10 รอบที่ 2 — คำสั่งเสีย / สั่งใช้จากมือ (นินจา) / Magic / ตอบโต้การโจมตี =====
   การ์ด: 004(ส่วนอัญเชิญ) 005 006 017 018 022 024 028 059 065
   hook เล็กๆ ที่แตะโค้ดเดิม: deathFx2 -> bt10Die, bt4Atk -> bt10AtkAny, endTurnFx -> bt10End, kick (เตะไข่ชั่วคราว a.kk), mill (จำว่าเทิร์นนี้ธรณีสูบ r.g.m10)
   ===================================================================== */
const bt10Ninjas = (r, i, ex) => r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('นินจา') && nmOf(a).trim() !== ex).map(a => a.u);
const bt10NameUsed = (r, i, nm) => !!(r.g.b10u && r.g.b10u[i + ':' + nm] === r.g.n);   // "ใช้ความสามารถนี้ของ Avatar ชื่อนี้ได้ 1 ครั้ง/เทิร์น"
const bt10Mark = (r, i, nm) => { (r.g.b10u = r.g.b10u || {})[i + ':' + nm] = r.g.n; };
// อัญเชิญใบนี้จากมือหลังนำนินจากลับมือ แล้วทำผลอัตโนมัติ "ถูกอัญเชิญด้วยความสามารถตัวเอง"
function bt10NinjaSwap(r, i, x, need, auto) {
  const nm = B[x.id].n.trim();
  ask(r, i, { text: B[x.id].n + ': เลือก Avatar "นินจา" ' + need + ' ใบ (ไม่ใช่ชื่อ ' + nm + ') บน Avatar Zone เรา นำกลับขึ้นมือ (ยกเลิก = ไม่ใช้)', opts: bt10Ninjas(r, i, nm), n: need, min: need, cancel: true, cb: us => {
    if (bt10NameUsed(r, i, nm)) return;
    us.forEach(u => { const t = find(r, u); t && t.z === 'av' && bounce(r, u); });
    if (!r.p[i].hand.includes(x) || !canPlaceAv(r, i, x)) return log(r, 'อัญเชิญ ' + B[x.id].n + ' ไม่ได้');
    bt10Mark(r, i, nm);
    if (summonAny(r, i, x.u, 'hand')) { if (x.id === 'BT10-004') x.g4 = 1; vfx(x.u, 'burst', 'อัญเชิญ (ความสามารถตัวเอง)', '#8b5cf6'); r.g.q.unshift(() => fxSummon(r, i, x)); auto && r.g.q.push(() => auto(r, i, x)); }
  } });
}
const bt10Hell = (r, i) => r.p[i].hell.map(c => c.u);

Object.assign(SUM, {
  // BT10-005 ฮันโซ — จุติ: นำ "วิชานินจา" 1 ใบจาก Deck ขึ้นมือ แล้วสับ
  'BT10-005': (r, i) => tutor(r, i, c => !c.tk && B[c.id].n.includes('วิชานินจา'), 'วิชานินจา'),
  // BT10-059 (Magic) ใช้ MG ด้านล่าง
});

Object.assign(ABIL, {
  // BT10-005 ฮันโซ นินจาในตำนาน — สั่งใช้ จากบนมือ: นำ "นินจา" 1 ใบกลับมือ แล้วอัญเชิญใบนี้ → เลือก "นินจา" 1 ใบ ได้รับเตะไข่ จนจบเทิร์น
  'BT10-005': { zone: 'hand', label: 'นำ "นินจา" 1 ใบกลับมือ แล้วอัญเชิญใบนี้', cond: (r, i, c) => !bt10NameUsed(r, i, B[c.id].n.trim()) && bt10Ninjas(r, i, B[c.id].n.trim()).length >= 1 && canPlaceAv(r, i, c), run: (r, i, x) =>
    bt10NinjaSwap(r, i, x, 1, (r2, i2, x2) => { const L = bt10Ninjas(r2, i2, ''); if (!L.length) return;
      ask(r2, i2, { text: 'ฮันโซ: เลือก Avatar "นินจา" 1 ใบ ได้รับ เตะไข่ จนจบเทิร์น', opts: L, cb: us => { const t = find(r2, us[0]); if (t) { t.c.kk = r2.g.n; vfx(t.c.u, 'aura', 'เตะไข่', '#f97316'); log(r2, '🥷 ' + nmOf(t.c) + ' ได้รับ เตะไข่ จนจบเทิร์น'); } } }); }) },
  // BT10-006 ชิโยเมะ นินจาสาว — สั่งใช้ จากบนมือ: นำ "นินจา" 1 ใบกลับมือ แล้วอัญเชิญใบนี้ → Avatar ฝ่ายตรงข้าม 1 ใบ POWER -3 จนจบเทิร์น
  'BT10-006': { zone: 'hand', label: 'นำ "นินจา" 1 ใบกลับมือ แล้วอัญเชิญใบนี้', cond: (r, i, c) => !bt10NameUsed(r, i, B[c.id].n.trim()) && bt10Ninjas(r, i, B[c.id].n.trim()).length >= 1 && canPlaceAv(r, i, c), run: (r, i, x) =>
    bt10NinjaSwap(r, i, x, 1, (r2, i2) => { const T = foeAvT(r2, i2); if (!T.length) return;
      ask(r2, i2, { text: 'ชิโยเมะ: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ POWER -3 จนจบเทิร์น', opts: T, cb: us => { const t = find(r2, us[0]); if (t) { addTp(t.c, -3); vfx(t.c.u, 'aura', 'POWER -3', '#ef4444'); log(r2, '🔻 ' + nmOf(t.c) + ' POWER -3 จนจบเทิร์น'); } } }); }) },
  // BT10-004 โกเอมอน นินจาจอมโจร — สั่งใช้ จากบนมือ: นำ "นินจา" 2 ใบกลับมือ แล้วอัญเชิญใบนี้ (ส่วนที่ได้รับสกิลโจมตี LIFE และใช้ใน Battle Phase: รอ)
  'BT10-004': { zone: 'hand', label: 'นำ "นินจา" 2 ใบกลับมือ แล้วอัญเชิญใบนี้', cond: (r, i, c) => !bt10NameUsed(r, i, B[c.id].n.trim()) && bt10Ninjas(r, i, B[c.id].n.trim()).length >= 2, run: (r, i, x) => bt10NinjaSwap(r, i, x, 2, null) },
});

Object.assign(AB, {
  // BT10-028 นายนิรยบาล ดาร์กช็อก — เทิร์นละครั้ง สั่งใช้ ถ้าเทิร์นนี้เราธรณีสูบ: เลือกการ์ดในนรกเรา (ไม่ใช่ Only) นำกลับเข้าใต้ Deck
  'BT10-028': { z: 'av', can: (r, i) => !!(r.g.m10 && r.g.m10[i] === r.g.n) && r.p[i].hell.some(c => !bt10Only(c)), steps: [], run: (r, i, cx) => {
    const p = r.p[i], L = p.hell.filter(c => !bt10Only(c)).map(c => c.u); bt10Say(cx.card, 'ความสามารถ', '#a855f7');
    ask(r, i, { text: 'นายนิรยบาล ดาร์กช็อก: เลือกการ์ดในนรก (ไม่ใช่ Only) 1 ใบ นำกลับเข้าใต้ Deck', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { p.deck.unshift(c); log(r, '♻ นำ ' + B[c.id].n + ' กลับเข้าใต้ Deck'); } } });
  } },
});

Object.assign(MG, {
  // BT10-059 ศิลาหยินหยาง — หงาย LIFE ใบบนสุดเรา 1 ใบ (ถ้าสาหัสไม่ต้องหงาย): อัญเชิญ "ตั๊กแตนหยิน" หรือ "ตั๊กแตนหยาง" จาก Deck แล้วสับ
  'BT10-059': { run: (r, i) => {
    const p = r.p[i]; if (!lifeUp(r, i)) log(r, 'สถานะสาหัส: ใช้ศิลาหยินหยางโดยไม่ต้องหงาย LIFE');
    ask(r, i, { text: 'ศิลาหยินหยาง: เลือกปฏิบัติ', choices: ['1) อัญเชิญ "ตั๊กแตนหยิน" 1 ใบจาก Deck', '2) อัญเชิญ "ตั๊กแตนหยาง" 1 ใบจาก Deck'], cb: k => {
      const nm = k === 0 ? 'ตั๊กแตนหยิน' : 'ตั๊กแตนหยาง', c = p.deck.find(h => isAv(h) && B[h.id].n.trim() === nm);
      if (!c) { log(r, 'ไม่พบ ' + nm + ' ใน Deck'); return shuf(p.deck); }
      if (summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ ' + nm, '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); }
      shuf(p.deck); } });
  } },
  // BT10-065 วิชานินจา รุกรับพลิกผัน (React) — ใช้ได้เมื่อ Avatar Zone เรามีแต่ "นินจา": เลือก "นินจา" 1 ใบ เลือกปฏิบัติ 1) เตะไข่ จนจบเทิร์น 2) เนรเทศ แล้วนำกลับลงสนามใน End Phase
  'BT10-065': { react: 1, steps: [{ key: 't', text: 'เลือก Avatar "นินจา" 1 ใบบน Avatar Zone เรา (ต้องมีแต่ "นินจา" ใน Avatar Zone)', opts: (r, i) => r.p[i].av.length && r.p[i].av.every(a => isAv(a) && nmOf(a).includes('นินจา')) ? r.p[i].av.map(a => a.u) : [] }], run: (r, i, cx) => {
    const t = find(r, cx.pick.t[0]); if (!t || t.z !== 'av') return;
    ask(r, i, { text: 'วิชานินจา รุกรับพลิกผัน: เลือกปฏิบัติ', choices: ['1) ' + nmOf(t.c) + ' ได้รับ เตะไข่ จนจบเทิร์น', '2) เนรเทศ ' + nmOf(t.c) + ' แล้วนำกลับลง Avatar Zone ใน End Phase'], cb: k => {
      if (k === 0) { t.c.kk = r.g.n; vfx(t.c.u, 'aura', 'เตะไข่', '#f97316'); return log(r, '🥷 ' + nmOf(t.c) + ' ได้รับ เตะไข่ จนจบเทิร์น'); }
      const f = find(r, t.c.u); if (!f || f.z !== 'av') return; const c = f.c, wr = c.wr || []; c.wr = [];
      fx({ k: 'exile', u: c.u, id: c.kd || c.id }); take(r, c.u); r.p[f.i].dk.push(c); wr.forEach(w => r.p[f.i].hell.push(w)); log(r, '🌀 เนรเทศ ' + nmOf(c) + ' (กลับลงสนามใน End Phase)');
      (r.g.b10e = r.g.b10e || []).push({ n: r.g.n, i: f.i, u: c.u });
    } });
  } },
});

// คำสั่งเสีย: เรียกจาก deathFx2 (ข้ามถ้าถูกยกเลิกความสามารถ)
function bt10Die(r, f) {
  const c = f.c; bt10Die2(r, f); bt10DieMg(r, f);
  if (c.id === 'BT10-017') r.g.q.push(() => {   // สิ่งปฏิกูลมีชีวิต
    const i = f.i, p = r.p[i], seen = bt4Peek(r, i, 3, null), mine = r.g.turn === i;
    const L = seen.filter(x => p.deck.includes(x) && isAv(x) && B[x.id].n.includes('สิ่งปฏิกูล')).map(x => x.u);
    const rest = got => { seen.filter(x => x !== got && p.deck.includes(x)).forEach(x => { p.deck.splice(p.deck.indexOf(x), 1); p.hell.push(x); }); log(r, '🗑 ส่งการ์ดที่เหลือจากที่สอดแนมลงนรก'); };
    if (!L.length) { rest(null); return log(r, 'คำสั่งเสีย สิ่งปฏิกูลมีชีวิต: ไม่พบ Avatar "สิ่งปฏิกูล"'); }
    ask(r, i, { text: 'คำสั่งเสีย: เลือก Avatar "สิ่งปฏิกูล" 1 ใบจากที่สอดแนม ' + (mine ? '(อัญเชิญลงสนามแทนการขึ้นมือ)' : 'ขึ้นมือ') + ' ที่เหลือส่งลงนรก', opts: L, cb: us => {
      const got = p.deck.find(x => x.u === us[0]); if (!got) return;
      if (mine && canPlaceAv(r, i, got) && summonAny(r, i, got.u, 'deck', c)) { vfx(got.u, 'burst', 'อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, got)); log(r, '✨ อัญเชิญ ' + B[got.id].n + ' ลง Avatar Zone แทน'); }
      else { const cc = fromZone(r, i, 'deck', got.u); cc && p.hand.push(cc); log(r, '✨ นำ ' + B[got.id].n + ' ขึ้นมือ'); }
      rest(got); } });
  });
  if (c.id === 'BT10-018') r.g.q.push(() => {   // สิ่งปฏิกูลสีเงิน
    const i = f.i, T = r.p[1 - i].av.filter(a => !protectedFrom(r, i, a)).map(a => a.u), n = r.g.turn === i ? 3 : 1;
    if (!T.length) return log(r, 'คำสั่งเสีย สิ่งปฏิกูลสีเงิน: ฝ่ายตรงข้ามไม่มี Avatar');
    ask(r, i, { text: 'คำสั่งเสีย: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ POWER -' + n + ' (จนจบเทิร์น)', opts: T, cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, -n); vfx(t.c.u, 'aura', 'POWER -' + n, '#ef4444'); log(r, '🔻 ' + nmOf(t.c) + ' POWER -' + n); } } });
  });
}
// ประกาศโจมตี (ทุกใบ): 024 กระบือชาวร๊อค + 022 เดออง
function bt10AtkAny0(r, i, a, tg, tk) {
  r.p[i].av.forEach(x => { if (x.id === 'BT10-024' && x.u !== a.u && !noFx(r, x)) { addTp(a, 1); vfx(x.u, 'aura', 'POWER +1 ให้ ' + nmOf(a), '#facc15'); log(r, '✨ ฯลฯ กระบือชาวร๊อค: ' + nmOf(a) + ' POWER +1 จนจบเทิร์น'); } });
  const b49 = x => { if (x.id === 'BT10-049' && !noFx(r, x) && x.ou10 !== r.g.n) { x.ou10 = r.g.n; x.bp = (x.bp || 0) + 2; vfx(x.u, 'aura', 'POWER +2', '#facc15'); log(r, '✨ ม้าเฉียว: POWER +2 จนจบการต่อสู้'); } }; b49(a);
  if (tk === 'av') { const t49 = find(r, tg); t49 && t49.z === 'av' && b49(t49.c); }
  if (tk === 'av') { const t = find(r, tg); if (t && t.z === 'av' && t.c.id === 'BT10-022' && !noFx(r, t.c)) { addTp(a, -2); vfx(t.c.u, 'aura', 'ผู้โจมตี POWER -2', '#ef4444'); log(r, '🛡 เดออง: ' + nmOf(a) + ' POWER -2'); } }
}
// ช่วง End Phase: นำ Avatar ที่เนรเทศ (065) กลับลงสนาม
function bt10End(r) {
  const g = r.g, ender = 1 - g.turn;
  // BT10-049 ม้าเฉียว: End Phase เรา ถ้าไม่มี Avatar "ขุนพล" สีเขียว {ต่างชาติ} ใบอื่น นำกลับขึ้นมือเจ้าของ
  r.p[ender] && r.p[ender].av.filter(a => a.id === 'BT10-049' && !noFx(r, a)).forEach(a => { if (!r.p[ender].av.some(b => b.u !== a.u && isAv(b) && B[b.id].n.includes('ขุนพล') && B[b.id].col === 'เขียว' && symOf(b) === 'ต่างชาติ')) { bounce(r, a.u); log(r, '↩ ม้าเฉียว: ไม่มีขุนพลสีเขียวใบอื่น กลับขึ้นมือ'); } });
  if (!g.b10e || !g.b10e.length) return; const keep = [];
  g.b10e.forEach(e => { if (e.n > g.n) return keep.push(e); if (e.fn) return e.fn(); const p = r.p[e.i], k = p.dk.findIndex(c => c.u === e.u); if (k < 0) return; const c = p.dk[k];
    if (!canPlaceAv(r, e.i, c)) return; p.dk.splice(k, 1); c.tired = false; c.pw = 0; c.tp = 0; c.bp = 0; p.av.push(c); vfx(c.u, 'burst', 'กลับลงสนาม', '#8b5cf6'); log(r, '🌀 ' + nmOf(c) + ' กลับจากมิติมืด ลง Avatar Zone'); });
  g.b10e = keep;
}
/* ===== จบบล็อก BT10 รอบที่ 2 ===== */

/* =====================================================================
   ===== BT10 รอบที่ 3 — ใช้เฉพาะกลไกที่มีอยู่แล้ว (ส่วนที่ต้องมีกลไกใหม่ข้ามไว้ รอสรุป) =====
   การ์ด: 011 012 013 016 019(สั่งใช้) 026(จุติ+ตามคาถา) 027(ไม่รวม Link) 030 032 036 038(ระดับ 4 ชื่อ) 047 048(คำสั่งเสีย)
          049 053 054(ไม่รวมใช้ Magic เพิ่ม) 055 056 058 063 071 073(POWER/โล่มนุษย์) 074(ลูกฮึด) 075
   hook เพิ่ม: noteSum->bt10Note  สามัคคี->bt10Sup  cast Magic->bt10Cast  handCost(013)  noFx(030)  P/hasKw (073,074)
   ===================================================================== */
const bt10Sums = (r, i) => { const s = r.g.b10s; return s && s.n === r.g.n ? s.l[i] : []; };
function bt10Note(r, i, c) { const g = r.g; if (!g.b10s || g.b10s.n !== g.n) g.b10s = { n: g.n, l: [[], []] }; c && c.id && g.b10s.l[i].push(c.id); }
const bt10Co = (r, i, id) => r.p[i].co.some(c => c.id === id);
const bt10Mage = (r, i) => r.p[i].av.filter(a => isAv(a) && nmOf(a).includes('จอมเวทย์'));
const bt10Kaatha = c => !c.tk && B[c.id] && B[c.id].t === 'Magic' && B[c.id].n.includes('คาถา');
const bt10Unp = (r, i, a) => !protectedFrom(r, i, a);

// เมื่อมีการใช้ Magic (ทุกประเภท) : 036 จั่ว / 026 ตามคาถา
function bt10Cast(r, i, c) {
  (r.g.b10d || []).forEach(e => { if (e.until >= r.g.n && c.st === e.kind) { draw(r, r.p[e.i], 1); vfx((r.p[e.i].av.find(a => a.id === 'BT10-036') || {}).u, 'aura', 'จั่ว 1', '#facc15'); log(r, '✨ เนโกะเมะ ยูริ: ' + r.p[e.i].name + ' จั่ว 1 ใบ (มีการใช้ ' + c.st + ')'); } });
  if (c.n.includes('คาถา') && c.t === 'Magic') r.p.forEach((q, j) => q.av.forEach(x => { if (x.id === 'BT10-026' && !noFx(r, x)) r.g.q.push(() => { const L = bt10Mage(r, j).map(a => a.u); if (!L.length) return;
    ask(r, j, { text: 'จอมเวทย์ เดสสึหวา: มีการใช้ Magic "คาถา" เลือก Avatar "จอมเวทย์" 1 ใบ POWER +1', opts: L, cb: us => { const t = find(r, us[0]); if (t) { addTp(t.c, 1); vfx(t.c.u, 'aura', 'POWER +1', '#38bdf8'); } } }); }); }));
}
// เมื่อ Avatar ได้รับ สามัคคี (ในการโจมตี) จาก q : 013 / 047 (โดยพี่ซี๊ด แก๊งขยะ)
function bt10Sup(r, i, q, recv, bs) {
  if (bs || !B[q.id].n.includes('พี่ซี๊ด แก๊งขยะ')) return;
  if (recv.id === 'BT10-047' && !noFx(r, recv)) { recv.tired = false; vfx(recv.u, 'aura', 'ตื่น', '#22c55e'); log(r, '✨ เบรกเกต แก๊งขยะ: เปลี่ยนเป็นสภาพตื่น'); }
  if (recv.id === 'BT10-013' && !noFx(r, recv)) r.g.q.push(() => {
    const p = r.p[i], pick = k => { const L = p.hell.filter(c => isAv(c) && B[c.id].n.includes('แก๊งขยะ') && B[c.id].n.trim() !== B[recv.id].n.trim() && !(k.names || []).includes(B[c.id].n.trim())).map(c => c.u);
      if (!L.length || k.n >= 2) return;
      ask(r, i, { text: 'พี่เจมส์: อัญเชิญ Avatar "แก๊งขยะ" ชื่อต่างกัน จากนรก (' + (k.n + 1) + '/2' + (k.n === 0 ? ' อย่างน้อย 1' : '') + ')', opts: L, cancel: k.n > 0, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'hell')) { r.g.q.unshift(() => fxSummon(r, i, c)); pick({ n: k.n + 1, names: [...(k.names || []), B[c.id].n.trim()] }); } } }); };
    pick({ n: 0 });
  });
}

Object.assign(SUM, {
  // BT10-011 ซุนฮูหยิน — จุติ: สอดแนม 5 เลือก Avatar "ขุนพล" {ต่างชาติ} สีเดียวกับใบนี้ ขึ้นมือ ที่เหลือกลับ Deck แล้วสับ
  'BT10-011': (r, i, x) => { const p = r.p[i], seen = bt4Peek(r, i, 5, x), L = seen.filter(c => isAv(c) && B[c.id].n.includes('ขุนพล') && symOf(c) === 'ต่างชาติ' && B[c.id].col === B[x.id].col).map(c => c.u);
    if (!L.length) { log(r, 'จุติ ซุนฮูหยิน: ไม่พบ Avatar "ขุนพล" {ต่างชาติ} สีเดียวกัน'); return shuf(p.deck); }
    ask(r, i, { text: 'จุติ: เลือก Avatar "ขุนพล" {ต่างชาติ} สีเดียวกันกับใบนี้ 1 ใบ ขึ้นมือ (ที่เหลือกลับ Deck แล้วสับ)', opts: L, cancel: true, cb: us => { const c = fromZone(r, i, 'deck', us[0]); c && p.hand.push(c); shuf(p.deck); log(r, '✨ นำ ' + (c ? B[c.id].n : '-') + ' ขึ้นมือ'); }, onCancel: () => shuf(p.deck) }); },
  // BT10-013 พี่เจมส์ — จุติ: นำ "พี่บูม แก๊งขยะ" จาก Deck ขึ้นมือ สับ Deck เทิร์นนี้ Cost พี่บูมบนมือ -1
  'BT10-013': (r, i) => { tutor(r, i, c => !c.tk && B[c.id].n.includes('พี่บูม แก๊งขยะ'), 'พี่บูม แก๊งขยะ'); (r.g.b10c = r.g.b10c || {})[i] = r.g.n; },
  // BT10-026 จอมเวทย์ เดสสึหวา — จุติ ทิ้ง "คาถา"/Avatar "จอมเวทย์" 1 ใบจากมือ: จั่ว 2
  'BT10-026': (r, i) => { const p = r.p[i], L = p.hand.filter(c => bt10Kaatha(c) || (isAv(c) && B[c.id].n.includes('จอมเวทย์'))).map(c => c.u); if (!L.length) return;
    ask(r, i, { text: 'จุติ: ทิ้ง "คาถา" หรือ Avatar "จอมเวทย์" 1 ใบจากมือ เพื่อจั่ว 2 ใบ (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => { sendHell(r, us[0]); draw(r, p, 2); log(r, '✨ จั่ว 2 ใบ'); } }); },
  // BT10-027 นายนิรยบาล นิมมา — จุติ: ธรณีสูบ 2 ใบ จั่ว 1 ใบ (ส่วน [Link] รอ)
  'BT10-027': (r, i) => { mill(r, i, 2); draw(r, r.p[i], 1); log(r, '✨ ธรณีสูบ 2 ใบ แล้วจั่ว 1 ใบ'); },
});

Object.assign(BT4A, {
  // BT10-012 บ่าวแสม — เทิร์นละครั้ง เมื่อโจมตี: เนรเทศบนสุดของ Deck เรา 1 ใบ แล้วเลือกผลตามจำนวนการ์ดในมิติมืดเรา
  'BT10-012': (r, i, a) => { if (a.ou === r.g.n) return; const p = r.p[i]; if (!p.deck.length) return; a.ou = r.g.n; const c = p.deck.pop(); p.dk.push(c); fx({ k: 'exile', u: c.u, id: c.id }); log(r, '🌀 เนรเทศ ' + B[c.id].n + ' (มิติมืด ' + p.dk.length + ' ใบ)');
    const n = p.dk.length, opt = [['POWER +1', 1, () => { addTp(a, 1); vfx(a.u, 'aura', 'POWER +1', '#facc15'); }], ['เปลี่ยนเป็นสภาพตื่น', 2, () => { a.tired = false; vfx(a.u, 'aura', 'ตื่น', '#22c55e'); }], ['สุ่มทิ้งการ์ดบนมือฝ่ายตรงข้าม 1 ใบ', 3, () => { const h = r.p[1 - i].hand; if (h.length) sendHell(r, rnd(h).u); }]].filter(o => n >= o[1]);
    if (!opt.length) return; ask(r, i, { text: 'บ่าวแสม: เลือกผล 1 อย่าง (มิติมืด ' + n + ' ใบ)', choices: opt.map((o, k) => (k + 1) + ') ' + o[0]), cb: k => opt[k][2]() }); },
  // BT10-027 — เทิร์นละครั้ง เมื่อโจมตี ธรณีสูบ 1 ใบ: POWER +1 ตามจำนวน Avatar {นรก} บน Avatar Zone เรา จนจบเทิร์น (ส่วน [Link] รอ)
  'BT10-027': (r, i, a) => { if (a.ou === r.g.n || !linked9(r, a)) return; ask(r, i, { yn: true, text: 'นายนิรยบาล นิมมา: ธรณีสูบ 1 ใบ เพื่อ POWER +1 ตามจำนวน Avatar {นรก} บน Avatar Zone เรา ไหม?', cb: y => { if (!y) return; a.ou = r.g.n; mill(r, i, 1); const n = r.p[i].av.filter(x => symOf(x) === 'นรก').length; addTp(a, n); vfx(a.u, 'aura', 'POWER +' + n, '#a855f7'); log(r, '🔥 นิมมา POWER +' + n); } }); },
  // BT10-038 ผู้ขุดหาความว่างเปล่า แบงค์ Miner — ถ้านรกเรามี Avatar "แบงค์" ชื่อต่างกัน ≥4: เมื่อโจมตี เนรเทศบนสุดของ Deck ฝ่ายตรงข้าม 2 ใบ (ส่วน 8 ชื่อ รอ)
  'BT10-038': (r, i, a) => { const names = new Set(r.p[i].hell.filter(c => isAv(c) && B[c.id].n.includes('แบงค์')).map(c => B[c.id].n.trim())); if (names.size < 4) return; const O = r.p[1 - i];
    for (let k = 0; k < 2 && O.deck.length; k++) { const c = O.deck.pop(); O.dk.push(c); fx({ k: 'exile', u: c.u, id: c.id }); log(r, '🌀 เนรเทศ ' + B[c.id].n + ' จาก Deck ฝ่ายตรงข้าม'); } },
});

Object.assign(AB, {
  // BT10-019 ราชาสิ่งปฏิกูล — เทิร์นละครั้ง สั่งใช้: ทำลาย "สิ่งปฏิกูล" 1 ใบบน Avatar Zone ผู้เล่นใดก็ได้ ถ้าสำเร็จ สุ่มทิ้งมือฝ่ายตรงข้าม 1 ใบ
  'BT10-019': { z: 'av', can: (r, i) => r.p.some((q, j) => q.av.some(a => nmOf(a).includes('สิ่งปฏิกูล') && bt10Unp(r, i, a))), steps: [{ key: 't', text: 'เลือก "สิ่งปฏิกูล" 1 ใบบน Avatar Zone ผู้เล่นใดก็ได้', opts: (r, i) => allAv(r).filter(a => nmOf(a.x).includes('สิ่งปฏิกูล') && bt10Unp(r, i, a.x)).map(a => a.x.u) }], run: (r, i, cx) => {
    const u = cx.pick.t[0]; destroyAv(r, u); const f = find(r, u); if (f && f.z === 'av') return log(r, 'ทำลายไม่สำเร็จ');
    const h = r.p[1 - i].hand; if (h.length) { const c = rnd(h); sendHell(r, c.u); log(r, '🎲 สุ่มทิ้งการ์ดบนมือฝ่ายตรงข้าม 1 ใบ'); } } },
  // BT10-030 ยอดมนุษย์หัวยางลบ — พอดี เทิร์นละครั้ง สั่งใช้: Avatar ฝ่ายตรงข้าม 1 ใบ สูญเสียความสามารถ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม
  'BT10-030': { z: 'av', can: (r, i, c) => !!c.jt, steps: [{ key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ สูญเสียความสามารถทั้งหมดจนจบเทิร์นถัดไปของฝ่ายตรงข้าม', opts: (r, i) => foeAvT(r, i) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t) { t.c.nfr = [r.g.n, r.g.n + 1]; vfx(t.c.u, 'aura', 'สูญเสียความสามารถ', '#64748b'); log(r, '🚫 ' + nmOf(t.c) + ' สูญเสียความสามารถทั้งหมดจนจบเทิร์นถัดไปของฝ่ายตรงข้าม'); } } },
  // BT10-036 เนโกะเมะ ยูริ — เทิร์นละครั้ง สั่งใช้: จนจบเทิร์นถัดไปของฝ่ายตรงข้าม ทุกครั้งที่มีการใช้ {land} หรือ {mod} จั่ว 1
  'BT10-036': { z: 'av', can: () => true, steps: [], run: (r, i, cx) => ask(r, i, { text: 'เนโกะเมะ ยูริ: เลือกปฏิบัติ', choices: ['1) ทุกครั้งที่มีการใช้ {land} จั่ว 1 ใบ', '2) ทุกครั้งที่มีการใช้ {mod} จั่ว 1 ใบ'], cb: k => { (r.g.b10d = r.g.b10d || []).push({ i, kind: k === 0 ? 'Land' : 'Modification', until: r.g.n + 1 }); bt10Say(cx.card, k === 0 ? 'Land → จั่ว' : 'Mod → จั่ว', '#facc15'); log(r, '👁 จนจบเทิร์นถัดไปของฝ่ายตรงข้าม ทุกครั้งที่มีการใช้ ' + (k === 0 ? '{land}' : '{mod}') + ' จั่ว 1 ใบ'); } }) },
});

Object.assign(ABIL, {
  // BT10-016 สั่งใช้ จากบนมือ ถ้าเทิร์นนี้อัญเชิญ Avatar {เอเลี่ยน} สีฟ้า Cost ≥5: อัญเชิญใบนี้ (1 ครั้ง/เทิร์น)
  'BT10-016': { zone: 'hand', label: 'อัญเชิญใบนี้ (เทิร์นนี้อัญเชิญเอเลี่ยนสีฟ้า Cost ≥5)', cond: (r, i, c) => !bt10NameUsed(r, i, B[c.id].n.trim()) && canPlaceAv(r, i, c) && bt10Sums(r, i).some(id => B[id].s === 'เอเลี่ยน' && B[id].col === 'ฟ้า' && B[id].c >= 5), run: (r, i, x) => {
    bt10Mark(r, i, B[x.id].n.trim()); if (summonAny(r, i, x.u, 'hand')) { vfx(x.u, 'burst', 'อัญเชิญ', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, x)); } } },
  // BT10-032 พี่ซี๊ด แก๊งขยะ — เทิร์นละครั้ง สั่งใช้ จากนรก ถ้าเทิร์นนี้อัญเชิญ "แก๊งขยะ" และไม่มี "พี่ซี๊ด" บนสนาม ทิ้งมือ 1: อัญเชิญใบนี้
  'BT10-032': { zone: 'hell', label: 'ทิ้งมือ 1 ใบ อัญเชิญใบนี้จากนรก', cond: (r, i, c) => !bt10NameUsed(r, i, 'พี่ซี๊ด-hell') && r.p[i].hand.length > 0 && canPlaceAv(r, i, c) && bt10Sums(r, i).some(id => B[id].n.includes('แก๊งขยะ')) && !r.p[i].av.some(a => nmOf(a).includes('พี่ซี๊ด แก๊งขยะ')), run: (r, i, x) =>
    ask(r, i, { text: 'พี่ซี๊ด: ทิ้งการ์ดบนมือ 1 ใบ เพื่ออัญเชิญใบนี้จากนรก (ยกเลิก = ไม่ใช้)', opts: bt10Hand(r, i), cancel: true, cb: us => { bt10Mark(r, i, 'พี่ซี๊ด-hell'); sendHell(r, us[0]); if (summonAny(r, i, x.u, 'hell')) { vfx(x.u, 'burst', 'อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, x)); } } }) },
});
// ใช้สถานะ "สั่งใช้" ของ Land (071)
Object.assign(AB, {
  // BT10-071 Myth Universe Podcast (Land) — เทิร์นละครั้ง สั่งใช้ แสดง Avatar บนมือ 1: เลือกข้อมูล แล้ว Avatar ที่มีข้อมูลเดียวกัน (≤2) POWER +2 จนจบเทิร์น จากนั้นเนรเทศการ์ดที่แสดง
  'BT10-071': { z: 'land', steps: [{ key: 's', text: 'แสดง Avatar บนมือ 1 ใบ', opts: (r, i) => r.p[i].hand.filter(c => isAv(c)).map(c => c.u) }], run: (r, i, cx) => {
    const p = r.p[i], sh = p.hand.find(c => c.u === cx.pick.s[0]); if (!sh) return; const b = B[sh.id]; log(r, '🎙 ' + p.name + ' แสดง ' + b.n);
    const ATT = [['POWER', x => (B[x.id].p || 0) + ''], ['Symbol', x => symOf(x) + ''], ['ค่า Cost', x => (B[x.id].c || 0) + ''], ['จำนวน GEM', x => (B[x.id].g || 0) + ''], ['สี', x => (B[x.id].col || '') + '']];
    const av = ATT.map(a => ({ n: a[0], f: a[1], m: p.av.filter(x => isAv(x) && a[1](x) === a[1](sh)) })).filter(a => a.m.length);
    const fin = () => { const c = fromZone(r, i, 'hand', sh.u); if (c) { p.dk.push(c); log(r, '🌀 เนรเทศ ' + B[c.id].n); } };
    if (!av.length) { log(r, 'ไม่มี Avatar บนสนามที่มีข้อมูลเดียวกัน'); return fin(); }
    ask(r, i, { text: 'Myth Universe Podcast: เลือกข้อมูล 1 อย่างจาก ' + b.n, choices: av.map((a, k) => (k + 1) + ') ' + a.n), cb: k => { const a = av[k];
      ask(r, i, { text: 'เลือก Avatar บนสนามเรา (สูงสุด 2 ใบ อย่างน้อย 1) ที่มี ' + a.n + ' เดียวกัน POWER +2 จนจบเทิร์น', opts: a.m.map(x => x.u), n: 2, min: 1, cb: us => { us.forEach(u => { const t = find(r, u); if (t) { addTp(t.c, 2); vfx(t.c.u, 'aura', 'POWER +2', '#facc15'); } }); fin(); } }); } });
  } },
});

Object.assign(MG, {
  // BT10-053 การเลือกสรรของ พระพิฆเนศ — ต้องมี "พระพิฆเนศ" บนสนามเรา: อัญเชิญ Avatar {เทพ} Cost ≤4 ไม่ใช่ Only จากนรกเรา
  'BT10-053': { steps: [{ key: 't', text: 'ต้องมี Avatar "พระพิฆเนศ" บนสนามเรา — เลือก Avatar {เทพ} Cost ≤4 (ไม่ใช่ Only) จากนรกเรา', opts: (r, i) => r.p[i].av.some(a => nmOf(a).includes('พระพิฆเนศ')) ? r.p[i].hell.filter(c => isAv(c) && symOf(c) === 'เทพ' && B[c.id].c <= 4 && !bt10Only(c)).map(c => c.u) : [] }], run: (r, i, cx) => {
    const c = r.p[i].hell.find(h => h.u === cx.pick.t[0]); if (c && summonAny(r, i, c.u, 'hell')) { vfx(c.u, 'burst', 'อัญเชิญจากนรก', '#facc15'); r.g.q.unshift(() => fxSummon(r, i, c)); } } },
  // BT10-054 เหนือฟ้าใต้หล้า — ทิ้งมือ 1: เลือก "คาถา" จาก Deck ขึ้นมือ สับ Deck (ส่วนใช้ Magic เพิ่มอีก 1 ใบ รอ)
  'BT10-054': { steps: [oneHand(1, 'ทิ้งการ์ดบนมือ 1 ใบ')], run: (r, i) => tutor(r, i, c => bt10Kaatha(c), 'คาถา') },
  // BT10-055 คาถา เฟรนลี่คัม — ต้องมี "จอมเวทย์" บนสนาม: สอดแนม 5 อัญเชิญ จุติ Avatar "จอมเวทย์" 1 ใบ ที่เหลือเรียงใต้ Deck
  'BT10-055': { steps: [{ key: 'm', text: 'ต้องมี Avatar "จอมเวทย์" บนสนามเรา (เลือก 1 ใบเป็นเงื่อนไข)', opts: (r, i) => bt10Mage(r, i).map(a => a.u) }], run: (r, i) => {
    const p = r.p[i], seen = bt4Peek(r, i, 5, null), L = seen.filter(c => isAv(c) && B[c.id].n.includes('จอมเวทย์')).map(c => c.u), fin = got => bt10Bottom(r, i, seen.filter(c => c !== got));
    if (!L.length) { log(r, 'ไม่พบ Avatar "จอมเวทย์"'); return fin(null); }
    ask(r, i, { text: 'เลือก Avatar "จอมเวทย์" 1 ใบจากที่สอดแนม อัญเชิญลงสนาม (จุติทำงาน)', opts: L, cb: us => { const c = p.deck.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'deck')) { vfx(c.u, 'burst', 'อัญเชิญ', '#8b5cf6'); r.g.q.unshift(() => fxSummon(r, i, c)); } fin(c); } }); } },
  // BT10-056 ชีวิตที่พอดี — ทิ้งมือ 2 ใบ เลือก Avatar ที่มี พอดี จุติ: ทำจุติของใบนั้นอีกครั้ง
  'BT10-056': { steps: [oneHand(2, 'ทิ้งการ์ดบนมือ 2 ใบ'), { key: 't', text: 'เลือก Avatar ของเราที่มี พอดี จุติ', opts: (r, i) => r.p[i].av.filter(a => /พอดี/.test(B[a.id].e || '') && /จุติ|จุตี/.test(B[a.id].e || '') && SUM[a.id]).map(a => a.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (t && SUM[t.c.id]) { log(r, '🔁 ทำความสามารถ จุติ ของ ' + nmOf(t.c) + ' อีกครั้ง'); SUM[t.c.id](r, i, t.c); } } },
  // BT10-058 พายุหิมะเริงระบำ — ต้องมี "ราชินีหิมะ" บนสนาม และ "ทหารหิมะ" ≥8 ใบในนรก: อัญเชิญ "ทหารหิมะ" Cost รวม ≤6 จาก Deck; End Phase ส่งลงนรก แล้วอัญเชิญ "ราชาหิมะ" ได้
  'BT10-058': { steps: [{ key: 'q', text: 'ต้องมี "ราชินีหิมะ" บนสนาม และ "ทหารหิมะ" ≥8 ใบในนรกเรา', opts: (r, i) => r.p[i].hell.filter(c => isAv(c) && B[c.id].n.includes('ทหารหิมะ')).length >= 8 ? r.p[i].av.filter(a => nmOf(a).includes('ราชินีหิมะ')).map(a => a.u) : [] }], run: (r, i) => {
    const p = r.p[i], got = []; let left = 6;
    const step = () => { const L = p.deck.filter(c => isAv(c) && B[c.id].n.includes('ทหารหิมะ') && B[c.id].c <= left).map(c => c.u);
      if (!L.length || !canPlaceAv(r, i, p.deck.find(c => c.u === L[0]))) return fin();
      ask(r, i, { text: 'พายุหิมะ: อัญเชิญ "ทหารหิมะ" จาก Deck (Cost เหลือ ' + left + ') — ยกเลิก = หยุด', opts: L, cancel: true, cb: us => { const c = p.deck.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'deck')) { left -= B[c.id].c; got.push(c.u); r.g.q.unshift(() => fxSummon(r, i, c)); vfx(c.u, 'burst', 'อัญเชิญ', '#38bdf8'); } step(); }, onCancel: fin }); };
    const fin = () => { shuf(p.deck); if (!got.length) return;
      (r.g.b10e = r.g.b10e || []).push({ n: r.g.n, i, fn: () => { got.forEach(u => { const f = find(r, u); f && f.z === 'av' && sendHell(r, u); }); log(r, '❄ พายุหิมะ: ส่งทหารหิมะที่อัญเชิญมาลงนรก');
        r.g.q.push(() => { const k = p.deck.find(c => isAv(c) && B[c.id].n.includes('ราชาหิมะ')); if (!k || !canPlaceAv(r, i, k)) return; ask(r, i, { text: 'อัญเชิญ "ราชาหิมะ" 1 ใบจาก Deck ไหม?', opts: [k.u], cancel: true, cb: us => { if (summonAny(r, i, us[0], 'deck')) { r.g.q.unshift(() => fxSummon(r, i, k)); shuf(p.deck); } } }); }); } }); };
    step(); } },
  // BT10-063 ไปคุยกับรากมะม่วง (React) — ทำลาย Avatar "มะม่วง" {ต้นไม้} ของเรา 1 ใบ: ทำลายการ์ด 1 ใบบนสนามฝ่ายตรงข้าม
  'BT10-063': { react: 1, steps: [{ key: 's', text: 'เลือก Avatar "มะม่วง" {ต้นไม้} ของเรา 1 ใบ ทำลายเป็น Cost', opts: (r, i) => r.p[i].av.filter(a => nmOf(a).includes('มะม่วง') && symOf(a) === 'ต้นไม้').map(a => a.u) }, { key: 't', text: 'เลือกการ์ด 1 ใบบนสนามฝ่ายตรงข้ามเพื่อทำลาย', opts: (r, i) => [...r.p[1 - i].av.filter(a => bt10Unp(r, i, a)), ...r.p[1 - i].co, ...r.p[1 - i].mg].map(x => x.u) }], run: (r, i, cx) => { destroyAny(r, cx.pick.s[0]); destroyAny(r, cx.pick.t[0]); vfx(cx.pick.t[0], 'burst', 'ทำลาย', '#ef4444'); } },
});
LIFEX['BT10-075'] = { z: 'hand', max: 4, col: 'ม่วง' };   // 075 ไม่นะ เตียวเสียน! (LIFE): อัญเชิญ Avatar สีม่วง Cost ≤4 จากมือ

// คำสั่งเสียเพิ่ม: 048 เซนเซไฮ (ทิ้งมือ 3 ใบ/ทั้งหมด หรือ หงาย LIFE ใบบนสุดของเรา)
const bt10Die2 = (r, f) => { const c = f.c; if (c.id !== 'BT10-048') return; r.g.q.push(() => { const i = f.i, p = r.p[i];
  ask(r, i, { text: 'คำสั่งเสีย เซนเซไฮ: เลือกปฏิบัติ', choices: ['1) ทิ้งการ์ดบนมือ 3 ใบ (ถ้ามีน้อยกว่าทิ้งทั้งหมด)', '2) หงาย LIFE Card ใบบนสุดของเรา 1 ใบ'], cb: k => {
    if (k === 1) return void (lifeUp(r, i) || log(r, 'ไม่มี LIFE ให้หงาย'));
    const n = Math.min(3, p.hand.length); if (!n) return; ask(r, i, { text: 'เลือกการ์ดบนมือ ' + n + ' ใบ ทิ้ง', opts: bt10Hand(r, i), n, min: n, cb: us => us.forEach(u => sendHell(r, u)) }); } }); }); };
/* ===== จบบล็อก BT10 รอบที่ 3 ===== */


/* =====================================================================
   ===== BT10 รอบสมบูรณ์ — Link/คู่หู, Avatar บน Magic Zone (มะม่วง), Modification, Construct, ใช้ Magic เพิ่ม ฯลฯ =====
   ===================================================================== */
const PART10 = { 'BT10-014': 'วอเตอร์แมน' };   // คู่หู ที่ข้อความการ์ดไม่มีวงเล็บ [ ]
const isTree10 = c => !!c && !c.tk && isAv(c) && nm9(c).includes('มะม่วง') && symOf(c) === 'ต้นไม้';
const isMTree10 = c => isTree10(c) && nm9(c).includes('ต้นมะม่วง');
const trees10 = (r, i) => r.p[i].mg.filter(m => m.mgAv && isTree10(m));
const mTrees10 = (r, i) => r.p[i].mg.filter(m => m.mgAv && isMTree10(m));
const banks10 = (r, i) => new Set(r.p[i].hell.filter(c => !c.tk && isAv(c) && B[c.id].n.includes('แบงค์')).map(c => nm9(c))).size;
const valh10 = c => !!c && !c.tk && isAv(c) && B[c.id].n.includes('เทพธิดาแห่งวัลฮัลลา');
function placeMg10(r, i, c, from, owner) {   // นำ Avatar จากโซน from ของผู้เล่น owner ไปไว้ Magic Zone ของ i
  const q = r.p[owner], k = q[from].indexOf(c); if (k < 0) return false; q[from].splice(k, 1);
  Object.assign(c, { pw: 0, tp: 0, bp: 0, tired: false, mgAv: 1, mgOwner: owner }); r.p[i].mg.push(c);
  fx({ k: 'say', id: c.kd || c.id, t: 'ไป Magic Zone' }); vfx(c.u, 'aura', '🥭 Magic Zone', '#22c55e'); log(r, '🥭 ' + nmOf(c) + ' ไปอยู่บน Magic Zone ของ ' + r.p[i].name); return true;
}
const mgSrc10 = r => !!((r.g.curMg && r.g.curMg.card && B[r.g.curMg.card.id].n.includes('มะม่วง')) || (typeof HAND_SRC !== 'undefined' && HAND_SRC && !HAND_SRC.tk && B[HAND_SRC.id] && B[HAND_SRC.id].n.includes('มะม่วง')));

// ผูกแหล่งที่มาของการอัญเชิญ (ถูกอัญเชิญด้วยความสามารถของการ์ดอื่น)
function bt10Src(c, src) {
  if (!src || c.tk || !B[src.id]) return; const n = B[src.id].n || '';
  if (c.id === 'BT10-015' && (n.includes('หนังมนุษย์ ชุดแก้แค้น') || n.includes('ริกกี้'))) c.rk15 = 1;
  if (c.id === 'BT10-020' && n.includes('ขุนพล') && (B[src.id].s === 'ต่างชาติ' || also9(src, 'ต่างชาติ'))) c.s20 = 1;
  if (c.id === 'BT10-019' && n.includes('สิ่งปฏิกูล')) c.fz10 = 1;
}
// เข้าสู่สถานะ Link / คู่หู
function bt10Link(r, i, x) {
  const p = r.p[i];
  if (x.id === 'BT10-025') r.g.q.push(() => {   // จอมเวทย์ โกลเด้น: ก่อสร้าง Construct "จอมเวทย์" จาก Deck หรือ นรก
    const okC = c => !c.tk && B[c.id].t === 'Construct' && B[c.id].n.includes('จอมเวทย์') && !p.co.some(k => B[k.id].n === B[c.id].n);
    if (p.co.length >= 3) return log(r, 'โกลเด้น: Construct เต็ม 3 ก่อสร้างไม่ได้');
    const D = p.deck.filter(okC).map(c => c.u), H = p.hell.filter(okC).map(c => c.u); if (!D.length && !H.length) return log(r, 'โกลเด้น: ไม่พบ Construct "จอมเวทย์" ใน Deck/นรก');
    ask(r, i, { text: 'จอมเวทย์ โกลเด้น: เลือก Construct "จอมเวทย์" 1 ใบจาก Deck หรือ นรก ก่อสร้าง', opts: [...D, ...H], cb: us => { const inD = p.deck.some(c => c.u === us[0]), c = (inD ? p.deck : p.hell).find(h => h.u === us[0]); if (c && buildFree(r, i, c, inD ? 'deck' : 'hell')) { vfx(c.u, 'burst', 'ก่อสร้าง', '#8b5cf6'); if (inD) shuf(p.deck); } } });
  });
  if (x.id === 'BT10-014') r.g.q.push(() => {   // ลิขวิดบอย: ทำจุติของ วอเตอร์แมน ที่เป็นคู่หู อีกครั้ง
    const w = p.av.find(y => y !== x && hasN9(y, 'วอเตอร์แมน')); if (!w) return;
    vfx(w.u, 'burst', '🔁 จุติอีกครั้ง', '#38bdf8'); log(r, '🔁 ลิขวิดบอย (คู่หู): ทำ จุติ ของ ' + nmOf(w) + ' อีกครั้ง'); fxSummon(r, i, w);
  });
}
// เป้าหมายการโจมตีที่เลือกไม่ได้ (020, 026 Link, 045)
function bt10AtkBlock(r, atk, tgt) {
  const f = find(r, tgt.u); if (!f || f.z !== 'av') return false; const side = r.p[f.i];
  if (nmOf(tgt).includes('วุยก๊ก') && tgt.id !== 'BT10-020' && side.av.some(a => a.id === 'BT10-020' && !noFx(r, a))) return true;
  if (tgt.id !== 'BT10-026' && side.av.some(a => a.id === 'BT10-026' && linked9(r, a))) return true;
  if (tgt.id === 'BT10-045' && side.av.some(a => nmOf(a).includes('ตำรวจ'))) return true;
  return false;
}
// เป็นเป้าความสามารถ/Magic ไม่ได้ (038 8 ชื่อ, 070 ดินแดนยุติธรรม)
const bt10Prot = (r, who, x, mg) => {
  if (who === undefined || !x || x.tk) return false; const oi = r.p.findIndex(q => q.av.includes(x)); if (oi < 0 || oi === who) return false;
  if (mg && (x.id === 'BT10-038' || (x.id === 'BT08-023' && x.gain8 === 'BT10-038')) && !noFx(r, x) && banks10(r, oi) >= 8) return true;
  if (r.g.land && r.g.land.c.id === 'BT10-070' && r.g.land.o === oi && (nmOf(x).includes('เพมมุ') || (B[x.id].e || '').includes('เพมมุ')) && r.p[oi].av.some(a => (nmOf(a).includes('เพมมุ') || nmOf(a).includes('สไปรท์')) && linked9(r, a))) return true;
  return false;
};
// kill: แทนที่การถูกทำลาย (067 ศาสตราวุธ, 025 โกลเด้น)
function bt10Save(r, i, u, f0) {
  const c = f0.c; if (!c || c.tk) return false;
  const w = r.p.flatMap(q => q.mg).find(m => m.at === c.u && m.id === 'BT10-067');
  if (w) { sendHell(r, w.u); vfx(c.u, 'aura', '🛡 ทำลายอาวุธแทน', '#facc15'); log(r, '🛡 ศาสตราวุธศักดิ์สิทธิ์ โวลุสปา: ทำลายการ์ดนี้แทน ' + nmOf(c)); return true; }
  const g = r.p[f0.i].av.find(a => a.id === 'BT10-025' && !noFx(r, a) && a.u !== c.u);
  if (g && r.g.turn !== f0.i && !r.g.ask && isAv(c) && nmOf(c).includes('จอมเวทย์')) {
    ask(r, f0.i, { yn: true, text: 'จอมเวทย์ โกลเด้น: ' + nmOf(c) + ' กำลังจะออกจากสนามด้วยการ์ดฝ่ายตรงข้าม — ทำลาย โกลเด้น แทนไหม?', cb: y => { if (!y) return kill(r, i, u, 1); vfx(g.u, 'burst', '💥 ทำลายแทน', '#8b5cf6'); log(r, '💥 โกลเด้น: ทำลายตัวเองแทน ' + nmOf(c)); kill(r, f0.i, g.u, 1); } });
    return true;
  }
  return false;
}
// หลังหงาย LIFE จากการโจมตี: 004 (ขโมย Magic จากนรก) 
function bt10Hit(r, d, atk, a) {
  if (a.id === 'BT10-004' && a.g4 && !noFx(r, a)) r.g.q.push(() => {
    const L = d.hell.filter(c => !c.tk && B[c.id].t === 'Magic').map(c => c.u); if (!L.length) return;
    ask(r, r.p.indexOf(atk), { text: 'โกเอมอน: เลือก {magic}/{mod} ในนรกฝ่ายตรงข้าม 1 ใบ นำขึ้นมือเรา (แล้วทิ้งมือ 1 ใบ)', opts: L, cancel: true, cb: us => { const c = fromZone(r, r.p.indexOf(d), 'hell', us[0]); if (!c) return; atk.hand.push(c); log(r, '🥷 โกเอมอน: นำ ' + B[c.id].n + ' ขึ้นมือ'); const ai = r.p.indexOf(atk);
      if (atk.hand.length) ask(r, ai, { text: 'โกเอมอน: ทิ้งการ์ดบนมือ 1 ใบ', opts: atk.hand.map(h => h.u), cb: u2 => sendHell(r, u2[0]) }); } });
  });
}
// ประกาศโจมตี (ส่วนเพิ่ม): 033, 009, 026 Link, ล้างสถานะ K-BO
function bt10AtkAny(r, i, a, tg, tk) {
  bt10AtkAny0(r, i, a, tg, tk); r.g.blk10 = null;
  const t = tk === 'av' ? find(r, tg) : null, def = t && t.z === 'av' ? t.c : null;
  if (def && def.id === 'BT10-026' && linked9(r, def) && !noFx(r, def) && def.ou26 !== r.g.n) { def.ou26 = r.g.n; r.g.q.push(() => { draw(r, r.p[1 - i], 1); vfx(def.u, 'aura', 'จั่ว 1', '#facc15'); log(r, '✨ เดสสึหวา (Link): ตกเป็นเป้าหมายการโจมตี จั่ว 1 ใบ'); }); }
  [[a, i], [def, 1 - i]].forEach(([x, o]) => { if (!x || !nmOf(x).includes('อีสานสลิงเกอร์')) return; const k = r.p[o].hand.find(h => h.id === 'BT10-033'); if (!k) return;
    r.g.q.push(() => { if (!r.p[o].hand.includes(k) || !find(r, x.u)) return; ask(r, o, { yn: true, text: 'พระอีสาน: ' + nmOf(x) + ' ต่อสู้ — ทิ้ง พระอีสาน จากมือ เพื่อ POWER +1 จนจบการต่อสู้ไหม?', cb: y => { if (!y) return; sendHell(r, k.u); x.bp = (x.bp || 0) + 1; vfx(x.u, 'aura', 'POWER +1', '#a855f7'); log(r, '✨ พระอีสาน: ' + nmOf(x) + ' POWER +1 จนจบการต่อสู้'); } }); }); });
  if (nmOf(a).includes('เพมมุ') || nmOf(a).includes('สไปรท์')) { const k = r.p[i].av.find(y => y.id === 'BT10-009' && y.k9b && !noFx(r, y)); if (k) r.g.q.push(() => { if (!find(r, k.u)) return;
    ask(r, i, { yn: true, text: 'K-BO: ' + nmOf(a) + ' โจมตี — เนรเทศ K-BO เพื่อให้ฝ่ายตรงข้ามใช้ React/ความสามารถ Avatar ไม่ได้จนจบการต่อสู้ ไหม?', cb: y => { if (!y) return; const f = take(r, k.u); r.p[i].dk.push(f.c); r.g.blk10 = { who: 1 - i, n: r.g.n }; vfx(a.u, 'aura', '🤖 K-BO', '#ef4444'); log(r, '🤖 K-BO: เนรเทศตัวเอง — ฝ่ายตรงข้ามใช้ React/ความสามารถ Avatar ไม่ได้จนจบการต่อสู้'); } }); }); }
}
// คำสั่งเสียมะม่วง: ไปวางบน Magic Zone
function bt10DieMg(r, f) {
  const c = f.c; if (!['BT10-040', 'BT10-041', 'BT10-042'].includes(c.id)) return;
  if (!(r.g.turn !== f.i || mgSrc10(r))) return;
  r.g.q.push(() => { const p = r.p[f.i]; if (p.hell.includes(c)) placeMg10(r, f.i, c, 'hell', f.i); });
}
// 010 ซัลลี่วอดก้า (Link): Avatar ใน Link ใช้ โล่มนุษย์ → ตื่น
function bt10Tank(r, i, x) { const t = r.p[i].av.find(a => a.id === 'BT10-010' && !noFx(r, a) && linked9(r, a) && a.ou !== r.g.n); if (!t || !linked9(r, x)) return; t.ou = r.g.n; x.tired = false; vfx(x.u, 'aura', 'ตื่น', '#22c55e'); log(r, '✨ ซัลลี่วอดก้า (Link): ' + nmOf(x) + ' ใช้ โล่มนุษย์ — เปลี่ยนเป็นสภาพตื่น'); }
// หลังจบการต่อสู้ (046 ตำรวจคามุ)
const _ba10 = bt6After;
bt6After = function (r, a) {
  _ba10(r, a); const g = r.g; if (g.blk10) g.blk10 = null;
  if (a && a.id === 'BT10-046' && !noFx(r, a) && a.ou46 !== g.n && find(r, a.u)) { const wi = find(r, a.u).i; a.ou46 = g.n;
    g.q.push(() => bt7Guess(r, wi, 'ตำรวจคามุ', (ok, top, op) => { if (!ok) return; a.tired = false; const c = fromZone(r, 1 - wi, 'deck', top.u); if (c) { op.hell.push(c); log(r, '👮 ตำรวจคามุ: ทายถูก — ตื่น และส่ง ' + B[c.id].n + ' ลงนรก'); } vfx(a.u, 'aura', 'ตื่น', '#22c55e'); })); }
};
// ชนะการต่อสู้ (037 ตันก๋ง, 048 สามัคคี, 015 เนรเทศ, 068 ตั๊กแตน, 069 อาวุธเพมมุ)
const _w10b = bt8Win;
bt8Win = function (r, p, a, d, res) {
  _w10b(r, p, a, d, res); if (res !== 'win' && res !== 'lose') return;
  const wi = res === 'win' ? p.ai : 1 - p.ai, w = res === 'win' ? a : d, lo = res === 'win' ? d : a, isAtk = res === 'win';
  if (!w || w.tk || !find(r, w.u) || noFx(r, w)) return; const me = r.p[wi], op = r.p[1 - wi];
  if (isAtk && nmOf(w).includes('ลิโป้ ขุนพลเทพสงคราม') && me.av.some(y => y.id === 'BT10-037' && linked9(r, y))) r.g.q.push(() => { lifeUp(r, 1 - wi); vfx(w.u, 'aura', '❤ หงาย LIFE ศัตรู', '#facc15'); log(r, '❤ ตันก๋ง (Link): ลิโป้ทำลาย Avatar — หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); });
  if (w.l48 === r.g.n) r.g.q.push(() => { lifeUp(r, 1 - wi); vfx(w.u, 'aura', '❤ หงาย LIFE ศัตรู', '#22c55e'); log(r, '❤ เซนเซไฮ (สามัคคี): ทำลาย Avatar — หงาย LIFE ใบบนสุดของฝ่ายตรงข้าม'); });
  if (w.id === 'BT10-015' && lo) r.g.q.push(() => { const o = lo.mgOwner != null ? lo.mgOwner : 1 - wi; const q = r.p[1 - wi], k = q.hell.indexOf(lo); if (k >= 0) { q.hell.splice(k, 1); q.dk.push(lo); vfx(w.u, 'aura', '🌀 เนรเทศ', '#8b5cf6'); log(r, '🌀 ริกกี้: เนรเทศ ' + B[lo.id].n + ' แทนการลงนรก'); } });
  if (isAtk && hasEq(r, w, 'BT10-068')) r.g.q.push(() => { const L = me.life.filter(l => l.up); if (!L.length) return log(r, 'หยินหยางทอร์นาโด: ไม่มี LIFE ที่หงายอยู่');
    ask(r, wi, { text: 'หยินหยางทอร์นาโด: เลือก LIFE Card ที่หงายอยู่ของเรา 1 ใบ ใช้ผลความสามารถ', opts: L.map(l => l.u), cb: us => { const l = me.life.find(x => x.u === us[0]); if (l) { log(r, '🌪 ใช้ผล LIFE: ' + B[l.id].n); lifeFx(r, wi, l.id); } } }); });
  if (isAtk && hasEq(r, w, 'BT10-069') && lo) r.g.q.push(() => { const pw = P(r, lo), T = op.av.filter(x => (B[x.id].p || 0) <= pw && !protectedFrom(r, wi, x)).map(x => x.u); const eq = r.p.flatMap(q => q.mg).find(m => m.at === w.u && m.id === 'BT10-069');
    const after = () => { if (!eq) return; ask(r, wi, { yn: true, text: 'อาวุธของเพมมุ: ทำลายการ์ดนี้ แล้วเปลี่ยนสภาพ "เพมมุ" 1 ใบบน Avatar Zone เราไหม?', cb: y => { if (!y) return; sendHell(r, eq.u); const L = me.av.filter(x => nmOf(x).includes('เพมมุ')).map(x => x.u); if (!L.length) return; ask(r, wi, { text: 'เลือก "เพมมุ" 1 ใบ เปลี่ยนสภาพ (นอน↔ตื่น)', opts: L, cb: u2 => { const t = find(r, u2[0]); if (t) { t.c.tired = !t.c.tired; vfx(t.c.u, 'aura', t.c.tired ? 'นอน' : 'ตื่น', '#94a3b8'); } } }); } }); };
    if (!T.length) return after(); ask(r, wi, { text: 'อาวุธของเพมมุ: เลือก Avatar ฝ่ายตรงข้ามที่ POWER ตั้งต้น ≤ ' + pw + ' 1 ใบ ทำลาย', opts: T, cb: us => { vfx(us[0], 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, us[0]); r.g.q.push(after); } }); });
};
// POWER / Cost ปรับ (015 ตั้งต้น 5, 020 +2, 029 วัลฮัลลา, 039 ต้นมะม่วง, 041 ชั่วคราว, 050 สลับ Cost-POWER)
const _P10 = P;
P = function (r, x) {
  let v = _P10(r, x); if (!x || x.tk) return v; const f = find(r, x.u), on = f && f.z === 'av'; let d = 0;
  if (on && x.id === 'BT10-015' && x.rk15) d += 3;
  if (on && x.id === 'BT10-020' && x.s20) d += 2;
  if (on && valh10(x) && r.p[f.i].av.some(a => a.id === 'BT10-029' && !noFx(r, a))) d += nmOf(x).includes('บรุนฮิลด์') ? 2 : 1;
  if (on && x.id === 'BT10-039' && !noFx(r, x)) d += mTrees10(r, f.i).length;
  if (on && x.pu10 === r.g.n) d += 2;
  if (on && hasEq(r, x, 'BT10-069')) d += 1;   // อาวุธของเพมมุ ดาบมารไร้พ่าย: POWER +1
  if (on && x.sw10 === r.g.n) d += (B[x.id].c || 0) - (B[x.id].p || 0);
  return d ? Math.max(0, v + d) : v;
};
const bt10CostD = (r, x) => (x.sw10 === r.g.n) ? (B[x.id].p || 0) - (B[x.id].c || 0) : 0;
// หลังจ่าย Cost เพื่ออัญเชิญ: 045 นักข่าวสาว (สอดแนม Deck ฝ่ายตรงข้าม 1 ใบ)
function bt10Cost(r, i, c, ps) {
  if (!nmOf(c).includes('ตำรวจ') || !ps.some(q => q.id === 'BT10-045')) return; const op = r.p[1 - i]; if (!op.deck.length) return;
  r.g.q.push(() => { const t = op.deck[op.deck.length - 1]; fx({ k: 'scout', i, ids: [t.kd || t.id] }); log(r, '🔎 ' + r.p[i].name + ': (นักข่าวสาว เดย์วัน) สอดแนม Deck ฝ่ายตรงข้าม 1 ใบ → ' + B[t.id].n + ' และนำกลับไว้เดิม'); });
}
// ใบบนสุดของ Deck ฝ่ายตรงข้ามที่ถูกหงาย (045)
const bt10Reveal = (r, i) => { const t = r.p[1 - i].deck[r.p[1 - i].deck.length - 1]; return (t && r.p[i].av.some(a => a.id === 'BT10-045' && !noFx(r, a)) && r.p[i].av.some(a => nmOf(a).includes('ตำรวจ'))) ? (t.kd || t.id) : null; };
// 057: ห้ามนำการ์ดจาก Deck ขึ้นมือ / ข้าม Draw Phase
const bt10NoAdd = (r, i) => !!(r.g.nt10 && r.g.nt10.i === i && r.g.n <= r.g.nt10.until);
const bt10NoDraw = (r, p) => { const n = r.g.nt10, i = r.p.indexOf(p); return !!(n && n.i === i && r.g.n === n.until); };
// ล็อกสภาพ (064)
function bt10Lock(c, n) { c.lk10 = n; if (c.lkd10) return; c.lkd10 = 1; let v = !!c.tired; Object.defineProperty(c, 'tired', { enumerable: true, configurable: true, get() { return v; }, set(x) { if (c.lk10 === (CR && CR.g.n)) return; v = !!x; } }); }
// Construct ที่ถูกทำลายด้วยความสามารถไม่ได้ (073) / หอสมุด (072)
const bt10CoGuard = (r, f) => (f.c.id === 'BT10-073' && !r.g.inB && r.p[f.i].av.some(a => (B[a.id].e || '').includes('ค่ายบางระจัน'))) || (f.c.id === 'BT10-072' && r.g.turn !== f.i && r.p[f.i].av.some(a => nmOf(a).includes('จอมเวทย์')));
// ช่วงเริ่ม Main Phase: 044 ราชันย์ตั๊กแตน (สวมบัลลังก์) ใช้ผล LIFE ที่หงายอยู่
function bt10MainStart(r) {
  const i = r.g.turn, p = r.p[i];
  p.av.filter(a => a.id === 'BT10-044' && !noFx(r, a) && (a.wr || []).some(w => w.id === 'BT07-073')).forEach(a => r.g.q.push(() => { const L = p.life.filter(l => l.up); if (!L.length) return;
    ask(r, i, { text: 'ราชันย์ตั๊กแตนศตวรรษ (บัลลังก์): เลือก LIFE Card ที่หงายอยู่ 1 ใบ ใช้ผลความสามารถจนจบเทิร์น', opts: L.map(l => l.u), cancel: true, cb: us => { const l = p.life.find(x => x.u === us[0]); if (l) { vfx(a.u, 'aura', '👑 ใช้ผล LIFE', '#22c55e'); log(r, '👑 ราชันย์ตั๊กแตน: ใช้ผล LIFE ' + B[l.id].n); lifeFx(r, i, l.id); } } }); }));
}
// 001 พระพิฆเนศ: ยกเลิกความสามารถของ Avatar/Magic ฝ่ายตรงข้าม
const bt10GaOK = (r, i, a) => { const p = r.g.pend; return !!(p && p.k === 'ev' && p.ev && (p.ev.k === 'use' || p.ev.k === 'cast') && p.who === i && p.ev.i !== i && a.id === 'BT10-001' && !noFx(r, a) && a.ou !== r.g.n && r.p[i].av.some(x => x.u !== a.u && symOf(x) === 'เทพ')); };
function bt10Ganesh(r, i, f) {
  const a = f.c; if (!bt10GaOK(r, i, a)) E('เงื่อนไขการใช้ไม่ครบ'); const p0 = r.g.pend, L = r.p[i].av.filter(x => x.u !== a.u && symOf(x) === 'เทพ').map(x => x.u);
  ask(r, i, { text: 'พระพิฆเนศ: เซ่นไหว้ Avatar {เทพ} ใบอื่น 1 ใบ เพื่อยกเลิกความสามารถของการ์ดฝ่ายตรงข้าม', opts: L, cancel: true, cb: us => { if (!r.g.pend || r.g.pend !== p0) return; a.ou = r.g.n; sendHell(r, us[0]); const cx = p0.ev.cx; if (cx) cx.cancelled = 1; p0.ev.cancelled = 1; vfx(a.u, 'burst', '🐘 ยกเลิก', '#facc15'); fx({ k: 'say', id: a.id, t: 'ยกเลิกความสามารถ' }); log(r, '🐘 พระพิฆเนศ: เซ่นไหว้ — ยกเลิกความสามารถของการ์ดฝ่ายตรงข้าม'); } });
}
// act: K-BO / 064 / 057 ติดตามการกระทำ
const _act10 = act;
act = function (r, i, m) {
  const g = r.g;
  if (g.blk10 && g.blk10.who === i && g.blk10.n === g.n && ['use', 'cast', 'atkresp'].includes(m.t)) { const f = m.u != null ? find(r, m.u) : null;
    if (m.t === 'atkresp' || (m.t === 'use' && f && f.z === 'av') || (m.t === 'cast' && f && B[f.c.id].st === 'React')) E('K-BO: ใช้ React/ความสามารถ Avatar ไม่ได้จนจบการต่อสู้นี้'); }
  if (m.t === 'atk') { const f = m.u != null ? find(r, m.u) : null; if (f && f.c.lk10 === g.n) E('ไม่สามารถเปลี่ยนสภาพได้ (วิชานินจา ผนึกเงา) จึงโจมตีไม่ได้'); }
  const out = _act10(r, i, m);
  if (['summon', 'build', 'cast', 'use'].includes(m.t)) g.act10 = g.n;
  return out;
};

// ===== การ์ดรายใบ (รอบสมบูรณ์) =====
Object.assign(SUM, {
  // BT10-019 ราชาสิ่งปฏิกูล — พอดี จุตี (หรือถูกอัญเชิญด้วยความสามารถของ "สิ่งปฏิกูล"): นรกเรามี "สิ่งปฏิกูล" ≥5 → Avatar ฝ่ายตรงข้าม 1 ใบ เป็น {สัตว์มหัศจรรย์} ชื่อ "สิ่งปฏิกูล" POWER 1
  'BT10-019': (r, i, x) => { if (!x.jt && !x.fz10) return; if (r.p[i].hell.filter(c => !c.tk && B[c.id].n.includes('สิ่งปฏิกูล')).length < 5) return log(r, 'ราชาสิ่งปฏิกูล: นรกมี "สิ่งปฏิกูล" ไม่ถึง 5 ใบ');
    const T = foeAvT(r, i); if (!T.length) return; ask(r, i, { text: 'ราชาสิ่งปฏิกูล: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ เปลี่ยนเป็น {สัตว์มหัศจรรย์} ชื่อ "สิ่งปฏิกูล" POWER 1', opts: T, cb: us => { const t = find(r, us[0]); if (!t) return;
      t.c.sy = 'สัตว์มหัศจรรย์'; t.c.nmo = 'สิ่งปฏิกูล'; addPw(t.c, 1 - P(r, t.c) + 0); vfx(t.c.u, 'burst', '💩 สิ่งปฏิกูล', '#a16207'); log(r, '💩 ' + 'ราชาสิ่งปฏิกูล: เปลี่ยน Avatar ฝ่ายตรงข้ามเป็น "สิ่งปฏิกูล" POWER 1'); } }); },
  // BT10-023 ไมค์วิสกี้ — จุติ: อัญเชิญ Avatar Cost ≤4 ที่มี [Link] จากมือ; ถ้าเป็น ซัลลี่วอดก้า จั่ว 1
  'BT10-023': (r, i, x) => { const p = r.p[i], L = p.hand.filter(c => isAv(c) && B[c.id].c <= 4 && !!partner9(c)).map(c => c.u); if (!L.length) return;
    ask(r, i, { text: 'จุติ: เลือก Avatar Cost ≤4 ที่มีความสามารถ [Link] จากมือ อัญเชิญลงสนาม (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, cb: us => { const c = p.hand.find(h => h.u === us[0]); if (!c) return; if (sumH9(r, i, c, 'hand', 'อัญเชิญ', '#38bdf8') && B[c.id].n.includes('ซัลลี่วอดก้า')) { draw(r, p, 1); log(r, '✨ ซัลลี่วอดก้า: จั่ว 1 ใบ'); } } }); },
  // BT10-040 ผู้คุมกฎแห่งภาคีมะม่วง — จุติ: นำ "มะม่วง" {ต้นไม้} ไม่ใช่ Only จาก Deck ไป Magic Zone; ถ้าเป็นต้นมะม่วง เพิ่มอีก 1 ใบจาก Deck/นรก; สับ Deck
  'BT10-040': (r, i) => { const p = r.p[i], L = p.deck.filter(c => isTree10(c) && !bt10Only(c)).map(c => c.u);
    const fin = () => shuf(p.deck);
    if (!L.length) { log(r, 'ผู้คุมกฎ: ไม่พบ "มะม่วง" {ต้นไม้} (ไม่ใช่ Only) ใน Deck'); return fin(); }
    ask(r, i, { text: 'จุติ: เลือก "มะม่วง" {ต้นไม้} (ไม่ใช่ Only) จาก Deck ไปวางบน Magic Zone เรา', opts: L, cb: us => { const c = p.deck.find(h => h.u === us[0]); if (!c) return fin(); placeMg10(r, i, c, 'deck', i);
      if (!isMTree10(c)) return fin(); const L2 = [...p.deck, ...p.hell].filter(isTree10).map(h => h.u); if (!L2.length) return fin();
      ask(r, i, { text: 'ต้นมะม่วง: เลือก "มะม่วง" {ต้นไม้} อีก 1 ใบจาก Deck หรือ นรก ไปวางบน Magic Zone เรา (ยกเลิก = ไม่ใช้)', opts: L2, cancel: true, onCancel: fin, cb: u2 => { const h = p.deck.find(z => z.u === u2[0]) || p.hell.find(z => z.u === u2[0]); if (h) placeMg10(r, i, h, p.deck.includes(h) ? 'deck' : 'hell', i); fin(); } }); } }); },
  // BT10-039 มาโกะ — จุติ: นำ "มะม่วง" {ต้นไม้} ชื่อไม่ซ้ำกัน จากนรก กี่ใบก็ได้ ไป Magic Zone เรา
  'BT10-039': (r, i) => { const p = r.p[i], got = [];
    const step = () => { const L = p.hell.filter(c => isTree10(c) && !got.includes(nm9(c))).map(c => c.u); if (!L.length) return;
      ask(r, i, { text: 'จุติ: เลือก "มะม่วง" {ต้นไม้} (ชื่อไม่ซ้ำ) จากนรก ไปวางบน Magic Zone เรา — ยกเลิก = หยุด (' + got.length + ' ใบ)', opts: L, cancel: true, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c) { got.push(nm9(c)); placeMg10(r, i, c, 'hell', i); } step(); } }); };
    step(); },
  // BT10-044 ราชันย์ตั๊กแตนศตวรรษ — จุติ เลือกปฏิบัติ: 1) นำ "บัลลังก์ตั๊กแตนศตวรรษ" จากนรก มาสวมใส่ 2) หงาย LIFE บนสุด แล้วนำบัลลังก์จาก Deck ขึ้นมือ สับ
  'BT10-044': (r, i, x) => { const p = r.p[i]; ask(r, i, { text: 'ราชันย์ตั๊กแตนศตวรรษ: เลือกปฏิบัติ', choices: ['1) นำ "บัลลังก์ตั๊กแตนศตวรรษ" 1 ใบจากนรก มาสวมใส่การ์ดใบนี้', '2) หงาย LIFE ใบบนสุดของเรา แล้วนำ "บัลลังก์ตั๊กแตนศตวรรษ" จาก Deck ขึ้นมือ แล้วสับ'], cb: k => {
    if (k === 0) { const c = p.hell.find(h => !h.tk && B[h.id].n.includes('บัลลังก์ตั๊กแตนศตวรรษ')); if (!c) return log(r, 'ไม่พบ บัลลังก์ตั๊กแตนศตวรรษ ในนรก'); p.hell.splice(p.hell.indexOf(c), 1); (x.wr = x.wr || []).push(c); vfx(x.u, 'aura', '🪑 สวมบัลลังก์', '#22c55e'); return log(r, '🪑 ' + nmOf(x) + ' สวมใส่ บัลลังก์ตั๊กแตนศตวรรษ'); }
    if (!lifeUp(r, i)) log(r, 'ไม่มี LIFE ให้หงาย'); tutor(r, i, c => !c.tk && B[c.id].n.includes('บัลลังก์ตั๊กแตนศตวรรษ'), 'บัลลังก์ตั๊กแตนศตวรรษ'); } }); },
});

// กฎ "นับเป็น Symbol ด้วย": 012 หุ่นยนต์ (เพิ่มจาก 015/022/030)
(function () { const o = also9; also9 = function (x, sym) { return o(x, sym) || (!!x && !x.tk && x.id === 'BT10-012' && sym === 'หุ่นยนต์'); }; })();

Object.assign(AB, {
  // BT10-029 ซีเกิร์ด — เทิร์นละครั้ง สั่งใช้: นำ "เทพธิดาแห่งวัลฮัลลา" จากนรกสูงสุด 3 ใบ (≥1) กลับ Deck สับ จากนั้นธรณีสูบ 3: ทำลาย Avatar ฝ่ายตรงข้าม Cost รวม ≤ 2 + จำนวนที่ธรณีสูบเจอ
  'BT10-029': { z: 'av', can: (r, i) => r.p[i].hell.some(valh10), steps: [], run: (r, i, cx) => { const p = r.p[i], got = [];
    const pick = () => { const L = p.hell.filter(c => valh10(c) && !got.includes(c)).map(c => c.u); if (!L.length || got.length >= 3) return fin();
      ask(r, i, { text: 'ซีเกิร์ด: เลือก "เทพธิดาแห่งวัลฮัลลา" จากนรก กลับเข้า Deck (' + (got.length + 1) + '/3' + (got.length ? '' : ' อย่างน้อย 1') + ')', opts: L, cancel: got.length > 0, onCancel: fin, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c) got.push(c); pick(); } }); };
    const fin = () => { got.forEach(c => { const k = p.hell.indexOf(c); if (k >= 0) { p.hell.splice(k, 1); p.deck.push(c); } }); shuf(p.deck); log(r, '♻ ซีเกิร์ด: นำเทพธิดาแห่งวัลฮัลลา ' + got.length + ' ใบกลับ Deck แล้วสับ');
      const b = p.hell.length; mill(r, i, 3); const milled = p.hell.slice(b), n = milled.filter(valh10).length; let left = 2 + n; log(r, '🔥 ธรณีสูบเจอ เทพธิดาแห่งวัลฮัลลา ' + n + ' ใบ — ทำลาย Avatar ฝ่ายตรงข้าม Cost รวมได้ ≤ ' + left);
      const kill1 = () => { const T = r.p[1 - i].av.filter(a => costNow(r, a) <= left && !protectedFrom(r, i, a)).map(a => a.u); if (!T.length) return; ask(r, i, { text: 'ซีเกิร์ด: ทำลาย Avatar ฝ่ายตรงข้าม (Cost ที่เหลือ ' + left + ') — ยกเลิก = หยุด', opts: T, cancel: true, cb: us => { const t = find(r, us[0]); if (t) { left -= costNow(r, t.c); vfx(t.c.u, 'burst', 'ทำลาย', '#ef4444'); destroyAv(r, t.c.u); } kill1(); } }); };
      r.g.q.push(kill1); };
    pick(); } },
  // BT10-031 พี่หน่วงเพชรฆาตโซเชียล — เทิร์นละครั้ง สั่งใช้ เนรเทศ Avatar ฝ่ายตรงข้ามบน Magic Zone เรา 1 ใบ: เลือกปฏิบัติ
  'BT10-031': { z: 'av', can: (r, i) => r.p[i].mg.some(m => m.mgAv && m.mgOwner !== i), steps: [{ key: 'x', text: 'เนรเทศ Avatar ฝ่ายตรงข้ามบน Magic Zone เรา 1 ใบ', opts: (r, i) => r.p[i].mg.filter(m => m.mgAv && m.mgOwner !== i).map(m => m.u) }], run: (r, i, cx) => { const p = r.p[i], c = p.mg.find(m => m.u === cx.pick.x[0]); if (c) { const o = mgOut(r, c, 'dk'); vfx(c.u, 'burst', '🌀 เนรเทศ', '#8b5cf6'); log(r, '🌀 พี่หน่วง: เนรเทศ ' + B[c.id].n); }
    ask(r, i, { text: 'พี่หน่วง: เลือกปฏิบัติ', choices: ['1) สอดแนม 5 ใบ นำ "คุณเก่ง"/"ทนาย"/"พี่หน่วง" 1 ใบขึ้นมือ ที่เหลือเรียงไว้ใต้ Deck', '2) เลือก Avatar ในนรกฝ่ายตรงข้าม 1 ใบ นำมาไว้บน Magic Zone เรา'], cb: k => {
      if (k === 0) { const seen = bt4Peek(r, i, 5, null), L = seen.filter(h => p.deck.includes(h) && !h.tk && /คุณเก่ง|ทนาย|พี่หน่วง/.test(B[h.id].n)).map(h => h.u), fin = got => bt10Bottom(r, i, seen.filter(h => h !== got));
        if (!L.length) { log(r, 'พี่หน่วง: ไม่พบ คุณเก่ง/ทนาย/พี่หน่วง'); return fin(null); }
        return ask(r, i, { text: 'เลือก "คุณเก่ง"/"ทนาย"/"พี่หน่วง" 1 ใบ ขึ้นมือ (ยกเลิก = ไม่นำ)', opts: L, cancel: true, onCancel: () => fin(null), cb: us => { const h = fromZone(r, i, 'deck', us[0]); h && p.hand.push(h); fin(h); } }); }
      const O = r.p[1 - i].hell.filter(h => !h.tk && isAv(h)).map(h => h.u); if (!O.length) return log(r, 'ไม่มี Avatar ในนรกฝ่ายตรงข้าม');
      ask(r, i, { text: 'เลือก Avatar ในนรกฝ่ายตรงข้าม 1 ใบ ไปวางบน Magic Zone เรา', opts: O, cb: us => { const h = r.p[1 - i].hell.find(z => z.u === us[0]); h && placeMg10(r, i, h, 'hell', 1 - i); } }); } }); } },
  // BT10-039 มาโกะ — เทิร์นละครั้ง สั่งใช้: อัญเชิญ จุติ Avatar "มะม่วง" 1 ใบ จาก Magic Zone เรา ลง Avatar Zone
  'BT10-039': { z: 'av', can: (r, i) => r.p[i].mg.some(m => m.mgAv && isTree10(m)) && r.p[i].av.length < 5, steps: [], run: (r, i, cx) => { const p = r.p[i], L = p.mg.filter(m => m.mgAv && isTree10(m)).map(m => m.u);
    ask(r, i, { text: 'มาโกะ: เลือก "มะม่วง" 1 ใบจาก Magic Zone เรา อัญเชิญ (จุติ ทำงาน) ลง Avatar Zone', opts: L, cb: us => { const c = p.mg.find(m => m.u === us[0]); if (!c) return; const o = mgOut(r, c, 'hand'); if (summonAny(r, o, c.u, 'hand', c)) { vfx(c.u, 'burst', '🥭 อัญเชิญ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, o, c)); } } }); } },
  // BT10-050 ชิบาตะ โบตัน — พอดี เทิร์นละครั้ง สั่งใช้: เลือก Avatar 1 ใบบนสนามผู้เล่นใดก็ได้ สลับ Cost กับ POWER ตั้งต้น จนจบเทิร์น
  'BT10-050': { z: 'av', can: (r, i, c) => !!c.jt, steps: [{ key: 't', text: 'เลือก Avatar 1 ใบบน Avatar Zone ผู้เล่นใดก็ได้ สลับค่า Cost กับ POWER ตั้งต้น จนจบเทิร์น', opts: (r, i) => allAv(r).filter(a => !protectedFrom(r, i, a.x)).map(a => a.x.u) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; t.c.sw10 = t.c.sw10 === r.g.n ? 0 : r.g.n; vfx(t.c.u, 'burst', '🔄 สลับ Cost/POWER', '#22c55e'); log(r, '🔄 ชิบาตะ โบตัน: สลับ Cost กับ POWER ตั้งต้นของ ' + nmOf(t.c) + ' จนจบเทิร์น'); } },
  // BT10-072 หอสมุดจอมเวทย์ — เทิร์นละครั้ง สั่งใช้: เทิร์นนี้ใช้ {magic} "คาถา" เพิ่มได้ 1 ใบ
  'BT10-072': { z: 'co', can: () => true, steps: [], run: (r, i) => { r.g.x30 = { n: r.g.n, who: i, done: 0 }; log(r, '📚 หอสมุดจอมเวทย์: เทิร์นนี้ใช้ Magic "คาถา" เพิ่มได้ 1 ใบ'); } },
});

Object.assign(ABIL, {
  // BT10-009 K-BO ยอดหุ่นยนต์ — สั่งใช้ จากบนมือ ส่ง {mod} "อาวุธของเพมมุ" บน Magic Zone ลงนรก: อัญเชิญใบนี้ (ได้รับความสามารถเนรเทศตัวเอง — จัดการตอน เพมมุ/สไปรท์ โจมตี)
  'BT10-009': { zone: 'hand', label: 'ส่ง "อาวุธของเพมมุ" บน Magic Zone ลงนรก อัญเชิญใบนี้', cond: (r, i, c) => canPlaceAv(r, i, c) && r.p[i].mg.some(m => !m.mgAv && B[m.id].t === 'Magic' && B[m.id].st === 'Modification' && /อาวุ[ธร]ของเพมมุ/.test(B[m.id].n)), run: (r, i, x) => { const L = r.p[i].mg.filter(m => !m.mgAv && B[m.id].st === 'Modification' && /อาวุ[ธร]ของเพมมุ/.test(B[m.id].n)).map(m => m.u);
    ask(r, i, { text: 'K-BO: เลือก {mod} "อาวุธของเพมมุ" บน Magic Zone เรา 1 ใบ ส่งลงนรก', opts: L, cancel: true, cb: us => { sendHell(r, us[0]); if (sumH9(r, i, x, 'hand', '🤖 K-BO', '#ef4444')) { x.k9b = 1; log(r, '🤖 K-BO: ได้รับความสามารถ — เนรเทศตัวเองเมื่อ เพมมุ/สไปรท์ โจมตี'); } } }); } },
  // BT10-029 ซีเกิร์ด — สั่งใช้ จากในนรก ถ้ามี "บรุนฮิลด์" บนสนาม ธรณีสูบ 9 ใบ: อัญเชิญใบนี้
  'BT10-029': { zone: 'hell', label: 'ธรณีสูบ 9 ใบ อัญเชิญใบนี้ (ต้องมี "บรุนฮิลด์" บนสนาม)', cond: (r, i, c) => r.p[i].av.some(a => nmOf(a).includes('บรุนฮิลด์')) && r.p[i].deck.length >= 9 && canPlaceAv(r, i, c), run: (r, i, x) => { mill(r, i, 9); if (r.p[i].hell.includes(x) && summonAny(r, i, x.u, 'hell', x)) { vfx(x.u, 'burst', 'อัญเชิญจากนรก', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, x)); } } },
  // BT10-039 มาโกะ — สั่งใช้ จากบน Magic Zone: ส่ง "มะม่วง" {ต้นไม้} ใบอื่น 5 ใบบน Magic Zone ลงนรก อัญเชิญ จุติ การ์ดใบนี้
  'BT10-039': { zone: 'mg', label: 'ส่งมะม่วงใบอื่น 5 ใบบน Magic Zone ลงนรก อัญเชิญใบนี้', cond: (r, i, c) => !!c.mgAv && r.p[i].mg.filter(m => m !== c && m.mgAv && isTree10(m)).length >= 5, run: (r, i, x) => { const L = r.p[i].mg.filter(m => m !== x && m.mgAv && isTree10(m)).map(m => m.u);
    ask(r, i, { text: 'มาโกะ: เลือก "มะม่วง" {ต้นไม้} ใบอื่น 5 ใบบน Magic Zone เรา ส่งลงนรก', opts: L, n: 5, min: 5, cancel: true, cb: us => { us.forEach(u => { const c = r.p[i].mg.find(m => m.u === u); if (c) mgOut(r, c, 'hell'); }); const o = mgOut(r, x, 'hand'); if (summonAny(r, o, x.u, 'hand', x)) { vfx(x.u, 'burst', '🥭 มาโกะ', '#22c55e'); r.g.q.unshift(() => fxSummon(r, o, x)); } } }); } },
});
ABIL['BT10-004'].bp = (r, i) => r.p[i].life.filter(l => l.up).length >= 3;
ABIL['BT10-006'].any = 1;   // 006: Main Phase ผู้เล่นใดก็ได้   // หงาย LIFE ≥3 ใช้ใน Battle Phase ได้

// Magic / Modification / Land
Object.assign(MG, {
  // BT10-057 — ต้องเป็นใบแรกสุดของ Main Phase: จั่ว 3; จนจบเทิร์นถัดไปของเรา นำการ์ดจาก Deck ขึ้นมือด้วยสกิลไม่ได้ และ Draw Phase ถัดไปไม่จั่ว
  'BT10-057': { steps: [{ key: 'f', text: 'ต้องใช้เป็นใบแรกสุดของ Main Phase เท่านั้น', opts: (r, i, cx) => (r.g.act10 === r.g.n ? [] : [cx.card.u]) }], run: (r, i) => { draw(r, r.p[i], 3); r.g.nt10 = { i, until: r.g.n + 2 }; log(r, '🌙 ' + r.p[i].name + ': จั่ว 3 — จนจบเทิร์นถัดไปของเรา นำการ์ดจาก Deck ขึ้นมือด้วยสกิลไม่ได้ และ Draw Phase ถัดไปไม่จั่ว'); } },
  // BT10-064 วิชานินจา ผนึกเงา (React) — เมื่อบน Avatar Zone เรามีแต่ "นินจา": Avatar ฝ่ายตรงข้าม 1 ใบ เปลี่ยนสภาพไม่ได้ จนจบเทิร์น
  'BT10-064': { react: 1, steps: [{ key: 'q', text: 'ต้องมีเพียง Avatar "นินจา" บน Avatar Zone เรา (เลือก 1 ใบเป็นเงื่อนไข)', opts: (r, i) => r.p[i].av.length && r.p[i].av.every(a => isAv(a) && nmOf(a).includes('นินจา')) ? [r.p[i].av[0].u] : [] }, { key: 't', text: 'เลือก Avatar ฝ่ายตรงข้าม 1 ใบ เปลี่ยนสภาพไม่ได้จนจบเทิร์น', opts: (r, i) => foeAvT(r, i) }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; bt10Lock(t.c, r.g.n); vfx(t.c.u, 'burst', '🔒 เปลี่ยนสภาพไม่ได้', '#64748b'); log(r, '🔒 ผนึกเงา: ' + nmOf(t.c) + ' เปลี่ยนสภาพไม่ได้จนจบเทิร์น'); } },
  // BT10-066 คาถา โปเตกโต้ (React) — เมื่อ "จอมเวทย์" เราต่อสู้: POWER +2 ต่อ "คาถา" ในนรกเรา จนจบการต่อสู้
  'BT10-066': { react: 'atkAv', steps: [{ key: 't', text: 'เลือก Avatar "จอมเวทย์" เราที่ต่อสู้', opts: (r, i) => { const p = r.g.pend; return p && p.k === 'atk' && p.tk === 'av' ? r.p[i].av.filter(a => a.u === p.tg && nmOf(a).includes('จอมเวทย์')).map(a => a.u) : []; } }], run: (r, i, cx) => { const t = find(r, cx.pick.t[0]); if (!t) return; const n = r.p[i].hell.filter(bt10Kaatha).length; t.c.bp = (t.c.bp || 0) + 2 * n; fx({ k: 'buff', u: t.c.u, v: 2 * n }); vfx(t.c.u, 'aura', 'POWER +' + 2 * n, '#8b5cf6'); log(r, '✨ คาถา โปเตกโต้: ' + nmOf(t.c) + ' POWER +' + 2 * n + ' จนจบการต่อสู้'); } },
  // BT10-067 ศาสตราวุธศักดิ์สิทธิ์ โวลุสปา (Modification) — สวมได้เฉพาะ "เทพธิดาแห่งวัลฮัลลา" (ป้องกันทำลาย: bt10Save; ใช้จากนรกเมื่อโดนธรณีสูบ: ตราประทับ mh)
  'BT10-067': { mod: 1, tgf: x => valh10(x) },
  // BT10-068 หยินหยางทอร์นาโด (Modification) — สวมได้เฉพาะ "ตั๊กแตนหยิน"/"ตั๊กแตนหยาง"
  'BT10-068': { mod: 1, tgf: x => !x.tk && isAv(x) && /ตั๊กแตนหยิน|ตั๊กแตนหยาง/.test(nmOf(x)) },
  // BT10-069 อาวุธของเพมมุ ดาบมารไร้พ่าย (Modification) — สวมได้เฉพาะ "เพมมุ" POWER +1; ควบคุม "อาวุธของเพมมุ" ได้ 1 ใบ
  'BT10-069': { mod: 1, tgf: x => !x.tk && isAv(x) && nmOf(x).includes('เพมมุ'), cond: (r, i) => !r.p[i].mg.some(m => /อาวุ[ธร]ของเพมมุ/.test(B[m.id].n)) },
  // BT10-070 ดินแดนยุติธรรม (Land) — ผลต่อเนื่องอยู่ใน bt10Prot
  'BT10-070': { cond: () => true },
  // BT10-060 ผู้มาเยือน — ทิ้ง {เอเลี่ยน} 1 ใบ: อัญเชิญ Avatar {เอเลี่ยน} Cost ตั้งต้น ≤4 จาก Deck แล้วสับ จากนั้นสวมใส่ให้ Avatar นั้น (ถ้าการ์ดนี้ออกจากสนาม ส่ง Avatar ลงนรก)
  'BT10-060': { steps: [{ key: 'd', pay: 1, text: 'ทิ้งการ์ด {เอเลี่ยน} 1 ใบบนมือ', opts: (r, i) => r.p[i].hand.filter(c => symOf(c) === 'เอเลี่ยน' || B[c.id].s === 'เอเลี่ยน').map(c => c.u) }], run: (r, i, cx) => { const p = r.p[i], L = p.deck.filter(c => isAv(c) && (B[c.id].s === 'เอเลี่ยน') && B[c.id].c <= 4).map(c => c.u);
    if (!L.length) { shuf(p.deck); return log(r, 'ผู้มาเยือน: ไม่พบ Avatar {เอเลี่ยน} Cost ≤4 ใน Deck'); }
    ask(r, i, { text: 'ผู้มาเยือน: เลือก Avatar {เอเลี่ยน} Cost ตั้งต้น ≤4 จาก Deck อัญเชิญ', opts: L, cb: us => { const c = p.deck.find(h => h.u === us[0]); if (!c || !summonAny(r, i, c.u, 'deck', cx.card)) return shuf(p.deck); shuf(p.deck); r.g.q.unshift(() => fxSummon(r, i, c));
      const k = p.hell.indexOf(cx.card); if (k >= 0) { p.hell.splice(k, 1); cx.card.at = c.u; cx.card.w60 = 1; p.mg.push(cx.card); vfx(c.u, 'aura', '🛸 ผู้มาเยือน', '#38bdf8'); log(r, '🛸 ผู้มาเยือน: สวมใส่ให้ ' + nmOf(c)); } } }); } },
});
// 054: ใช้ {magic} ที่ไม่ใช่ใบนี้ได้อีก 1 ใบ ถ้ามี "จอมเวทย์" บนสนาม
MG['BT10-054'].run = (r, i) => { tutor(r, i, c => bt10Kaatha(c), 'คาถา'); if (bt10Mage(r, i).length) { r.g.x30 = { n: r.g.n, who: i, done: 0, any: 1, not: 'BT10-054' }; log(r, '📖 เหนือฟ้าใต้หล้า: เทิร์นนี้ใช้ {magic} (ที่ไม่ใช่ใบนี้) เพิ่มได้ 1 ใบ'); } };

// Construct 074 / 073 ฯลฯ ใช้ hook กลาง (handCost/P/hasKw/destroyCo)
// 041 นักรบทองแห่งภาคีมะม่วง: End Phase ถ้าบน Magic Zone เรามี "ต้นมะม่วง" → ตื่น และ POWER +2 จนถึง Draw Phase ต่อไปของเรา
const _bt10End0 = bt10End;
bt10End = function (r) { _bt10End0(r); const ender = 1 - r.g.turn, p = r.p[ender]; if (!p) return;
  p.av.filter(a => a.id === 'BT10-041' && !noFx(r, a) && mTrees10(r, ender).length).forEach(a => { a.tired = false; a.pu10 = r.g.n; vfx(a.u, 'aura', 'ตื่น + POWER +2', '#22c55e'); log(r, '🥭 นักรบทอง: End Phase — ตื่น และ POWER +2 จนถึง Draw Phase ต่อไปของเรา'); }); };
// 048 / 010 ผ่าน bt10Sup เดิม: เสริมส่วนที่เหลือ
const _sup0 = bt10Sup;
bt10Sup = function (r, i, q, recv, bs) { _sup0(r, i, q, recv, bs);
  if (!bs && recv.id === 'BT10-003' && B[q.id].n.includes('พี่ซี๊ด แก๊งขยะ') && !noFx(r, recv)) { r.p[i].av.filter(a => !a.tk && B[a.id].n.includes('แก๊งขยะ')).forEach(a => { addPw(a, 1); vfx(a.u, 'aura', 'POWER +1', '#38bdf8'); }); log(r, '✨ พี่บูม แก๊งขยะ: ได้รับสามัคคีโดยพี่ซี๊ด — Avatar "แก๊งขยะ" ทุกใบ POWER +1'); }
  if (!bs && q.id === 'BT10-048' && !noFx(r, q)) { recv.l48 = r.g.n; vfx(recv.u, 'aura', '🔥 ได้รับสกิล', '#22c55e'); log(r, '✨ เซนเซไฮ: ' + nmOf(recv) + ' ได้รับ "ทำลาย Avatar จากการต่อสู้ → หงาย LIFE" จนจบเทิร์น'); }
  const t = r.p[i].av.find(a => a.id === 'BT10-010' && linked9(r, a) && a.ou !== r.g.n);
  if (t && !bs && linked9(r, q)) { t.ou = r.g.n; q.tired = false; vfx(q.u, 'aura', 'ตื่น', '#22c55e'); log(r, '✨ ซัลลี่วอดก้า (Link): ' + nmOf(q) + ' ใช้ สามัคคี — เปลี่ยนเป็นสภาพตื่น'); } };
/* ===== จบบล็อก BT10 รอบสมบูรณ์ ===== */

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
    if (((a.id === 'BT02-024' || a.id === 'BT06-034' || a.id === 'BT06-038') && !noFx(r, a)) || ((a.id === 'BT02-029' || a.id === 'SD04-004') && !(a.wr && a.wr.length))) return;
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
  if (a.choices) m = { t: 'pick', i: (rnd || a.rps) ? Math.floor(Math.random() * a.choices.length) : 0 };
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
    const r = rooms[c], g = r.g; if (!r.bot || !g || g.over || g.evw) continue;
    const bt = r.bot, k = botIdx(r), hu = r.p[1 - k];
    if (!hu.ws || hu.ws.readyState !== 1 || hu.dc || now < bt.at) continue;
    bt.at = now + (bt.lv === 3 ? 500 : 800) + Math.random() * 500;
    CR = r; if (bt.tn !== g.n) { bt.tn = g.n; bt.tried = new Set(); }
    try { botStep(r, k); } catch (e) { console.error('bot', e); bt.fail++; }
    if (bt.fail >= 10 && !g.over) { bt.fail = 0; console.error('bot stuck -> surrender', c); botAct(r, k, { t: 'surrender' }); }
  }
}
setInterval(botTick, 300);

// ระบบเควส: นับการลงการ์ด/โจมตีของผู้เล่นจริง (ห่อ act ชั้นนอกสุด — นับเมื่อคำสั่งสำเร็จเท่านั้น)
const _actQ = act;
act = function (r, i, m) {
  let pre = null;
  if (m && ['summon', 'build', 'cast', 'atk', 'use'].includes(m.t) && r.g && !r.g.over) { try { const f = m.u != null ? find(r, m.u) : null; pre = { id: f ? f.c.id : null }; } catch (e) { pre = { id: null }; } }
  const out = _actQ(r, i, m);
  if (pre) { try { qCount(r, i, m, pre); } catch (e) { } }
  return out;
};

/* ===== CC01 รอบ 1: Avatar แบบกลไกเดิมของ engine (001,003,005,006,008,010,012,015,017,018,019,020,024) ===== */
Object.assign(B7NK, { 'CC01-006': ['สามัคคี'] });   // ข้อความมีคำ "สามัคคี" แต่ตัวเองไม่ได้ "มี" keyword
const ccFishAv = x => isAv(x) && (symOf(x) === 'ปลา' || also9(x, 'ปลา'));
function modCC1(r, x, f) {   // ต่อเนื่อง (POWER)
  if (x.tk) return 0; let v = 0; const me = r.p[f.i];
  if (ccFishAv(x) && me.av.some(a => a.id === 'CC01-006' && !noFx(r, a))) v += 1;   // ไตรตัน เจ้าสมุทร
  if (x.id === 'CC01-005' && !noFx(r, x)) v += me.life.filter(l => !l.up).length;   // ปื๊ดเปรตกังฟู: +1 ต่อ Life คว่ำ
  v += 3 * (x.wr || []).filter(w => w.id === 'CC01-014').length;   // วูตาตู: ผู้สวมใส่ POWER +3
  r.p.forEach(q => q.mg.forEach(m => { if (m.at === x.u && m.id === 'CC01-047') v += 2; }));   // ตุ๊กตางูพันคอ +2
  if (x.zb === r.g.n && r.g.phase === 'battle') v -= (B[x.id].p || 0) + (x.pw || 0);   // ขอให้ทั้งตัวมีแต่---: POWER ตั้งต้น = 0 จนจบ Battle Phase
  return v;
}
function ccFieldOpts(r, i) {   // การ์ดบนสนามทั้งหมดที่ทำลายได้ (Avatar / Construct / Magic / Land)
  const o = [];
  r.p.forEach((q, qi) => { q.av.forEach(a => { if (qi === i || !protectedFrom(r, i, a, 1)) o.push(a.u); }); q.co.forEach(c => o.push(c.u)); q.mg.forEach(m => o.push(m.u)); });
  if (r.g.land) o.push(r.g.land.c.u);
  return o;
}
function ccDestroyField(r, i, label) {
  const L = ccFieldOpts(r, i); if (!L.length) return log(r, label + ': ไม่มีการ์ดบนสนามให้ทำลาย');
  ask(r, i, { text: label + ': เลือกการ์ดบนสนาม 1 ใบ เพื่อทำลาย', opts: L, cb: us => {
    const u = us[0];
    if (r.g.land && r.g.land.c.u === u) { const lc = r.g.land; r.p[lc.o].hell.push(lc.c); r.g.land = null; log(r, '💥 ' + label + ': ทำลาย Land Magic ' + B[lc.c.id].n); return; }
    vfx(u, 'burst', '💥 ทำลาย', '#ef4444'); destroyAny(r, u);
  } });
}
const cc19Lock = (r, a) => { if (!a.lk19) return false; if (r.p.some(q => q.av.some(k => k.u === a.lk19))) return true; delete a.lk19; return false; };
function ccDeath(r, f) {   // คำสั่งเสีย / เมื่อออกจากสนาม
  const c = f.c, p = r.p[f.i]; if (c.tk) return;
  if (c.id === 'CC01-005') r.g.q.push(() => { vfx(c.u, 'aura', '❤ หงาย LIFE', '#ef4444'); log(r, '❤ ปื๊ดเปรตกังฟู ออกจากสนาม: หงาย LIFE ใบบนสุดของ ' + p.name); lifeUp(r, f.i); });
  if (c.id === 'CC01-012') r.g.q.push(() => {
    fx({ k: 'say', id: c.id, t: 'จั่ว 2' }); draw(r, p, 2); log(r, '✨ เฟรนชี่ คำสั่งเสีย: จั่ว 2 ใบ'); if (!p.hand.length) return;
    ask(r, f.i, { text: 'คำสั่งเสีย เฟรนชี่: เลือกการ์ดบนมือ 1 ใบ วางไว้ล่างสุดของ Deck', opts: p.hand.map(h => h.u), cb: us => { const k = p.hand.findIndex(h => h.u === us[0]); if (k < 0) return; const h = p.hand.splice(k, 1)[0]; p.deck.unshift(h); log(r, '⬇ นำการ์ด 1 ใบจากมือไว้ล่างสุดของ Deck'); } });
  });
}
function ccEnd(r) {   // จบเทิร์น: ผู้เจริญที่อัญเชิญจาก เสามงคล ทรงจีน กลับขึ้นมือ
  const g = r.g;
  r.p.forEach(q => q.av.slice().forEach(a => { if (a.cc18 === g.n) { delete a.cc18; q.av.splice(q.av.indexOf(a), 1); a.tired = false; a.pw = 0; a.tp = 0; a.bp = 0; q.hand.push(a); vfx(a.u, 'aura', '↩ กลับขึ้นมือ', '#22c55e'); log(r, '↩ จบเทิร์น: ' + nmOf(a) + ' กลับขึ้นมือ'); } }));
}
function ccRedirect(r, i, c, ctx, def) {   // 017 ยักษ์หินแผ่นดินใหญ่: เป้าหมายของ Magic เป็น Avatar {ยักษ์} → นอน แล้วย้ายเป้ามาที่ใบนี้
  if (c.t !== 'Magic' || def.mod || c.st !== 'Normal') return;
  const o = 1 - i;
  for (const k of Object.keys(ctx.pick || {})) {
    const us = ctx.pick[k]; if (!Array.isArray(us)) continue;
    for (let ix = 0; ix < us.length; ix++) {
      const f = find(r, us[ix]); if (!f || f.z !== 'av' || f.i !== o || !(symOf(f.c) === 'ยักษ์' || also9(f.c, 'ยักษ์'))) continue;
      const g = r.p[o].av.find(a => a.id === 'CC01-017' && !a.tired && !noFx(r, a) && a.u !== f.c.u); if (!g) continue;
      return ask(r, o, { yn: true, text: 'ยักษ์หินแผ่นดินใหญ่: ' + nmOf(f.c) + ' ตกเป็นเป้าหมายของ Magic "' + c.n + '" — เปลี่ยนเป็นสภาพนอน แล้วย้ายเป้าหมายมาที่ยักษ์หินแทนไหม?', cb: y => {
        if (!y || g.tired || !find(r, g.u)) return; g.tired = true; ctx.pick[k][ix] = g.u;
        vfx(g.u, 'burst', '🪨 รับแทน!', '#22c55e'); fx({ k: 'say', id: g.id, t: 'ย้ายเป้าหมาย' }); log(r, '🛡 ยักษ์หินแผ่นดินใหญ่: นอน และเปลี่ยนเป้าหมาย Magic ' + c.n + ' มาที่ตัวเอง');
      } });
    }
  }
}
Object.assign(SUM, {
  'CC01-003': (r, i, x) => {   // พระพรหม: นรกมี Avatar ชื่อไม่ซ้ำ ≥5 → สอดแนม 7 ใบ นำ Avatar ชื่อไม่ซ้ำลง Avatar Zone ที่เหลือกลับ Deck แล้วสับ
    const p = r.p[i], hn = new Set(p.hell.filter(h => !h.tk && isAv(h)).map(h => B[h.id].n.trim()));
    if (hn.size < 5) return log(r, 'จุติ พระพรหม: นรกมี Avatar ชื่อไม่ซ้ำ ' + hn.size + ' ใบ (ต้อง 5 ใบขึ้นไป) — ไม่เกิดผล');
    const seen = p.deck.slice(-7).reverse(); fx({ k: 'scout', i, ids: seen.map(c => c.kd || c.id) }); log(r, '🔎 ' + p.name + ': สอดแนม ' + seen.length + ' ใบ (พระพรหม)');
    const zn = new Set(p.av.map(a => nmOf(a).trim())), cand = seen.filter(c => isAv(c) && !zn.has(B[c.id].n.trim())).map(c => c.u);
    const fin = us => {
      const used = new Set(zn), put = [];
      (us || []).forEach(u => { const c = p.deck.find(k => k.u === u); if (!c) return; const n = B[c.id].n.trim(); if (used.has(n)) return; used.add(n); if (summonAny(r, i, c.u, 'deck', x)) put.push(c); });
      shuf(p.deck); log(r, '👑 พระพรหม: อัญเชิญ ' + put.length + ' ใบ ที่เหลือกลับเข้า Deck แล้วสับ');
      put.forEach(c => { vfx(c.u, 'burst', '👑 พระพรหมสร้าง', '#f59e0b'); r.g.q.unshift(() => fxSummon(r, i, c)); });
    };
    if (!cand.length) { shuf(p.deck); return log(r, 'ไม่มี Avatar ชื่อไม่ซ้ำให้ลง Avatar Zone (สับ Deck)'); }
    ask(r, i, { text: 'จุติ พระพรหม: เลือก Avatar ชื่อไม่ซ้ำกันกี่ใบก็ได้ ลง Avatar Zone (ที่เหลือกลับเข้า Deck แล้วสับ)', opts: cand, n: cand.length, min: 0, cb: fin, none: () => fin([]) });
  },
  'CC01-006': (r, i, x) => {   // ไตรตัน: อัญเชิญ Avatar {ปลา} จากนรก Cost รวมไม่เกิน 7
    const p = r.p[i]; let left = 7;
    const step = () => {
      const L = p.hell.filter(h => !h.tk && !h.h40 && ccFishAv(h) && B[h.id].c <= left).map(h => h.u); if (!L.length) return;
      ask(r, i, { text: 'จุติ ไตรตัน: เลือก Avatar {ปลา} จากนรก (Cost รวมเหลือ ' + left + ') — ยกเลิก = หยุด', opts: L, cancel: true, cb: us => {
        const c = p.hell.find(h => h.u === us[0]); if (!c) return; const cost = B[c.id].c;
        if (summonAny(r, i, c.u, 'hell', x)) { left -= cost; vfx(c.u, 'burst', '🔱 ไตรตันเรียก', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); r.g.q.push(step); }
      } });
    };
    step();
  },
  'CC01-008': (r, i) => tutor(r, i, c => !c.tk && B[c.id].n.trim() === 'แมลงปอทอด', 'แมลงปอทอด'),
  'CC01-010': (r, i) => tutor(r, i, c => !c.tk && B[c.id].t === 'Magic' && B[c.id].n.trim().startsWith('สมชายห้องเช่า'), 'Magic "สมชายห้องเช่า"'),
  'CC01-015': (r, i, x) => { const p = r.p[i];
    scout(r, i, 2, { text: 'จุติ HR: เลือกการ์ด 1 ใบจากที่สอดแนม ขึ้นมือ', pred: () => true, by: x, then: (got, seen) => {
      if (got) { p.hand.push(got); log(r, '✨ HR ผู้รู้ความจริง: นำ ' + B[got.id].n + ' ขึ้นมือ'); }
      const rest = seen.filter(c => c !== got && p.deck.includes(c)); if (!rest.length) return;
      ask(r, i, { yn: true, text: 'HR ผู้รู้ความจริง: วางการ์ดที่เหลือไว้ "บนสุด" ของ Deck ไหม? (ไม่ = ล่างสุด)', cb: y => { if (y) return log(r, '⬆ วางการ์ดที่เหลือไว้บนสุดของ Deck'); rest.forEach(c => p.deck.splice(p.deck.indexOf(c), 1)); p.deck.unshift(...rest); log(r, '⬇ วางการ์ดที่เหลือไว้ล่างสุดของ Deck'); } });
    } });
  },
  'CC01-018': (r, i, x) => {   // เสามงคล ทรงจีน: อัญเชิญ "ผู้เจริญ" จาก Deck จบเทิร์นกลับขึ้นมือ
    const p = r.p[i], L = p.deck.filter(c => !c.tk && isAv(c) && B[c.id].n.includes('ผู้เจริญ')).map(c => c.u);
    if (!L.length) { shuf(p.deck); return log(r, 'จุติ เสามงคล ทรงจีน: ไม่พบ "ผู้เจริญ" ใน Deck (สับ Deck)'); }
    const go = u => { const c = p.deck.find(k => k.u === u), ok = c && summonAny(r, i, c.u, 'deck', x); shuf(p.deck); if (ok) { c.cc18 = r.g.n; vfx(c.u, 'burst', '🌳 ผู้เจริญมาแล้ว', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } };
    if (new Set(L.map(u => B[p.deck.find(c => c.u === u).id].n)).size === 1) return go(L[0]);
    ask(r, i, { text: 'จุติ: เลือก "ผู้เจริญ" 1 ใบจาก Deck อัญเชิญ (จบเทิร์นกลับขึ้นมือ)', opts: L, cb: us => go(us[0]) });
  },
});
SUM['CC01-001'] = (r, i) => ccDestroyField(r, i, 'พระอิศวร');
Object.assign(ABIL, {
  'CC01-001': { zone: 'av', once: 1, label: 'ทำลายการ์ดบนสนาม 1 ใบ', cond: (r, i) => ccFieldOpts(r, i).length > 0, run: (r, i) => ccDestroyField(r, i, 'พระอิศวร') },
  'CC01-019': { zone: 'av', once: 1, label: 'นอน Avatar ฝ่ายตรงข้าม + ล็อกไม่ให้ตื่น', cond: (r, i) => r.p[1 - i].av.some(a => !protectedFrom(r, i, a, 1)),
    run: (r, i, x) => {
      const L = r.p[1 - i].av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u);
      ask(r, i, { text: 'หมวดเงียบ: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ (ถ้าตื่นให้นอน และไม่ตื่นจนกว่าหมวดเงียบจะออกจาก Avatar Zone)', opts: L, cb: us => {
        const t = find(r, us[0]); if (!t) return; t.c.tired = true; t.c.lk19 = x.u;
        vfx(t.c.u, 'aura', '💤 นอน ล็อก', '#64748b'); log(r, '💤 หมวดเงียบ: ' + nmOf(t.c) + ' เป็นสภาพนอน และไม่เปลี่ยนเป็นสภาพตื่นจนกว่าหมวดเงียบจะออกจากสนาม');
      } });
    } },
});


/* ===== CC01 รอบ 2: Avatar กลไกใหม่ (007,009,011,013,014,016) ===== */
function ccName(x) {   // 009 ชู้รักรัททาทุย: ถ้าเคยอัญเชิญ "รัททาทุย นางพญา" ในเกมนี้ → บน Avatar Zone นับเป็นชื่อนั้น
  if (x.tk || x.id !== 'CC01-009' || !CR) return null;
  return CR.p.some(q => q.qn && q.av.includes(x)) ? 'รัททาทุย นางพญา' : null;
}
function ccAlias(x) {   // 011 พญายม: Avatar {นรก} ในนรกฝ่ายเรา ได้รับชื่อ "นายนิรยบาล"
  if (x.tk || !CR || !B[x.id] || B[x.id].t !== 'Avatar' || B[x.id].s !== 'นรก') return '';
  return CR.p.some(q => q.hell.includes(x) && q.av.some(a => a.id === 'CC01-011' && !noFx(CR, a))) ? ' / นายนิรยบาล' : '';
}
const ccNoAdd = (r, i) => r.p[i].av.some(a => a.id === 'CC01-016' && !noFx(r, a));   // 016: ผู้ควบคุมนำการ์ดขึ้นมือจาก Deck ด้วยความสามารถไม่ได้
function ccNote(r, i, c) {   // เรียกจาก noteSum (ทุกครั้งที่อัญเชิญ)
  if (c.tk) return;
  if (B[c.id].n.trim() === 'รัททาทุย นางพญา') r.p[i].qn = 1;
  r.g.q.push(() => r.p.forEach((q, qi) => q.av.slice().forEach(a => {   // 016 แมวนิค: เทิร์นละครั้ง เมื่อมีการอัญเชิญ Avatar → เปลี่ยนการควบคุมไปฝั่งตรงข้าม
    if (a.id !== 'CC01-016' || noFx(r, a) || a.cc16 === r.g.n) return; a.cc16 = r.g.n;
    if (stealCard(r, 1 - qi, a.u)) { a.tired = false; vfx(a.u, 'burst', '🐱 ย้ายฝั่ง', '#a855f7'); fx({ k: 'say', id: a.id, t: 'เปลี่ยนการควบคุม' }); log(r, '🐱 แมวนิค: มีการอัญเชิญ Avatar — ย้ายไปอยู่ Avatar Zone ของ ' + r.p[1 - qi].name); }
  })));
}
function ccEndPhase(r, i) {   // 013 เจนนี่: ทุก End Phase ของทั้ง 2 ฝ่าย ทอยลูกเต๋า
  const list = []; r.p.forEach((q, qi) => q.av.forEach(a => { if (a.id === 'CC01-013' && !noFx(r, a)) list.push({ a, qi }); }));
  list.forEach(({ a }) => r.g.q.push(() => {
    const f = find(r, a.u); if (!f || f.z !== 'av') return; const d = bt6Dice(r, f.i);
    if (d === 4) { vfx(a.u, 'burst', '💥 เจนนี่แตก', '#ef4444'); log(r, '💥 เจนนี่: ออก 4 — ทำลาย และหงาย LIFE ของ ' + r.p[f.i].name); kill(r, f.i, a.u); r.g.q.push(() => lifeUp(r, f.i)); }
    else if (stealCard(r, 1 - f.i, a.u)) { a.tired = false; vfx(a.u, 'burst', '🔄 เปลี่ยนมือ', '#a855f7'); log(r, '🔄 เจนนี่: ย้ายไปอยู่ฝั่ง ' + r.p[1 - f.i].name); }
  }));
}
function ccAfterBattle(r, p, a) {   // 007 วีรบุรุษสุดซอย: หลังจบการต่อสู้ที่สั่งโจมตี ถ้าสวม กุ่ย ฮอล นาย ครบ → ส่งลงนรก แล้วอัญเชิญวีรบุรุษปากซอยจากมือ/Deck
  if (!a || a.id !== 'CC01-007' || noFx(r, a)) return;
  const nm = ['กุ่ย', 'ฮอล', 'นาย'], has3 = () => nm.every(n => (a.wr || []).some(w => B[w.id].n.trim() === n));
  r.g.q.push(() => {
    const f = find(r, a.u); if (!f || f.z !== 'av' || !has3()) return; const i = f.i, me = r.p[i];
    vfx(a.u, 'burst', '🦸 วีรบุรุษปากซอย', '#38bdf8'); log(r, '🦸 วีรบุรุษสุดซอย: สวมครบ กุ่ย/ฮอล/นาย — ส่งลงนรก แล้วอัญเชิญ วีรบุรุษปากซอย'); sendHell(r, a.u);
    const hp = c => !c.tk && B[c.id].n.trim() === 'วีรบุรุษปากซอย', H = me.hand.filter(hp).map(c => c.u), D = me.deck.filter(hp).map(c => c.u);
    const go = (u, from) => { const c = me[from].find(k => k.u === u); const ok = c && summonAny(r, i, u, from); if (from === 'deck') shuf(me.deck); if (ok) { vfx(c.u, 'burst', '🦸 มาแล้ว', '#38bdf8'); r.g.q.unshift(() => fxSummon(r, i, c)); } };
    if (!H.length && !D.length) return log(r, 'ไม่พบ วีรบุรุษปากซอย บนมือหรือใน Deck');
    if (H.length && D.length) return ask(r, i, { yn: true, text: 'วีรบุรุษปากซอย: อัญเชิญจากมือ? (ไม่ = จาก Deck)', cb: y => y ? go(H[0], 'hand') : go(D[0], 'deck') });
    H.length ? go(H[0], 'hand') : go(D[0], 'deck');
  });
}
function ccWoo(r, f, w) {   // 014 วูตาตู: ผู้สวมใส่ออกจากสนาม → นำไปสวมให้ Avatar ใบอื่นของฝ่ายเรา (true = ย้ายต่อ ไม่ลงนรก)
  if (w.id !== 'CC01-014' || !r.p[f.i].av.some(a => a.u !== f.c.u && canWear(a, w))) return false;
  const i = f.i, ow = f.c.u;
  r.g.q.push(() => {
    const L = r.p[i].av.filter(a => a.u !== ow && canWear(a, w)).map(a => a.u);
    if (!L.length) { r.p[i].hell.push(w); return log(r, 'วูตาตู: ไม่มี Avatar ให้สวมใส่ต่อ — ลงนรก'); }
    const put = u => { const t = find(r, u); if (!t || t.z !== 'av') return r.p[i].hell.push(w); wearOn(r, i, t.c, w); vfx(t.c.u, 'aura', '👻 วูตาตูย้ายมา', '#a855f7'); log(r, '👻 วูตาตู: ผู้สวมใส่ถูกทำลาย ย้ายไปสวมให้ ' + nmOf(t.c)); };
    if (L.length === 1) return put(L[0]);
    ask(r, i, { text: 'วูตาตู: เลือก Avatar ใบอื่นของเรา เพื่อสวมใส่ต่อ', opts: L, cb: us => put(us[0]) });
  });
  return true;
}
Object.assign(SUM, {
  'CC01-007': (r, i, x) => {   // จุติ: นำ กุ่ย ฮอล นาย จากนรกอย่างละ 1 ใบ มาสวมใส่ให้ Avatar ใบนี้
    const p = r.p[i];
    ['กุ่ย', 'ฮอล', 'นาย'].forEach(n => { const c = p.hell.find(h => !h.tk && !h.h40 && isAv(h) && B[h.id].n.trim() === n); if (!c || !find(r, x.u) || !canWear(x, c)) return log(r, 'จุติ วีรบุรุษสุดซอย: ไม่พบ "' + n + '" ในนรก'); const w = fromZone(r, i, 'hell', c.u); w && wearOn(r, i, x, w); });
    vfx(x.u, 'aura', '🦸 สวมใส่ กุ่ย/ฮอล/นาย', '#38bdf8');
  },
});
Object.assign(ABIL, {
  'CC01-011': { zone: 'av', once: 1, label: 'อัญเชิญ "นายนิรยบาล" จากนรก', cond: (r, i) => r.p[i].hell.some(h => !h.tk && !h.h40 && isAv(h) && nmOf(h).includes('นายนิรยบาล')),
    run: (r, i, x) => {
      const p = r.p[i], L = p.hell.filter(h => !h.tk && !h.h40 && isAv(h) && nmOf(h).includes('นายนิรยบาล')).map(h => h.u);
      ask(r, i, { text: 'พญายม: เลือก Avatar "นายนิรยบาล" จากนรก อัญเชิญลง Avatar Zone', opts: L, cb: us => { const c = p.hell.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'hell', x)) { vfx(c.u, 'burst', '💀 พญายมเรียก', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); } } });
    } },
  'CC01-014': { zone: 'av', once: 1, label: 'สวมใส่ให้ Avatar ใบอื่น (Symbol ผี, POWER +3)', cond: (r, i, x) => r.p[i].av.some(a => a.u !== x.u && canWear(a, x)),
    run: (r, i, x) => {
      const L = r.p[i].av.filter(a => a.u !== x.u && canWear(a, x)).map(a => a.u);
      ask(r, i, { text: 'วูตาตู: เลือก Avatar ของเรา 1 ใบ ที่จะสวมใส่ วูตาตู', opts: L, cancel: true, cb: us => { const t = find(r, us[0]); if (!t || !find(r, x.u)) return; take(r, x.u); wearOn(r, i, t.c, x); vfx(t.c.u, 'aura', '👻 สวมวูตาตู (ผี +3)', '#a855f7'); } });
    } },
});


/* ===== CC01 รอบ 3: Magic (042-047, 049-051) ===== */
const ccWornBy = (r, a, id) => r.p.some(q => q.mg.some(m => m.at === a.u && m.id === id));
function ccMustAtk(r, i) {   // 047 ตุ๊กตางูพันคอ: Avatar ที่สวมใส่ถ้าโจมตีได้ ต้องสั่งโจมตี (บล็อกการจบ Battle Phase)
  const g = r.g; if (g.n === 0) return;
  const bad = a => ['BT02-024', 'BT04-029', 'CC01-013', 'CC01-018', 'BT07-032', 'BT06-034', 'BT06-038'].includes(a.id) || a.noatk === g.n || bt6Banned(r, i, a) || bt9NoAtk(r, a)
    || (a.id === 'BT03-009' && r.p[i].hand.length) || (['BT02-029', 'SD04-004'].includes(a.id) && !(a.wr && a.wr.length)) || (a.id === 'BT08-043' && (a.wr || []).filter(w => B[w.id].t === 'Avatar').length < 2)
    || (g.onlyBug && g.onlyBug.n === g.n && g.onlyBug.i === i && !isInsect(r, a));
  if (r.p[i].av.some(a => !a.tired && !bad(a) && (ccWornBy(r, a, 'CC01-047') || ccWornBy(r, a, 'CC02-048')))) E('ตุ๊กตางูพันคอ: Avatar ที่สวมใส่ต้องสั่งโจมตี (ถ้าโจมตีได้)');
}
function ccDrawPhase(r, i) {   // 051 สมชายห้องเช่าพันล้าน: ก่อนเริ่ม Main Phase จั่วตามจำนวน "เสามงคล" บนสนามของตน
  const g = r.g; if (!landIs(r, 'CC01-051') || g.land.o !== i) return;
  const p = r.p[i], n = p.av.filter(a => nmOf(a).trim() === 'เสามงคล').length + p.co.filter(c => B[c.id].n.trim() === 'เสามงคล').length;
  if (!n) return; draw(r, p, n); vfx(g.land.c.u, 'burst', '🏢 จั่ว ' + n, '#f59e0b'); log(r, '🏢 สมชายห้องเช่าพันล้าน: มี "เสามงคล" ' + n + ' ใบ — จั่ว ' + n + ' ใบ');
}
function ccToDeck(r, u) {   // นำ Avatar บนสนามกลับเข้า Deck เจ้าของ แล้วสับ
  const f = find(r, u); if (!f || f.z !== 'av') return; const c = take(r, u).c, o = f.i;
  if (c.tk) return log(r, '↩ ' + nmOf(c) + ' (โทเคน) หายไป');
  Object.assign(c, { pw: 0, tp: 0, bp: 0, tired: false }); delete c.oo; delete c.ctl; r.p[o].deck.push(c); shuf(r.p[o].deck);
  vfx(u, 'burst', '↩ กลับเข้า Deck', '#38bdf8'); log(r, '↩ ' + nmOf(c) + ' กลับเข้า Deck ของ ' + r.p[o].name + ' แล้วสับ');
}
const ccTank = c => !c.tk && isAv(c) && isTank(c);   // "รถถัง" (ไม่มีรถถัง Cost 3 ในเกม — Cost 3 ในข้อความการ์ดนับกับ Tank Ranger)
const ccRanger = c => !c.tk && isAv(c) && B[c.id].c === 3 && B[c.id].n.includes('Tank Ranger') && !B[c.id].n.trim().startsWith('รถถัง');
Object.assign(MG, {
  'CC01-042': { run: (r, i) => {   // พรของอิศวร: เลือกปฏิบัติ 1 ใน 3
    const p = r.p[i], o = r.p[1 - i], T = () => o.av.filter(a => !protectedFrom(r, i, a, 1)).map(a => a.u), H = () => p.hell.filter(h => !h.h40).map(h => h.u);
    const o1 = () => { const n = 5 - p.hand.length; if (n > 0) { draw(r, p, n); log(r, '✨ พรของอิศวร: จั่ว ' + n + ' ใบ ให้มือครบ 5 ใบ'); } };
    const o2 = () => ask(r, i, { text: 'พรของอิศวร: เลือก Avatar ฝ่ายตรงข้ามไม่เกิน 2 ใบ ทำลาย', opts: T(), n: Math.min(2, T().length), min: 1, cb: us => us.forEach(u => { vfx(u, 'burst', '💥 พรอิศวร', '#ef4444'); destroyAv(r, u); }) });
    const o3 = () => ask(r, i, { text: 'พรของอิศวร: เลือกการ์ดจากนรก 2 ใบ ขึ้นมือ', opts: H(), n: Math.min(2, H().length), min: Math.min(2, H().length), cb: us => us.forEach(u => { const c = fromZone(r, i, 'hell', u); if (c) { p.hand.push(c); vfx(c.u, 'aura', '✨ ขึ้นมือ', '#f59e0b'); } }) });
    const ch = [], fn = []; if (p.hand.length < 5) { ch.push('1) จั่วให้การ์ดบนมือครบ 5 ใบ'); fn.push(o1); } if (T().length) { ch.push('2) ทำลาย Avatar ฝ่ายตรงข้ามไม่เกิน 2 ตัว'); fn.push(o2); } if (H().length) { ch.push('3) นำการ์ดจากนรกขึ้นมือ 2 ใบ'); fn.push(o3); }
    if (!ch.length) return log(r, 'พรของอิศวร: ไม่มีตัวเลือกที่ทำได้'); if (ch.length === 1) return fn[0]();
    ask(r, i, { choices: ch, text: 'พรของอิศวร: เลือกปฏิบัติ', cb: k => fn[k]() });
  } },
  'CC01-043': { cond: r => r.p.some((q, qi) => q.av.some(a => (a.ctl && a.ctl.from !== qi) || (a.oo != null && a.oo !== qi))),
    run: r => { let n = 0;   // รู้สึกเหมือนโดนแย่งเมีย: Avatar ที่ถูกเปลี่ยนการควบคุม → กลับเจ้าของเดิม
      r.p.forEach((q, qi) => q.av.slice().forEach(a => { const o = a.ctl ? a.ctl.from : a.oo; if (o == null || o === qi) return;
        take(r, a.u); delete a.ctl; delete a.oo; delete a.nolife;
        if (canPlaceAv(r, o, a)) { a.tired = false; r.p[o].av.push(a); n++; vfx(a.u, 'aura', '↩ กลับเจ้าของเดิม', '#38bdf8'); } else r.p[o].hell.push(a); }));
      log(r, '💢 รู้สึกเหมือนโดนแย่งเมีย: Avatar ' + n + ' ใบ กลับไปอยู่กับเจ้าของเดิม'); } },
  'CC01-044': { cond: (r, i) => !r.p[i].av.length && r.p[1 - i].av.length > 0 && r.p[i].hell.some(ccTank) && r.p[i].hell.some(ccRanger),
    steps: [{ key: 't', text: 'ซ่อมบำรุง: เลือก Avatar "รถถัง" Cost 3 จากนรก', opts: (r, i) => r.p[i].hell.filter(ccTank).map(c => c.u) }, { key: 'w', text: 'ซ่อมบำรุง: เลือก Avatar "Tank Ranger" Cost 3 จากนรก (สวมใส่)', opts: (r, i) => r.p[i].hell.filter(ccRanger).map(c => c.u) }],
    run: (r, i, cx) => { const tu = cx.pick.t[0]; if (!summonAny(r, i, tu, 'hell')) return log(r, 'ซ่อมบำรุง: อัญเชิญรถถังไม่ได้');
      const t = find(r, tu); if (!t) return; const w = fromZone(r, i, 'hell', cx.pick.w[0]); if (w) wearOn(r, i, t.c, w);
      vfx(tu, 'burst', '🔧 ซ่อมบำรุงเสร็จ', '#f97316'); log(r, '🔧 ซ่อมบำรุงประจำปี: อัญเชิญ ' + nmOf(t.c) + ' และสวมใส่ ' + (w ? nmOf(w) : '-')); r.g.q.unshift(() => fxSummon(r, i, t.c)); } },
  'CC01-045': { cond: r => r.p[0].av.length > 0 && r.p[1].av.length > 0,
    run: (r, i) => {   // กฎร้าน: เทียบ Cost การ์ดใบล่างสุดของ Deck
      const cost = q => { const c = q.deck[0]; return c && !c.tk && isAv(c) ? (B[c.id].c || 0) : 0; }, nm = q => q.deck[0] ? B[q.deck[0].id].n : '(Deck ว่าง)', v = [cost(r.p[0]), cost(r.p[1])];
      log(r, '📜 กฎร้าน: ใบล่างสุด ' + r.p[0].name + ' = ' + nm(r.p[0]) + ' (Cost ' + v[0] + ') · ' + r.p[1].name + ' = ' + nm(r.p[1]) + ' (Cost ' + v[1] + ')');
      r.p.forEach((q, qi) => q.deck[0] && fx({ k: 'say', id: q.deck[0].kd || q.deck[0].id, t: 'Cost ' + v[qi] }));
      if (v[0] === v[1]) return log(r, '📜 กฎร้าน: Cost เท่ากัน ไม่มีผลใดเกิดขึ้น');
      const w = v[0] > v[1] ? 0 : 1; log(r, '📜 กฎร้าน: ' + r.p[w].name + ' Cost มากกว่า ได้สิทธิ์เลือกปฏิบัติ');
      const A1 = () => r.p[1 - w].av.filter(a => !protectedFrom(r, w, a, 1)).map(a => a.u), A2 = () => [...r.p[0].av, ...r.p[1].av].filter(a => a.u && (!a.tk || true) && (find(r, a.u).i === w || !protectedFrom(r, w, a, 1))).map(a => a.u);
      const o1 = () => ask(r, w, { text: 'กฎร้าน: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ส่งลงนรก', opts: A1(), cb: us => { vfx(us[0], 'burst', '☠ ลงนรก', '#ef4444'); sendHell(r, us[0]); } });
      const o2 = () => ask(r, w, { text: 'กฎร้าน: เลือก Avatar 1 ใบบนสนาม กลับเข้า Deck เจ้าของ แล้วสับ', opts: A2(), cb: us => ccToDeck(r, us[0]) });
      const ch = [], fn = []; if (A1().length) { ch.push('1) ส่ง Avatar ฝ่ายตรงข้าม 1 ใบ ลงนรก'); fn.push(o1); } if (A2().length) { ch.push('2) นำ Avatar 1 ใบบนสนาม กลับเข้า Deck เจ้าของ แล้วสับ'); fn.push(o2); }
      if (!ch.length) return; if (ch.length === 1) return fn[0](); ask(r, w, { choices: ch, text: 'กฎร้าน: เลือกปฏิบัติ', cb: k => fn[k]() }); } },
  'CC01-046': { react: 'atk', steps: [{ key: 't', text: 'ขอให้ทั้งตัวมีแต่---: เลือก Avatar ที่กำลังต่อสู้ 1 ใบ', opts: (r, i, cx) => [cx.pend && cx.pend.u, cx.pend && cx.pend.tk === 'av' && cx.pend.tg].filter(u => u && find(r, u) && find(r, u).z === 'av') }],
    run: (r, i, cx) => { const f = find(r, cx.pick.t[0]); if (!f) return; f.c.zb = r.g.n; fx({ k: 'say', id: f.c.kd || f.c.id, t: 'POWER ตั้งต้น = 0' }); vfx(f.c.u, 'aura', 'POWER ตั้งต้น 0', '#ef4444'); log(r, '🧊 ขอให้ทั้งตัวมีแต่---: POWER ตั้งต้นของ ' + nmOf(f.c) + ' เป็น 0 จนจบ Battle Phase'); } },
  'CC01-047': { mod: 1 },
});
Object.assign(AB, {
  'CC01-049': { z: 'land', steps: [{ key: 'd', pay: 1, text: 'Micro Plaza: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i) => { fx({ k: 'say', id: 'CC01-049', t: 'ค้น Modification' }); tutor(r, i, c => !c.tk && B[c.id].t === 'Magic' && B[c.id].st === 'Modification', 'Modification Magic'); } },
  'CC01-050': { z: 'land', can: (r, i) => r.p[i].hand.length > 0 || r.p[i].mg.some(m => m.mgAv && isAv(m)),
    run: (r, i, cx) => { const p = r.p[i], MA = () => p.mg.filter(m => m.mgAv && isAv(m) && m.mgOwner === i && canPlaceAv(r, i, m)).map(m => m.u);
      const o1 = () => ask(r, i, { text: 'SD Plaza: ทิ้งการ์ดจากมือ 1 ใบ เพื่อสอดแนม Deck 3 ใบ', opts: p.hand.map(c => c.u), cancel: true, cb: us => { const d = fromZone(r, i, 'hand', us[0]); if (!d) return; p.hell.push(d);
        scout(r, i, 3, { text: 'SD Plaza: เลือก Avatar 1 ใบ วางที่ Magic Zone (สภาพตื่น) — ที่เหลือไว้ใต้ Deck', pred: c => isAv(c), by: cx.card, rest: 'bottom', then: got => { if (!got) return log(r, 'SD Plaza: ไม่มี Avatar ในการ์ดที่สอดแนม');
          Object.assign(got, { pw: 0, tp: 0, bp: 0, tired: false, mgAv: 1, mgOwner: i }); p.mg.push(got); vfx(got.u, 'aura', '🏙 วางใน Magic Zone', '#38bdf8'); log(r, '🏙 SD Plaza: วาง ' + B[got.id].n + ' ไว้ที่ Magic Zone'); } }); } });
      const o2 = () => ask(r, i, { text: 'SD Plaza: เลือก Avatar ใน Magic Zone ของเรา อัญเชิญลง Avatar Zone (สภาพตื่น)', opts: MA(), cancel: true, cb: us => { const m = p.mg.find(k => k.u === us[0]); if (!m) return; const o = mgOut(r, m, 'hand');
        if (summonAny(r, o, m.u, 'hand')) { vfx(m.u, 'burst', '🏙 อัญเชิญ', '#38bdf8'); log(r, '🏙 SD Plaza: อัญเชิญ ' + nmOf(m) + ' จาก Magic Zone'); r.g.q.unshift(() => fxSummon(r, o, m)); } else { Object.assign(m, { mgAv: 1, mgOwner: i }); p.hand.splice(p.hand.indexOf(m), 1); p.mg.push(m); } } });
      const ch = [], fn = []; if (p.hand.length) { ch.push('1) ทิ้งมือ 1 ใบ: สอดแนม 3 เลือก Avatar วางที่ Magic Zone'); fn.push(o1); } if (MA().length) { ch.push('2) อัญเชิญ Avatar จาก Magic Zone ลง Avatar Zone'); fn.push(o2); }
      if (!ch.length) return; if (ch.length === 1) return fn[0](); ask(r, i, { choices: ch, text: 'SD Plaza: เลือกปฏิบัติ', cb: k => fn[k]() }); } },
  'CC01-051': { z: 'land', steps: [{ key: 'd', pay: 1, text: 'สมชายห้องเช่าพันล้าน: ทิ้งการ์ดจากมือ 1 ใบ', opts: (r, i) => r.p[i].hand.map(c => c.u) }],
    run: (r, i) => { const p = r.p[i], L = p.deck.filter(c => !c.tk && isAv(c) && B[c.id].n.trim() === 'เสามงคล').map(c => c.u);
      const go = u => { if (u != null) { const c = p.deck.find(k => k.u === u); if (c && summonAny(r, i, u, 'deck')) { vfx(u, 'burst', '🏢 เสามงคลโผล่', '#f59e0b'); r.g.q.unshift(() => fxSummon(r, i, c)); } } shuf(p.deck); };
      if (!L.length) { shuf(p.deck); return log(r, 'สมชายห้องเช่าพันล้าน: ไม่พบ "เสามงคล" ใน Deck (สับ Deck)'); }
      ask(r, i, { text: 'สมชายห้องเช่าพันล้าน: เลือก "เสามงคล" จาก Deck อัญเชิญ (ยกเลิก = ไม่อัญเชิญ)', opts: L, cancel: true, cb: us => go(us[0]), none: () => go(null) }); } },
});

/* =====================================================================
   ===== CC02 (Box of Champions 2) — สกิล + อนิเมชั่นระดับกลาง =====
   การ์ดพิมพ์ซ้ำ  : 023→BT03-002, 029→BT04-016, 051→BT02-041, 052→BT03-046, 058→BT03-055, FPRO-006→CC02-039
   การ์ดใหม่ที่ทำในบล็อกนี้ : Avatar 001-020 + 039 / Magic 041-050
   อนิเมชั่น: vfx ชนิดเดิม (aura/burst) + ชนิดใหม่ ring / rise / slash / bolt / beam (ดู index.html)
   ===================================================================== */
Object.assign(CANON, { 'CC02-023': 'BT03-002', 'CC02-029': 'BT04-016', 'CC02-051': 'BT02-041', 'CC02-052': 'BT03-046', 'CC02-058': 'BT03-055', 'FPRO-006': 'CC02-039' });

const CCOL = { 'แดง': '#ef4444', 'ฟ้า': '#38bdf8', 'ม่วง': '#a855f7', 'เขียว': '#22c55e' };
const cc2Fish = c => !!c && !c.tk && isAv(c) && (symOf(c) === 'ปลา' || also9(c, 'ปลา'));
const cc2Swamp = r => !!(r.g.land && (r.g.land.c.id === 'SD05-014' || r.g.land.c.id === 'CC02-050' || B[r.g.land.c.id].n.trim() === 'บึงทมิฬ'));
const cc2Col = (c, col) => !c.tk && !!B[c.id] && (B[c.id].col === col || B[c.id].gc === col);
const cc2Only = c => /only/i.test((B[c.id] && B[c.id].o) || '');
const cc2Jt = c => !c.tk && isAv(c) && /จุติ/.test(B[c.id].e || '');
const cc2KP = c => !c.tk && isAv(c) && B[c.id].n.includes('ขุนพล') && B[c.id].col === 'ม่วง' && B[c.id].s === 'ต่างชาติ';
const cc2Mods = (r, a) => r.p.flatMap(q => q.mg.filter(m => m.at === a.u && !m.mgAv && B[m.id] && B[m.id].t === 'Magic' && B[m.id].st === 'Modification'));
const cc2Inari = (r, i) => [...r.p[i].av.filter(a => a.id === 'CC02-016' && !noFx(r, a)), ...r.p[i].mg.filter(m => m.id === 'CC02-016' && m.mgAv)];

/* ---------- ต่อเนื่อง (POWER) ---------- */
function modCC2(r, x, f) {
  if (x.tk) return 0; let v = 0; const p = r.p[f.i];
  const ina = cc2Inari(r, f.i); if (ina.length) v += ina.length * (1 + Math.floor(p.hell.length / 15));   // 016 อินาริ: +1 และ +1 ทุกๆ 15 ใบในนรก
  if (landOf(r, 'CC02-049', f.i) && p.av.length >= 2 && new Set(p.av.map(a => symOf(a))).size === p.av.length) v += 1;   // 049 ดินแดนแห่งความหลากหลาย
  return v;
}
const cc2AtkBonus = (r, a) => (!a.tk && r.p.some(q => q.mg.some(m => m.at === a.u && m.id === 'CC02-048'))) ? 4 : 0;   // 048 ปืนจักรวุทธ: โจมตี POWER +4 จนจบการต่อสู้

/* ---------- ข้อจำกัด / ป้องกัน ---------- */
function cc2NoPlace(r, i, c) {   // 009 บึงทมิฬ People - คุณปลาชด: คุม Avatar ที่ไม่ใช่ {ปลา} ได้ใบเดียว (ทุกคน)
  if (!c || c.tk || !isAv(c) || cc2Fish(c) || !cc2Swamp(r)) return false;
  if (!r.p.some(q => q.av.some(a => a.id === 'CC02-009' && !noFx(r, a)))) return false;
  return r.p[i].av.some(a => !a.tk && !cc2Fish(a));
}
function cc2Enforce(r) {   // เมื่อ 009 ลงสนาม: ใครคุม Avatar ที่ไม่ใช่ {ปลา} เกิน 1 ใบ เลือกใบที่อยู่ต่อ
  if (!cc2Swamp(r)) return;
  r.p.forEach((q, qi) => { const L = q.av.filter(a => !a.tk && !cc2Fish(a)); if (L.length <= 1) return;
    r.g.q.push(() => ask(r, qi, { text: 'บึงทมิฬ People - คุณปลาชด: คุมได้เฉพาะ Avatar ที่ไม่ใช่ {ปลา} 1 ใบ — เลือกใบที่จะอยู่ต่อ (ใบอื่นลงนรก)', opts: L.map(a => a.u), cb: us => L.filter(a => a.u !== us[0]).forEach(a => { vfx(a.u, 'burst', '🌊 ถูกบีบออก', '#38bdf8'); sendHell(r, a.u); }) })); });
}
function cc2SumBlock(r, from, c) {   // 018 ห้ามอัญเชิญจาก Deck / 011 ถูกอัญเชิญจากนรกไม่ได้
  if (from === 'deck' && r.p.some(q => q.av.some(a => a.id === 'CC02-018' && !noFx(r, a)))) { const g = r.p.flatMap(q => q.av).find(a => a.id === 'CC02-018'); g && vfx(g.u, 'ring', '🚫 อัญเชิญจาก Deck ไม่ได้', '#ef4444'); log(r, '🚫 หุ่นพิฆาต 300%: ห้ามอัญเชิญ Avatar จาก Deck'); return true; }
  if (from === 'hell' && c.id === 'CC02-011') { log(r, '🚫 ตุตันคาเมน ถูกอัญเชิญจากนรกไม่ได้'); return true; }
  return false;
}
function cc2AtkBlock(r, atk, tgt) {   // 012 เตียวเสียน: ตราบที่มี ขุนพลสีม่วง {ต่างชาติ} บนสนาม จะไม่ถูกโจมตี
  if (tgt.id !== 'CC02-012' || tgt.tk || noFx(r, tgt)) return false;
  const f = find(r, tgt.u); if (!f || f.z !== 'av') return false;
  return r.p[f.i].av.some(a => a.u !== tgt.u && cc2KP(a));
}
const cc2ODLock = (r, i) => { const o = r.p[1 - i]; return o.av.some(a => a.id === 'CC02-017' && !noFx(r, a)) && new Set(o.av.filter(OD8).map(a => nk(nmOf(a)))).size >= 4; };   // 017: ฝ่ายตรงข้ามใช้ React / Normal Magic ไม่ได้
function cc2CastBlock(r, i, c) { if ((c.st === 'React' || c.st === 'Normal') && cc2ODLock(r, i)) E('มอร์ฟีน Overdose: ฝ่ายตรงข้ามใช้ React Magic และ Normal Magic ไม่ได้'); }

/* ---------- การ์ดที่ตายจากการต่อสู้ / คำสั่งเสีย ---------- */
function cc2Death(r, f) {
  const c = f.c, p = r.p[f.i]; if (c.tk) return;
  if (c.id === 'CC02-001') r.g.q.push(() => { const L = r.p[f.i].av; if (!L.length) return; fx({ k: 'say', id: c.kd || c.id, t: 'คำสั่งเสีย: ทุกใบ POWER +1' }); L.forEach(a => { addTp(a, 1); vfx(a.u, 'rise', 'POWER +1', '#ef4444'); }); log(r, '👑 มหาราชาสีนิล คำสั่งเสีย: Avatar ฝ่ายเราทุกใบ POWER +1'); });
  if (c.id === 'CC02-003') r.g.q.push(() => { const k = p.hell.indexOf(c); if (k < 0) return; p.hell.splice(k, 1); p.deck.push(c); shuf(p.deck); fx({ k: 'say', id: c.kd || c.id, t: 'กลับเข้า Deck' }); log(r, '🃏 คุณโดม คำสั่งเสีย: กลับเข้า Deck แล้วสับ'); });
  if (c.id === 'CC02-048') { /* (ไม่ใช่ Avatar) */ }
}
function cc2After(r, p, a, d, res) {   // เรียกจาก afterBattle (เฉพาะ Avatar ปะทะ Avatar)
  const g = r.g; if (p.tk !== 'av') return;
  g.bd = g.bd || {}; if (res === 'win' || res === 'both') g.bd[1 - p.ai] = g.n; if (res === 'lose' || res === 'both') g.bd[p.ai] = g.n;   // 047: ฝั่งไหนมี Avatar ถูกทำลายจากการต่อสู้ในเทิร์นนี้
  if (d && d.id === 'CC02-004' && res !== 'win' && res !== 'both' && find(r, d.u) && !noFx(r, d)) {   // 004 นักดาบตะวันแดง
    const o = 1 - p.ai; r.g.q.push(() => { const L = r.p[p.ai].av.filter(t => !protectedFrom(r, o, t, 1)).map(t => t.u); if (!L.length) return;
      vfx(d.u, 'slash', '⚔ ไม่ถูกทำลาย!', '#ef4444'); ask(r, o, { text: 'นักดาบตะวันแดง: เลือก Avatar ฝ่ายตรงข้าม 1 ใบ ทำลาย', opts: L, cb: us => { vfx(us[0], 'slash', '💥 ฟันสวน', '#ef4444'); log(r, '⚔ นักดาบตะวันแดง: ไม่ถูกทำลายจากการถูกโจมตี — ทำลาย Avatar ฝ่ายตรงข้าม'); destroyAv(r, us[0]); } }); });
  }
  if (res === 'win' && a && find(r, a.u)) {   // 048 ปืนจักรวุทธ: ทำลาย Avatar สำเร็จ → ตื่นอีกครั้ง (เทิร์นละครั้ง)
    const gun = r.p[p.ai].mg.find(m => m.at === a.u && m.id === 'CC02-048' && m.u48 !== g.n);
    if (gun && a.tired) { gun.u48 = g.n; a.tired = false; a.w48 = g.n; vfx(a.u, 'bolt', '🔫 ตื่นอีกครั้ง!', '#f97316'); log(r, '🔫 ปืนจักรวุทธ: ทำลาย Avatar สำเร็จ — ' + nmOf(a) + ' กลับเป็นสภาพตื่น'); }
  }
}
function cc2EndPhase(r, i) {   // เข้า End Phase ของผู้เล่น i
  const g = r.g, ina = cc2Inari(r, i);
  if (ina.length) r.g.q.push(() => { const n = ina.length * (1 + Math.floor(r.p[i].hell.length / 15)); draw(r, r.p[i], n); fx({ k: 'say', id: ina[0].kd || ina[0].id, t: 'End Phase: จั่ว ' + n }); vfx(ina[0].u, 'rise', '🦊 จั่ว ' + n, '#22c55e'); log(r, '🦊 อินาริ แห่งการเก็บเกี่ยว: End Phase จั่ว ' + n + ' ใบ (นรก ' + r.p[i].hell.length + ' ใบ)'); });
  r.p[i].av.forEach(a => { if (a.w48 === g.n) a.nw48 = 1; });   // 048: หลังจบ Battle Phase ที่ใช้ความสามารถ — Avatar ไม่เปลี่ยนเป็นสภาพตื่น (ยกเว้นความสามารถของปืน)
}
function cc2Sweep(r) {
  r.p.forEach((q, qi) => q.av.slice().forEach(a => {
    if (a.nw48) { if (!r.p.some(z => z.mg.some(m => m.at === a.u && m.id === 'CC02-048'))) delete a.nw48; else if (!a.tired && a.w48 !== r.g.n) a.tired = true; }
    if (a.cc45 && !r.p.some(z => z.mg.some(m => m.u === a.cc45 && m.at === a.u))) {   // 045: การ์ดออกจากสนาม → คืนการควบคุม
      delete a.cc45; const o = a.oo; if (o != null && o !== qi) { take(r, a.u); delete a.oo; delete a.ctl; if (canPlaceAv(r, o, a)) { a.tired = false; r.p[o].av.push(a); vfx(a.u, 'beam', '↩ กลับเจ้าของเดิม', '#a855f7'); log(r, '↩ สิงสู่เพื่อสู่สม: ' + nmOf(a) + ' กลับไปอยู่กับเจ้าของเดิม'); } else r.p[o].hell.push(a); }
    }
  }));
}
const _sw02 = sweep; sweep = function (r) { _sw02(r); try { cc2Sweep(r); } catch (e) { console.error('cc2Sweep', e); } };

/* 014 แร้งทึ้งศพ: เมื่อมีการ ธรณีสูบ (เทิร์นละครั้ง) จั่ว 1 */
function cc2Mill(r) {
  r.p.forEach(q => q.av.forEach(a => { if (a.id !== 'CC02-014' || noFx(r, a) || a.c14 === r.g.n) return; a.c14 = r.g.n;
    r.g.q.push(() => { if (!find(r, a.u)) return; draw(r, q, 1); vfx(a.u, 'rise', '🦅 จั่ว 1', '#a855f7'); log(r, '🦅 แร้งทึ้งศพ: มีการธรณีสูบ — ' + q.name + ' จั่ว 1 ใบ'); }); }));
}
const _mill02 = mill; mill = function (r, i, n, src) { const b = r.p[i].deck.length, out = _mill02(r, i, n, src); if (r.p[i].deck.length < b) cc2Mill(r); return out; };

/* 013 ตั๋งโต๊ะ: ในเทิร์นเรา เมื่อ Avatar ฝ่ายตรงข้ามเปลี่ยนสภาพ → จั่ว 1 (เทิร์นละครั้ง) — ตรวจเทียบสภาพก่อน/หลังทุกคำสั่ง */
const _act02 = act;
act = function (r, i, m) {
  const g = r.g; let snap = null, k = -1;
  if (g && !g.over && g.phase && r.p.length === 2) { k = g.turn; if (r.p[k] && r.p[k].av.some(a => a.id === 'CC02-013')) snap = new Map(r.p[1 - k].av.map(a => [a.u, !!a.tired])); }
  const out = _act02(r, i, m);
  try { if (snap && !r.g.over) { const ch = r.p[1 - k].av.some(a => snap.has(a.u) && snap.get(a.u) !== !!a.tired), d = r.p[k].av.find(a => a.id === 'CC02-013' && !noFx(r, a) && a.c13 !== r.g.n);
    if (ch && d) { d.c13 = r.g.n; draw(r, r.p[k], 1); vfx(d.u, 'rise', '🎴 จั่ว 1', '#a855f7'); fx({ k: 'say', id: d.kd || d.id, t: 'Avatar ศัตรูเปลี่ยนสภาพ: จั่ว 1' }); log(r, '🎴 ตั๋งโต๊ะ: Avatar ฝ่ายตรงข้ามเปลี่ยนสภาพ — ' + r.p[k].name + ' จั่ว 1 ใบ'); bc(r); } } } catch (e) { console.error('cc2 013', e); }
  return out;
};

/* 013: Cost บนมือ -3 จนจบเทิร์น */
const _hc02 = handCost; handCost = function (r, i, c) { const v = _hc02(r, i, c); if (c.cc13 === r.g.n && B[c.id] && B[c.id].t === 'Avatar') return Math.max(0, (v != null ? v : (B[c.id].c || 0)) - 3); return v; };

/* ---------- ตัวช่วย ---------- */
function cc2SumDeck(r, i, c, src) {   // อัญเชิญการ์ดที่เพิ่งสอดแนมออกมา (ไม่อยู่ใน Deck แล้ว) ลง Avatar Zone
  const p = r.p[i]; p.deck.push(c);
  if (summonAny(r, i, c.u, 'deck', src)) { vfx(c.u, 'burst', '✨ อัญเชิญ', CCOL[B[c.id].col] || '#fde047'); r.g.q.unshift(() => fxSummon(r, i, c)); return true; }
  const k = p.deck.indexOf(c); if (k >= 0) p.deck.splice(k, 1); return false;
}
function cc2PaySummon(r, i, m, off, title, col) {   // อัญเชิญ Avatar จากมือ โดยจ่าย Cost ที่ลดลง off
  const p = r.p[i]; if (!m || !p.hand.includes(m) || !canPlaceAv(r, i, m)) return;
  const hc = handCost(r, i, m), need = Math.max(0, (hc != null ? hc : (B[m.id].c || 0)) - off), def = { ...B[m.id], c: need };
  const go = ps => { ps.forEach(q => { const k = p.hand.indexOf(q); if (k >= 0) { p.hand.splice(k, 1); p.hell.push(q); } });
    if (summonAny(r, i, m.u, 'hand')) { const gs = ps.reduce((a, q) => a + (B[q.id].g || 0), 0); if (need > 0 && gs === need) m.jt = 1; vfx(m.u, 'burst', '✨ ' + title, col || '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, m)); if (ps.length) r.g.q.push(() => fxPaid(r, i, ps, m)); } };
  if (!need) return go([]);
  const pay = () => { const O = p.hand.filter(h => h.u !== m.u && !h.stl).map(h => h.u); if (!O.length) return log(r, title + ': ไม่มีการ์ดจ่าย Cost');
    ask(r, i, { text: 'เลือกการ์ดบนมือเป็น Cost (Gem รวม ≥ ' + need + ' สีตรง/ไม่มีสี)', opts: O, n: O.length, min: 1, cancel: true, cb: us => { const ps = us.map(u => p.hand.find(h => h.u === u)).filter(Boolean); try { payOK(def, ps, p); } catch (e) { log(r, '❌ จ่าย Cost ไม่ถูกต้อง: ' + e); return pay(); } go(ps); } }); };
  pay();
}
function cc2Bear(r, i, x, col, nm, opts) {   // หมี 4 ตัว: จุติ แสดง Avatar สี col จากบนมือ → เลือกปฏิบัติ
  const p = r.p[i], H = p.hand.filter(c => !c.tk && isAv(c) && B[c.id].col === col).map(c => c.u), ok = opts.filter(o => o.can(r, i, x));
  if (!H.length || !ok.length) return log(r, '🐻 ' + nm + ': ' + (!H.length ? 'ไม่มี Avatar สี' + col + ' บนมือให้แสดง' : 'ไม่มีตัวเลือกที่ทำได้') + ' — ไม่เกิดผล');
  ask(r, i, { text: 'จุติ ' + nm + ': แสดง Avatar สี' + col + ' จากบนมือ 1 ใบ (ยกเลิก = ไม่ใช้)', opts: H, cancel: true, cb: us => {
    const c = p.hand.find(h => h.u === us[0]); if (!c) return;
    fx({ k: 'say', id: c.kd || c.id, t: 'แสดงการ์ด' }); log(r, '👁 ' + p.name + ' แสดง ' + B[c.id].n + ' จากบนมือ'); vfx(x.u, 'ring', '🐻 ' + nm, CCOL[col]);
    if (ok.length === 1) return ok[0].run(r, i, x);
    ask(r, i, { choices: ok.map(o => o.t), text: nm + ': เลือกปฏิบัติ', cb: k => ok[k].run(r, i, x) }); } });
}
const cc2MyAv = (r, i, text, f) => ask(r, i, { text, opts: r.p[i].av.map(a => a.u), cb: us => { const t = find(r, us[0]); if (t && t.z === 'av') f(t.c); } });

/* ---------- จุติ ---------- */
Object.assign(SUM, {
  'CC02-005': (r, i, x) => cc2Bear(r, i, x, 'แดง', 'หมีบราซิล', [
    { t: '1) เลือก Avatar ฝ่ายเรา 1 ใบ POWER +2', can: (r, i) => r.p[i].av.length > 0, run: (r, i) => cc2MyAv(r, i, 'หมีบราซิล: เลือก Avatar ฝ่ายเรา 1 ใบ POWER +2 (จนจบเทิร์น)', t => { addTp(t, 2); vfx(t.u, 'rise', 'POWER +2', '#ef4444'); log(r, '🐻 หมีบราซิล: ' + nmOf(t) + ' POWER +2'); }) },
    { t: '2) จั่ว 2 ใบ ทิ้ง 1 ใบ', can: () => true, run: (r, i) => { draw(r, r.p[i], 2); vfx(x.u, 'rise', 'จั่ว 2', '#ef4444'); if (r.p[i].hand.length) ask(r, i, { text: 'หมีบราซิล: ทิ้งการ์ดบนมือ 1 ใบ', opts: r.p[i].hand.map(c => c.u), cb: us => sendHell(r, us[0]) }); } }]),
  'CC02-006': (r, i, x) => {   // ซุส: เลือกการ์ดที่ชอบ 2 ใบจาก Deck ขึ้นมือ
    const p = r.p[i]; if (bt10NoAdd(r, i) || ccNoAdd(r, i)) { shuf(p.deck); return log(r, '🌙 ตอนนี้นำการ์ดจาก Deck ขึ้นมือด้วยความสามารถไม่ได้ (ซุส)'); }
    const L = p.deck.map(c => c.u), n = Math.min(2, L.length); vfx(x.u, 'bolt', '⚡ ซุสประทานการ์ด', '#fde047');
    if (!n) return; ask(r, i, { text: 'จุติ ซุส: เลือกการ์ดที่ชอบ ' + n + ' ใบ จาก Deck ขึ้นมือ', opts: L, n, min: n, cb: us => { us.forEach(u => { const c = fromZone(r, i, 'deck', u); if (c) { p.hand.push(c); vfx(c.u, 'rise', '✨ ขึ้นมือ', '#fde047'); } }); shuf(p.deck); log(r, '⚡ ซุส: นำการ์ด ' + us.length + ' ใบจาก Deck ขึ้นมือ แล้วสับ Deck'); } });
  },
  'CC02-007': (r, i, x) => {   // ไอ้ชนหมา
    const p = r.p[i], A = p.av.filter(a => a.u !== x.u && !a.tk && (symOf(a) === 'สัตว์' || also9(a, 'สัตว์'))).map(a => a.u);
    if (!A.length) return log(r, 'จุติ ไอ้ชนหมา: ไม่มี Avatar {สัตว์} ให้เซ่นไหว้ — ไม่เกิดผล');
    ask(r, i, { text: 'จุติ ไอ้ชนหมา: เซ่นไหว้ Avatar {สัตว์} 1 ใบ เพื่อสอดแนม 7 ใบ (ยกเลิก = ไม่ใช้)', opts: A, cancel: true, cb: us => { if (!sac(r, us[0])) return; vfx(x.u, 'ring', '🐕 เซ่นไหว้', '#38bdf8');
      scout(r, i, 7, { text: 'ไอ้ชนหมา: เลือก Avatar Cost ≤ 5 ขึ้นมือ (ที่เหลือกลับ Deck แล้วสับ)', pred: c => isAv(c) && B[c.id].c <= 5, rest: 'shuffle', by: x, then: got => {
        if (!got) return log(r, 'ไอ้ชนหมา: ไม่พบ Avatar Cost ≤ 5');
        const toHand = () => { p.hand.push(got); vfx(got.u, 'rise', '✨ ขึ้นมือ', '#38bdf8'); log(r, '🐕 ไอ้ชนหมา: นำ ' + B[got.id].n + ' ขึ้นมือ'); };
        if (B[got.id].c <= 2 && canPlaceAv(r, i, got)) return ask(r, i, { yn: true, text: 'ไอ้ชนหมา: ' + B[got.id].n + ' (Cost ≤ 2) — อัญเชิญลง Avatar Zone แทนการขึ้นมือไหม?', cb: y => { if (y && cc2SumDeck(r, i, got, x)) { shuf(p.deck); return log(r, '🐕 ไอ้ชนหมา: อัญเชิญ ' + B[got.id].n); } toHand(); } });
        toHand(); } }); } });
  },
  'CC02-008': (r, i, x) => {   // ลุงน้อย (พอดี)
    if (!x.jt) return log(r, 'ลุงน้อย: ไม่ได้อัญเชิญแบบ พอดี — ไม่มีจุติ');
    const p = r.p[i]; draw(r, p, 3); vfx(x.u, 'rise', '🍗 จั่ว 3', '#38bdf8'); const n = Math.min(2, p.hand.length); if (!n) return shuf(p.deck);
    ask(r, i, { text: 'จุติ (พอดี) ลุงน้อย: เลือกการ์ดบนมือ ' + n + ' ใบ กลับเข้า Deck', opts: p.hand.map(c => c.u), n, min: n, cb: us => { us.forEach(u => { const c = fromZone(r, i, 'hand', u); if (c) p.deck.push(c); }); shuf(p.deck); log(r, '🍗 ลุงน้อย: จั่ว 3 แล้วนำการ์ดบนมือ ' + n + ' ใบกลับเข้า Deck แล้วสับ'); } });
  },
  'CC02-009': (r, i, x) => { vfx(x.u, 'ring', '🌊 คุมได้ใบเดียว', '#38bdf8'); cc2Enforce(r); },   // ต่อเนื่อง — ตรวจทันทีเมื่อลงสนาม
  'CC02-010': (r, i, x) => cc2Bear(r, i, x, 'ฟ้า', 'หมีขาว', [
    { t: '1) สอดแนม 5: อัญเชิญ Avatar Cost ≤ 3 ลง Avatar Zone', can: (r, i) => r.p[i].deck.length > 0, run: (r, i) => scout(r, i, 5, { text: 'หมีขาว: เลือก Avatar Cost ไม่เกิน 3 อัญเชิญลง Avatar Zone (ที่เหลือกลับ Deck แล้วสับ)', pred: c => isAv(c) && B[c.id].c <= 3, rest: 'shuffle', by: x, then: got => { if (!got) return log(r, 'หมีขาว: ไม่พบ Avatar Cost ≤ 3'); if (!cc2SumDeck(r, i, got, x)) { r.p[i].deck.push(got); shuf(r.p[i].deck); } else shuf(r.p[i].deck); } }) },
    { t: '2) สอดแนม 5: นำ Avatar 1 ใบ ขึ้นมือ', can: (r, i) => r.p[i].deck.length > 0, run: (r, i) => scout(r, i, 5, { text: 'หมีขาว: เลือก Avatar 1 ใบ ขึ้นมือ (ที่เหลือกลับ Deck แล้วสับ)', pred: c => isAv(c), rest: 'shuffle', by: x, then: got => { if (got) { r.p[i].hand.push(got); vfx(got.u, 'rise', '✨ ขึ้นมือ', '#38bdf8'); log(r, '🐻 หมีขาว: นำ ' + B[got.id].n + ' ขึ้นมือ'); } } }) }]),
  'CC02-011': (r, i, x) => {   // ตุตันคาเมน
    const p = r.p[i], pool = () => r.p.flatMap((q, qi) => q.hell.filter(h => !h.tk && !h.h40 && cc2Jt(h) && !cc2Only(h) && h.id !== 'CC02-011').map(h => ({ h, qi })));
    const pull = (c, qi) => { const k = r.p[qi].hell.indexOf(c); if (k < 0 || !canPlaceAv(r, i, c)) return false; if (qi !== i) { r.p[qi].hell.splice(k, 1); p.hell.push(c); } if (summonAny(r, i, c.u, 'hell', x)) { vfx(c.u, 'burst', '🏺 ฟาโรห์เรียก', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); return true; } return false; };
    const o1 = () => { let left = 8; const step = () => { const L = pool().filter(e => B[e.h.id].c <= left).map(e => e.h.u); if (!L.length) return;
      ask(r, i, { text: 'จุติ ตุตันคาเมน: เลือก จุติ Avatar (ไม่ใช่ Only) จากนรกใครก็ได้ (Cost รวมเหลือ ' + left + ') — ยกเลิก = หยุด', opts: L, cancel: true, cb: us => { const e = pool().find(z => z.h.u === us[0]); if (!e) return; const cost = B[e.h.id].c; if (pull(e.h, e.qi)) { left -= cost; r.g.q.push(step); } } }); }; step(); };
    const o2 = () => { const L = r.p.flatMap(q => q.hell.filter(h => !h.tk && !h.h40 && cc2Jt(h) && h.id !== 'CC02-011').map(h => h.u)); ask(r, i, { text: 'จุติ ตุตันคาเมน: เลือก จุติ Avatar 1 ใบ จากนรกใครก็ได้ อัญเชิญลง Avatar Zone ฝ่ายเรา', opts: L, cb: us => { const e = r.p.map((q, qi) => ({ c: q.hell.find(h => h.u === us[0]), qi })).find(z => z.c); e && pull(e.c, e.qi); } }); };
    const ch = [], fn = []; if (pool().length) { ch.push('1) อัญเชิญ จุติ Avatar (ไม่ใช่ Only) กี่ใบก็ได้ Cost รวมไม่เกิน 8 จากนรกใครก็ได้'); fn.push(o1); }
    if (r.p.some(q => q.hell.some(h => !h.tk && !h.h40 && cc2Jt(h) && h.id !== 'CC02-011'))) { ch.push('2) อัญเชิญ จุติ Avatar 1 ใบ จากนรกใครก็ได้'); fn.push(o2); }
    if (!ch.length) return log(r, 'จุติ ตุตันคาเมน: ไม่มี จุติ Avatar ในนรก'); if (ch.length === 1) return fn[0]();
    ask(r, i, { choices: ch, text: 'ตุตันคาเมน: เลือกปฏิบัติ', cb: k => fn[k]() });
  },
  'CC02-013': (r, i, x) => {   // ตั๋งโต๊ะ
    const p = r.p[i], L = p.hell.filter(h => !h.tk && !h.h40 && cc2KP(h) && nk(B[h.id].n) !== nk(B[x.id].n)).map(h => h.u);
    if (!L.length) return log(r, 'จุติ ตั๋งโต๊ะ: ไม่พบ ขุนพลสีม่วง {ต่างชาติ} ในนรก');
    ask(r, i, { text: 'จุติ ตั๋งโต๊ะ: เลือก Avatar \"ขุนพล\" สีม่วง {ต่างชาติ} จากนรก ขึ้นมือ (Cost บนมือ -3 จนจบเทิร์น)', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (!c) return; p.hand.push(c); c.cc13 = r.g.n; vfx(c.u, 'rise', 'Cost -3', '#a855f7'); vfx(x.u, 'beam', '🎴 ขึ้นมือ', '#a855f7'); log(r, '🎴 ตั๋งโต๊ะ: นำ ' + B[c.id].n + ' จากนรกขึ้นมือ (Cost -3 จนจบเทิร์น)'); } });
  },
  'CC02-015': (r, i, x) => cc2Bear(r, i, x, 'ม่วง', 'หมีดำ', [
    { t: '1) ธรณีสูบ 2 ใบ: อัญเชิญ Avatar POWER ≤ 2 (ไม่ใช่ Only) จากนรก', can: (r, i) => r.p[i].deck.length > 2, run: (r, i) => { mill(r, i, 2, x); r.g.q.push(() => { const L = r.p[i].hell.filter(h => !h.tk && !h.h40 && isAv(h) && (B[h.id].p || 0) <= 2 && !cc2Only(h) && canPlaceAv(r, i, h)).map(h => h.u); if (!L.length) return log(r, 'หมีดำ: ไม่มี Avatar POWER ≤ 2 ในนรก');
      ask(r, i, { text: 'หมีดำ: เลือก Avatar POWER ไม่เกิน 2 (ไม่ใช่ Only) จากนรก อัญเชิญลง Avatar Zone', opts: L, cb: us => { const c = r.p[i].hell.find(h => h.u === us[0]); if (c && summonAny(r, i, c.u, 'hell', x)) { vfx(c.u, 'burst', '🐻 หมีดำเรียก', '#a855f7'); r.g.q.unshift(() => fxSummon(r, i, c)); } } }); }); } },
    { t: '2) ธรณีสูบ 2 ใบ: นำการ์ดในนรก (ไม่ใช่ Only) 1 ใบ กลับเข้าใต้ Deck', can: (r, i) => r.p[i].deck.length > 2, run: (r, i) => { mill(r, i, 2, x); r.g.q.push(() => { const L = r.p[i].hell.filter(h => !h.h40 && !cc2Only(h)).map(h => h.u); if (!L.length) return;
      ask(r, i, { text: 'หมีดำ: เลือกการ์ดจากนรก (ไม่ใช่ Only) 1 ใบ กลับเข้าใต้ Deck', opts: L, cb: us => { const c = fromZone(r, i, 'hell', us[0]); if (c) { r.p[i].deck.unshift(c); vfx(x.u, 'beam', '⬇ ใต้ Deck', '#a855f7'); log(r, '🐻 หมีดำ: นำ ' + B[c.id].n + ' กลับเข้าใต้ Deck'); } } }); }); } }]),
  'CC02-016': (r, i, x) => { if (toMg(r, i, x.u)) { vfx(x.u, 'ring', '🦊 ไป Magic Zone', '#22c55e'); log(r, '🦊 อินาริ แห่งการเก็บเกี่ยว: ไปไว้ใน Magic Zone (ใช้ความสามารถจาก Magic Zone ได้)'); } },
  'CC02-020': (r, i, x) => cc2Bear(r, i, x, 'เขียว', 'หมีเหลือง', [
    { t: '1) Avatar 1 ใบ ไม่ถูกทำลายจากการต่อสู้ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', can: (r, i) => r.p[i].av.length > 0, run: (r, i) => cc2MyAv(r, i, 'หมีเหลือง: เลือก Avatar 1 ใบ ไม่ถูกทำลายจากการต่อสู้ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', t => { t.nb02 = r.g.n + 1; vfx(t.u, 'ring', '🛡 ไม่ถูกทำลายจากการต่อสู้', '#22c55e'); log(r, '🐻 หมีเหลือง: ' + nmOf(t) + ' ไม่ถูกทำลายจากการต่อสู้ จนจบเทิร์นถัดไปของฝ่ายตรงข้าม'); }) },
    { t: '2) Avatar 1 ใบ ไม่รับผล Magic ฝ่ายตรงข้าม จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', can: (r, i) => r.p[i].av.length > 0, run: (r, i) => cc2MyAv(r, i, 'หมีเหลือง: เลือก Avatar 1 ใบ ไม่รับผล Magic Card ฝ่ายตรงข้าม จนจบเทิร์นถัดไปของฝ่ายตรงข้าม', t => { t.mgProt = r.g.n + 1; vfx(t.u, 'ring', '🛡 ไม่รับผล Magic', '#22c55e'); log(r, '🐻 หมีเหลือง: ' + nmOf(t) + ' ไม่รับผล Magic ฝ่ายตรงข้าม จนจบเทิร์นถัดไปของฝ่ายตรงข้าม'); }) }]),
});

/* ---------- สั่งใช้ (Avatar) ---------- */
Object.assign(ABIL, {
  'CC02-002': { zone: 'hell', once: 1, label: 'ทิ้งมือ 1 ใบ: อัญเชิญจากนรก', hint: 'ต้องไม่มี Avatar ชื่อนี้บนสนาม และมีการ์ดบนมือให้ทิ้ง',
    cond: (r, i, c) => !c.h40 && r.p[i].hand.length > 0 && !r.p[i].av.some(a => !a.tk && B[a.id].n.trim() === B[c.id].n.trim()) && canPlaceAv(r, i, c),
    run: (r, i, c) => ask(r, i, { text: 'บัมเบิ้ลแบงค์: ทิ้งการ์ดบนมือ 1 ใบ เพื่ออัญเชิญจากนรก (ยกเลิก = ไม่ใช้)', opts: r.p[i].hand.map(h => h.u), cancel: true, onCancel: () => { delete c.ou; }, cb: us => {
      sendHell(r, us[0]); if (summonAny(r, i, c.u, 'hell', c)) { vfx(c.u, 'burst', '🏦 บัมเบิ้ลแบงค์กลับมา', '#ef4444'); fx({ k: 'say', id: c.kd || c.id, t: 'อัญเชิญจากนรก' }); r.g.q.unshift(() => fxSummon(r, i, c)); } } }) },
  'CC02-003': { zone: 'av', once: 1, label: 'ทอยลูกเต๋า POWER เพิ่มตามผล', run: (r, i, x) => { const d = bt6Dice(r, i); addTp(x, d); vfx(x.u, 'rise', '🎲 POWER +' + d, '#f59e0b'); log(r, '🎲 คุณโดม: POWER +' + d + ' จนจบเทิร์น'); } },
  'CC02-012': { zone: 'av', once: 1, label: 'เปลี่ยน Avatar ฝ่ายตรงข้ามทั้งหมดเป็นสภาพตื่น', cond: (r, i) => r.p[1 - i].av.some(a => a.tired), run: (r, i, x) => { const L = r.p[1 - i].av.filter(a => a.tired); L.forEach(a => { a.tired = false; vfx(a.u, 'rise', '☀ ตื่น', '#a855f7'); vfx(x.u, 'beam', '', '#a855f7'); }); log(r, '💃 เตียวเสียน: เปลี่ยน Avatar ฝ่ายตรงข้ามทั้งหมดเป็นสภาพตื่น'); } },
  'CC02-017': { zone: 'av', once: 1, label: 'หงาย LIFE 1 ใบ: อัญเชิญ Avatar จากนรกใครก็ได้', hint: 'ต้องมี LIFE คว่ำ และมี Avatar ในนรกที่อัญเชิญได้',
    cond: (r, i) => r.p[i].life.some(l => !l.up) && r.p.some((q, qi) => q.hell.some(h => !h.tk && !h.h40 && isAv(h) && canPlaceAv(r, qi, h))),
    run: (r, i, x) => { const L = r.p.flatMap((q, qi) => q.hell.filter(h => !h.tk && !h.h40 && isAv(h) && canPlaceAv(r, qi, h)).map(h => h.u));
      ask(r, i, { text: 'มอร์ฟีน Overdose: เลือก Avatar จากนรกของผู้เล่นใดก็ได้ (หงาย LIFE ใบบนสุดของเรา 1 ใบ) — ยกเลิก = ไม่ใช้', opts: L, cancel: true, onCancel: () => { delete x.ou; }, cb: us => {
        const e = r.p.map((q, qi) => ({ c: q.hell.find(h => h.u === us[0]), qi })).find(z => z.c); if (!e) return; if (!lifeUp(r, i)) return;
        if (summonAny(r, e.qi, e.c.u, 'hell', x)) { if (e.qi !== i) e.c.mute17 = 1; vfx(e.c.u, 'bolt', '💊 ฟื้นคืนชีพ', '#22c55e'); log(r, '💊 มอร์ฟีน Overdose: อัญเชิญ ' + B[e.c.id].n + ' ลง Avatar Zone ของ ' + r.p[e.qi].name + (e.qi !== i ? ' (ใช้ความสามารถไม่ได้)' : '')); r.g.q.unshift(() => fxSummon(r, e.qi, e.c)); } } }); } },
  'CC02-019': { zone: 'av', once: 1, label: 'Cost -1: ทำลาย Avatar ฝ่ายตรงข้ามที่ Cost ≤ Avatar ใบนี้', hint: 'ต้องมี Avatar ฝ่ายตรงข้ามที่ Cost ไม่เกิน Cost ของใบนี้หลังลด 1',
    cond: (r, i, x) => { const c = costNow(r, x) - 1; return costNow(r, x) >= 1 && r.p[1 - i].av.some(t => !protectedFrom(r, i, t, 1) && costNow(r, t) <= c); },
    run: (r, i, x) => { x.cx = (x.cx || 0) - 1; const c = costNow(r, x); vfx(x.u, 'ring', 'Cost -1 (เหลือ ' + c + ')', '#22c55e'); const L = r.p[1 - i].av.filter(t => !protectedFrom(r, i, t, 1) && costNow(r, t) <= c).map(t => t.u);
      ask(r, i, { text: 'ราชาใบก้อน: เลือก Avatar ฝ่ายตรงข้าม Cost ไม่เกิน ' + c + ' ทำลาย', opts: L, cb: us => { vfx(us[0], 'slash', '💥 ราชาใบก้อน', '#22c55e'); destroyAv(r, us[0]); } }); } },
  'CC02-039': { zone: 'av', once: 1, label: 'ทิ้งมือ 1 ใบ: อัญเชิญ {ยักษ์} POWER 3 จาก Deck',
    cond: (r, i) => r.p[i].hand.length > 0 && canPlaceAv(r, i, r.p[i].hand[0]) && r.p[i].deck.some(c => !c.tk && isAv(c) && B[c.id].s === 'ยักษ์' && B[c.id].p === 3 && !B[c.id].n.includes('ทศกัณฐ์')),
    run: (r, i, x) => { const p = r.p[i]; ask(r, i, { text: 'ทศกัณฐ์: ทิ้งการ์ดบนมือ 1 ใบ (ยกเลิก = ไม่ใช้)', opts: p.hand.map(h => h.u), cancel: true, onCancel: () => { delete x.ou; }, cb: us => { sendHell(r, us[0]);
      const L = p.deck.filter(c => !c.tk && isAv(c) && B[c.id].s === 'ยักษ์' && B[c.id].p === 3 && !B[c.id].n.includes('ทศกัณฐ์') && canPlaceAv(r, i, c)).map(c => c.u);
      const fin = u => { if (u != null) { const c = p.deck.find(k => k.u === u); if (c && summonAny(r, i, c.u, 'deck', x)) { vfx(c.u, 'burst', '👹 ทศกัณฐ์เรียก', '#22c55e'); r.g.q.unshift(() => fxSummon(r, i, c)); } } shuf(p.deck); };
      if (!L.length) { shuf(p.deck); return log(r, 'ทศกัณฐ์: ไม่พบ Avatar {ยักษ์} POWER 3 ใน Deck (สับ Deck)'); }
      if (new Set(L.map(u => B[p.deck.find(c => c.u === u).id].n)).size === 1) return fin(L[0]);
      ask(r, i, { text: 'ทศกัณฐ์: เลือก Avatar {ยักษ์} POWER 3 จาก Deck อัญเชิญลง Avatar Zone', opts: L, cb: us => fin(us[0]), none: () => fin(null) }); } }); } },
  'CC02-050': { zone: 'land', once: 1, label: 'นอน {ปลา} 1 ใบ: สอดแนม 3 เลือกการ์ด {ปลา} ขึ้นมือ', hint: 'ต้องมี Avatar {ปลา} สภาพตื่นบนสนาม',
    cond: (r, i) => r.p[i].av.some(a => !a.tired && cc2Fish(a)),
    run: (r, i, c) => { const p = r.p[i], L = p.av.filter(a => !a.tired && cc2Fish(a)).map(a => a.u);
      ask(r, i, { text: 'วิหารเจ้าสมุทร: เลือก Avatar {ปลา} 1 ใบ เปลี่ยนเป็นสภาพนอน (ยกเลิก = ไม่ใช้)', opts: L, cancel: true, onCancel: () => { delete c.ou; }, cb: us => { const t = find(r, us[0]); if (!t) return; t.c.tired = true; vfx(t.c.u, 'ring', '🌊 นอน', '#38bdf8'); vfx(c.u, 'rise', '🌊 สอดแนม 3', '#38bdf8');
        scout(r, i, 3, { text: 'วิหารเจ้าสมุทร: เลือกการ์ด Symbol {ปลา} 1 ใบ ขึ้นมือ (ที่เหลือทิ้งลงนรก)', pred: z => !z.tk && B[z.id].s === 'ปลา', by: c, then: (got, seen) => {
          if (got) { p.hand.push(got); vfx(got.u, 'rise', '✨ ขึ้นมือ', '#38bdf8'); log(r, '🌊 วิหารเจ้าสมุทร: นำ ' + B[got.id].n + ' ขึ้นมือ'); }
          const rest = seen.filter(z => z !== got && p.deck.includes(z)); rest.forEach(z => { p.deck.splice(p.deck.indexOf(z), 1); p.hell.push(z); }); if (rest.length) log(r, '🌊 วิหารเจ้าสมุทร: ทิ้งการ์ดที่เหลือ ' + rest.length + ' ใบลงนรก'); } }); } }); } },
});

/* ---------- Magic ---------- */
const CC2SET = { 'CC02-041': 'แดง', 'CC02-042': 'ฟ้า', 'CC02-043': 'ม่วง', 'CC02-044': 'เขียว' };
Object.entries(CC2SET).forEach(([id, col]) => {
  MG[id] = { run: (r, i, cx) => { const p = r.p[i], card = cx.card;   // สอดแนม 2 → เลือกการ์ดสี → วางไว้บน Magic Zone
    scout(r, i, 2, { text: 'เลือกการ์ดสี' + col + ' จากที่สอดแนม 1 ใบ ขึ้นมือ (ที่เหลือไว้ใต้ Deck)', pred: c => cc2Col(c, col), rest: 'bottom', by: card, then: got => {
      if (got) { p.hand.push(got); vfx(got.u, 'rise', '✨ ขึ้นมือ', CCOL[col]); log(r, '📖 ' + B[card.id].n + ': นำ ' + B[got.id].n + ' ขึ้นมือ'); }
      const k = p.hell.indexOf(card); if (k < 0) return; p.hell.splice(k, 1); card.mgSet = r.g.n; p.mg.push(card); vfx(card.u, 'aura', '📌 วางบน Magic Zone', CCOL[col]); log(r, '📌 ' + B[card.id].n + ' ถูกวางไว้บน Magic Zone (สั่งใช้ได้หลังผ่านไป 1 เทิร์น)'); } }); } };
  AB[id] = { z: 'mg', can: (r, i, c) => c.mgSet != null && r.g.n > c.mgSet && r.p[i].hand.some(h => !h.tk && isAv(h) && B[h.id].col === col && canPlaceAv(r, i, h)),
    run: (r, i, cx) => { const p = r.p[i], c = cx.card; take(r, c.u); delete c.mgSet; p.hell.push(c); vfx(c.u, 'burst', '💥 ทำลายการ์ดนี้', CCOL[col]);
      const H = p.hand.filter(h => !h.tk && isAv(h) && B[h.id].col === col && canPlaceAv(r, i, h)).map(h => h.u);
      ask(r, i, { text: B[c.id].n + ': เลือก Avatar สี' + col + ' จากมือ อัญเชิญทันที (Cost ลด 2)', opts: H, cancel: true, cb: us => cc2PaySummon(r, i, p.hand.find(h => h.u === us[0]), 2, 'อัญเชิญ (Cost -2)', CCOL[col]) }); } };
});
Object.assign(MG, {
  'CC02-045': { cond: (r, i) => r.p[1 - i].av.length > 0, steps: [{ key: 's', text: 'สิงสู่เพื่อสู่สม: เซ่นไหว้ Avatar ที่มี Cost ตั้งแต่ 3 ขึ้นไป 1 ใบ', opts: (r, i) => r.p[i].av.filter(a => costNow(r, a) >= 3).map(a => a.u) }],
    run: (r, i, cx) => { const me = r.p[i], o = 1 - i, card = cx.card; if (!sac(r, cx.pick.s[0])) return; const L = r.p[o].av.map(a => a.u); if (!L.length) return log(r, 'สิงสู่เพื่อสู่สม: ฝ่ายตรงข้ามไม่มี Avatar');
      ask(r, o, { text: 'สิงสู่เพื่อสู่สม: เลือก Avatar ของตนเอง 1 ใบ — ฝ่ายตรงข้ามจะสวมใส่การ์ดนี้และยึดการควบคุม', opts: L, cb: us => { const t = find(r, us[0]), k = me.hell.indexOf(card); if (!t || t.z !== 'av' || k < 0) return;
        me.hell.splice(k, 1); card.at = t.c.u; me.mg.push(card); t.c.cc45 = card.u; const ok = stealCard(r, i, t.c.u); vfx(t.c.u, 'aura', '👻 สิงสู่!', '#a855f7'); vfx(t.c.u, 'beam', '', '#a855f7');
        log(r, '👻 สิงสู่เพื่อสู่สม: ' + nmOf(t.c) + ' ถูกสวมใส่' + (ok ? ' และเปลี่ยนการควบคุมมาอยู่ฝั่ง ' + me.name : ' (เปลี่ยนการควบคุมไม่ได้)')); } }); } },
  'CC02-046': { react: 'atkav', steps: [{ key: 't', text: 'กาจอก: เลือก Avatar ของเราที่กำลังต่อสู้อยู่ 1 ใบ', opts: (r, i, cx) => [cx.pend && cx.pend.tk === 'av' && cx.pend.tg].filter(u => u && find(r, u) && find(r, u).z === 'av' && find(r, u).i === i) }],
    run: (r, i, cx) => { const p = cx.pend, f = p && find(r, p.u); if (!f || f.z !== 'av') return log(r, 'กาจอก: ไม่พบ Avatar ที่ต่อสู้ด้วย');
      if (f.c.tired) { vfx(f.c.u, 'ring', 'กาจอก: ไม่อยู่ในสภาพตื่น', '#64748b'); return log(r, '🦅 กาจอก: ' + nmOf(f.c) + ' อยู่ในสภาพนอน — ไม่ทำลาย'); }
      vfx(f.c.u, 'slash', '🦅 กาจอก!', '#ef4444'); log(r, '🦅 กาจอก: ' + nmOf(f.c) + ' ที่ต่อสู้อยู่ในสภาพตื่น — ทำลาย'); destroyAv(r, f.c.u); } },
  'CC02-047': { react: 'atk', cond: (r, i) => { const p = r.g.pend; return !!(p && p.k === 'atk' && p.tg === 'life' && r.g.bd && r.g.bd[i] === r.g.n); },
    run: (r, i, cx) => { if (cx.pend) cx.pend.noDmg = 1; fx({ k: 'say', id: cx.card.kd || cx.card.id, t: 'ไม่ทำความเสียหาย LIFE' }); vfx(null, 'ring', '🛡 ไม่ทำความเสียหาย LIFE', '#38bdf8'); log(r, '🛡 เราจะตายแล้วท่านหยุดเถอะ: การโจมตีครั้งนี้ไม่ทำความเสียหาย LIFE Card'); } },
  'CC02-048': { mod: 1 },
  'CC02-049': {}, 'CC02-050': {},
});
Object.assign(AB, {
  'CC02-048': { z: 'mg', run: (r, i, cx) => { const g = cx.card, t = find(r, g.at), p = r.p[i]; take(r, g.u); delete g.at; p.hand.push(g);   // นำการ์ดนี้ในสภาพสวมใส่ขึ้นมือ + Avatar ที่เคยสวมใส่ตื่น
    if (t && t.z === 'av') { t.c.tired = false; delete t.c.nw48; delete t.c.w48; vfx(t.c.u, 'bolt', '🔫 กลับมาตื่น', '#f97316'); }
    log(r, '🔫 ปืนจักรวุทธ: นำขึ้นมือ และ ' + (t ? nmOf(t.c) : 'Avatar') + ' เปลี่ยนเป็นสภาพตื่น'); } },
});

qCh().catch(() => { });
srv.listen(process.env.PORT || 3000, () => console.log('ready'));
// กันหลุดเอง: ส่ง ping ทุก 25 วิ ให้ proxy ไม่ตัด WebSocket ที่นิ่งๆ (เช่นเล่นกับบอท)
setInterval(() => { try { wss.clients.forEach(w => { if (w.readyState === 1) w.ping(); }); } catch (e) { } }, 25000);
// กัน Render หลับระหว่างมีห้องเปิดอยู่ (ห้องเก็บในหน่วยความจำ ถ้าเซิร์ฟเวอร์หลับ/รีสตาร์ท ห้องจะหาย)
if (process.env.RENDER_EXTERNAL_URL) setInterval(() => { if (Object.keys(rooms).length) fetch(process.env.RENDER_EXTERNAL_URL + '/health').catch(() => { }); }, 6 * 60 * 1000);
process.on('SIGTERM', () => console.log('SIGTERM: server restarting, rooms lost:', Object.keys(rooms).length));
if (process.env.BOT_TEST) module.exports = { kdMulti, kdProto, kdRich, rooms, act, inst, find, P, B, view, sview, runQ, wss, shuf, destroyCo, pack, mig, pushFst, friendStat, userWs, kill, resolveAtk, passTurn, startTurn, putAv, kdNarai, kdAfter, exileAv, kdLife, fxSummon, summonFree, ask, hit, setBt, open };