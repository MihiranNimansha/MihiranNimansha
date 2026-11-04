// Generates a wide, animated 3D "skyline" of contribution towers as an SVG.
// Usage: GITHUB_TOKEN=... USERNAME=... node scripts/city.mjs   (add --sample for fake data)
import fs from 'node:fs';
import path from 'node:path';

const AX = 16;
const AY = 0;
const BX = -8;
const BY = 7;
const PAD = 40;
const SLAB = 7;
const OUT = process.env.OUT || 'profile-3d-contrib/city.svg';
const USER = process.env.USERNAME || 'user';

const BASES = ['#161b22', '#1b6e3a', '#2ea043', '#3fb950', '#56d364'];
const INK = '#e6edf3';
const MUTED = '#8b949e';
const LINE = '#21262d';

function parse(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(hex, other, t) {
  const a = parse(hex);
  const b = parse(other);
  return '#' + [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t).toString(16).padStart(2, '0')).join('');
}
function rnd(a, b, c, d) {
  let x = Math.imul(a + 1, 73856093) ^ Math.imul(b + 7, 19349663) ^ Math.imul(c + 13, 83492791) ^ Math.imul(d + 3, 2654435761);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const f = (n) => String(Math.round(n * 10) / 10);
const pt = (p) => f(p[0]) + ',' + f(p[1]);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n.toLocaleString('en-US');

function sample() {
  const weeks = [];
  const start = new Date(Date.UTC(2025, 10, 2));
  let total = 0;
  const sparse = process.argv.includes('--sparse');
  for (let i = 0; i < 53; i++) {
    const days = [];
    for (let j = 0; j < 7; j++) {
      const d = new Date(start.getTime() + (i * 7 + j) * 86400000);
      if (d > new Date()) continue;
      let c = 0;
      const r = rnd(i, j, 1, 1);
      if (r > (sparse ? 0.93 : 0.55)) c = 1 + Math.floor(rnd(i, j, 2, 2) * rnd(i, j, 3, 3) * (sparse ? 14 : 26));
      if (i > 40 && r > (sparse ? 0.8 : 0.3)) c += Math.floor(rnd(i, j, 4, 4) * (sparse ? 9 : 12));
      total += c;
      days.push({ date: d.toISOString().slice(0, 10), count: c, weekday: j });
    }
    weeks.push(days);
  }
  return { total, weeks, radar: { commit: Math.round(total * 0.8), issue: 3, pr: 12, review: 4, repo: 6 } };
}

async function load() {
  if (process.argv.includes('--sample')) return sample();
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const query =
    'query($login:String!){user(login:$login){contributionsCollection{totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions totalRepositoryContributions contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}';
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'city-graph' },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data || !json.data.user) {
    throw new Error('GraphQL request failed: ' + JSON.stringify(json).slice(0, 500));
  }
  const cc = json.data.user.contributionsCollection;
  const cal = cc.contributionCalendar;
  return {
    total: cal.totalContributions,
    radar: {
      commit: cc.totalCommitContributions,
      issue: cc.totalIssueContributions,
      pr: cc.totalPullRequestContributions,
      review: cc.totalPullRequestReviewContributions,
      repo: cc.totalRepositoryContributions,
    },
    weeks: cal.weeks.map((w) =>
      w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, weekday: d.weekday }))
    ),
  };
}

function streaks(weeks) {
  const days = weeks.flat().sort((a, b) => (a.date < b.date ? -1 : 1));
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  let current = 0;
  let k = days.length - 1;
  if (k >= 0 && days[k].count === 0) k--;
  while (k >= 0 && days[k].count > 0) {
    current++;
    k--;
  }
  return { longest, current };
}

const cal = await load();
const weeks = cal.weeks;
const nW = weeks.length;
const all = weeks.flat();
const max = Math.max(1, ...all.map((d) => d.count));
const sorted = all.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
function levelOf(c) {
  if (c <= 0) return 0;
  const rank = sorted.indexOf(c) / Math.max(1, sorted.length - 1);
  return rank < 0.25 ? 1 : rank < 0.5 ? 2 : rank < 0.75 ? 3 : 4;
}
const st = streaks(weeks);

// geometry: weeks run left to right, days recede towards the back
const OX = PAD + 6.5 * -BX + AX / 2;
const OY = 296;
const P = (i, j) => [OX + i * AX + j * BX, OY + i * AY + j * BY];
const W = Math.round(OX + (nW - 0.5) * AX + PAD);
const frontY = P(0, 6.5)[1];
const H = Math.round(frontY + SLAB + 64);

const out = [];
out.push(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
    '" role="img" aria-label="3D contribution skyline for ' + esc(USER) + '">'
);
out.push(
  '<style>' +
    'text{font-family:Arial,Helvetica,sans-serif}' +
    '.b{transform-box:view-box;animation:rise 1.1s cubic-bezier(.2,.8,.2,1) both}' +
    '@keyframes rise{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}' +
    '.tw{animation:tw 4s ease-in-out infinite}' +
    '@keyframes tw{0%,100%{opacity:.2}50%{opacity:1}}' +
    '.rd{transform-box:view-box;animation:rdin 1.4s cubic-bezier(.2,.8,.2,1) .6s both}' +
    '@keyframes rdin{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.b,.tw,.rd{animation:none}}' +
    '</style>'
);
out.push('<rect x=".5" y=".5" width="' + (W - 1) + '" height="' + (H - 1) + '" rx="10" fill="#0d1117" stroke="' + LINE + '"/>');

// ---- stat bar -------------------------------------------------------------
const label = (x, y, s) => '<text x="' + x + '" y="' + y + '" fill="' + MUTED + '" font-size="11" letter-spacing="1.4">' + s + '</text>';
const big = (x, y, v, unit, color) =>
  '<text x="' + x + '" y="' + y + '"><tspan font-size="44" font-weight="700" fill="' + color + '">' + v + '</tspan>' +
  (unit ? '<tspan font-size="14" fill="' + MUTED + '" dx="8">' + unit + '</tspan>' : '') + '</text>';
const COL = [PAD, PAD + 210, PAD + 400];
out.push(label(COL[0], 56, 'CONTRIBUTIONS'));
out.push(big(COL[0], 108, fmt(cal.total), 'past year', '#56d364'));
out.push(label(COL[1], 56, 'LONGEST STREAK'));
out.push(big(COL[1], 108, st.longest, st.longest === 1 ? 'day' : 'days', INK));
out.push(label(COL[2], 56, 'CURRENT STREAK'));
out.push(big(COL[2], 108, st.current, st.current === 1 ? 'day' : 'days', INK));
for (const x of [COL[1] - 24, COL[2] - 24, PAD + 590]) {
  out.push('<line x1="' + x + '" y1="40" x2="' + x + '" y2="136" stroke="' + LINE + '"/>');
}
out.push('<line x1="' + PAD + '" y1="164" x2="' + (W - PAD) + '" y2="164" stroke="' + LINE + '"/>');

// ---- radar ----------------------------------------------------------------
const rd = cal.radar || { commit: 0, issue: 0, pr: 0, review: 0, repo: 0 };
const axes = [['Commits', rd.commit], ['Issues', rd.issue], ['PRs', rd.pr], ['Reviews', rd.review], ['Repos', rd.repo]];
const RX0 = PAD + 590;
const RCX = RX0 + (W - PAD - RX0) / 2 + 28;
const RCY = 106;
const RR = 42;
const CAP = 500;
function rp(k, frac, extra) {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
  const r = RR * frac + (extra || 0);
  return [RCX + Math.cos(a) * r, RCY + Math.sin(a) * r];
}
out.push(label(RX0 + 24, 56, 'ACTIVITY'));
for (const ring of [0.5, 1]) {
  out.push('<polygon points="' + [0, 1, 2, 3, 4].map((k) => pt(rp(k, ring))).join(' ') + '" fill="none" stroke="#30363d"' + (ring < 1 ? ' stroke-dasharray="2 3"' : '') + '/>');
}
for (let k = 0; k < 5; k++) {
  const p = rp(k, 1);
  out.push('<line x1="' + f(RCX) + '" y1="' + f(RCY) + '" x2="' + f(p[0]) + '" y2="' + f(p[1]) + '" stroke="#30363d"/>');
}
const fr = axes.map((a) => Math.max(0.05, Math.min(1, Math.log10(1 + a[1]) / Math.log10(1 + CAP))));
const shape = fr.map((v, k) => pt(rp(k, v))).join(' ');
let rg = '<g class="rd" style="transform-origin:' + f(RCX) + 'px ' + f(RCY) + 'px">';
rg += '<polygon points="' + shape + '" fill="#56d364" fill-opacity=".25" stroke="#56d364" stroke-width="1.5" stroke-linejoin="round"/>';
fr.forEach((v, k) => {
  const p = rp(k, v);
  rg += '<circle cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="2.4" fill="#0d1117" stroke="#56d364" stroke-width="1.5"/>';
});
rg += '</g>';
out.push(rg);
axes.forEach((a, k) => {
  const p = rp(k, 1, 9);
  const anchor = k === 0 ? 'middle' : k === 1 || k === 2 ? 'start' : 'end';
  const dy = k === 0 ? -1 : k === 2 || k === 3 ? 9 : 4;
  out.push(
    '<text x="' + f(p[0]) + '" y="' + f(p[1] + dy) + '" text-anchor="' + anchor + '" fill="' + MUTED + '" font-size="11">' + a[0] +
      ' <tspan fill="' + INK + '" font-weight="700">' + fmt(a[1]) + '</tspan></text>'
  );
});

// ---- platform -------------------------------------------------------------
const K0 = P(-0.5, -0.5);
const K1 = P(nW - 0.5, -0.5);
const K2 = P(nW - 0.5, 6.5);
const K3 = P(-0.5, 6.5);
const dn = (p) => [p[0], p[1] + SLAB];
out.push('<polygon points="' + [K3, K2, dn(K2), dn(K3)].map(pt).join(' ') + '" fill="#0a0d12"/>');
out.push('<polygon points="' + [K2, K1, dn(K1), dn(K2)].map(pt).join(' ') + '" fill="#0f141b"/>');
out.push('<polygon points="' + [K0, K1, K2, K3].map(pt).join(' ') + '" fill="#10151c"/>');

const TS = 0.95;
for (let i = 0; i < nW; i++) {
  for (const d of weeks[i]) {
    const c = P(i, d.weekday);
    const a = [(AX * TS) / 2, (AY * TS) / 2];
    const b = [(BX * TS) / 2, (BY * TS) / 2];
    const pts = [
      [c[0] - a[0] - b[0], c[1] - a[1] - b[1]],
      [c[0] + a[0] - b[0], c[1] + a[1] - b[1]],
      [c[0] + a[0] + b[0], c[1] + a[1] + b[1]],
      [c[0] - a[0] + b[0], c[1] - a[1] + b[1]],
    ];
    out.push('<polygon points="' + pts.map(pt).join(' ') + '" fill="#161b22"/>');
  }
}

// ---- month labels (horizontal, along the front edge) -----------------------
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let lastMonth = -1;
for (let i = 0; i < nW; i++) {
  if (!weeks[i].length) continue;
  const m = new Date(weeks[i][0].date + 'T00:00:00Z').getUTCMonth();
  if (m !== lastMonth) {
    lastMonth = m;
    if (i > nW - 3) continue;
    const x = P(i, 6.5)[0];
    out.push('<text x="' + f(x) + '" y="' + f(frontY + SLAB + 20) + '" fill="#6e7681" font-size="11">' + months[m] + '</text>');
  }
}

// ---- buildings ------------------------------------------------------------
function tower(c, y0off, s, h, base, seed, ij) {
  const top = mix(base, '#ffffff', 0.2);
  const front = base;
  const side = mix(base, '#000000', 0.4);
  const cx = c[0];
  const cy = c[1] - y0off;
  const a = [(AX * s) / 2, (AY * s) / 2];
  const b = [(BX * s) / 2, (BY * s) / 2];
  const bk = [cx - a[0] - b[0], cy - a[1] - b[1]];
  const fr2 = [cx + a[0] - b[0], cy + a[1] - b[1]];
  const br = [cx + a[0] + b[0], cy + a[1] + b[1]];
  const bl = [cx - a[0] + b[0], cy - a[1] + b[1]];
  const up = (p) => [p[0], p[1] - h];
  let m = '';
  m += '<polygon points="' + [bl, br, up(br), up(bl)].map(pt).join(' ') + '" fill="' + front + '"/>';
  m += '<polygon points="' + [br, fr2, up(fr2), up(br)].map(pt).join(' ') + '" fill="' + side + '"/>';
  m += '<polygon points="' + [up(bk), up(fr2), up(br), up(bl)].map(pt).join(' ') + '" fill="' + top + '"/>';
  const faces = [
    { p0: bl, vec: [br[0] - bl[0], br[1] - bl[1]], cols: [[0.16, 0.4], [0.6, 0.84]], lit: '#eafff0', op: 0.7, dark: mix(front, '#000000', 0.35), id: 1 },
    { p0: br, vec: [fr2[0] - br[0], fr2[1] - br[1]], cols: [[0.22, 0.78]], lit: '#eafff0', op: 0.5, dark: mix(side, '#000000', 0.35), id: 2 },
  ];
  const nf = Math.floor((h - 7) / 5.5);
  for (const face of faces) {
    let litD = '';
    let darkD = '';
    let tw = '';
    for (let k = 0; k < nf; k++) {
      const v0 = 4 + k * 5.5;
      const v1 = v0 + 2.6;
      for (let ci = 0; ci < face.cols.length; ci++) {
        const u0 = face.cols[ci][0];
        const u1 = face.cols[ci][1];
        const pa = [face.p0[0] + face.vec[0] * u0, face.p0[1] + face.vec[1] * u0];
        const pb = [face.p0[0] + face.vec[0] * u1, face.p0[1] + face.vec[1] * u1];
        const quad = [[pa[0], pa[1] - v0], [pb[0], pb[1] - v0], [pb[0], pb[1] - v1], [pa[0], pa[1] - v1]];
        const d = 'M' + quad.map(pt).join('L') + 'Z';
        const r = rnd(ij[0], ij[1], k * 2 + ci + seed * 31, face.id);
        if (r < 0.5) {
          if (r > 0.46) {
            tw += '<path class="tw" style="animation-delay:' + f(r * 50) + 's" d="' + d + '" fill="' + face.lit + '"/>';
          } else {
            litD += d;
          }
        } else {
          darkD += d;
        }
      }
    }
    if (darkD) m += '<path d="' + darkD + '" fill="' + face.dark + '" opacity=".5"/>';
    if (litD) m += '<path d="' + litD + '" fill="' + face.lit + '" opacity="' + face.op + '"/>';
    m += tw;
  }
  return m;
}

const cells = [];
for (let i = 0; i < nW; i++) for (const d of weeks[i]) if (d.count > 0) cells.push({ i, j: d.weekday, c: d.count });
cells.sort((p, q) => P(p.i, p.j)[1] - P(q.i, q.j)[1] || p.i - q.i);

for (const cell of cells) {
  const { i, j, c } = cell;
  const lvl = levelOf(c);
  const base = BASES[lvl];
  const pos = P(i, j);
  const h = 8 + 88 * Math.pow(c / max, 0.62);
  const delay = f(i * 0.03 + j * 0.015);
  let g = '<g class="b" style="transform-origin:' + f(pos[0]) + 'px ' + f(pos[1]) + 'px;animation-delay:' + delay + 's">';
  if (h >= 42) {
    const h1 = h * 0.72;
    const h2 = h - h1;
    g += tower(pos, 0, 0.74, h1, base, 0, [i, j]);
    g += tower(pos, h1, 0.44, h2, base, 1, [i, j]);
    if (h >= 74) {
      const ty = pos[1] - h;
      g += '<line x1="' + f(pos[0]) + '" y1="' + f(ty) + '" x2="' + f(pos[0]) + '" y2="' + f(ty - 9) + '" stroke="' + MUTED + '" stroke-width="1"/>';
    }
  } else {
    g += tower(pos, 0, 0.74, h, base, 0, [i, j]);
  }
  g += '</g>';
  out.push(g);
}

// ---- footer ---------------------------------------------------------------
const fy = H - 24;
const first = all.reduce((a, d) => (d.date < a ? d.date : a), '9999');
const last = all.reduce((a, d) => (d.date > a ? d.date : a), '0000');
const nice = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
out.push('<text x="' + PAD + '" y="' + (fy + 4) + '" fill="#6e7681" font-size="11">@' + esc(USER) + '  |  ' + nice(first) + ' to ' + nice(last) + '  |  public contributions</text>');
const lx = W - PAD;
out.push('<text x="' + lx + '" y="' + (fy + 4) + '" text-anchor="end" fill="#6e7681" font-size="11">More</text>');
for (let k = 0; k < 5; k++) {
  out.push('<rect x="' + (lx - 38 - (5 - k) * 16) + '" y="' + (fy - 6) + '" width="11" height="11" rx="2" fill="' + BASES[k] + '"/>');
}
out.push('<text x="' + (lx - 38 - 5 * 16 - 8) + '" y="' + (fy + 4) + '" text-anchor="end" fill="#6e7681" font-size="11">Less</text>');

out.push('</svg>');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join('\n'));
console.log('Wrote ' + OUT + ' (' + Math.round(out.join('\n').length / 1024) + ' KB, ' + cells.length + ' buildings)');
