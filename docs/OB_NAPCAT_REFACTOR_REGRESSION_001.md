# OB-REGRESSION-001：NapCat 完整剥离回归结果

更新时间：2026-08-02 04:52 +08:00  
分支：`refactor/remove-napcat-onebot-runtime-20260802`  
候选提交：`fffb2db1da99a1f5a815c7b8e70c3a450fa1f849`

## 结果

受控 GitHub Actions 门禁 `30717036168` / job `91414108890` 全部成功：

```text
候选 gzip SHA-256 校验通过
解压补丁 SHA-256 校验通过
git apply --check 通过
npm ci 通过
npm test 通过
npm run build:onebot 通过
npm run build:snowluma 通过
原子源码提交通过
```

临时补丁应用工作流已在 `6b7a37aa990dcb4f9c81551431e3a58b55804b15` 删除。

## 已完成架构门槛

- GroupGuard 自有 Runtime Context 与生命周期入口；
- 项目自有 OneBot 事件类型与入口规范化；
- 动作统一为 `call(action, params)`；
- SnowLuma Profile 与 Generic OneBot Profile；
- SnowLuma 启动器直接创建纯运行时上下文；
- `napcat-types`、NapCat shim、四参数动作状态和 `build:napcat` 已移除；
- 群文件与消息历史扩展动作只经过 Host Profile；
- 未知群文件列表/删除响应返回 `indeterminate`，不确认删除，不清除待重试状态。

## SnowLuma 扩展边界

现有运行行为已有证据的能力继续启用：

```text
get_group_file_url
upload_group_file
get_group_msg_history
```

没有真实 SnowLuma 合同证据的列表和删除保持关闭式失败：

```text
group file list -> indeterminate
group file delete -> indeterminate
```

未根据 NapCat 参数或返回结构推断 SnowLuma；未运行 `GFM-DELETE-003`。

## 尚未执行

- 未合并 `main`；
- 未生成或运行生产部署；
- 未重启生产容器；
- 未修改生产配置、SQLite、群文件状态或备份。

生产继续运行 `d0b79b6eab2514492196036bd79f14819b2d4102`。
