// Generates an isometric "city" of contribution skyscrapers as an animated SVG.
// Usage: GITHUB_TOKEN=... USERNAME=... node scripts/city.mjs   (add --sample for fake data)
import fs from 'node:fs';
import path from 'node:path';

const DX = 16;
const DY = 8;
const PAD = 70;
const SLAB = 8;
const OUT = process.env.OUT || 'profile-3d-contrib/city.svg';
const USER = process.env.USERNAME || 'user';

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const BASES = ['#161b22', '#1b6e3a', '#2ea043', '#3fb950', '#56d364'];

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

function sample() {
  const weeks = [];
  const start = new Date(Date.UTC(2025, 10, 2));
  let total = 0;
  for (let i = 0; i < 53; i++) {
    const days = [];
    for (let j = 0; j < 7; j++) {
      const d = new Date(start.getTime() + (i * 7 + j) * 86400000);
      if (d > new Date()) continue;
      let c = 0;
      const r = rnd(i, j, 1, 1);
      const sparse = process.argv.includes('--sparse');
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

const OX = PAD + 7 * DX;
const OY = 150;
const W = Math.round(OX + nW * DX + PAD);
const bottomY = OY + (nW + 6) * DY;
const H = Math.round(bottomY + SLAB + 90);

const out = [];
out.push(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
    '" role="img" aria-label="Isometric 3D contribution skyline for ' + esc(USER) + '">'
);
out.push(
  '<style>' +
    'text{font-family:Arial,Helvetica,sans-serif}' +
    '.b{transform-box:view-box;animation:rise 1.1s cubic-bezier(.2,.8,.2,1) both}' +
    '@keyframes rise{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}' +
    '.tw{animation:tw 3.6s ease-in-out infinite}' +
    '@keyframes tw{0%,100%{opacity:.15}50%{opacity:1}}' +
    '.bc{animation:bc 2.2s ease-in-out infinite}' +
    '@keyframes bc{0%,100%{opacity:.25}50%{opacity:1}}' +
    '.rd{transform-box:view-box;animation:rdin 1.6s cubic-bezier(.2,.8,.2,1) .8s both}' +
    '@keyframes rdin{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.b,.tw,.bc,.rd{animation:none}}' +
    '</style>'
);
out.push(
  '<defs><radialGradient id="g"><stop offset="0" stop-color="#56d364" stop-opacity=".45"/><stop offset="1" stop-color="#56d364" stop-opacity="0"/></radialGradient></defs>'
);
out.push('<rect width="' + W + '" height="' + H + '" fill="#0d1117"/>');

// slab
const T = [OX, OY - DY];
const R = [OX + nW * DX, OY + (nW - 1) * DY];
const B = [OX + (nW - 7) * DX, OY + (nW + 6) * DY];
const L = [OX - 7 * DX, OY + 6 * DY];
const dn = (p, t) => [p[0], p[1] + t];
out.push('<polygon points="' + [L, B, dn(B, SLAB), dn(L, SLAB)].map(pt).join(' ') + '" fill="#0a0d12"/>');
out.push('<polygon points="' + [B, R, dn(R, SLAB), dn(B, SLAB)].map(pt).join(' ') + '" fill="#0f141b"/>');
out.push('<polygon points="' + [T, R, B, L].map(pt).join(' ') + '" fill="#10151c"/>');

const cx = (i, j) => OX + (i - j) * DX;
const cy = (i, j) => OY + (i + j) * DY;

// ground tiles
for (let i = 0; i < nW; i++) {
  for (const d of weeks[i]) {
    const j = d.weekday;
    const x = cx(i, j);
    const y = cy(i, j);
    const s = 0.93;
    out.push(
      '<polygon points="' + [[x, y - DY * s], [x + DX * s, y], [x, y + DY * s], [x - DX * s, y]].map(pt).join(' ') + '" fill="#161b22"/>'
    );
  }
}

// month labels along the back edge
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let lastMonth = -1;
const ang = (Math.atan(DY / DX) * 180) / Math.PI;
for (let i = 0; i < nW; i++) {
  if (!weeks[i].length) continue;
  const m = new Date(weeks[i][0].date + 'T00:00:00Z').getUTCMonth();
  if (m !== lastMonth) {
    lastMonth = m;
    if (i > nW - 3) continue;
    const x = cx(i, 8.8);
    const y = cy(i, 8.8);
    out.push(
      '<text x="' + f(x) + '" y="' + f(y) + '" fill="#8b949e" font-size="11" letter-spacing=".6" transform="rotate(' + f(ang) +
        ' ' + f(x) + ' ' + f(y) + ')">' + months[m].toUpperCase() + '</text>'
    );
  }
}

// buildings
function boxMarkup(x, y0, s, h, base, seed, ij) {
  const top = mix(base, '#ffffff', 0.22);
  const left = base;
  const right = mix(base, '#000000', 0.38);
  const Tt = [x, y0 - DY * s];
  const Rr = [x + DX * s, y0];
  const Bb = [x, y0 + DY * s];
  const Ll = [x - DX * s, y0];
  const up = (p) => [p[0], p[1] - h];
  let m = '';
  m += '<polygon points="' + [Ll, Bb, up(Bb), up(Ll)].map(pt).join(' ') + '" fill="' + left + '"/>';
  m += '<polygon points="' + [Bb, Rr, up(Rr), up(Bb)].map(pt).join(' ') + '" fill="' + right + '"/>';
  m += '<polygon points="' + [up(Tt), up(Rr), up(Bb), up(Ll)].map(pt).join(' ') + '" fill="' + top + '"/>';
  const faces = [
    { p0: Ll, vec: [DX * s, DY * s], lit: '#eafff0', litOp: 0.75, dark: mix(left, '#000000', 0.35), id: 1 },
    { p0: Bb, vec: [DX * s, -DY * s], lit: '#eafff0', litOp: 0.55, dark: mix(right, '#000000', 0.35), id: 2 },
  ];
  const cols = [[0.16, 0.4], [0.6, 0.84]];
  const nf = Math.floor((h - 7) / 5.5);
  for (const face of faces) {
    let litD = '';
    let darkD = '';
    let tw = '';
    for (let k = 0; k < nf; k++) {
      const v0 = 4 + k * 5.5;
      const v1 = v0 + 2.6;
      for (let c = 0; c < 2; c++) {
        const u0 = cols[c][0];
        const u1 = cols[c][1];
        const a = [face.p0[0] + face.vec[0] * u0, face.p0[1] + face.vec[1] * u0];
        const b = [face.p0[0] + face.vec[0] * u1, face.p0[1] + face.vec[1] * u1];
        const quad = [[a[0], a[1] - v0], [b[0], b[1] - v0], [b[0], b[1] - v1], [a[0], a[1] - v1]];
        const d = 'M' + quad.map(pt).join('L') + 'Z';
        const r = rnd(ij[0], ij[1], k * 2 + c + seed * 31, face.id);
        if (r < 0.58) {
          if (r > 0.53) {
            tw += '<path class="tw" style="animation-delay:' + f(r * 40) + 's" d="' + d + '" fill="' + face.lit + '"/>';
          } else {
            litD += d;
          }
        } else {
          darkD += d;
        }
      }
    }
    if (darkD) m += '<path d="' + darkD + '" fill="' + face.dark + '" opacity=".55"/>';
    if (litD) m += '<path d="' + litD + '" fill="' + face.lit + '" opacity="' + face.litOp + '"/>';
    m += tw;
  }
  return m;
}

const cells = [];
for (let i = 0; i < nW; i++) for (const d of weeks[i]) if (d.count > 0) cells.push({ i, j: d.weekday, c: d.count });
cells.sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i);

for (const cell of cells) {
  const { i, j, c } = cell;
  const lvl = levelOf(c);
  const base = BASES[lvl];
  const x = cx(i, j);
  const y = cy(i, j);
  const h = 10 + 88 * Math.pow(c / max, 0.62);
  if (lvl >= 3) {
    out.push('<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(DX * 1.9) + '" ry="' + f(DY * 1.9) + '" fill="url(#g)"/>');
  }
  const delay = f(i * 0.035 + j * 0.02);
  let g = '<g class="b" style="transform-origin:' + f(x) + 'px ' + f(y) + 'px;animation-delay:' + delay + 's">';
  if (h >= 46) {
    const h1 = h * 0.7;
    const h2 = h - h1;
    g += boxMarkup(x, y, 0.8, h1, base, 0, [i, j]);
    g += boxMarkup(x, y - h1, 0.46, h2, base, 1, [i, j]);
    if (h >= 78) {
      g += '<line x1="' + f(x) + '" y1="' + f(y - h - DY * 0.46) + '" x2="' + f(x) + '" y2="' + f(y - h - DY * 0.46 - 11) + '" stroke="#8b949e" stroke-width="1"/>';
      g += '<circle class="bc" cx="' + f(x) + '" cy="' + f(y - h - DY * 0.46 - 12) + '" r="1.8" fill="#f85149"/>';
    }
  } else {
    g += boxMarkup(x, y, 0.8, h, base, 0, [i, j]);
  }
  g += '</g>';
  out.push(g);
}

// stats (top right)
const right = W - PAD;
const fmt = (n) => n.toLocaleString('en-US');
out.push('<text x="' + right + '" y="62" text-anchor="end" fill="#8b949e" font-size="12" letter-spacing="1.2">CONTRIBUTIONS IN THE LAST YEAR</text>');
out.push('<text x="' + right + '" y="112" text-anchor="end" fill="#56d364" font-size="46" font-weight="700">' + fmt(cal.total) + '</text>');
out.push('<text x="' + right + '" y="140" text-anchor="end" fill="#c9d1d9" font-size="14">Longest streak <tspan font-weight="700" fill="#56d364">' + st.longest + ' day' + (st.longest === 1 ? '' : 's') + '</tspan><tspan fill="#8b949e">   |   </tspan>Current <tspan font-weight="700" fill="#56d364">' + st.current + ' day' + (st.current === 1 ? '' : 's') + '</tspan></text>');

// legend and range (bottom left)
const ly = H - 46;
out.push('<text x="' + PAD + '" y="' + (ly + 11) + '" fill="#8b949e" font-size="12">Less</text>');
for (let k = 0; k < 5; k++) {
  out.push('<rect x="' + (PAD + 36 + k * 18) + '" y="' + ly + '" width="13" height="13" rx="2.5" fill="' + BASES[k] + '"/>');
}
out.push('<text x="' + (PAD + 36 + 5 * 18 + 6) + '" y="' + (ly + 11) + '" fill="#8b949e" font-size="12">More</text>');
const first = all.reduce((a, d) => (d.date < a ? d.date : a), '9999');
const last = all.reduce((a, d) => (d.date > a ? d.date : a), '0000');
const nice = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
out.push('<text x="' + PAD + '" y="' + (ly + 34) + '" fill="#6e7681" font-size="11">@' + esc(USER) + '  |  ' + nice(first) + ' to ' + nice(last) + '  |  public activity</text>');

// radar (spider web) chart, bottom left
const rd = cal.radar || { commit: 0, issue: 0, pr: 0, review: 0, repo: 0 };
const axes = [['COMMITS', rd.commit], ['ISSUES', rd.issue], ['PULL REQUESTS', rd.pr], ['REVIEWS', rd.review], ['REPOS', rd.repo]];
const RCX = PAD + 125;
const RCY = H - 240;
const RR = 82;
const CAP = 500;
function rp(k, frac, extra) {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
  const r = RR * frac + (extra || 0);
  return [RCX + Math.cos(a) * r, RCY + Math.sin(a) * r];
}
out.push('<text x="' + PAD + '" y="' + (RCY - RR - 46) + '" fill="#8b949e" font-size="12" letter-spacing="1.2">ACTIVITY BREAKDOWN</text>');
for (const ring of [0.25, 0.5, 0.75, 1]) {
  const pts = [0, 1, 2, 3, 4].map((k) => pt(rp(k, ring))).join(' ');
  out.push('<polygon points="' + pts + '" fill="none" stroke="#30363d" stroke-width="1"' + (ring < 1 ? ' stroke-dasharray="2 3"' : '') + '/>');
}
for (let k = 0; k < 5; k++) {
  out.push('<line x1="' + f(RCX) + '" y1="' + f(RCY) + '" x2="' + pt(rp(k, 1)).split(',')[0] + '" y2="' + pt(rp(k, 1)).split(',')[1] + '" stroke="#30363d" stroke-width="1"/>');
}
const fr = axes.map((a) => Math.max(0.04, Math.min(1, Math.log10(1 + a[1]) / Math.log10(1 + CAP))));
const shape = fr.map((v, k) => pt(rp(k, v))).join(' ');
let rg = '<g class="rd" style="transform-origin:' + f(RCX) + 'px ' + f(RCY) + 'px">';
rg += '<polygon points="' + shape + '" fill="#56d364" fill-opacity=".30" stroke="#56d364" stroke-opacity=".25" stroke-width="6" stroke-linejoin="round"/>';
rg += '<polygon points="' + shape + '" fill="#56d364" fill-opacity=".22" stroke="#56d364" stroke-width="1.6" stroke-linejoin="round"/>';
fr.forEach((v, k) => {
  const p = rp(k, v);
  rg += '<circle cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="2.6" fill="#0d1117" stroke="#56d364" stroke-width="1.6"/>';
});
rg += '</g>';
out.push(rg);
axes.forEach((a, k) => {
  const p = rp(k, 1, 14);
  const anchor = k === 0 ? 'middle' : k === 1 || k === 2 ? 'start' : 'end';
  const dy = k === 0 ? -4 : k === 2 || k === 3 ? 6 : 3;
  out.push(
    '<text x="' + f(p[0]) + '" y="' + f(p[1] + dy) + '" text-anchor="' + anchor + '" fill="#8b949e" font-size="10" letter-spacing=".8">' + a[0] +
      ' <tspan fill="#56d364" font-weight="700">' + fmt(a[1]) + '</tspan></text>'
  );
});

out.push('</svg>');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join('\n'));
console.log('Wrote ' + OUT + ' (' + Math.round(out.join('\n').length / 1024) + ' KB, ' + cells.length + ' buildings)');
