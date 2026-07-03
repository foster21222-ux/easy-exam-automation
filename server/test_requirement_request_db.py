import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from requirement_request_db import RequirementStore


def complete_requirement(**overrides):
    data = {
        "exam_name": "2026招聘考试",
        "formal_exam_time_range": "2026-07-01 09:00 - 2026-07-01 11:00",
        "mock_exam_time_range": "2026-06-30 15:00 - 2026-06-30 16:00",
        "early_login_minutes": "30分钟",
        "late_limit_minutes": "15分钟",
        "video_monitor_required": "是",
        "video_record_required": "是",
        "hawkeye_required": "否",
        "exam_client_type": "网页考试",
        "leave_limit_count": 8,
        "watermark_enabled": "是",
        "copy_forbidden": "是",
        "subjects": "英语，化学，物理",
    }
    data.update(overrides)
    return data


class RequirementStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = RequirementStore(Path(self.temp_dir.name) / "requirements.sqlite3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_upsert_normalizes_complete_requirement_and_records_version(self):
        result = self.store.create_or_update_requirement(
            customer={"name": "ATA客户", "contact": "ops@example.com"},
            requirement=complete_requirement(),
            source="dify",
        )

        self.assertEqual(result["status"], "pending_internal_review")
        self.assertEqual(result["title"], "2026招聘考试")
        self.assertEqual(result["latest"]["version"], 1)
        self.assertEqual(result["latest"]["requirement"]["early_login_minutes"], 30)
        self.assertEqual(result["latest"]["requirement"]["subjects"], ["英语", "化学", "物理"])
        self.assertEqual(result["latest"]["missingFields"], [])
        self.assertEqual(result["latest"]["validationErrors"], [])

        updated = self.store.create_or_update_requirement(
            request_id=result["requestId"],
            requirement=complete_requirement(exam_name="2026招聘考试补充版"),
            source="dify",
        )

        self.assertEqual(updated["title"], "2026招聘考试补充版")
        self.assertEqual(updated["latest"]["version"], 2)
        self.assertEqual(len(updated["versions"]), 2)

    def test_missing_required_fields_keep_request_in_collecting(self):
        result = self.store.create_or_update_requirement(
            customer={"name": "ATA客户"},
            requirement={"exam_name": "2026招聘考试", "exam_client_type": "网页考试"},
        )

        self.assertEqual(result["status"], "collecting")
        self.assertIn("formal_exam_time_range", result["latest"]["missingFields"])
        self.assertIn("mock_exam_time_range", result["latest"]["missingFields"])
        self.assertIn("subjects", result["latest"]["missingFields"])
        self.assertIn("leave_limit_count", result["latest"]["missingFields"])

    def test_dify_flow_requires_mock_time_but_defaults_watermark_and_copy_policy(self):
        requirement = complete_requirement()
        requirement.pop("watermark_enabled")
        requirement.pop("copy_forbidden")

        result = self.store.create_or_update_requirement(requirement=requirement)

        self.assertEqual(result["status"], "pending_internal_review")
        self.assertEqual(result["latest"]["missingFields"], [])
        self.assertEqual(result["latest"]["requirement"]["watermark_enabled"], True)
        self.assertEqual(result["latest"]["requirement"]["copy_forbidden"], True)

        missing_mock = dict(requirement)
        missing_mock.pop("mock_exam_time_range")
        collecting = self.store.create_or_update_requirement(requirement=missing_mock)
        self.assertEqual(collecting["status"], "collecting")
        self.assertIn("mock_exam_time_range", collecting["latest"]["missingFields"])

    def test_customer_confirmation_change_request_and_task_link_are_audited(self):
        created = self.store.create_or_update_requirement(requirement=complete_requirement())
        request_id = created["requestId"]

        confirmed = self.store.record_customer_confirmation(
            request_id,
            customer_reply="确认按此需求执行",
            conversation_id="conv-001",
        )
        self.assertEqual(confirmed["status"], "customer_confirmed")
        self.assertEqual(confirmed["confirmations"][0]["customerReply"], "确认按此需求执行")

        changed = self.store.create_change_request(
            request_id,
            customer_message="请增加一门地理科目",
            changes={"subjects": "英语，化学，物理，地理"},
        )
        self.assertEqual(changed["status"], "change_requested")
        self.assertEqual(changed["changeRequests"][0]["status"], "pending_internal_review")
        self.assertEqual(changed["latest"]["requirement"]["subjects"], ["英语", "化学", "物理"])

        reviewed = self.store.create_or_update_requirement(
            request_id=request_id,
            requirement=complete_requirement(subjects="英语，化学，物理，地理"),
            source="staff",
        )
        self.assertEqual(reviewed["status"], "pending_internal_review")
        self.assertEqual(reviewed["latest"]["version"], 2)

        self.store.record_customer_confirmation(request_id, "确认变更后的版本")
        ready = self.store.mark_ready_to_create_task(request_id, reviewer="admin-op")
        self.assertEqual(ready["status"], "ready_for_manual_execution")

        linked = self.store.link_task(request_id, task_id="task-10001")
        self.assertEqual(linked["status"], "linked_to_execution_task")
        self.assertEqual(linked["linkedTaskId"], "task-10001")

    def test_review_gate_requires_staff_review_after_customer_confirmation(self):
        created = self.store.create_or_update_requirement(requirement=complete_requirement())
        request_id = created["requestId"]

        with self.assertRaises(ValueError):
            self.store.mark_ready_for_manual_execution(request_id, reviewer="ops-a")

        confirmed = self.store.record_customer_confirmation(
            request_id,
            customer_reply="客户确认当前需求",
            conversation_id="conv-100",
        )
        self.assertEqual(confirmed["status"], "customer_confirmed")
        self.assertEqual(confirmed["confirmations"][0]["conversationId"], "conv-100")

        with self.assertRaises(ValueError):
            self.store.link_task(request_id, task_id="task-should-not-link")

        ready = self.store.mark_ready_for_manual_execution(request_id, reviewer="ops-a")
        self.assertEqual(ready["status"], "ready_for_manual_execution")

        linked = self.store.link_task(request_id, task_id="manual-task-001")
        self.assertEqual(linked["status"], "linked_to_execution_task")
        self.assertEqual(linked["linkedTaskId"], "manual-task-001")

    def test_staff_review_and_change_request_flow_records_timeline(self):
        created = self.store.create_or_update_requirement(requirement=complete_requirement())
        request_id = created["requestId"]

        clarification = self.store.request_customer_clarification(
            request_id,
            reviewer="ops-a",
            message="请补充候选人名单是否需要模板",
            questions=["是否需要候选人名单模板？", "候选人名单预计何时确认？"],
            missing_fields=["candidate_template_required"],
        )
        self.assertEqual(clarification["status"], "need_customer_clarification")
        clarification_event = next(
            event for event in clarification["events"] if event["eventType"] == "customer_clarification_requested"
        )
        self.assertEqual(clarification_event["payload"]["questions"][0], "是否需要候选人名单模板？")
        self.assertEqual(clarification_event["payload"]["missingFields"], ["candidate_template_required"])
        self.assertIn(request_id, clarification_event["payload"]["customerPrompt"])
        self.assertIn("请补充以下信息", clarification_event["payload"]["customerPrompt"])

        reviewed = self.store.mark_reviewed_waiting_customer_confirmation(
            request_id,
            reviewer="ops-a",
            message="字段已核对，等待客户确认",
        )
        self.assertEqual(reviewed["status"], "reviewed_waiting_customer_confirmation")

        confirmed = self.store.record_customer_confirmation(request_id, "确认执行")
        self.assertEqual(confirmed["status"], "customer_confirmed")

        changed = self.store.create_change_request(
            request_id,
            customer_message="请增加政治科目",
            changes={"subjects": "英语，化学，物理，政治"},
        )
        self.assertEqual(changed["status"], "change_requested")
        self.assertEqual(changed["changeRequests"][0]["changes"]["subjects"], ["英语", "化学", "物理", "政治"])

        reviewed_change = self.store.create_or_update_requirement(
            request_id=request_id,
            requirement=complete_requirement(subjects="英语，化学，物理，政治"),
            source="staff",
        )
        self.assertEqual(reviewed_change["status"], "pending_internal_review")
        self.assertTrue(
            any(event["eventType"] == "customer_clarification_requested" for event in reviewed_change["events"])
        )

    def test_accepting_one_change_keeps_request_in_change_requested_until_all_are_reviewed(self):
        created = self.store.create_or_update_requirement(requirement=complete_requirement())
        request_id = created["requestId"]
        self.store.create_change_request(
            request_id,
            customer_message="考试时间改到 7 月 2 日",
            changes={"formal_exam_time_range": "2026-07-02 09:00 - 2026-07-02 11:00"},
        )
        changed = self.store.create_change_request(
            request_id,
            customer_message="科目改为数学",
            changes={"subjects": ["数学"]},
        )
        changes_by_message = {
            item["customerMessage"]: item for item in changed["changeRequests"]
        }

        partially_reviewed = self.store.accept_change_request(
            request_id,
            changes_by_message["考试时间改到 7 月 2 日"]["changeId"],
            reviewer="ops-a",
        )

        self.assertEqual(partially_reviewed["status"], "change_requested")
        self.assertEqual(
            sum(item["status"] == "pending_internal_review" for item in partially_reviewed["changeRequests"]),
            1,
        )


if __name__ == "__main__":
    unittest.main()
