"""
Loads a quiz from the DB and adapts it into the format expected by the existing
QuestionnaireManager / game engine.

Accepted data_json formats:

  FORMAT A — Legacy (questionnaire at root):
  {
    "id": 12,
    "name": "culture générale 2",
    "description": "...",
    "category": "Culture generale",
    "active": true,
    "order": 3,
    "questions": [ { "id": 140, "text": "...", "choices": {...}, "correct_answer": "B", ... } ]
  }

  FORMAT B — Wrapper (array of questionnaires):
  {
    "questionnaires": [
      { "id": 1, "name": "...", "questions": [...] }
    ]
  }

Both formats are auto-detected. The engine always receives Format A (legacy single
questionnaire object).
"""

from __future__ import annotations
import sys
import os
import hashlib

from backend.saas.db.base import fetch_one


def _audio_dir_key_from_uuid(quiz_id: str) -> int:
    """
    Derive a stable integer filesystem key from a SaaS quiz UUID.

    The key is used as the subdirectory name under data/audio/questionnaires/
    so each quiz gets its own isolated audio cache:
        data/audio/questionnaires/<key>/q1_question.mp3 …

    Derivation: first 8 hex chars of the UUID (after stripping hyphens) → int.
    This produces values in [0, 4_294_967_295], which is unique in practice for
    any realistic number of quizzes and identical across process restarts.
    Falls back to an MD5-based value if the UUID format is unexpected.
    """
    clean = quiz_id.replace("-", "")
    try:
        return int(clean[:8], 16)
    except (ValueError, TypeError):
        return int(hashlib.md5(quiz_id.encode()).hexdigest()[:8], 16)


class QuizLoadError(Exception):
    pass


def detect_format(data_json: dict) -> str:
    """
    Returns 'legacy', 'wrapper', or 'unknown'.
    """
    if not isinstance(data_json, dict):
        return "unknown"
    if "questionnaires" in data_json and isinstance(data_json["questionnaires"], list):
        return "wrapper"
    if "questions" in data_json and isinstance(data_json["questions"], list):
        return "legacy"
    return "unknown"


def normalize_quiz_data(data_json: dict) -> dict:
    """
    Accepts either format and always returns a single legacy questionnaire dict.
    Raises QuizLoadError if neither format is recognised or data is invalid.
    """
    fmt = detect_format(data_json)

    if fmt == "unknown":
        raise QuizLoadError(
            "Unrecognised data_json format. "
            "Expected either a legacy questionnaire object with a 'questions' array, "
            "or a wrapper object with a 'questionnaires' array."
        )

    if fmt == "wrapper":
        questionnaires = data_json.get("questionnaires", [])
        if not questionnaires:
            raise QuizLoadError("'questionnaires' array is empty.")
        return questionnaires[0]

    return data_json


def load_quiz_from_db(quiz_id: str) -> dict:
    row = fetch_one(
        "SELECT id, project_id, title, description, data_json FROM saas_quizzes WHERE id = %s",
        (quiz_id,),
    )
    if not row:
        raise QuizLoadError(f"Quiz not found: {quiz_id}")
    return dict(row)


def validate_quiz_data(data_json: dict) -> None:
    if not isinstance(data_json, dict):
        raise QuizLoadError("data_json must be a JSON object")

    questions = data_json.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise QuizLoadError("data_json must contain a non-empty 'questions' list")

    required_q_keys = {"id", "text", "choices", "correct_answer"}
    for i, q in enumerate(questions):
        missing = required_q_keys - set(q.keys())
        if missing:
            raise QuizLoadError(f"Question[{i}] is missing required fields: {sorted(missing)}")
        if not isinstance(q["choices"], dict) or len(q["choices"]) < 2:
            raise QuizLoadError(f"Question[{i}] must have at least 2 choices")
        if q["correct_answer"] not in q["choices"]:
            raise QuizLoadError(
                f"Question[{i}] correct_answer '{q['correct_answer']}' is not a valid choice key. "
                f"Valid keys: {sorted(q['choices'].keys())}"
            )


def build_engine_questionnaire(quiz_row: dict) -> dict:
    """
    Normalises data_json to legacy format, validates, then returns the exact
    dict expected by the game engine (QuestionnaireManager).

    The questionnaire "id" is set to a stable integer derived from the SaaS
    quiz UUID so that every quiz gets its own audio cache directory:
        data/audio/questionnaires/<audio_dir_key>/
    instead of all quizzes sharing the collision-prone default value 9000.
    For non-SaaS rows (no UUID in 'id' column) we fall back to the value
    stored in data_json["id"].
    """
    raw = quiz_row.get("data_json") or {}
    data = normalize_quiz_data(raw)
    validate_quiz_data(data)

    saas_uuid = quiz_row.get("id")
    if saas_uuid:
        qn_id = _audio_dir_key_from_uuid(str(saas_uuid))
    else:
        qn_id = data.get("id", 9000)

    questionnaire = {
        "id": qn_id,
        "name": data.get("name") or quiz_row.get("title") or "SaaS Quiz",
        "description": data.get("description") or quiz_row.get("description") or "",
        "category": data.get("category", "general"),
        "active": data.get("active", True),
        "order": data.get("order", 0),
        "questions": [],
    }

    for q in data["questions"]:
        question = {
            "id": q["id"],
            "text": q["text"],
            "type": q.get("type", "standard"),
            "choices": q["choices"],
            "correct_answer": q["correct_answer"],
            "category": q.get("category", "general"),
            "difficulty": q.get("difficulty", 1),
            "active": q.get("active", True),
        }
        if question["type"] == "double":
            question["correct_answers"] = q.get("correct_answers", [q["correct_answer"]])
        questionnaire["questions"].append(question)

    return questionnaire


def prepare_quiz_for_session(quiz_id: str) -> dict:
    """
    Full pipeline: load from DB, normalise format, validate, return engine-ready dict.
    Raises QuizLoadError on any failure.
    """
    quiz_row = load_quiz_from_db(quiz_id)
    return build_engine_questionnaire(quiz_row)
