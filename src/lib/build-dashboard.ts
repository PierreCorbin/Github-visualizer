import "server-only";
import {
  compareBranches,
  getCheckRuns,
  getCombinedStatus,
  getRepoMeta,
  listBranches,
  listCommits,
  listIssues,
  listPulls,
  listRecentMainCommits,
  listRecentReleases,
  type GhCheck,
  type GhCombinedStatus,
  type GhCommit,
  type GhIssue,
  type GhPull,
} from "./github";
import { readPlan, backendLabel, type RoadmapPlan } from "./roadmap-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = () => Date.now();

export type CiState = "success" | "pending" | "failure" | "none";
export type TestVerdict = "has-tests" | "tests-unchanged" | "no-src-changes";
export type ReadinessVerdict = "ready" | "ship-able" | "failing" | "pending" | "unknown";

export type BranchNode = {
  id: string;
  side: "web" | "server";
  feature: string | null;
  name: string;
  stage: "active" | "stale" | "abandoned";
  synth: string;
  ahead: number;
  behind: number;
  last: string;
  lastDays: number;
  files: number;
  filesStart: number;
  author: string;
  authors: string[];
  commits14: number[];
  pr: { n: number; state: string; reviews: number; required: number; url: string } | null;
  issue: { sys: string; id: string; title: string; status: string } | null;
  topFiles: string[];
  url: string;
  // Rollout readiness
  ci: { state: CiState; total: number; failing: string[]; passing: string[]; url: string | null };
  testSignal: { verdict: TestVerdict; src: number; tests: number };
  readiness: { verdict: ReadinessVerdict; label: string };
  // Cross-link to issues
  linkedIssues: number[];
};

export type IssueNode = {
  number: number;
  side: "web" | "server";
  title: string;
  url: string;
  state: "open" | "closed";
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar: string | null }[];
  author: { login: string; avatar: string | null };
  daysOld: number;
  daysSinceUpdate: number;
  body: string;
  // Branches that reference this issue (via PR body or branch name)
  linkedBranches: { id: string; side: "web" | "server"; name: string; stage: string }[];
  // Convenience: linked open PR number if any
  linkedPRs: number[];
};

export type HistoryNode = {
  name: string;
  synth: string;
  start: number;
  end: number;
  pr: string;
  prUrl: string;
  author: string;
};

export type DriftChange = {
  kind: "endpoint" | "dto" | "schema";
  path: string;
  state: "consumed" | "unconsumed" | "drift";
  days: number;
};

export type DriftCard = {
  feature: string;
  severity: "ok" | "warn" | "risk";
  verdict: string;
  changes: DriftChange[];
};

export type DashboardPayload = {
  repos: { web: string; server: string; webUrl: string; serverUrl: string };
  generatedAt: string;
  data: { web: BranchNode[]; server: BranchNode[] };
  history: { web: HistoryNode[]; server: HistoryNode[] };
  contractDrift: DriftCard[];
  deploys: { web: number[]; server: number[] };
  issues: {
    web: IssueNode[];
    server: IssueNode[];
    topLabels: string[];
    available: boolean; // false when the token lacks issues:read on either repo
  };
  plan: RoadmapPlan;
  planBackend: "vercel-kv" | "local-file";
  isProd: boolean;
};

function stripFeaturePrefix(name: string): string {
  return name.replace(/^(feature|feat)[\/_-]/i, "");
}

function humanFromBranch(name: string): string {
  return stripFeaturePrefix(name).replace(/[-_/]+/g, " ").trim();
}

function initialsOf(fullName: string, login?: string | null): string {
  const src = (fullName || login || "").trim();
  if (!src) return "??";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // Fall back to login, or first 2 chars
  const s = (login || src).replace(/[^a-zA-Z0-9]/g, "");
  return (s.slice(0, 2) || "??").toUpperCase();
}

function subjectOf(msg: string): string {
  return (msg || "").split("\n")[0]?.trim() ?? "";
}

function synthesize(branchName: string, commits: GhCommit[]): string {
  const topic = humanFromBranch(branchName);
  const meaningful = commits.find((c) => {
    const s = subjectOf(c.message).toLowerCase();
    return (
      s.length > 4 &&
      !/^(merge|wip|bump|chore: bump|pull from|bump|^v\d)/i.test(s) &&
      !s.startsWith("merge ")
    );
  });
  if (meaningful) {
    const s = subjectOf(meaningful.message);
    if (s.length < 120) {
      return capitalize(topic) + " — " + s;
    }
  }
  return capitalize(topic);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function categorize(name: string) {
  const n = name.toLowerCase();
  if (n.startsWith("feature/") || n.startsWith("feat/")) return "feature";
  if (n.startsWith("fix/")) return "fix";
  if (n.startsWith("refactor/")) return "refactor";
  if (n.startsWith("dependabot/")) return "dependabot";
  return "other";
}

function featureKey(name: string): string | null {
  const cat = categorize(name);
  if (cat !== "feature") return null;
  // Normalize: feature/foo-bar and feat/foo_bar both → foo-bar
  return stripFeaturePrefix(name).replace(/_/g, "-").toLowerCase();
}

function stageFromAge(days: number, ahead: number, behind: number): "active" | "stale" | "abandoned" {
  if (days > 90) return "abandoned";
  if (days > 14 || (behind > 0 && ahead === 0)) return "stale";
  return "active";
}

/* ════════════ Flexible test-file detection ════════════ */
// Any of these signals classifies a file as a test. Designed to work across
// JS, TS, Go, Python, Ruby, Rust, Vue, Svelte etc. without configuration.
const TEST_PATH_RE = /(^|\/)(__tests__|tests?|specs?|cypress|playwright|e2e)\//i;
const TEST_FILENAME_RE = /\.(test|spec)\.[a-z0-9]+$|_test\.go$|_spec\.rb$/i;
const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rb|rs|java|kt|vue|svelte|cs|php|ex|exs|sql|graphql|html?|hbs|ejs|liquid|css|scss|less)$/i;
const IGNORED_EXT_RE = /\.(md|markdown|txt|json|ya?ml|lock|toml|env|gitignore|editorconfig|csv|pdf|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$|(^|\/)\.[^/]+$|Dockerfile|Makefile/i;

function isTestFile(path: string): boolean {
  return TEST_PATH_RE.test(path) || TEST_FILENAME_RE.test(path);
}
function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false;
  if (IGNORED_EXT_RE.test(path)) return false;
  return SOURCE_EXT_RE.test(path);
}
function computeTestSignal(files: { filename: string }[]): BranchNode["testSignal"] {
  let src = 0;
  let tests = 0;
  for (const f of files) {
    if (isTestFile(f.filename)) tests++;
    else if (isSourceFile(f.filename)) src++;
  }
  if (src === 0 && tests === 0) return { verdict: "no-src-changes", src: 0, tests: 0 };
  if (src === 0) return { verdict: "no-src-changes", src: 0, tests };
  if (tests === 0) return { verdict: "tests-unchanged", src, tests: 0 };
  return { verdict: "has-tests", src, tests };
}

/* ════════════ CI status merge (check-runs + legacy combined status) ════════════ */
function mergeCiSignal(
  combined: GhCombinedStatus | null,
  checks: GhCheck[],
  repoUrl: string,
  sha: string,
): BranchNode["ci"] {
  const failing: string[] = [];
  const passing: string[] = [];
  let hasPending = false;
  let hasFailure = false;
  let hasSuccess = false;

  // Modern check-runs
  for (const c of checks) {
    if (c.status !== "completed") {
      hasPending = true;
      continue;
    }
    const conc = c.conclusion ?? "";
    if (conc === "failure" || conc === "timed_out" || conc === "action_required") {
      hasFailure = true;
      failing.push(c.name);
    } else if (conc === "success") {
      hasSuccess = true;
      passing.push(c.name);
    } else if (conc === "cancelled") {
      // Neither pass nor fail — flag as failure-ish since it didn't complete
      hasFailure = true;
      failing.push(c.name + " (cancelled)");
    }
    // neutral/skipped are treated as non-blocking
  }

  // Legacy commit status
  if (combined && combined.total_count > 0) {
    for (const s of combined.statuses) {
      if (s.state === "pending") hasPending = true;
      else if (s.state === "failure" || s.state === "error") {
        hasFailure = true;
        if (!failing.includes(s.context)) failing.push(s.context);
      } else if (s.state === "success") {
        hasSuccess = true;
        if (!passing.includes(s.context)) passing.push(s.context);
      }
    }
  }

  const total = checks.length + (combined?.total_count ?? 0);
  const url = `${repoUrl}/commit/${sha}/checks`;
  let state: CiState;
  if (total === 0) state = "none";
  else if (hasFailure) state = "failure";
  else if (hasPending) state = "pending";
  else if (hasSuccess) state = "success";
  else state = "none";

  return { state, total, failing, passing, url: total > 0 ? url : null };
}

function readinessFrom(ci: BranchNode["ci"], ts: BranchNode["testSignal"]): BranchNode["readiness"] {
  if (ci.state === "failure") {
    const failingCount = ci.failing.length;
    return { verdict: "failing", label: failingCount > 0 ? `CI red · ${failingCount} failing` : "CI red" };
  }
  if (ci.state === "pending") return { verdict: "pending", label: "CI running" };
  if (ci.state === "none") {
    if (ts.verdict === "has-tests") return { verdict: "ship-able", label: "No CI · tests present" };
    if (ts.verdict === "no-src-changes") return { verdict: "unknown", label: "No code changes" };
    return { verdict: "unknown", label: "No CI · no new tests" };
  }
  // CI success
  if (ts.verdict === "has-tests") return { verdict: "ready", label: "Ready · green + tests" };
  if (ts.verdict === "no-src-changes") return { verdict: "ship-able", label: "Green · no code changes" };
  return { verdict: "ship-able", label: "Green · no new tests" };
}

/* ════════════ Issue ↔ branch linking ════════════ */
const CLOSING_KEYWORD_RE =
  /\b(close[sd]?|fix(es|ed)?|resolve[sd]?)\b[: ]*#(\d+)/gi;
function extractLinkedIssueNumbers(prBody: string, branchName: string): Set<number> {
  const out = new Set<number>();
  if (prBody) {
    for (const m of prBody.matchAll(CLOSING_KEYWORD_RE)) out.add(Number(m[3]));
  }
  // Also pick up #123 in branch names (rare but sometimes used)
  for (const m of branchName.matchAll(/#(\d+)/g)) out.add(Number(m[1]));
  return out;
}

function buildCommits14(commits: GhCommit[]): number[] {
  const buckets = Array(14).fill(0);
  const cutoff = NOW() - 14 * DAY_MS;
  for (const c of commits) {
    const t = new Date(c.author.date).getTime();
    if (t < cutoff) continue;
    const idx = Math.min(13, Math.floor((t - cutoff) / DAY_MS));
    buckets[idx]++;
  }
  return buckets;
}

function humanAgo(iso: string | null | undefined): { days: number; label: string } {
  if (!iso) return { days: 9999, label: "—" };
  const d = Math.max(0, (NOW() - new Date(iso).getTime()) / DAY_MS);
  if (d < 1 / 12) return { days: d, label: "minutes ago" };
  if (d < 1) return { days: d, label: `${Math.round(d * 24)}h ago` };
  if (d < 30) return { days: d, label: `${Math.round(d)}d ago` };
  if (d < 365) return { days: d, label: `${Math.round(d / 30)}mo ago` };
  return { days: d, label: `${(d / 365).toFixed(1)}y ago` };
}

function prStateFromGh(pr: GhPull): string {
  if (pr.merged_at) return "merged";
  if (pr.draft) return "draft";
  // stale = open > 14 days without update
  if (pr.state === "open") {
    const days = (NOW() - new Date(pr.updated_at).getTime()) / DAY_MS;
    if (days > 14) return "stale";
    return "open";
  }
  return pr.state;
}

function pickTopBranches(
  branches: { name: string; protected: boolean }[],
  featureBranches: Map<string, any>,
): string[] {
  // Keep feature branches (for cross-repo matching) + non-dependabot branches.
  // Cap to ~10 per side to keep fetch volume sane.
  const keep = branches
    .filter((b) => !b.name.startsWith("dependabot/"))
    .filter((b) => b.name !== "main" && b.name !== "master" && b.name !== "develop");
  return keep.map((b) => b.name).slice(0, 12);
}

/** Heuristic — contract drift from file overlap between server + web feature branches. */
function inferContractDrift(
  features: string[],
  webBySlug: Map<string, BranchNode>,
  serverBySlug: Map<string, BranchNode>,
): DriftCard[] {
  const SERVER_CONTRACT_RE = /(routes?|controllers?|handlers?|api|dto|schema|models?)\/|\.(sql|graphql|proto)$/i;
  const WEB_ADOPT_RE = /(api|services?|hooks?|clients?|queries|mutations?)\//i;

  const cards: DriftCard[] = [];
  for (const f of features) {
    const web = webBySlug.get(f);
    const server = serverBySlug.get(f);
    if (!server) continue;
    // Pull "contract-like" file paths from server
    const contractFiles = server.topFiles.filter((p) => SERVER_CONTRACT_RE.test(p));
    if (contractFiles.length === 0 && server.topFiles.length > 0) {
      contractFiles.push(...server.topFiles.slice(0, 3));
    }
    const changes: DriftChange[] = contractFiles.slice(0, 5).map((p) => {
      const isEndpointy = /routes?|controllers?|handlers?|api/i.test(p);
      const isSchema = /\.(sql|graphql|proto)$|schema|migrations?/i.test(p);
      const kind: DriftChange["kind"] = isSchema ? "schema" : isEndpointy ? "endpoint" : "dto";

      // State: if web exists and has touched a matching-named file, consumed.
      // If web is behind & hasn't touched, drift. Else unconsumed.
      let state: DriftChange["state"] = "unconsumed";
      if (web) {
        const base = p.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
        const webTouched = base
          ? web.topFiles.some((wp) => wp.toLowerCase().includes(base.toLowerCase()))
          : false;
        if (webTouched) state = "consumed";
        else if (web.behind > 5) state = "drift";
      }
      const days = Math.max(1, Math.round(server.lastDays));
      return { kind, path: p, state, days };
    });

    const unconsumed = changes.filter((c) => c.state === "unconsumed").length;
    const drift = changes.filter((c) => c.state === "drift").length;
    let severity: DriftCard["severity"] = "ok";
    if (drift > 0) severity = "risk";
    else if (unconsumed > 0) severity = "warn";

    let verdict = `Web and server are in sync on ${f}.`;
    if (severity === "risk") {
      verdict = `Server changed existing shapes the web branch still calls the old way. Rebase web and adopt the new DTOs before merging ${f}.`;
    } else if (severity === "warn") {
      verdict = `Server shipped ${unconsumed} new contract${unconsumed === 1 ? "" : "s"} web hasn't adopted yet. Coordinate merge order.`;
    }

    cards.push({ feature: f, severity, verdict, changes });
  }
  return cards;
}

async function buildForRepo(repo: string, side: "web" | "server"): Promise<{
  meta: any;
  branches: BranchNode[];
  history: HistoryNode[];
  deploys: number[];
  issuesRaw: GhIssue[];
  issuesAvailable: boolean;
  pullsAll: GhPull[];
}> {
  const [meta, branchesRaw, pullsAll, issuesMaybe] = await Promise.all([
    getRepoMeta(repo),
    listBranches(repo),
    listPulls(repo),
    listIssues(repo, "open"),
  ]);
  const issuesAvailable = issuesMaybe !== null;
  const issuesRaw = issuesMaybe ?? [];
  const defaultBranch = "develop"; // Flash convention; falls back to compare errors if missing
  const hasDevelop = branchesRaw.some((b) => b.name === defaultBranch);
  const base = hasDevelop ? defaultBranch : (meta.default_branch as string);

  const pickNames = pickTopBranches(branchesRaw, new Map());
  // Always include any branch that looks like a feature branch (for cross-repo matching)
  const featureNames = branchesRaw
    .map((b) => b.name)
    .filter((n) => categorize(n) === "feature");
  const namesToFetch = Array.from(new Set([...pickNames, ...featureNames])).slice(0, 14);
  const shaByName = new Map(branchesRaw.map((b) => [b.name, b.sha]));

  // Parallelize compare + CI fetch per branch
  const perBranch = await Promise.all(
    namesToFetch.map(async (name) => {
      const sha = shaByName.get(name);
      const [cmpRes, combined, checks] = await Promise.all([
        compareBranches(repo, base, name).catch(() => null),
        sha ? getCombinedStatus(repo, sha) : Promise.resolve(null),
        sha ? getCheckRuns(repo, sha) : Promise.resolve([] as GhCheck[]),
      ]);
      return { name, sha, cmp: cmpRes, combined, checks };
    }),
  );

  const nodes: BranchNode[] = perBranch.map(({ name, sha, cmp, combined, checks }, idx) => {
    const commits = cmp?.commits ?? [];
    const lastCommit = commits[commits.length - 1] ?? null;
    const ago = humanAgo(lastCommit?.author.date);
    const authorsInit = Array.from(
      new Set(
        commits
          .slice(-10)
          .map((c) => initialsOf(c.author.name, c.author.login))
          .filter(Boolean),
      ),
    ).slice(0, 3);
    const files = cmp?.files ?? [];
    const topFiles = files
      .slice()
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, 8)
      .map((f) => f.filename);

    const pr = pullsAll.find((p) => p.head === name && p.base === base) ?? null;
    const reviewTarget = 2;
    const prObj = pr
      ? {
          n: pr.number,
          state: prStateFromGh(pr),
          reviews: 0,
          required: reviewTarget,
          url: pr.url,
        }
      : null;

    const stage = stageFromAge(ago.days, cmp?.ahead_by ?? 0, cmp?.behind_by ?? 0);

    // CI + tests + readiness
    const ci = sha
      ? mergeCiSignal(combined, checks, meta.html_url, sha)
      : { state: "none" as CiState, total: 0, failing: [], passing: [], url: null };
    const testSignal = computeTestSignal(files);
    const readiness = readinessFrom(ci, testSignal);

    // Linked issues — from PR body + branch name. Filtered later against the
    // actual open-issue list in the dashboard assembler.
    const linkedIssues = Array.from(
      extractLinkedIssueNumbers(pr?.body ?? "", name),
    );

    return {
      id: `${side[0]}-${idx}-${name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
      side,
      feature: featureKey(name),
      name,
      stage,
      synth: synthesize(name, commits),
      ahead: cmp?.ahead_by ?? 0,
      behind: cmp?.behind_by ?? 0,
      last: ago.label,
      lastDays: Math.round(ago.days * 10) / 10,
      files: files.length,
      filesStart: files.length,
      author: lastCommit ? initialsOf(lastCommit.author.name, lastCommit.author.login) : "??",
      authors: authorsInit,
      commits14: buildCommits14(commits),
      pr: prObj,
      issue: null,
      topFiles,
      url: `${meta.html_url}/tree/${encodeURIComponent(name)}`,
      ci,
      testSignal,
      readiness,
      linkedIssues,
    };
  });

  // History — merged PRs in last 90 days
  const cutoff = NOW() - 90 * DAY_MS;
  const merged = pullsAll
    .filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= cutoff)
    .filter((p) => p.base === base)
    .slice(0, 40);

  // For synth of merged, fetch first commit subject of PR head (cheap: use PR title)
  const history: HistoryNode[] = merged.map((p) => {
    const endDays = Math.max(
      0,
      Math.round((NOW() - new Date(p.merged_at!).getTime()) / DAY_MS),
    );
    // start: when branch created — approximate via PR created time
    const prCreatedIso = (p as any).created_at ?? p.updated_at;
    const startDays = Math.max(
      endDays + 1,
      Math.round((NOW() - new Date(prCreatedIso).getTime()) / DAY_MS),
    );
    return {
      name: p.head,
      synth: p.title,
      start: Math.min(startDays, 90),
      end: endDays,
      pr: `#${p.number}`,
      prUrl: p.url,
      author: initialsOf(p.user.login, p.user.login),
    };
  });

  // Deploys — recent merges on default branch (last 30 days) OR releases
  const releases = await listRecentReleases(repo);
  const sinceDate = new Date(NOW() - 30 * DAY_MS);
  let deployDates: string[] = [];
  if (releases.length >= 2) {
    deployDates = releases
      .filter((r) => new Date(r.published_at).getTime() >= sinceDate.getTime())
      .map((r) => r.published_at);
  }
  if (deployDates.length < 2) {
    const mainCommits = await listRecentMainCommits(repo, sinceDate, 40);
    // Treat each non-merge commit on main as a deploy event
    deployDates = mainCommits.map((c) => c.author.date);
  }
  const deploys = deployDates
    .map((iso) => Math.max(0, Math.round(((NOW() - new Date(iso).getTime()) / DAY_MS) * 10) / 10))
    .filter((d) => d >= 0 && d <= 30)
    .slice(0, 10);

  return { meta, branches: nodes, history, deploys, issuesRaw, issuesAvailable, pullsAll };
}

/* ════════════ Build rich issue nodes with cross-links ════════════ */
function buildIssueNodes(
  issuesRaw: GhIssue[],
  side: "web" | "server",
  pullsAll: GhPull[],
  branchesBothSides: BranchNode[],
): IssueNode[] {
  // Pre-index: which branch IDs reference which issue numbers?
  const issueToBranches = new Map<number, BranchNode[]>();
  for (const b of branchesBothSides) {
    for (const n of b.linkedIssues || []) {
      if (!issueToBranches.has(n)) issueToBranches.set(n, []);
      issueToBranches.get(n)!.push(b);
    }
  }
  // Pre-index: which issue numbers are referenced by which PR?
  const issueToPRs = new Map<number, number[]>();
  for (const p of pullsAll) {
    const nums = extractLinkedIssueNumbers(p.body ?? "", p.head ?? "");
    for (const n of nums) {
      if (!issueToPRs.has(n)) issueToPRs.set(n, []);
      issueToPRs.get(n)!.push(p.number);
    }
  }

  return issuesRaw.map((i) => {
    const created = new Date(i.createdAt).getTime();
    const updated = new Date(i.updatedAt).getTime();
    const linkedBranches = (issueToBranches.get(i.number) ?? []).map((b) => ({
      id: b.id,
      side: b.side,
      name: b.name,
      stage: b.stage,
    }));
    const linkedPRs = issueToPRs.get(i.number) ?? [];
    return {
      number: i.number,
      side,
      title: i.title,
      url: i.url,
      state: i.state,
      labels: i.labels,
      assignees: i.assignees,
      author: i.user,
      daysOld: Math.round((NOW() - created) / DAY_MS),
      daysSinceUpdate: Math.round((NOW() - updated) / DAY_MS),
      body: (i.body ?? "").slice(0, 600),
      linkedBranches,
      linkedPRs,
    };
  });
}

function topLabelsFromIssues(issues: IssueNode[], maxLabels = 8): string[] {
  const count = new Map<string, number>();
  for (const i of issues) {
    for (const l of i.labels) count.set(l.name, (count.get(l.name) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, maxLabels);
}

export async function buildFullDashboard(): Promise<DashboardPayload> {
  const repos = (process.env.GITHUB_REPOS ?? "pay-with-flash-web,pay-with-flash-server")
    .split(",")
    .map((s) => s.trim());
  const [webRepo, serverRepo] = repos;

  const [webSide, serverSide, plan] = await Promise.all([
    buildForRepo(webRepo, "web"),
    buildForRepo(serverRepo, "server"),
    readPlan(),
  ]);

  // Cross-repo feature matching
  const webBySlug = new Map<string, BranchNode>();
  const serverBySlug = new Map<string, BranchNode>();
  for (const b of webSide.branches) if (b.feature) webBySlug.set(b.feature, b);
  for (const b of serverSide.branches) if (b.feature) serverBySlug.set(b.feature, b);
  const sharedFeatures = [...serverBySlug.keys()].filter((f) => webBySlug.has(f));

  const contractDrift = inferContractDrift(sharedFeatures, webBySlug, serverBySlug);

  // Cap branches to top 6 per side for the timeline (most-active + feature matches first)
  const rank = (b: BranchNode) => {
    const stageScore = b.stage === "active" ? 0 : b.stage === "stale" ? 1 : 2;
    return stageScore * 1000 + b.lastDays;
  };
  const featureFirst = (arr: BranchNode[]) => {
    const features = arr.filter((b) => b.feature).sort((a, b) => rank(a) - rank(b));
    const nonFeatures = arr.filter((b) => !b.feature).sort((a, b) => rank(a) - rank(b));
    return [...features, ...nonFeatures].slice(0, 6);
  };
  const webBranches = featureFirst(webSide.branches);
  const serverBranches = featureFirst(serverSide.branches);

  // Issue nodes — pass ALL branches both sides so we link issues correctly.
  const allBranches = [...webSide.branches, ...serverSide.branches];
  const webIssues = buildIssueNodes(webSide.issuesRaw, "web", webSide.pullsAll, allBranches);
  const serverIssues = buildIssueNodes(
    serverSide.issuesRaw,
    "server",
    serverSide.pullsAll,
    allBranches,
  );
  const topLabels = topLabelsFromIssues([...webIssues, ...serverIssues], 10);

  return {
    repos: {
      web: webRepo,
      server: serverRepo,
      webUrl: webSide.meta.html_url,
      serverUrl: serverSide.meta.html_url,
    },
    generatedAt: new Date().toISOString(),
    data: {
      web: webBranches,
      server: serverBranches,
    },
    history: {
      web: webSide.history,
      server: serverSide.history,
    },
    contractDrift,
    deploys: {
      web: webSide.deploys,
      server: serverSide.deploys,
    },
    issues: {
      web: webIssues,
      server: serverIssues,
      topLabels,
      available: webSide.issuesAvailable && serverSide.issuesAvailable,
    },
    plan,
    planBackend: backendLabel(),
    isProd: process.env.NODE_ENV === "production",
  };
}
