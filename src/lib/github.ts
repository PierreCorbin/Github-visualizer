// Server-only GitHub API client. Token never leaves this process.
import "server-only";

const GITHUB_API = "https://api.github.com";

export type GhCommit = {
  sha: string;
  message: string;
  author: { name: string; login: string | null; avatar: string | null; date: string };
  url: string;
};

export type GhBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

export type GhCompare = {
  ahead_by: number;
  behind_by: number;
  status: "ahead" | "behind" | "identical" | "diverged";
  total_commits: number;
  files: { filename: string; additions: number; deletions: number; status: string }[];
  commits: GhCommit[];
};

export type GhPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  url: string;
  head: string;
  base: string;
  user: { login: string; avatar: string };
  updated_at: string;
  body: string;
};

export type GhIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  body: string;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar: string | null }[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  user: { login: string; avatar: string | null };
};

export type GhCheck = {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | skipped | timed_out | action_required
  url: string;
};

export type GhCombinedStatus = {
  state: "success" | "pending" | "failure" | "error";
  total_count: number;
  statuses: { context: string; state: string; target_url?: string }[];
};

const token = () => {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN missing in env");
  return t;
};

async function gh<T>(
  path: string,
  opts: { revalidate?: number; noCache?: boolean } = {},
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    ...(opts.noCache
      ? { cache: "no-store" as const }
      : { next: { revalidate: opts.revalidate ?? 300 } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const owner = () => process.env.GITHUB_ORG || "Flash-Lighting-Solutions";

function normalizeCommit(c: any): GhCommit {
  return {
    sha: c.sha,
    message: c.commit?.message ?? "",
    author: {
      name: c.commit?.author?.name ?? "unknown",
      login: c.author?.login ?? null,
      avatar: c.author?.avatar_url ?? null,
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? new Date(0).toISOString(),
    },
    url: c.html_url,
  };
}

export async function listBranches(repo: string): Promise<GhBranch[]> {
  const data = await gh<any[]>(`/repos/${owner()}/${repo}/branches?per_page=100`);
  return data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: !!b.protected }));
}

export async function listCommits(
  repo: string,
  branch: string,
  per_page = 20,
): Promise<GhCommit[]> {
  const data = await gh<any[]>(
    `/repos/${owner()}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${per_page}`,
  );
  return data.map(normalizeCommit);
}

export async function compareBranches(
  repo: string,
  base: string,
  head: string,
): Promise<GhCompare> {
  const data = await gh<any>(
    `/repos/${owner()}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );
  return {
    ahead_by: data.ahead_by,
    behind_by: data.behind_by,
    status: data.status,
    total_commits: data.total_commits,
    files: (data.files ?? []).map((f: any) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
    })),
    commits: (data.commits ?? []).map(normalizeCommit),
  };
}

export async function listPulls(repo: string): Promise<GhPull[]> {
  // PR list responses can exceed Next's 2MB fetch-cache cap on busy repos,
  // so opt out of the data cache for this one and trust upstream caching.
  const data = await gh<any[]>(
    `/repos/${owner()}/${repo}/pulls?state=all&per_page=50&sort=updated&direction=desc`,
    { noCache: true },
  );
  return data.map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    draft: !!p.draft,
    merged_at: p.merged_at,
    url: p.html_url,
    head: p.head?.ref,
    base: p.base?.ref,
    user: { login: p.user?.login, avatar: p.user?.avatar_url },
    updated_at: p.updated_at,
    body: p.body ?? "",
  }));
}

/** Open GitHub issues for a repo. Excludes PRs (GitHub's /issues endpoint returns both).
 * Returns null when the token lacks issue-read permission so the caller can degrade gracefully. */
export async function listIssues(
  repo: string,
  state: "open" | "closed" | "all" = "open",
): Promise<GhIssue[] | null> {
  let data: any[];
  try {
    data = await gh<any[]>(
      `/repos/${owner()}/${repo}/issues?state=${state}&per_page=100&sort=updated&direction=desc`,
      { noCache: true },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // 403 "Resource not accessible by personal access token" → token lacks issues:read
    if (/\b403\b/.test(msg) || /not accessible/i.test(msg)) return null;
    throw e;
  }
  return data
    .filter((i) => !i.pull_request) // issues endpoint returns PRs too; skip them
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      url: i.html_url,
      body: i.body ?? "",
      labels: (i.labels ?? []).map((l: any) =>
        typeof l === "string"
          ? { name: l, color: "7d7d8f" }
          : { name: l.name, color: l.color ?? "7d7d8f" },
      ),
      assignees: (i.assignees ?? []).map((a: any) => ({
        login: a.login,
        avatar: a.avatar_url ?? null,
      })),
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      closedAt: i.closed_at ?? null,
      user: { login: i.user?.login ?? "unknown", avatar: i.user?.avatar_url ?? null },
    }));
}

/** Combined status (legacy) for a commit SHA. */
export async function getCombinedStatus(repo: string, sha: string): Promise<GhCombinedStatus | null> {
  try {
    const data = await gh<any>(`/repos/${owner()}/${repo}/commits/${sha}/status`);
    return {
      state: data.state,
      total_count: data.total_count ?? 0,
      statuses: (data.statuses ?? []).map((s: any) => ({
        context: s.context,
        state: s.state,
        target_url: s.target_url,
      })),
    };
  } catch {
    return null;
  }
}

/** Check runs (modern GitHub Actions / third-party checks) for a SHA. */
export async function getCheckRuns(repo: string, sha: string): Promise<GhCheck[]> {
  try {
    const data = await gh<any>(
      `/repos/${owner()}/${repo}/commits/${sha}/check-runs?per_page=50`,
    );
    return (data.check_runs ?? []).map((c: any) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      url: c.html_url,
    }));
  } catch {
    return [];
  }
}

export async function getRepoMeta(repo: string) {
  return gh<any>(`/repos/${owner()}/${repo}`);
}

/** Commits on main branch within last N days — used as a deploy proxy. */
export async function listRecentMainCommits(
  repo: string,
  since: Date,
  limit = 30,
): Promise<GhCommit[]> {
  const meta = await getRepoMeta(repo);
  const branch = meta.default_branch as string;
  const data = await gh<any[]>(
    `/repos/${owner()}/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${since.toISOString()}&per_page=${limit}`,
  );
  return data.map(normalizeCommit);
}

export async function listRecentReleases(repo: string): Promise<{ published_at: string; name: string; tag: string; url: string }[]> {
  try {
    const data = await gh<any[]>(`/repos/${owner()}/${repo}/releases?per_page=20`, {
      noCache: true,
    });
    return data
      .filter((r) => r.published_at)
      .map((r) => ({
        published_at: r.published_at,
        name: r.name ?? r.tag_name,
        tag: r.tag_name,
        url: r.html_url,
      }));
  } catch {
    return [];
  }
}
