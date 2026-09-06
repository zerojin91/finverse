"""Select a bounded, diverse subset of community comments for LLM prompts."""

from __future__ import annotations

from typing import Any, Iterable


def _number(row: dict[str, Any], key: str) -> int:
    try:
        return max(0, int(row.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def select_representative_comments(
    comments: Iterable[dict[str, Any]],
    limit: int = 24,
) -> list[dict[str, Any]]:
    """Keep high-engagement comments while spreading coverage across videos.

    The complete comment set remains available in the cached history. This
    helper only bounds prompt size and avoids letting one popular video fill
    the entire community context.
    """
    if limit <= 0:
        return []

    rows = [row for row in comments if row.get("text")]
    ranked = sorted(
        rows,
        key=lambda row: (
            _number(row, "like_count") + (_number(row, "reply_count") * 2),
            _number(row, "like_count"),
            str(row.get("published_at") or ""),
        ),
        reverse=True,
    )
    if len(ranked) <= limit:
        return ranked

    selected: list[dict[str, Any]] = []
    selected_ids: set[int] = set()
    seen_videos: set[str] = set()
    diversity_target = min(limit, max(8, min(16, len(ranked))))

    for row in ranked:
        video_key = str(row.get("video_id") or row.get("video_title") or "").strip()
        if video_key and video_key in seen_videos:
            continue
        selected.append(row)
        selected_ids.add(id(row))
        if video_key:
            seen_videos.add(video_key)
        if len(selected) >= diversity_target:
            break

    for row in ranked:
        if id(row) in selected_ids:
            continue
        selected.append(row)
        if len(selected) >= limit:
            break

    # Chronological order makes the bounded context easier for the model to
    # connect to the recent market/event timeline.
    return sorted(
        selected[:limit],
        key=lambda row: (str(row.get("published_at") or ""), str(row.get("video_title") or "")),
    )
