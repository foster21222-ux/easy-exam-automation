# 业务需求保存后建批次草稿刷新设计

日期：2026-07-27

## 问题

业务需求保存接口同时返回最新任务、工作流和按当前业务需求重新生成的
`batchDraft`。页面先用这个新草稿渲染“建批次”，随后又调用
`renderOperationBatchFromTask(result.task)`，把任务中历史失败尝试保存的
`operationBatch.draft` 重新渲染到同一区域，导致用户看到旧批次名称。

后端创建接口仍会从当前 `businessRequirement.batch_name` 重新构建草稿，因此
问题限定为保存后的前端显示被旧缓存覆盖。

## 方案

采用最小前端修复：

- 保留 `renderProjectDetail(result.task)`，用于刷新项目详情和通用任务状态；
- 保留随后使用响应 `batchDraft` 的 `renderProjectWorkflow(...)`；
- 删除其后的冗余 `renderOperationBatchFromTask(result.task)`，避免旧草稿覆盖新草稿；
- 不修改后端持久化结构，不自动覆盖历史失败草稿，不改变创建接口的数据来源。

## 验收

1. 业务需求保存响应包含新 `batchDraft`、任务仍含旧 `operationBatch.draft` 时，
   页面最终显示新 `batchDraft` 的批次名称。
2. 项目刷新后仍从 `/operation-workflow` 显示当前业务需求批次名称。
3. 历史草稿继续保留用于失败记录，不参与保存完成后的最终显示。
4. Node、Python 全量测试通过，8765 健康检查返回 `{"ok":true}`。
