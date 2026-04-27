from flask import jsonify


def success(data, status=200):
    return jsonify(data), status


def error(message, status=400):
    return jsonify({"error": message}), status


def serialize_row(row):
    if row is None:
        return None
    result = {}
    for key, value in row.items():
        if hasattr(value, "isoformat"):
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result


def serialize_rows(rows):
    return [serialize_row(r) for r in rows]
