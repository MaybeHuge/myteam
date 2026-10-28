# MyTeam 项目研发协作平台

覆盖需求、任务、测试用例、测试记录、缺陷和版本构建的研发协作平台。

当前已实现账号会话、项目/成员、迭代、通用协作、需求评审修订、三状态任务看板、用例库及评审、测试记录、缺陷修复复测和版本构建。任务由开发维护待开始/进行中/完成，需求自动汇总为实现中、待测试、测试中或已完成。测试记录替代提测管理和测试执行，支持从用例发起、多次测试、截图附件、失败自动建缺陷及复测联动。现行规则见 [ADR-008](docs/adr/008-lightweight-testing-records.md)，本次验证见 [轻量测试验证](docs/verification/lightweight-testing.md)。独立业务验收和发布仍在后续范围。

技术基线：React 19 + TypeScript + Vite + Ant Design 6；NestJS 模块化单体后端；PostgreSQL + Prisma；Node.js 24 LTS；pnpm workspace。固定版本见 package.json 与 pnpm-lock.yaml；实际运行与限制见 [首批验证](docs/verification/m0-identity.md) 和 [项目与界面验证](docs/verification/m1-projects.md)。

## 本地启动

以下命令在项目根目录执行。Linux x64 可使用项目级工具，无需切换全局 Node。

```sh
./scripts/bootstrap.sh
./scripts/pnpm.sh install --frozen-lockfile
```

首次启动时复制 `.env.example` 为 `.env`，填写 `ADMIN_EMAIL`、`ADMIN_NAME` 和至少 12 位的 `ADMIN_PASSWORD`，同时填写 `S3_ACCESS_KEY_ID`、至少 12 位的 `S3_SECRET_ACCESS_KEY` 及资源桶配置。已有 `.env` 不要覆盖；不要将实际凭据提交到仓库。

准备 PostgreSQL 和兼容 S3 的资源存储。`.env.example` 使用本机 PostgreSQL 和 SeaweedFS 的示例地址；请根据实际环境修改连接和凭据。

PostgreSQL 中准备业务库 `myteam` 和隔离测试库 `myteam_test`。测试连接优先使用 `TEST_DATABASE_URL`，未指定时复用 `DATABASE_URL` 的主机、端口和凭据，并给数据库名增加 `_test`。

SeaweedFS 使用下面的启动方式；已有 `seaweedfs` 容器时无需重复创建，使用 `docker start seaweedfs`。请先在当前 shell 设置并导出与 `.env` 一致的 `S3_SECRET_ACCESS_KEY`：

```sh
docker run -d --name seaweedfs --restart unless-stopped \
  -p 8333:8333 -v seaweedfs-data:/data \
  -e AWS_ACCESS_KEY_ID=admin \
  -e AWS_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}" \
  -e S3_BUCKET=my-bucket chrislusf/seaweedfs:latest
```

已有 SeaweedFS 时，设置 `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET` 和对应凭据，再用 `storage:init` 检查资源桶。容器内运行 API 时，应使用容器可访问的服务地址。

```sh
./scripts/pnpm.sh db:generate
./scripts/pnpm.sh db:migrate
./scripts/pnpm.sh storage:init
./scripts/pnpm.sh build
# 只在首次初始化新数据库时执行；已有同邮箱账号会拒绝覆盖
./scripts/pnpm.sh admin:create
./scripts/pnpm.sh dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)，通过 Vite 同源代理访问 API。后端默认监听 127.0.0.1:3000。使用域名、IP、端口映射或修改前端端口时，将 `.env` 的 `APP_ORIGIN` 设置为浏览器地址栏的应用来源（协议、主机及端口，不含路径），并重启 API；来源不一致时登录及其他写请求会被拒绝。也可将 `APP_ORIGIN` 设置为 `*`，允许任意 HTTP(S) 页面来源，适用于通过不同域名、IP 或映射端口访问同一前端；仍要求有效 Origin、CSRF 和会话。生产环境继续要求 Secure Cookie，通配模式只接受 HTTPS 来源。反向代理须保留浏览器原始 `Origin` 请求头。

- 存活检查：`http://127.0.0.1:3000/api/v1/health/live`
- 数据库与资源存储就绪：`http://127.0.0.1:3000/api/v1/health/ready`
- OpenAPI：`http://127.0.0.1:3000/api/v1/openapi.json`
- 停止前后端：终端 `Ctrl+C`；PostgreSQL 使用其自身管理方式停止，SeaweedFS 使用 `docker stop seaweedfs`，数据卷保留。

## 当前可以做什么

1. 管理员在账号管理中创建普通账号；不会自动发送邮件或密码。
2. 管理员创建项目并成为主负责人，设置简介、主题、图标和日期。
3. 在成员与权限页通过下拉框选择已有账号，支持搜索姓名/邮箱，分配一个或多个项目角色；已加入和已停用的账号会自动排除。
4. 在项目设置中移交主负责人；原负责人的角色保留，可再单独调整。
5. 启动、暂停或继续项目；使用卡片/列表、关键词、状态和我的项目筛选。
6. 普通成员仅看到授权项目；只读成员不能直接请求写入，移除成员后原会话失去访问。
7. 在项目详情「迭代计划」中创建计划、编辑目标/负责人/日期、启动、填写总结并关闭；未完成事项会阻止关闭，已关闭迭代只读。

8. 在项目「讨论与附件」及迭代详情中发布评论、上传/下载附件；只读成员可查看，关闭后的迭代保留历史。
9. 通过顶部铃铛查看评论、附件及迭代安排通知，标为已读或跳转到对应对象。
10. 在工作台查看本人负责的未关闭迭代、逾期与计划，直接进入跟进；改派、关闭及项目权限变化后列表自动更新。
11. 通过顶部搜索切换授权项目；筛选与分页可刷新保留，从项目详情返回仍保留原列表搜索与视图。

项目详情提供需求管理、三列任务看板、测试用例、测试记录、版本与构建及缺陷管理。需求和用例继续保留指定评审、修订与依据失效规则。测试可以提前进行，需求完成要求开发任务全部完成、本轮全部有效用例通过且无阻断缺陷。

演示数据生成方式见下方「检查与测试」。

## 检查与测试

```sh
./scripts/pnpm.sh format:check
./scripts/pnpm.sh check
./scripts/pnpm.sh test:integration
./scripts/pnpm.sh exec playwright install chromium
./scripts/pnpm.sh test:e2e
```

集成和浏览器测试默认连接隔离库 `myteam_test`，不迁移或清空业务库。自备环境可设置 `TEST_DATABASE_URL`，库名必须以 `_test` 结尾，且须预先创建。测试数据库不要与其他同时运行的测试任务共享。资源测试连接真实 SeaweedFS，默认复用业务端点/凭据并将桶名加 `-test`（当前为 `my-bucket-test`）；可设置 TEST_S3_ENDPOINT、TEST_S3_BUCKET、TEST_S3_REGION、TEST_S3_ACCESS_KEY_ID 和 TEST_S3_SECRET_ACCESS_KEY。测试桶名称必须以 `-test` 结尾且不能等于业务桶，每批使用独立 tests/ 前缀；没有本地存储替身。

浏览器测试需要 Playwright 对应的系统依赖。在当前 Ubuntu/WSL 可运行 `./scripts/browser-deps.sh`，将缺少的库和中文字体解压至 `.tools`，不安装系统包；其他系统按 Playwright 文档配置。截图/报告输出到被忽略的 test-results 和 playwright-report。

CI 可运行 `./scripts/pnpm.sh check:ci`，必须显式提供 `TEST_DATABASE_URL`、`TEST_S3_ENDPOINT`、`TEST_S3_BUCKET`，提前准备 Node、数据库、SeaweedFS 和浏览器依赖；S3 测试凭据可用 TEST_S3_ACCESS_KEY_ID/TEST_S3_SECRET_ACCESS_KEY 单独配置。流水线遇错返回非零状态；本次没有创建外部 CI 或生产部署。

`db:seed` 保留原有三个体验账号初始化方式。需要较完整的可查看数据时，在非生产环境运行：

```sh
ALLOW_DEMO_SEED=true ./scripts/pnpm.sh demo:seed
```

该命令通过真实业务接口新增独立批次，不覆盖已有账号和项目，不自动清理。默认生成 16 个项目及 16 个角色账号，其中 5 个项目包含完整需求/任务/用例和质量流程；另有准备中和暂停项目用于查看空态及筛选。可选 DEMO_PASSWORD 指定本批账号密码，否则生成随机密码。批次清单及账号凭据保存在 .local/demo-批次/manifest.json 和 access.json，文件权限受限，命令日志不输出密码。链接和证据均标为演示，不代表真实构建或交付。

设置 `KEEP_TEST_DATA=true` 可保留隔离测试库和测试桶中的测试记录；默认不保留。业务数据库与测试数据库应保持隔离。

## 工程结构

```text
apps/web/               React 页面与客户端
apps/api/               NestJS、Prisma schema、迁移与集成测试
packages/contracts/     共享 schema、DTO、状态和权限矩阵
tests/e2e/              跨角色浏览器测试
scripts/                项目工具、开发数据库和检查入口
infra/                  开发数据库 Compose 与 Nginx 参考配置
docs/                   需求、架构、计划、验收和进度
```

`.env`、`.tools`、`.local`、数据库文件、依赖、生成的 Prisma 客户端及构建产物均不入库。附件已接入授权上传/下载，支持图片、PDF、TXT/Markdown，单文件最多 20 MiB；资源统一保存到 SeaweedFS 私有 S3 桶，应用已移除 LocalStorage；数据库记录桶和对象键，不向浏览器公开凭据。旧版本升级先应用迁移，再运行 `./scripts/pnpm.sh storage:migrate-local --source="$(pwd)/.local/uploads"`；命令按 SHA-256 校验并保留原始文件。使用 `./scripts/pnpm.sh storage:prune` 可清理配置桶/前缀下超过 24 小时且无数据库引用的对象，生产需安排定期维护。资源配置与一致性见 [ADR-004](docs/adr/004-seaweedfs-resource-storage.md)，其他工具来源见 [ADR-003](docs/adr/003-local-development-runtime.md)。

## 文档导航

| 文档                                             | 用途                                             |
| ------------------------------------------------ | ------------------------------------------------ |
| [需求基线](docs/requirements.md)                 | 明确产品范围、角色、首期与后续需求               |
| [技术选型与架构](docs/architecture.md)           | 当前技术栈、模块边界、数据一致性、部署和容量目标 |
| [通用接口契约](docs/api-conventions.md)          | 错误、分页、认证、权限、并发及幂等               |
| [界面设计基线](docs/ui-design.md)                | 后续页面沿用的布局、样式和交互规范               |
| [React 前端决策](docs/adr/002-react-frontend.md) | 前端选型理由、配套组件和初始化验证要求           |
| [业务流程与数据设计](docs/workflows-and-data.md) | 状态流转、业务约束、数据关系与接口边界           |
| [详细开发计划](docs/development-plan.md)         | 阶段、任务编号、依赖、交付物、验收标准           |
| [验收清单](docs/acceptance.md)                   | 功能验收、异常场景、权限与发布验证               |
| [开发进度台账](docs/progress.md)                 | 当前进展、下步任务、决策、风险和变更记录         |
| [首批验证记录](docs/verification/m0-identity.md) | 已执行检查、证据和当前限制                       |

## 后续开发方式

1. 开始工作前先读开发进度台账，再阅读对应任务及业务规则。
2. 按详细开发计划的依赖推进，每次选择一个可验收的任务，先确定实现范围和验证方式。
3. 实现涉及状态、权限、数据关系时，以业务流程与数据设计为基线；变更时同步更新文档。
4. 完成代码、必要检查及验收后，再更新任务状态，并记录实际证据和剩余问题。
5. 持续更新进度台账中的“下一步”，避免仅在聊天中保存重要结论。

建议下一次开发指令：

> 阅读 README.md、docs/progress.md 和 ADR-008，按当前测试记录模型继续设计验收或发布；不要恢复旧提测和批次流程。需求已完成表示开发测试完成，发布资格仍需单独判断。

详细需求来自本项目讨论，文档基线日期：2026-10-27。

功能与界面证据：[项目与成员验证](docs/verification/m1-projects.md)、[基础迭代验证](docs/verification/m1-iterations.md)、[通用协作验证](docs/verification/m1-collaboration.md)。M4 完成时 205 项自动化检查通过（28 契约/缓存 + 162 集成 + 15 个浏览器场景）；格式、静态、类型与构建检查通过；应用框架与 M1 退出证据见 [本批验证](docs/verification/m1-framework.md)，SeaweedFS 切换及迁移证据见 [资源存储验证](docs/verification/seaweedfs-storage.md)。

需求维护与评审证据见 [M2-01 验证](docs/verification/m2-requirements.md)，任务拆解证据见 [M2-02 验证](docs/verification/m2-tasks.md)，M2 全部任务已完成，证据见 [验证记录](docs/verification/m2-completion.md)。M3-01/02 用例库与评审修订已完成，见 [用例验证](docs/verification/m3-cases.md)，M3-03 测试准备、关联用例与评审/复查待办已完成，见 [准备验证](docs/verification/m3-preparation.md)；M3-04 执行快照契约与 M3 阶段退出已完成，见 [M3 完成验证](docs/verification/m3-completion.md)；M4-01—06 全部完成，见 [提测与缺陷验证](docs/verification/m4-completion.md)，现行测试流程已由 ADR-008 替代，后续验收与发布需按新模型调整。
