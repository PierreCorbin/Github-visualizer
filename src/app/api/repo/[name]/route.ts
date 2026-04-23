import { NextResponse } from "next/server";
import { buildRepoDashboard } from "@/lib/repo-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = (process.env.GITHUB_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function GET(
  _req: Request,
  ctx: { params: { name: string } },
) {
  const name = ctx.params.name;
  if (ALLOWED.length && !ALLOWED.includes(name)) {
    return NextResponse.json({ error: "repo not allowlisted" }, { status: 403 });
  }
  try {
    const data = await buildRepoDashboard(name);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
