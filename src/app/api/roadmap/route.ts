import { NextResponse } from "next/server";
import { clearPlan, readPlan, setDay, writePlan, backendLabel } from "@/lib/roadmap-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const plan = await readPlan();
  return NextResponse.json({ plan, backend: backendLabel() });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Per-card update: { id, day } where day can be null to remove
  if (body && typeof body === "object" && "id" in body) {
    const { id, day } = body as { id: string; day: number | null };
    if (typeof id !== "string" || (day !== null && typeof day !== "number")) {
      return NextResponse.json({ error: "id must be string, day must be number or null" }, { status: 400 });
    }
    const plan = await setDay(id, day);
    return NextResponse.json({ plan });
  }
  // Whole-plan replace: object map { [id]: day }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const map = body as Record<string, number>;
    for (const [k, v] of Object.entries(map)) {
      if (typeof k !== "string" || typeof v !== "number") {
        return NextResponse.json({ error: "plan values must be numbers" }, { status: 400 });
      }
    }
    await writePlan(map);
    return NextResponse.json({ plan: map });
  }
  return NextResponse.json({ error: "expected { id, day } or { [id]: day }" }, { status: 400 });
}

export async function DELETE() {
  await clearPlan();
  return NextResponse.json({ ok: true });
}
