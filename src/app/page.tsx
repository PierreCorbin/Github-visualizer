import Script from "next/script";
import { buildFullDashboard } from "@/lib/build-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const APP_HTML = `
<div class="app">

  <!-- ───────── Header ───────── -->
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/>
          <path d="M6 9v3a3 3 0 0 0 3 3h6"/>
        </svg>
      </div>
      <div>
        <h1>Flash Repo Visualizer</h1>
        <p>Cross-repo branch alignment · web ↔ server</p>
      </div>
    </div>
    <div class="header-right">
      <div class="legend-pills">
        <span class="pill"><span class="dot web"></span> pay-with-flash-web</span>
        <span class="pill"><span class="dot server"></span> pay-with-flash-server</span>
      </div>
      <button class="btn" id="btn-share" title="Copy link to this view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        Share view
      </button>
      <button class="btn primary" id="btn-digest" title="Generate weekly digest">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Weekly digest
      </button>
    </div>
  </header>

  <!-- ───────── Insight strip ───────── -->
  <section class="insights" id="insights"></section>

  <!-- ───────── Main visualization ───────── -->
  <section class="viz">
    <div class="viz-head">
      <div>
        <h2>Roadmap &middot; branch timeline &amp; feature alignment</h2>
        <p>Each card sits on its last-activity date. <strong>Drag a card</strong> left or right to schedule it earlier or later &mdash; your plan is saved in this browser. The vertical purple line is today. The dotted purple connectors link matched features across web &amp; server.</p>
      </div>
      <div class="viz-controls">
        <button class="viz-btn primary" id="scroll-to-now" title="Scroll both panels to today">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Today
        </button>
        <div class="zoom-control" title="Zoom the roadmap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          <input type="range" id="zoom-slider" min="16" max="64" step="1" value="40"/>
        </div>
        <button class="viz-btn" id="reset-roadmap" title="Clear your scheduled positions">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          Reset plan
        </button>
      </div>
    </div>

    <div class="timeline-frame" id="timeline-frame">
      <div class="hint"><kbd>drag</kbd> to reschedule &middot; <kbd>scroll</kbd> to pan &middot; <kbd>click</kbd> a feature tag to drill in</div>
      <div class="trunk-label" id="trunk-label-web"><span class="dot web"></span> <strong>pay-with-flash-web</strong> &middot; develop</div>
      <div class="trunk-label" id="trunk-label-server"><span class="dot server"></span> <strong>pay-with-flash-server</strong> &middot; develop</div>
      <div class="now-badge" id="now-badge">today</div>
      <div class="timeline" id="timeline">
        <svg class="paths" id="paths" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    </div>
  </section>

  <!-- ───────── Contract drift ───────── -->
  <section class="drift">
    <h2>Contract drift · server → web</h2>
    <p class="sub">Server-side API, DTO, and schema changes. <span style="color:var(--active)">Consumed</span> = web branch already uses the new shape. <span style="color:var(--stale)">Unconsumed</span> = server shipped it, web hasn't adopted yet. <span style="color:var(--rose)">Drift</span> = server changed an existing shape the web branch still calls the old way.</p>
    <div class="drift-grid" id="drift-grid"></div>
  </section>

  <!-- ───────── Merged history ───────── -->
  <section class="history">
    <div class="history-head">
      <div>
        <h2>Merged history · what shipped in the last 90 days</h2>
        <p class="sub">Each arc is a branch that sprouted from <code>develop</code>, lived for a while, and merged back. Hover for synthesized purpose, PR details, and lifespan.</p>
      </div>
      <div class="history-controls-wrap">
        <div class="history-controls" id="history-controls">
          <button class="active" data-filter="all">Both repos</button>
          <button data-filter="web">Web only</button>
          <button data-filter="server">Server only</button>
        </div>
        <div class="zoom-control" title="Zoom the merged history">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          <input type="range" id="history-zoom-slider" min="16" max="64" step="1" value="40"/>
        </div>
      </div>
    </div>

    <div class="history-stats">
      <div class="stat"><span class="label">Merged branches</span><span class="val" id="h-count">—</span></div>
      <div class="stat"><span class="label">Median lifespan</span><span class="val" id="h-median">—</span></div>
      <div class="stat"><span class="label">Longest-lived</span><span class="val" id="h-longest">—</span></div>
      <div class="stat"><span class="label">Last merge</span><span class="val" id="h-last">—</span></div>
    </div>

    <div class="history-wrap" id="history-wrap">
      <svg id="history-svg" class="history-svg" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    <div id="history-tip" class="history-tip"></div>
  </section>

  <!-- ───────── Shared features panel ───────── -->
  <section class="alignment">
    <h2>Shared features · cross-repo health</h2>
    <p class="sub">Features in flight on web <em>and</em> server. Click any card to drill in. Scores are based on ahead/behind and drift.</p>
    <div class="shared-features" id="shared-features"></div>
  </section>

  <footer class="legend">
    <div class="tips">
      <span><span class="dot active"></span> Active</span>
      <span><span class="dot stale"></span> Stale</span>
      <span><span class="dot abandoned"></span> Abandoned</span>
      <span style="display:inline-flex;align-items:center;gap:6px"><svg width="10" height="12" viewBox="0 0 10 12"><path class="deploy-flag" d="M0 0 L10 4 L0 8 Z"/></svg> prod deploy</span>
    </div>
    <div id="footer-generated"></div>
  </footer>
</div>

<!-- ───────── Modals ───────── -->
<div class="modal-backdrop" id="feature-modal">
  <div class="modal">
    <div class="modal-head">
      <h3 id="feature-modal-title">Feature</h3>
      <button class="close" data-close="feature-modal" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" id="feature-modal-body"></div>
  </div>
</div>

<div class="modal-backdrop" id="digest-modal">
  <div class="modal">
    <div class="modal-head">
      <h3>Weekly digest</h3>
      <button class="close" data-close="digest-modal" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body digest-body">
      <div class="digest-content" id="digest-content"></div>
      <div class="digest-actions">
        <button class="btn" id="digest-regen">Refresh</button>
        <button class="btn primary" id="digest-copy">Copy as markdown</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast">Copied</div>
`;

export default async function Page() {
  let payload: any;
  let error: string | null = null;
  try {
    payload = await buildFullDashboard();
  } catch (e: any) {
    error = e?.message ?? "Unknown error";
  }

  if (error) {
    return (
      <div className="app">
        <div className="loading-state">
          <h2 style={{ color: "#f87171", fontWeight: 600, marginBottom: 8 }}>
            Couldn&apos;t load dashboard
          </h2>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#7d7d8f" }}>
            {error}
          </div>
          <div style={{ marginTop: 20, fontSize: 12 }}>
            Check <code>.env.local</code> — the <code>GITHUB_TOKEN</code> needs access to the
            configured repos.
          </div>
        </div>
      </div>
    );
  }

  const generatedAt = new Date(payload.generatedAt).toLocaleString();
  const dataScript = `window.__REPO_DATA__ = ${JSON.stringify(payload).replace(/</g, "\\u003c")};`;
  const backendLabel = payload.planBackend === "vercel-kv" ? "Vercel KV" : "local file";
  const missingKvOnProd = payload.isProd && payload.planBackend !== "vercel-kv";
  const footerLine = `storage: ${backendLabel} · generated ${generatedAt}`;
  const footerScript = `
    (function () {
      var el = document.getElementById("footer-generated");
      if (el) {
        el.textContent = ${JSON.stringify(footerLine)};
        el.className = ${JSON.stringify(missingKvOnProd ? "storage-bad" : "storage-ok")};
      }
      ${
        missingKvOnProd
          ? `
        var warn = document.createElement("div");
        warn.className = "storage-warning";
        warn.innerHTML = '⚠ Roadmap drags are <strong>not being saved</strong> on this deployment. Your team won\\'t see each other\\'s changes. ' +
          '<a href="https://vercel.com/docs/storage/vercel-kv/quickstart" target="_blank" rel="noreferrer">Provision Vercel KV</a> and redeploy.' +
          '<button class="close-warning" title="Dismiss">✕</button>';
        document.body.insertBefore(warn, document.body.firstChild);
        warn.querySelector(".close-warning").addEventListener("click", function () { warn.remove(); });
      `
          : ""
      }
    })();
  `;

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: APP_HTML }} />
      {/* Inline data — runs at parse time, guaranteed before dashboard.js */}
      <script dangerouslySetInnerHTML={{ __html: dataScript }} />
      <Script src="/dashboard.js" strategy="afterInteractive" />
      <script dangerouslySetInnerHTML={{ __html: footerScript }} />
    </>
  );
}
