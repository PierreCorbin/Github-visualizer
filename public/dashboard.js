/* ════════════════════════════════════════════════════════════
   Flash Repo Visualizer · dashboard behavior
   Data source: window.__REPO_DATA__ (injected server-side)
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const payload = window.__REPO_DATA__;
  if (!payload) {
    console.error("[dashboard] no __REPO_DATA__ available");
    return;
  }

  // Normalize payload shape → match the mockup's expected structure
  const DATA = payload.data; // { web: [...], server: [...] }
  const HISTORY = payload.history;
  const CONTRACT_DRIFT = payload.contractDrift;
  const DEPLOYS = payload.deploys;
  const REPOS = payload.repos;

  /* ══════════════ Utilities ══════════════ */
  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function authorColor(a) {
    const palette = {
      PC: "#8b5cf6", KM: "#10b981", JT: "#f59e0b", SL: "#38bdf8",
      DD: "#ec4899", AD: "#f472b6", LB: "#22d3ee", MT: "#facc15",
    };
    if (palette[a]) return palette[a];
    // Deterministic fallback
    let hash = 0;
    for (let i = 0; i < a.length; i++) hash = (hash * 31 + a.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue}, 60%, 55%)`;
  }
  function avatarEl(a) {
    return `<span class="avatar" style="background:${authorColor(a)}" title="${escAttr(a)}">${escAttr(a)}</span>`;
  }
  function sparkSvg(data, w = 44, h = 14) {
    if (!data || data.length === 0) return "";
    const max = Math.max(...data, 1);
    const step = data.length > 1 ? w / (data.length - 1) : 0;
    const pts = data
      .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
      .join(" ");
    const first5 = data.slice(0, 5).reduce((a, b) => a + b, 0);
    const last5 = data.slice(-5).reduce((a, b) => a + b, 0);
    let cls = "flat";
    if (last5 > first5 * 1.25) cls = "rising";
    else if (last5 * 1.25 < first5) cls = "falling";
    if (data.every((v) => v === 0)) cls = "flat";
    return `<svg class="spark ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }
  function authorLoad(name) {
    const all = [...DATA.web, ...DATA.server].filter((b) => b.stage !== "abandoned");
    return all.filter((b) => (b.authors || []).includes(name)).length;
  }

  /* ══════════════ Insights ══════════════ */
  function computeMergeOrder() {
    // Rank shared features by how "base-like" they are: prefer names that appear in other features' topFiles.
    const shared = [...new Set(DATA.server.filter((b) => b.feature).map((b) => b.feature))].filter(
      (f) => DATA.web.some((w) => w.feature === f),
    );
    const orderRank = (f) => {
      const s = DATA.server.find((b) => b.feature === f);
      if (!s) return 99;
      // Heuristic: fewer ahead commits + more files touched → more foundational
      return (s.ahead || 0) - (s.files || 0) * 0.02;
    };
    const ordered = shared.slice().sort((a, b) => orderRank(a) - orderRank(b));
    return ordered.slice(0, 3).map((name) => ({ name, why: "shared-file dependency" }));
  }

  function renderInsights() {
    const order = computeMergeOrder();
    const orderHtml = order.length
      ? order.map((o) => `<code>${o.name}</code>`).join(" → ")
      : "<code>no shared features detected</code>";

    const shared = [...new Set(DATA.server.filter((b) => b.feature).map((b) => b.feature))]
      .filter((f) => DATA.web.some((w) => w.feature === f));

    // Insight 1 — on-track feature (both active, web ahead or matched)
    let onTrack = shared
      .map((f) => ({
        f,
        w: DATA.web.find((b) => b.feature === f),
        s: DATA.server.find((b) => b.feature === f),
      }))
      .filter((r) => r.w && r.s && r.w.stage === "active" && r.s.stage === "active")
      .sort((a, b) => (b.w.ahead + b.s.ahead) - (a.w.ahead + a.s.ahead))[0];

    // Insight 2 — needs-sync (web behind server)
    let needsSync = shared
      .map((f) => ({
        f,
        w: DATA.web.find((b) => b.feature === f),
        s: DATA.server.find((b) => b.feature === f),
      }))
      .filter((r) => r.w && r.s && r.w.behind > 3 && r.s.ahead > 0)
      .sort((a, b) => b.w.behind - a.w.behind)[0];

    // Insight 3 — merge hazard from contract drift
    const riskiest = CONTRACT_DRIFT.filter((d) => d.severity !== "ok")
      .sort((a, b) => (b.severity === "risk" ? 1 : 0) - (a.severity === "risk" ? 1 : 0))[0];

    const overloaded = [...new Set([...DATA.web, ...DATA.server].flatMap((b) => b.authors || []))]
      .map((a) => ({ a, load: authorLoad(a) }))
      .filter((x) => x.load >= 3);

    const insights = [
      onTrack
        ? {
            cls: "ok", label: "ON TRACK",
            title: `<b>${onTrack.f}</b> in flight on both repos — web is ${onTrack.w.ahead} commits ahead, server is ${onTrack.s.ahead} ahead.`,
            meta: `web ${onTrack.w.ahead} ahead · server ${onTrack.s.ahead} ahead · ${onTrack.w.last} / ${onTrack.s.last}`,
          }
        : {
            cls: "ok", label: "ON TRACK",
            title: "Default branches are healthy — no shared active feature detected right now.",
            meta: `${DATA.web.length} web branches · ${DATA.server.length} server branches tracked`,
          },
      needsSync
        ? {
            cls: "warn", label: "NEEDS SYNC",
            title: `<b>${needsSync.f}</b> — web is ${needsSync.w.behind} commits behind server; rebase before next pickup.`,
            meta: `server ${needsSync.s.ahead} ahead · web last commit ${needsSync.w.last}`,
          }
        : {
            cls: "warn", label: "NEEDS SYNC",
            title: "All shared features are tracking their counterpart cleanly.",
            meta: "no rebase pressure across web ↔ server",
          },
      riskiest
        ? {
            cls: "risk", label: "MERGE HAZARD",
            title: `<b>${riskiest.feature}</b> — ${riskiest.verdict.split(".")[0]}.`,
            meta: riskiest.changes.slice(0, 4).map((c) => c.path.split("/").pop()).join(" · "),
          }
        : {
            cls: "risk", label: "MERGE HAZARD",
            title: "No contract drift detected across shared feature branches.",
            meta: "server-origin contract files in sync with web",
          },
      {
        cls: "merge-order", label: "RECOMMENDED MERGE ORDER",
        title: order.length
          ? `Merge ${orderHtml} in that order to resolve conflicts once.`
          : "No cross-repo feature branches to sequence.",
        meta: overloaded.length
          ? `watch ${overloaded.map((o) => "@" + o.a).join(", ")} load`
          : "no author bottlenecks detected",
      },
    ];

    document.getElementById("insights").innerHTML = insights
      .map(
        (i) => `
      <div class="insight ${i.cls}">
        <div class="label"><span class="dot ${i.cls === "ok" ? "active" : i.cls === "warn" ? "stale" : i.cls === "risk" ? "abandoned" : "active"}"></span> ${i.label}</div>
        <div class="title">${i.title}</div>
        <div class="meta">${i.meta}</div>
      </div>`,
      )
      .join("");
  }

  /* ══════════════ Timeline layout ══════════════ */
  const timeline = document.getElementById("timeline");
  const paths = document.getElementById("paths");

  const LAYOUT = {
    padLeft: 100,
    padRight: 80,
    cardW: 260,
    cardH: 170,
    // Lanes — single slot per side; users zoom in to untangle overlap.
    webCardY: 28,
    webTrunkY: 346,
    serverTrunkY: 462,
    serverCardY: 568,
    height: 840,
  };
  // Roadmap date axis: [-RANGE_PAST, +RANGE_FUTURE] in days, today at 0.
  const RANGE_PAST = 90;
  const RANGE_FUTURE = 60;
  const RANGE_SPAN = RANGE_PAST + RANGE_FUTURE;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TODAY = Date.now();

  // Two independent zoom levels — timeline (roadmap) and merged history.
  let timelinePxPerDay = 40;
  let historyPxPerDay = 40;
  function tlLayoutWidth() {
    return LAYOUT.padLeft + RANGE_SPAN * timelinePxPerDay + LAYOUT.padRight;
  }
  function tlDateToX(day) {
    return LAYOUT.padLeft + (day + RANGE_PAST) * timelinePxPerDay;
  }
  function tlXToDate(x) {
    return (x - LAYOUT.padLeft) / timelinePxPerDay - RANGE_PAST;
  }
  function hxLayoutWidth() {
    return LAYOUT.padLeft + RANGE_SPAN * historyPxPerDay + LAYOUT.padRight;
  }
  function hxDateToX(day) {
    return LAYOUT.padLeft + (day + RANGE_PAST) * historyPxPerDay;
  }
  function formatDay(day) {
    const d = new Date(TODAY + day * DAY_MS);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function clampDay(day) {
    return Math.max(-RANGE_PAST, Math.min(RANGE_FUTURE, Math.round(day)));
  }

  function positionTrunkLabels() {
    const web = document.getElementById("trunk-label-web");
    const srv = document.getElementById("trunk-label-server");
    web.style.left = "16px";
    web.style.top = LAYOUT.webTrunkY - 12 + "px";
    srv.style.left = "16px";
    srv.style.top = LAYOUT.serverTrunkY - 12 + "px";
  }

  function cardById(id) {
    // IDs are generated as `[w|s]-<idx>-<slug>` with slug already safe-charset.
    return document.querySelector(`.branch[data-id="${id}"]`);
  }

  function sizeTimeline() {
    const w = tlLayoutWidth();
    paths.setAttribute("width", w);
    paths.setAttribute("height", LAYOUT.height);
    paths.style.width = w + "px";
    paths.style.height = LAYOUT.height + "px";
    return w;
  }

  /* ════════════ Server-backed plan persistence (Vercel KV / local file) ════════════ */
  // In-memory cache of the plan — seeded from the server-rendered payload.
  let planCache = (payload && payload.plan) || {};

  function loadPlan() {
    return planCache;
  }
  function setPlanDay(id, day) {
    const clamped = day === null || day === undefined ? null : clampDay(day);
    if (clamped === null) delete planCache[id];
    else planCache[id] = clamped;
    // Fire and forget — optimistic UI. On failure we log and show a toast.
    fetch("/api/roadmap", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, day: clamped }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      })
      .catch((e) => {
        console.error("[roadmap] save failed:", e);
        showToast("Couldn't save to server — retrying on your next drag");
      });
  }
  function resetPlan() {
    planCache = {};
    return fetch("/api/roadmap", { method: "DELETE" }).catch((e) => {
      console.error("[roadmap] reset failed:", e);
      showToast("Couldn't reset on the server");
    });
  }

  /* ════════════ Roadmap positions ════════════ */
  function defaultDayFor(b) {
    // lastDays is days since last commit (positive). Map to negative day offset
    // and clamp to the visible range so cards without a real date park at the left edge.
    const d = b.lastDays ?? 0;
    return clampDay(-Math.round(d));
  }
  function roadmapPositions() {
    const plan = loadPlan();
    const pos = {};
    [...DATA.web, ...DATA.server].forEach((b) => {
      const day = plan[b.id] !== undefined ? plan[b.id] : defaultDayFor(b);
      const y = b.side === "web" ? LAYOUT.webCardY : LAYOUT.serverCardY;
      pos[b.id] = {
        x: tlDateToX(day) - LAYOUT.cardW / 2,
        y,
        day,
      };
    });
    return pos;
  }
  // z-index follows the timeline direction: later dates sit on top of earlier dates.
  function zIndexForDay(day) {
    return 3 + Math.round(clampDay(day) + RANGE_PAST); // 3..153
  }

  let positions = {};

  function branchSignals(b) {
    const sig = [];
    const recent = (b.commits14 || []).slice(-7).reduce((a, x) => a + x, 0);
    if (b.stage !== "abandoned" && recent === 0 && b.lastDays >= 5) {
      sig.push(`<span class="signal warn" title="No commits in a week">stalling</span>`);
    }
    const growth = (b.files || 0) - (b.filesStart || 0);
    if (growth >= 40) {
      sig.push(`<span class="signal warn" title="Scope grew from ${b.filesStart} → ${b.files} files">+${growth} files</span>`);
    }
    if (b.stage !== "abandoned" && (b.authors || []).length === 1) {
      const load = authorLoad(b.authors[0]);
      if (load >= 4) {
        sig.push(`<span class="signal risk" title="${b.authors[0]} owns ${load} in-flight branches — bottleneck">@${b.authors[0]} ×${load}</span>`);
      } else {
        sig.push(`<span class="signal warn" title="Single committer — knowledge silo risk">solo</span>`);
      }
    }
    if (b.pr && b.pr.state === "stale") {
      sig.push(`<span class="signal risk" title="PR open with no recent review activity">PR idle</span>`);
    }
    return sig.join("");
  }

  function prBadge(pr) {
    if (!pr) return "";
    const n = pr.n;
    if (pr.state === "draft") return `<a href="${pr.url}" target="_blank" rel="noreferrer" class="pr-badge draft" title="Draft PR">PR #${n} · draft</a>`;
    if (pr.state === "approved") return `<a href="${pr.url}" target="_blank" rel="noreferrer" class="pr-badge approved" title="All required reviews received">PR #${n} · ${pr.reviews}/${pr.required} ✓</a>`;
    if (pr.state === "stale") return `<a href="${pr.url}" target="_blank" rel="noreferrer" class="pr-badge stale" title="No review activity recently">PR #${n} · idle</a>`;
    if (pr.state === "merged") return `<a href="${pr.url}" target="_blank" rel="noreferrer" class="pr-badge merged">PR #${n} · merged</a>`;
    return `<a href="${pr.url}" target="_blank" rel="noreferrer" class="pr-badge open" title="Awaiting reviews">PR #${n} · open</a>`;
  }
  function issueBadge(is) {
    if (!is) return "";
    return `<span class="issue-badge" title="${escAttr(is.title)} (${is.status.replace(/_/g, " ")})">${is.sys}-${is.id}</span>`;
  }

  function dateBadgeClass(day) {
    if (day < -1) return "past";
    if (day > 1) return "future";
    return "";
  }
  function renderCards() {
    timeline.querySelectorAll(".branch").forEach((el) => el.remove());
    [...DATA.web, ...DATA.server].forEach((b) => {
      const side = b.side;
      const pos = positions[b.id];
      if (!pos) return;
      const el = document.createElement("div");
      el.className = `branch ${side}`;
      el.dataset.id = b.id;
      el.dataset.side = side;
      el.dataset.feature = b.feature || "";
      el.style.left = pos.x + "px";
      el.style.top = pos.y + "px";
      const day = pos.day ?? defaultDayFor(b);
      el.style.zIndex = String(zIndexForDay(day));
      el.innerHTML = `
        <div class="top-row">
          <div class="top-left">
            <span class="date-badge ${dateBadgeClass(day)}" title="Scheduled for ${formatDay(day)}">${formatDay(day)}</span>
            <div class="signals">${branchSignals(b)}</div>
          </div>
          ${sparkSvg(b.commits14)}
        </div>
        <div class="synth" title="${escAttr(b.synth)}">${escAttr(b.synth)}</div>
        <div class="name-row">
          <span class="stage ${b.stage}"></span>
          <a class="name" href="${b.url}" target="_blank" rel="noreferrer" title="${escAttr(b.name)}">${escAttr(b.name)}</a>
        </div>
        <div class="meta-row">
          <span><span class="ahead">↑${b.ahead}</span> · <span class="behind">↓${b.behind}</span> · ${b.files} files</span>
          <span>${b.last}</span>
        </div>
        ${b.feature ? `<span class="feature-tag" data-feature="${b.feature}">${b.feature}</span>` : ""}
        <div class="bottom-row">
          <div class="authors">${(b.authors || []).map(avatarEl).join("")}</div>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            ${prBadge(b.pr)}
            ${issueBadge(b.issue)}
          </div>
        </div>
      `;
      timeline.appendChild(el);
      attachDrag(el);
      el.querySelectorAll(".feature-tag").forEach((tag) => {
        tag.addEventListener("click", (e) => {
          e.stopPropagation();
          openFeatureModal(tag.dataset.feature);
        });
      });
      el.querySelectorAll("a").forEach((a) => {
        a.addEventListener("pointerdown", (e) => e.stopPropagation());
      });
    });
  }
  function refreshCardDateBadge(el, day) {
    const badge = el.querySelector(".date-badge");
    if (!badge) return;
    badge.className = `date-badge ${dateBadgeClass(day)}`;
    badge.textContent = formatDay(day);
    badge.title = `Scheduled for ${formatDay(day)}`;
  }

  /* ══════════════ Paths (date axis, trunks, branch curves, cross-repo connectors) ══════════════ */
  function renderPaths() {
    const w = sizeTimeline();
    const h = LAYOUT.height;
    paths.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const trunkX1 = tlDateToX(-RANGE_PAST) + 8;
    const trunkX2 = w - 20;
    let svg = "";

    // ── Date axis — faint week-gridlines + tick labels + NOW line ──
    const axisY = h - 26;
    // Background band for future (helps visual split between past and planned)
    const nowX = tlDateToX(0);
    svg += `<rect x="${nowX}" y="10" width="${w - nowX - 10}" height="${h - 50}" fill="rgba(139,92,246,0.025)"/>`;
    // Week grid
    for (let d = -RANGE_PAST; d <= RANGE_FUTURE; d += 7) {
      const x = tlDateToX(d);
      const isNow = d === 0;
      svg += `<line x1="${x}" y1="10" x2="${x}" y2="${axisY}" stroke="${isNow ? "rgba(139,92,246,0.45)" : "rgba(255,255,255,0.04)"}" stroke-width="${isNow ? 1.4 : 1}" stroke-dasharray="${isNow ? "" : "2 4"}"/>`;
      // Date tick label at the bottom
      if (d % 14 === 0 || isNow) {
        const label = isNow ? "today" : formatDay(d);
        svg += `<text x="${x}" y="${h - 8}" text-anchor="middle" fill="${isNow ? "#c4b5fd" : "rgba(160,160,180,0.75)"}" font-size="10" font-family="ui-monospace,monospace" font-weight="${isNow ? "600" : "400"}">${label}</text>`;
      }
    }
    // NOW badge indicator at top of axis
    svg += `<rect x="${nowX - 24}" y="${h - 24}" width="48" height="16" rx="3" fill="#12121c" stroke="rgba(139,92,246,0.6)"/>`;

    // ── Web trunk ── (aligned to date axis: trunk spans the whole view horizontally)
    svg += `<line x1="${trunkX1}" y1="${LAYOUT.webTrunkY}" x2="${trunkX2}" y2="${LAYOUT.webTrunkY}" stroke="rgba(56,189,248,0.35)" stroke-width="2"/>`;
    // Tick marks every 7 days on the web trunk (past only)
    for (let d = -RANGE_PAST; d <= 0; d += 7) {
      svg += `<circle cx="${tlDateToX(d)}" cy="${LAYOUT.webTrunkY}" r="1.8" fill="rgba(56,189,248,0.6)"/>`;
    }
    // Web deploy flags placed at their actual date
    (DEPLOYS.web || []).forEach((d) => {
      if (d > RANGE_PAST) return;
      const x = tlDateToX(-d);
      svg += `<g><path class="deploy-flag" d="M ${x} ${LAYOUT.webTrunkY - 10} L ${x + 8} ${LAYOUT.webTrunkY - 6} L ${x} ${LAYOUT.webTrunkY - 2} Z"/>
              <line x1="${x}" y1="${LAYOUT.webTrunkY - 11}" x2="${x}" y2="${LAYOUT.webTrunkY - 1}" stroke="#a78bfa" stroke-width="1.2"/><title>web deploy · ${d}d ago</title></g>`;
    });

    // ── Server trunk ──
    svg += `<line x1="${trunkX1}" y1="${LAYOUT.serverTrunkY}" x2="${trunkX2}" y2="${LAYOUT.serverTrunkY}" stroke="rgba(244,114,182,0.35)" stroke-width="2"/>`;
    for (let d = -RANGE_PAST; d <= 0; d += 7) {
      svg += `<circle cx="${tlDateToX(d)}" cy="${LAYOUT.serverTrunkY}" r="1.8" fill="rgba(244,114,182,0.6)"/>`;
    }
    (DEPLOYS.server || []).forEach((d) => {
      if (d > RANGE_PAST) return;
      const x = tlDateToX(-d);
      svg += `<g><path class="deploy-flag" d="M ${x} ${LAYOUT.serverTrunkY + 2} L ${x + 8} ${LAYOUT.serverTrunkY + 6} L ${x} ${LAYOUT.serverTrunkY + 10} Z"/>
              <line x1="${x}" y1="${LAYOUT.serverTrunkY + 1}" x2="${x}" y2="${LAYOUT.serverTrunkY + 11}" stroke="#a78bfa" stroke-width="1.2"/><title>server deploy · ${d}d ago</title></g>`;
    });

    // Branch curves from trunk to card — wrapped in a clickable group with a
    // wide transparent hit path so the connector line itself is selectable.
    [...DATA.web, ...DATA.server].forEach((b) => {
      const side = b.side;
      const trunkY = side === "web" ? LAYOUT.webTrunkY : LAYOUT.serverTrunkY;
      const color = side === "web" ? "rgba(56,189,248," : "rgba(244,114,182,";
      const stroke = b.stage === "abandoned" ? color + "0.25)" : color + "0.65)";
      const dash = b.stage === "abandoned" ? "4 4" : b.stage === "stale" ? "6 3" : "0";
      const pos = positions[b.id];
      if (!pos) return;
      const startX = pos.x + LAYOUT.cardW / 2;
      const endX = startX;
      const startY = trunkY;
      const endY = side === "web" ? pos.y + LAYOUT.cardH - 2 : pos.y + 2;
      const midY = (startY + endY) / 2;
      const curveOffset = side === "web" ? -24 : 24;
      const d = `M ${startX} ${startY} C ${startX} ${midY - curveOffset}, ${endX} ${midY + curveOffset}, ${endX} ${endY}`;

      svg += `<g class="branch-curve" data-id="${b.id}" data-side="${side}">`;
      svg += `<path class="branch-hit" d="${d}"/>`;
      svg += `<path class="branch-vis" d="${d}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-dasharray="${dash}"/>`;
      const dotCount = Math.max(1, Math.min(4, Math.round((b.ahead || 0) / 3)));
      for (let i = 1; i <= dotCount; i++) {
        const t = i / (dotCount + 1);
        const dy = startY + (endY - startY) * t;
        svg += `<circle cx="${endX}" cy="${dy}" r="1.8" fill="${stroke}" pointer-events="none"/>`;
      }
      svg += `<circle cx="${endX}" cy="${endY}" r="3.5" fill="${color}0.9)" stroke="${color}1)" stroke-width="1" pointer-events="none"/>`;
      svg += `</g>`;
    });

    // Cross-repo connectors between shared features
    const features = [...new Set(DATA.web.filter((b) => b.feature).map((b) => b.feature))].filter(
      (f) => DATA.server.some((b) => b.feature === f),
    );
    features.forEach((f) => {
      const wBr = DATA.web.find((b) => b.feature === f);
      const sBr = DATA.server.find((b) => b.feature === f);
      if (!wBr || !sBr) return;
      const wp = positions[wBr.id];
      const sp = positions[sBr.id];
      if (!wp || !sp) return;
      const wx = wp.x + LAYOUT.cardW / 2;
      const sx = sp.x + LAYOUT.cardW / 2;
      const wy = wp.y + LAYOUT.cardH;
      const sy = sp.y;
      const aligned = Math.abs(wx - sx) < 8;
      const stroke = aligned ? "rgba(167,139,250,0.9)" : "rgba(167,139,250,0.28)";
      const width = aligned ? 1.6 : 1.2;
      svg += `<path d="M ${wx} ${wy + 2} C ${wx} ${(wy + sy) / 2}, ${sx} ${(wy + sy) / 2}, ${sx} ${sy - 2}"
                fill="none" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="3 4"/>`;
      if (aligned) {
        const midX = (wx + sx) / 2;
        const midY = (wy + sy) / 2;
        svg += `<circle cx="${midX}" cy="${midY}" r="3" fill="rgba(167,139,250,0.9)"/>`;
        svg += `<text x="${midX}" y="${midY - 8}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="rgba(167,139,250,0.95)">${f}</text>`;
      }
    });

    paths.innerHTML = svg;

    features.forEach((f) => {
      const wBr = DATA.web.find((b) => b.feature === f);
      const sBr = DATA.server.find((b) => b.feature === f);
      if (!wBr || !sBr) return;
      const wp = positions[wBr.id];
      const sp = positions[sBr.id];
      if (!wp || !sp) return;
      const aligned = Math.abs(wp.x - sp.x) < 8;
      cardById(wBr.id)?.classList.toggle("aligned", aligned);
      cardById(sBr.id)?.classList.toggle("aligned", aligned);
    });
  }

  /* ══════════════ Drag ══════════════ */
  function attachDrag(el) {
    let startX = 0, origX = 0, dragging = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".feature-tag") || e.target.closest("a")) return;
      dragging = true;
      startX = e.clientX;
      origX = parseFloat(el.style.left);
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      let nx = origX + dx;
      // Snap to the other-side counterpart card in cross-repo features
      const id = el.dataset.id;
      const data = [...DATA.web, ...DATA.server].find((b) => b.id === id);
      if (data?.feature) {
        const other = (el.dataset.side === "web" ? DATA.server : DATA.web).find(
          (b) => b.feature === data.feature,
        );
        if (other && positions[other.id]) {
          const ox = positions[other.id].x;
          if (Math.abs(nx - ox) < 14) nx = ox;
        }
      }
      // Clamp to axis range so cards never leave the visible range
      const minX = tlDateToX(-RANGE_PAST) - LAYOUT.cardW / 2;
      const maxX = tlDateToX(RANGE_FUTURE) - LAYOUT.cardW / 2;
      nx = Math.max(minX, Math.min(maxX, nx));
      positions[id].x = nx;
      // Recompute day offset so the badge updates live while dragging
      const day = clampDay(tlXToDate(nx + LAYOUT.cardW / 2));
      positions[id].day = day;
      refreshCardDateBadge(el, day);
      el.style.left = nx + "px";
      renderPaths();
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      const id = el.dataset.id;
      const day = positions[id]?.day;
      if (day !== undefined) setPlanDay(id, day);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  /* ══════════════ Rendering orchestration ══════════════ */
  let currentMode = "roadmap";
  function applyMode(/* mode */) {
    positions = roadmapPositions();
    renderCards();
    renderPaths();
    updateHash();
  }

  /* ══════════════ Contract drift ══════════════ */
  function driftChangeRow(c) {
    const stateLabel =
      c.state === "unconsumed" ? "unconsumed · " + c.days + "d" :
      c.state === "drift" ? "drift · " + c.days + "d" :
      "consumed";
    return `<div class="drift-change">
      <span class="path"><span class="kind">${c.kind}</span><span class="p-text" title="${escAttr(c.path)}">${escAttr(c.path)}</span></span>
      <span class="state ${c.state}">${stateLabel}</span>
    </div>`;
  }
  function renderDrift() {
    const el = document.getElementById("drift-grid");
    if (CONTRACT_DRIFT.length === 0) {
      el.innerHTML = `<div class="drill-empty" style="grid-column: span 2">No shared feature branches across repos right now — nothing to drift.</div>`;
      return;
    }
    el.innerHTML = CONTRACT_DRIFT.map(
      (d) => `
        <div class="drift-card ${d.severity}">
          <div class="head">
            <span class="name">${escAttr(d.feature)}</span>
            <span class="badge ${d.severity}">${d.severity === "ok" ? "in sync" : d.severity === "warn" ? "needs update" : "breaking drift"}</span>
          </div>
          ${d.changes.map(driftChangeRow).join("")}
          <div class="drift-verdict ${d.severity === "ok" ? "" : d.severity}">${escAttr(d.verdict)}</div>
        </div>`,
    ).join("");
  }

  /* ══════════════ Merged history ══════════════ */
  let historyFilter = "all";

  function assignSlots(branches) {
    const sorted = [...branches].sort((a, b) => b.start - a.start);
    const placed = [];
    return sorted.map((b) => {
      let slot = 0;
      while (true) {
        const conflict = placed.some(
          (p) => p.slot === slot && b.start >= p.end && b.end <= p.start,
        );
        if (!conflict) break;
        slot++;
        if (slot > 50) break;
      }
      const item = { ...b, slot };
      placed.push(item);
      return item;
    });
  }

  function renderHistoryStats() {
    const all =
      historyFilter === "all"
        ? [...HISTORY.web, ...HISTORY.server]
        : historyFilter === "web"
          ? HISTORY.web
          : HISTORY.server;
    document.getElementById("h-count").textContent = all.length;
    if (all.length === 0) {
      document.getElementById("h-median").textContent = "—";
      document.getElementById("h-longest").textContent = "—";
      document.getElementById("h-last").textContent = "—";
      return;
    }
    const spans = all.map((b) => b.start - b.end).sort((a, b) => a - b);
    const median = spans[Math.floor(spans.length / 2)];
    document.getElementById("h-median").textContent = median + "d";
    const longest = all.reduce((a, b) => (b.start - b.end > a.start - a.end ? b : a));
    const last = longest.name.split("/").pop();
    document.getElementById("h-longest").textContent = `${last} · ${longest.start - longest.end}d`;
    const lastMerge = all.reduce((a, b) => (b.end < a.end ? b : a));
    document.getElementById("h-last").textContent =
      lastMerge.end === 0 ? "today" : lastMerge.end + "d ago";
  }

  function renderHistory() {
    const svgEl = document.getElementById("history-svg");
    const wrapEl = document.getElementById("history-wrap");
    const w = hxLayoutWidth(); // shared with the timeline so "now" aligns vertically
    if (w < 200) {
      requestAnimationFrame(renderHistory);
      return;
    }
    const daysBack = RANGE_PAST;
    const padL = LAYOUT.padLeft;
    const padR = LAYOUT.padRight;
    // Days-ago → x on the shared date axis (d ago → -d day offset)
    const xScale = (d) => hxDateToX(-d);
    const slotH = 38;

    const webW = assignSlots(HISTORY.web);
    const serverW = assignSlots(HISTORY.server);
    const maxWebSlot = webW.length ? Math.max(...webW.map((b) => b.slot)) : 0;
    const maxServerSlot = serverW.length ? Math.max(...serverW.map((b) => b.slot)) : 0;
    const webRegionH = (maxWebSlot + 1) * slotH + 24;
    const serverRegionH = (maxServerSlot + 1) * slotH + 24;
    const webTrunkY = 20 + webRegionH;
    const serverTrunkY = webTrunkY + 48;
    const totalH = serverTrunkY + serverRegionH + 46;

    const parts = [];
    for (let d = 84; d > 0; d -= 14) {
      const x1 = xScale(d);
      const x2 = xScale(Math.max(0, d - 14));
      if ((d / 14) % 2 === 0) {
        parts.push(`<rect x="${x1}" y="10" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, totalH - 44)}" fill="rgba(255,255,255,0.015)"/>`);
      }
    }
    // Trunks extend across the entire shared axis so "now" aligns with the timeline above.
    parts.push(`<line x1="${hxDateToX(-RANGE_PAST)}" y1="${webTrunkY}" x2="${hxDateToX(RANGE_FUTURE)}" y2="${webTrunkY}" stroke="rgba(56,189,248,0.42)" stroke-width="2"/>`);
    parts.push(`<line x1="${hxDateToX(-RANGE_PAST)}" y1="${serverTrunkY}" x2="${hxDateToX(RANGE_FUTURE)}" y2="${serverTrunkY}" stroke="rgba(244,114,182,0.42)" stroke-width="2"/>`);
    // NOW vertical line — matches the one in the timeline
    const nowX = hxDateToX(0);
    parts.push(`<line x1="${nowX}" y1="10" x2="${nowX}" y2="${totalH - 30}" stroke="rgba(139,92,246,0.45)" stroke-width="1.4"/>`);
    parts.push(`<rect x="${nowX - 20}" y="${totalH - 24}" width="40" height="16" rx="3" fill="#12121c" stroke="rgba(139,92,246,0.6)"/>`);

    const mapDeployX = (d) => xScale(Math.min(daysBack, d));
    (DEPLOYS.web || []).forEach((d) => {
      const x = mapDeployX(d);
      parts.push(`<g><path class="deploy-flag" d="M ${x} ${webTrunkY - 12} L ${x + 9} ${webTrunkY - 7} L ${x} ${webTrunkY - 2} Z"/>
                  <line x1="${x}" y1="${webTrunkY - 13}" x2="${x}" y2="${webTrunkY - 1}" stroke="#a78bfa" stroke-width="1.2"/>
                  <title>Web deploy · ${d}d ago</title></g>`);
    });
    (DEPLOYS.server || []).forEach((d) => {
      const x = mapDeployX(d);
      parts.push(`<g><path class="deploy-flag" d="M ${x} ${serverTrunkY + 2} L ${x + 9} ${serverTrunkY + 7} L ${x} ${serverTrunkY + 12} Z"/>
                  <line x1="${x}" y1="${serverTrunkY + 1}" x2="${x}" y2="${serverTrunkY + 13}" stroke="#a78bfa" stroke-width="1.2"/>
                  <title>Server deploy · ${d}d ago</title></g>`);
    });

    parts.push(`<rect x="14" y="${webTrunkY - 10}" width="86" height="20" rx="5" fill="#12121c" stroke="rgba(255,255,255,0.1)"/>`);
    parts.push(`<circle cx="26" cy="${webTrunkY}" r="3" fill="rgba(56,189,248,1)"/>`);
    parts.push(`<text x="36" y="${webTrunkY + 4}" fill="#a6a6b8" font-size="10.5" font-family="ui-monospace,monospace">web · develop</text>`);
    parts.push(`<rect x="14" y="${serverTrunkY - 10}" width="86" height="20" rx="5" fill="#12121c" stroke="rgba(255,255,255,0.1)"/>`);
    parts.push(`<circle cx="26" cy="${serverTrunkY}" r="3" fill="rgba(244,114,182,1)"/>`);
    parts.push(`<text x="36" y="${serverTrunkY + 4}" fill="#a6a6b8" font-size="10.5" font-family="ui-monospace,monospace">server · develop</text>`);

    // Week ticks matching the timeline's axis so labels line up exactly
    for (let d = -RANGE_PAST; d <= RANGE_FUTURE; d += 14) {
      const x = hxDateToX(d);
      const isNow = d === 0;
      parts.push(`<line x1="${x}" y1="${totalH - 34}" x2="${x}" y2="${totalH - 26}" stroke="${isNow ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.16)"}"/>`);
      const label = isNow ? "today" : formatDay(d);
      parts.push(`<text x="${x}" y="${totalH - 12}" text-anchor="middle" fill="${isNow ? "#c4b5fd" : "rgba(160,160,180,0.75)"}" font-size="10" font-family="ui-monospace,monospace" font-weight="${isNow ? "600" : "400"}">${label}</text>`);
    }

    function renderArcs(branches, trunkY, direction, colorBase, side) {
      branches.forEach((b) => {
        const xs = xScale(Math.min(daysBack, b.start));
        const xe = xScale(Math.max(0, b.end));
        const peakY = trunkY + direction * (30 + b.slot * slotH);
        const path = `M ${xs} ${trunkY} C ${xs} ${peakY}, ${xe} ${peakY}, ${xe} ${trunkY}`;
        const midX = (xs + xe) / 2;
        const labelText = b.name.length > 22 ? b.name.slice(0, 21) + "…" : b.name;
        const nameW = Math.min(190, Math.max(96, labelText.length * 6.3 + 16));

        parts.push(`<g class="hist-group" data-side="${side}"
                       data-name="${escAttr(b.name)}"
                       data-synth="${escAttr(b.synth)}"
                       data-pr="${escAttr(b.pr)}" data-author="${escAttr(b.author)}"
                       data-start="${b.start}" data-end="${b.end}"
                       data-url="${escAttr(b.prUrl || "")}">`);
        parts.push(`<path class="hist-arc" d="${path}" fill="none" stroke="${colorBase}0.65)" stroke-width="1.8"/>`);
        parts.push(`<circle cx="${xs}" cy="${trunkY}" r="2.5" fill="${colorBase}0.55)"/>`);
        parts.push(`<circle class="hist-endpoint" cx="${xe}" cy="${trunkY}" r="4" fill="${colorBase}1)" stroke="#07070c" stroke-width="1.5"/>`);
        for (let i = 1; i <= 2; i++) {
          const t = i / 3;
          const px = xs + (xe - xs) * t;
          const py = trunkY + (peakY - trunkY) * (1 - Math.pow(2 * t - 1, 2));
          parts.push(`<circle cx="${px}" cy="${py}" r="1.6" fill="${colorBase}0.8)"/>`);
        }
        parts.push(`<g class="hist-label">
          <rect x="${midX - nameW / 2}" y="${peakY - 10}" width="${nameW}" height="20" rx="5" fill="#12121c" stroke="rgba(255,255,255,0.1)"/>
          <text x="${midX}" y="${peakY + 4}" text-anchor="middle" fill="#eceff5" font-size="10.5" font-family="ui-monospace,monospace">${escAttr(labelText)}</text>
        </g>`);
        parts.push(`</g>`);
      });
    }

    renderArcs(webW, webTrunkY, -1, "rgba(56,189,248,", "web");
    renderArcs(serverW, serverTrunkY, 1, "rgba(244,114,182,", "server");

    svgEl.setAttribute("viewBox", `0 0 ${w} ${totalH}`);
    svgEl.setAttribute("width", w);
    svgEl.setAttribute("height", totalH);
    svgEl.style.height = totalH + "px";
    svgEl.innerHTML = parts.join("");

    svgEl.querySelectorAll(".hist-group").forEach((g) => {
      g.addEventListener("mouseenter", () => showHistTooltip(g));
      g.addEventListener("mousemove", (e) => positionHistTooltip(e));
      g.addEventListener("mouseleave", hideHistTooltip);
      g.addEventListener("click", () => {
        const url = g.dataset.url;
        if (url) window.open(url, "_blank");
      });
    });
    applyHistoryFilter();
  }

  function showHistTooltip(g) {
    const tip = document.getElementById("history-tip");
    const side = g.dataset.side;
    const sideColor = side === "web" ? "rgba(56,189,248,1)" : "rgba(244,114,182,1)";
    const sideLabel = side === "web" ? REPOS.web : REPOS.server;
    const lifespan = g.dataset.start - g.dataset.end + "d lifespan";
    tip.innerHTML = `
      <div class="tip-name"><span class="side-dot" style="background:${sideColor}"></span>${escAttr(g.dataset.name)}</div>
      <div class="tip-synth">${escAttr(g.dataset.synth)}</div>
      <div class="tip-meta"><span>${sideLabel}</span><span>PR ${escAttr(g.dataset.pr)}</span><span>@${escAttr(g.dataset.author)}</span><span>${lifespan}</span></div>
    `;
    tip.classList.add("show");
  }
  function positionHistTooltip(e) {
    // Tooltip is position: fixed — use viewport coords so it's never clipped
    // by the horizontally-scrollable history wrap.
    const tip = document.getElementById("history-tip");
    const tw = tip.offsetWidth || 280;
    const th = tip.offsetHeight || 100;
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + tw > window.innerWidth - 12) x = e.clientX - tw - 14;
    if (y + th > window.innerHeight - 12) y = e.clientY - th - 14;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideHistTooltip() {
    document.getElementById("history-tip").classList.remove("show");
  }
  function applyHistoryFilter() {
    document.querySelectorAll(".hist-group").forEach((g) => {
      const show = historyFilter === "all" || g.dataset.side === historyFilter;
      g.classList.toggle("hidden", !show);
    });
    renderHistoryStats();
  }
  document.querySelectorAll("#history-controls button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#history-controls button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      historyFilter = btn.dataset.filter;
      applyHistoryFilter();
      updateHash();
    });
  });

  /* ══════════════ Shared features ══════════════ */
  function renderShared() {
    const shared = [...new Set(DATA.server.filter((b) => b.feature).map((b) => b.feature))].filter(
      (f) => DATA.web.some((w) => w.feature === f),
    );
    const el = document.getElementById("shared-features");
    if (shared.length === 0) {
      el.innerHTML = `<div class="drill-empty" style="grid-column: span 4">No features matched across both repos right now. Name branches <code>feature/&lt;slug&gt;</code> on both sides to see alignment here.</div>`;
      return;
    }
    const scoreOf = (w, s) => {
      // 100 = perfectly in sync. Penalize ahead/behind and staleness.
      const gap = Math.abs((w.ahead || 0) - (s.ahead || 0)) + Math.abs((w.behind || 0) - (s.behind || 0));
      const stale = (w.lastDays || 0) + (s.lastDays || 0);
      return Math.max(10, Math.min(95, 100 - gap * 2 - stale * 0.8));
    };
    const verdictOf = (w, s, drift) => {
      if (drift?.severity === "risk") return { text: "Contract drift — rebase and adopt new DTOs before merging.", cls: "risk" };
      if (w.behind > 10) return { text: `Web is ${w.behind} behind server — rebase before picking back up.`, cls: "warn" };
      if (drift?.severity === "warn") return { text: "Server shipped contracts web hasn't adopted yet. Coordinate merge order.", cls: "warn" };
      if (w.ahead > s.ahead) return { text: `Web is ahead of server — align contracts before final merge.`, cls: "" };
      return { text: "Both sides tracking cleanly. Safe to continue.", cls: "" };
    };

    el.innerHTML = shared
      .slice(0, 8)
      .map((f) => {
        const w = DATA.web.find((b) => b.feature === f);
        const s = DATA.server.find((b) => b.feature === f);
        const drift = CONTRACT_DRIFT.find((d) => d.feature === f);
        const score = Math.round(scoreOf(w, s));
        const v = verdictOf(w, s, drift);
        return `
        <div class="shared-feature" data-feature="${f}">
          <div class="fname">${escAttr(f)}</div>
          <div class="sides">
            <div class="side web"><div class="label">web</div><div class="stat">↑${w.ahead} · ${w.last}</div></div>
            <div class="side server"><div class="label">server</div><div class="stat">↑${s.ahead} · ${s.last}</div></div>
          </div>
          <div class="alignment-bar"><div class="fill" style="width:${score}%"></div></div>
          <div class="verdict ${v.cls}">${escAttr(v.text)}</div>
        </div>`;
      })
      .join("");
    el.querySelectorAll(".shared-feature").forEach((c) => {
      c.addEventListener("click", () => openFeatureModal(c.dataset.feature));
    });
  }

  /* ══════════════ Feature modal ══════════════ */
  function openFeatureModal(feature) {
    const w = DATA.web.find((b) => b.feature === feature);
    const s = DATA.server.find((b) => b.feature === feature);

    const related = {
      web: HISTORY.web.filter((h) => h.name.toLowerCase().includes(feature.split("-")[0])),
      server: HISTORY.server.filter((h) => h.name.toLowerCase().includes(feature.split("-")[0])),
    };
    const drift = CONTRACT_DRIFT.find((d) => d.feature === feature);

    const cardHtml = (b, side) =>
      b
        ? `<div class="drill-card ${side}">
        <div class="name"><span class="stage ${b.stage}"></span>${escAttr(b.name)}</div>
        <div class="synth">${escAttr(b.synth)}</div>
        <div class="meta"><span>↑${b.ahead} · ↓${b.behind} · ${b.files} files</span><span>${b.last}</span></div>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
          <div class="authors" style="display:flex">${(b.authors || []).map(avatarEl).join("")}</div>
          <div style="display:flex;gap:4px">${prBadge(b.pr)}${issueBadge(b.issue)}</div>
        </div>
      </div>`
        : `<div class="drill-empty">No active branch on ${side}</div>`;

    const arcsHtml = (() => {
      if (related.web.length + related.server.length === 0) {
        return `<div class="drill-empty">No merged history for this feature in the last 90 days</div>`;
      }
      const W = 820, H = 200;
      const padL = 80, padR = 24;
      const days = 90;
      const x = (d) => padL + (days - d) * (W - padL - padR) / days;
      const trunkW = H * 0.5, trunkS = H * 0.5 + 8;
      let p = "";
      p += `<line x1="${padL - 20}" y1="${trunkW}" x2="${W - padR + 10}" y2="${trunkW}" stroke="rgba(56,189,248,0.42)" stroke-width="2"/>`;
      p += `<line x1="${padL - 20}" y1="${trunkS}" x2="${W - padR + 10}" y2="${trunkS}" stroke="rgba(244,114,182,0.42)" stroke-width="2"/>`;
      related.web.forEach((b) => {
        const xs = x(Math.min(90, b.start)), xe = x(Math.max(0, b.end));
        const peak = trunkW - 36;
        p += `<path d="M ${xs} ${trunkW} C ${xs} ${peak}, ${xe} ${peak}, ${xe} ${trunkW}" fill="none" stroke="rgba(56,189,248,0.7)" stroke-width="1.6"/>`;
        p += `<circle cx="${xe}" cy="${trunkW}" r="3.5" fill="rgba(56,189,248,1)" stroke="#07070c" stroke-width="1"/>`;
        const mx = (xs + xe) / 2;
        const label = b.name.length > 22 ? b.name.slice(0, 21) + "…" : b.name;
        const nw = Math.min(170, label.length * 6 + 14);
        p += `<rect x="${mx - nw / 2}" y="${peak - 10}" width="${nw}" height="20" rx="4" fill="#12121c" stroke="rgba(255,255,255,0.1)"/>`;
        p += `<text x="${mx}" y="${peak + 4}" text-anchor="middle" fill="#eceff5" font-size="10" font-family="ui-monospace,monospace">${escAttr(label)}</text>`;
      });
      related.server.forEach((b) => {
        const xs = x(Math.min(90, b.start)), xe = x(Math.max(0, b.end));
        const peak = trunkS + 36;
        p += `<path d="M ${xs} ${trunkS} C ${xs} ${peak}, ${xe} ${peak}, ${xe} ${trunkS}" fill="none" stroke="rgba(244,114,182,0.7)" stroke-width="1.6"/>`;
        p += `<circle cx="${xe}" cy="${trunkS}" r="3.5" fill="rgba(244,114,182,1)" stroke="#07070c" stroke-width="1"/>`;
        const mx = (xs + xe) / 2;
        const label = b.name.length > 22 ? b.name.slice(0, 21) + "…" : b.name;
        const nw = Math.min(170, label.length * 6 + 14);
        p += `<rect x="${mx - nw / 2}" y="${peak - 10}" width="${nw}" height="20" rx="4" fill="#12121c" stroke="rgba(255,255,255,0.1)"/>`;
        p += `<text x="${mx}" y="${peak + 4}" text-anchor="middle" fill="#eceff5" font-size="10" font-family="ui-monospace,monospace">${escAttr(label)}</text>`;
      });
      p += `<text x="20" y="${trunkW + 4}" fill="#a6a6b8" font-size="10" font-family="ui-monospace,monospace">web</text>`;
      p += `<text x="20" y="${trunkS + 4}" fill="#a6a6b8" font-size="10" font-family="ui-monospace,monospace">server</text>`;
      return `<svg class="drill-mini-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${p}</svg>`;
    })();

    const driftHtml = drift
      ? `<div class="drill-section">
          <h4>Contract drift</h4>
          <div class="drift-card ${drift.severity}">
            ${drift.changes.map(driftChangeRow).join("")}
            <div class="drift-verdict ${drift.severity === "ok" ? "" : drift.severity}">${escAttr(drift.verdict)}</div>
          </div>
        </div>`
      : "";

    const body = `
      <div class="drill-section">
        <h4>In flight now</h4>
        <div class="drill-cards">
          ${cardHtml(w, "web")}
          ${cardHtml(s, "server")}
        </div>
      </div>
      ${driftHtml}
      <div class="drill-section">
        <h4>Past merged branches for this feature</h4>
        ${arcsHtml}
      </div>
    `;
    document.getElementById("feature-modal-title").textContent = `Feature · ${feature}`;
    document.getElementById("feature-modal-body").innerHTML = body;
    openModal("feature-modal");
    updateHash(feature);
  }

  /* ══════════════ Modals ══════════════ */
  function openModal(id) {
    document.getElementById(id).classList.add("show");
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove("show");
    if (id === "feature-modal") updateHash(null);
  }
  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => closeModal(el.dataset.close));
  });
  document.querySelectorAll(".modal-backdrop").forEach((bd) => {
    bd.addEventListener("click", (e) => {
      if (e.target === bd) closeModal(bd.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((m) => closeModal(m.id));
  });

  /* ══════════════ Weekly digest ══════════════ */
  function generateDigest() {
    const shippedThisWeek = [
      ...HISTORY.web.map((b) => ({ ...b, side: "web" })),
      ...HISTORY.server.map((b) => ({ ...b, side: "server" })),
    ].filter((b) => b.end <= 7);

    const inFlight = [
      ...DATA.web.map((b) => ({ ...b, side: "web" })),
      ...DATA.server.map((b) => ({ ...b, side: "server" })),
    ].filter((b) => b.stage === "active");

    const stuck = [
      ...DATA.web.map((b) => ({ ...b, side: "web" })),
      ...DATA.server.map((b) => ({ ...b, side: "server" })),
    ].filter((b) => b.stage === "stale" || (b.pr && b.pr.state === "stale"));

    const overloaded = [
      ...new Set([...DATA.web, ...DATA.server].flatMap((b) => b.authors || [])),
    ]
      .map((a) => ({ a, load: authorLoad(a) }))
      .filter((x) => x.load >= 4);

    const drifts = CONTRACT_DRIFT.filter((d) => d.severity !== "ok");

    let md = `# Flash repos · weekly digest\n`;
    md += `_Generated ${new Date().toISOString().slice(0, 10)}_\n\n`;

    md += `## Shipped this week\n`;
    if (shippedThisWeek.length === 0) md += `_Nothing shipped yet this week._\n`;
    else
      shippedThisWeek.forEach((b) => {
        md += `- **[${b.side}]** \`${b.name}\` (${b.pr}) — ${b.synth} _(merged ${b.end}d ago, ${b.start - b.end}d lifespan)_\n`;
      });

    md += `\n## In flight\n`;
    if (inFlight.length === 0) md += `_No active branches._\n`;
    else
      inFlight.forEach((b) => {
        md += `- **[${b.side}]** \`${b.name}\` — ${b.synth} _(↑${b.ahead} ↓${b.behind}, last ${b.last}, @${(b.authors || []).join(", ")})_\n`;
      });

    md += `\n## Stuck / needs attention\n`;
    if (stuck.length === 0) md += `_Nothing stalled._\n`;
    else
      stuck.forEach((b) => {
        md += `- **[${b.side}]** \`${b.name}\` — last commit ${b.last}, PR ${b.pr ? "#" + b.pr.n + " " + b.pr.state : "none"}\n`;
      });

    md += `\n## Cross-repo contract drift\n`;
    if (drifts.length === 0) md += `_All contracts in sync._\n`;
    else
      drifts.forEach((d) => {
        md += `- **${d.feature}** — ${d.verdict}\n`;
        d.changes
          .filter((c) => c.state !== "consumed")
          .forEach((c) => {
            md += `  - \`${c.path}\` (${c.state}, ${c.days}d)\n`;
          });
      });

    md += `\n## Recommended merge order\n`;
    const order = computeMergeOrder();
    if (order.length === 0) md += `_No cross-repo sequencing needed._\n`;
    else order.forEach((o, i) => (md += `${i + 1}. \`${o.name}\` — ${o.why}\n`));

    if (overloaded.length) {
      md += `\n## Bottlenecks\n`;
      overloaded.forEach((o) => {
        md += `- **@${o.a}** is on ${o.load} in-flight branches — consider rebalancing\n`;
      });
    }
    return md;
  }

  function openDigest() {
    document.getElementById("digest-text").value = generateDigest();
    openModal("digest-modal");
  }
  document.getElementById("btn-digest").addEventListener("click", openDigest);
  document.getElementById("digest-regen").addEventListener("click", () => {
    document.getElementById("digest-text").value = generateDigest();
  });
  document.getElementById("digest-copy").addEventListener("click", () => {
    const ta = document.getElementById("digest-text");
    ta.select();
    navigator.clipboard?.writeText(ta.value).then(() => showToast("Digest copied"));
  });

  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1600);
  }

  /* ══════════════ Share / hash ══════════════ */
  function updateHash(featureOverride) {
    const params = new URLSearchParams();
    params.set("group", currentMode);
    params.set("hist", historyFilter);
    const featModalOpen = document.getElementById("feature-modal").classList.contains("show");
    if (featureOverride) params.set("feature", featureOverride);
    else if (featureOverride === null) {
      // clearing — skip
    } else if (featModalOpen) {
      const title = document.getElementById("feature-modal-title").textContent;
      const m = title.match(/· (.+)$/);
      if (m) params.set("feature", m[1]);
    }
    history.replaceState(null, "", "#" + params.toString());
  }
  function applyHash() {
    if (!location.hash) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const group = params.get("group");
    if (group && ["feature", "stage", "recency"].includes(group)) {
      document.querySelectorAll("#viz-controls button").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === group);
      });
      applyMode(group);
    }
    const hist = params.get("hist");
    if (hist && ["all", "web", "server"].includes(hist)) {
      document.querySelectorAll("#history-controls button").forEach((b) => {
        b.classList.toggle("active", b.dataset.filter === hist);
      });
      historyFilter = hist;
      applyHistoryFilter();
    }
    const feature = params.get("feature");
    if (feature) openFeatureModal(feature);
  }
  document.getElementById("btn-share").addEventListener("click", () => {
    updateHash();
    navigator.clipboard?.writeText(location.href).then(() => showToast("Link to this view copied"));
  });

  /* ══════════════ Zoom (per section), Today, Reset, Select-from-connector ══════════════ */
  function centerScrollOnNow(el, xAt) {
    if (!el) return;
    el.scrollLeft = xAt - el.clientWidth / 2;
  }
  function scrollAllToNow() {
    centerScrollOnNow(document.getElementById("timeline"), tlDateToX(0));
    centerScrollOnNow(document.getElementById("history-wrap"), hxDateToX(0));
    positionNowBadge();
  }
  function positionNowBadge() {
    const badge = document.getElementById("now-badge");
    const tl = document.getElementById("timeline");
    if (!badge || !tl) return;
    const nowX = tlDateToX(0) - tl.scrollLeft;
    badge.style.left = nowX + "px";
  }

  // Timeline zoom — only affects the roadmap.
  const zoomSlider = document.getElementById("zoom-slider");
  if (zoomSlider) {
    zoomSlider.addEventListener("input", () => {
      const oldPx = timelinePxPerDay;
      const newPx = Number(zoomSlider.value);
      const tl = document.getElementById("timeline");
      const visibleCenter = tl.scrollLeft + tl.clientWidth / 2;
      const dateAtCenter = (visibleCenter - LAYOUT.padLeft) / oldPx - RANGE_PAST;
      timelinePxPerDay = newPx;
      applyMode(currentMode);
      const newCenter = LAYOUT.padLeft + (dateAtCenter + RANGE_PAST) * newPx;
      tl.scrollLeft = newCenter - tl.clientWidth / 2;
      positionNowBadge();
    });
  }
  // History zoom — only affects merged history.
  const historyZoomSlider = document.getElementById("history-zoom-slider");
  if (historyZoomSlider) {
    historyZoomSlider.addEventListener("input", () => {
      const oldPx = historyPxPerDay;
      const newPx = Number(historyZoomSlider.value);
      const hw = document.getElementById("history-wrap");
      const visibleCenter = (hw.scrollLeft || 0) + hw.clientWidth / 2;
      const dateAtCenter = (visibleCenter - LAYOUT.padLeft) / oldPx - RANGE_PAST;
      historyPxPerDay = newPx;
      renderHistory();
      const newCenter = LAYOUT.padLeft + (dateAtCenter + RANGE_PAST) * newPx;
      hw.scrollLeft = newCenter - hw.clientWidth / 2;
    });
  }
  document.getElementById("scroll-to-now")?.addEventListener("click", scrollAllToNow);
  document.getElementById("reset-roadmap")?.addEventListener("click", () => {
    resetPlan();
    applyMode(currentMode);
    showToast("Roadmap reset to last-activity dates");
  });
  // Keep the "today" HTML badge tracking the scroll position of the timeline
  document.getElementById("timeline")?.addEventListener("scroll", positionNowBadge, { passive: true });
  window.addEventListener("resize", positionNowBadge);

  /* Click on a connector curve → select + flash its card */
  let selectTimer = null;
  function selectCard(id) {
    document.querySelectorAll(".branch.selected").forEach((el) => el.classList.remove("selected"));
    const card = document.querySelector(`.branch[data-id="${id}"]`);
    if (!card) return;
    card.classList.add("selected");
    const tl = document.getElementById("timeline");
    if (tl) {
      const cardLeft = parseFloat(card.style.left) || 0;
      const target = cardLeft + LAYOUT.cardW / 2 - tl.clientWidth / 2;
      tl.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    }
    clearTimeout(selectTimer);
    selectTimer = setTimeout(() => card.classList.remove("selected"), 1400);
  }
  document.getElementById("paths")?.addEventListener("click", (e) => {
    const g = e.target.closest(".branch-curve");
    if (!g) return;
    selectCard(g.dataset.id);
  });

  /* ══════════════ Boot ══════════════ */
  function boot() {
    // Fill legend-pill labels with real repo names
    document.querySelectorAll(".legend-pills .pill").forEach((pill, i) => {
      const name = i === 0 ? REPOS.web : REPOS.server;
      const dotCls = i === 0 ? "web" : "server";
      pill.innerHTML = `<span class="dot ${dotCls}"></span> ${name}`;
    });
    document.getElementById("trunk-label-web").innerHTML =
      `<span class="dot web"></span> <strong>${REPOS.web}</strong> · develop`;
    document.getElementById("trunk-label-server").innerHTML =
      `<span class="dot server"></span> <strong>${REPOS.server}</strong> · develop`;

    renderInsights();
    positionTrunkLabels();
    applyMode(currentMode);
    renderDrift();
    renderHistory();
    renderShared();
    // Center "now" on both scrollable panels on first render
    requestAnimationFrame(() => {
      scrollAllToNow();
      positionNowBadge();
    });
    applyHash();
  }

  window.addEventListener("resize", () => {
    positionTrunkLabels();
    applyMode(currentMode);
    renderHistory();
    positionNowBadge();
  });

  boot();
})();
