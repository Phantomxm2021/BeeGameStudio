# 八文档稳定化：正常 Balance 审查的几何依据

工作树：`game-ir-isolation-recovery`，起点 `fba480adfc210f22265f05e6f14e410cc9687a2a`。IR 集成工作树保留，未合入其重开审查功能。

## 本次修复

正常 `SEM.progression_balance_coherence` 原先只读取 Level 的 `content_matrix`，无法比较 Balance 派生数值与 Level 的几何定义。已有 Level 契约明确将坐标、路径、格位和触发范围的权威值归于 `material.world-structure-diagram`。

本次将 `world_structure` 和 `material.world-structure-diagram` 加入该检查，并要求核对距离、路径长度、格位、触发范围及时间推导。仍使用原有十项审查、Issue 证据引用和修订复核机制；不添加项目专属分支、重开系统或新的质量平台。

## 验证与边界

- 新回归先在原实现失败，补齐依据后通过。
- 检查实际 packet 包含权威图表字节；修改图表会改变 packet 身份，旧摘要与新字节不匹配时拒绝。
- 路径行进时间、网格攻击距离两个合成案例，经正常 Reviewer 发布、Revision 候选构造和 Reviewer 定向复核，保留 Level 依据并只改变 Balance 授权章节。
- 跨模块测试位于 Revision 交接测试侧，不放宽 Reviewer 的依赖隔离规则。
- 上述语义 Issue 和修正文案均由测试预置；没有真实模型生成修复，也不以模拟 PASS 证明语义质量。旧项目、已接受文档、历史收据均未改写。

本次未启动真实模型、未重启服务、未部署。八文档整体稳定性尚未验收完成。下一步应在明确真实调用与停止边界后，以保留的实际漏检样本及不同玩法的新项目验证发现、修复和复核效果；不恢复 DSL/IR 实现。

## 测试记录

- Reviewer/Revision 扩大回归：110 文件、571 用例，首次 565 pass / 6 fail。一个失败为新增跨模块测试放置违反 Reviewer 隔离，已移动测试；其余五个为沙箱禁止 Darwin `ps` 身份读取。
- 修正后隔离测试与两个几何交接案例：3 pass / 0 fail。获得执行权限后进程身份文件重跑：6 pass / 0 fail。不是一次完整全绿的扩大回归，不合并重复用例数。
- 最终语义审计文件：13 pass / 0 fail，59 断言；新增交接案例：2 pass / 0 fail。最终服务端类型检查和 `git diff --check` 通过。
