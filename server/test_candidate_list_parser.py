import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import candidate_list_parser as parser


class CandidateListParserTest(unittest.TestCase):
    def test_detects_optional_course_code_from_chinese_header(self):
        columns = ["准考证号", "姓名", "身份证号", "科目编号"]
        mapping = parser.detect_mapping(columns)
        candidates = parser.build_candidates(
            [
                {
                    "__row": 2,
                    "准考证号": "P001",
                    "姓名": "张三",
                    "身份证号": "11010519491231002X",
                    "科目编号": "COURSE-01",
                }
            ],
            mapping,
        )

        self.assertEqual(mapping["course_code"], "科目编号")
        self.assertEqual(candidates[0]["course_code"], "COURSE-01")
        self.assertEqual(parser.validate_candidates(candidates, mapping), ([], []))

    def test_course_code_is_optional(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "身份证号", "course_code": ""}
        candidates = [
            {
                "__row": 2,
                "permit": "P001",
                "full_name": "张三",
                "identity_id": "11010519491231002X",
                "course_code": "",
            }
        ]

        self.assertEqual(parser.validate_candidates(candidates, mapping), ([], []))

    def test_identity_id_is_optional(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "", "course_code": ""}
        candidates = [
            {
                "__row": 2,
                "permit": "P001",
                "full_name": "张三",
                "identity_id": "",
                "course_code": "",
            }
        ]

        self.assertEqual(parser.validate_candidates(candidates, mapping), ([], []))

    def test_validation_errors_use_chinese_field_labels(self):
        mapping = {"permit": "", "full_name": "姓名", "identity_id": "", "course_code": ""}
        candidates = [
            {
                "__row": 2,
                "permit": "",
                "full_name": "",
                "identity_id": "1.1010119900101E+17",
                "course_code": "",
                "mobile": "1.3800000000E+10",
            }
        ]

        errors, warnings = parser.validate_candidates(candidates, mapping)

        self.assertEqual(warnings, [])
        self.assertIn("缺少字段映射：准考证号", errors)
        self.assertIn("第 2 行缺少姓名", errors)
        self.assertIn("第 2 行身份证号为科学计数法格式，请修正原始文件后再导入", errors)
        self.assertIn("第 2 行手机号为科学计数法格式，请修正原始文件后再导入", errors)
        self.assertNotIn("第 2 行缺少准考证号", errors)
        self.assertFalse(any("permit" in error or "full_name" in error or "identity_id" in error for error in errors))

    def test_detects_mobile_email_and_custom_field_candidates(self):
        columns = ["准考证号", "姓名", "身份证号", "手机号", "邮箱地址", "报考岗位", "学校"]
        mapping = parser.detect_mapping(columns)
        custom = parser.custom_field_candidates(columns, mapping)

        self.assertEqual(mapping["mobile"], "手机号")
        self.assertEqual(mapping["email"], "邮箱地址")
        self.assertEqual(custom, ["报考岗位", "学校"])

    def test_detects_required_suffix_phone_and_email_headers(self):
        columns = ["姓名（必填）", "手机号（必填）", "邮箱（必填）", "性别"]

        mapping = parser.detect_mapping(columns)
        custom = parser.custom_field_candidates(columns, mapping)

        self.assertEqual(mapping["full_name"], "姓名（必填）")
        self.assertEqual(mapping["mobile"], "手机号（必填）")
        self.assertEqual(mapping["email"], "邮箱（必填）")
        self.assertNotIn("手机号（必填）", custom)
        self.assertNotIn("邮箱（必填）", custom)
        self.assertIn("性别", custom)

    def test_custom_candidates_exclude_mapped_fixed_fields_with_suffixes(self):
        columns = ["姓名（必填）", "身份证号（必填）", "手机号（必填）", "邮箱（必填）", "考试科目", "性别"]
        mapping = parser.detect_mapping(columns)

        custom = parser.custom_field_candidates(columns, mapping)

        self.assertEqual(mapping["full_name"], "姓名（必填）")
        self.assertEqual(mapping["identity_id"], "身份证号（必填）")
        self.assertEqual(custom, ["考试科目", "性别"])

    def test_phone_aliases_are_fixed_mapping_fields_not_custom_candidates(self):
        columns = ["姓名", "联系电话", "身份证号", "专业", "岗位名称"]
        mapping = {
            "full_name": "姓名",
            "permit": "联系电话",
            "identity_id": "身份证号",
            "course_code": "",
            "mobile": "联系电话",
            "email": "",
        }

        custom = parser.custom_field_candidates(columns, mapping)

        self.assertNotIn("联系电话", custom)
        self.assertIn("专业", custom)

    def test_permit_allows_only_ascii_letters_and_digits_after_trim(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "", "course_code": ""}
        candidates = [
            {"__row": 2, "permit": " 20260725A01 ", "full_name": "张三"},
            {"__row": 3, "permit": "A-001", "full_name": "李四"},
            {"__row": 4, "permit": "A 001", "full_name": "王五"},
            {"__row": 5, "permit": "A_001", "full_name": "赵六"},
            {"__row": 6, "permit": "001号", "full_name": "钱七"},
        ]

        errors, warnings = parser.validate_candidates(candidates, mapping)

        self.assertEqual(warnings, [])
        self.assertNotIn("第 2 行准考证号只能包含英文字母和数字", errors)
        self.assertIn("第 3 行准考证号只能包含英文字母和数字", errors)
        self.assertIn("第 4 行准考证号只能包含英文字母和数字", errors)
        self.assertIn("第 5 行准考证号只能包含英文字母和数字", errors)
        self.assertIn("第 6 行准考证号只能包含英文字母和数字", errors)

    def test_permit_mapped_from_phone_alias_requires_valid_mobile_number(self):
        mapping = {
            "permit": "联系电话",
            "full_name": "姓名",
            "identity_id": "",
            "course_code": "",
            "mobile": "联系电话",
        }
        candidates = [
            {"__row": 2, "permit": "13800000000", "full_name": "张三", "mobile": "13800000000"},
            {"__row": 3, "permit": "123456", "full_name": "李四", "mobile": "123456"},
            {"__row": 4, "permit": "1380000000_", "full_name": "王五", "mobile": "1380000000_"},
        ]

        errors, warnings = parser.validate_candidates(candidates, mapping)

        self.assertEqual(warnings, [])
        self.assertNotIn("第 2 行手机号码格式不正确", errors)
        self.assertIn("第 3 行手机号必须为 11 位数字", errors)
        self.assertIn("第 4 行准考证号只能包含英文字母和数字", errors)
        self.assertIn("第 4 行手机号必须为 11 位数字", errors)

    def test_identity_id_validates_birth_date_checksum_and_normalizes_x(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "身份证号", "course_code": ""}
        candidates = parser.build_candidates(
            [
                {"__row": 2, "准考证号": "P001", "姓名": "张三", "身份证号": " 11010519491231002x "},
                {"__row": 3, "准考证号": "P002", "姓名": "李四", "身份证号": "11010519490231002X"},
                {"__row": 4, "准考证号": "P003", "姓名": "王五", "身份证号": "110105194912310021"},
                {"__row": 5, "准考证号": "P004", "姓名": "赵六", "身份证号": "11010519491231002A"},
                {"__row": 6, "准考证号": "P005", "姓名": "钱七", "身份证号": ""},
            ],
            mapping,
        )

        errors, warnings = parser.validate_candidates(candidates, mapping)

        self.assertEqual(warnings, [])
        self.assertEqual(candidates[0]["identity_id"], "11010519491231002X")
        self.assertNotIn("第 2 行身份证号校验码错误", errors)
        self.assertIn("第 3 行身份证号出生日期不合法", errors)
        self.assertIn("第 4 行身份证号校验码错误", errors)
        self.assertIn("第 5 行身份证号格式不正确", errors)
        self.assertFalse(any("第 6 行身份证号" in error for error in errors))

    def test_mobile_is_optional_but_validates_and_normalizes_when_present(self):
        mapping = {"permit": "准考证号", "full_name": "姓名", "identity_id": "", "course_code": "", "mobile": "手机号"}
        candidates = parser.build_candidates(
            [
                {"__row": 2, "准考证号": "P001", "姓名": "张三", "手机号": " 138 0000 0000 "},
                {"__row": 3, "准考证号": "P002", "姓名": "李四", "手机号": "138-0000-0000"},
                {"__row": 4, "准考证号": "P003", "姓名": "王五", "手机号": ""},
                {"__row": 5, "准考证号": "P004", "姓名": "赵六", "手机号": "12800000000"},
                {"__row": 6, "准考证号": "P005", "姓名": "钱七", "手机号": "1380000000"},
                {"__row": 7, "准考证号": "P006", "姓名": "孙八", "手机号": "1380000000A"},
            ],
            mapping,
        )

        errors, warnings = parser.validate_candidates(candidates, mapping)

        self.assertEqual(warnings, [])
        self.assertEqual(candidates[0]["mobile"], "13800000000")
        self.assertEqual(candidates[1]["mobile"], "13800000000")
        self.assertFalse(any("第 4 行手机号" in error for error in errors))
        self.assertIn("第 5 行手机号格式不正确", errors)
        self.assertIn("第 6 行手机号必须为 11 位数字", errors)
        self.assertIn("第 7 行手机号必须为 11 位数字", errors)

    def test_permit_mapped_from_phone_alias_requires_non_empty_mobile(self):
        mapping = {
            "permit": "手机号",
            "full_name": "姓名",
            "identity_id": "",
            "course_code": "",
            "mobile": "手机号",
        }
        candidates = parser.build_candidates(
            [
                {"__row": 2, "手机号": "", "姓名": "张三"},
                {"__row": 3, "手机号": "138 0000 0000", "姓名": "李四"},
            ],
            mapping,
        )

        errors, warnings = parser.validate_candidates(candidates, mapping)

        self.assertEqual(warnings, [])
        self.assertIn("第 2 行手机号不能为空", errors)
        self.assertEqual(candidates[1]["permit"], "13800000000")
        self.assertEqual(candidates[1]["mobile"], "13800000000")

    def test_normalizes_mobile_and_email_custom_field_names_for_yikao(self):
        mapping = {
            "permit": "手机",
            "full_name": "姓名",
            "identity_id": "",
            "course_code": "",
            "mobile": "手机",
            "email": "电子邮件",
        }
        candidates = parser.build_candidates(
            [
                {
                    "__row": 2,
                    "手机": "15316833344",
                    "姓名": "张三",
                    "电子邮件": "a@example.com",
                }
            ],
            mapping,
            [
                {"source_column": "手机", "target_name": "手机", "enabled": True},
                {"source_column": "电子邮件", "target_name": "电子邮件", "enabled": True},
            ],
        )

        self.assertEqual(candidates[0]["permit"], "15316833344")
        self.assertEqual(candidates[0]["mobile"], "15316833344")
        self.assertEqual(candidates[0]["email"], "a@example.com")
        self.assertEqual(candidates[0]["custom_fields"], {"手机号码": "15316833344", "邮箱": "a@example.com"})

    def test_build_candidates_includes_enabled_custom_fields(self):
        mapping = {
            "permit": "准考证号",
            "full_name": "姓名",
            "identity_id": "身份证号",
            "course_code": "科目编号",
            "mobile": "手机号",
            "email": "邮箱",
        }
        candidates = parser.build_candidates(
            [
                {
                    "__row": 2,
                    "准考证号": "P001",
                    "姓名": "张三",
                    "身份证号": "",
                    "科目编号": "20260629-01-01",
                    "手机号": "13800000000",
                    "邮箱": "a@example.com",
                    "报考岗位": "综合岗",
                    "学校": "四川大学",
                }
            ],
            mapping,
            [
                {"source_column": "报考岗位", "target_name": "报考岗位", "enabled": True},
                {"source_column": "学校", "target_name": "毕业学校", "enabled": True},
                {"source_column": "备注", "target_name": "备注", "enabled": False},
            ],
        )

        self.assertEqual(candidates[0]["mobile"], "13800000000")
        self.assertEqual(candidates[0]["email"], "a@example.com")
        self.assertEqual(candidates[0]["custom_fields"], {"报考岗位": "综合岗", "毕业学校": "四川大学"})

    def test_template_includes_optional_course_code_column(self):
        self.assertEqual(parser.TEMPLATE_HEADERS, ("准考证号", "姓名", "身份证号", "科目编号", "手机号码", "邮箱"))


if __name__ == "__main__":
    unittest.main()
