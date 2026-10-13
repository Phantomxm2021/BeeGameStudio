# BGS 运行能力开关

控制入口沿用「系统设置 → 能力」与 GET/PUT /api/runtime-settings。
权限沿用 runtime_settings.manage。配置存入既有平台 settings JSON 或本地
runtime-settings.json，无需数据库迁移。

| 设置 | 默认值（未配置时） | 生效范围 |
| --- | --- | --- |
| 自动记忆 / Auto Dream | 关闭 | 下一任务；Dream 还需开启自动记忆，并满足原有触发条件 |
| 独立 Verification | 关闭 | 下一任务；控制 verifier 可用性、强制审计指令及 Todo/Task 完成提醒 |
| Agent Teams | 关闭 | 下一任务；不影响普通 Agent 子代理 |
| 输入建议 | 关闭 | 下一任务；可能增加模型调用 |
| 离开摘要 | 关闭 | 交互式 CLI 的自动摘要和 /recap；BGS 无头 Chat 没有对应 UI |
| Coordinator | 关闭 | 新会话；原生续作继续保留已记录的模式 |

已有显式保存值保留。界面使用后台返回值；保存不代表当前执行中的任务已切换。
保存后刷新空闲进程；运行中的会话标记为待刷新，在下一任务启动前重新创建
进程并保留续作标识，不中断、不自动重跑当前任务。

本地及 Supabase 配置都经同一映射，合入现有 CLI --settings 参数；
主会话和独立任务使用相同选项，原生子代理继承进程环境。
仅合并必要的设置和 env，不开放项目 settings/hooks，不更改沙箱或工具权限。
组织管理策略仍遵守原生优先级。

CLI 新增运行期环境变量：
- CLAUDE_CODE_VERIFICATION_AGENT_ENABLED：0/1，未设置沿用原有功能门控。
- CLAUDE_CODE_AWAY_SUMMARY_ENABLED：0/1，未设置沿用原有功能门控。

开发构建不再强制裁掉这些能力。部署本次改动需要更新 CLI 和服务一次；
之后面板切换无需重新编译。手工裁掉对应能力的自定义 CLI 不受此保证。
关闭独立 Verification 不代表关闭实际测试，也不证明交付质量合格。
