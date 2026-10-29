from __future__ import annotations

import json
import runpy
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from deepseek_harness import RunResult


ROOT = Path(__file__).resolve().parents[3]
SMOKE = runpy.run_path(ROOT / "scripts" / "smoke-python-runtime.py")
CURRENT_SESSION_VERSION = SMOKE["current_session_format_version"]()
NONCURRENT_SESSION_VERSIONS = [
    version for version in (2, 3, 4) if version != CURRENT_SESSION_VERSION
]


def live_result(**overrides: object) -> RunResult:
    values = {
        "session_id": "installed-wheel-live-api",
        "final_response": SMOKE["LIVE_API_SENTINEL"],
        "finish_reason": "completed",
        "events": [{"type": "tool/call", "data": {"name": "unrelated_tool"}}],
        "notifications": [],
    }
    values.update(overrides)
    return RunResult(**values)


@pytest.fixture
def live_smoke(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    import deepseek_harness

    state = SimpleNamespace(
        prompts=[], session_ids=[], challenges=[], checked_logs=[], closed=False,
        create_bytes=SMOKE["LIVE_API_SENTINEL"].encode("utf-8"),
        create_result=live_result(), verify_result=live_result(), receipt_mode="copy",
    )
    globals_ = SMOKE["smoke_sdk_live"].__globals__
    token_hex = globals_["secrets"].token_hex

    def fresh_challenge(size: int) -> str:
        assert len(state.prompts) == 1
        value = token_hex(size)
        state.challenges.append(value)
        return value

    class ScriptedHarness:
        def __init__(self, **kwargs: object) -> None:
            state.root = Path(kwargs["cwd"])
            assert "toolChoice" not in kwargs

        def __enter__(self) -> ScriptedHarness:
            return self

        def __exit__(self, *args: object) -> None:
            state.closed = True

        def run(self, prompt: str, *, session_id: str) -> RunResult:
            state.prompts.append(prompt)
            state.session_ids.append(session_id)
            if len(state.prompts) == 1:
                state.marker = Path(prompt.splitlines()[-1])
                assert state.marker.parent == state.root
                if state.create_bytes is not None:
                    state.marker.write_bytes(state.create_bytes)
                return state.create_result

            assert len(state.prompts) == 2
            assert len(state.challenges) == 1
            challenge = state.challenges[0]
            assert all(challenge not in sent for sent in state.prompts)
            assert str(state.marker) not in prompt
            assert "previous turn" in prompt and "changed externally" in prompt
            assert state.marker.read_bytes() == challenge.encode("ascii")
            receipt = Path(prompt.splitlines()[-1])
            assert receipt != state.marker and not receipt.exists()
            if state.receipt_mode == "copy":
                receipt.write_bytes(state.marker.read_bytes())
            elif state.receipt_mode == "stale":
                receipt.write_bytes(state.create_bytes)
            elif state.receipt_mode == "wrong":
                receipt.write_bytes(b"wrong")
            elif state.receipt_mode == "newline":
                receipt.write_bytes(state.marker.read_bytes() + b"\n")
            elif state.receipt_mode == "changed-source":
                receipt.write_bytes(state.marker.read_bytes())
                state.marker.write_bytes(b"changed")
            elif state.receipt_mode != "missing":
                raise AssertionError(state.receipt_mode)
            return state.verify_result

    monkeypatch.setenv("DEEPSEEK_API_KEY", "unit-test-key")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.invalid")
    monkeypatch.setattr(deepseek_harness, "DeepSeekHarness", ScriptedHarness)
    monkeypatch.setattr(globals_["secrets"], "token_hex", fresh_challenge)
    monkeypatch.setitem(globals_, "assert_zstd_session_log", state.checked_logs.append)
    return state


def test_live_smoke_requires_fresh_external_content(live_smoke: SimpleNamespace) -> None:
    SMOKE["smoke_sdk_live"]()
    assert len(live_smoke.prompts) == 2
    assert live_smoke.session_ids == ["installed-wheel-live-api"] * 2
    assert len(live_smoke.checked_logs) == 1
    assert live_smoke.closed and not live_smoke.root.exists()


@pytest.mark.parametrize("label", ["create", "verify"])
@pytest.mark.parametrize(("overrides", "message"), [
    ({"finish_reason": "error"}, "turn ended with 'error'"),
    ({"finish_reason": "error", "events": [{
        "type": "turn/end", "data": {"turn": 1, "reason": {
            "kind": "error", "error": {"code": "AUTH", "status": 401},
        }},
    }]}, "turn ended with.*AUTH.*401"),
    ({"events": []}, "turn made no model-requested tool call"),
    ({"final_response": "PYTHON_SDK_LIVE_OK extra"}, "turn returned"),
])
def test_live_smoke_rejects_invalid_turn_before_continuing(
    live_smoke: SimpleNamespace, label: str, overrides: dict[str, object], message: str,
) -> None:
    setattr(live_smoke, f"{label}_result", live_result(**overrides))
    with pytest.raises(AssertionError, match=f"{label} {message}"):
        SMOKE["smoke_sdk_live"]()
    assert len(live_smoke.prompts) == (1 if label == "create" else 2)
    assert not live_smoke.checked_logs
    assert live_smoke.closed
    if label == "create":
        assert not live_smoke.challenges


@pytest.mark.parametrize("content", [None, b"wrong", b"PYTHON_SDK_LIVE_OK\n"])
def test_live_smoke_rejects_bad_create_before_host_overwrite(
    live_smoke: SimpleNamespace, content: bytes | None,
) -> None:
    live_smoke.create_bytes = content
    with pytest.raises(AssertionError, match="create turn (did not create|wrote unexpected bytes)"):
        SMOKE["smoke_sdk_live"]()
    assert len(live_smoke.prompts) == 1
    assert not live_smoke.challenges and not live_smoke.checked_logs
    assert live_smoke.closed


@pytest.mark.parametrize(("mode", "message"), [
    ("missing", "did not create receipt"),
    ("stale", "wrote unexpected bytes to receipt"),
    ("wrong", "wrote unexpected bytes to receipt"),
    ("newline", "wrote unexpected bytes to receipt"),
    ("changed-source", "changed source file"),
])
def test_live_smoke_rejects_unrelated_tool_without_exact_receipt(
    live_smoke: SimpleNamespace, mode: str, message: str,
) -> None:
    live_smoke.receipt_mode = mode
    with pytest.raises(AssertionError, match=f"verify turn {message}"):
        SMOKE["smoke_sdk_live"]()
    assert len(live_smoke.prompts) == 2
    assert not live_smoke.checked_logs
    assert live_smoke.closed


@pytest.mark.parametrize(
    ("prompt_name", "expected"),
    [
        ("SNAPSHOT_DIRECT_CHILD_PROMPT", "DIRECT_CHILD_OK"),
        ("SNAPSHOT_WORKFLOW_CHILD_PROMPT", "WORKFLOW_CHILD_OK"),
    ],
)
def test_child_prompt_precedes_runtime_context(prompt_name: str, expected: str) -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": [
                {"type": "text", "text": SMOKE[prompt_name]},
                {"type": "text", "text": "Current runtime context"},
            ]},
        ],
    })

    assert any(
        chunk.get("delta", {}).get("text") == expected
        for chunk in chunks
    )


def test_mcp_smoke_requests_the_discovered_tool() -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [{"role": "user", "content": [{"type": "text", "text": SMOKE["MCP_PROMPT"]}]}],
        "tools": [{"name": "mcp__fixture__add"}],
    })

    call = next(chunk["content_block"] for chunk in chunks if chunk["type"] == "content_block_start")
    assert call["type"] == "tool_use" and call["name"] == "mcp__fixture__add"
    arguments = next(chunk["delta"]["partial_json"] for chunk in chunks if chunk["type"] == "content_block_delta")
    assert json.loads(arguments) == {"a": 19, "b": 23}


def test_mcp_smoke_accepts_the_external_server_result() -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": SMOKE["MCP_PROMPT"]}]},
            {
                "role": "assistant",
                "content": [{
                    "id": "mcp-add", "type": "tool_use",
                    "name": "mcp__fixture__add", "input": {},
                }],
            },
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "mcp-add", "content": "42"}]},
        ],
    })

    assert any(
        chunk.get("delta", {}).get("text") == SMOKE["MCP_TEXT"]
        for chunk in chunks
    )


def test_advanced_snapshot_normalizes_catalog_child_creation_time() -> None:
    value = {
        "type": "subagent/catalog",
        "data": {
            "childCreatedAt": 1788246207176,
        },
    }

    assert SMOKE["normalize_snapshot_value"](value, []) == {
        "type": "subagent/catalog",
        "data": {
            "childCreatedAt": 0,
        },
    }

    assert SMOKE["normalize_snapshot_value"](
        {"type": "fixture/event", "data": {"childCreatedAt": 1788246207176}},
        [],
    ) == {"type": "fixture/event", "data": {"childCreatedAt": 1788246207176}}


def test_snapshot_comparison_preserves_opaque_generation_provenance() -> None:
    normalize = SMOKE["normalize_session_format_comparison"]
    expected = {
        "header": {"type": "session", "version": 0, "otherVersion": 7},
        "accepted": {
            "type": "session-log-deepseek/delivery-accepted",
            "data": {"sessionId": "s", "throughSeq": 4},
        },
        "source": {
            "kind": "session-reference",
            "references": [{"sessionId": "other", "capturedThroughSeq": 8}],
        },
    }
    actual = {
        "header": {"type": "session", "version": 1, "otherVersion": 7},
        "accepted": {
            "type": "session-log-deepseek/delivery-accepted",
            "data": {"sessionId": "s", "sessionFormatVersion": 1, "throughSeq": 4},
        },
        "source": {
            "kind": "session-reference",
            "references": [{
                "sessionId": "other",
                "capturedFormatVersion": 1,
                "capturedThroughSeq": 8,
            }],
        },
    }

    assert normalize(expected) != normalize(actual)
    assert normalize(expected)["header"] == normalize(actual)["header"]
    assert normalize(expected)["header"]["otherVersion"] == 7
    assert normalize(actual)["accepted"] == actual["accepted"]
    assert normalize(actual)["source"] == actual["source"]


def test_snapshot_value_scrubs_system_nodes_without_erasing_header_fields() -> None:
    normalize = SMOKE["normalize_snapshot_value"]
    system = {
        "type": "system/message",
        "data": {"message": {"role": "system", "content": [{"type": "text", "text": "prompt"}]}},
    }
    header = {"type": "request/header", "data": {"header": {"system": "unexpected"}}}
    assert normalize(system, [])["data"]["message"]["content"] == [{"type": "text", "text": "{{system}}"}]
    assert normalize(header, []) == header
    empty = {"type": "system/message", "data": {"message": {"role": "system", "content": []}}}
    assert normalize(empty, []) == empty


def test_snapshot_value_normalizes_embedded_assistant_stream_timing() -> None:
    normalize = SMOKE["normalize_snapshot_value"]
    event = {
        "type": "assistant/message",
        "seq": 4,
        "time": 100,
        "data": {
            "stream": [
                {"type": "chunk", "time": 101, "chunk": {"type": "finish"}},
                {"type": "text-chunks", "time0": 102, "dt": [1, 2], "texts": ["a", "b", "c"]},
            ],
        },
    }

    normalized = normalize(event, [])

    assert normalized["time"] == 0
    assert normalized["data"]["stream"] == [
        {"type": "chunk", "time": 0, "chunk": {"type": "finish"}},
        {"type": "text-chunks", "time0": 0, "dt": [0, 0], "texts": ["a", "b", "c"]},
    ]


def test_snapshot_comparison_expands_embedded_assistant_streams() -> None:
    normalize = SMOKE["normalize_session_format_comparison"]
    expected = [
        {
            "type": "assistant/chunk",
            "seq": 4,
            "time": 0,
            "data": {"turn": 1, "step": 1, "chunk": {
                "type": "text-delta", "index": 0, "text": "done",
            }},
        },
        {
            "type": "assistant/message",
            "seq": 5,
            "time": 0,
            "data": {"turn": 1, "step": 1, "message": {"role": "assistant"}},
            "sourceEventSeqs": [4],
            "surfaceOp": "append",
        },
    ]
    actual = [{
        "type": "assistant/message",
        "seq": 4,
        "time": 0,
        "data": {
            "turn": 1,
            "step": 1,
            "message": {"role": "assistant"},
            "stream": [{
                "type": "text-chunks", "time0": 0, "index": 0, "dt": [], "texts": ["done"],
            }],
        },
        "surfaceOp": "append",
    }]

    assert normalize(actual, 2) == normalize(expected, 1)

    tool_result = {
        "type": "tool/result",
        "data": {"turn": 1, "step": 1},
        "sourceEventSeqs": [4],
    }
    assert normalize(tool_result, 1)["sourceEventSeqs"] == [4]
    assert normalize(tool_result, 2)["sourceEventSeqs"] == [4]


def test_snapshot_stream_expands_reasoning_and_tool_call_records() -> None:
    expand = SMOKE["expand_snapshot_stream_member"]

    assert expand({
        "type": "reasoning-chunks", "time0": 0, "index": 1,
        "dt": [], "texts": ["think"],
    }) == [{"type": "reasoning-delta", "index": 1, "text": "think"}]
    assert expand({
        "type": "tool-call-chunks", "time0": 0, "index": 2,
        "id": "call-1", "name": "read", "dt": [1], "args": ["{", "}"],
    }) == [
        {"type": "tool-call-delta", "index": 2, "id": "call-1", "name": "read", "argumentsDelta": "{"},
        {"type": "tool-call-delta", "index": 2, "id": "call-1", "name": "read", "argumentsDelta": "}"},
    ]


def test_snapshot_file_builder_order_is_checked_outside_update_mode(tmp_path: Path) -> None:
    compare = SMOKE["compare_snapshot_files"]

    with pytest.raises(AssertionError, match="snapshot builder produced"):
        compare({}, False, tmp_path, ("result.json",))


def test_snapshot_comparison_expands_sdk_wrapped_attempts() -> None:
    normalize = SMOKE["normalize_session_format_comparison"]
    actual = [{
        "method": "session.event",
        "payload": {
            "sessionId": "s",
            "event": {
                "type": "assistant/attempt",
                "seq": 7,
                "time": 0,
                "data": {
                    "turn": 1,
                    "step": 1,
                    "stream": [{"type": "chunk", "time": 0, "chunk": {"type": "finish"}}],
                },
            },
        },
    }]

    assert normalize(actual) == [{
        "method": "session.event",
        "payload": {
            "sessionId": "s",
            "event": {
                "type": "assistant/chunk",
                "data": {"turn": 1, "step": 1, "chunk": {"type": "finish"}},
            },
        },
    }]


def test_snapshot_generation_names_select_highest_role_without_double_counting(
    tmp_path: Path,
) -> None:
    render = SMOKE["snapshot_session_filename"]
    select = SMOKE["selected_snapshot_session_files"]
    assert render(0, 0) == "session.jsonl"
    assert render(0, 2) == "session.v2.jsonl"
    assert render(3, 0) == "session.3.jsonl"
    assert render(3, 2) == "session.3.v2.jsonl"

    (tmp_path / "session.jsonl").write_text(
        '{"type":"session","version":0}\n', encoding="utf-8",
    )
    (tmp_path / "session.v1.jsonl").write_text(
        '{"type":"session","version":1}\n', encoding="utf-8",
    )
    (tmp_path / "session.1.jsonl").write_text(
        '{"type":"session","version":0}\n', encoding="utf-8",
    )

    assert {index: path.name for index, path in select(tmp_path).items()} == {
        0: "session.v1.jsonl",
        1: "session.1.jsonl",
    }


def test_snapshot_comparison_accepts_current_output_against_predecessor_without_rewriting(
    tmp_path: Path,
) -> None:
    predecessor_version = CURRENT_SESSION_VERSION - 1
    predecessor = json.dumps({"type": "session", "version": predecessor_version}) + "\n"
    successor = json.dumps({"type": "session", "version": CURRENT_SESSION_VERSION}) + "\n"
    old_name = f"session.v{predecessor_version}.jsonl"
    new_name = f"session.v{CURRENT_SESSION_VERSION}.jsonl"
    old_path = tmp_path / old_name
    old_path.write_text(predecessor, encoding="utf-8")
    files = {new_name: successor}

    SMOKE["compare_snapshot_files"](files, False, tmp_path, (old_name,))
    assert old_path.read_text(encoding="utf-8") == predecessor
    assert not (tmp_path / new_name).exists()

    SMOKE["compare_snapshot_files"](files, True, tmp_path, (old_name,))
    assert old_path.read_text(encoding="utf-8") == predecessor
    assert (tmp_path / new_name).read_text(encoding="utf-8") == successor
    assert SMOKE["selected_snapshot_session_files"](tmp_path) == {0: tmp_path / new_name}


@pytest.mark.parametrize("filenames", [
    ("session.1.v2.jsonl", "session.v2.jsonl"),
    ("session.v2.jsonl",),
    ("session.v2.jsonl", "session.2.v2.jsonl"),
])
def test_snapshot_builder_checks_role_order_and_count_across_generations(
    tmp_path: Path, filenames: tuple[str, ...],
) -> None:
    files = {"session.v3.jsonl": "", "session.1.v3.jsonl": ""}
    with pytest.raises(AssertionError, match="snapshot builder produced"):
        SMOKE["compare_snapshot_files"](files, False, tmp_path, filenames)


def test_snapshot_generation_comparison_rejects_changed_payload(tmp_path: Path) -> None:
    (tmp_path / "session.v2.jsonl").write_text(
        '{"type":"session","version":2,"id":"expected"}\n', encoding="utf-8",
    )
    current = CURRENT_SESSION_VERSION
    with pytest.raises(AssertionError, match="executable snapshot mismatch"):
        SMOKE["compare_snapshot_files"](
            {
                f"session.v{current}.jsonl":
                    json.dumps({"type": "session", "version": current, "id": "changed"}) + "\n",
            },
            False, tmp_path, ("session.v2.jsonl",),
        )


@pytest.mark.parametrize("version", NONCURRENT_SESSION_VERSIONS)
@pytest.mark.parametrize("update", [False, True])
def test_snapshot_comparison_rejects_noncurrent_writer(
    tmp_path: Path, version: int, update: bool,
) -> None:
    golden = '{"type":"session","version":2}\n'
    (tmp_path / "session.v2.jsonl").write_text(golden, encoding="utf-8")
    content = json.dumps({"type": "session", "version": version}) + "\n"
    with pytest.raises(
        AssertionError,
        match=f"expected current Session format v{CURRENT_SESSION_VERSION}",
    ):
        SMOKE["compare_snapshot_files"](
            {f"session.v{version}.jsonl": content}, update, tmp_path, ("session.v2.jsonl",),
        )
    assert (tmp_path / "session.v2.jsonl").read_text(encoding="utf-8") == golden
    assert sorted(path.name for path in tmp_path.iterdir()) == ["session.v2.jsonl"]


@pytest.mark.parametrize("version", [2, 3, 4])
def test_persisted_session_requires_current_writer(version: int) -> None:
    content = json.dumps({"type": "session", "version": version}) + "\n"
    path = Path(f"session.v{version}.jsonl")
    if version == CURRENT_SESSION_VERSION:
        assert SMOKE["assert_persisted_session_version"](path, content) == version
    else:
        with pytest.raises(
            AssertionError,
            match=f"expected current Session format v{CURRENT_SESSION_VERSION}",
        ):
            SMOKE["assert_persisted_session_version"](path, content)


def test_snapshot_generation_filename_must_match_header(tmp_path: Path) -> None:
    (tmp_path / "session.v1.jsonl").write_text(
        '{"type":"session","version":0}\n', encoding="utf-8",
    )

    with pytest.raises(AssertionError, match="filename declares Session format v1"):
        SMOKE["selected_snapshot_session_files"](tmp_path)


@pytest.mark.parametrize("returncode", [1, -1073741819, 3221225477])
def test_profile_plugin_failure_reports_native_exit_status(monkeypatch: pytest.MonkeyPatch, returncode: int) -> None:
    def failed_install(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args=[], returncode=returncode, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", failed_install)
    with pytest.raises(AssertionError) as error:
        SMOKE["smoke_sdk_profile_plugin"]("http://127.0.0.1:1")
    message = str(error.value)
    assert f"returncode={returncode}" in message
    assert f"0x{returncode & 0xffffffff:08x}" in message
    assert "stdout='' stderr=''" in message


def test_snapshot_replaces_only_the_owned_native_and_json_escaped_directory() -> None:
    cwd = r"C:\Users\fixture\scratch"
    text = f'plain: {cwd}; quoted: {json.dumps(cwd)}; other: C:\\Users\\other'
    assert SMOKE["replace_snapshot_tokens"](text, [(cwd, "{{cwd}}")]) == (
        'plain: {{cwd}}; quoted: "{{cwd}}"; other: C:\\Users\\other'
    )


def test_tool_message_identity_is_volatile_but_call_identity_and_content_are_preserved() -> None:
    event = {"type": "tool/result", "data": {"message": {
        "role": "tool", "id": "generated-message", "source": {"kind": "tool", "callId": "model-call"},
        "toolCallId": "model-call",
        "content": [{"type": "text", "text": "actual tool output"}],
    }}}
    result = SMOKE["normalize_snapshot_value"](event, [])
    assert result["data"]["message"] == {
        **event["data"]["message"], "id": "{{messageId}}",
    }
    assert event["data"]["message"]["id"] == "generated-message"
    assert SMOKE["normalize_snapshot_value"]({"id": "business-id", "role": "record"}, []) == {
        "id": "business-id", "role": "record",
    }
    assert SMOKE["normalize_snapshot_value"]({"id": "business-tool-id", "role": "tool"}, []) == {
        "id": "business-tool-id", "role": "tool",
    }


def test_ptc_uses_the_latest_sdk_and_rejects_extra_direct_tools() -> None:
    body = {
        "tools": [{"name": "run_code"}],
        "system": "interface ToolArgsMap {\n  removed_tool: {};\n}",
        "messages": [{"role": "system", "content": [{
            "type": "text", "text": "interface ToolArgsMap {\n  current_tool: {};\n}",
        }]}],
    }
    assert SMOKE["ptc_capability_names"](body) == {"current_tool"}
    with pytest.raises(AssertionError, match="did not declare removed_tool"):
        SMOKE["assert_ptc_capability"](body, "removed_tool")
    body["tools"].append({"name": "current_tool"})
    with pytest.raises(AssertionError, match="unexpected direct tools"):
        SMOKE["ptc_capability_names"](body)


def test_worker_error_containing_the_expected_digits_is_not_a_success() -> None:
    body = {"messages": [
        {"role": "assistant", "content": [{
            "type": "tool_use", "id": "call-code-worker", "name": "run_code", "input": {},
        }]},
        {"role": "user", "content": [{
            "type": "tool_result", "tool_use_id": "call-code-worker",
            "content": [{"type": "text", "text": 'Error: profile "134217728" does not exist'}],
        }]},
    ]}
    with pytest.raises(AssertionError, match="worker returned no expected value"):
        SMOKE["completion_chunks"](body)
    body["messages"][1]["content"][0]["content"][0]["text"] = "42"
    events = SMOKE["completion_chunks"](body)
    assert any(event.get("delta", {}).get("text") == SMOKE["CODE_WORKER_TEXT"] for event in events)


@pytest.mark.parametrize("in_history", [False, True])
def test_external_plugin_marker_is_required_in_the_messages_system_prompt(in_history: bool) -> None:
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": SMOKE["PROFILE_PLUGIN_PROMPT"]}]}]}
    with pytest.raises(AssertionError, match="contributed no model-visible marker"):
        SMOKE["completion_chunks"](body)
    if in_history:
        body["messages"].insert(0, {"role": "system", "content": [{"type": "text", "text": SMOKE["PROFILE_PLUGIN_MARKER"]}]})
    else:
        body["system"] = SMOKE["PROFILE_PLUGIN_MARKER"]
    assert any(event.get("delta", {}).get("text") == SMOKE["PROFILE_PLUGIN_TEXT"] for event in SMOKE["completion_chunks"](body))
