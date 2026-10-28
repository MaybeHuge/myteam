# ADR-002：前端采用 React

- 日期：2026-10-27
- 状态：已采纳为当前前端开发基线，依赖组合待 M0-02 验证
- 关联任务：M0-01、M0-02、M0-03、M1-05
- 替代范围：[ADR-001](001-technology-and-architecture.md) 的前端、路由、前端状态及组件测试选择；后端、数据库和部署决策继续有效
- 当前完整方案：[技术选型与架构设计](../architecture.md)

## 背景

用户在技术选型讨论中提出“用 React 是不是好点”。项目尚无应用代码，现阶段调整不涉及代码迁移。结合需求表格、任务看板、结构化用例编辑和测试工作台，采用 React 作为后续前端实现基线。

这是对当前项目需求和讨论倾向的选择，不意味着 React 天然比 Vue 更快，也不假设团队已经掌握 React。

## 决策

| 内容       | 采用方案                                | 边界                                          |
| ---------- | --------------------------------------- | --------------------------------------------- |
| 页面       | React 19 + TypeScript + Vite            | 客户端 SPA、函数组件和 hooks                  |
| UI         | Ant Design 6 + CSS Modules + 主题 token | 统一列表、详情、表单和状态操作                |
| 表单       | Ant Design Form                         | 配合共享 Zod schema，不叠加其他表单框架       |
| 路由       | React Router Declarative 模式           | 项目与模块路由、URL 筛选、访问提示            |
| 服务端数据 | TanStack React Query                    | 查询、分页、缓存、失效和加载反馈              |
| 界面状态   | React 本地状态为主，Zustand 按需共享    | 不复制 Query 中的需求、任务、账号等服务端实体 |
| 组件验证   | Vitest + React Testing Library          | 按用户操作验证关键交互                        |
| 端到端     | Playwright                              | 继续验证完整业务闭环                          |

保留 NestJS + PostgreSQL + Prisma 后端，HTTP 契约、权限、业务状态及数据关系不因前端框架改变而放宽。

## 取舍

- React 组件组合方式可用于建立关联对象面板、表格操作、看板卡片和用例步骤编辑器；具体拖拽/图表组件到需要时再验证选型。
- Ant Design 统一基础交互，业务规则仍在后端执行，组件库不会自动实现项目权限或发布条件。
- React 自身不提供完整的路由、请求缓存和后台布局，因此本记录明确配套边界，避免开发期间随意叠加框架。
- 当前应用以登录后的交互为主，已有独立后端，因此首期采用 Vite SPA；若增加 SSR、公开内容或搜索收录需求，另行评估框架方案。
- 目前只修改规划文档，没有安装依赖，也没有完成 React 或后端运行验证。

## 初始化验证

1. 固定 React 19、react-dom、类型定义、Ant Design 6 和对应图标包的兼容正式版本。
2. 验证 TypeScript 类型检查、生产构建、路由刷新、表单、弹窗及 Query 错误处理。
3. 验证身份/项目切换的缓存隔离，以及开发模式重复挂载时副作用清理。
4. 以共享 contracts 发起真实 API 请求，检查会话、CSRF、错误和并发冲突。
5. 建立最小组件检查与 Playwright 入口，不把占位页面或安装成功当作功能验收。

## 官方依据

- [React 版本](https://react.dev/versions)：本次核验当前文档主版本为 19。
- [React SPA 与 Vite](https://react.dev/learn/build-a-react-app-from-scratch)：说明独立 SPA 的建立方式和需补齐的路由/加载能力。
- [Ant Design 6 兼容性](https://ant.design/docs/react/migration-v6/)：React 及图标版本要求。
- [React Router 模式](https://reactrouter.com/start/modes)：Declarative/Data/Framework 模式边界。
- [TanStack Query React](https://tanstack.com/query/latest/docs/framework/react/overview)：服务端数据缓存与同步职责。
