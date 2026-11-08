# 游戏设计判断与试玩验证：实施与结果

## 核验结果

六个候选仓库已定位原文和精确路径；MIT 4 个、Apache-2.0 1 个、未声明许可 1 个。未声明许可的候选不复用正文。没有安装第三方 pack、遥测或 runner。Nintendo studio-columns 是方向选择器，不是商用实现；任天堂旧地区链接失效，英国官方同章可读；MCV 为第三方分析；GDC 仅摘要核实、完整演讲未验证。见 [来源核验](game-design-skills-sources.md)。

## 现状缺口与实施变更

复用已有系统设计、关卡、试玩三个 owner、Skill catalog、隔离浏览器、被动录制、事务文本编辑与验收事实源。三份按需 reference 连接具体体验假设、事实／推断／真人未知、授权修订和定向复测。Art、UI、Feel 保留各自职责，没有新增四个 Agent、固定执行阶段、IR、数据库、评分或默认研究门禁。更新现有 catalog 描述以便按问题发现；宿主路由机制不变，模型实际会否正确选择／应用引用仍未验证。见 [现状审计与全部入口版本](game-design-skills-audit.md)。

## 实际运行结果

以下为本任务授权新增的合成可玩 fixture，不是四个 BGS 自主生成项目或产品美术范例。通过现有隔离 Chromium 与普通 CDP 鼠标／键盘输入实际运行，无状态注入或隐藏动作调用。预期来自明确的玩法规则，而非仅检查 DOM 存在或无异常。

| 场景 | 实际观察 | 发现、修订与复测 | 原始证据 |
|---|---|---|---|
| collection-before | Playing — Score 2 / 3; Misses 0 / 3 | 故意保留的生命周期缺陷：重开没有清理上一局掉落物，同一路径出现两次接取。 | [记录](evidence/game-design-skills/2026-10-31T09-16-13.949Z/6482d5b7-9681-4f47-af9e-56c3218e4c93.json) / [截图](evidence/game-design-skills/2026-10-31T09-16-13.949Z/6482d5b7-9681-4f47-af9e-56c3218e4c93.png) / [输入](evidence/game-design-skills/2026-10-31T09-16-13.949Z/collection-before-inputs.json) |
| collection-after | Playing — Score 1 / 3; Misses 0 / 3 | 用现有唯一匹配批量 edit 准备修订，再单次原子替换 fixture 文件；同一路径只发生一次接取。 | [记录](evidence/game-design-skills/2026-10-31T09-16-13.949Z/47cf0e81-0ee3-43d0-a633-67c722dadf3c.json) / [截图](evidence/game-design-skills/2026-10-31T09-16-13.949Z/47cf0e81-0ee3-43d0-a633-67c722dadf3c.png) / [输入](evidence/game-design-skills/2026-10-31T09-16-13.949Z/collection-after-inputs.json) |
| platformer | Lost — Airborne；Won — Grounded | 直接走入缺口失败；重开并跳跃后到达旗帜。未发现本路径需要再修改的规则错误。 | [记录](evidence/game-design-skills/2026-10-31T09-16-13.949Z/f658d80c-ee0a-4aad-a327-9a54164b3c28.json) / [截图](evidence/game-design-skills/2026-10-31T09-16-13.949Z/f658d80c-ee0a-4aad-a327-9a54164b3c28.png) / [输入](evidence/game-design-skills/2026-10-31T09-16-13.949Z/platformer-inputs.json) |
| puzzle | Middle produces 010; Undo restores 101.；Won — Lights 000 | 中间开关变 010；Undo 恢复 101；左右开关得到 000 并获胜。 | [记录](evidence/game-design-skills/2026-10-31T09-16-13.949Z/1fbdf56d-a566-49e6-8aaa-f7769a581c22.json) / [截图](evidence/game-design-skills/2026-10-31T09-16-13.949Z/1fbdf56d-a566-49e6-8aaa-f7769a581c22.png) / [输入](evidence/game-design-skills/2026-10-31T09-16-13.949Z/puzzle-inputs.json) |
| defense | Lost — Incoming top lane; Budget 0; Defended 0；Won — Incoming top lane; Budget 0; Defended 1 | 错误路段建塔未能防御；重开后正确路段建塔拦截成功。 | [记录](evidence/game-design-skills/2026-10-31T09-16-13.949Z/20c256f5-419e-4b68-bfdb-49ca915f4a10.json) / [截图](evidence/game-design-skills/2026-10-31T09-16-13.949Z/20c256f5-419e-4b68-bfdb-49ca915f4a10.png) / [输入](evidence/game-design-skills/2026-10-31T09-16-13.949Z/defense-inputs.json) |

最后一轮五次观察（四品类，收集前后各一次）共 18.11 秒，浏览器测试 1 项／25 个断言通过。被动录制器仍写 gameplayVerdict=not-evaluated，采集成功不代表体验通过。完整 [结果](evidence/game-design-skills/2026-10-31T09-16-13.949Z/results.json)、[源版本与 patch](evidence/game-design-skills/2026-10-31T09-16-13.949Z/repair.json)、[成本](evidence/game-design-skills/2026-10-31T09-16-13.949Z/cost-and-scope.json)。

### 调查过程中的失败与修正

- 首次 Bun 直接 Playwright CDP 连接在 30 秒超时，未进入游戏。已有隔离浏览器健康检查通过，随后改用仓库现有 WebSocket/CDP 输入模式完成运行。底层 Playwright 超时原因未定位；没有修改生产 Playwright。
- 第一轮成功样本截图显示 fixture 状态行被视口部分裁切。缩减该测试页面的字号／留白，并加入实际 bounds 断言后重新通过；不是为了主观美化而重跑。保留[前轮记录](evidence/game-design-skills/2026-10-31T09-13-44.406Z/results.json)。
- 重开缺陷是受控、故意注入的本地回归；它证明观察、现有 edit 准备、原子替换和复测可贯通，不证明模型自主发现／修好真实游戏。未手改 BGS 生成项目。

### 检查命令及结果

```bash
BEEGAME_TEST_REAL_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/gameplay-experience.browser.test.ts
BEEGAME_TEST_REAL_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/preview-test-browser.test.ts -t "real isolated browser opens"
bun test packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts packages/agent-workflow-server/src/beegame/preview-test-recording.test.ts
bun run --cwd packages/agent-workflow-server typecheck
python3 /Users/nswell/.codex/skills/.system/skill-creator/scripts/quick_validate.py <modified-skill-directory>
git diff --check
```

浏览器场景 1 项通过；已有浏览器健康检查 1 项通过；已有采集检查 2 项通过、2 项因显式开关未运行，不能计为通过。三个 Skill 格式检查通过，入口相对链接均存在。最终后端类型检查与 git diff --check 均通过。

## 上下文与成本

catalog 仍为 21 项，新增 Skill 入口、BGS 生产阶段、模型调用与外部依赖均为 0。三份 reference 仅按具体问题读取；本地浏览器测试没有调用 Agent，不等于已经测试模型的实际选用行为。

- game-systems-designer-expert: 2361 → 2652 bytes（+291）。
- game-level-designer-expert: 3367 → 3703 bytes（+336）。
- game-playtest-performance: 8126 → 8159 bytes（+33）。
- 按需引用 experience-questions.md: 2327 bytes。
- 按需引用 player-guidance-and-progression.md: 2635 bytes。
- 按需引用 experience-validation.md: 3568 bytes。

字节变化不是 API tokens；18 秒只指最后一轮浏览器运行，不含调研、首次 30 秒连接失败和前轮运行。本次 Codex 调研编写 tokens 没有可归属 BGS 项目的现有计数，未知。没有真实模型前后对照，不能声称实际总 tokens、耗时或品味已改善。

## 未解决内容与下一步

- 真实 BGS Agent 的选用、应用、修订质量及是否降低上下文成本：未验证，未付费调用或重启／恢复项目。
- 四样本只验证当前 Web fixture 的特定状态和输入，不证明完整 BGS 构建质量，或 Phaser／Three.js／XR 的全部行为与性能。
- 真人理解、乐趣、长期变化／难度、审美与连续动作手感：未验证；没有参与者、问卷或模拟情绪证据。
- 新场景没有采集视频或集成音频；两项原有媒体相关用例仍跳过。截图和游戏事件只能支持对应范围的结论。
- 优先在下一次单独授权的真实 BGS 任务中挑一个具体体验假设，检查引用是否实际被读、是否改变修订决策，并保留真实玩家或运行证据；不再增加全量评审和评分循环。

## 本轮修改文件

- `.beegame/skills/bgs-game-skills/game-systems-designer-expert/SKILL.md`
- `.beegame/skills/bgs-game-skills/game-level-designer-expert/SKILL.md`
- `.beegame/skills/bgs-game-skills/game-playtest-performance/SKILL.md`
- `.beegame/skills/bgs-game-skills/game-systems-designer-expert/references/experience-questions.md`
- `.beegame/skills/bgs-game-skills/game-level-designer-expert/references/player-guidance-and-progression.md`
- `.beegame/skills/bgs-game-skills/game-playtest-performance/references/experience-validation.md`
- `packages/agent-workflow-server/src/beegame/fixtures/gameplay-experience.ts`
- `packages/agent-workflow-server/src/beegame/gameplay-experience.browser.test.ts`
- `docs/research/game-design-skills-sources.md`
- `docs/research/game-design-skills-audit.md`
- `docs/research/game-design-skills-results.md`

evidence/ 保存本任务要求的观测、输入、截图、源哈希及 inventory/cost 数据；它们不是新运行时事实数据库。第三方原文快照仅保留在本代理 backups/game-design-skills-research-20261031，未导入生产 Skills 或执行。

最终五次观测的 `*-source.html` 输入副本已留存，并逐一验证与运行记录 SHA-256 相同。副本不是修改后的替代证据；复测版本由独立 collection-after 输入与 patch 记录绑定。
