import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateExamSessions,
  isExamTaskEnded,
  matchesExamTask,
  resolveCandidateTaskContext,
  resolveUnifiedExamCode,
} from "../web/exam_task_view_model.mjs";

const sessions = [
  {
    taskId: "task-1",
    projectName: "考试甲",
    sourceAccount: "account-a",
    sessionType: "formal",
    session_id: "1001",
    name: "考试甲",
    status: "success",
  },
  {
    taskId: "task-1",
    projectName: "考试甲",
    sourceAccount: "account-a",
    sessionType: "trial",
    session_id: "1002",
    name: "考试甲-试考",
    status: "running",
  },
  {
    taskId: "task-2",
    projectName: "考试甲",
    sourceAccount: "account-b",
    sessionType: "formal",
    session_id: "2001",
    name: "考试甲",
    status: "failed",
  },
];

test("aggregates formal and trial sessions by taskId instead of exam name", () => {
  const tasks = aggregateExamSessions(sessions);

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].formalSession.session_id, "1001");
  assert.equal(tasks[0].trialSession.session_id, "1002");
  assert.equal(tasks[0].status, "running");
  assert.equal(tasks[1].status, "failed");
});

test("marks a task successful only when all existing sessions succeed", () => {
  const tasks = aggregateExamSessions([
    { ...sessions[0] },
    { ...sessions[1], status: "success" },
  ]);

  assert.equal(tasks[0].status, "success");
});

test("orders exam tasks by latest formal exam start time first", () => {
  const tasks = aggregateExamSessions([
    {
      taskId: "task-late",
      projectName: "晚场考试",
      sessionType: "formal",
      session_id: "3001",
      name: "晚场考试",
      start: "2026-07-20 09:00",
      status: "success",
    },
    {
      taskId: "task-missing-formal-time",
      projectName: "未填写正式时间",
      sessionType: "trial",
      session_id: "4002",
      name: "未填写正式时间-试考",
      start: "2026-07-01 09:00",
      status: "success",
    },
    {
      taskId: "task-early",
      projectName: "早场考试",
      sessionType: "formal",
      session_id: "2001",
      name: "早场考试",
      start: "2026-07-10 09:00",
      status: "success",
    },
  ]);

  assert.deepEqual(tasks.map((task) => task.taskId), [
    "task-late",
    "task-early",
    "task-missing-formal-time",
  ]);
});

test("keeps task progress from sessions for exam list status display", () => {
  const tasks = aggregateExamSessions([
    {
      taskId: "task-progress",
      projectName: "进度考试",
      sessionType: "formal",
      session_id: "6001",
      name: "进度考试",
      progress: 50,
      status: "success",
    },
    {
      taskId: "task-progress",
      projectName: "进度考试",
      sessionType: "trial",
      session_id: "6002",
      name: "进度考试-试考",
      progress: 50,
      status: "success",
    },
  ]);

  assert.equal(tasks[0].progress, 50);
});

test("resolves unified exam code from explicit config or uniform exam url", () => {
  assert.equal(resolveUnifiedExamCode({ config: { unifiedExamCode: "E5678" } }), "E5678");
  assert.equal(
    resolveUnifiedExamCode({ config: { examUrl: "https://eztest.org/exam/1234/uniform/login/" } }),
    "E1234",
  );
});

test("aggregates unified exam code for exam list project column", () => {
  const tasks = aggregateExamSessions([
    {
      taskId: "task-unified",
      projectName: "统一考试项目",
      sessionType: "formal",
      session_id: "7001",
      name: "统一考试项目",
      status: "success",
      config: { examUrl: "https://eztest.org/exam/1234/uniform/login/" },
    },
  ]);

  assert.equal(tasks[0].unifiedExamCode, "E1234");
});

test("detects exam tasks ended by formal exam time", () => {
  const tasks = aggregateExamSessions([
    {
      taskId: "task-ended",
      projectName: "已结束考试",
      sessionType: "formal",
      session_id: "5001",
      name: "已结束考试",
      start: "2026-07-01 09:00",
      end: "2026-07-01 10:30",
      status: "success",
    },
    {
      taskId: "task-active",
      projectName: "未结束考试",
      sessionType: "formal",
      session_id: "5002",
      name: "未结束考试",
      start: "2026-07-08 09:00",
      end: "2026-07-08 10:30",
      status: "success",
    },
    {
      taskId: "task-missing-time",
      projectName: "无正式时间考试",
      sessionType: "formal",
      session_id: "5003",
      name: "无正式时间考试",
      status: "success",
    },
  ]);
  const endedTask = tasks.find((task) => task.taskId === "task-ended");
  const activeTask = tasks.find((task) => task.taskId === "task-active");
  const missingTimeTask = tasks.find((task) => task.taskId === "task-missing-time");

  assert.equal(isExamTaskEnded(endedTask, new Date("2026-07-06T12:00:00+08:00")), true);
  assert.equal(isExamTaskEnded(activeTask, new Date("2026-07-06T12:00:00+08:00")), false);
  assert.equal(isExamTaskEnded(missingTimeTask, new Date("2026-07-06T12:00:00+08:00")), false);
});

test("searches all task and session identifiers", () => {
  const task = aggregateExamSessions(sessions)[0];

  assert.equal(matchesExamTask(task, "1002"), true);
  assert.equal(matchesExamTask(task, "account-a"), true);
  assert.equal(matchesExamTask(task, "考试甲-试考"), true);
  assert.equal(matchesExamTask(task, "不存在"), false);
});

test("resolves only the valid requested session", () => {
  const task = { sessions: sessions.filter((item) => item.taskId === "task-1") };
  const formal = resolveCandidateTaskContext(task, "1001");
  const trial = resolveCandidateTaskContext(task, "1002");

  assert.deepEqual(formal.sessions.map((session) => session.session_id), ["1001"]);
  assert.equal(formal.selectedSession.session_id, "1001");
  assert.deepEqual(trial.sessions.map((session) => session.session_id), ["1002"]);
  assert.equal(trial.selectedSession.session_id, "1002");
  assert.deepEqual(resolveCandidateTaskContext(task, "other"), { sessions: [], selectedSession: null });
  assert.deepEqual(resolveCandidateTaskContext(task), { sessions: [], selectedSession: null });
});
