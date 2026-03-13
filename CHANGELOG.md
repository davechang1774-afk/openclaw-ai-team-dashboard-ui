# Changelog

## 2026-03-13

### Added

- 提供可直接安装到 OpenClaw 的自定义 UI 模板
- 提供 `install.ps1` / `uninstall.ps1` 一键安装与回滚
- 提供 `install.cmd` / `uninstall.cmd` 包装入口
- 提供 `validate-package.ps1` 包体自检脚本
- 提供 `docs/TROUBLESHOOTING.md` 常见问题文档
- 提供 GitHub Actions 基础自检工作流
- 添加原作者链接、署名说明与许可状态说明

### Included UI Customizations

- AI Team Dashboard 风格总览页
- 实时监控、数据统计、每日记忆
- Bots 列表自动读取 `agents.list`
- Feishu 群会话接入
- Skills 卡片展示与折叠
- 代码提交轨迹卡片
- 模型主链与 fallback 命中状态展示
- 可拉伸输入框与滚动位置保持

### Changed

- 安装脚本对非默认 `OpenClawHome` 的验证提示更准确

