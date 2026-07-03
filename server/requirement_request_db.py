import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_FIELDS = [
    "exam_name",
    "formal_exam_time_range",
    "mock_exam_time_range",
    "early_login_minutes",
    "late_limit_minutes",
    "video_monitor_required",
    "video_record_required",
    "hawkeye_required",
    "exam_client_type",
    "subjects",
]

STATUS_READY_FOR_MANUAL_EXECUTION = "ready_for_manual_execution"
STATUS_LINKED_TO_EXECUTION_TASK = "linked_to_execution_task"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def loads(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def normalize_bool(value):
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if text in {"是", "需要", "启用", "开启", "true", "yes", "y", "1"}:
        return True
    if text in {"否", "不需要", "禁用", "关闭", "false", "no", "n", "0"}:
        return False
    return value


def normalize_minutes(value):
    if value is None or value == "":
        return value
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"\d+", str(value))
    return int(match.group(0)) if match else value


def normalize_exam_type(value):
    text = str(value or "").strip()
    if text in {"网页考试", "web", "WEB", "Web"}:
        return "web"
    if text in {"客户端考试", "锁定考试", "client", "CLIENT", "Client"}:
        return "client"
    return text


def normalize_subjects(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    parts = re.split(r"[,，、;\n\r]+", str(value or ""))
    return [part.strip() for part in parts if part.strip()]


def normalize_text_list(value):
    if value is None or value == "":
        return []
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r"[\n\r]+", str(value))
    return [str(item).strip(" \t-•、;；") for item in raw_items if str(item).strip(" \t-•、;；")]


def build_customer_clarification_prompt(message="", questions=None, request_id=""):
    questions = normalize_text_list(questions)
    intro = str(message or "人工审核后需要补充信息").strip()
    prefix = f"需求编号：{request_id}\n" if request_id else ""
    if not questions:
        return f"{prefix}{intro}"
    lines = ["请补充以下信息："]
    lines.extend(f"{index}. {question}" for index, question in enumerate(questions, start=1))
    return f"{prefix}{intro}\n" + "\n".join(lines)


def normalize_requirement(payload):
    source = dict(payload or {})
    result = {}
    for key, value in source.items():
        result[key] = value
    result.setdefault("watermark_enabled", True)
    result.setdefault("copy_forbidden", True)
    for key in ["early_login_minutes", "late_limit_minutes", "leave_limit_count"]:
        if key in result:
            result[key] = normalize_minutes(result.get(key))
    for key in [
        "video_monitor_required",
        "video_record_required",
        "hawkeye_required",
        "watermark_enabled",
        "copy_forbidden",
        "candidate_template_required",
    ]:
        if key in result:
            result[key] = normalize_bool(result.get(key))
    if "exam_client_type" in result:
        result["exam_client_type"] = normalize_exam_type(result.get("exam_client_type"))
    if "subjects" in result:
        result["subjects"] = normalize_subjects(result.get("subjects"))
    if "subjects_text" in result and not result.get("subjects"):
        result["subjects"] = normalize_subjects(result.get("subjects_text"))
    return result


def validate_requirement(requirement):
    missing = []
    errors = []
    for field in REQUIRED_FIELDS:
        value = requirement.get(field)
        if value is None or value == "" or value == []:
            missing.append(field)
    if requirement.get("exam_client_type") == "web" and not requirement.get("leave_limit_count"):
        missing.append("leave_limit_count")
    for field in ["early_login_minutes", "late_limit_minutes", "leave_limit_count"]:
        if field in requirement and requirement.get(field) not in (None, ""):
            if not isinstance(requirement.get(field), int):
                errors.append({"field": field, "message": "必须是分钟数或整数"})
    return sorted(set(missing)), errors


class RequirementStore:
    def __init__(self, db_path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def connect(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_schema(self):
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS requirement_requests (
                    request_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '未命名考试需求',
                    status TEXT NOT NULL DEFAULT 'collecting',
                    customer_json TEXT NOT NULL DEFAULT '{}',
                    linked_task_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS requirement_versions (
                    request_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    source TEXT NOT NULL DEFAULT '',
                    message TEXT NOT NULL DEFAULT '',
                    requirement_json TEXT NOT NULL DEFAULT '{}',
                    missing_fields_json TEXT NOT NULL DEFAULT '[]',
                    validation_errors_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(request_id, version),
                    FOREIGN KEY(request_id) REFERENCES requirement_requests(request_id)
                );
                CREATE TABLE IF NOT EXISTS requirement_confirmations (
                    confirmation_id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL,
                    customer_reply TEXT NOT NULL DEFAULT '',
                    conversation_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(request_id) REFERENCES requirement_requests(request_id)
                );
                CREATE TABLE IF NOT EXISTS requirement_change_requests (
                    change_id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending_internal_review',
                    customer_message TEXT NOT NULL DEFAULT '',
                    changes_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(request_id) REFERENCES requirement_requests(request_id)
                );
                CREATE TABLE IF NOT EXISTS requirement_events (
                    event_id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(request_id) REFERENCES requirement_requests(request_id)
                );
                """
            )

    def create_or_update_requirement(self, customer=None, requirement=None, message="", request_id=None, source="dify", analysis_candidates=None):
        request_id = request_id or str(uuid.uuid4())
        now = utc_now()
        normalized = normalize_requirement(requirement or {})
        missing, errors = validate_requirement(normalized)
        status = "collecting" if missing or errors else "pending_internal_review"
        title = str(normalized.get("exam_name") or "未命名考试需求")
        customer_json = json.dumps(customer or {}, ensure_ascii=False)
        with self.connect() as db:
            current = db.execute(
                "SELECT * FROM requirement_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            if not current:
                db.execute(
                    """INSERT INTO requirement_requests
                    (request_id, title, status, customer_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                    (request_id, title, status, customer_json, now, now),
                )
                next_version = 1
            else:
                customer_payload = customer_json if customer is not None else current["customer_json"]
                latest = db.execute(
                    "SELECT MAX(version) AS version FROM requirement_versions WHERE request_id=?",
                    (request_id,),
                ).fetchone()
                next_version = int(latest["version"] or 0) + 1
                db.execute(
                    """UPDATE requirement_requests
                    SET title=?, status=?, customer_json=?, updated_at=? WHERE request_id=?""",
                    (title, status, customer_payload, now, request_id),
                )
            db.execute(
                """INSERT INTO requirement_versions
                (request_id, version, source, message, requirement_json, missing_fields_json,
                 validation_errors_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    request_id,
                    next_version,
                    source or "",
                    message or "",
                    json.dumps(normalized, ensure_ascii=False),
                    json.dumps(missing, ensure_ascii=False),
                    json.dumps(errors, ensure_ascii=False),
                    now,
                ),
            )
            self._record_event(db, request_id, "requirement_upserted", source, {
                "version": next_version,
                "status": status,
                "missingFields": missing,
            })
            if analysis_candidates:
                self._record_event(db, request_id, "analysis_candidate_recorded", source, {
                    "analysisCandidates": analysis_candidates,
                    "version": next_version,
                })
        return self.get_requirement(request_id)

    def list_requirements(self):
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM requirement_requests ORDER BY updated_at DESC"
            ).fetchall()
        return [self._summary(row) for row in rows]

    def get_requirement(self, request_id):
        with self.connect() as db:
            request = db.execute(
                "SELECT * FROM requirement_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            if not request:
                return None
            versions = db.execute(
                "SELECT * FROM requirement_versions WHERE request_id=? ORDER BY version",
                (request_id,),
            ).fetchall()
            confirmations = db.execute(
                "SELECT * FROM requirement_confirmations WHERE request_id=? ORDER BY created_at DESC",
                (request_id,),
            ).fetchall()
            changes = db.execute(
                "SELECT * FROM requirement_change_requests WHERE request_id=? ORDER BY created_at DESC",
                (request_id,),
            ).fetchall()
            events = db.execute(
                "SELECT * FROM requirement_events WHERE request_id=? ORDER BY created_at DESC",
                (request_id,),
            ).fetchall()
        detail = self._summary(request)
        detail["versions"] = [self._version(row) for row in versions]
        detail["latest"] = detail["versions"][-1] if detail["versions"] else None
        detail["confirmations"] = [self._confirmation(row) for row in confirmations]
        detail["changeRequests"] = [self._change_request(row) for row in changes]
        detail["events"] = [self._event(row) for row in events]
        return detail

    def record_customer_confirmation(self, request_id, customer_reply, conversation_id=""):
        now = utc_now()
        with self.connect() as db:
            self._require_request(db, request_id)
            db.execute(
                """INSERT INTO requirement_confirmations
                (confirmation_id, request_id, customer_reply, conversation_id, created_at)
                VALUES (?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), request_id, customer_reply or "", conversation_id or "", now),
            )
            db.execute(
                "UPDATE requirement_requests SET status='customer_confirmed', updated_at=? WHERE request_id=?",
                (now, request_id),
            )
            self._record_event(db, request_id, "customer_confirmed", "customer", {
                "conversationId": conversation_id or "",
            })
        return self.get_requirement(request_id)

    def request_customer_clarification(self, request_id, reviewer="", message="", questions=None, missing_fields=None):
        questions = normalize_text_list(questions)
        missing_fields = normalize_text_list(missing_fields)
        customer_prompt = build_customer_clarification_prompt(message, questions, request_id)
        return self._set_status(
            request_id,
            "need_customer_clarification",
            "customer_clarification_requested",
            reviewer or "staff",
            {
                "message": message or "",
                "questions": questions,
                "missingFields": missing_fields,
                "customerPrompt": customer_prompt,
            },
        )

    def mark_reviewed_waiting_customer_confirmation(self, request_id, reviewer="", message=""):
        return self._set_status(
            request_id,
            "reviewed_waiting_customer_confirmation",
            "reviewed_waiting_customer_confirmation",
            reviewer or "staff",
            {"message": message or ""},
        )

    def create_change_request(self, request_id, customer_message="", changes=None, analysis_candidates=None):
        now = utc_now()
        normalized_message = str(customer_message or "").strip()
        normalized_changes = normalize_requirement(changes or {})
        with self.connect() as db:
            self._require_request(db, request_id)
            pending_matches = db.execute(
                """SELECT changes_json FROM requirement_change_requests
                WHERE request_id=? AND status='pending_internal_review' AND customer_message=?""",
                (request_id, normalized_message),
            ).fetchall()
            duplicate = any(
                normalize_requirement(loads(row["changes_json"], {})) == normalized_changes
                for row in pending_matches
            )
            if not duplicate:
                db.execute(
                    """INSERT INTO requirement_change_requests
                    (change_id, request_id, status, customer_message, changes_json, created_at)
                    VALUES (?, ?, 'pending_internal_review', ?, ?, ?)""",
                    (
                        str(uuid.uuid4()),
                        request_id,
                        normalized_message,
                        json.dumps(normalized_changes, ensure_ascii=False),
                        now,
                    ),
                )
                db.execute(
                    "UPDATE requirement_requests SET status='change_requested', updated_at=? WHERE request_id=?",
                    (now, request_id),
                )
                self._record_event(db, request_id, "change_requested", "customer", {
                    "message": normalized_message,
                })
                if analysis_candidates:
                    self._record_event(db, request_id, "analysis_candidate_recorded", "wechat_llm", {
                        "analysisCandidates": analysis_candidates,
                        "changeMessage": normalized_message,
                    })
        return self.get_requirement(request_id)

    def accept_change_request(self, request_id, change_id, reviewer="", message=""):
        now = utc_now()
        with self.connect() as db:
            request = self._require_request(db, request_id)
            change = self._require_change_request(db, request_id, change_id)
            if change["status"] != "pending_internal_review":
                raise ValueError("Change request is not pending internal review")
            changes = loads(change["changes_json"], {})
            latest = db.execute(
                "SELECT * FROM requirement_versions WHERE request_id=? ORDER BY version DESC LIMIT 1",
                (request_id,),
            ).fetchone()
            base_requirement = loads(latest["requirement_json"], {}) if latest else {}
            next_requirement = self._requirement_from_change(base_requirement, changes)
            normalized = normalize_requirement(next_requirement)
            missing, errors = validate_requirement(normalized)
            next_version_row = db.execute(
                "SELECT MAX(version) AS version FROM requirement_versions WHERE request_id=?",
                (request_id,),
            ).fetchone()
            next_version = int(next_version_row["version"] or 0) + 1
            status = "collecting" if missing or errors else "pending_internal_review"
            title = str(normalized.get("exam_name") or request["title"] or "未命名考试需求")
            db.execute(
                """INSERT INTO requirement_versions
                (request_id, version, source, message, requirement_json, missing_fields_json,
                 validation_errors_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    request_id,
                    next_version,
                    "staff_change_acceptance",
                    message or change["customer_message"] or "",
                    json.dumps(normalized, ensure_ascii=False),
                    json.dumps(missing, ensure_ascii=False),
                    json.dumps(errors, ensure_ascii=False),
                    now,
                ),
            )
            db.execute(
                "UPDATE requirement_change_requests SET status='accepted' WHERE request_id=? AND change_id=?",
                (request_id, change_id),
            )
            pending = db.execute(
                """SELECT COUNT(*) AS count FROM requirement_change_requests
                WHERE request_id=? AND status='pending_internal_review'""",
                (request_id,),
            ).fetchone()
            if int(pending["count"] or 0) > 0:
                status = "change_requested"
            db.execute(
                "UPDATE requirement_requests SET title=?, status=?, updated_at=? WHERE request_id=?",
                (title, status, now, request_id),
            )
            self._record_event(db, request_id, "change_request_accepted", reviewer or "staff", {
                "changeId": change_id,
                "version": next_version,
                "message": message or "",
            })
        return self.get_requirement(request_id)

    def reject_change_request(self, request_id, change_id, reviewer="", reason=""):
        now = utc_now()
        with self.connect() as db:
            self._require_request(db, request_id)
            change = self._require_change_request(db, request_id, change_id)
            if change["status"] != "pending_internal_review":
                raise ValueError("Change request is not pending internal review")
            db.execute(
                "UPDATE requirement_change_requests SET status='rejected' WHERE request_id=? AND change_id=?",
                (request_id, change_id),
            )
            pending = db.execute(
                """SELECT COUNT(*) AS count FROM requirement_change_requests
                WHERE request_id=? AND status='pending_internal_review'""",
                (request_id,),
            ).fetchone()
            if int(pending["count"] or 0) == 0:
                db.execute(
                    "UPDATE requirement_requests SET status='pending_internal_review', updated_at=? WHERE request_id=?",
                    (now, request_id),
                )
            else:
                db.execute(
                    "UPDATE requirement_requests SET updated_at=? WHERE request_id=?",
                    (now, request_id),
                )
            self._record_event(db, request_id, "change_request_rejected", reviewer or "staff", {
                "changeId": change_id,
                "reason": reason or "",
            })
        return self.get_requirement(request_id)

    def mark_ready_to_create_task(self, request_id, reviewer=""):
        return self.mark_ready_for_manual_execution(request_id, reviewer)

    def mark_ready_for_manual_execution(self, request_id, reviewer=""):
        with self.connect() as db:
            request = self._require_request(db, request_id)
            if request["status"] != "customer_confirmed":
                raise ValueError("Requirement must be customer confirmed before manual execution handoff")
        return self._set_status(
            request_id,
            STATUS_READY_FOR_MANUAL_EXECUTION,
            "ready_for_manual_execution",
            reviewer,
        )

    def link_task(self, request_id, task_id):
        if not task_id:
            raise ValueError("task_id is required")
        now = utc_now()
        with self.connect() as db:
            request = self._require_request(db, request_id)
            if request["status"] != STATUS_READY_FOR_MANUAL_EXECUTION:
                raise ValueError("Requirement must be ready for manual execution before linking a task")
            db.execute(
                """UPDATE requirement_requests
                SET status=?, linked_task_id=?, updated_at=? WHERE request_id=?""",
                (STATUS_LINKED_TO_EXECUTION_TASK, task_id, now, request_id),
            )
            self._record_event(db, request_id, "execution_task_linked", "staff", {"taskId": task_id})
        return self.get_requirement(request_id)

    def _set_status(self, request_id, status, event_type, actor="", payload=None):
        now = utc_now()
        with self.connect() as db:
            self._require_request(db, request_id)
            db.execute(
                "UPDATE requirement_requests SET status=?, updated_at=? WHERE request_id=?",
                (status, now, request_id),
            )
            event_payload = {"status": status}
            event_payload.update(payload or {})
            self._record_event(db, request_id, event_type, actor or "staff", event_payload)
        return self.get_requirement(request_id)

    def _require_request(self, db, request_id):
        row = db.execute(
            "SELECT * FROM requirement_requests WHERE request_id=?", (request_id,)
        ).fetchone()
        if not row:
            raise ValueError("Requirement request not found")
        return row

    def _require_change_request(self, db, request_id, change_id):
        row = db.execute(
            "SELECT * FROM requirement_change_requests WHERE request_id=? AND change_id=?",
            (request_id, change_id),
        ).fetchone()
        if not row:
            raise ValueError("Change request not found")
        return row

    def _requirement_from_change(self, base_requirement, changes):
        if isinstance(changes, dict) and isinstance(changes.get("latestRequirement"), dict):
            return changes["latestRequirement"]
        merged = dict(base_requirement or {})
        if isinstance(changes, dict):
            for key, value in changes.items():
                if key in {"changeRecords", "attachments"}:
                    continue
                merged[key] = value
        return merged

    def _record_event(self, db, request_id, event_type, actor, payload):
        db.execute(
            """INSERT INTO requirement_events
            (event_id, request_id, event_type, actor, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                request_id,
                event_type,
                actor or "",
                json.dumps(payload or {}, ensure_ascii=False),
                utc_now(),
            ),
        )

    def _summary(self, row):
        return {
            "requestId": row["request_id"],
            "title": row["title"],
            "status": row["status"],
            "customer": loads(row["customer_json"], {}),
            "linkedTaskId": row["linked_task_id"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def _version(self, row):
        return {
            "version": row["version"],
            "source": row["source"],
            "message": row["message"],
            "requirement": loads(row["requirement_json"], {}),
            "missingFields": loads(row["missing_fields_json"], []),
            "validationErrors": loads(row["validation_errors_json"], []),
            "createdAt": row["created_at"],
        }

    def _confirmation(self, row):
        return {
            "confirmationId": row["confirmation_id"],
            "customerReply": row["customer_reply"],
            "conversationId": row["conversation_id"],
            "createdAt": row["created_at"],
        }

    def _change_request(self, row):
        return {
            "changeId": row["change_id"],
            "status": row["status"],
            "customerMessage": row["customer_message"],
            "changes": loads(row["changes_json"], {}),
            "createdAt": row["created_at"],
        }

    def _event(self, row):
        return {
            "eventId": row["event_id"],
            "eventType": row["event_type"],
            "actor": row["actor"],
            "payload": loads(row["payload_json"], {}),
            "createdAt": row["created_at"],
        }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: requirement_request_db.py DB_PATH ACTION")
    store = RequirementStore(sys.argv[1])
    action = sys.argv[2]
    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    if action == "upsert":
        result = store.create_or_update_requirement(
            customer=payload.get("customer"),
            requirement=payload.get("requirement"),
            message=payload.get("message", ""),
            request_id=payload.get("requestId") or payload.get("request_id"),
            source=payload.get("source", "dify"),
            analysis_candidates=payload.get("analysisCandidates") or payload.get("analysis_candidates"),
        )
    elif action == "list":
        result = store.list_requirements()
    elif action == "get":
        result = store.get_requirement(payload.get("requestId") or payload.get("request_id"))
    elif action == "confirm":
        result = store.record_customer_confirmation(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("customerReply") or payload.get("customer_reply") or "",
            payload.get("conversationId") or payload.get("conversation_id") or "",
        )
    elif action == "change":
        result = store.create_change_request(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("customerMessage") or payload.get("customer_message") or "",
            payload.get("changes") or {},
            payload.get("analysisCandidates") or payload.get("analysis_candidates"),
        )
    elif action == "accept_change":
        result = store.accept_change_request(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("changeId") or payload.get("change_id"),
            payload.get("reviewer") or "",
            payload.get("message") or "",
        )
    elif action == "reject_change":
        result = store.reject_change_request(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("changeId") or payload.get("change_id"),
            payload.get("reviewer") or "",
            payload.get("reason") or payload.get("message") or "",
        )
    elif action == "mark_ready":
        result = store.mark_ready_to_create_task(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("reviewer") or "",
        )
    elif action == "request_clarification":
        result = store.request_customer_clarification(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("reviewer") or "",
            payload.get("message") or "",
            payload.get("questions") or [],
            payload.get("missingFields") or payload.get("missing_fields") or [],
        )
    elif action == "mark_reviewed":
        result = store.mark_reviewed_waiting_customer_confirmation(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("reviewer") or "",
            payload.get("message") or "",
        )
    elif action == "link_task":
        result = store.link_task(
            payload.get("requestId") or payload.get("request_id"),
            payload.get("taskId") or payload.get("task_id"),
        )
    else:
        raise SystemExit("unknown action: %s" % action)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
