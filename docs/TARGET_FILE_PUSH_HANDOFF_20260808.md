# 定向文件推送任务交接（2026-08-08 03:52 +08:00）

> 新聊天继续时，以本文为当前任务基线。当前部署阶段已经完成，5001 / 6178 / 6108 已经打通并成功建立 baseline。不要从头重做部署；下一次继续时直接从“首次新增文件真实投递测试”开始。

## 0. 当前结论 / 暂停点

当前任务已完成到：

`部署完成 -> 5001 与 6108 内部鉴权打通 -> 6108 业务配置同步到 5001 -> 第一次 baseline 成功建立`

当前已经确认：

- GroupGuard 6108 在线。
- LOLDataSystem 5001 在线。
- LOLDataSystem 6178 定向文件监控页面在线。
- 6108 -> 5001 网络通信正常。
- 6108 -> 5001 内部 Token 鉴权已通过。
- 5001 已接收到 6108 下发的定向监控配置。
- 5001 后台监控循环运行中。
- 当前 Provider：`lanzou_web`。
- callback Token 已配置。
- baseline 已成功建立，共 `1` 个现有文件。
- 第一次建立 baseline 没有产生待投递事件，没有上传历史文件，符合设计要求。
- 当前待投递事件为空。
- 当前最近错误为空。

**尚未执行：新增一个全新文件后的完整 QQ 群文件投递测试。**

因此任务暂时告一段落。下次继续时不要再部署，直接做第 8 节的业务测试。

---

## 1. 最终目标

实现一条独立于旧蓝奏 watcher/event 业务的链路：

`指定蓝奏目录 -> LOLDataSystem 5001 检测目录变化 -> 解析直链 -> 回调 GroupGuard 6108 -> ARM 临时下载 -> QQ 原生群文件上传`

固定业务目标：

- 蓝奏目录：`https://wwbvf.lanzn.com/b016kzvvmd`
- QQ 群：`960957757`
- GroupGuard WebUI / callback：`192.168.3.89:6108`
- LOLDataSystem 5001：Windows 主机 `192.168.3.100:5001`，本机访问可用 `127.0.0.1:5001`
- LOLDataSystem 管理 WebUI：Windows 本机 `127.0.0.1:6178`

必须保持的业务语义：

1. 第一次启用/第一次检查只建立 baseline，当前目录已有文件一个都不上传。
2. 后续新增文件逐个上传。
3. 同名替换也要识别并上传新版本。
4. 仅删除蓝奏文件时，不往 QQ 群发送任何内容。
5. callback 中途失败不能推进 baseline，避免漏传。
6. 空上游快照不能覆盖正常非空 baseline。
7. Provider 切换需要防误报；同 Provider 能识别同名同大小但 provider id 改变的替换。
8. GroupGuard 必须先成功上传新群文件，再删除上一份群文件。
9. 旧群文件删除失败不能让新上传失败；旧 fileId 进入 `pendingCleanup`，后续继续补删。
10. 该规则在 QQ 群文件里最终只保留一个最新文件。
11. 本地临时文件只在拿到成功上传的 `fileId` 后删除；失败时保留用于排查/重试。
12. completed eventId 持久化去重。

---

## 2. WebUI 职责

### GroupGuard 6108：唯一业务配置中心

负责：

- 定向文件推送总开关
- 蓝奏目录 URL
- 目标群号
- 检查间隔
- LOLDataSystem 5001 API 地址
- GroupGuard callback 地址
- 最大文件大小
- 群文件夹位置
- 接口写入 Token（只保存，不回显）
- 立即检查 / 重新建立 baseline
- 上传与清理状态

统一左侧导航：

`扩展模块 -> 群文件搬运 / 定向文件推送 / Q群管家通道`

### LOLDataSystem 6178：监控与诊断中心

只读展示和运维动作，不作为第二套业务配置源：

- enabled / 后台 loop 状态
- 当前 Provider
- source URL、interval（只读，配置源 GroupGuard 6108）
- callback 是否配置
- baseline 文件数与文件列表
- pending delivery events
- 最近检查/成功/投递/event
- 最近安全错误
- 立即检查
- 重新建立基线
- Provider 配置 / API Debugger / 日志入口

原因：避免 6108、6178 两套页面同时编辑相同业务字段造成相互覆盖。

---

## 3. 当前 6108 实际业务配置

已在 GroupGuard `http://192.168.3.89:6108/target-file-push.html` 配置并成功同步：

- 总开关：已开启
- 蓝奏 URL：`https://wwbvf.lanzn.com/b016kzvvmd`
- 目标群：`960957757`
- 检查间隔：`300` 秒
- API Base：`http://192.168.3.100:5001`
- Callback Base：`http://192.168.3.89:6108`
- 单文件最大大小：当前页面为 `2048 MB`
- 群文件位置：`/`
- 接口写入 Token：已保存，禁止回显到聊天

6108 当前运行状态已看到：

- 接口端状态：`接口端在线`
- 接口监控运行：`运行中`
- 接口端当前配置：`已启用 · 300 秒`
- 本地临时目录：`/app/data/target-file-push-temp`
- 最近错误：`无`

---

## 4. 当前 6178 / 5001 实际状态

页面：

`http://127.0.0.1:6178/target-file-watch`

当前已确认：

- 功能状态：`已启用`
- 后台循环：`运行中`
- 当前 Provider：`lanzou_web`
- Baseline 文件：`1`
- 蓝奏目录：已正确显示目标目录
- 检查间隔：`300 秒`
- Callback：`http://192.168.3.89:6108/api/target-file-push/event`
- Callback Token：`Token 已配置`
- 最近检查：成功
- 最近成功：成功
- 最近投递：暂无
- 最近事件：暂无
- 待投递事件：无

第一次 baseline 中记录了蓝奏目录当时已有的 1 个文件，但没有产生投递事件，也没有上传到 QQ 群。

这已经验证了关键规则：

**第一次启用只建立目录快照，不上传历史文件。**

---

## 5. 蓝奏解析 / WER Token 与内部 Token 的区别

本次实际排查中出现了 Token 概念混淆，后续必须区分。

### WER 蓝奏解析 Token

第三方解析服务：

`https://api2.wer.plus/api/lanzpro`

6178 “蓝奏全局配置”里 WER 解析器页面已经显示：

`API Key 已配置`

这个 Token 只用于：

`LOLDataSystem 5001 -> api2.wer.plus`

它不是 GroupGuard 的“接口写入 Token”，不要填到 6108。

当前实际 baseline Provider 为 `lanzou_web`，说明本次基线由网页解析 Provider 成功完成；WER 继续作为接口端解析能力保留。

### 6108 的“接口写入 Token”

用途：

`GroupGuard 6108 -> LOLDataSystem 5001`

5001 后端鉴权优先级：

1. `GROUPGUARD_WRITE_TOKEN`
2. 如果没有，则回退 `WEBUI_ADMIN_TOKEN`

6108 必须保存与 5001 实际服务端一致的值。

**该 Token 也禁止发到聊天里。**

### 6178 右上角“管理令牌”窗口

该窗口只是把 `WEBUI_ADMIN_TOKEN` 保存到当前浏览器标签页的 session storage，用于当前浏览器请求管理接口；它不会把服务端现有 Token 明文展示出来，也不会自动读取 Windows 服务环境变量。

---

## 6. 本次碰到的问题与解决结果

### 问题 A：6108 “保存并同步”提示“管理员凭据无效”

现象：

6108 本地配置可以保存，但同步 5001 时返回：

`管理员凭据无效`

判断：

这不是网络不通。因为 6108 已经能拿到 5001 明确返回的 HTTP 鉴权错误，说明：

`6108 -> 5001 网络链路是通的，只是 Token 不匹配。`

根因：

曾把 WER 第三方解析 Token 与 5001 内部写入 Token 混淆。

解决：

找出 5001 当前真正使用的 `GROUPGUARD_WRITE_TOKEN` / `WEBUI_ADMIN_TOKEN`，填入 6108“接口写入 Token”，再次“保存并同步”后成功。

### 问题 B：不知道 5001 当前 Token 存在哪里

为避免让用户手工翻 Windows 服务/NSSM/环境变量，生成了只读一键工具：

`find-5001-groupguard-token-oneclick.zip`

入口：

`run-find-5001-token.cmd`

工具行为：

- 只读，不修改服务和配置
- 检查 Machine/User/Process 环境变量
- 检查 `LOLDataSystem` Windows 服务环境
- 检查 NSSM `AppEnvironment` / `AppEnvironmentExtra`
- 扫描 `D:\project2\lolapisevers` 常见 `.env` / 启动脚本 / 配置文件
- 只提取 `GROUPGUARD_WRITE_TOKEN` / `WEBUI_ADMIN_TOKEN` 候选
- 使用本机 `127.0.0.1:5001/api/v1/target-file-watch/status` 对候选值做只读鉴权验证
- 找到有效值后自动复制到剪贴板
- 控制台只显示 Token 尾部预览，不打印完整 Token

用户已经明确反馈：**该查找 Token 脚本确实有用，并成功帮助完成 6108 / 5001 对接。**

后续如果再有类似 Windows 服务密钥定位问题，优先采用这种“一键只读检测 + 本机验证 + 不回显完整 Secret”的方式。

### 问题 C：v15 在线校验假失败

v15 最后提示：

`target-file-push page title missing`

真实原因不是页面缺失，而是 ARM shell 用中文字符串 `grep` 产生 locale / 字符编码假阴性。

后续 v16 改为 ASCII-only 页面标记验证。

### 问题 D：v15 rollback 保护不完整

v15 remote `fail()` 直接 `exit 1`，显式退出不一定触发 `ERR` trap。

v16 已修复：生产替换开始后，显式失败也主动触发 rollback，不再只依赖 ERR trap。

### 问题 E：v16 快速在线验证路径出现 `tarball not found`

v16 开始时 ARM 已经是目标提交 `6d9e6fc...`，脚本尝试在线快速验证，但该路径出现：

`[FAILED] tarball not found`

随后脚本没有错误停止，而是安全进入完整 rebuild + atomic replace。

最终：

- tests 通过
- `verify:target-file-push` 通过
- SnowLuma build 通过
- tar/scp/SHA256 通过
- 停止并替换 GroupGuard dist
- 重启容器
- 最终远端输出 `GROUPGUARD TARGET FILE PUSH HOTFIX SUCCEEDED`
- 最终本机输出 `[OK] GroupGuard 热修复已部署：6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`
- `Hotfix deployment completed.`

因此 **v16 部署已经完成，不要再生成/运行新的部署包。**

---

## 7. 代码与部署状态

### GroupGuard

Repo：`xianyumht-cmd/groupguard-system`

Branch：`feat/target-file-push-20260807`

PR：`#37` Draft/open/unmerged

当前生产功能提交：

`6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`

提交信息：

`fix(webui): finalize target file push navigation entry`

功能包括：

- `/target-file-push.html`
- `/api/target-file-push`
- check / rebaseline / callback/event 链路
- `TARGET_FILE_PUSH_API_TOKEN` / `GROUPGUARD_WRITE_TOKEN` 逻辑
- 统一 WebUI 导航
- 只保留最新群文件逻辑
- `data/target-file-push-target-state.json`
- `pendingCleanup`
- HostProfile `delete_group_file`
- `verify:target-file-push`

旧文档提交 `88c64bd...` 只是 docs-only，不是新的生产功能版本；ARM 生产应保持 `6d9e6fc...`。

### LOLDataSystem backend / 6178

Repo：`xianyumht-cmd/lolapisevers`

5001 定向监控后端已经部署，不要重做。

6178 独立页面已经部署：

- GitHub UI Branch：`feat/target-file-watch-webui-20260808`
- PR：`#58`
- GitHub UI commit：`38335619f4def35eb64bc3d812077885d895bd09`
- 本机生产 integration commit：`5c1ebf552479bf5ccd75435e2472b5a861430146`

此前 v14 已完成 tests / JS 校验 / `node --check` / 页面 HTTP 200 / backend route 检查。

**不要重新部署 6178，也不要重做 5001 backend。**

---

## 8. 下次继续时唯一正确的测试顺序

当前 baseline 已经建立完成，所以不要再重复“重新建立基线”。

### 第一步：首次全新文件投递测试

往目标蓝奏目录上传一个**全新的小文件**，建议几 KB 到几 MB，例如：

`GG-test-001.txt` 或 `GG-test-001.zip`

确认蓝奏目录里已经能看到该文件后，在 6178 或 6108 点一次：

`立即检查`

验证完整链路：

1. 5001 检测到新增文件
2. 5001 获取/解析 direct URL
3. 5001 产生 delivery event
4. 5001 callback `192.168.3.89:6108`
5. GroupGuard 下载到 `/app/data/target-file-push-temp`
6. GroupGuard 以 QQ 原生群文件上传到群 `960957757`
7. 获取新的群文件 `fileId`
8. 6108 `completedCount / lastSuccessAt` 更新
9. 6178 baseline 推进
10. pending delivery 清空
11. 成功后的本地临时文件被删除

如果 callback / 上传失败，baseline 不应推进。

### 第二步：测试“只保留最新一个”

第一次全链路成功后，再上传第二个全新小文件。

正确顺序必须是：

`第二个文件先上传成功 -> 得到新 fileId -> 保存 latest -> 第一份进入 pendingCleanup -> 删除第一份群文件`

最终 QQ 群里只保留第二个最新文件。

如果删除第一份失败：

- 第二份仍然算上传成功
- 第一份进入 `pendingCleanup`
- 后续继续补删

禁止先删旧文件再上传新文件。

### 第三步：最后测试同名替换

前两个测试都通过后，再测试同名替换/同名同大小替换。

不要把同名替换作为第一次真实投递测试。

---

## 9. 不要重复做 / 安全规则

后续继续时不要：

- 再部署 GroupGuard v16 或生成 v17，除非真实业务测试发现代码问题
- 重新部署 6178 v14
- 重做 5001 backend
- 把“群文件搬运”和“定向文件推送”当成同一个 watcher
- 改成 6108、6178 两边都能编辑业务配置
- 第一次启用时上传蓝奏历史文件
- 在新文件成功上传前删除上一份 QQ 群文件
- 把 WER Token 填到 6108“接口写入 Token”
- 要求用户在聊天里发送 WER API Key、`GROUPGUARD_WRITE_TOKEN`、`WEBUI_ADMIN_TOKEN` 或任何密码
- 因 npm audit vulnerabilities 擅自执行 `npm audit fix`
- 把 Vite dynamic import warning 当成构建失败

Secret 排查原则：

- 尽量本机验证，不把 Secret 传出机器
- 工具不打印完整 Token
- 能自动复制剪贴板就不要显示明文
- 优先只读诊断，不修改生产服务

---

## 10. 交接文档应该记录什么

本项目的交接文档应至少包含：

1. **任务目标**：最终要实现什么，以及不可改变的业务规则。
2. **架构与职责**：哪个组件负责检测、解析、配置、下载、上传、诊断。
3. **当前真实状态**：哪些已部署、哪些已验证、目前停在哪一步。
4. **关键配置**：URL、端口、群号、间隔、目录等非 Secret 配置。
5. **代码/版本基线**：仓库、分支、PR、生产提交，避免下次拿错版本。
6. **已经完成的操作**：避免新聊天重复部署、重复修复。
7. **碰到的问题**：现象、根因、最终解决方法，而不只是记录“报错过”。
8. **验证证据**：页面状态、baseline、日志关键成功标记等。
9. **下一步操作顺序**：新聊天第一步具体做什么。
10. **不要做的事**：已知高风险操作、重复工作、错误 Token 用法等。
11. **Secret 处理规则**：只记录变量名和用途，不写真实 Token/密码。
12. **有用的诊断工具**：例如本次只读 Token Finder，以及它解决了什么问题。

交接文档的核心目的不是记录全部聊天，而是让下一次接手的人能够在几分钟内回答三个问题：

- 现在做到哪里了？
- 为什么现在是这个状态？
- 下一步应该做什么，哪些事情绝对不要重做？

---

## 11. 新聊天继续时直接执行

用户如果说“继续定向文件推送”，直接理解为：

- 部署已经结束
- Token 对接已经完成
- baseline 已成功建立为 1 个历史文件
- 历史文件没有上传
- 当前停在“首次新增文件真实投递测试”之前

下一步：让用户上传一个全新小文件到蓝奏目录，然后点击一次“立即检查”，观察 5001 -> 6108 -> QQ 群的完整链路。
