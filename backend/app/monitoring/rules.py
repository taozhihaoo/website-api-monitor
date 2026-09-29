"""Pure check rules: keyword matching and safe JSON path extraction."""

import json
from typing import Any

from app.models.monitor import KEYWORD_MODE_CONTAINS, KEYWORD_MODE_NOT_CONTAINS

RESULT_PASS = "pass"
RESULT_FAIL = "fail"


def evaluate_keyword(body: bytes, keyword: str, mode: str) -> tuple[str, str | None]:
    """Return (result, failure_reason). Matching is case-sensitive by design."""
    text = body.decode("utf-8", errors="replace")
    found = keyword in text
    if mode == KEYWORD_MODE_CONTAINS:
        passed = found
    elif mode == KEYWORD_MODE_NOT_CONTAINS:
        passed = not found
    else:
        return RESULT_FAIL, f"unknown keyword mode: {mode}"
    if passed:
        return RESULT_PASS, None
    return RESULT_FAIL, f"keyword '{keyword}' {mode} check failed"


def extract_json_path(data: Any, path: str) -> tuple[bool, Any]:
    """Safe dot-notation lookup (``a.b.0.c``); list indices must be numeric.

    Never evaluates user input as code. Returns (found, value).
    """
    if path is None:
        return False, None
    parts = path.strip().split(".")
    if not parts or any(part == "" for part in parts):
        return False, None
    current = data
    for part in parts:
        if isinstance(current, list):
            if not part.isdigit():
                return False, None
            index = int(part)
            if index >= len(current):
                return False, None
            current = current[index]
        elif isinstance(current, dict):
            if part not in current:
                return False, None
            current = current[part]
        else:
            return False, None
    return True, current


def _json_value_matches(value: Any, expected: str) -> bool:
    """Compare extracted JSON value with the expected value.

    The expected string is parsed as JSON when possible (so "false" matches
    ``false`` and "3" matches ``3``); otherwise a plain string comparison is used.
    """
    try:
        parsed_expected = json.loads(expected)
    except ValueError:
        if isinstance(value, str):
            return value == expected
        return json.dumps(value) == expected
    return value == parsed_expected


def evaluate_json(
    body: bytes, path: str, expected: str | None
) -> tuple[str, str | None, str | None]:
    """Return (result, failure_reason, extracted_value_repr)."""
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return RESULT_FAIL, "response body is not valid JSON", None
    if not isinstance(data, (dict, list)):
        return RESULT_FAIL, "response JSON is not an object or array", None
    found, value = extract_json_path(data, path)
    if not found:
        return RESULT_FAIL, f"JSON path not found: {path}", None
    if expected is not None and not _json_value_matches(value, expected):
        return RESULT_FAIL, (
            f"JSON value at '{path}' does not match expected value"
        ), None
    return RESULT_PASS, None, None
