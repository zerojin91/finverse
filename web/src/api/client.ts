/** fetch 래퍼 — 에러 정규화. 에러 본문은 FastAPI 기본 {"detail": "..."}. */

const DEFAULT_BASE = "http://127.0.0.1:8030";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? DEFAULT_BASE;

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(status > 0 ? `[${status}] ${detail}` : detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, params?: QueryParams): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
  }
  const query = qs.toString();
  return `${API_BASE}${path}${query ? `?${query}` : ""}`;
}

async function normalizeError(res: Response): Promise<ApiError> {
  let detail = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") detail = body.detail;
    else if (body.detail !== undefined) detail = JSON.stringify(body.detail);
  } catch {
    /* JSON 아님 — statusText 유지 */
  }
  return new ApiError(res.status, detail);
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, params));
  } catch {
    throw new ApiError(
      0,
      "API 서버에 연결할 수 없습니다. scripts/dev_ui.sh 로 API와 DB 터널이 떠 있는지 확인하세요.",
    );
  }
  if (!res.ok) throw await normalizeError(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "응답 본문(JSON) 파싱에 실패했습니다.");
  }
}
