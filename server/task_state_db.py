import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


STEP_DEFS = [
    ("requirement_parse", "需求单解析"),
    ("formal_session_create", "正式场次创建"),
    ("trial_session_create", "试考场次创建"),
    ("trial_paper_bind", "试考试卷绑定"),
    ("course_create", "科目创建"),
    ("paper_bind", "正式场次绑定科目"),
    ("trial_candidate_import", "试考考生导入"),
    ("formal_candidate_import", "正式考试考生导入"),
    ("sessions_auto_rooms", "试考、正式考试自动分班"),
    ("sessions_invigilator_export", "试考、正式考试监考账号导出"),
    ("project_shared_sheet", "项目共享大表"),
    ("score_process", "成绩处理"),
]

VALID_STATUSES = {
    "pending", "running", "success", "failed", "waiting_manual", "skipped"
}
STEP_ORDER = {step_key: index for index, (step_key, _) in enumerate(STEP_DEFS)}
CORE_PROGRESS_STEPS = {
    "requirement_parse",
    "formal_session_create",
    "trial_session_create",
    "trial_paper_bind",
    "course_create",
    "paper_bind",
    "trial_candidate_import",
    "formal_candidate_import",
    "sessions_auto_rooms",
}
DISPLAY_STAGE_NAMES = {
    "requirement_parse": "需求单解析",
    "formal_session_create": "正式场次创建",
    "trial_session_create": "试考场次创建",
    "course_create": "科目创建",
    "trial_paper_bind": "试考试卷绑定",
    "paper_bind": "正式场次绑定科目",
    "trial_candidate_import": "试考考生导入 & 自动分班",
    "formal_candidate_import": "正式考试考生导入 & 自动分班",
    "sessions_auto_rooms": "试考考生导入 & 自动分班",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def loads(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def row_dict(row):
    return dict(row) if row else None


class TaskStore:
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
                CREATE TABLE IF NOT EXISTS exam_tasks (
                    task_id TEXT PRIMARY KEY,
                    project_name TEXT NOT NULL,
                    source_account TEXT NOT NULL DEFAULT '',
                    owner_email TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    current_stage TEXT NOT NULL DEFAULT '需求单解析',
                    progress REAL NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    hidden_at TEXT,
                    config_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS exam_sessions (
                    task_id TEXT NOT NULL,
                    session_type TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL DEFAULT '',
                    start_time TEXT NOT NULL DEFAULT '',
                    end_time TEXT NOT NULL DEFAULT '',
                    candidate_count INTEGER NOT NULL DEFAULT 0,
                    room_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'pending',
                    url TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(task_id, session_type),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_task_steps (
                    task_id TEXT NOT NULL,
                    step_key TEXT NOT NULL,
                    step_name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    started_at TEXT,
                    completed_at TEXT,
                    duration_ms INTEGER,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    result_json TEXT NOT NULL DEFAULT '{}',
                    sub_status_json TEXT NOT NULL DEFAULT '{}',
                    logs_json TEXT NOT NULL DEFAULT '[]',
                    PRIMARY KEY(task_id, step_key),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_candidates (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    permit TEXT NOT NULL DEFAULT '',
                    full_name TEXT NOT NULL DEFAULT '',
                    identity_id TEXT NOT NULL DEFAULT '',
                    course_code TEXT NOT NULL DEFAULT '',
                    mobile TEXT NOT NULL DEFAULT '',
                    email TEXT NOT NULL DEFAULT '',
                    custom_fields_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(task_id, session_id, permit),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                CREATE TABLE IF NOT EXISTS exam_custom_fields (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    field_name TEXT NOT NULL DEFAULT '',
                    field_code TEXT NOT NULL DEFAULT '',
                    yikao_field_id TEXT NOT NULL DEFAULT '',
                    source_column TEXT NOT NULL DEFAULT '',
                    field_type TEXT NOT NULL DEFAULT 'text',
                    required INTEGER NOT NULL DEFAULT 0,
                    order_index INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(task_id, session_id, field_code),
                    FOREIGN KEY(task_id) REFERENCES exam_tasks(task_id)
                );
                """
            )
            columns = {row["name"] for row in db.execute("PRAGMA table_info(exam_tasks)").fetchall()}
            if "owner_email" not in columns:
                db.execute("ALTER TABLE exam_tasks ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''")
            if "hidden_at" not in columns:
                db.execute("ALTER TABLE exam_tasks ADD COLUMN hidden_at TEXT")

    def _ensure_steps(self, db, task_id):
        for step_key, step_name in STEP_DEFS:
            db.execute(
                """INSERT OR IGNORE INTO exam_task_steps
                (task_id, step_key, step_name) VALUES (?, ?, ?)""",
                (task_id, step_key, step_name),
            )

    def create_task(self, project_name, source_account="", config=None, task_id=None, owner_email=""):
        task_id = task_id or str(uuid.uuid4())
        now = utc_now()
        with self.connect() as db:
            db.execute(
                """INSERT OR IGNORE INTO exam_tasks
                (task_id, project_name, source_account, owner_email, created_at, updated_at, config_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (task_id, project_name or "未命名项目", source_account or "", owner_email or "", now, now, json.dumps(config or {}, ensure_ascii=False)),
            )
            self._ensure_steps(db, task_id)
        return self.get_task(task_id)

    def upsert_session(self, task_id, session_type, session):
        now = utc_now()
        with self.connect() as db:
            db.execute(
                """INSERT INTO exam_sessions
                (task_id, session_type, session_id, name, start_time, end_time,
                 candidate_count, room_count, status, url, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id, session_type) DO UPDATE SET
                  session_id=excluded.session_id, name=excluded.name,
                  start_time=excluded.start_time, end_time=excluded.end_time,
                  candidate_count=excluded.candidate_count, room_count=excluded.room_count,
                  status=excluded.status, url=excluded.url, updated_at=excluded.updated_at""",
                (
                    task_id, session_type, str(session.get("session_id") or session.get("id") or ""),
                    str(session.get("name") or ""), str(session.get("start") or session.get("start_time") or ""),
                    str(session.get("end") or session.get("end_time") or ""),
                    int(session.get("candidate_count") or 0), int(session.get("room_count") or 0),
                    str(session.get("status") or "success"), str(session.get("url") or ""), now,
                ),
            )
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return self.get_task(task_id)

    def update_config(self, task_id, config):
        now = utc_now()
        with self.connect() as db:
            current = db.execute("SELECT * FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not current:
                raise ValueError("Task not found")
            current_config = loads(current["config_json"], {})
            next_config = {
                **current_config,
                **(config or {}),
            }
            db.execute(
                "UPDATE exam_tasks SET config_json=?, updated_at=? WHERE task_id=?",
                (json.dumps(next_config, ensure_ascii=False), now, task_id),
            )
        return self.get_task(task_id)

    def hide_task(self, task_id):
        now = utc_now()
        with self.connect() as db:
            current = db.execute("SELECT task_id FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not current:
                return False
            db.execute("UPDATE exam_tasks SET hidden_at=?, updated_at=? WHERE task_id=?", (now, now, task_id))
        return True

    def delete_task(self, task_id):
        with self.connect() as db:
            current = db.execute("SELECT task_id FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not current:
                return False
            db.execute("DELETE FROM exam_custom_fields WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_candidates WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_task_steps WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_sessions WHERE task_id=?", (task_id,))
            db.execute("DELETE FROM exam_tasks WHERE task_id=?", (task_id,))
        return True

    def upsert_custom_fields(self, task_id, session_id, fields):
        now = utc_now()
        saved = 0
        with self.connect() as db:
            for index, field in enumerate(fields or []):
                field_name = str(field.get("field_name") or field.get("target_name") or "").strip()
                field_code = str(field.get("field_code") or field.get("code") or "").strip()
                if not field_name or not field_code:
                    continue
                db.execute(
                    """INSERT INTO exam_custom_fields
                    (id, task_id, session_id, field_name, field_code, yikao_field_id, source_column,
                     field_type, required, order_index, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(task_id, session_id, field_code) DO UPDATE SET
                      field_name=excluded.field_name,
                      yikao_field_id=excluded.yikao_field_id,
                      source_column=excluded.source_column,
                      field_type=excluded.field_type,
                      required=excluded.required,
                      order_index=excluded.order_index,
                      updated_at=excluded.updated_at""",
                    (
                        str(uuid.uuid4()), task_id, str(session_id or ""), field_name, field_code,
                        str(field.get("yikao_field_id") or ""), str(field.get("source_column") or field_name),
                        str(field.get("field_type") or "text"), 1 if field.get("required") else 0,
                        int(field.get("order_index") if field.get("order_index") is not None else index),
                        now, now,
                    ),
                )
                saved += 1
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return {"savedCount": saved, "taskId": task_id, "sessionId": str(session_id or "")}

    def list_custom_fields(self, task_id, session_id=None):
        with self.connect() as db:
            if session_id is None:
                rows = db.execute(
                    "SELECT * FROM exam_custom_fields WHERE task_id=? ORDER BY order_index, field_name", (task_id,)
                ).fetchall()
            else:
                rows = db.execute(
                    """SELECT * FROM exam_custom_fields
                    WHERE task_id=? AND session_id=? ORDER BY order_index, field_name""",
                    (task_id, str(session_id or "")),
                ).fetchall()
        return [self._custom_field(row) for row in rows]

    def upsert_candidates(self, task_id, session_id, candidates):
        now = utc_now()
        saved = 0
        with self.connect() as db:
            for candidate in candidates or []:
                permit = str(candidate.get("permit") or "").strip()
                if not permit:
                    continue
                custom_fields = candidate.get("custom_fields") or {}
                if not isinstance(custom_fields, dict):
                    custom_fields = {}
                db.execute(
                    """INSERT INTO exam_candidates
                    (id, task_id, session_id, permit, full_name, identity_id, course_code, mobile, email,
                     custom_fields_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(task_id, session_id, permit) DO UPDATE SET
                      full_name=excluded.full_name,
                      identity_id=excluded.identity_id,
                      course_code=excluded.course_code,
                      mobile=excluded.mobile,
                      email=excluded.email,
                      custom_fields_json=excluded.custom_fields_json,
                      updated_at=excluded.updated_at""",
                    (
                        str(uuid.uuid4()), task_id, str(session_id or ""), permit,
                        str(candidate.get("full_name") or ""), str(candidate.get("identity_id") or ""),
                        str(candidate.get("course_code") or ""), str(candidate.get("mobile") or ""),
                        str(candidate.get("email") or ""), json.dumps(custom_fields, ensure_ascii=False),
                        now, now,
                    ),
                )
                saved += 1
            db.execute("UPDATE exam_tasks SET updated_at=? WHERE task_id=?", (now, task_id))
        return {"savedCount": saved, "taskId": task_id, "sessionId": str(session_id or "")}

    def list_candidates(self, task_id, session_id=None):
        with self.connect() as db:
            if session_id is None:
                rows = db.execute(
                    "SELECT * FROM exam_candidates WHERE task_id=? ORDER BY created_at, permit", (task_id,)
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM exam_candidates WHERE task_id=? AND session_id=? ORDER BY created_at, permit",
                    (task_id, str(session_id or "")),
                ).fetchall()
        return [self._candidate(row) for row in rows]

    def update_step(self, task_id, step_key, status, result=None):
        if status not in VALID_STATUSES:
            raise ValueError("Invalid step status: %s" % status)
        if step_key not in {key for key, _ in STEP_DEFS}:
            raise ValueError("Unknown step key: %s" % step_key)
        result = result or {}
        now = utc_now()
        with self.connect() as db:
            current = db.execute(
                "SELECT * FROM exam_task_steps WHERE task_id=? AND step_key=?",
                (task_id, step_key),
            ).fetchone()
            if not current:
                raise ValueError("Task step not found")

            sub_status = result.get("subStatus") or loads(current["sub_status_json"], {})
            if step_key in {"sessions_auto_rooms", "sessions_invigilator_export"} and sub_status:
                child_values = [sub_status.get("formalExamStatus"), sub_status.get("trialExamStatus")]
                if all(value == "success" for value in child_values):
                    status = "success"
                elif any(value == "failed" for value in child_values):
                    status = "failed"
                elif any(value == "running" for value in child_values):
                    status = "running"
                elif any(value == "waiting_manual" for value in child_values):
                    status = "waiting_manual"

            started_at = current["started_at"] or (now if status != "pending" else None)
            completed_at = now if status in {"success", "failed", "skipped"} else None
            duration_ms = None
            if started_at and completed_at:
                start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                duration_ms = max(0, int((end_dt - start_dt).total_seconds() * 1000))
            logs = loads(current["logs_json"], [])
            message = str(result.get("message") or "").strip()
            if message:
                logs.append({"time": now, "message": message})
            retry_count = current["retry_count"] + (1 if result.get("incrementRetry") else 0)
            db.execute(
                """UPDATE exam_task_steps SET status=?, started_at=?, completed_at=?, duration_ms=?,
                error_message=?, retry_count=?, result_json=?, sub_status_json=?, logs_json=?
                WHERE task_id=? AND step_key=?""",
                (
                    status, started_at, completed_at, duration_ms,
                    str(result.get("errorMessage") or "") or None, retry_count,
                    json.dumps(result.get("result") or {}, ensure_ascii=False),
                    json.dumps(sub_status, ensure_ascii=False), json.dumps(logs, ensure_ascii=False),
                    task_id, step_key,
                ),
            )
            self._refresh_task(db, task_id)
        return self.get_task(task_id)

    def _refresh_task(self, db, task_id):
        rows = db.execute(
            "SELECT step_key, step_name, status FROM exam_task_steps WHERE task_id=?", (task_id,)
        ).fetchall()
        rows = sorted(rows, key=lambda row: STEP_ORDER.get(row["step_key"], len(STEP_ORDER)))
        core_rows = [row for row in rows if row["step_key"] in CORE_PROGRESS_STEPS and row["status"] != "skipped"]
        core_completed = sum(1 for row in core_rows if row["status"] == "success")
        progress = round((core_completed / len(core_rows) * 100) if core_rows else 100, 1)
        if any(row["status"] == "failed" for row in core_rows):
            status = "failed"
        elif core_rows and core_completed == len(core_rows):
            status = "success"
        elif any(row["status"] == "running" for row in core_rows):
            status = "running"
        elif any(row["status"] == "waiting_manual" for row in core_rows):
            status = "waiting_manual"
        else:
            status = "pending"
        active = next(
            (
                DISPLAY_STAGE_NAMES.get(row["step_key"], row["step_name"])
                for row in core_rows
                if row["status"] in {"running", "waiting_manual", "failed"}
            ),
            "",
        )
        if not active and status != "success":
            active = next(
                (
                    DISPLAY_STAGE_NAMES.get(row["step_key"], row["step_name"])
                    for row in core_rows
                    if row["status"] == "pending"
                ),
                "",
            )
        db.execute(
            "UPDATE exam_tasks SET status=?, current_stage=?, progress=?, updated_at=? WHERE task_id=?",
            (status, active or ("已完成" if status == "success" else "等待执行"), progress, utc_now(), task_id),
        )

    def list_tasks(self, include_hidden=False):
        with self.connect() as db:
            if include_hidden:
                rows = db.execute("SELECT * FROM exam_tasks ORDER BY updated_at DESC").fetchall()
            else:
                rows = db.execute("SELECT * FROM exam_tasks WHERE hidden_at IS NULL ORDER BY updated_at DESC").fetchall()
        return [self._task_summary(row) for row in rows]

    def list_sessions(self):
        with self.connect() as db:
            rows = db.execute(
                """SELECT s.*, t.project_name, t.source_account, t.owner_email, t.progress AS task_progress,
                          t.config_json
                FROM exam_sessions s JOIN exam_tasks t ON t.task_id=s.task_id
                ORDER BY s.updated_at DESC"""
            ).fetchall()
        return [self._session(row) for row in rows]

    def get_task(self, task_id):
        with self.connect() as db:
            task = db.execute("SELECT * FROM exam_tasks WHERE task_id=?", (task_id,)).fetchone()
            if not task:
                return None
            self._ensure_steps(db, task_id)
            sessions = db.execute("SELECT * FROM exam_sessions WHERE task_id=? ORDER BY session_type", (task_id,)).fetchall()
            steps = db.execute("SELECT * FROM exam_task_steps WHERE task_id=?", (task_id,)).fetchall()
            steps = sorted(steps, key=lambda row: STEP_ORDER.get(row["step_key"], len(STEP_ORDER)))
        result = self._task_summary(task)
        result["config"] = loads(task["config_json"], {})
        result["sessions"] = [self._session(row) for row in sessions]
        result["steps"] = [self._step(row) for row in steps]
        result["customFields"] = self.list_custom_fields(task_id)
        return result

    def _task_summary(self, row):
        return {
            "taskId": row["task_id"], "projectName": row["project_name"],
            "sourceAccount": row["source_account"], "status": row["status"],
            "ownerEmail": row["owner_email"],
            "hiddenAt": row["hidden_at"] if "hidden_at" in row.keys() else None,
            "currentStage": row["current_stage"], "progress": row["progress"],
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def _session(self, row):
        data = row_dict(row)
        return {
            "taskId": data["task_id"], "sessionType": data["session_type"],
            "session_id": data["session_id"], "name": data["name"],
            "start": data["start_time"], "end": data["end_time"],
            "candidateCount": data["candidate_count"], "roomCount": data["room_count"],
            "status": data["status"], "url": data["url"],
            "projectName": data.get("project_name", ""),
            "sourceAccount": data.get("source_account", ""),
            "ownerEmail": data.get("owner_email", ""),
            "progress": data.get("task_progress", 0),
            "config": loads(data.get("config_json"), {}),
        }

    def _step(self, row):
        return {
            "stepKey": row["step_key"], "stepName": row["step_name"], "status": row["status"],
            "startedAt": row["started_at"], "completedAt": row["completed_at"],
            "durationMs": row["duration_ms"], "errorMessage": row["error_message"],
            "retryCount": row["retry_count"], "result": loads(row["result_json"], {}),
            "subStatus": loads(row["sub_status_json"], {}), "logs": loads(row["logs_json"], []),
        }

    def _candidate(self, row):
        return {
            "id": row["id"], "taskId": row["task_id"], "session_id": row["session_id"],
            "permit": row["permit"], "full_name": row["full_name"], "identity_id": row["identity_id"],
            "course_code": row["course_code"], "mobile": row["mobile"], "email": row["email"],
            "custom_fields": loads(row["custom_fields_json"], {}),
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def _custom_field(self, row):
        return {
            "id": row["id"],
            "taskId": row["task_id"],
            "session_id": row["session_id"],
            "field_name": row["field_name"],
            "field_code": row["field_code"],
            "yikao_field_id": row["yikao_field_id"],
            "source_column": row["source_column"],
            "field_type": row["field_type"],
            "required": bool(row["required"]),
            "order_index": row["order_index"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: task_state_db.py DB_PATH ACTION")
    store = TaskStore(sys.argv[1])
    action = sys.argv[2]
    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    if action == "create":
        result = store.create_task(payload.get("projectName"), payload.get("sourceAccount", ""), payload.get("config", {}), payload.get("taskId"), payload.get("ownerEmail", ""))
    elif action == "list":
        result = store.list_tasks(bool(payload.get("includeHidden")))
    elif action == "list_all":
        result = store.list_tasks(True)
    elif action == "list_sessions":
        result = store.list_sessions()
    elif action == "get":
        result = store.get_task(payload.get("taskId"))
    elif action == "update_step":
        result = store.update_step(payload.get("taskId"), payload.get("stepKey"), payload.get("status"), payload.get("result"))
    elif action == "update_config":
        result = store.update_config(payload.get("taskId"), payload.get("config") or {})
    elif action == "hide":
        result = {"hidden": store.hide_task(payload.get("taskId"))}
    elif action == "delete":
        result = {"deleted": store.delete_task(payload.get("taskId"))}
    elif action == "upsert_session":
        result = store.upsert_session(payload.get("taskId"), payload.get("sessionType"), payload.get("session") or {})
    elif action == "upsert_candidates":
        result = store.upsert_candidates(payload.get("taskId"), payload.get("sessionId"), payload.get("candidates") or [])
    elif action == "list_candidates":
        result = store.list_candidates(payload.get("taskId"), payload.get("sessionId"))
    elif action == "upsert_custom_fields":
        result = store.upsert_custom_fields(payload.get("taskId"), payload.get("sessionId"), payload.get("fields") or [])
    elif action == "list_custom_fields":
        result = store.list_custom_fields(payload.get("taskId"), payload.get("sessionId"))
    else:
        raise SystemExit("unknown action: %s" % action)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
