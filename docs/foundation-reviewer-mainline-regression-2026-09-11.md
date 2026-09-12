# Reviewer 工程主链路回归与当前落点

后续更新（2026-09-11）：已获独立授权完成**不含 r1 的项目 CLI 解耦安装验收**，默认入口 214 项回归通过，项目安装摘要现为 `e75e4c…`。详见[安装验收记录](foundation-reviewer-decouple-install-2026-09-11.md)。下文保留安装前这一轮的结果和摘要，不代表最新安装状态；语义失败与旧协议退役门槛不变。

日期：2026-09-11。用户要求回到 Reviewer 环节继续工作。本轮停止扩展模型筛查，回归现有生产基线及应用入口；**没有调用付费模型，新增模型费用 0，没有修改生产实现或启用 r1。**

## 本轮结果

| 检查范围 | 结果 | 说明 |
|---|---:|---|
| Reviewer 私有模块、公共基础设施、host、交付链接及本地 Author → Reviewer → Revision → Reviewer 链 | 214 passed / 0 failed | 24 文件、1624 断言、38.80 秒；使用已冻结的解耦隔离 CLI |
| 当前已安装 CLI 的四组原生集成测试 | 31 passed / 0 failed | 4 文件、594 断言、25.59 秒；是上项相关用例换安装入口重复验证，不算新增 31 个独立用例 |
| 公共入口路由与审查副本 API | 19 passed / 0 failed | 2 文件、161 断言；覆盖展示、停止/恢复、重复/不明启动、原项目保护与产物访问边界 |
| 前端适配层及审查副本界面 | 91 passed / 0 failed | 2 文件；包含 Reviewer 状态映射、创建副本、防重复请求以及同文件中的既有适配回归 |
| TypeScript | 通过 | `scripts/reviewer-reliability/tsconfig.json`，覆盖配置中包含的源码和实验执行脚本；不冒充完整前端类型检查 |
| 差异及实验隔离 | 通过 | `git diff --check`；生产 `packages/apps/src` 无 r1 实验模块或标识引用 |

全部测试使用临时工作区、模拟响应/假凭据或进程内路由，没有读取真实登录会话、发送真实八文档、运行保留样本或启动真实下游修订。链路测试中的 Author/Revision 仅为本地模拟交接验证。

首轮受限环境中 183 项通过，31 项在 `127.0.0.1:0` 模拟服务器监听时返回 `EADDRINUSE`，尚未进入 Reviewer 断言。允许本机回环监听后完整复跑，214 项全部通过。前端首次启动也因 Vite 临时配置缓存写入 `EPERM` 中止，获得所需本地缓存权限后 91 项通过。没有把这些环境失败当作产品缺陷，也没有为消除失败修改断言或实现。

## 已回归的主要边界

- 读取只针对复制输入；引用必须绑定原文；分页未读不能直接发布最终报告。
- 工具名单、参数约束、同 ID 去重、调用记录和重复无进展停止保持有效。
- 取消、延迟末尾用量、整批工具与最终报告同轮结束、预算不可通过恢复清零。
- 未认证不启动原生任务或产生用量；结算恢复复用原事件，不重新调用模型。
- 发布/停止竞争、丢失 orchestration 提交、未知启动句柄、重复观察不会隐式启动下一阶段。
- 新旧协议兼容、旧历史读取与回退仍保留；v2 task/tools 依赖图不加载旧 action adapter。
- 公共端口依赖边界、项目审查副本入口、停止/恢复和前端防重复操作保持有效。

## 三个不同的状态

| 维度 | 当前状态 |
|---|---|
| 工程链路 | 本轮上述回归通过，未发现需要修复的工程回归 |
| 源码与安装产物 | 解耦源码/隔离 CLI 已验证；安装版仍是此前 native-v2 构建，两者不是同一摘要，本轮未部署更新 |
| 模型审查质量 | 仍未通过；r1 两次 GLM-5.3 与一次 Flash 均有否决性问题，不能用工程测试覆盖语义失败 |

安装版 `dist/cli.js` SHA-256 仍为 `ebfd71632bbd85ff0e8263231f57f6e0d7e9e8acdb63f33e98649bcee37f74c9`；解耦隔离 bundle 仍为 `e75e4c1e35fab0bbdac561333b144da549b58f417a579572823c1289fdfb0b87`。两者执行前后未变；本轮未安装、重启或改变默认模型。

语义结论继续分别以 [GLM-5.3/r1](foundation-reviewer-r1-semantic-glm53-2026-09-11.md) 和 [Flash/r1](foundation-reviewer-r1-semantic-glmflash-2026-09-11.md) 为准。r1 只在实验目录/测试入口中，未进入生产提示。

## 接下来工作的边界

已完成这轮工程回归，不为制造进度添加新的提示补丁、事实提取流程、审查代理或强制复核回合。后续实施需要一个明确的 Reviewer 产品/工程目标，不能把“继续”自动解释成部署 r1、重开付费批次、发送真实文档或清理旧协议。

剩余事项分开处理：源码解耦产物的安装验收属于工程发布事项；语义漏报/误报/证据相关性属于另行设计的质量验证；保留样本、真实 Reviewer-only 验收和旧协议退役仍受原门槛约束。本轮没有宣布 Reviewer 整体已交付完成。

## 复现命令

在仓库根目录执行，原生集成测试需允许本机回环监听：

```sh
BEEGAME_REVIEW_TEST_CLI=/private/tmp/reviewer-decouple-v2-FEXBpv/dist/cli-bun.js bun test packages/agent-workflow-server/src/beegame/stage-modules/foundation-reviewer/private/tests packages/agent-workflow-server/src/beegame/foundation-reviewer-host.test.ts packages/agent-workflow-server/src/__tests__/foundation-reviewer-public-infrastructure.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-author-review-revision.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-link.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-public-retirement.test.ts
bun test packages/agent-workflow-server/src/__tests__/foundation-authoring-public-routes.test.ts packages/agent-workflow-server/src/__tests__/review-project-copy-route.test.ts
bun node_modules/typescript/bin/tsc --noEmit --pretty false -p scripts/reviewer-reliability/tsconfig.json
```

在 `apps/frontend` 目录执行（仅测试模拟数据，需允许 Vite 缓存写入）：

```sh
bun run test:run src/services/beeGameAdapter.test.ts src/components/Demiurge/Landing/ProjectHistoryModal.test.tsx
```
