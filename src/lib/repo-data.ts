import "server-only";
import {
  compareBranches,
  getRepoMeta,
  listBranches,
  listCommits,
  listPulls,
  type GhCommit,
  type GhPull,
} from "./github";

export type BranchStage = "active" | "stale" | "abandoned" | "merged" | "default";

export type BranchSummary = {
  name: string;
  isDefault: boolean;
  protected: boolean;
  lastCommit: GhCommit | null;
  ahead: number;
  behind: number;
  stage: BranchStage;
  category: string; // feature | fix | refactor | dependabot | release | other
  oneLiner: string;
  pr: GhPull | null;
  topFiles: string[];
  fileCount: number;
};

export type RepoDashboard = {
  repo: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  developCommits: GhCommit[];
  developActivityByDay: { date: string; count: number }[];
  branches: BranchSummary[];
  // Cross-branch overlap: filename -> branches touching it
  fileOverlap: { filename: string; branches: string[] }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = () => Date.now();

function categoryOf(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("dependabot/")) return "dependabot";
  if (n.startsWith("feature/") || n.startsWith("feat/")) return "feature";
  if (n.startsWith("fix/")) return "fix";
  if (n.startsWith("refactor/")) return "refactor";
  if (n.startsWith("release/") || n.startsWith("v")) return "release";
  if (n.startsWith("design")) return "design";
  return "other";
}

function makeOneLiner(branchName: string, commits: GhCommit[]): string {
  // Strip prefix, humanize the rest of the branch name as the topic
  const stripped = branchName.replace(
    /^(feature|feat|fix|refactor|release|design|dependabot)[\/_-]/i,
    "",
  );
  const topic = stripped.replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
  // Try to use the most recent commit subject as flavor
  const subject = commits[0]?.message?.split("\n")[0]?.trim() ?? "";
  if (subject && !/^merge|^wip|^bump/i.test(subject) && subject.length < 90) {
    return capitalize(topic) + " — " + subject;
  }
  return capitalize(topic);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stageOf(opts: {
  isDefault: boolean;
  ahead: number;
  behind: number;
  daysSinceCommit: number;
  pr: GhPull | null;
}): BranchStage {
  const { isDefault, ahead, behind, daysSinceCommit, pr } = opts;
  if (isDefault) return "default";
  if (pr?.merged_at) return "merged";
  if (ahead === 0 && behind > 0) return "merged"; // fully integrated
  if (daysSinceCommit > 90) return "abandoned";
  if (daysSinceCommit > 30) return "stale";
  return "active";
}

function buildActivity(commits: GhCommit[]): { date: string; count: number }[] {
  const map = new Map<string, number>();
  const cutoff = NOW() - 30 * DAY_MS;
  for (const c of commits) {
    const t = new Date(c.author.date).getTime();
    if (t < cutoff) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  // Always emit a 30-day window so the heatmap is dense
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(NOW() - i * DAY_MS).toISOString().slice(0, 10);
    days.push({ date: day, count: map.get(day) ?? 0 });
  }
  return days;
}

export async function buildRepoDashboard(repo: string): Promise<RepoDashboard> {
  const [meta, branchesRaw, pullsAll] = await Promise.all([
    getRepoMeta(repo),
    listBranches(repo),
    listPulls(repo),
  ]);

  const defaultBranch = meta.default_branch as string;
  const hasDevelop = branchesRaw.some((b) => b.name === "develop");
  const baseRef = hasDevelop ? "develop" : defaultBranch;

  const developCommits = await listCommits(repo, baseRef, 50);
  const developActivityByDay = buildActivity(developCommits);

  // For every branch, fetch compare(base...branch) + map a PR if one exists
  const compareResults = await Promise.all(
    branchesRaw.map(async (b) => {
      if (b.name === baseRef) {
        return { branch: b, cmp: null as any };
      }
      try {
        const cmp = await compareBranches(repo, baseRef, b.name);
        return { branch: b, cmp };
      } catch {
        return { branch: b, cmp: null };
      }
    }),
  );

  const branches: BranchSummary[] = compareResults.map(({ branch, cmp }) => {
    const isDefault = branch.name === defaultBranch || branch.name === baseRef;
    const lastCommit = cmp?.commits?.[cmp.commits.length - 1] ?? null;
    const lastDate = lastCommit?.author?.date ?? null;
    const daysSinceCommit = lastDate
      ? Math.floor((NOW() - new Date(lastDate).getTime()) / DAY_MS)
      : isDefault
        ? 0
        : 9999;
    const pr =
      pullsAll.find(
        (p) => p.head === branch.name && p.base === baseRef,
      ) ?? null;
    const stage = stageOf({
      isDefault,
      ahead: cmp?.ahead_by ?? 0,
      behind: cmp?.behind_by ?? 0,
      daysSinceCommit,
      pr,
    });
    const files: { filename: string; additions: number; deletions: number; status: string }[] =
      cmp?.files ?? [];
    const topFiles = files
      .slice()
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, 6)
      .map((f) => f.filename);
    return {
      name: branch.name,
      isDefault,
      protected: branch.protected,
      lastCommit,
      ahead: cmp?.ahead_by ?? 0,
      behind: cmp?.behind_by ?? 0,
      stage,
      category: categoryOf(branch.name),
      oneLiner: makeOneLiner(branch.name, cmp?.commits ?? []),
      pr,
      topFiles,
      fileCount: cmp?.files?.length ?? 0,
    };
  });

  // Build file overlap: filenames touched by 2+ non-default, non-dependabot branches
  const overlapMap = new Map<string, Set<string>>();
  for (const b of branches) {
    if (b.isDefault) continue;
    if (b.category === "dependabot") continue;
    for (const f of b.topFiles) {
      if (!overlapMap.has(f)) overlapMap.set(f, new Set());
      overlapMap.get(f)!.add(b.name);
    }
  }
  const fileOverlap = [...overlapMap.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([filename, set]) => ({ filename, branches: [...set].sort() }))
    .sort((a, b) => b.branches.length - a.branches.length)
    .slice(0, 30);

  // Sort branches: default first, then active by recency
  branches.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    const stageRank: Record<BranchStage, number> = {
      default: 0,
      active: 1,
      merged: 2,
      stale: 3,
      abandoned: 4,
    };
    if (stageRank[a.stage] !== stageRank[b.stage]) {
      return stageRank[a.stage] - stageRank[b.stage];
    }
    const ad = a.lastCommit?.author?.date ?? "";
    const bd = b.lastCommit?.author?.date ?? "";
    return bd.localeCompare(ad);
  });

  return {
    repo,
    description: meta.description ?? null,
    htmlUrl: meta.html_url,
    defaultBranch: baseRef,
    developCommits: developCommits.slice(0, 12),
    developActivityByDay,
    branches,
    fileOverlap,
  };
}
