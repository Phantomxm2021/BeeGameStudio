# Foundation 旧实现残留清理

用户明确批准：不影响当前运行的旧实现及其专用测试一并删除，不因测试引用而保留旧方案。

## 已清理

- Author：删除 `private/domain/foundation-authoring-recovery.ts` 和 `recovery-values.ts`，合计 310 行。前者无生产调用，后者仅被前者使用；同时删除 `foundation-authoring-domain.test.ts` 中只覆盖旧实现的四项测试及其 import，保留其余现行行为测试。
- Reviewer：删除 `worker-schemas.ts` 中旧 terminal identity、两个旧 terminal schema、无生产调用的诊断/targeted payload/schema 副本。
- 将外层语义测试改为当前 model/targeted payload 契约：保留严格结构、空 ISSUES 拒绝、服务端字段拒绝、旧 shared terminal 拒绝；验证 supporting 数组必填且允许为空，以及 targeted PASS/FAIL 的诊断约束。
- 删除只比较两份重复 schema 的迁移等价测试，保留实际 candidate scope 验证。
- 删除三个旧 Foundation 类型别名；历史测试直接引用 `HistoricalAuthorDraftState`。

## 保留的当前保护

- 当前 Author checkpoint/lifecycle/recovery-policy：身份与 receipt 校验、已提交文档恢复、显式重试、停止、不得重复执行。
- 旧执行链拒绝及遗留进程识别保护；它们防止旧方案重新运行，不是兼容执行旧方案。
- 当前模块业务规则与公开接口，不修改真实项目文档、运行结果或计费数据。

## 恢复与验证

Author 两份删除文件已备份在 `/tmp/author-recovery-backup.u8lcIf/`；其余改动保留在当前未提交工作树中。未提交或部署。

前一批清理已验证 Reviewer 344、Author 138、外层 100、契约与公开多来源集成 4 项全部通过，根目录类型检查通过。Author 138 包含本次获准删除的四项旧专用测试，不能把该旧数量当作删除后的测试结果。

删除后最终 Author 与外层回归：234 pass、0 fail、4131 assertions、25 files（Author 134 + 外层 100），日志 `/private/tmp/foundation-author-cleanup-final-tests.log`。根目录类型检查通过，日志 `/private/tmp/foundation-author-cleanup-final-tsc.log`。旧恢复模块及函数在 Author 源码中的引用扫描为零，`git diff --check` 通过。
