# 定向文件推送任务交接（2026-08-08 02:03 +08:00）

> 新聊天继续时，以本文为当前任务基线。不要从头重做已经完成的部署与设计。

## 1. 最终目标

实现一条独立于旧蓝奏 watcher/event 业务的链路：

`指定蓝奏目录 -> LOLDataSystem 5001 检测目录变化 -> 解析最新直链 -> 回调 GroupGuard 6108 -> ARM 临时下载 -> QQ 原生群文件上传`

当前固定业务目标：

- 蓝奏目录：`https://wwbvf.lanzn.com/b016kzvvmd`
- QQ 群：`960957757`
- GroupGuard：`192.168.3.89:6108`
- Windows LOLDataSystem API：`127.0.0.1:5001`
- Windows 管理 WebUI：`127.0.0.1:6178`

必须满足：

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

## 2. WebUI 职责已经确定

### GroupGuard 6108：业务配置中心

负责：

- 定向文件推送总开关
- 蓝奏目录 URL
- 目标群号
- 检查间隔
- 接口端地址
- callback 地址
- 最大文件大小
- 群文件夹位置
- 接口写入 Token（只保存，不回显）
- 立即检查 / 重新建立 baseline
- 上传与清理状态

统一左侧导航应为：

`扩展模块 -> 群文件搬运 / 定向文件推送 / Q群管家通道`

### LOLDataSystem 6178：监控与诊断中心

负责只读展示和运维动作，不作为第二套业务配置源：

- enabled / 后台 loop 状态
- 当前 Provider
- source URL、interval（只读，注明配置源 GroupGuard 6108）
- callback 是否配置（不返回 Token）
- baseline 文件数与文件列表
- pending delivery events
- 最近检查/成功/投递/event
- 最近安全错误
- `立即检查`
- `重新建立基线`
- 跳转 Provider 配置 / API Debugger / 日志

原因：避免 6108、6178 两套页面同时可编辑相同业务字段造成相互覆盖。

---

## 3. LOLDataSystem / 6178 当前状态：已完成并成功部署

本地仓库：`D:\project2\lolapisevers`

Windows 服务：`LOLDataSystem`

### 5001 定向文件监控后端

此前已经集成到生产。

v14 部署前生产提交：

`7696b96dd9dcb935805563a5e38a77a2ffecabf8`

该提交包含定向文件监控后端链路。

### 6178 独立页面

GitHub UI 分支：

`feat/target-file-watch-webui-20260808`

GitHub UI 固定提交：

`38335619f4def35eb64bc3d812077885d895bd09`

在本机生产 `7696b96...` 上生成并部署的本地集成提交：

`5c1ebf552479bf5ccd75435e2472b5a861430146`

这个 `5c1ebf...` 是本机部署生成的 integration candidate，不要求 GitHub 上存在同 SHA。

v14 最终结果：

- 365 tests：`OK`
- WebUI JS 生成校验：通过
- `node --check`：通过
- `APP_IMPORT_OK`
- `Generate-BuildInfo.ps1`：`dirty=False`
- `/target-file-watch`：HTTP 200 且页面标记通过
- `/control-assets/target-file-watch.js`：通过
- 5001 `/api/v1/target-file-watch/status` 后端路由：通过
- 部署完成后 LOLDataSystem 正常运行

最终页面：

`http://127.0.0.1:6178/target-file-watch`

左侧入口：

`蓝奏监控 -> 定向文件监控`

v14 日志：

`deploy-6178-target-file-watch-webui-20260808-013951.log`

备份：

`D:\project2\lolapisevers.deploy-backups\20260808-013951-6178-target-file-watch-webui`

**结论：新聊天不要再部署/重做 6178。**

---

## 4. GroupGuard 功能代码状态

仓库：`xianyumht-cmd/groupguard-system`

分支：

`feat/target-file-push-20260807`

PR：`#37`（Draft/open/unmerged）

当前固定功能提交：

`6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`

提交信息：

`fix(webui): finalize target file push navigation entry`

这个提交包含：

- `/target-file-push.html`
- `/api/target-file-push`
- check / rebaseline / callback/event 链路
- `TARGET_FILE_PUSH_API_TOKEN` / `GROUPGUARD_WRITE_TOKEN` token 逻辑
- WebUI 统一导航补丁
- 只保留最新群文件的清理逻辑
- 独立 retention 状态：`data/target-file-push-target-state.json`
- `pendingCleanup`
- 复用 HostProfile 的 `delete_group_file` 能力
- `verify:target-file-push`

### 只保留最新文件的顺序

必须保持：

`新文件上传 -> 获得新 fileId -> 保存最新 fileId -> 上一份 fileId 进入 pendingCleanup -> 删除旧群文件 -> 删除本地临时文件`

禁止：先删旧群文件再上传新文件。

---

## 5. GroupGuard ARM 部署历史与当前关键状态

ARM：`root@192.168.3.89`

生产目录：`/mnt/sda1/groupguard/app`

容器：`groupguard-snowluma`

### v12

目标：部署 `6d9e6fc...`

结果：

- 全套 npm tests 通过
- `verify:target-file-push` 通过
- SnowLuma build 通过
- 失败在 stage 3 SCP tar 上传：`Connection closed by 192.168.3.89 port 22`
- 没有进入 ARM 替换阶段
- 当时生产仍是 `380b6cb371a7f9512400296269875d1ad7c2b5c3`

### v15

v15 修复传输：

- stage 1 小文件上传探针通过：`[OK] ARM 上传通道验证通过：scp`
- stage 2 全套 tests/build 通过
- stage 3 tar + remote script 上传及 SHA256 校验通过
- stage 4 已实际执行：
  - `Stopping groupguard-snowluma`
  - `Replacing GroupGuard dist`
  - `Starting groupguard-snowluma`
- 容器启动初期出现两次 6108 connection refused，属于启动窗口
- 后续已经可以访问在线 API/build-info
- 最终失败信息：`target-file-push page title missing`

v15 日志：

`deploy-target-file-push-hotfix-20260808-015330.log`

### v15 失败的真实原因

不是源码页面缺失。

GitHub 提交 `6d9e6fc...` 的 `target_file_push_page.ts` 明确包含：

- `<title>定向文件推送</title>`
- `<h1>定向文件推送</h1>`
- `id="saveBtn"`

`webui_theme.ts` 明确包含：

- `groupguard-target-file-push-navigation-patch`
- `data-gg-target-file-push`
- `/target-file-push.html`

v15 remote verifier 最后一层使用中文字符串 `grep`，ARM shell locale/字符编码产生假阴性。

此外发现 v15 rollback 防护漏洞：remote `fail()` 直接 `exit 1`，显式 exit 不一定触发 `ERR` trap，因此日志没有出现 rollback。

**所以 v15 很可能已经把 `6d9e6fc...` 留在 ARM 上，但在退出前没有做出可信的最终在线确认。不能直接宣称已经部署成功。**

---

## 6. 下一步唯一要运行的包：GroupGuard v16

文件名：

`TargetFilePush-Hotfix-20260808-v16.zip`

SHA256：

`e16a2fe947ad3e2b3ba608acc6d2a5a8910087f63db451b4b79a45ceddd0a05b`

用户将在**新聊天**发送运行 v16 后的 CMD 窗口记录和 log。

### v16 行为

1. 读取 ARM 当前 build commit。
2. 验证上传通道。
3. 先上传小型 remote verifier/deploy shell。
4. 如果 ARM 当前已经是：
   `6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`
   则不重建、不替换，先运行在线完整验证。
5. 在线验证全部使用 ASCII-only 标记，避免中文 locale 假阴性：
   - `/api/livez`
   - `/api/build-info`
   - `/target-file-push.html`
   - 页面 `id="groupguard-target-file-push-navigation-patch"`
   - 页面 `data-gg-target-file-push`
   - 页面 `id="saveBtn"`
   - `/api/target-file-push` HTTP 200
6. 如果上述都通过，预期快速输出：
   `GROUPGUARD TARGET FILE PUSH ONLINE VERIFICATION SUCCEEDED`
   然后退出成功，不做重复构建。
7. 如果 build-info 是目标提交但在线验证不完整，则进入完整 rebuild + atomic replace。
8. v16 已修复 rollback：生产替换开始后，显式 `fail()` 也会主动调用 rollback，不再只依赖 ERR trap。

### 新聊天收到 v16 日志后的判断

#### A. 最理想情况

若看到：

- ARM current commit = `6d9e6fc...`
- `ONLINE VERIFICATION SUCCEEDED`

则宣布 GroupGuard 部署阶段完成，**不要再发新的部署包**。

#### B. v16 自动完整重建

如果它继续走 2/5~5/5，只要最终看到：

`[OK] GroupGuard 热修复已部署：6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`

并且在线 page/API 校验通过，也算部署完成。

#### C. 仍失败

按准确 stage 诊断；不要让用户手工执行一堆 SSH 命令，优先继续修一键包。

---

## 7. v16 成功后的真实业务测试顺序

**v16 成功后停止部署，进入真实功能测试。**

### 第一步：确认 6108 UI

刷新：

`http://192.168.3.89:6108/`

左侧“扩展模块”必须出现：

- 群文件搬运
- 定向文件推送
- Q群管家通道

也可以直接打开：

`http://192.168.3.89:6108/target-file-push.html`

如果需要控制台访问令牌，用户自己输入现有 WebUI token，**不要要求用户把 token 发到聊天里。**

### 第二步：6108 配置确认

应确认：

- source URL = `https://wwbvf.lanzn.com/b016kzvvmd`
- target group = `960957757`
- interval 初始可用 `300`
- target folder = `/`
- callback base = GroupGuard 自身 6108 私网地址
- API base = LOLDataSystem 5001 地址
- 接口写入 Token：如果页面显示“已保存”，留空保存即可；不要回显或让用户粘贴到聊天

### 第三步：建立 baseline

开启总开关并 `保存并同步`。

第一次 `立即检查` 或 `重新建立基线`：

- 只记录当前蓝奏目录
- 不上传已有文件
- 6178 baseline file count 应出现当前数量

### 第四步：测试第一次新增

往蓝奏目录新增一个全新、小文件。

然后在 6178 或 6108 点击 `立即检查`，验证：

1. 5001 检测新增
2. 解析最新 direct URL
3. callback GroupGuard 成功
4. ARM 临时下载
5. QQ 群 `960957757` 出现原生群文件
6. 6108 local completedCount / lastSuccessAt 更新
7. 6178 baseline 推进且 pending 清空

### 第五步：测试“只保留最新一个”

再新增第二个全新小文件。

预期：

1. 第二个文件先上传成功
2. 第一份群文件随后被删除
3. QQ 群里最终只保留第二个最新文件
4. `target-file-push-target-state.json` 中 current/latest 指向第二份
5. 如果删除失败，第二份仍视为成功，第一份进入 `pendingCleanup`

### 第六步：再测同名替换

第一次全链路通过后，再测同名同大小/同名替换，不要把它作为首个测试。

---

## 8. 不要重复做的事项

新聊天中不要：

- 重新部署 6178 v14
- 重做 5001 backend
- 把“群文件搬运”和“定向文件推送”当同一个 watcher
- 改成两个 WebUI 都能编辑业务配置
- 先删旧 QQ 群文件再上传新文件
- 第一次启用就把蓝奏历史文件全部上传
- 让用户在聊天里提供任何 Token/密码
- 因 npm audit 显示 23 vulnerabilities 就擅自 `npm audit fix`；本任务当前不是依赖升级任务
- 因 Vite dynamic import warning 判定构建失败；这些是 warning，v15 build 已成功

---

## 9. 相关 GitHub 工作

### GroupGuard

- Repo: `xianyumht-cmd/groupguard-system`
- Branch: `feat/target-file-push-20260807`
- PR: `#37` Draft/open/unmerged
- Feature head: `6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`

### LOLDataSystem backend

- Repo: `xianyumht-cmd/lolapisevers`
- 原定向监控功能分支：`feat/target-file-push-20260807`
- PR: `#57` Draft/open/unmerged
- 曾固定 feature head: `af5baa43b484748ffd159e4495f85f8231fb139f`
- 生产已通过本地 integration commit 集成，不要整分支覆盖生产

### LOLDataSystem 6178 WebUI

- Branch: `feat/target-file-watch-webui-20260808`
- PR: `#58`
- GitHub UI head: `38335619f4def35eb64bc3d812077885d895bd09`
- 本机生产 integration commit: `5c1ebf552479bf5ccd75435e2472b5a861430146`

---

## 10. 新聊天第一句话可直接这样理解

用户会上传/粘贴 **GroupGuard 定向文件推送 v16** 的 CMD 记录与 log。

收到后第一件事：

1. 查看 ARM 当前 commit；
2. 判断 v16 是“verify-only 快速成功”还是“进入完整 rebuild/deploy”；
3. 只根据日志实际结果判断 GroupGuard 是否真正上线；
4. 若成功，直接进入 6108/6178/baseline/QQ 群真实测试，不再继续部署。
