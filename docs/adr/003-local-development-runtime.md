# ADR-003：首批工程运行与验证方式

- 日期：2026-10-27
- 状态：已执行本机工程验证；生产部署未执行
- 关联任务：M0-02、M0-03、M0-04

## 实际环境与选择

本机只有全局 Node 20/pnpm 9，Docker CLI 提示 WSL 集成不可用。采用项目 `.tools` 下的 Node 24.22.1 和 pnpm 12.15.0，未改动全局版本。

正式应用依赖固定为 React 19.3.1、Ant Design 6.6.8、NestJS 12.2.0、TypeScript 6.0.3、Prisma 7.10.1。锁文件记录完整依赖；初始化不跟随 Prisma 的 v8 RC 标签，也不跟随 TypeScript 7 主版本。

数据库采用两个入口：

- 标准入口：`infra/compose.yaml` 的 PostgreSQL 18 容器；需先启用本机 Docker。
- 本机可选入口：下载 `@embedded-postgres/linux-x64@18.4.0-beta.17` 包内的 PostgreSQL **18.4 正式版二进制**，校验固定 SHA-512 后放到 `.tools`，通过项目助手启动，监听 127.0.0.1:55432。

该 npm 分发包带 beta 后缀，仅为可选开发工具的二进制来源，不加入生产应用依赖；实际 `postgres --version` 输出为 18.4。此项不改变应用依赖仅使用正式版本的要求。本机并未验证 Compose 的 PostgreSQL 18.6 镜像或生产部署。

## 隔离与限制

- 本机数据库助手仅支持 Linux x64 普通用户；其他平台使用 Compose 或自行提供 PostgreSQL 18。
- `.tools`、`.local`、`.env` 不入库；脚本不会停止或删除其他数据库。
- 本机数据库凭据只用于 loopback 上的开发数据库，不是应用默认登录密码，不能用于生产。
- 业务库 myteam 和测试库 myteam_test 分开；自动化仅允许在名称以 `_test` 结尾的数据库迁移及创建测试数据。
- 测试不替代完整业务验收，容量、部署恢复、项目隔离等尚未覆盖的项继续保持未执行。
- 真实部署前需在目标 PostgreSQL 补丁与运行环境重跑集成检查，并完成 M6 的备份恢复和容量验证。

## 检查入口

`scripts/check-ci.mjs` 提供与托管平台无关的流水线顺序：冻结安装、生成客户端、格式、静态/类型/单元、构建、数据库集成和浏览器测试。外部 CI 只需提供隔离 PostgreSQL、TEST_DATABASE_URL、Node 24 和 Playwright 浏览器依赖；本次不绑定或创建外部仓库。

具体已运行结果在 [首批验证记录](../verification/m0-identity.md) 和 [进度台账](../progress.md) 记录。

## 2026-10-28：切换既有 PostgreSQL 和 Docker SeaweedFS

用户明确要求停止应用，使用 localhost:5432、postgres 用户的 PostgreSQL，以及其命令创建的 seaweedfs 容器替换原本地服务。当前实际数据库版本为 17.11，业务库 myteam、隔离库 myteam_test。密码只写入本机 .env；APP_ORIGIN 等其他设置保留。

停止前后端后备份旧配置、完整业务 SQL 及 3 份附件。目标实例原只有默认 postgres 库，创建 myteam 并以单事务恢复完整结构/数据；33 张表行数及内容摘要逐一一致，附件仅变更存储桶为 my-bucket，原对象键及业务关联保持。原生 PostgreSQL 55432 和 SeaweedFS 已停止，旧目录保留。

本 WSL 未启用原生 docker 命令集成，已使用 Docker Desktop 的 docker.exe 识别和管理已有容器；不另建同名容器。测试配置复用业务端点及凭据，数据库名加 _test、桶名加 -test，或由 TEST_DATABASE_URL/TEST_S3_* 明确覆盖。迁移备份和验证日志保存在 .local，结果见进度台账的运行环境替换记录。前后端按本次要求保持停止。
