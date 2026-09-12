# Reviewer 不含 r1 的项目 CLI 解耦安装验收

日期：2026-09-11（Asia/Shanghai）。用户明确授权本轮工程安装，并要求仅操作项目内 CLI，不检查或操作系统安装的 Claude Code。**项目 CLI 安装及离线验收完成；语义质量门槛仍未通过，旧协议不退役。**

## 安装结果

安装目标仅为工作树 `bee-game-studio/.worktrees/game-ir-isolation-recovery/dist`。复用已冻结且完成回归的 `/private/tmp/reviewer-decouple-v2-FEXBpv/dist`，没有重新构建或清空目标目录。

- 原 `cli.js` SHA-256：`ebfd71632bbd85ff0e8263231f57f6e0d7e9e8acdb63f33e98649bcee37f74c9`。
- 现 `cli.js` SHA-256：`e75e4c1e35fab0bbdac561333b144da549b58f417a579572823c1289fdfb0b87`，与已验证的解耦隔离构建一致。
- 共核验 1281 个源构建文件：替换并预先备份 1 个文件（`cli.js`），新增 650 个，630 个原样保留。安装前目标已有的 2581 个文件全部仍存在，没有清理旧 chunk 或其他旧文件。
- 新构建文件先到位，CLI 入口最后通过原子重命名替换；测试后全部 1281 个源文件摘要再次逐项一致。
- 对源构建 JS/map 及生产源码检查 r1 实验模块、标识和两句新增提示，均无命中；13 项对照同时确认生产基础提示与原基线一致。r1 未进入本次安装。

未检查、修改或更新系统 Claude Code；未更改默认模型、重启既有服务或提交 Git。这里完成的是项目磁盘构建及新启动 CLI 子进程验收，不宣称已运行的服务进程被热更新。

## 安装后验收

| 范围 | 结果 |
|---|---|
| 默认项目入口的 Reviewer 模块、host、公共基础设施及本地 Author → Reviewer → Revision → Reviewer 交接 | 214 passed / 0 failed；24 文件、1624 断言、37.54 秒 |
| 原解耦前准入对照 | 13 项行为、模型侧 schema 与基础提示逐项一致 |
| GLM-5.3-Flash、GLM-5.3、MiniMax-M3 已有响应本地重放 | 每组 2 个模拟请求；准入结果、用量、模型侧工具 schema 与既有记录一致 |
| 安装产物完整性 | 测试后 1281 个源文件摘要全部一致，旧 CLI 备份摘要与安装前一致 |
| 源码差异与实验隔离 | `git diff --check` 通过；生产源码无 r1 引用或新增提示 |

测试执行环境显式移除 `BEEGAME_REVIEW_TEST_CLI`，原生集成用例因此采用项目默认 `dist/cli-bun.js`；三组重放也显式运行此入口。不是继续测试隔离 CLI。与[安装前回归](foundation-reviewer-mainline-regression-2026-09-11.md)重叠的用例不累加为新覆盖。

上述模型重放只读取已有捕获响应，由本机回环模拟服务返回；使用假凭据，没有真实模型调用或新增费用，没有发送真实八文档、运行保留样本或启动真实下游修订。本轮未重复运行前一轮已通过的 19 项路由、91 项前端和 TypeScript 检查，不将其冒充本轮重跑。

## 备份与证据

持久目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/output/reviewer-decouple-install-20260911`。

- `installation-preflight.json`：安装前目录清单、1281 项安装计划及原摘要。
- `installation.json`：安装结果、逐文件摘要、替换/新增/不变动作。
- `previous-dist-files/cli.js`：安装前 CLI 原文件；没有覆盖此前其他批次备份。
- `acceptance.json`、`default-entry-regression.log.json`、`admission-parity.log.json`：默认入口验收结果与完整测试输出。
- `installed-model-replay.json`、`installed-model-replay.log.json`：三组本地重放检查。
- `install.ts`、`acceptance.ts`、`replay.ts`：本轮使用的脚本副本，仅作复核；带一次性保护，不应直接重复安装。

如需回退，应先确认项目 CLI 仍是本次 `e75e4c…` 且没有后续安装，再将已核验的旧 CLI 备份原子恢复到项目 `dist/cli.js`。旧构建文件均保留，本次新增 chunk 可先保留；不需要清空目录。**本轮没有执行回退。**

## 保留的门槛

本次工程安装独立于语义质量验收，不以测试全绿替代模型判断正确。r1 两次 GLM-5.3 和一次 Flash 的失败结论继续有效；不启用 r1、不追加付费批次、不推进保留样本/真实八文档，也不删除旧协议。旧协议退役仍按[既有门槛](foundation-reviewer-v2-retirement-readiness-2026-09-10.md)执行。
