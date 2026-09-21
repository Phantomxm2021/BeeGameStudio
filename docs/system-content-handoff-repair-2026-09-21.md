# BGS 系统交接修复

范围：仅修改 BGS。mushroom-platform-quest--a896be58bebc 作为只读样本；本轮未修改其源码、资源、Scene/UI/HUD、配置或 workflow 状态，也未撤销此前的项目改动。

## 已证实问题与修改

- Implementation 的交接只有内容索引、ID 和 revision，没有上游格式文件及内容检查入口。现在实际 dispatch 传递同一份格式文件路径、既有校验命令及可选只读查询命令，覆盖初次、修复和变更任务；不复制整份格式或 Manifest。
- transcript 的事件 151 读取 328.7 KiB Scene 失败，超过工具 256 KiB 上限。既有内容 CLI 增加 --inspect：列文件、列指定文件的节点 ID、按 --node 返回原始节点。查询不校验/重写整个资源包，不裁剪节点字段，不跟随越界文件或符号链接。
- 事件 3538 的 /tmp/claude/cdp-test.mjs 写入被项目边界拒绝，但交接未展示 protectedPaths。现在明确项目内写入边界及受保护路径，权限本身不变。
- 内容结构验收不能代表运行验收。现有校验输出明确 scope=content-contract-and-references、runtimeVerified=false；不改变原有 valid 判定，不新增游戏测试门禁。

## 验证

真实项目只读检查：

- Level 1-1：518 个节点，源文件 336,600 bytes；节点索引 6,785 bytes，首个原始节点查询响应 476 bytes。
- 指定节点与原 JSON 完全一致；查询前后原文件字节不变。
- 16 个内容文件仍通过现有结构/引用校验（本次 66 ms）；这不表示关卡可达性或游戏运行通过。
- workflow 仍为 stopped，没有模型调用、付费实验或自动继续。

离线测试覆盖真实 controller dispatch 到 worker.start 边界、初次/修复/变更交接、权限提示、大文件查询、未知/重复节点、越界读取及原文件不变。后端 TypeScript 检查通过。

## 未做与边界

不修改生成项目来掩盖系统问题，不增加固定工具顺序、自动修关卡、额外审核 Agent 或自动重试。构建类型错误、摄像机消费者实现错误、关卡与物理不匹配是 Agent 产物问题，现有证据不足以宣称由以上系统缺口全部导致；这些修改也不证明原游戏已经可验收。

未重启服务。新交接代码需要运行中的后端重新加载后才会用于后续 dispatch；不会追改已经运行过的 Agent 上下文。
