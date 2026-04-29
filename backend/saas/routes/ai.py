"""
SaaS AI generation route.

POST /api/ai/generate

Calls OpenAI using the server-managed OPENAI_API_KEY environment variable.
The key is NEVER exposed to or configurable by end users.
Returns a structured list of generated questions ready to be saved into a quiz.
"""

import json
import logging
import os
import re
import uuid

from flask import Blueprint, request, g

from backend.saas.auth.middleware import require_auth
from backend.saas.utils.responses import success, error

logger = logging.getLogger(__name__)

bp = Blueprint("ai", __name__, url_prefix="/api/ai")

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

DIFFICULTY_LABELS = {1: "facile", 2: "moyen", 3: "difficile"}

STYLE_HINTS = {
    "standard": "Questions classiques avec 4 choix de reponse.",
    "anecdote": "Questions basees sur des anecdotes et faits surprenants.",
    "chiffres": "Questions autour de dates, chiffres, statistiques, records.",
    "personnalites": "Questions sur des personnalites celebres, leurs oeuvres ou actions.",
}

VALID_ANSWER_KEYS = {"A", "B", "C", "D"}
MAX_QUESTIONS = 20
MIN_QUESTIONS = 1


def _get_openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "AI generation is not configured on this server. "
            "The administrator must set the OPENAI_API_KEY environment variable."
        )
    return key


def _build_prompt(theme: str, category: str, difficulty: int, count: int,
                  language: str, audience: str, style: str) -> str:
    diff_label = DIFFICULTY_LABELS.get(difficulty, "moyen")
    style_hint = STYLE_HINTS.get(style, STYLE_HINTS["standard"])
    return (
        f"Genere exactement {count} questions de quiz en langue '{language}'.\n"
        f"Theme : {theme}\n"
        f"Categorie : {category}\n"
        f"Difficulte : {diff_label}\n"
        f"Public cible : {audience}\n"
        f"Style : {style_hint}\n\n"
        "Reponds UNIQUEMENT avec un tableau JSON valide. Chaque element doit avoir exactement cette structure :\n"
        '{\n'
        '  "text": "Texte de la question",\n'
        '  "choices": {"A": "Choix A", "B": "Choix B", "C": "Choix C", "D": "Choix D"},\n'
        '  "correct_answer": "A",\n'
        '  "difficulty": 2,\n'
        '  "category": "nom de categorie"\n'
        '}\n\n'
        'Regles strictes :\n'
        '- correct_answer doit etre une seule lettre parmi A, B, C, D\n'
        '- Chaque choix doit etre different et plausible\n'
        '- Les questions doivent etre factuellement correctes\n'
        '- Ne pas inclure la reponse correcte dans le texte de la question\n'
        '- Reponds UNIQUEMENT avec le tableau JSON, sans texte avant ni apres\n'
    )


def _call_openai(api_key: str, prompt: str) -> list:
    import requests as _requests

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {
                "role": "system",
                "content": (
                    "Tu es un generateur expert de questions de quiz. "
                    "Tu reponds uniquement avec du JSON valide, sans markdown, sans explication."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.8,
        "max_tokens": 4000,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    resp = _requests.post(OPENAI_CHAT_URL, json=payload, headers=headers, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI API error {resp.status_code}: {resp.text[:300]}")

    content = resp.json()["choices"][0]["message"]["content"].strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    parsed = json.loads(content)
    if not isinstance(parsed, list):
        raise ValueError("OpenAI response is not a JSON array")
    return parsed


def _validate_and_normalise(raw: list, default_difficulty: int, default_category: str) -> list:
    result = []
    for q in raw:
        if not isinstance(q, dict):
            continue
        text = (q.get("text") or "").strip()
        choices = q.get("choices") or {}
        correct = (q.get("correct_answer") or "").strip().upper()

        if not text:
            continue
        if not isinstance(choices, dict):
            continue
        if not all((choices.get(k) or "").strip() for k in VALID_ANSWER_KEYS):
            continue
        if correct not in VALID_ANSWER_KEYS:
            continue

        result.append({
            "id": str(uuid.uuid4()),
            "text": text,
            "type": "standard",
            "choices": {k: choices[k].strip() for k in ("A", "B", "C", "D")},
            "correct_answer": correct,
            "difficulty": max(1, min(3, int(q.get("difficulty") or default_difficulty))),
            "category": (q.get("category") or default_category).strip(),
            "active": True,
        })
    return result


@bp.post("/generate")
@require_auth
def generate():
    body = request.get_json(silent=True) or {}

    theme = (body.get("theme") or "").strip()
    if not theme:
        return error("theme is required")

    try:
        difficulty = int(body.get("difficulty") or 2)
        if difficulty not in (1, 2, 3):
            raise ValueError
    except (ValueError, TypeError):
        return error("difficulty must be 1, 2, or 3")

    try:
        question_count = int(body.get("question_count") or 10)
        if not (MIN_QUESTIONS <= question_count <= MAX_QUESTIONS):
            raise ValueError
    except (ValueError, TypeError):
        return error(f"question_count must be between {MIN_QUESTIONS} and {MAX_QUESTIONS}")

    language = (body.get("language") or "fr").strip()
    audience = (body.get("audience") or "general").strip()
    style = (body.get("style") or "standard").strip()
    if style not in STYLE_HINTS:
        style = "standard"

    # category defaults to theme when not explicitly provided
    category = (body.get("category") or theme).strip()

    try:
        api_key = _get_openai_key()
    except RuntimeError as e:
        return error(str(e), 503)

    prompt = _build_prompt(
        theme=theme,
        category=category,
        difficulty=difficulty,
        count=question_count,
        language=language,
        audience=audience,
        style=style,
    )

    logger.info(
        "ai.generate user=%s theme=%r difficulty=%d count=%d lang=%s",
        g.current_user_id, theme, difficulty, question_count, language,
    )

    try:
        raw = _call_openai(api_key, prompt)
    except RuntimeError as e:
        logger.error("ai.generate OpenAI call failed: %s", e)
        return error(str(e), 502)
    except (ValueError, json.JSONDecodeError) as e:
        logger.error("ai.generate JSON parse failed: %s", e)
        return error("AI returned an unexpected response format. Please try again.", 502)
    except Exception as e:
        logger.exception("ai.generate unexpected error")
        return error("An unexpected error occurred during generation.", 500)

    questions = _validate_and_normalise(raw, difficulty, category)

    logger.info(
        "ai.generate user=%s theme=%r raw=%d accepted=%d",
        g.current_user_id, theme, len(raw), len(questions),
    )

    return success({
        "theme": theme,
        "difficulty": difficulty,
        "language": language,
        "question_count": len(questions),
        "questions": questions,
    })
