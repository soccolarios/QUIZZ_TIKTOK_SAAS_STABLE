import uuid
from flask import Blueprint, request, g
from backend.saas.auth.middleware import require_auth
from backend.saas.models.quiz import (
    create_quiz,
    get_quizzes_by_user,
    get_quizzes_by_project,
    get_quiz_by_id,
    update_quiz,
    delete_quiz,
    quiz_owned_by_user,
)
from backend.saas.models.project import project_owned_by
from backend.saas.utils.validators import is_valid_name
from backend.saas.utils.responses import success, error, serialize_row, serialize_rows
from backend.saas.services.plan_guard import check_can_create_quiz
from backend.saas.services.quiz_runtime_loader import (
    detect_format,
    normalize_quiz_data,
    validate_quiz_data,
    QuizLoadError,
)

bp = Blueprint("quizzes", __name__, url_prefix="/api/quizzes")

ANSWER_KEYS = ("A", "B", "C", "D")


def _validate_data_json(data_json: dict):
    """Returns (ok, error_message). Accepts legacy and wrapper formats."""
    if not isinstance(data_json, dict):
        return False, "data_json must be a JSON object"
    fmt = detect_format(data_json)
    if fmt == "unknown":
        return (
            False,
            "Unrecognised format. Use the legacy format (questionnaire object with a "
            "'questions' array) or the wrapper format ({ \"questionnaires\": [...] }).",
        )
    try:
        normalised = normalize_quiz_data(data_json)
        validate_quiz_data(normalised)
    except QuizLoadError as e:
        return False, str(e)
    return True, None


def _get_questions(data_json: dict) -> list:
    """Extract the questions list from legacy or wrapper format."""
    if isinstance(data_json.get("questionnaires"), list):
        questionnaires = data_json["questionnaires"]
        if questionnaires and isinstance(questionnaires[0].get("questions"), list):
            return questionnaires[0]["questions"]
        return []
    return data_json.get("questions") or []


def _set_questions(data_json: dict, questions: list) -> dict:
    """Write the questions list back into whichever format is stored."""
    if isinstance(data_json.get("questionnaires"), list) and data_json["questionnaires"]:
        data_json["questionnaires"][0]["questions"] = questions
    else:
        data_json["questions"] = questions
    return data_json


def _validate_question_payload(q: dict) -> tuple[bool, str | None]:
    text = (q.get("text") or "").strip()
    if not text:
        return False, "text is required"
    choices = q.get("choices") or {}
    if not isinstance(choices, dict):
        return False, "choices must be an object"
    for key in ANSWER_KEYS:
        val = (choices.get(key) or "").strip()
        if not val:
            return False, f"choices.{key} is required"
    correct = (q.get("correct_answer") or "").strip().upper()
    if correct not in ANSWER_KEYS:
        return False, f"correct_answer must be one of {ANSWER_KEYS}"
    return True, None


# ---------------------------------------------------------------------------
# Quiz CRUD
# ---------------------------------------------------------------------------

@bp.post("/")
@require_auth
def create():
    data = request.get_json(silent=True) or {}
    project_id = (data.get("project_id") or "").strip()
    title = (data.get("title") or "").strip()
    description = data.get("description")
    data_json = data.get("data_json") or {
        "id": 1,
        "name": title,
        "description": "",
        "category": "general",
        "active": True,
        "order": 1,
        "questions": [],
    }

    if not project_id:
        return error("project_id is required")

    valid, msg = is_valid_name(title, "Title")
    if not valid:
        return error(msg)

    # Only validate data_json structure when questions are actually provided.
    # An empty quiz (questions: []) is valid at creation time; the engine will
    # reject it at launch time if no questions have been added yet.
    user_supplied_data = data.get("data_json")
    if user_supplied_data is not None:
        ok, err_msg = _validate_data_json(user_supplied_data)
        if not ok:
            return error(err_msg)

    if not project_owned_by(project_id, g.current_user_id):
        return error("Project not found", 404)

    allowed, guard_msg = check_can_create_quiz(g.current_user_id, project_id)
    if not allowed:
        return error(guard_msg, 403)

    quiz = create_quiz(project_id, title, description, data_json)
    return success(serialize_row(quiz), 201)


@bp.get("/")
@require_auth
def list_all():
    project_id = request.args.get("project_id")
    if project_id:
        if not project_owned_by(project_id, g.current_user_id):
            return error("Project not found", 404)
        quizzes = get_quizzes_by_project(project_id)
    else:
        quizzes = get_quizzes_by_user(g.current_user_id)
    return success(serialize_rows(quizzes))


@bp.get("/<quiz_id>")
@require_auth
def get_one(quiz_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)
    quiz = get_quiz_by_id(quiz_id)
    return success(serialize_row(quiz))


@bp.patch("/<quiz_id>")
@require_auth
def update(quiz_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    data = request.get_json(silent=True) or {}
    title = data.get("title")
    description = data.get("description")
    data_json = data.get("data_json")

    if title is not None:
        title = title.strip()
        valid, msg = is_valid_name(title, "Title")
        if not valid:
            return error(msg)

    if data_json is not None:
        ok, err_msg = _validate_data_json(data_json)
        if not ok:
            return error(err_msg)

    quiz = update_quiz(quiz_id, title, description, data_json)
    return success(serialize_row(quiz))


@bp.delete("/<quiz_id>")
@require_auth
def delete(quiz_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    delete_quiz(quiz_id)
    return success({"message": "Quiz deleted"})


# ---------------------------------------------------------------------------
# Question CRUD  (mutates data_json in-place)
# ---------------------------------------------------------------------------

@bp.post("/<quiz_id>/questions")
@require_auth
def add_question(quiz_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    body = request.get_json(silent=True) or {}
    ok, err_msg = _validate_question_payload(body)
    if not ok:
        return error(err_msg)

    quiz = get_quiz_by_id(quiz_id)
    data_json = dict(quiz["data_json"])
    questions = _get_questions(data_json)

    new_q = {
        "id": str(uuid.uuid4()),
        "text": body["text"].strip(),
        "type": "standard",
        "choices": {k: body["choices"][k].strip() for k in ANSWER_KEYS},
        "correct_answer": body["correct_answer"].strip().upper(),
        "category": (body.get("category") or "").strip() or "general",
        "difficulty": int(body.get("difficulty") or 1),
        "active": True,
    }
    questions.append(new_q)
    _set_questions(data_json, questions)
    quiz = update_quiz(quiz_id, None, None, data_json)
    return success({"quiz": serialize_row(quiz), "question": new_q}, 201)


@bp.put("/<quiz_id>/questions/<question_id>")
@require_auth
def update_question(quiz_id, question_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    body = request.get_json(silent=True) or {}
    ok, err_msg = _validate_question_payload(body)
    if not ok:
        return error(err_msg)

    quiz = get_quiz_by_id(quiz_id)
    data_json = dict(quiz["data_json"])
    questions = _get_questions(data_json)

    idx = next((i for i, q in enumerate(questions) if str(q.get("id")) == question_id), None)
    if idx is None:
        return error("Question not found", 404)

    existing = questions[idx]
    existing["text"] = body["text"].strip()
    existing["choices"] = {k: body["choices"][k].strip() for k in ANSWER_KEYS}
    existing["correct_answer"] = body["correct_answer"].strip().upper()
    if "category" in body:
        existing["category"] = (body["category"] or "").strip() or existing.get("category", "general")
    if "difficulty" in body:
        existing["difficulty"] = int(body["difficulty"] or 1)

    questions[idx] = existing
    _set_questions(data_json, questions)
    quiz = update_quiz(quiz_id, None, None, data_json)
    return success({"quiz": serialize_row(quiz), "question": existing})


@bp.delete("/<quiz_id>/questions/<question_id>")
@require_auth
def delete_question(quiz_id, question_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    quiz = get_quiz_by_id(quiz_id)
    data_json = dict(quiz["data_json"])
    questions = _get_questions(data_json)

    before = len(questions)
    questions = [q for q in questions if str(q.get("id")) != question_id]
    if len(questions) == before:
        return error("Question not found", 404)

    _set_questions(data_json, questions)
    quiz = update_quiz(quiz_id, None, None, data_json)
    return success({"quiz": serialize_row(quiz)})


@bp.post("/<quiz_id>/questions/reorder")
@require_auth
def reorder_questions(quiz_id):
    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    body = request.get_json(silent=True) or {}
    ordered_ids = body.get("ordered_ids")
    if not isinstance(ordered_ids, list):
        return error("ordered_ids must be an array")

    quiz = get_quiz_by_id(quiz_id)
    data_json = dict(quiz["data_json"])
    questions = _get_questions(data_json)

    by_id = {str(q.get("id")): q for q in questions}
    reordered = [by_id[qid] for qid in ordered_ids if qid in by_id]
    # Append any questions not referenced in ordered_ids at the end
    referenced = set(ordered_ids)
    for q in questions:
        if str(q.get("id")) not in referenced:
            reordered.append(q)

    _set_questions(data_json, reordered)
    quiz = update_quiz(quiz_id, None, None, data_json)
    return success({"quiz": serialize_row(quiz)})
