from flask import Blueprint, request, g
from backend.saas.auth.middleware import require_auth
from backend.saas.models.project import (
    create_project,
    get_projects_by_user,
    get_project_by_id,
    update_project,
    delete_project,
    project_owned_by,
)
from backend.saas.utils.validators import is_valid_name
from backend.saas.utils.responses import success, error, serialize_row, serialize_rows
from backend.saas.services.plan_guard import check_can_create_project

bp = Blueprint("projects", __name__, url_prefix="/api/projects")


@bp.post("/")
@require_auth
def create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    valid, msg = is_valid_name(name, "Project name")
    if not valid:
        return error(msg)

    allowed, guard_msg = check_can_create_project(g.current_user_id)
    if not allowed:
        return error(guard_msg, 403)

    project = create_project(g.current_user_id, name)
    return success(serialize_row(project), 201)


@bp.get("/")
@require_auth
def list_all():
    projects = get_projects_by_user(g.current_user_id)
    return success(serialize_rows(projects))


@bp.get("/<project_id>")
@require_auth
def get_one(project_id):
    project = get_project_by_id(project_id)
    if not project or str(project["user_id"]) != g.current_user_id:
        return error("Project not found", 404)
    return success(serialize_row(project))


@bp.patch("/<project_id>")
@require_auth
def update(project_id):
    if not project_owned_by(project_id, g.current_user_id):
        return error("Project not found", 404)

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    valid, msg = is_valid_name(name, "Project name")
    if not valid:
        return error(msg)

    project = update_project(project_id, name)
    return success(serialize_row(project))


@bp.delete("/<project_id>")
@require_auth
def delete(project_id):
    if not project_owned_by(project_id, g.current_user_id):
        return error("Project not found", 404)

    delete_project(project_id)
    return success({"message": "Project deleted"})
