import json
import tempfile
import unittest
from pathlib import Path

from task_state_db import TaskStore


class TaskStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = TaskStore(Path(self.temp_dir.name) / "tasks.sqlite3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_lists_projects_and_sessions_across_accounts(self):
        first = self.store.create_task("项目甲", "account-a", {"source": "a.xlsx"})
        second = self.store.create_task("项目乙", "account-b", {"source": "b.xlsx"})
        self.store.upsert_session(first["taskId"], "formal", {
            "session_id": "10001", "name": "项目甲正式考试", "start": "2026-06-20 09:00", "end": "2026-06-20 10:00"
        })
        self.store.upsert_session(second["taskId"], "trial", {
            "session_id": "10002", "name": "项目乙-试考", "start": "2026-06-19 09:00", "end": "2026-06-19 10:00"
        })

        projects = self.store.list_tasks()
        sessions = self.store.list_sessions()

        self.assertEqual({item["sourceAccount"] for item in projects}, {"account-a", "account-b"})
        self.assertEqual({item["session_id"] for item in sessions}, {"10001", "10002"})

    def test_list_sessions_includes_task_config_for_unified_exam_display(self):
        task = self.store.create_task("统一项目", "account-a", {
            "unifiedExamAddress": True,
            "examUrl": "https://eztest.cn/exam/1234/uniform/login/",
        })
        self.store.upsert_session(task["taskId"], "formal", {
            "session_id": "30001", "name": "统一项目正式考试"
        })

        sessions = self.store.list_sessions()

        self.assertEqual(sessions[0]["config"]["unifiedExamAddress"], True)
        self.assertEqual(sessions[0]["config"]["examUrl"], "https://eztest.cn/exam/1234/uniform/login/")

    def test_persists_task_owner_email_to_tasks_and_sessions(self):
        task = self.store.create_task("同事项目", "account-a", {}, owner_email="mate@example.com")
        self.store.upsert_session(task["taskId"], "formal", {
            "session_id": "20001", "name": "同事项目正式考试"
        })

        detail = self.store.get_task(task["taskId"])
        sessions = self.store.list_sessions()

        self.assertEqual(task["ownerEmail"], "mate@example.com")
        self.assertEqual(detail["ownerEmail"], "mate@example.com")
        self.assertEqual(sessions[0]["ownerEmail"], "mate@example.com")

    def test_steps_are_independent_and_persist_timestamps(self):
        task = self.store.create_task("项目甲", "account-a", {})
        task_id = task["taskId"]
        self.store.update_step(task_id, "trial_session_create", "success", {"message": "试考先完成"})
        detail = self.store.get_task(task_id)

        trial = next(step for step in detail["steps"] if step["stepKey"] == "trial_session_create")
        formal = next(step for step in detail["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(trial["status"], "success")
        self.assertIsNotNone(trial["startedAt"])
        self.assertIsNotNone(trial["completedAt"])
        self.assertEqual(formal["status"], "pending")
        self.assertGreater(detail["progress"], 0)

    def test_paper_bind_step_is_formal_course_session_binding(self):
        task = self.store.create_task("项目甲", "account-a", {})
        detail = self.store.get_task(task["taskId"])
        step = next(item for item in detail["steps"] if item["stepKey"] == "paper_bind")
        self.assertEqual(step["stepName"], "正式场次绑定科目")

    def test_trial_paper_bind_step_follows_trial_session_create(self):
        task = self.store.create_task("项目甲", "account-a", {})
        detail = self.store.get_task(task["taskId"])
        step_keys = [step["stepKey"] for step in detail["steps"]]
        step = next(item for item in detail["steps"] if item["stepKey"] == "trial_paper_bind")
        self.assertEqual(step["stepName"], "试考试卷绑定")
        self.assertLess(step_keys.index("trial_session_create"), step_keys.index("trial_paper_bind"))
        self.assertLess(step_keys.index("trial_paper_bind"), step_keys.index("course_create"))

    def test_get_task_backfills_score_process_step_for_existing_tasks(self):
        task = self.store.create_task("旧项目", "account-a", {})
        task_id = task["taskId"]
        with self.store.connect() as db:
            db.execute("DELETE FROM exam_task_steps WHERE task_id=? AND step_key=?", (task_id, "score_process"))

        detail = self.store.get_task(task_id)

        score_step = next(step for step in detail["steps"] if step["stepKey"] == "score_process")
        self.assertEqual(score_step["stepName"], "成绩处理")
        self.assertEqual(score_step["status"], "pending")

    def test_get_task_backfills_project_shared_sheet_before_score_process(self):
        task = self.store.create_task("旧项目", "account-a", {})
        task_id = task["taskId"]
        with self.store.connect() as db:
            db.execute(
                "DELETE FROM exam_task_steps WHERE task_id=? AND step_key=?",
                (task_id, "project_shared_sheet"),
            )

        detail = self.store.get_task(task_id)
        step_keys = [step["stepKey"] for step in detail["steps"]]
        shared_step = next(step for step in detail["steps"] if step["stepKey"] == "project_shared_sheet")

        self.assertEqual(shared_step["stepName"], "项目共享大表")
        self.assertEqual(shared_step["status"], "pending")
        self.assertLess(step_keys.index("project_shared_sheet"), step_keys.index("score_process"))

    def test_combined_step_requires_both_children(self):
        task = self.store.create_task("项目甲", "account-a", {})
        task_id = task["taskId"]
        self.store.update_step(task_id, "sessions_auto_rooms", "running", {
            "subStatus": {"formalExamStatus": "success", "trialExamStatus": "running"}
        })
        running = self.store.get_task(task_id)
        combined = next(step for step in running["steps"] if step["stepKey"] == "sessions_auto_rooms")
        self.assertEqual(combined["status"], "running")

        self.store.update_step(task_id, "sessions_auto_rooms", "success", {
            "subStatus": {"formalExamStatus": "success", "trialExamStatus": "success"}
        })
        finished = self.store.get_task(task_id)
        combined = next(step for step in finished["steps"] if step["stepKey"] == "sessions_auto_rooms")
        self.assertEqual(combined["status"], "success")

    def test_progress_reaches_complete_after_both_candidate_imports_and_rooms(self):
        task = self.store.create_task("项目甲", "account-a", {})
        task_id = task["taskId"]
        for step_key in [
            "requirement_parse",
            "formal_session_create",
            "trial_session_create",
            "trial_paper_bind",
            "course_create",
            "paper_bind",
            "trial_candidate_import",
            "formal_candidate_import",
        ]:
            self.store.update_step(task_id, step_key, "success")
        self.store.update_step(task_id, "sessions_auto_rooms", "success", {
            "subStatus": {"formalExamStatus": "success", "trialExamStatus": "success"}
        })

        detail = self.store.get_task(task_id)

        self.assertEqual(detail["progress"], 100)
        self.assertEqual(detail["currentStage"], "已完成")

    def test_current_stage_names_first_unfinished_display_card(self):
        task = self.store.create_task("项目甲", "account-a", {})
        task_id = task["taskId"]
        for step_key in [
            "requirement_parse",
            "formal_session_create",
            "trial_session_create",
            "trial_paper_bind",
            "course_create",
            "paper_bind",
        ]:
            self.store.update_step(task_id, step_key, "success")

        detail = self.store.get_task(task_id)

        self.assertEqual(detail["currentStage"], "试考考生导入 & 自动分班")

    def test_updates_task_config_with_final_course_codes(self):
        task = self.store.create_task("项目甲", "account-a", {
            "courses": [{"name": "体育", "code": "20260629-01-01"}]
        })

        updated = self.store.update_config(task["taskId"], {
            "courses": [{"name": "体育", "code": "20260629-03-01"}]
        })

        self.assertEqual(updated["config"]["courses"][0]["code"], "20260629-03-01")

    def test_deletes_task_with_sessions_and_steps(self):
        task = self.store.create_task("待删除项目", "account-a", {})
        task_id = task["taskId"]
        self.store.upsert_session(task_id, "formal", {
            "session_id": "30001", "name": "待删除项目正式考试"
        })
        self.store.update_step(task_id, "formal_session_create", "success", {"message": "已创建"})

        deleted = self.store.delete_task(task_id)

        self.assertTrue(deleted)
        self.assertEqual(self.store.list_tasks(), [])
        self.assertEqual(self.store.list_tasks(include_hidden=True), [])
        self.assertIsNone(self.store.get_task(task_id))
        self.assertEqual(self.store.list_sessions(), [])

    def test_upserts_candidates_with_custom_fields(self):
        task = self.store.create_task("候选人扩展字段项目", "account-a", {})
        self.store.upsert_session(task["taskId"], "formal", {
            "session_id": "40001", "name": "候选人扩展字段项目正式考试"
        })

        saved = self.store.upsert_candidates(task["taskId"], "40001", [
            {
                "permit": "P001",
                "full_name": "张三",
                "identity_id": "",
                "course_code": "20260629-01-01",
                "mobile": "13800000000",
                "email": "a@example.com",
                "custom_fields": {"报考岗位": "综合岗", "学校": "四川大学"},
            }
        ])

        rows = self.store.list_candidates(task["taskId"], "40001")
        self.assertEqual(saved["savedCount"], 1)
        self.assertEqual(rows[0]["permit"], "P001")
        self.assertEqual(rows[0]["custom_fields"], {"报考岗位": "综合岗", "学校": "四川大学"})

    def test_upserts_exam_custom_field_mappings(self):
        task = self.store.create_task("字段映射项目", "account-a", {})
        self.store.upsert_session(task["taskId"], "formal", {
            "session_id": "50001", "name": "字段映射项目正式考试"
        })

        saved = self.store.upsert_custom_fields(task["taskId"], "50001", [
            {
                "field_name": "专业",
                "field_code": "cf_major",
                "yikao_field_id": "123",
                "source_column": "专业",
                "field_type": "text",
                "required": False,
                "order_index": 0,
            }
        ])
        updated = self.store.upsert_custom_fields(task["taskId"], "50001", [
            {
                "field_name": "专业",
                "field_code": "cf_major",
                "yikao_field_id": "456",
                "source_column": "专业",
                "field_type": "text",
                "required": False,
                "order_index": 0,
            }
        ])

        fields = self.store.list_custom_fields(task["taskId"], "50001")
        detail = self.store.get_task(task["taskId"])
        self.assertEqual(saved["savedCount"], 1)
        self.assertEqual(updated["savedCount"], 1)
        self.assertEqual(len(fields), 1)
        self.assertEqual(fields[0]["field_name"], "专业")
        self.assertEqual(fields[0]["field_code"], "cf_major")
        self.assertEqual(fields[0]["yikao_field_id"], "456")
        self.assertEqual(detail["customFields"][0]["field_code"], "cf_major")


if __name__ == "__main__":
    unittest.main()
