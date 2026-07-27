# GroupGuard 项目身份与维护路径

## 固定身份

- 产品名称：`GroupGuard`
- GitHub 仓库：`xianyumht-cmd/groupguard-system`
- 默认分支：`main`
- 核心程序目录：`onebot-plugin-groupguard`
- 当前生产宿主：`SnowLuma`
- 通信与兼容抽象：`OneBot`
- NapCat：历史宿主及兼容构建，不是当前生产宿主

## 仓库更名记录

2026-07-27，GitHub 仓库由：

```text
xianyumht-cmd/my-napcat-sys
```

更名为：

```text
xianyumht-cmd/groupguard-system
```

改名目的：避免根据仓库名误判当前运行环境，并让项目名称不再绑定单一宿主。

## 本地维护路径

Windows 仓库根目录：

```text
D:\project2\napcatplugin\lengxi_repo
```

核心程序目录：

```text
D:\project2\napcatplugin\lengxi_repo\onebot-plugin-groupguard
```

Git 命令应在仓库根目录执行。更新远程地址：

```powershell
cd D:\project2\napcatplugin\lengxi_repo
git remote set-url origin https://github.com/xianyumht-cmd/groupguard-system.git
git remote -v
```

## 当前服务器部署路径

生产宿主目录：

```text
/mnt/sda1/groupguard/app
```

容器：

```text
groupguard-snowluma
```

容器工作目录与启动入口：

```text
WorkingDir=/app
node dist/snowluma-service.mjs
```

宿主目录 `/mnt/sda1/groupguard/app` 挂载到容器 `/app`。

## 构建入口

从仓库根目录执行：

```bash
npm test
npm run build:snowluma
```

SnowLuma 产物入口：

```text
onebot-plugin-groupguard/dist/snowluma-service.mjs
```

兼容构建：

```bash
npm run build
npm run build:all
```

其中默认 `build` 保留 NapCat 兼容产物；`build:snowluma` 才是当前生产链路。

## 后续维护判断规则

1. 不得根据旧仓库名、`napcat-types` 依赖或 `napcat` 包元数据推断当前宿主。
2. 涉及事件接收、文件上传、群文件删除和消息撤回等能力时，先核对 SnowLuma 实际适配层。
3. 通用业务逻辑放在 GroupGuard 核心服务中；宿主差异通过适配层隔离。
4. 新文档统一使用 `groupguard-system` 仓库名；旧名称仅允许出现在迁移记录中。
5. 新部署说明默认描述 SnowLuma，NapCat 说明必须标记为兼容链路。
