"""Collect economic time series from the Bank of Korea ECOS API.

This collector intentionally stops before PostgreSQL. It writes a stable,
append-only JSONL output so the four domain collectors can be compared before
the shared database schema is finalized.

Examples:
    export ECOS_API_KEY="your-key"

    # Inspect available ECOS tables before choosing a series.
    python collectors/economic_ingest.py discover --keyword 기준금리

    # Inspect item codes for one selected table.
    python collectors/economic_ingest.py items --stat-code 722Y001

    # Fetch up to 20 years of a configured series.
    python collectors/economic_ingest.py backfill \
        --series 722Y001:D:0101000:한국은행 기준금리

    # Re-fetch the recent revision window every day.
    python collectors/economic_ingest.py update \
        --series 722Y001:D:0101000:한국은행 기준금리

    # Fetch the built-in KOSIS selections.
    python collectors/economic_ingest.py backfill \
        --source kosis --series cpi --series employment_rate
    python collectors/economic_ingest.py update \
        --source kosis --series cpi --series employment_rate

The series argument is:
    STAT_CODE:CYCLE:ITEM_CODE1[:ITEM_CODE2[:ITEM_CODE3[:ITEM_CODE4]]]:NAME

The data directory is ignored by this repository's .gitignore:
    data/economic/raw/
    data/economic/observations.jsonl
    data/economic/latest.jsonl
    data/economic/changes.jsonl
    data/economic/runs.jsonl
    data/economic/state.json
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "data" / "economic"
RAW_ROOT = OUTPUT_ROOT / "raw"
ECOS_API_ROOT = "https://ecos.bok.or.kr/api"
KOSIS_API_ROOT = "https://kosis.kr/openapi"
KOSIS_PARAMETER_API_ROOT = "https://kosis.kr/openapi/Param"
UTC = timezone.utc


@dataclass(frozen=True)
class SeriesSpec:
    stat_code: str
    cycle: str
    item_codes: tuple[str, ...]
    name: str

    @property
    def key(self) -> str:
        return "|".join((self.stat_code, self.cycle, *self.item_codes))


@dataclass(frozen=True)
class KosisSeriesSpec:
    key: str
    org_id: str
    tbl_id: str
    obj_codes: tuple[str, ...]
    item_id: str
    cycle: str
    name: str

    @property
    def external_id(self) -> str:
        return "|".join(
            (
                "KOSIS",
                self.org_id,
                self.tbl_id,
                *self.obj_codes,
                self.item_id,
                self.cycle,
            )
        )


# ECOS selections checked against the live table/item metadata.
ECOS_SERIES: dict[str, SeriesSpec] = {
    "base_rate": SeriesSpec(
        stat_code="722Y001",
        cycle="D",
        item_codes=("0101000",),
        name="한국은행 기준금리",
    ),
    "usd_krw": SeriesSpec(
        stat_code="731Y001",
        cycle="D",
        item_codes=("0000001",),
        name="원달러환율",
    ),
    "gov_bond_3y": SeriesSpec(
        stat_code="817Y002",
        cycle="D",
        item_codes=("010200000",),
        name="국고채3년",
    ),
    "gov_bond_10y": SeriesSpec(
        stat_code="817Y002",
        cycle="D",
        item_codes=("010210000",),
        name="국고채10년",
    ),
    "cpi": SeriesSpec(
        stat_code="901Y009",
        cycle="M",
        item_codes=("0",),
        name="소비자물가지수",
    ),
    "employment_rate": SeriesSpec(
        stat_code="901Y027",
        cycle="M",
        item_codes=("I61E",),
        name="고용률",
    ),
    "unemployment_rate": SeriesSpec(
        stat_code="901Y027",
        cycle="M",
        item_codes=("I61BC",),
        name="실업률",
    ),
    "industrial_production": SeriesSpec(
        stat_code="901Y033",
        cycle="M",
        item_codes=("A00", "2"),
        name="전산업생산지수계절조정",
    ),
    "real_gdp": SeriesSpec(
        stat_code="200Y104",
        cycle="Q",
        item_codes=("1400",),
        name="실질GDP",
    ),
}


# These selections were checked against KOSIS metadata and live data responses.
KOSIS_SERIES: dict[str, KosisSeriesSpec] = {
    "cpi": KosisSeriesSpec(
        key="cpi",
        org_id="101",
        tbl_id="DT_1J22003",
        obj_codes=("T10",),
        item_id="T",
        cycle="M",
        name="소비자물가지수(총지수)",
    ),
    "employment_rate": KosisSeriesSpec(
        key="employment_rate",
        org_id="101",
        tbl_id="DT_1DA7001S",
        obj_codes=("0",),
        item_id="T90",
        cycle="M",
        name="고용률",
    ),
    "unemployment_rate": KosisSeriesSpec(
        key="unemployment_rate",
        org_id="101",
        tbl_id="DT_1DA7001S",
        obj_codes=("0",),
        item_id="T80",
        cycle="M",
        name="실업률",
    ),
    "industrial_production": KosisSeriesSpec(
        key="industrial_production",
        org_id="101",
        tbl_id="DT_1JH20202",
        obj_codes=("1",),
        item_id="T1",
        cycle="M",
        name="전산업생산지수(계절조정)",
    ),
}


def parse_series(value: str) -> SeriesSpec:
    parts = value.split(":")
    if len(parts) < 4:
        raise argparse.ArgumentTypeError(
            "series는 STAT_CODE:CYCLE:ITEM_CODE1:NAME 형식이어야 합니다."
        )

    stat_code, cycle = parts[0].strip(), parts[1].strip().upper()
    if cycle not in {"A", "Q", "M", "D", "H"}:
        raise argparse.ArgumentTypeError("cycle은 A, Q, M, D, H 중 하나여야 합니다.")

    name = parts[-1].strip()
    item_codes = tuple(part.strip() for part in parts[2:-1] if part.strip())
    if not stat_code or not item_codes or not name:
        raise argparse.ArgumentTypeError(
            "STAT_CODE, ITEM_CODE1, NAME을 모두 입력해야 합니다."
        )
    return SeriesSpec(stat_code, cycle, item_codes, name)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def load_local_env() -> None:
    """Load simple KEY=VALUE pairs from the repository-local .env file."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def ensure_output_dirs() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    RAW_ROOT.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON 파일을 읽을 수 없습니다: {path}: {exc}") from exc


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def append_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def request_payload(url: str, retries: int = 3) -> Any:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "FINVERSE-economic-collector/0.1",
        },
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
            return json.loads(body)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(2**attempt)
    raise RuntimeError(f"API 요청 실패: {last_error}") from last_error


def request_json(url: str, retries: int = 3) -> dict[str, Any]:
    payload = request_payload(url, retries)
    if not isinstance(payload, dict):
        raise ValueError("ECOS API 응답이 JSON 객체가 아닙니다.")
    return payload


def kosis_url(
    api_key: str,
    method: str,
    **params: str,
) -> str:
    query = {
        "method": method,
        "apiKey": api_key,
        "format": "json",
        # The guide's Python example uses this flag for a JSON array response.
        "jsonVD": "Y",
        **params,
    }
    return f"{KOSIS_PARAMETER_API_ROOT}/statisticsParameterData.do?{urlencode(query)}"


def kosis_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        error_code = payload.get("err") or payload.get("ERR") or payload.get("error")
        if error_code:
            message = payload.get("errMsg") or payload.get("ERR_MSG") or payload.get("message")
            raise RuntimeError(f"KOSIS API 오류 {error_code}: {message}")
        rows = payload.get("data") or payload.get("DATA")
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    raise RuntimeError(f"KOSIS 응답 형식이 올바르지 않습니다: {payload}")


def redact_url(url: str) -> str:
    parts = urlsplit(url)
    path = re.sub(r"(/api/[^/]+)/[^/]+(/json/)", r"\1/<redacted>\2", parts.path)
    query = urlencode(
        [
            (key, "<redacted>" if key.lower() == "apikey" else value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
        ]
    )
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def response_rows(payload: dict[str, Any], response_name: str) -> list[dict[str, Any]]:
    top_level_error = payload.get("RESULT")
    if isinstance(top_level_error, dict):
        code = top_level_error.get("CODE")
        if code == "INFO-200":
            return []
        if code not in {None, "INFO-000"}:
            raise RuntimeError(
                f"ECOS API 오류 {code}: {top_level_error.get('MESSAGE')}"
            )

    result = payload.get(response_name)
    if not isinstance(result, dict):
        raise RuntimeError(f"ECOS 응답에 {response_name}가 없습니다: {payload}")

    error = result.get("RESULT")
    if isinstance(error, dict) and error.get("CODE") not in {None, "INFO-000"}:
        raise RuntimeError(f"ECOS API 오류 {error.get('CODE')}: {error.get('MESSAGE')}")

    rows = result.get("row", [])
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise RuntimeError(f"ECOS 응답 row 형식이 올바르지 않습니다: {rows}")
    return [row for row in rows if isinstance(row, dict)]


def ecos_url(
    api_key: str,
    resource: str,
    start: int,
    end: int,
    *segments: str,
) -> str:
    encoded = [quote(str(segment), safe="") for segment in segments]
    return "/".join(
        [
            ECOS_API_ROOT,
            resource,
            quote(api_key, safe=""),
            "json",
            "kr",
            str(start),
            str(end),
            *encoded,
        ]
    )


def fetch_statistic_search(
    api_key: str,
    spec: SeriesSpec,
    start_period: str,
    end_period: str,
    page_size: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    raw_urls: list[str] = []
    page_start = 1

    while True:
        url = ecos_url(
            api_key,
            "StatisticSearch",
            page_start,
            page_start + page_size - 1,
            spec.stat_code,
            spec.cycle,
            start_period,
            end_period,
            *spec.item_codes,
        )
        raw_urls.append(url)
        page = response_rows(request_json(url), "StatisticSearch")
        rows.extend(page)
        if len(page) < page_size:
            break
        page_start += page_size

    return rows, raw_urls


def fetch_kosis_data(
    api_key: str,
    spec: KosisSeriesSpec,
    start_period: str,
    end_period: str,
) -> tuple[list[dict[str, Any]], str]:
    params: dict[str, str] = {
        "orgId": spec.org_id,
        "tblId": spec.tbl_id,
        "itmId": spec.item_id,
        "prdSe": spec.cycle,
        "startPrdDe": start_period,
        "endPrdDe": end_period,
    }
    for index, obj_code in enumerate(spec.obj_codes, start=1):
        params[f"objL{index}"] = obj_code
    url = kosis_url(api_key, "getList", **params)
    return kosis_rows(request_payload(url)), url


def fetch_table_list(api_key: str, page_size: int = 1000) -> list[dict[str, Any]]:
    return fetch_paged_resource(
        api_key,
        "StatisticTableList",
        "StatisticTableList",
        (),
        page_size,
    )


def fetch_item_list(
    api_key: str,
    stat_code: str,
    page_size: int = 1000,
) -> list[dict[str, Any]]:
    return fetch_paged_resource(
        api_key,
        "StatisticItemList",
        "StatisticItemList",
        (stat_code,),
        page_size,
    )


def fetch_paged_resource(
    api_key: str,
    resource: str,
    response_name: str,
    segments: tuple[str, ...],
    page_size: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_start = 1

    while True:
        url = ecos_url(
            api_key,
            resource,
            page_start,
            page_start + page_size - 1,
            *segments,
        )
        payload = request_json(url)
        page = response_rows(payload, response_name)
        rows.extend(page)
        block = payload.get(response_name, {})
        total = block.get("list_total_count") if isinstance(block, dict) else None
        if total is not None and len(rows) >= int(total):
            break
        if len(page) < page_size:
            break
        page_start += page_size

    return rows


def format_period(day: date, cycle: str) -> str:
    if cycle == "A":
        return day.strftime("%Y")
    if cycle == "Q":
        quarter = (day.month - 1) // 3 + 1
        return f"{day.year}Q{quarter}"
    if cycle == "M":
        return day.strftime("%Y%m")
    if cycle == "H":
        half = 1 if day.month <= 6 else 2
        return f"{day.year}H{half}"
    return day.strftime("%Y%m%d")


def parse_period(value: str) -> date:
    normalized = value.strip()
    if re.fullmatch(r"\d{4}", normalized):
        return date(int(normalized), 1, 1)
    if re.fullmatch(r"\d{4}(Q|H)\d", normalized):
        year = int(normalized[:4])
        part = int(normalized[-1])
        if normalized[4] == "Q":
            month = (part - 1) * 3 + 1
        else:
            month = 1 if part == 1 else 7
        return date(year, month, 1)
    for pattern in ("%Y%m%d", "%Y%m"):
        try:
            return datetime.strptime(normalized, pattern).date()
        except ValueError:
            continue
    for pattern in ("%Y.%m", "%Y.%m.%d"):
        try:
            return datetime.strptime(normalized, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"지원하지 않는 기간 형식입니다: {value}")


def parse_value(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "..", "NA", "N/A"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def normalize_row(
    spec: SeriesSpec,
    row: dict[str, Any],
    collected_at: str,
    raw_fetch_path: str,
) -> dict[str, Any]:
    period = str(row.get("TIME", "")).strip()
    value_text = str(row.get("DATA_VALUE", "")).strip()
    normalized = {
        "source": "ECOS",
        "external_series_id": spec.key,
        "series_name": spec.name,
        "stat_code": spec.stat_code,
        "cycle": spec.cycle,
        "item_codes": list(spec.item_codes),
        "period": period,
        "period_start": parse_period(period).isoformat(),
        "value": parse_value(value_text),
        "value_text": value_text,
        "unit": row.get("UNIT_NAME"),
        "source_row": row,
        "collected_at": collected_at,
        "raw_fetch_path": raw_fetch_path,
    }
    fingerprint_payload = {
        key: normalized[key]
        for key in (
            "source",
            "external_series_id",
            "period",
            "value",
            "value_text",
            "unit",
            "source_row",
        )
    }
    normalized["record_hash"] = hashlib.sha256(
        json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return normalized


def normalize_kosis_row(
    spec: KosisSeriesSpec,
    row: dict[str, Any],
    collected_at: str,
    raw_fetch_path: str,
) -> dict[str, Any]:
    period = str(row.get("PRD_DE", "")).strip()
    value_text = str(row.get("DT", "")).strip()
    normalized = {
        "source": "KOSIS",
        "external_series_id": spec.external_id,
        "series_name": spec.name,
        "kosis_series_key": spec.key,
        "org_id": spec.org_id,
        "tbl_id": spec.tbl_id,
        "obj_codes": list(spec.obj_codes),
        "item_id": spec.item_id,
        "cycle": spec.cycle,
        "period": period,
        "period_start": parse_period(period).isoformat(),
        "value": parse_value(value_text),
        "value_text": value_text,
        "unit": row.get("UNIT_NM"),
        "source_row": row,
        "collected_at": collected_at,
        "raw_fetch_path": raw_fetch_path,
    }
    fingerprint_payload = {
        key: normalized[key]
        for key in (
            "source",
            "external_series_id",
            "period",
            "value",
            "value_text",
            "unit",
            "source_row",
        )
    }
    normalized["record_hash"] = hashlib.sha256(
        json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return normalized


def existing_hashes() -> set[str]:
    return {
        row["record_hash"]
        for row in read_jsonl(OUTPUT_ROOT / "observations.jsonl")
        if row.get("record_hash")
    }


def validate_range(cycle: str, start: date, end: date) -> tuple[str, str]:
    return format_period(start, cycle), format_period(end, cycle)


def years_before(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:
        return day.replace(year=day.year - years, day=28)


def resolve_kosis_series(value: str) -> KosisSeriesSpec:
    key = value.strip()
    try:
        return KOSIS_SERIES[key]
    except KeyError as exc:
        available = ", ".join(sorted(KOSIS_SERIES))
        raise SystemExit(
            f"알 수 없는 KOSIS series입니다: {value}. 사용 가능: {available}"
        ) from exc


def resolve_ecos_series(value: str) -> SeriesSpec:
    key = value.strip()
    if key in ECOS_SERIES:
        return ECOS_SERIES[key]
    try:
        return parse_series(key)
    except argparse.ArgumentTypeError as exc:
        available = ", ".join(sorted(ECOS_SERIES))
        raise SystemExit(
            f"알 수 없는 ECOS series입니다: {value}. 별칭: {available}"
        ) from exc


def resolve_series_values(source: str, values: list[str]) -> list[Any]:
    if values == ["all"]:
        catalog = KOSIS_SERIES if source == "kosis" else ECOS_SERIES
        return list(catalog.values())
    if "all" in values:
        raise SystemExit("series=all은 다른 series와 함께 사용할 수 없습니다.")
    resolver = resolve_kosis_series if source == "kosis" else resolve_ecos_series
    return [resolver(value) for value in values]


def collect_kosis(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.getenv("KOSIS_API_KEY")
    if not api_key:
        raise SystemExit("KOSIS_API_KEY 환경변수를 설정하거나 --api-key를 지정해 주세요.")
    specs = resolve_series_values("kosis", args.series)

    ensure_output_dirs()
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    collected_at = now_iso()
    today = date.today()
    mode = args.command
    existing = existing_hashes()
    latest = {
        (row.get("external_series_id"), row.get("period")): row
        for row in read_jsonl(OUTPUT_ROOT / "latest.jsonl")
    }
    state = read_json(OUTPUT_ROOT / "state.json", {})
    run = {
        "run_id": run_id,
        "mode": mode,
        "started_at": collected_at,
        "status": "running",
        "source": "KOSIS",
        "series": [spec.external_id for spec in specs],
    }
    append_jsonl(OUTPUT_ROOT / "runs.jsonl", [run])

    total_fetched = 0
    inserted = 0
    changed = 0
    unchanged = 0
    errors: list[str] = []

    for spec in specs:
        try:
            start = (
                years_before(today, args.years)
                if mode == "backfill"
                else today - timedelta(days=args.revision_lookback_days)
            )
            start_period, end_period = validate_range(spec.cycle, start, today)
            rows, url = fetch_kosis_data(api_key, spec, start_period, end_period)
            total_fetched += len(rows)

            raw_path = RAW_ROOT / f"{run_id}_KOSIS_{safe_filename(spec.key)}.json"
            write_json(
                raw_path,
                {
                    "source": "KOSIS",
                    "run_id": run_id,
                    "series": spec.external_id,
                    "series_key": spec.key,
                    "requested_at": collected_at,
                    "start_period": start_period,
                    "end_period": end_period,
                    "url": redact_url(url),
                    "rows": rows,
                },
            )
            relative_raw_path = str(raw_path.relative_to(ROOT))
            normalized = [
                normalize_kosis_row(spec, row, collected_at, relative_raw_path)
                for row in rows
                if str(row.get("PRD_DE", "")).strip()
            ]
            new_rows = [row for row in normalized if row["record_hash"] not in existing]
            previous_by_key = {
                (row.get("external_series_id"), row.get("period")): row
                for row in normalized
                if (row.get("external_series_id"), row.get("period")) in latest
            }
            append_jsonl(OUTPUT_ROOT / "observations.jsonl", new_rows)
            existing.update(row["record_hash"] for row in new_rows)
            for row in new_rows:
                latest[(row["external_series_id"], row["period"])] = row
            inserted += len(new_rows) if mode == "backfill" else 0
            changed += len(new_rows) if mode == "update" else 0
            unchanged += len(normalized) - len(new_rows)
            state[spec.external_id] = {
                "last_success_at": collected_at,
                "last_mode": mode,
                "last_start_period": start_period,
                "last_end_period": end_period,
                "last_row_count": len(rows),
            }
            if mode == "update" and new_rows:
                append_jsonl(
                    OUTPUT_ROOT / "changes.jsonl",
                    [
                        {
                            "run_id": run_id,
                            "change_type": (
                                "changed_observation"
                                if (row["external_series_id"], row["period"]) in previous_by_key
                                else "new_observation"
                            ),
                            "series": spec.external_id,
                            "period": row["period"],
                            "record_hash": row["record_hash"],
                            "collected_at": collected_at,
                        }
                        for row in new_rows
                    ],
                )
            print(f"{spec.name}: fetched={len(rows)} new_or_changed={len(new_rows)}")
        except Exception as exc:  # Keep other series running and report all failures.
            message = f"{spec.name} ({spec.key}): {exc}"
            errors.append(message)
            print(f"ERROR: {message}", file=sys.stderr)

    write_jsonl(
        OUTPUT_ROOT / "latest.jsonl",
        sorted(
            latest.values(),
            key=lambda row: (row.get("external_series_id", ""), row.get("period", "")),
        ),
    )
    write_json(OUTPUT_ROOT / "state.json", state)
    finished_at = now_iso()
    append_jsonl(
        OUTPUT_ROOT / "runs.jsonl",
        [
            {
                "run_id": run_id,
                "mode": mode,
                "finished_at": finished_at,
                "status": "failed" if errors else "success",
                "source": "KOSIS",
                "fetched": total_fetched,
                "inserted": inserted,
                "changed": changed,
                "unchanged": unchanged,
                "errors": errors,
            }
        ],
    )
    if errors:
        raise SystemExit(1)


def collect(args: argparse.Namespace) -> None:
    if args.source == "kosis":
        collect_kosis(args)
        return

    api_key = args.api_key or os.getenv("ECOS_API_KEY")
    if not api_key:
        raise SystemExit("ECOS_API_KEY 환경변수를 설정하거나 --api-key를 지정해 주세요.")
    args.series = resolve_series_values("ecos", args.series)
    if not args.series:
        raise SystemExit("--series를 하나 이상 지정해 주세요. discover로 ECOS 지표를 먼저 확인할 수 있습니다.")

    ensure_output_dirs()
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    collected_at = now_iso()
    today = date.today()
    mode = args.command
    existing = existing_hashes()
    latest = {
        (row.get("external_series_id"), row.get("period")): row
        for row in read_jsonl(OUTPUT_ROOT / "latest.jsonl")
    }
    state = read_json(OUTPUT_ROOT / "state.json", {})
    run = {
        "run_id": run_id,
        "mode": mode,
        "started_at": collected_at,
        "status": "running",
        "source": "ECOS",
        "series": [spec.key for spec in args.series],
    }
    append_jsonl(OUTPUT_ROOT / "runs.jsonl", [run])

    total_fetched = 0
    inserted = 0
    changed = 0
    unchanged = 0
    errors: list[str] = []

    for spec in args.series:
        try:
            if mode == "backfill":
                start = years_before(today, args.years)
            else:
                start = today - timedelta(days=args.revision_lookback_days)
            start_period, end_period = validate_range(spec.cycle, start, today)
            rows, urls = fetch_statistic_search(
                api_key,
                spec,
                start_period,
                end_period,
                args.page_size,
            )
            total_fetched += len(rows)

            raw_path = RAW_ROOT / f"{run_id}_{safe_filename(spec.key)}.json"
            write_json(
                raw_path,
                {
                    "source": "ECOS",
                    "run_id": run_id,
                    "series": spec.key,
                    "requested_at": collected_at,
                    "start_period": start_period,
                    "end_period": end_period,
                    "urls": [redact_url(url) for url in urls],
                    "rows": rows,
                },
            )
            relative_raw_path = str(raw_path.relative_to(ROOT))
            normalized = [
                normalize_row(spec, row, collected_at, relative_raw_path)
                for row in rows
                if str(row.get("TIME", "")).strip()
            ]
            new_rows = [row for row in normalized if row["record_hash"] not in existing]
            append_jsonl(OUTPUT_ROOT / "observations.jsonl", new_rows)
            existing.update(row["record_hash"] for row in new_rows)
            previous_by_key = {
                (row.get("external_series_id"), row.get("period")): row
                for row in normalized
                if (row.get("external_series_id"), row.get("period")) in latest
            }
            for row in new_rows:
                latest[(row["external_series_id"], row["period"])] = row
            inserted += len(new_rows) if mode == "backfill" else 0
            changed += len(new_rows) if mode == "update" else 0
            unchanged += len(normalized) - len(new_rows)
            state[spec.key] = {
                "last_success_at": collected_at,
                "last_mode": mode,
                "last_start_period": start_period,
                "last_end_period": end_period,
                "last_row_count": len(rows),
            }
            if mode == "update" and new_rows:
                append_jsonl(
                    OUTPUT_ROOT / "changes.jsonl",
                    [
                        {
                            "run_id": run_id,
                            "change_type": (
                                "changed_observation"
                                if (row["external_series_id"], row["period"]) in previous_by_key
                                else "new_observation"
                            ),
                            "series": spec.key,
                            "period": row["period"],
                            "record_hash": row["record_hash"],
                            "collected_at": collected_at,
                        }
                        for row in new_rows
                    ],
                )
            print(f"{spec.name}: fetched={len(rows)} new_or_changed={len(new_rows)}")
        except Exception as exc:  # Keep other series running and report all failures.
            message = f"{spec.name} ({spec.key}): {exc}"
            errors.append(message)
            print(f"ERROR: {message}", file=sys.stderr)

    write_jsonl(
        OUTPUT_ROOT / "latest.jsonl",
        sorted(
            latest.values(),
            key=lambda row: (row.get("external_series_id", ""), row.get("period", "")),
        ),
    )
    write_json(OUTPUT_ROOT / "state.json", state)
    finished_at = now_iso()
    append_jsonl(
        OUTPUT_ROOT / "runs.jsonl",
        [
            {
                "run_id": run_id,
                "mode": mode,
                "finished_at": finished_at,
                "status": "failed" if errors else "success",
                "source": "ECOS",
                "fetched": total_fetched,
                "inserted": inserted,
                "changed": changed,
                "unchanged": unchanged,
                "errors": errors,
            }
        ],
    )
    if errors:
        raise SystemExit(1)


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)


def discover(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.getenv("ECOS_API_KEY")
    if not api_key:
        raise SystemExit("ECOS_API_KEY 환경변수를 설정하거나 --api-key를 지정해 주세요.")
    keyword = args.keyword.lower()
    rows = fetch_table_list(api_key, args.page_size)
    matches = [
        row
        for row in rows
        if keyword in str(row.get("STAT_NAME", "")).lower()
    ]
    for row in matches:
        print(
            f"{row.get('STAT_CODE')}\t{row.get('CYCLE') or '-'}\t{row.get('STAT_NAME')}"
        )
    print(f"검색 결과: {len(matches)}개", file=sys.stderr)


def items(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.getenv("ECOS_API_KEY")
    if not api_key:
        raise SystemExit("ECOS_API_KEY 환경변수를 설정하거나 --api-key를 지정해 주세요.")
    rows = fetch_item_list(api_key, args.stat_code, args.page_size)
    for row in rows:
        print(
            "\t".join(
                [
                    str(row.get("ITEM_CODE", "")),
                    str(row.get("ITEM_NAME", "")),
                    str(row.get("CYCLE", "")),
                ]
            )
        )
    print(f"검색 결과: {len(rows)}개", file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FINVERSE 경제 데이터 수집기")
    subparsers = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--api-key", help="출처별 API 키. 기본값: ECOS_API_KEY 또는 KOSIS_API_KEY")
    common.add_argument("--page-size", type=int, default=1000)

    discover_parser = subparsers.add_parser("discover", parents=[common])
    discover_parser.add_argument("--keyword", required=True, help="ECOS 통계표 이름 검색어")
    discover_parser.set_defaults(handler=discover)

    items_parser = subparsers.add_parser("items", parents=[common])
    items_parser.add_argument("--stat-code", required=True, help="ECOS 통계표 코드")
    items_parser.set_defaults(handler=items)

    for command in ("backfill", "update"):
        command_parser = subparsers.add_parser(command, parents=[common])
        command_parser.add_argument(
            "--source",
            choices=("ecos", "kosis"),
            default="ecos",
            help="데이터 출처. 기본값: ecos",
        )
        command_parser.add_argument(
            "--series",
            action="append",
            required=True,
            help=(
                "ECOS 별칭/base_rate 등 또는 STAT_CODE:CYCLE:ITEM_CODE1:NAME 형식, "
                "KOSIS 별칭/cpi 등 사용. all로 출처의 전체 계열 선택 가능"
            ),
        )
        command_parser.add_argument("--years", type=int, default=20)
        command_parser.add_argument(
            "--revision-lookback-days",
            type=int,
            default=730,
            help="update 모드에서 최근 재조회할 기간. 기본값: 730일",
        )
        command_parser.set_defaults(handler=collect)

    return parser


def main() -> None:
    load_local_env()
    args = build_parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
