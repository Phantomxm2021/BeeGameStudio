# Foundation 三模块离线联合验收

日期：2026-09-07。工作树：`game-ir-isolation-recovery`。

结论：本轮固定输入、模拟模型的联合验收通过。补齐了真实 Author 起点的完整公共生命周期贯通证据。未发现需要修改生产逻辑的确定性故障；不等同于真实模型或完整游戏流水线已验收。

## 范围与判定规则

验收 Author → Reviewer → Revision → Reviewer 的模块协作、恢复、发布与计费幂等，以及公共接口边界。只使用临时项目、本地确定性 native 协议进程和模拟计费；不调用真实模型，不修改生产逻辑，不部署。

完整贯通必须使用真实 Author 发布的文档与公共结果，不能预置 Author result，也不能在 Author 完成后改写导出文件来制造缺陷。修复必须产生实际内容变化，并由真实 Reviewer 的确定性检查接受。

当前业务终点是复核通过、接受文档已发布、`needs_action` 等待 Checklist 交接。不是 Checklist 自动执行，更不是完整游戏交付。

## 已验证的证据

以下分组可能包含重复测试，不将各行简单相加作为独立测试总数。

| 验收组 | 结果 | 主要证据 |
| --- | --- | --- |
| 新增真实三模块贯通 | 1 pass / 0 fail，44 断言 | 真实 Author 结果、一次实际章节修复、复核通过、不可变导出、控制器重建后无重复调用或发布 |
| 现有公共集成 | 25 pass / 0 fail，5 文件 | 真实 Author 发布与鉴权恢复；真实 Reviewer/Revision 本地进程闭环；应用路由公共端口交接 |
| 接受文档发布与当前版本存储 | 22 pass / 0 fail，2 文件 | 精确字节发布、同 ID 幂等、用户编辑冲突拒绝、部分事务恢复、版本切换与路径安全 |
| 恢复与候选保留 | 20 pass / 0 fail，8 文件 | 同轮保留 PASS 内容、下一轮保留旧候选、恢复缺失发布标记、候选授权拒绝 |
| 生命周期与计费持久化 | 35 pass / 0 fail，5 文件 | 发布后检查点丢失恢复、只重试可操作工作、晚到 usage、计费故障恢复、错误计费回执不结算 |
| 公共/私有边界 | 17 pass / 0 fail，9 文件 | 三模块公共入口、脱离宿主运行、生产调用只能经公共接口 |
| Revision 公共生命周期 | 32 pass / 0 fail，7 文件 | 公共输入、控制、handle、元数据与私有执行持久化 |
| 旧链路退休 | 6 pass / 0 fail，3 文件 | 旧入口拒绝、旧执行文件缺席、应用 bundle 不含旧实现 |
| 普通 Checklist/resource 路径 | 33 pass / 0 fail，7 文件 | 现行 worker、资源阶段、解析与阶段转换不受影响 |

主控日志：`/private/tmp/three-module-acceptance-{main,publication,recovery,durability}.log`。

主控上述五组（新增贯通及前四组）共 103 个不同用例通过。其余边界分组为补充证据，不并入此去重计数。最终类型检查、`git diff --check` 及应用 bundle 退休边界检查均通过。

## 证据边界

- 原有 Reviewer → Revision → Reviewer 集成测试预置 Author 结果，因此只能证明后半段，不单独计作三模块端到端。
- 故障恢复证据包含持久状态故障注入、重新创建实例以及本地进程控制；不将其等同于操作系统断电或所有时刻的硬杀进程测试。
- 测试代码允许读取固定 fixture 和私有测试辅助数据；生产边界测试验证这些依赖不进入生产执行。不能将测试辅助依赖误报为生产跨模块调用。
- 本轮不评估真实模型的文档质量、修复质量、供应商网络可用性或实际计费服务。
- Revision 文档修复保留既有开放式重试策略；模拟进程协议不合法时会持续尝试，直到停止或基础设施故障。本轮没有修改该策略。下一轮真实模型烟测应先明确运行时长和费用停止条件，不能直接沿用无限等待。

## 完整贯通补充

新增 `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-author-review-revision.integration.test.ts`。执行真实三个公共模块及真实 controller，仅替换本地 native 协议进程和计费服务。

1. 从一致的离线文档集出发，只在 Author 输入侧删去 `technical.supported_actions` 的 `dash`。不预置 Author 结果，不在发布后修改导出文件。
2. Author 实际完成八份文档，Reviewer 产生恰好一条 contract issue，修复目标为 Technical 的 `input_interaction`，上游依据为 GDD 的 `player_actions`。
3. 模拟 Revision 进程核对真实下发的文档路径、章节 ID 和内容；返回值只允许补回该 `dash`。真实 Revision 校验并生成候选；其余七份文档摘要不变。
4. 真实 Reviewer 复核通过；应用发布已接受文档。原 Author 八份导出文件仍逐一匹配原摘要。
5. 重复观察、显式 resume、销毁并重建 controller 后，接受结果、文档 revision 和当前发布指针保持不变。三个模块的 runtime 与计费调用计数均不增加；Author 执行八次，Revision 执行一次。

最终命令（在 `packages/agent-workflow-server` 执行）：

```sh
bun test src/beegame/delivery-workflow/foundation-author-review-revision.integration.test.ts
bun run typecheck
bun test src/beegame/retired-foundation-revision.test.ts
git diff --check
```

贯通最终日志：`/private/tmp/three-module-acceptance-e2e-final.log`，1 pass / 0 fail，44 断言，23.12 秒。增强重建校验前的独立运行也通过（22.52 秒）。测试样例开发期间的协议字段/计费回执问题仅修正于测试代码；没有用放宽生产验证规则使其通过。

本轮保留的新增文件只有验收测试、两个离线 native fixture 和本记录。未提交、未部署、未调用真实模型。下一阶段建议为获得确认后的少量、有运行时间与费用停止条件的真实模型烟测。
