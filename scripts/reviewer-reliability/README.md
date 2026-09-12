# 旧 Reviewer 基准已归档

本目录原有 host-mediated、native-tools-v2、GDD-led 执行器、候选注入器及专属脚本已从活动代码中移除。旧命令不可再运行，旧指标不代表当前原生文件审阅的验收结果。

原文与逐文件 SHA-256 清单见 [退役源码归档](../../archive/reviewer-pre-native-file/README.md)。归档以 `.txt` 保存，刻意不作为可执行或可导入代码，不会自动发现旧测试。历史付费结果、凭据和用户项目数据不在本次删除范围。

当前离线验证：

```sh
bun test packages/agent-workflow-server/src/__tests__/foundation-reviewer-public-infrastructure.test.ts packages/agent-workflow-server/src/beegame/stage-modules/foundation-reviewer/private/tests packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-multisource-evidence.integration.test.ts
```

历史兼容测试仅保障旧结果可读、绑定及防篡改，不代表旧策略仍可执行。新模型语义评测须面向 `native-file-audit.v1`，另行设计执行器并获得付费授权；旧额度和旧执行 claim 不可复用。
