import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

export type RoadmapPlan = Record<string, number>;

const LOCAL_FILE = path.join(process.cwd(), ".roadmap-state.json");
const KV_KEY = "flash-roadmap-v1";

function hasKv() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvCommand<T = unknown>(...args: (string | number)[]): Promise<T | null> {
  const res = await fetch(process.env.KV_REST_API_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`KV ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { result: T | null };
  return data.result;
}

async function readLocal(): Promise<RoadmapPlan> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as RoadmapPlan) : {};
  } catch {
    return {};
  }
}
async function writeLocal(plan: RoadmapPlan): Promise<void> {
  await fs.writeFile(LOCAL_FILE, JSON.stringify(plan, null, 2), "utf8");
}

export async function readPlan(): Promise<RoadmapPlan> {
  if (hasKv()) {
    try {
      const raw = await kvCommand<string>("GET", KV_KEY);
      if (!raw) return {};
      return typeof raw === "string" ? (JSON.parse(raw) as RoadmapPlan) : (raw as RoadmapPlan);
    } catch (e) {
      console.warn("[roadmap] KV read failed; returning empty plan:", e);
      return {};
    }
  }
  return readLocal();
}

export async function setDay(id: string, day: number | null): Promise<RoadmapPlan> {
  const plan = await readPlan();
  if (day === null || day === undefined) delete plan[id];
  else plan[id] = Math.max(-180, Math.min(180, Math.round(day)));
  await writePlan(plan);
  return plan;
}

export async function writePlan(plan: RoadmapPlan): Promise<void> {
  if (hasKv()) {
    await kvCommand("SET", KV_KEY, JSON.stringify(plan));
    return;
  }
  await writeLocal(plan);
}

export async function clearPlan(): Promise<void> {
  if (hasKv()) {
    try {
      await kvCommand("DEL", KV_KEY);
    } catch (e) {
      console.warn("[roadmap] KV delete failed:", e);
    }
    return;
  }
  try {
    await fs.unlink(LOCAL_FILE);
  } catch {
    // already absent
  }
}

export function backendLabel(): "vercel-kv" | "local-file" {
  return hasKv() ? "vercel-kv" : "local-file";
}
