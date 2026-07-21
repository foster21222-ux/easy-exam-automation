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

    def test_keeps_multiple_requirement_sessions_under_one_task(self):
        task = self.store.create_task("多场考试", "account-a", {
            "examRequirements": [{"fields": {}}, {"fields": {}}, {"fields": {}}],
        })
        for requirement_index in range(3):
            self.store.upsert_session(task["taskId"], "formal", {
                "session_id": str(41001 + requirement_index * 2),
                "name": f"第{requirement_index + 1}场正式考试",
            }, requirement_index)
            self.store.upsert_session(task["taskId"], "trial", {
                "session_id": str(41002 + requirement_index * 2),
                "name": f"第{requirement_index + 1}场试考",
            }, requirement_index)

        detail = self.store.get_task(task["taskId"])

        self.assertEqual(len(detail["sessions"]), 6)
        self.assertEqual(
            [(item["requirementIndex"], item["sessionType"], item["session_id"]) for item in detail["sessions"]],
            [
                (0, "formal", "41001"), (0, "trial", "41002"),
                (1, "formal", "41003"), (1, "trial", "41004"),
                (2, "formal", "41005"), (2, "trial", "41006"),
            ],
        )

        self.store.upsert_session(task["taskId"], "formal", {
            "session_id": "51003", "name": "第2场正式考试重建",
        }, 1)
        updated = self.store.get_task(task["taskId"])
        self.assertEqual(len(updated["sessions"]), 6)
        self.assertEqual(updated["sessions"][2]["session_id"], "51003")

    def test_project_card_summary_exposes_identity_without_raw_fanwei_payload(self):
        task = self.store.create_task("项目卡测试", "account-a", {
            "customerName": "四川省公路设计院",
            "projectCode": "F-UI-8877",
            "projectCard": {
                "createdAt": "2026-07-18T02:00:00.000Z",
                "updatedAt": "2026-07-18T02:00:00.000Z",
                "status": "ready_for_config",
                "sourceType": "fanwei",
                "sourceKey": "R-UI-8877",
            },
            "fanweiSource": {"raw": {"fields": {"其他说明": "仅详情可见"}}},
        })

        summary = next(item for item in self.store.list_tasks() if item["taskId"] == task["taskId"])
        detail = self.store.get_task(task["taskId"])

        self.assertEqual(summary["customerName"], "四川省公路设计院")
        self.assertEqual(summary["projectCode"], "F-UI-8877")
        self.assertEqual(summary["projectCard"]["sourceKey"], "R-UI-8877")
        self.assertNotIn("config", summary)
        self.assertNotIn("仅详情可见", json.dumps(summary, ensure_ascii=False))
        self.assertEqual(detail["config"]["fanweiSource"]["raw"]["fields"]["其他说明"], "仅详情可见")

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

    def test_update_config_can_pin_the_actual_automation_account(self):
        task = self.store.create_task("切换账号项目", "account-old", {"apiKeyProfileId": "profile-old"})

        updated = self.store.update_config(
            task["taskId"],
            {"apiKeyProfileId": "profile-new"},
            source_account="account-new",
        )

        self.assertEqual(updated["sourceAccount"], "account-new")
        self.assertEqual(updated["config"]["apiKeyProfileId"], "profile-new")

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

    def test_tracks_and_aggregates_step_status_per_requirement(self):
        task = self.store.create_task("多场考试", "account-a", {
            "examRequirements": [{"fields": {}}, {"fields": {}}, {"fields": {}}],
        })
        task_id = task["taskId"]

        first = self.store.update_step(task_id, "formal_session_create", "success", {
            "message": "需求单1正式考试创建成功",
            "result": {"sessionId": "431487"},
        }, requirement_index=0)
        first_step = next(step for step in first["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(first_step["status"], "running")
        self.assertEqual(first_step["requirementProgress"]["0"]["status"], "success")
        self.assertEqual(first_step["requirementProgress"]["0"]["result"]["sessionId"], "431487")

        second = self.store.update_step(task_id, "formal_session_create", "success", {
            "message": "需求单2正式考试创建成功",
            "result": {"sessionId": "431489"},
        }, requirement_index=1)
        second_step = next(step for step in second["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(second_step["status"], "running")

        failed = self.store.update_step(task_id, "formal_session_create", "failed", {
            "errorMessage": "第三场创建失败",
        }, requirement_index=2)
        failed_step = next(step for step in failed["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(failed_step["status"], "failed")
        self.assertEqual(failed_step["requirementProgress"]["2"]["errorMessage"], "第三场创建失败")

        running = self.store.update_step(task_id, "formal_session_create", "running", {
            "message": "需求单3重新创建",
        }, requirement_index=2)
        running_step = next(step for step in running["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(running_step["status"], "running")
        self.assertIsNone(running_step["requirementProgress"]["2"]["errorMessage"])

        complete = self.store.update_step(task_id, "formal_session_create", "success", {
            "message": "需求单3正式考试创建成功",
            "result": {"sessionId": "431491"},
        }, requirement_index=2)
        complete_step = next(step for step in complete["steps"] if step["stepKey"] == "formal_session_create")
        self.assertEqual(complete_step["status"], "success")
        self.assertEqual(
            [complete_step["requirementProgress"][str(index)]["status"] for index in range(3)],
            ["success", "success", "success"],
        )
        self.assertEqual(len(complete_step["requirementProgress"]["2"]["logs"]), 2)

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
        }, project_name="项目甲（已修改）")

        self.assertEqual(updated["config"]["courses"][0]["code"], "20260629-03-01")
        self.assertEqual(updated["projectName"], "项目甲（已修改）")

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

    def test_hides_task_for_project_archiving(self):
        task = self.store.create_task("待归档项目", "account-a", {})

        hidden = self.store.hide_task(task["taskId"])

        self.assertTrue(hidden)
        self.assertEqual(self.store.list_tasks(), [])
        archived = self.store.list_tasks(include_hidden=True)
        self.assertEqual(len(archived), 1)
        self.assertIsNotNone(archived[0]["hiddenAt"])

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
