# 🛡️ GroupGuard 群管理系统

[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](onebot-plugin-groupguard/package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

GroupGuard 是面向 QQ 群管理、查询接入、自动化和文件同步场景的 OneBot 系统。当前核心程序位于 `onebot-plugin-groupguard/`，**生产运行环境以 SnowLuma 为主**，同时保留通用 OneBot Host Profile 与兼容构建能力。

> 本 README 以 `main` 当前代码和 `docs/PROJECT_STATE.md` 为准。旧 NapCat 相关类型、元数据或历史构建记录只能作为兼容/迁移资料，不能据此判断当前生产宿主。

## 当前项目身份

- **项目名称**：GroupGuard
- **仓库**：`xianyumht-cmd/groupguard-system`
- **当前版本**：`1.3.0`
- **核心目录**：`onebot-plugin-groupguard/`
- **当前生产宿主**：SnowLuma
- **通信边界**：OneBot
- **主开发分支**：`main`
- **生产状态文档**：`docs/PROJECT_STATE.md`

核心包当前声明为：

```text
GroupGuard pure OneBot runtime with SnowLuma and generic host profiles
```

## 当前主要能力

### 群管理与风控

- 入群验证、欢迎语和群级配置；
- 违禁词、刷屏、复读与多类消息过滤；
- 撤回相关记录与管理；
- **机器人自身消息自动撤回支持按群独立配置**，可分别控制开关、模式和延迟，并保持全局/分群稀疏继承语义；
- 踢人、禁言、解禁、全员禁言等 OneBot 管理动作；
- 风险策略与系统写入边界检查。

### 查询与动态命令

- 问答与动态命令；
- 英雄碎片、战绩、风险等内网查询接入；
- 查询结果契约、客户端边界和多模式输出验证；
- 对外查询链路统一经过 GroupGuard 的发送与限流/队列控制，而不是让上游接口直接决定群内输出格式。

### WebUI 与运维

- WebUI 配置与管理；
- **LOL 版本更新 `@全体` 通知支持按群选择**：只有 WebUI 中明确开启且当前授权仍有效的群才会收到，未配置/空列表默认不发送；
- **系统更新 / 一键更新**：从固定私有仓库 `xianyumht-cmd/groupguard-system` 的 `main` 成功 `GroupGuard Build` 中发现不可变自更新产物；
- 管理健康检查；
- iOS / Glass 方向的 WebUI 验证；
- SnowLuma 配置迁移与 Host Profile 验证；
- Release Safety、内容风险与架构边界检查。

## WebUI 一键更新

SnowLuma 管理后台的 **系统更新** 页面已经具备实际可用的一键更新链路，不是仅展示状态的占位入口。

### 首次配置

私有仓库需要 GitHub Fine-grained Personal Access Token。推荐只授权仓库 `xianyumht-cmd/groupguard-system`，并仅开启：

- `Actions: Read-only`；
- `Metadata: Read-only`。

Token 可通过 WebUI 保存到 GroupGuard 数据目录下的 `self-update/github-actions-token.txt`，或由环境变量 `GROUPGUARD_UPDATE_GITHUB_TOKEN` 提供；**不会写入或回显到 `config.json`**。

### 更新来源与安全边界

更新器只接受：

1. 固定仓库 `xianyumht-cmd/groupguard-system`；
2. `main` 分支；
3. 成功完成的 `GroupGuard Build`；
4. 名称与目标提交精确对应的 `groupguard-self-update-<commit>` artifact。

候选包在切换前会验证受管运行入口、ZIP 路径/类型/大小、manifest 与 `dist` 文件集合完全一致、每个文件的 SHA-256 与大小、`build-info.json` 的精确 commit 和 `dirty=false`。更新时旧 `dist` 会先保留为回滚候选；supervisor 启动新 worker 后必须收到**精确目标 commit** 的 ready 确认，否则自动恢复上一版。

GitHub Actions artifact 下载采用官方两段式流程：先通过认证的 REST 请求取得短时 302 HTTPS 下载地址，再在不转发仓库 Token 的情况下下载签名 ZIP，避免跨域泄露凭据。

### 正常使用

```text
系统更新 → 检查更新 → 一键更新
```

安装了具备自更新能力的版本后，日常升级不再需要手工替换 `dist`。首次安装、无法启动或自更新器自身损坏时，仍保留人工部署/回滚通道。

2026-09-11 已完成 ARM Docker 实机验收：私有仓库鉴权、artifact 下载、完整性校验、`dist` 切换、supervisor 自动重启和新版本 commit 校验均实际通过；WebUI 最终状态为 `complete / complete`、进度 `100%`，并确认运行入口受管。

## 蓝奏更新与 QQ 群文件

当前生产链已经包含蓝奏更新 → 下载 → QQ 群文件上传 → 根目录整理的完整流程。

已验收的目标文件策略是：

> 该功能独占管理目标 QQ 群文件根目录 `/`，最终只保留 **1 个权威最新文件**。

生产行为：

1. 检测到蓝奏文件新增或替换；
2. 下载到 GroupGuard 临时目录；
3. **先上传新文件**到 QQ 群；
4. 保存新上传返回的 `file_id`；
5. 通过 SnowLuma 读取真实 QQ 群文件根目录；
6. 保留新 `file_id`，删除其他旧根目录文件；
7. 再次读取并验证根目录已经收敛为 1 个文件；
8. 完成后清理本地临时文件。

不会在新文件上传成功之前先删除旧 QQ 群文件。

WebUI 的 `立即检查并整理` 可以不等待下一次蓝奏更新，直接对现有群文件根目录做一次实时整理。如果历史记录已经失效，会以真实根目录中的最新文件重新建立权威状态，再清理其他文件。

该根目录单文件收敛行为已经完成生产验收，详细证据见 `docs/PROJECT_STATE.md`。

## SnowLuma / OneBot 当前合同

当前目标文件链已经按 SnowLuma 实际 OneBot 能力验证：

- `upload_group_file` 返回新上传文件的 `file_id`；
- `get_group_root_files` 读取根目录；
- `get_group_files_by_folder` 读取指定目录；
- SnowLuma 文件列表实现会完成内部分页，GroupGuard 获取的是完整列表；
- `delete_group_file` 使用 `group_id + file_id` 并等待删除结果。

因此当前实现以 **真实群文件列表** 为准进行收敛，不再把历史 pending ID 当作目录真实状态。

## 快速开始

安装核心依赖：

```bash
npm --prefix onebot-plugin-groupguard install
```

运行完整验证：

```bash
npm test
```

根目录 `package.json` 是仓库命令门面，会把构建和测试转发给 `onebot-plugin-groupguard/`。

## 构建与运行

### SnowLuma（当前生产链）

构建：

```bash
npm run build:snowluma
```

运行构建后的 SnowLuma 服务：

```bash
npm --prefix onebot-plugin-groupguard run start:snowluma
```

构建入口：

```text
onebot-plugin-groupguard/dist/snowluma-service.mjs
```

实际生产通常由容器或服务管理器启动，不建议把开发终端里的手工 `node` 进程当成正式部署方式。

### 通用 OneBot 兼容构建

需要通用 OneBot Host Profile 时：

```bash
npm --prefix onebot-plugin-groupguard run build:onebot
npm --prefix onebot-plugin-groupguard run start:onebot
```

对应入口：

```text
onebot-plugin-groupguard/dist/onebot-service.mjs
```

### 全构建

```bash
npm run build
```

当前根目录 `npm run build` 会进入核心包并执行其完整构建流程，**不应再把它描述成“NapCat 专用构建”**。

## 当前验证体系

核心包的 `npm test` 不只是 TypeScript 检查，还覆盖当前关键生产合同，包括：

- Host Profile 与纯 OneBot 运行边界；
- system-write / risk-policy 架构检查；
- action queue 与核心稳定性；
- 查询合同与 GroupGuard 交付合同；
- 英雄碎片、战绩、风险、动态查询链路；
- 多查询模式与客户端边界；
- **分群自身消息撤回合同**；
- **LOL 版本更新通知分群路由合同**；
- **WebUI self-update 下载、校验、受管运行与 supervisor/rollback 合同**；
- WebUI Glass 视觉合同；
- 蓝奏更新；
- Admin Health；
- Release Safety 与 Content Risk；
- Group File Mirror；
- Target File Push；
- SnowLuma Target File Retention；
- 项目级回归检查。

涉及生产修改时，优先补充或更新对应验证，而不是只在实机上手工点一次确认。

## 用户手册

客户侧使用说明优先查看：

- [`USER_MANUAL.html`](USER_MANUAL.html)：网页手册；
- [`USER_MANUAL.md`](USER_MANUAL.md)：Markdown 手册与同步备份。

README 只描述仓库当前架构和维护入口，不替代完整用户指令手册。

## 重要维护文档

- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)：当前生产事实与最新验收状态；
- [`docs/PROJECT_IDENTITY.md`](docs/PROJECT_IDENTITY.md)：项目身份与宿主边界；
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：架构说明；
- [`docs/CURRENT_TASK_STATE.json`](docs/CURRENT_TASK_STATE.json)：机器可读任务状态；
- [`docs/DECISIONS.md`](docs/DECISIONS.md)：重要设计决策；
- `AGENTS.md`：仓库开发 / AI 执行约定。

## 维护原则

- 生产排查优先按 SnowLuma + OneBot 链路判断，不直接套用 NapCat 专属接口；
- 群文件替换坚持“先上传成功，再删除旧文件”；
- 真实目录状态优先于历史缓存或 pending 记录；
- 自更新只消费固定私有仓库 `main` 的成功不可变构建，不允许 WebUI 指定任意仓库/URL/命令；
- 自更新 Token 坚持最小权限，并保持在运行数据/环境边界之外，不进入 `config.json`；
- 不提交 Token、账号密码、Cookie、私有配置或运行态凭据；
- 对踢人、禁言、删除群文件等高影响动作保持明确权限边界和验证；
- 当前生产事实出现变化时，应同步更新 `docs/PROJECT_STATE.md` 和本 README，避免 README 再次滞后于代码。

---

&copy; 2024 GroupGuard. All Rights Reserved.
