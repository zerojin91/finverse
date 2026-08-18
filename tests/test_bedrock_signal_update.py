import sys
from pathlib import Path
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import bedrock_signal_update as signals


class BedrockSignalValidationTest(unittest.TestCase):
    def valid_analysis(self):
        return {
            key: {
                "impactSummary": f"{key}의 KOSPI 연결 요약",
                "topics": [
                    {"title": "첫 번째", "summary": "첫 번째 설명"},
                    {"title": "두 번째", "summary": "두 번째 설명"},
                ],
            }
            for key in signals.SIGNAL_KEYS
        }

    def test_accepts_exact_schema(self):
        self.assertEqual(signals.validate_analysis(self.valid_analysis())["economy"]["topics"][0]["title"], "첫 번째")

    def test_rejects_topic_count_other_than_two(self):
        value = self.valid_analysis()
        value["event"]["topics"].pop()
        with self.assertRaisesRegex(ValueError, "exactly two topics"):
            signals.validate_analysis(value)

    def test_rejects_missing_section(self):
        value = self.valid_analysis()
        del value["community"]
        with self.assertRaisesRegex(ValueError, "missing analysis section"):
            signals.validate_analysis(value)

if __name__ == "__main__":
    unittest.main()
