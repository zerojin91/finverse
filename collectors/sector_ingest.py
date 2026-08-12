#!/usr/bin/env python3
"""Ingest the security-to-sector mapping that the market collector cannot get.

The ontology's 시장 domain wants sectors -- 반도체, 금융, 자동차 -- attached to
securities.  Neither existing source provides that link:

  KRX Open API   종목기본정보's SECT_TP_NM is the KOSDAQ board segment
                 (중견기업부·우량기업부·벤처기업부), empty for all 943 KOSPI
                 securities.  It is not an industry at all.
  KRX 업종지수    arrives inside the index series and gives sector *levels*,
                 but KRX does not publish the constituents behind them.

Naver Finance groups every listed security under one of 79 industries and
publishes the members, which closes the gap:

    /sise/sise_group.naver?type=upjong          79 industries
    /sise/sise_group_detail.naver?no=<id>       its constituents

This is a **current snapshot**, not history.  A security that changes industry
simply starts appearing under the new one; nothing here reconstructs when it
moved, and a delisted security is not tombstoned.  ``collected_at`` is the only
time signal, which is why record identity deliberately excludes the date --
otherwise every daily run would rewrite all ~2,700 rows as "changed".

    python3 collectors/sector_ingest.py update
    python3 collectors/sector_ingest.py backfill    # identical; a snapshot has no range

Writes to data/sector rather than data/market so it can run while a multi-day
market backfill holds that store.
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _jsonl_store import JsonlStore, load_dotenv, sha256   # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
STORE = JsonlStore(ROOT / "data" / "sector")

SOURCE = "naver_finance"
SCHEME = "naver_wics"
NAVER_ROOT = "https://finance.naver.com"
PAUSE = 0.3
TIMEOUT = 20

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"),
    "Referer": NAVER_ROOT + "/sise/",
}

# The listing markup writes a bare & rather than &amp;, so the pattern must not
# expect the entity -- matching &amp; here silently returns zero industries.
INDUSTRY = re.compile(
    r'href="/sise/sise_group_detail\.naver\?type=upjong&no=(\d+)"\s*>([^<]+)</a>')
MEMBER = re.compile(r'href="/item/main\.naver\?code=(\d{6})"\s*>([^<]+)</a>')


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read().decode("euc-kr", "replace")


def text(value: str) -> str:
    return html.unescape(value).strip()


def collect(mode: str) -> int:
    failures: list[str] = []
    records: list[dict] = []

    try:
        listing = fetch(f"{NAVER_ROOT}/sise/sise_group.naver?type=upjong")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(json.dumps({"mode": mode, "failures": [f"industry list: {exc}"]},
                         ensure_ascii=False))
        return 2

    industries = INDUSTRY.findall(listing)
    if not industries:
        # A parse that returns nothing is a markup change, not an empty market.
        # Failing loudly beats writing an empty snapshot over a good one.
        print(json.dumps({"mode": mode, "failures": ["industry list parsed to 0 rows"]},
                         ensure_ascii=False))
        return 2

    for code, raw_name in industries:
        name = text(raw_name)
        try:
            detail = fetch(
                f"{NAVER_ROOT}/sise/sise_group_detail.naver?type=upjong&no={code}")
        except (urllib.error.URLError, TimeoutError) as exc:
            failures.append(f"{name}({code}): {exc}")
            continue
        members = {ticker: text(nm) for ticker, nm in MEMBER.findall(detail)}
        for ticker, security_name in members.items():
            records.append({
                "record_id": sha256({"scheme": SCHEME, "sector": code, "ticker": ticker}),
                "record_type": "market_sector_membership",
                "source": SOURCE,
                "scheme": SCHEME,
                "sector_code": code,
                "sector_name": name,
                "ticker": ticker,
                "security_name": security_name or None,
            })
        time.sleep(PAUSE)

    summary = STORE.merge(records, collector="sector_ingest", mode=mode)
    print(json.dumps({"mode": mode, "industries": len(industries),
                      "pairs": len(records), "failures": failures, **summary},
                     ensure_ascii=False, sort_keys=True))
    return 1 if failures and not records else 0


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("backfill", "update"):
        child = sub.add_parser(command)
        # Accepted and ignored: ingest_all passes them to every collector, and a
        # snapshot has no range to narrow.
        child.add_argument("--start")
        child.add_argument("--end")
        child.add_argument("--revision-lookback-days", "--lookback-days",
                           dest="revision_lookback_days", type=int, default=0)
    args = parser.parse_args()
    return collect(args.command)


if __name__ == "__main__":
    sys.exit(main())
