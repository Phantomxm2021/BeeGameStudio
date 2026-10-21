# BGS 源码品牌、构建与升级

BGS 基于 OpenAI Codex。完整品牌转换覆盖源码目录、Cargo 包及导入、类型、CLI、配置目录、环境变量、Skills、插件安装目录和 BGS 自有 API。执行循环、模型推理和原生权限逻辑不因品牌调整重写。

## 仓库与分支

- 主仓库子模块：`vendor/bgs`；Rust 工作区：`vendor/bgs/bgs-rs`。
- Fork：`https://github.com/Phantomxm2021/codex.git`。这是现有真实仓库地址，保留作为来源，不虚构新地址。
- 官方上游：`https://github.com/openai/codex.git`。
- `bgs/source-0.163.0`：保留上游命名的源码维护分支，包含此前已验证的 CLI 品牌、图标、关闭官方二进制自更新及锁文件版本修正。
- `bgs/0.163.0`：从源码维护分支生成的完整 BGS 命名发行分支。主仓库 gitlink 固定发行提交。
- 完整改名规则在 `scripts/brand-bgs.py`。默认只报告，`--apply` 才写入。只遍历 Git 源码，不遍历用户运行数据。`--host` 仅为本次宿主代码的一次性迁移用途；不要对后续 BGS 宿主源码重复执行，因为兼容读取代码有意保留旧名称。

后续更新在源码维护分支合并上游，再重新生成发行分支，避免对数千个改名文件逐一解决合并冲突。新增上游名称和外部协议仍需要审查；脚本不能保证未来升级无需调整。

## 运行位置

| 内容 | 位置或接口 |
|---|---|
| 二进制及内部 Cargo target | `bgs` |
| Cargo 主包 | `bgs-cli` |
| CLI 配置根 | `BGS_HOME`，默认 `~/.bgs` |
| BGS 每用户配置根 | `.runtime/app/bgs` |
| 内置游戏 Skills | 应用共享目录 `.beegame/skills/bgs-game-skills`，通过 `skills/extraRoots/set` 直接加载，所有 BGS 账户共用、只读 |
| 用户 Skills | 账户 `.runtime/app/skills`，同接口按账户独立加载；不共享用户内容 |
| 运行器系统 Skills | `$BGS_HOME/skills/.system`，由运行器维护 |

模型配置读取及需求分析仅解析内置 Skills 路径，不要求目录已安装。游戏 Agent 启动时才检查目录可用并注册共享 Skills；目录缺失或为空会在启动原生进程和模型请求前报错，不静默跳过内置能力。
| 插件及缓存 | `$BGS_HOME/plugins` |
| 设置 API | `/api/bgs/settings` |
| 自定义二进制路径 | `BEEGAME_BGS_PATH` |
| macOS 管理配置标识 | `com.phantomlab.bgs` |

内置及用户 Skills 的原目录、投影目录只授予读取权限；不因此开放同级 auth.json、会话目录或写权限。

明确保留的例外：真实外部 URL、模型 ID、服务端协议头及认证/额度标识；`bgs app` 所连接的官方桌面应用的签名、安装器和 URL scheme（该命令仍明确标为 upstream Codex Desktop）；第三方插件包中的 `.codex-plugin` 清单格式；LICENSE、NOTICE、来源说明；读取旧会话的兼容标识和迁移别名。安装根已属于 BGS，第三方包格式不会被擅自改写。Git 历史和 Git 自身的旧子模块元数据不做字符串改写。

## 本地构建和验证

```sh
git submodule update --init vendor/bgs
bun run bgs:build
bun run bgs:check
bun run bgs:verify
python3 scripts/test_brand_bgs.py
python3 scripts/verify-bgs-source.py bgs/source-0.163.0
bun run typecheck
bun test scripts/migrate-bgs-home.test.ts
BGS_SANDBOX_TESTS=1 bun test packages/agent-workflow-server/src/bgs
```

首次准备依赖可执行 `cargo fetch --locked --manifest-path vendor/bgs/bgs-rs/Cargo.toml`。正常构建使用离线锁定依赖；本地测试使用脚本化 Responses 服务，不向真实模型提交任务。macOS 权限测试需要可运行 Seatbelt 的宿主环境。

产物是 `dist/bgs-runtime/bgs`、`build.json`、LICENSE、NOTICE 和修改说明。构建信息记录源码 SHA、上游 tag、dirty 状态及平台架构。发布构建 `bun run bgs:build --release` 拒绝未提交的源码。缺少品牌二进制时不回退到官方 npm 包。

## 旧配置迁移

先停止使用目标账号目录的全部服务，再迁移该目录。不要迁移本机仍供官方 Codex 桌面应用使用的 `~/.codex`；BGS 的每用户目录与其独立。

```sh
# 先只查看计划；这里的父目录要替换成目标用户实际的 .runtime/app。
bun scripts/migrate-bgs-home.ts --from /OWNER/.runtime/app/codex --to /OWNER/.runtime/app/bgs
# 确认服务停用后应用：
bun scripts/migrate-bgs-home.ts --from /OWNER/.runtime/app/codex --to /OWNER/.runtime/app/bgs --apply
```

工具检查打开的文件，拒绝已有目标、合并、覆盖以及不明状态；用同一文件系统目录重命名保留原数据和权限，再保留旧路径符号链接，使历史记录中的绝对路径继续有效。它不改写配置正文、原始日志、SQLite、项目内容或游戏产物。新启动使用 BGS_HOME，新目录采用 BGS 名称。重复执行识别已迁移状态。不要在旧别名仍被历史引用时删除它。

含旧 CODEX_* 环境变量的运维配置、显式旧路径和单机 keychain 凭据不能靠改目录自动翻译：按新的 BGS_* 名称核对环境，显式旧路径可暂由别名承接。BGS 服务使用的文件型 auth.json 会原样保留；独立 CLI 的旧系统 keychain 登录可能需要重新登录。Windows 尚无已验证的打开文件检查，工具拒绝自动迁移。

如果旧目录还未迁移，BGS 会说明迁移方法，不会悄悄创建第二套空账号配置。历史 `runtime: codex` 事件继续可读，新事件写 `bgs`。

## 同步官方版本

保持工作树干净，在同一个子模块中使用两条分支。以下 NEW_VERSION 是选定的官方版本：

```sh
git -C vendor/bgs switch bgs/source-0.163.0
git -C vendor/bgs switch -c bgs/source-NEW_VERSION
git -C vendor/bgs fetch upstream tag rust-vNEW_VERSION
git -C vendor/bgs merge --no-ff rust-vNEW_VERSION
# 审查并解决少量产品补丁冲突，提交；保留此源码维护分支。
git -C vendor/bgs switch -c bgs/NEW_VERSION
python3 scripts/brand-bgs.py vendor/bgs --report /tmp/bgs-brand-plan.json
python3 scripts/brand-bgs.py vendor/bgs --apply
# 编译和上述验证通过后提交生成结果。
git -C vendor/bgs add -A
git -C vendor/bgs commit -m 'brand: generate BGS distribution for NEW_VERSION'
```

如果源码 checkout 还原后保留了 ignored 的旧 `bgs-rs/target`，先将该构建缓存移到工作区外；转换遇到已有目标会拒绝覆盖。不要用 reset --hard、自动 ours/theirs 或覆盖目录解决冲突。主仓库宿主 API 已是 BGS，不随上游重复改名。

先推送源码维护分支与发行分支，再记录主仓库 gitlink。可用 GitHub Desktop 推送，也可用已登录的 Git：

```sh
git -C vendor/bgs push origin bgs/source-NEW_VERSION bgs/NEW_VERSION
git add vendor/bgs .gitmodules
```

仅提交本次工作文件，不将主工作区其他改动混入。升级测试必须覆盖版本/帮助、配置位置、Skills 实际读取与拒绝、插件本地安装、会话恢复、usage 和停止。新平台须本机编译验证；macOS 包不能进入 Linux Docker 镜像。Alpine 需要匹配架构的 musl 构建。

## 回退

保留前一版完整二进制和源码提交。停用新服务后，恢复对应代码与构建；旧路径别名可供旧版访问同一数据，但不得让两个版本同时写账号目录。不要通过重写会话日志、删除项目或改游戏产物回退。
