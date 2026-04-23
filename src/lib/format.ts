import { formatDistanceToNowStrict } from "date-fns";

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

export function shortSha(sha: string | undefined | null): string {
  return (sha ?? "").slice(0, 7);
}

export function commitSubject(message: string): string {
  return (message ?? "").split("\n")[0]?.trim() ?? "";
}
