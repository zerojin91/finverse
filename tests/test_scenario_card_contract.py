"""Regression checks for the Scenario Library handoff contract."""

from __future__ import annotations

import json
from pathlib import Path


SCHEMA_DIR = Path(__file__).parents[1] / "docs" / "agents" / "scenario-card" / "schemas"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text())


def test_scenario_card_is_self_contained_for_the_detail_modal():
    schema = load_schema("scenario-card.schema.json")
    required = set(schema["required"])

    assert {"target", "image", "chapterLessons", "learningReport"} <= required
    assert schema["properties"]["chapterLessons"]["minItems"] == 4
    assert schema["properties"]["chapterLessons"]["maxItems"] == 4

    report = schema["$defs"]["learningReport"]
    assert set(report["required"]) == {"title", "lead", "metrics", "sections"}
    assert report["properties"]["metrics"]["minItems"] == 4
    assert report["properties"]["sections"]["minItems"] == 3


def test_event_blueprint_is_complete_before_impact_model_runs():
    schema = load_schema("scenario-set-plan.schema.json")
    event = schema["$defs"]["scenarioPlan"]["properties"]["event_templates"]["items"]

    assert {"week_label", "title", "body"} <= set(event["required"])


def test_scenarios_output_is_a_versioned_envelope():
    schema = load_schema("scenarios-output.schema.json")

    assert {"schema_version", "meta", "scenarios"} <= set(schema["required"])
    assert schema["properties"]["schema_version"]["const"] == "scenario-card/v1"
