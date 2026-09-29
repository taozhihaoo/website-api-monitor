from app.monitoring.rules import evaluate_json, evaluate_keyword, extract_json_path


class TestKeyword:
    def test_contains_pass(self):
        result, reason = evaluate_keyword(
            b"<html>Example Domain</html>", "Example Domain", "contains"
        )
        assert result == "pass" and reason is None

    def test_contains_fail(self):
        result, reason = evaluate_keyword(b"<html>Other</html>", "Example Domain", "contains")
        assert result == "fail" and "Example Domain" in reason

    def test_not_contains_pass(self):
        result, _ = evaluate_keyword(b"clean page", "forbidden", "not_contains")
        assert result == "pass"

    def test_not_contains_fail(self):
        result, _ = evaluate_keyword(b"page with forbidden word", "forbidden", "not_contains")
        assert result == "fail"

    def test_case_sensitive(self):
        result, _ = evaluate_keyword(b"Welcome To Example", "example", "contains")
        assert result == "fail"

    def test_binary_body_does_not_crash(self):
        result, _ = evaluate_keyword(b"\xff\xfe\x00", "Example", "contains")
        assert result == "fail"

    def test_unknown_mode_fails(self):
        result, reason = evaluate_keyword(b"abc", "a", "regex")
        assert result == "fail" and "mode" in reason


class TestJsonPathExtraction:
    def test_simple_key(self):
        found, value = extract_json_path({"a": 1}, "a")
        assert found and value == 1

    def test_nested_path(self):
        data = {"data": {"items": [{"id": 7}, {"id": 9}]}}
        found, value = extract_json_path(data, "data.items.1.id")
        assert found and value == 9

    def test_top_level_array(self):
        found, value = extract_json_path([10, 20, 30], "2")
        assert found and value == 30

    def test_missing_key(self):
        found, _ = extract_json_path({"a": 1}, "b")
        assert not found

    def test_index_out_of_range(self):
        found, _ = extract_json_path({"a": [1]}, "a.5")
        assert not found

    def test_key_access_on_list_rejected(self):
        found, _ = extract_json_path({"a": [1]}, "a.name")
        assert not found

    def test_index_access_on_dict_rejected(self):
        found, _ = extract_json_path({"0": "x"}, "0")
        assert found  # dict key "0" is a valid key lookup

    def test_empty_path(self):
        assert not extract_json_path({"a": 1}, "")[0]

    def test_path_with_double_dot(self):
        assert not extract_json_path({"a": {"b": 1}}, "a..b")[0]

    def test_traversal_through_scalar(self):
        assert not extract_json_path({"a": 1}, "a.b.c")[0]


class TestJsonCheck:
    BODY = b'{"userId": 1, "id": 1, "title": "delectus", "completed": false}'

    def test_path_exists_no_expected(self):
        result, reason, _ = evaluate_json(self.BODY, "completed", None)
        assert result == "pass"

    def test_expected_bool_match(self):
        result, _, _ = evaluate_json(self.BODY, "completed", "false")
        assert result == "pass"

    def test_expected_bool_mismatch(self):
        result, reason, _ = evaluate_json(self.BODY, "completed", "true")
        assert result == "fail" and "does not match" in reason

    def test_expected_number_match(self):
        result, _, _ = evaluate_json(self.BODY, "userId", "1")
        assert result == "pass"

    def test_expected_string_match(self):
        result, _, _ = evaluate_json(self.BODY, "title", "delectus")
        assert result == "pass"

    def test_invalid_json(self):
        result, reason, _ = evaluate_json(b"<html>not json</html>", "a", None)
        assert result == "fail" and "not valid JSON" in reason

    def test_missing_path_fails(self):
        result, reason, _ = evaluate_json(self.BODY, "nope", None)
        assert result == "fail" and "not found" in reason

    def test_json_array_body(self):
        result, _, _ = evaluate_json(b'[{"ok": true}]', "0.ok", "true")
        assert result == "pass"

    def test_scalar_json_body_rejected(self):
        result, _, _ = evaluate_json(b'"just a string"', "a", None)
        assert result == "fail"

    def test_null_value_with_null_expected(self):
        result, _, _ = evaluate_json(b'{"v": null}', "v", "null")
        assert result == "pass"
