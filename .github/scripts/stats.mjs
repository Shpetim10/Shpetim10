// Generates dist/stats.svg and dist/activity.svg from the GitHub GraphQL API.
// Runs in the "Generate profile images" workflow; no dependencies (Node 20+ fetch).
// Colors are the portfolio tokens: carbon, graphite, bone, dust, signal.

import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.GITHUB_USER ?? "Shpetim10";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

const C = { carbon: "#0b0a08", graphite: "#151412", line: "#2a2824", bone: "#ede8df", dust: "#8f8a80", signal: "#ff4f00" };
const MONO = `'Martian Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

const query = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes { stargazerCount languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
const body = await res.json();
if (!res.ok || body.errors) throw new Error(`GitHub API error: ${JSON.stringify(body.errors ?? body)}`);
const u = body.data.user;
const cc = u.contributionsCollection;

const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const langBytes = new Map();
for (const r of u.repositories.nodes)
  for (const e of r.languages.edges) langBytes.set(e.node.name, (langBytes.get(e.node.name) ?? 0) + e.size);
const topLangs = [...langBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);

const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");

const style = `
  <style>
    .t { font-family: ${MONO}; }
    .row { opacity: 1; }
    .draw { stroke-dasharray: 1; stroke-dashoffset: 0; }
    .fade { opacity: 1; }
    @media (prefers-reduced-motion: no-preference) {
      .row { animation: rise .7s cubic-bezier(.16,1,.3,1) both; }
      .draw { animation: draw 1.6s cubic-bezier(.65,0,.35,1) .2s both; }
      .fade { animation: fade .8s ease-out 1.2s both; }
    }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  </style>`;

// ── Stats card ───────────────────────────────────────────────────────────
function statsCard() {
  const W = 495, H = 195;
  const rows = [
    ["Contributions · last year", fmt(cc.contributionCalendar.totalContributions)],
    ["Commits · last year", fmt(cc.totalCommitContributions + cc.restrictedContributionsCount)],
    ["Pull requests · last year", fmt(cc.totalPullRequestContributions)],
    ["Public repositories", fmt(u.repositories.totalCount)],
    ["Stars earned", fmt(stars)],
  ];
  const rowSvg = rows
    .map(([label, value], i) => {
      const y = 66 + i * 21;
      return `<g class="row" style="animation-delay:${0.15 + i * 0.1}s">
      <rect x="25" y="${y - 8}" width="6" height="6" fill="${C.signal}"/>
      <text class="t" x="40" y="${y}" font-size="11.5" fill="${C.dust}">${esc(label)}</text>
      <text class="t" x="${W - 25}" y="${y}" font-size="12" fill="${C.bone}" text-anchor="end" font-weight="600">${esc(value)}</text>
    </g>`;
    })
    .join("\n");
  const langs = topLangs.map(esc).join("  ·  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats for ${esc(LOGIN)}">
  ${style}
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="${C.carbon}" stroke="${C.line}"/>
  <text class="t" x="25" y="34" font-size="13" letter-spacing="2" fill="${C.bone}">GITHUB STATS</text>
  <rect x="25" y="42" width="28" height="2" fill="${C.signal}"/>
  <text class="t" x="${W - 25}" y="34" font-size="9.5" letter-spacing="1.5" fill="${C.dust}" text-anchor="end">@${esc(LOGIN)}</text>
  ${rowSvg}
  <path d="M25 ${H - 34}.5H${W - 25}" stroke="${C.line}"/>
  <text class="t fade" x="25" y="${H - 15}" font-size="10" fill="${C.dust}"><tspan fill="${C.signal}">TOP LANGUAGES</tspan>  ${langs}</text>
</svg>`;
}

// ── Activity graph: the last 31 days ─────────────────────────────────────
function activityGraph() {
  const last = days.slice(-31);
  const W = 1000, H = 280, L = 56, R = 24, T = 56, B = 44;
  const max = Math.max(4, ...last.map((d) => d.contributionCount));
  const niceMax = Math.ceil(max / 4) * 4;
  const x = (i) => L + (i * (W - L - R)) / (last.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / niceMax);
  const pts = last.map((d, i) => [x(i), y(d.contributionCount)]);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
  const area = `${line}L${x(last.length - 1).toFixed(1)} ${H - B}L${L} ${H - B}Z`;
  const grid = [0, 1, 2, 3, 4]
    .map((k) => {
      const v = (niceMax / 4) * k, gy = y(v).toFixed(1);
      return `<path d="M${L} ${gy}H${W - R}" stroke="${C.line}" stroke-width="1"/>
      <text class="t" x="${L - 10}" y="${+gy + 3.5}" font-size="9.5" fill="${C.dust}" text-anchor="end">${v}</text>`;
    })
    .join("\n");
  const labels = last
    .map((d, i) => (i % 5 === 0 || i === last.length - 1)
      ? `<text class="t" x="${x(i).toFixed(1)}" y="${H - B + 20}" font-size="9.5" fill="${C.dust}" text-anchor="middle">${d.date.slice(5).replace("-", "/")}</text>`
      : "")
    .join("");
  const dots = pts
    .map(([px, py], i) => last[i].contributionCount
      ? `<rect x="${(px - 2.5).toFixed(1)}" y="${(py - 2.5).toFixed(1)}" width="5" height="5" fill="${C.bone}"/>`
      : "")
    .join("");
  const total = last.reduce((s, d) => s + d.contributionCount, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${total} contributions in the last 31 days">
  ${style}
  <defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.signal}" stop-opacity=".28"/><stop offset="1" stop-color="${C.signal}" stop-opacity="0"/></linearGradient></defs>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="${C.carbon}" stroke="${C.line}"/>
  <text class="t" x="${L}" y="32" font-size="13" letter-spacing="2" fill="${C.bone}">CONTRIBUTIONS · LAST 31 DAYS</text>
  <text class="t" x="${W - R}" y="32" font-size="11" letter-spacing="1.5" fill="${C.dust}" text-anchor="end"><tspan fill="${C.signal}">${fmt(total)}</tspan> TOTAL</text>
  ${grid}
  ${labels}
  <path class="fade" d="${area}" fill="url(#a)"/>
  <path class="draw" pathLength="1" d="${line}" fill="none" stroke="${C.signal}" stroke-width="2" stroke-linejoin="round"/>
  <g class="fade">${dots}</g>
</svg>`;
}

await mkdir("dist", { recursive: true });
await writeFile("dist/stats.svg", statsCard());
await writeFile("dist/activity.svg", activityGraph());
console.log(`stats.svg and activity.svg written for ${LOGIN}`);
