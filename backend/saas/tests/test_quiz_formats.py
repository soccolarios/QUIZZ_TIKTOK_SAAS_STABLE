"""
Tests for quiz format detection, normalisation, validation, and engine output.

Covers:
  - Format A (legacy): questionnaire object at root with questions[]
  - Format B (wrapper): { "questionnaires": [...] }
  - Invalid / missing fields
  - Full pipeline: normalize → validate → build_engine_questionnaire
  - Engine output contract: always the same structure regardless of input format

Run:
    pytest backend/saas/tests/test_quiz_formats.py -v
"""

import sys
import os
import copy

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import pytest
from backend.saas.services.quiz_runtime_loader import (
    detect_format,
    normalize_quiz_data,
    validate_quiz_data,
    build_engine_questionnaire,
    QuizLoadError,
)

# -------------------------------------------------------
# Fixtures
# -------------------------------------------------------

VALID_QUESTION = {
    "id": 1,
    "text": "Qui a inventé le premier vaccin contre la variole ?",
    "type": "standard",
    "choices": {
        "A": "Louis Pasteur",
        "B": "Edward Jenner",
        "C": "Albert Calmette",
        "D": "Robert Koch",
    },
    "correct_answer": "B",
    "category": "Culture generale",
    "difficulty": 2,
    "active": True,
}

VALID_LEGACY = {
    "id": 12,
    "name": "culture générale 2",
    "description": "Généré par IA",
    "category": "Culture generale",
    "active": True,
    "order": 3,
    "questions": [VALID_QUESTION],
}

VALID_WRAPPER = {
    "questionnaires": [VALID_LEGACY]
}

MINIMAL_LEGACY = {
    "questions": [
        {
            "id": 1,
            "text": "Question test ?",
            "choices": {"A": "Oui", "B": "Non"},
            "correct_answer": "A",
        }
    ]
}

DOUBLE_QUESTION = {
    "id": 2,
    "text": "Quelles couleurs du drapeau français ?",
    "type": "double",
    "choices": {"A": "Bleu", "B": "Rouge", "C": "Vert", "D": "Blanc"},
    "correct_answer": "A",
    "correct_answers": ["A", "B", "D"],
    "category": "geographie",
    "difficulty": 1,
    "active": True,
}

# -------------------------------------------------------
# detect_format
# -------------------------------------------------------

class TestDetectFormat:
    def test_legacy_format_detected(self):
        assert detect_format(VALID_LEGACY) == "legacy"

    def test_wrapper_format_detected(self):
        assert detect_format(VALID_WRAPPER) == "wrapper"

    def test_minimal_legacy_detected(self):
        assert detect_format(MINIMAL_LEGACY) == "legacy"

    def test_empty_dict_is_unknown(self):
        assert detect_format({}) == "unknown"

    def test_no_questions_no_questionnaires_is_unknown(self):
        assert detect_format({"name": "test", "description": "x"}) == "unknown"

    def test_non_dict_is_unknown(self):
        assert detect_format([]) == "unknown"
        assert detect_format("string") == "unknown"
        assert detect_format(None) == "unknown"
        assert detect_format(42) == "unknown"

    def test_questions_not_list_is_unknown(self):
        assert detect_format({"questions": "not a list"}) == "unknown"

    def test_questionnaires_not_list_is_unknown(self):
        assert detect_format({"questionnaires": "not a list"}) == "unknown"

    def test_wrapper_takes_precedence_over_legacy_keys(self):
        both = {"questionnaires": [VALID_LEGACY], "questions": [VALID_QUESTION]}
        assert detect_format(both) == "wrapper"


# -------------------------------------------------------
# normalize_quiz_data
# -------------------------------------------------------

class TestNormalizeQuizData:
    def test_legacy_returns_same_dict(self):
        result = normalize_quiz_data(VALID_LEGACY)
        assert result is VALID_LEGACY

    def test_wrapper_returns_first_questionnaire(self):
        result = normalize_quiz_data(VALID_WRAPPER)
        assert result == VALID_LEGACY

    def test_wrapper_with_multiple_returns_first(self):
        second = copy.deepcopy(VALID_LEGACY)
        second["id"] = 99
        wrapper = {"questionnaires": [VALID_LEGACY, second]}
        result = normalize_quiz_data(wrapper)
        assert result["id"] == VALID_LEGACY["id"]

    def test_unknown_format_raises(self):
        with pytest.raises(QuizLoadError, match="Unrecognised"):
            normalize_quiz_data({})

    def test_empty_questionnaires_raises(self):
        with pytest.raises(QuizLoadError, match="empty"):
            normalize_quiz_data({"questionnaires": []})

    def test_non_dict_raises(self):
        with pytest.raises(QuizLoadError):
            normalize_quiz_data([])

    def test_minimal_legacy_normalises(self):
        result = normalize_quiz_data(MINIMAL_LEGACY)
        assert result["questions"][0]["id"] == 1


# -------------------------------------------------------
# validate_quiz_data
# -------------------------------------------------------

class TestValidateQuizData:
    def test_valid_legacy_passes(self):
        validate_quiz_data(VALID_LEGACY)

    def test_minimal_legacy_passes(self):
        validate_quiz_data(MINIMAL_LEGACY)

    def test_missing_questions_key_raises(self):
        with pytest.raises(QuizLoadError, match="questions"):
            validate_quiz_data({"name": "test"})

    def test_empty_questions_raises(self):
        with pytest.raises(QuizLoadError, match="non-empty"):
            validate_quiz_data({"questions": []})

    def test_questions_not_list_raises(self):
        with pytest.raises(QuizLoadError, match="questions"):
            validate_quiz_data({"questions": "bad"})

    def test_missing_id_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        del q["id"]
        with pytest.raises(QuizLoadError, match="id"):
            validate_quiz_data({"questions": [q]})

    def test_missing_text_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        del q["text"]
        with pytest.raises(QuizLoadError, match="text"):
            validate_quiz_data({"questions": [q]})

    def test_missing_choices_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        del q["choices"]
        with pytest.raises(QuizLoadError, match="choices"):
            validate_quiz_data({"questions": [q]})

    def test_missing_correct_answer_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        del q["correct_answer"]
        with pytest.raises(QuizLoadError, match="correct_answer"):
            validate_quiz_data({"questions": [q]})

    def test_choices_not_dict_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        q["choices"] = ["A", "B"]
        with pytest.raises(QuizLoadError, match="choices"):
            validate_quiz_data({"questions": [q]})

    def test_only_one_choice_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        q["choices"] = {"A": "Only one"}
        with pytest.raises(QuizLoadError, match="choices"):
            validate_quiz_data({"questions": [q]})

    def test_correct_answer_not_in_choices_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        q["correct_answer"] = "Z"
        with pytest.raises(QuizLoadError, match="correct_answer"):
            validate_quiz_data({"questions": [q]})

    def test_multiple_questions_all_valid(self):
        q2 = copy.deepcopy(VALID_QUESTION)
        q2["id"] = 2
        validate_quiz_data({"questions": [VALID_QUESTION, q2]})

    def test_error_reports_question_index(self):
        q_bad = copy.deepcopy(VALID_QUESTION)
        del q_bad["text"]
        with pytest.raises(QuizLoadError, match=r"Question\[1\]"):
            validate_quiz_data({"questions": [VALID_QUESTION, q_bad]})


# -------------------------------------------------------
# build_engine_questionnaire — engine output contract
# -------------------------------------------------------

class TestBuildEngineQuestionnaire:
    def _make_row(self, data_json: dict, title: str = "Test Quiz") -> dict:
        return {"title": title, "description": "desc", "data_json": data_json}

    def test_legacy_produces_valid_output(self):
        row = self._make_row(VALID_LEGACY)
        result = build_engine_questionnaire(row)
        self._assert_engine_contract(result)

    def test_wrapper_produces_valid_output(self):
        row = self._make_row(VALID_WRAPPER)
        result = build_engine_questionnaire(row)
        self._assert_engine_contract(result)

    def test_legacy_and_wrapper_produce_identical_output(self):
        row_legacy = self._make_row(VALID_LEGACY)
        row_wrapper = self._make_row(VALID_WRAPPER)
        result_legacy = build_engine_questionnaire(row_legacy)
        result_wrapper = build_engine_questionnaire(row_wrapper)
        assert result_legacy == result_wrapper

    def test_minimal_legacy_produces_valid_output(self):
        row = self._make_row(MINIMAL_LEGACY)
        result = build_engine_questionnaire(row)
        self._assert_engine_contract(result)

    def test_output_id_from_data_json(self):
        row = self._make_row(VALID_LEGACY)
        result = build_engine_questionnaire(row)
        assert result["id"] == 12

    def test_output_id_defaults_to_9000_when_absent(self):
        data = copy.deepcopy(MINIMAL_LEGACY)
        row = self._make_row(data)
        result = build_engine_questionnaire(row)
        assert result["id"] == 9000

    def test_output_name_falls_back_to_title(self):
        data = copy.deepcopy(MINIMAL_LEGACY)
        row = self._make_row(data, title="Fallback Title")
        result = build_engine_questionnaire(row)
        assert result["name"] == "Fallback Title"

    def test_output_questions_are_normalised(self):
        row = self._make_row(VALID_LEGACY)
        result = build_engine_questionnaire(row)
        q = result["questions"][0]
        assert q["id"] == VALID_QUESTION["id"]
        assert q["text"] == VALID_QUESTION["text"]
        assert q["type"] == "standard"
        assert q["choices"] == VALID_QUESTION["choices"]
        assert q["correct_answer"] == VALID_QUESTION["correct_answer"]

    def test_question_type_defaults_to_standard(self):
        data = copy.deepcopy(MINIMAL_LEGACY)
        row = self._make_row(data)
        result = build_engine_questionnaire(row)
        assert result["questions"][0]["type"] == "standard"

    def test_difficulty_defaults_to_1(self):
        data = copy.deepcopy(MINIMAL_LEGACY)
        row = self._make_row(data)
        result = build_engine_questionnaire(row)
        assert result["questions"][0]["difficulty"] == 1

    def test_active_defaults_to_true(self):
        data = copy.deepcopy(MINIMAL_LEGACY)
        row = self._make_row(data)
        result = build_engine_questionnaire(row)
        assert result["questions"][0]["active"] is True

    def test_double_type_includes_correct_answers(self):
        data = {"id": 1, "questions": [DOUBLE_QUESTION]}
        row = self._make_row(data)
        result = build_engine_questionnaire(row)
        q = result["questions"][0]
        assert q["type"] == "double"
        assert "correct_answers" in q
        assert q["correct_answers"] == ["A", "B", "D"]

    def test_standard_type_has_no_correct_answers_key(self):
        row = self._make_row(VALID_LEGACY)
        result = build_engine_questionnaire(row)
        q = result["questions"][0]
        assert "correct_answers" not in q

    def test_invalid_format_raises(self):
        row = self._make_row({})
        with pytest.raises(QuizLoadError):
            build_engine_questionnaire(row)

    def test_missing_required_field_raises(self):
        q = copy.deepcopy(VALID_QUESTION)
        del q["text"]
        data = {"questions": [q]}
        row = self._make_row(data)
        with pytest.raises(QuizLoadError, match="text"):
            build_engine_questionnaire(row)

    def _assert_engine_contract(self, result: dict) -> None:
        assert isinstance(result, dict)
        for key in ("id", "name", "description", "category", "active", "order", "questions"):
            assert key in result, f"Missing key in engine output: {key}"
        assert isinstance(result["id"], int)
        assert isinstance(result["name"], str) and result["name"]
        assert isinstance(result["questions"], list) and len(result["questions"]) > 0
        for q in result["questions"]:
            for qkey in ("id", "text", "type", "choices", "correct_answer", "category", "difficulty", "active"):
                assert qkey in q, f"Missing question key: {qkey}"
            assert isinstance(q["choices"], dict)
            assert q["correct_answer"] in q["choices"]


# -------------------------------------------------------
# Full pipeline simulation (save → reload → start session)
# -------------------------------------------------------

class TestFullPipeline:
    """
    Simulates the full save → reload → start session pipeline
    without touching the database. Uses build_engine_questionnaire
    directly with a quiz_row dict as if it came from DB.
    """

    def _simulate_db_row(self, data_json: dict, title: str = "Pipeline Quiz") -> dict:
        return {
            "id": "00000000-0000-0000-0000-000000000001",
            "project_id": "00000000-0000-0000-0000-000000000002",
            "title": title,
            "description": "Test description",
            "data_json": data_json,
        }

    def test_legacy_save_reload_launch(self):
        row = self._simulate_db_row(VALID_LEGACY)
        result = build_engine_questionnaire(row)
        assert result["id"] == 12
        assert len(result["questions"]) == 1
        assert result["questions"][0]["correct_answer"] in result["questions"][0]["choices"]

    def test_wrapper_save_reload_launch(self):
        row = self._simulate_db_row(VALID_WRAPPER)
        result = build_engine_questionnaire(row)
        assert result["id"] == 12
        assert len(result["questions"]) == 1

    def test_minimal_legacy_save_reload_launch(self):
        row = self._simulate_db_row(MINIMAL_LEGACY)
        result = build_engine_questionnaire(row)
        assert result["questions"][0]["id"] == 1

    def test_legacy_and_wrapper_same_quiz_same_runtime(self):
        row_l = self._simulate_db_row(VALID_LEGACY)
        row_w = self._simulate_db_row(VALID_WRAPPER)
        assert build_engine_questionnaire(row_l) == build_engine_questionnaire(row_w)

    def test_missing_data_json_raises(self):
        row = self._simulate_db_row(None)
        with pytest.raises(QuizLoadError):
            build_engine_questionnaire(row)

    def test_empty_data_json_raises(self):
        row = self._simulate_db_row({})
        with pytest.raises(QuizLoadError):
            build_engine_questionnaire(row)

    def test_correct_answer_always_valid_in_choices(self):
        row = self._simulate_db_row(VALID_LEGACY)
        result = build_engine_questionnaire(row)
        for q in result["questions"]:
            assert q["correct_answer"] in q["choices"], (
                f"correct_answer '{q['correct_answer']}' not in choices {list(q['choices'].keys())}"
            )

    def test_multi_question_quiz_all_valid(self):
        q2 = copy.deepcopy(VALID_QUESTION)
        q2["id"] = 2
        q2["text"] = "Deuxième question ?"
        data = copy.deepcopy(VALID_LEGACY)
        data["questions"] = [VALID_QUESTION, q2]
        row = self._simulate_db_row(data)
        result = build_engine_questionnaire(row)
        assert len(result["questions"]) == 2
        for q in result["questions"]:
            assert q["correct_answer"] in q["choices"]
