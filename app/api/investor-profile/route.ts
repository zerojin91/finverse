import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProfileKey = "anchor" | "adapter" | "defender" | "chaser";

type InvestorProfilePayload = {
  judgmentVariability?: unknown;
  actionControl?: unknown;
  profile?: unknown;
  answers?: unknown;
};

const validProfiles = new Set<ProfileKey>(["anchor", "adapter", "defender", "chaser"]);
const isCoordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= -5 && value <= 5 && Number.isInteger(value * 2);
const isAnswerList = (value: unknown) => Array.isArray(value) && value.length === 10 && value.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 3);
const moves = [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]] as const;

export async function POST(request: Request) {
  try {
    const payload = await request.json() as InvestorProfilePayload;
    if (!isCoordinate(payload.judgmentVariability) || !isCoordinate(payload.actionControl) || !validProfiles.has(payload.profile as ProfileKey) || !isAnswerList(payload.answers)) {
      return Response.json({ error: "투자 성향 결과 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const answers = payload.answers as number[];
    const expected = answers.reduce((sum, answer) => ({ x: sum.x + moves[answer][0], y: sum.y + moves[answer][1] }), { x: 0, y: 0 });
    if (expected.x !== payload.judgmentVariability || expected.y !== payload.actionControl) {
      return Response.json({ error: "응답과 좌표값이 일치하지 않습니다." }, { status: 400 });
    }
    const expectedProfile: ProfileKey = expected.x < 0 ? (expected.y >= 0 ? "anchor" : "defender") : (expected.y >= 0 ? "adapter" : "chaser");
    if (payload.profile !== expectedProfile) return Response.json({ error: "응답과 성향 유형이 일치하지 않습니다." }, { status: 400 });

    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const record = {
      id,
      createdAt,
      assessment: "initial-investor-profile",
      judgmentVariability: payload.judgmentVariability,
      actionControl: payload.actionControl,
      profile: payload.profile,
      answers,
    };
    const resultDirectory = path.join(process.cwd(), "data", "investor-profile-results");
    await mkdir(resultDirectory, { recursive: true });
    const filename = `${createdAt.replace(/[:.]/g, "-")}-${id}.json`;
    await writeFile(path.join(resultDirectory, filename), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    return Response.json({ saved: true, id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Investor profile temporary save failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "투자 성향 결과를 임시 저장하지 못했습니다." }, { status: 500 });
  }
}
