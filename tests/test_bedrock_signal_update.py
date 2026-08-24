import sys
from pathlib import Path
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import bedrock_signal_update as signals


class OpenRouterSignalValidationTest(unittest.TestCase):
    def valid_analysis(self):
        return {"marketBrief": {"lines": ["장마감 첫 문장", "다음 거래일 확인 문장"]}, **{
            key: {
                "impactSummary": f"{key}의 KOSPI 연결 요약",
                "topics": [
                    {"title": "첫 번째", "summary": "첫 번째 설명", "importance": 3, "sourceIds": [f"{key}:source:1"]},
                    {"title": "두 번째", "summary": "두 번째 설명", "importance": 2, "sourceIds": [f"{key}:source:2"]},
                ],
            }
            for key in signals.SIGNAL_KEYS
        }}

    def test_accepts_exact_schema(self):
        self.assertEqual(signals.validate_analysis(self.valid_analysis())["economy"]["topics"][0]["title"], "첫 번째")

    def test_accepts_one_topic_and_rejects_empty_topics(self):
        value = self.valid_analysis()
        value["event"]["topics"].pop()
        self.assertEqual(len(signals.validate_analysis(value)["event"]["topics"]), 1)
        value["event"]["topics"].clear()
        with self.assertRaisesRegex(ValueError, "one or two topics"):
            signals.validate_analysis(value)

    def test_rejects_missing_section(self):
        value = self.valid_analysis()
        del value["community"]
        with self.assertRaisesRegex(ValueError, "missing analysis section"):
            signals.validate_analysis(value)

    def test_scopes_each_tab_to_its_own_sources(self):
        scoped = signals.analysis_input({
            "asOf": "20260810",
            "kospi": {"close": 6000},
            "macros": [{"name": "기준금리"}],
            "flows": [{"investor": "외국인"}],
            "news": [
                {"title": "국가", "countries": ["US"], "eventTypes": []},
                {"title": "이벤트", "countries": [], "eventTypes": ["EARNINGS"]},
            ],
            "community": [{"topic": "반도체 투자심리"}],
        })["sections"]

        self.assertEqual([item["title"] for item in scoped["economy"]["evidence"]], ["기준금리"])
        self.assertEqual([item["title"] for item in scoped["country"]["evidence"]], ["국가"])
        self.assertEqual(scoped["event"]["evidence"][0]["title"], "이벤트")
        self.assertEqual(scoped["community"]["evidence"][0]["title"], "반도체 투자심리")

    def test_rejects_sources_from_another_tab(self):
        value = self.valid_analysis()
        value["economy"]["topics"][0]["sourceIds"] = ["country:source:1"]
        allowed = {key: {f"{key}:source:1", f"{key}:source:2"} for key in signals.SIGNAL_KEYS}
        with self.assertRaisesRegex(ValueError, "unknown topic source"):
            signals.validate_analysis(value, allowed)

    def test_rejects_importance_outside_three_point_scale(self):
        value = self.valid_analysis()
        value["country"]["topics"][0]["importance"] = 4
        with self.assertRaisesRegex(ValueError, "invalid topic importance"):
            signals.validate_analysis(value)

    def test_rejects_missing_market_brief(self):
        value = self.valid_analysis()
        del value["marketBrief"]
        with self.assertRaisesRegex(ValueError, "marketBrief"):
            signals.validate_analysis(value)

if __name__ == "__main__":
    unittest.main()
