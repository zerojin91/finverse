#!/usr/bin/env python3
"""Ingest Korean market data (indices, sectors, stocks, investor flows).

Covers the "시장" domain of the FINVERSE ontology: daily OHLCV for indices and
listed stocks, sector indices, and foreign/institutional investor flows.

Two sources are collected side by side because they disagree by design:

    krx_open_api   Official exchange data (primary).  2010-01-04 onwards.
                   UNADJUSTED prices.  Supplies trading value, market cap,
                   listed shares and sector indices.
    naver_finance  Secondary source.  1990 onwards.  ADJUSTED prices.  Supplies
                   investor flows, which the KRX Open API does not offer at all.

Records from both sources are kept -- ``source`` is part of the record identity,
so neither overwrites the other.  See docs/collectors/market_ingest.md for how
to choose between them.
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
import time
from typing import Any, Iterable, Iterator
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from _indexed_jsonl_store import IndexedJsonlStore
from _jsonl_store import load_dotenv, sha256

import os

ROOT = Path(__file__).resolve().parents[1]
STORE = IndexedJsonlStore(ROOT / "data" / "market")

KST = timezone(timedelta(hours=9))

# The KRX Open API gateway.  Note this is NOT the openapi.krx.co.kr portal host;
# calling the portal returns an HTML error page instead of JSON.
KRX_ROOT = "https://data-dbg.krx.co.kr/svc/apis"
NAVER_ROOT = "https://finance.naver.com"
NAVER_API_ROOT = "https://api.finance.naver.com"

# Earliest data each source offers.
KRX_FIRST_DAY = date(2010, 1, 4)
NAVER_FIRST_DAY = date(1990, 1, 1)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Sector indices arrive inside the KOSPI/KOSDAQ index series, not as a separate
# endpoint, so collecting indices also collects sectors.
KRX_INDEX_ENDPOINTS = {
    "kospi_dd_trd": "idx/kospi_dd_trd",
    "kosdaq_dd_trd": "idx/kosdaq_dd_trd",
    "krx_dd_trd": "idx/krx_dd_trd",
}
KRX_STOCK_ENDPOINTS = {
    "stk_bydd_trd": ("sto/stk_bydd_trd", "KOSPI"),
    "ksq_bydd_trd": ("sto/ksq_bydd_trd", "KOSDAQ"),
    "knx_bydd_trd": ("sto/knx_bydd_trd", "KONEX"),
}
KRX_BASE_INFO_ENDPOINTS = {
    "stk_isu_base_info": ("sto/stk_isu_base_info", "KOSPI"),
    "ksq_isu_base_info": ("sto/ksq_isu_base_info", "KOSDAQ"),
    "knx_isu_base_info": ("sto/knx_isu_base_info", "KONEX"),
}

NAVER_INDEX_SYMBOLS = {
    "KOSPI": ("KOSPI", "KOSPI"),
    "KOSDAQ": ("KOSDAQ", "KOSDAQ"),
    "KPI200": ("KOSPI", "KOSPI200"),
}

# Column order of the market-wide investor flow table on Naver.
MARKET_INVESTORS = (
    "개인", "외국인", "기관계", "금융투자", "보험", "투신", "은행",
    "기타금융", "연기금등", "기타법인",
)
EOK = 100_000_000  # the table is denominated in 억원

# Korean equities have a daily price limit, so a larger single-day move is a
# corporate action or a data seam rather than a market move.
PRICE_LIMIT_PCT = 30.0


class AuthError(RuntimeError):
    """Key missing/unapproved, or the per-content "API 이용신청" was not filed."""


# --------------------------------------------------------------------------
# HTTP


def _request(url: str, *, headers: dict[str, str] | None = None,
             encoding: str = "utf-8", retries: int = 4,
             pause: float = 0.4) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        time.sleep(pause)
        request = Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
        try:
            with urlopen(request, timeout=30) as response:
                return response.read().decode(encoding, errors="replace")
        except HTTPError as exc:
            if exc.code in (401, 403):
                raise AuthError(f"{url.split('?')[0]}: HTTP {exc.code}") from exc
            last = exc
        except (URLError, TimeoutError, OSError) as exc:
            last = exc
        time.sleep(2 ** attempt)
    raise RuntimeError(f"request failed after {retries} attempts: {last}")


def krx_fetch(endpoint: str, params: dict[str, Any], auth_key: str) -> list[dict]:
    body = _request(f"{KRX_ROOT}/{endpoint}?{urlencode(params)}",
                    headers={"AUTH_KEY": auth_key, "Accept": "application/json"})
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{endpoint}: non-JSON response {body[:120]!r}") from exc
    code = str(payload.get("respCode", "")).strip()
    if code and code not in ("00", "000", "0"):
        message = payload.get("respMsg", "")
        if code in ("401", "403"):
            raise AuthError(f"{endpoint}: {code} {message}")
        raise RuntimeError(f"{endpoint}: {code} {message}")
    for key in ("OutBlock_1", "outBlock_1", "output", "data"):
        block = payload.get(key)
        if isinstance(block, list):
            return [row for row in block if isinstance(row, dict)]
    return []


# --------------------------------------------------------------------------
# Parsing helpers


def pick(row: dict, *names: str) -> Any:
    lookup = {str(key).strip().upper(): value for key, value in row.items()}
    for name in names:
        value = lookup.get(name.upper())
        if value not in (None, ""):
            return value
    return None


def number(value: Any) -> float | None:
    """KRX sends numbers as comma-separated strings; '-' means missing."""
    if value in (None, "", "-", "N/A"):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).replace(",", "").replace("%", "").strip()
    if cleaned in ("", "-"):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def integer(value: Any) -> int | None:
    parsed = number(value)
    return None if parsed is None else int(parsed)


def text(value: Any) -> str | None:
    return None if value in (None, "") else str(value).strip()


def ymd(day: date) -> str:
    return day.strftime("%Y%m%d")


def today_kst() -> date:
    return datetime.now(KST).date()


def weekdays(start: date, end: date) -> list[date]:
    days, cursor = [], start
    while cursor <= end:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def identity(*parts: Any) -> str:
    return sha256({"k": [str(part) for part in parts]})


# --------------------------------------------------------------------------
# KRX records


def krx_index_records(rows: list[dict], bas_dd: str) -> list[dict]:
    records = []
    for row in rows:
        day = str(pick(row, "BAS_DD") or bas_dd)
        # Querying a market holiday can echo the previous session; drop it so
        # the trading calendar stays clean.
        if day != bas_dd:
            continue
        name = text(pick(row, "IDX_NM", "IDX_IND_NM"))
        if not name:
            continue
        series = str(pick(row, "IDX_CLSS", "IDX_IND_NM_CLSS") or "")
        records.append({
            "record_id": identity("market_index_daily", "krx", day, series, name),
            "record_type": "market_index_daily",
            "source": "krx_open_api",
            "price_basis": "unadjusted",
            "bas_dd": day, "idx_class": series, "idx_name": name,
            "open": number(pick(row, "OPNPRC_IDX")),
            "high": number(pick(row, "HGPRC_IDX")),
            "low": number(pick(row, "LWPRC_IDX")),
            "close": number(pick(row, "CLSPRC_IDX")),
            "prev_diff": number(pick(row, "CMPPREVDD_IDX")),
            "change_pct": number(pick(row, "FLUC_RT")),
            "volume": integer(pick(row, "ACC_TRDVOL")),
            "trading_value": integer(pick(row, "ACC_TRDVAL")),
            "market_cap": integer(pick(row, "MKTCAP")),
        })
    return records


def krx_price_records(rows: list[dict], bas_dd: str, market: str) -> list[dict]:
    records = []
    for row in rows:
        day = str(pick(row, "BAS_DD") or bas_dd)
        if day != bas_dd:
            continue
        # In the daily-trading endpoints ISU_CD carries the SHORT code and there
        # is no separate ISU_SRT_CD, so both fields resolve to the same value.
        # Naver also keys on the short code, which makes the sources joinable.
        code = text(pick(row, "ISU_SRT_CD", "ISU_CD"))
        if not code:
            continue
        records.append({
            "record_id": identity("market_price_daily", "krx", day, code),
            "record_type": "market_price_daily",
            "source": "krx_open_api",
            "price_basis": "unadjusted",
            "bas_dd": day, "ticker": code,
            "name": text(pick(row, "ISU_NM", "ISU_ABBRV")),
            "market": str(pick(row, "MKT_NM") or market),
            "sector_type": text(pick(row, "SECT_TP_NM")),
            "open": number(pick(row, "TDD_OPNPRC")),
            "high": number(pick(row, "TDD_HGPRC")),
            "low": number(pick(row, "TDD_LWPRC")),
            "close": number(pick(row, "TDD_CLSPRC")),
            "prev_diff": number(pick(row, "CMPPREVDD_PRC")),
            "change_pct": number(pick(row, "FLUC_RT")),
            "volume": integer(pick(row, "ACC_TRDVOL")),
            "trading_value": integer(pick(row, "ACC_TRDVAL")),
            "market_cap": integer(pick(row, "MKTCAP")),
            "listed_shares": integer(pick(row, "LIST_SHRS")),
        })
    return records


def krx_security_records(rows: list[dict], market: str) -> list[dict]:
    records = []
    for row in rows:
        isin = text(pick(row, "ISU_CD"))
        code = text(pick(row, "ISU_SRT_CD"))
        if not isin:
            continue
        records.append({
            "record_id": identity("market_security", "krx", isin),
            "record_type": "market_security",
            "source": "krx_open_api",
            "isin": isin, "ticker": code,
            "name": text(pick(row, "ISU_NM")),
            "short_name": text(pick(row, "ISU_ABBRV")),
            "english_name": text(pick(row, "ISU_ENG_NM")),
            "market": str(pick(row, "MKT_TP_NM", "MKT_NM") or market),
            "sector_type": text(pick(row, "SECT_TP_NM")),
            "share_type": text(pick(row, "KIND_STKCERT_TP_NM")),
            "listed_on": text(pick(row, "LIST_DD")),
            "listed_shares": integer(pick(row, "LIST_SHRS")),
            "par_value": text(pick(row, "PARVAL")),
        })
    return records


def krx_stream(start: date, end: date, auth_key: str, state: dict,
               report: dict) -> Iterator[dict]:
    """Yield KRX records.  The API only answers one basDd at a time."""
    if not auth_key:
        raise AuthError("KRX_AUTH_KEY is not set; check .env")

    calendar: set[str] = set(state.get("krx_trading_days", []))
    skipped: list[str] = []
    candidates = [ymd(day) for day in weekdays(start, end)]

    for name, endpoint in KRX_INDEX_ENDPOINTS.items():
        done = set(state.setdefault("krx_done", {}).get(name, []))
        targets = [day for day in candidates if day not in done]
        # Once the calendar is known, holidays can be skipped outright.
        if calendar and name != "kospi_dd_trd":
            targets = [day for day in targets if day in calendar]
        for day in targets:
            try:
                rows = krx_fetch(endpoint, {"basDd": day}, auth_key)
            except AuthError:
                skipped.append(name)
                break
            except RuntimeError as exc:
                report.setdefault("failures", []).append(f"{name} {day}: {exc}")
                continue
            records = krx_index_records(rows, day)
            if records and name == "kospi_dd_trd":
                calendar.add(day)
            done.add(day)
            yield from records
        state["krx_done"][name] = sorted(done)
        if name == "kospi_dd_trd":
            state["krx_trading_days"] = sorted(calendar)

    probe = max(calendar) if calendar else ymd(end)
    for name, (endpoint, market) in KRX_BASE_INFO_ENDPOINTS.items():
        try:
            rows = krx_fetch(endpoint, {"basDd": probe}, auth_key)
        except AuthError:
            skipped.append(name)
            continue
        except RuntimeError as exc:
            report.setdefault("failures", []).append(f"{name}: {exc}")
            continue
        yield from krx_security_records(rows, market)

    for name, (endpoint, market) in KRX_STOCK_ENDPOINTS.items():
        done = set(state.setdefault("krx_done", {}).get(name, []))
        targets = [day for day in candidates if day not in done]
        if calendar:
            targets = [day for day in targets if day in calendar]
        for day in targets:
            try:
                rows = krx_fetch(endpoint, {"basDd": day}, auth_key)
            except AuthError:
                skipped.append(name)
                break
            except RuntimeError as exc:
                report.setdefault("failures", []).append(f"{name} {day}: {exc}")
                continue
            done.add(day)
            yield from krx_price_records(rows, day, market)
        state["krx_done"][name] = sorted(done)

    if skipped:
        unique = sorted(set(skipped))
        report["unapproved_endpoints"] = unique
        # A single unapproved content type must not abort the whole run, but a
        # key that opens nothing is worth failing on.
        if len(unique) >= len(KRX_INDEX_ENDPOINTS) + len(KRX_STOCK_ENDPOINTS):
            raise AuthError(f"no endpoint is approved for this key: {unique}")


# --------------------------------------------------------------------------
# Naver

SISE_ROW = re.compile(
    r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)'
)
LISTING_ROW = re.compile(r'/item/main\.naver\?code=(\d{6})"[^>]*>([^<]+)</a>')
FLOW_ROW = re.compile(r'<tr onMouseOver="mouseOver\(this\).*?</tr>', re.S | re.I)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG = re.compile(r"<[^>]+>")
DATE_CELL = re.compile(r'class="date2">\s*([\d.]+)\s*</td>')
TABLE_ROW = re.compile(r"<tr>(.*?)</tr>", re.S)


def naver_ohlcv(symbol: str, start: date, end: date) -> list[dict]:
    """siseJson returns the full history in one call, so one request per symbol."""
    query = urlencode({"symbol": symbol, "requestType": 1,
                       "startTime": ymd(start), "endTime": ymd(end),
                       "timeframe": "day"})
    body = _request(f"{NAVER_API_ROOT}/siseJson.naver?{query}",
                    headers={"Referer": f"{NAVER_ROOT}/"}, pause=0.3)
    return [{"bas_dd": m.group(1), "open": float(m.group(2)),
             "high": float(m.group(3)), "low": float(m.group(4)),
             "close": float(m.group(5)), "volume": int(m.group(6))}
            for m in SISE_ROW.finditer(body)]


def naver_listed(market: str) -> list[tuple[str, str]]:
    sosok = 0 if market == "KOSPI" else 1
    seen: dict[str, str] = {}
    for page in range(1, 61):
        body = _request(
            f"{NAVER_ROOT}/sise/sise_market_sum.naver?"
            + urlencode({"sosok": sosok, "page": page}),
            headers={"Referer": f"{NAVER_ROOT}/sise/"}, encoding="euc-kr", pause=0.3)
        found = [(code, name.strip()) for code, name in LISTING_ROW.findall(body)]
        fresh = [pair for pair in found if pair[0] not in seen]
        if not fresh:
            break
        seen.update(dict(fresh))
    return sorted(seen.items())


def cells(fragment: str) -> list[str]:
    return [" ".join(TAG.sub(" ", cell).replace("&nbsp;", " ").split())
            for cell in CELL.findall(fragment)]


def to_ymd(value: str) -> str | None:
    value = value.strip()
    if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", value):
        return value.replace(".", "")
    if re.fullmatch(r"\d{2}\.\d{2}\.\d{2}", value):
        year = int(value[:2])
        century = 1900 if year >= 90 else 2000
        return f"{century + year}{value[3:5]}{value[6:8]}"
    return None


def naver_market_flow(market: str, start: date) -> Iterator[dict]:
    """Market-wide flows, denominated in KRW (converted from 억원)."""
    sosok = "01" if market == "KOSPI" else "02"
    cursor, guard = ymd(today_kst()), 0
    floor = ymd(start)
    while cursor >= floor and guard < 3000:
        guard += 1
        body = _request(
            f"{NAVER_ROOT}/sise/investorDealTrendDay.naver?"
            + urlencode({"bizdate": cursor, "sosok": sosok}),
            headers={"Referer": f"{NAVER_ROOT}/sise/"}, encoding="euc-kr", pause=0.3)
        days: list[str] = []
        for block in TABLE_ROW.findall(body):
            match = DATE_CELL.search(block)
            if not match:
                continue
            day = to_ymd(match.group(1))
            if not day or day < floor:
                continue
            days.append(day)
            for investor, raw in zip(MARKET_INVESTORS, cells(block)[1:]):
                net = integer(raw)
                if net is None:
                    continue
                yield {
                    "record_id": identity("market_investor_flow_daily", "naver",
                                          day, "MARKET", market, investor),
                    "record_type": "market_investor_flow_daily",
                    "source": "naver_finance",
                    "bas_dd": day, "target_type": "MARKET", "target": market,
                    "investor": investor,
                    "net_value_krw": net * EOK, "net_volume": None,
                }
        if not days:
            break
        oldest = min(days)
        if oldest <= floor:
            break
        previous = datetime.strptime(oldest, "%Y%m%d").date() - timedelta(days=1)
        if ymd(previous) >= cursor:
            break
        cursor = ymd(previous)


def naver_stock_flow(ticker: str, start: date) -> Iterator[dict]:
    """Per-stock flows, denominated in SHARES (not KRW)."""
    floor, previous_min, page = ymd(start), None, 1
    while page <= 400:
        body = _request(
            f"{NAVER_ROOT}/item/frgn.naver?" + urlencode({"code": ticker, "page": page}),
            headers={"Referer": f"{NAVER_ROOT}/item/frgn.naver?code={ticker}"},
            encoding="euc-kr", pause=0.3)
        parsed = []
        for block in FLOW_ROW.findall(body):
            row = cells(block)
            if len(row) < 9:
                continue
            day = to_ymd(row[0])
            if not day:
                continue
            parsed.append((day, row))
        if not parsed:
            break

        for day, row in parsed:
            if day < floor:
                continue
            for investor, raw in (("기관", row[5]), ("외국인", row[6])):
                net = integer(raw)
                if net is None:
                    continue
                yield {
                    "record_id": identity("market_investor_flow_daily", "naver",
                                          day, "STOCK", ticker, investor),
                    "record_type": "market_investor_flow_daily",
                    "source": "naver_finance",
                    "bas_dd": day, "target_type": "STOCK", "target": ticker,
                    "investor": investor,
                    "net_volume": net, "net_value_krw": None,
                }
            rate = number(row[8])
            if rate is not None:
                yield {
                    "record_id": identity("market_foreign_holding_daily", "naver",
                                          day, ticker),
                    "record_type": "market_foreign_holding_daily",
                    "source": "naver_finance",
                    "bas_dd": day, "ticker": ticker,
                    "held_shares": integer(row[7]), "held_pct": rate,
                }

        page_min = min(day for day, _ in parsed)
        if page_min <= floor:
            break
        # At the bottom of a listing's history Naver keeps returning the same
        # page, so stop when the dates stop descending.
        if previous_min is not None and page_min >= previous_min:
            break
        previous_min = page_min
        page += 1


def naver_stream(start: date, end: date, state: dict, report: dict, *,
                 with_flows: bool, flow_universe: int) -> Iterator[dict]:
    for symbol, (series, name) in NAVER_INDEX_SYMBOLS.items():
        try:
            bars = naver_ohlcv(symbol, start, end)
        except RuntimeError as exc:
            report.setdefault("failures", []).append(f"index {symbol}: {exc}")
            continue
        for bar in bars:
            yield {
                "record_id": identity("market_index_daily", "naver",
                                      bar["bas_dd"], series, name),
                "record_type": "market_index_daily",
                "source": "naver_finance",
                "price_basis": "adjusted",
                "bas_dd": bar["bas_dd"], "idx_class": series, "idx_name": name,
                "open": bar["open"], "high": bar["high"], "low": bar["low"],
                "close": bar["close"], "volume": bar["volume"],
                "trading_value": None, "market_cap": None,
                "prev_diff": None, "change_pct": None,
            }

    universe = state.get("naver_universe") or []
    if not universe:
        for market in ("KOSPI", "KOSDAQ"):
            universe += [[code, name, market] for code, name in naver_listed(market)]
        state["naver_universe"] = universe

    done = set(state.setdefault("naver_done", {}).get("prices", []))
    streak = 0
    for ticker, name, market in universe:
        if ticker in done:
            continue
        try:
            bars = naver_ohlcv(ticker, start, end)
            streak = 0
        except RuntimeError as exc:
            streak += 1
            report.setdefault("failures", []).append(f"price {ticker}: {exc}")
            # A network outage would otherwise burn through the whole universe
            # and report success with nothing collected.
            if streak >= 5:
                report["aborted"] = "consecutive price failures"
                break
            continue
        for bar in bars:
            yield {
                "record_id": identity("market_price_daily", "naver",
                                      bar["bas_dd"], ticker),
                "record_type": "market_price_daily",
                "source": "naver_finance",
                "price_basis": "adjusted",
                "bas_dd": bar["bas_dd"], "ticker": ticker, "name": name,
                "market": market, "sector_type": None,
                "open": bar["open"], "high": bar["high"], "low": bar["low"],
                "close": bar["close"], "volume": bar["volume"],
                "trading_value": None, "market_cap": None,
                "listed_shares": None, "prev_diff": None, "change_pct": None,
            }
        done.add(ticker)
    state["naver_done"]["prices"] = sorted(done)

    if not with_flows:
        return

    for market in ("KOSPI", "KOSDAQ"):
        try:
            yield from naver_market_flow(market, start)
        except RuntimeError as exc:
            report.setdefault("failures", []).append(f"flow {market}: {exc}")

    flow_done = set(state.setdefault("naver_done", {}).get("flows", []))
    streak = 0
    for ticker, _, _ in universe[:flow_universe]:
        if ticker in flow_done:
            continue
        try:
            yield from naver_stock_flow(ticker, start)
            streak = 0
        except RuntimeError as exc:
            streak += 1
            report.setdefault("failures", []).append(f"flow {ticker}: {exc}")
            if streak >= 5:
                report["aborted"] = "consecutive flow failures"
                break
            continue
        flow_done.add(ticker)
    state["naver_done"]["flows"] = sorted(flow_done)


# --------------------------------------------------------------------------
# Run state (which days/tickers are already collected)


STATE_PATH = ROOT / "data" / "market" / "ingest_state.json"


def read_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def write_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                          encoding="utf-8")


# --------------------------------------------------------------------------
# CLI


def collect(mode: str, sources: list[str], start: date, end: date, *,
            with_flows: bool, flow_universe: int, resume: bool) -> int:
    state = read_state() if resume else {}
    report: dict[str, Any] = {"mode": mode, "sources": sources,
                              "start": start.isoformat(), "end": end.isoformat()}
    totals = {"inserted": 0, "changed": 0, "unchanged": 0}
    status = 0

    for source in sources:
        try:
            if source == "krx":
                stream = krx_stream(start, end, os.environ.get("KRX_AUTH_KEY", ""),
                                    state, report)
            else:
                stream = naver_stream(start, end, state, report,
                                      with_flows=with_flows,
                                      flow_universe=flow_universe)
            summary = STORE.merge(stream, collector="market_ingest", mode=mode)
            for key in totals:
                totals[key] += summary.get(key, 0)
        except AuthError as exc:
            report.setdefault("errors", []).append(f"{source}: {exc}")
            status = 2
        except KeyboardInterrupt:
            report["interrupted"] = True
            status = 130
            break
        finally:
            write_state(state)

    report.update(totals)
    print(json.dumps(report, ensure_ascii=False))
    return status


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("backfill", "update"):
        child = sub.add_parser(command)
        child.add_argument("--source", choices=["krx", "naver", "all"],
                           default="krx",
                           help="krx is official and cheap to update daily")
        child.add_argument("--start", type=date.fromisoformat)
        child.add_argument("--end", type=date.fromisoformat, default=date.today())
        child.add_argument("--revision-lookback-days", "--lookback-days",
                           dest="revision_lookback_days", type=int, default=7,
                           help="how far update re-reads to catch exchange revisions")
        child.add_argument("--flow-universe", type=int, default=350,
                           help="how many tickers to collect investor flows for")
        child.add_argument("--no-flows", action="store_true")
        child.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    sources = ["krx", "naver"] if args.source == "all" else [args.source]
    if args.start:
        start = args.start
    elif args.command == "backfill":
        start = KRX_FIRST_DAY if sources == ["krx"] else NAVER_FIRST_DAY
    else:
        start = args.end - timedelta(days=args.revision_lookback_days)

    # update must re-read days it already has, otherwise revisions never land.
    resume = not args.no_resume and args.command == "backfill"
    return collect(args.command, sources, start, args.end,
                   with_flows=not args.no_flows,
                   flow_universe=args.flow_universe, resume=resume)


if __name__ == "__main__":
    sys.exit(main())
