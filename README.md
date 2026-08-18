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
- 踢人、禁言、解禁、全员禁言等 OneBot 管理动作；
- 风险策略与系统写入边界检查。

### 查询与动态命令

- 问答与动态命令；
- 英雄碎片、战绩、风险等内网查询接入；
- 查询结果契约、客户端边界和多模式输出验证；
- 对外查询链路统一经过 GroupGuard 的发送与限流/队列控制，而不是让上游接口直接决定群内输出格式。

### WebUI 与运维

- WebUI 配置与管理；
- 管理健康检查；
- iOS / Glass 方向的 WebUI 验证；
- SnowLuma 配置迁移与 Host Profile 验证；
- Release Safety、内容风险与架构边界检查。

### 蓝奏更新与 QQ 群文件

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
- 不提交 Token、账号密码、Cookie、私有配置或运行态凭据；
- 对踢人、禁言、删除群文件等高影响动作保持明确权限边界和验证；
- 当前生产事实出现变化时，应同步更新 `docs/PROJECT_STATE.md` 和本 README，避免 README 再次滞后于代码。

---

&copy; 2024 GroupGuard. All Rights Reserved.
