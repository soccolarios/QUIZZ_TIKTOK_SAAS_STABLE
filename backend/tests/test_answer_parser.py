import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from answer_parser import AnswerParser, strip_emojis


@pytest.fixture
def parser():
    return AnswerParser()


class TestStripEmojis:
    def test_removes_common_emoji(self):
        assert strip_emojis("A😀") == "A"

    def test_removes_flag_emoji(self):
        assert strip_emojis("🇫🇷 B") == "B"

    def test_plain_text_unchanged(self):
        assert strip_emojis("BONJOUR") == "BONJOUR"

    def test_empty_string(self):
        assert strip_emojis("") == ""


class TestParseSimpleLetter:
    def test_single_a(self, parser):
        assert parser.parse("A") == "A"

    def test_single_b_lowercase(self, parser):
        assert parser.parse("b") == "B"

    def test_single_c_with_exclamation(self, parser):
        assert parser.parse("C!") == "C"

    def test_single_d_with_spaces(self, parser):
        assert parser.parse("  D  ") == "D"

    def test_letter_with_emoji(self, parser):
        assert parser.parse("A😊") == "A"

    def test_letter_in_parens(self, parser):
        assert parser.parse("(B)") == "B"

    def test_letter_with_trailing_punctuation(self, parser):
        assert parser.parse("C.") == "C"


class TestFalsePositives:
    def test_abandonner_not_a(self, parser):
        assert parser.parse("ABANDONNER") is None

    def test_abandon_not_a(self, parser):
        assert parser.parse("ABANDON") is None

    def test_bonjour_not_b(self, parser):
        assert parser.parse("BONJOUR") is None

    def test_bravo_not_b(self, parser):
        assert parser.parse("BRAVO") is None

    def test_cool_not_c(self, parser):
        assert parser.parse("COOL") is None

    def test_discord_not_d(self, parser):
        assert parser.parse("DISCORD") is None

    def test_accord_not_a(self, parser):
        assert parser.parse("ACCORD") is None

    def test_classe_not_c(self, parser):
        assert parser.parse("CLASSE") is None

    def test_aller_not_a(self, parser):
        assert parser.parse("ALLER") is None

    def test_bonne_not_b(self, parser):
        assert parser.parse("BONNE") is None

    def test_direct_not_d(self, parser):
        assert parser.parse("DIRECT") is None

    def test_avant_not_a(self, parser):
        assert parser.parse("AVANT") is None

    def test_allez_not_a(self, parser):
        assert parser.parse("ALLEZ") is None

    def test_deux_not_d(self, parser):
        assert parser.parse("DEUX") is None


class TestPrefixPatterns:
    def test_reponse_a(self, parser):
        assert parser.parse("REPONSE A") == "A"

    def test_reponse_colon_b(self, parser):
        assert parser.parse("reponse: B") == "B"

    def test_answer_c(self, parser):
        assert parser.parse("answer C") == "C"

    def test_choix_d(self, parser):
        assert parser.parse("choix D") == "D"

    def test_c_est_a(self, parser):
        assert parser.parse("c'est A") == "A"

    def test_a_final(self, parser):
        assert parser.parse("A final") == "A"

    def test_b_svp(self, parser):
        assert parser.parse("B svp") == "B"

    def test_option_c(self, parser):
        assert parser.parse("option C") == "C"


class TestEdgeCases:
    def test_none_input(self, parser):
        assert parser.parse(None) is None

    def test_empty_string(self, parser):
        assert parser.parse("") is None

    def test_empty_after_emoji_strip(self, parser):
        assert parser.parse("😊😀") is None

    def test_very_long_message(self, parser):
        assert parser.parse("A" * 101) is None

    def test_non_string_input(self, parser):
        assert parser.parse(42) is None

    def test_no_valid_letter(self, parser):
        assert parser.parse("HELLO WORLD") is None

    def test_multiple_different_letters(self, parser):
        assert parser.parse("A ou B") is None

    def test_same_letter_repeated(self, parser):
        assert parser.parse("A A A") == "A"

    def test_number_string(self, parser):
        assert parser.parse("123") is None

    def test_whitespace_only(self, parser):
        assert parser.parse("   ") is None


class TestIsValidAnswer:
    def test_valid_letters(self, parser):
        for letter in ["A", "B", "C", "D"]:
            assert parser.is_valid_answer(letter) is True

    def test_lowercase_valid(self, parser):
        assert parser.is_valid_answer("a") is True

    def test_invalid_e(self, parser):
        assert parser.is_valid_answer("E") is False

    def test_empty(self, parser):
        assert parser.is_valid_answer("") is False

    def test_none(self, parser):
        assert parser.is_valid_answer(None) is False


class TestExtractAllAnswers:
    def test_single_answer(self, parser):
        assert parser.extract_all_answers("A") == ["A"]

    def test_multiple_answers(self, parser):
        result = parser.extract_all_answers("A ou B")
        assert "A" in result
        assert "B" in result

    def test_empty(self, parser):
        assert parser.extract_all_answers("") == []

    def test_none(self, parser):
        assert parser.extract_all_answers(None) == []

    def test_deduplication(self, parser):
        result = parser.extract_all_answers("A A A")
        assert result == ["A"]


class TestGetAnswerConfidence:
    def test_single_letter_max_confidence(self, parser):
        answer, confidence = parser.get_answer_confidence("A")
        assert answer == "A"
        assert confidence == 1.0

    def test_parsed_answer_high_confidence(self, parser):
        answer, confidence = parser.get_answer_confidence("reponse B")
        assert answer == "B"
        assert confidence == 0.9

    def test_no_answer_zero_confidence(self, parser):
        answer, confidence = parser.get_answer_confidence("BONJOUR")
        assert answer is None
        assert confidence == 0.0

    def test_empty_input(self, parser):
        answer, confidence = parser.get_answer_confidence("")
        assert answer is None
        assert confidence == 0.0
