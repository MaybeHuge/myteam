# ADR-004：统一使用 SeaweedFS S3 存储资源

日期：2026-10-27。状态：按用户明确要求实施。替代 ADR-001 中首期附件本地持久卷的选择，其他技术决策保持原有范围。

## 背景与选择

用户要求附件、图片等资源使用自建 SeaweedFS，并移除 LocalStorage。应用运行时仅通过 S3 API 保存和读取资源，使用 AWS SDK for JavaScript v3；没有本地文件存储适配器或回退模式。

当前固定 SeaweedFS 4.51。开发环境支持项目目录内的 Linux x64 二进制与 Compose 两种启动方式；本次真实执行前者，Compose 仅提供配置。二进制从官方 Release 下载并以该发布资产的 SHA-256 校验，不安装全局工具。服务只对本机开放，生产的多副本、TLS、备份与恢复在部署任务落实。

依据：[SeaweedFS 官方发布](https://github.com/seaweedfs/seaweedfs/releases/tag/4.51)、[官方 S3 API 文档](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)、[AWS SDK v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)。

## 存储与授权

- S3Storage 由 InfrastructureModule 提供，通过 S3_ENDPOINT、S3_REGION、S3_BUCKET、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY、S3_FORCE_PATH_STYLE、S3_PREFIX 配置。密钥仅在服务端加载，不返回前端。
- 数据库 Attachment 保存稳定资源 ID、对象键 storageKey、桶 storageBucket、原文件名、识别类型、大小、SHA-256、上传人与业务归属；地址不固化为公开 URL。
- 对象键为当前前缀加 UUID.bin；同一配置内按完整对象键读取，调整新对象前缀不会更改已有引用。切换服务端点不会自动迁移数据。
- 保持私有桶及服务端项目授权。上传和下载均经后端代理，浏览器不获得 S3 凭据；没有开放匿名图片或公共下载。现有 20 MiB、格式及只读状态规则继续生效。
- 就绪检查同时验证数据库与 S3 桶，存储不可用返回 503；存活检查保持独立。

## 数据与对象一致性

远端上传在数据库事务外执行，避免 S3 网络延迟占用项目锁和数据库连接。上传成功后，短事务重新检查当前身份、项目角色、对象状态，保存附件引用、审计、通知和幂等结果。

每个请求生成独立暂存对象键。并发相同幂等请求只提交一份引用，其余上传在事务完成后清理。同键不同输入被拒绝并清理自身对象，不能覆盖已提交内容。

已知事务回调失败或授权失败时补偿删除；删除故障保留原错误并记录待清理事件。数据库提交结果不明时保留对象，避免误删已提交资源；重试复用幂等结果。没有声称 S3 与 PostgreSQL 具备原子提交。

storage:prune 只扫描配置桶的当前前缀，过滤随机命名对象，保留最近 24 小时的对象，并在逐个删除前查询最新数据库引用。其他前缀不处理；配置前缀变更后，旧前缀的无引用对象需要按原配置单独维护。定期任务尚未自动创建。

## 旧资源迁移

第五个数据库迁移新增可空 storageBucket，兼容已有元信息。新增上传均写入桶；旧记录必须先迁移，下载未迁移资源返回清楚的 503，不回退本地读取。

显式命令 storage:migrate-local --source=旧目录按旧键读取原文件，验证大小和 SHA-256，上传后回读校验，再以短事务更新桶/对象键并保存迁移审计。保留资源 ID、业务关联、原名、上传人和原始文件。已经迁移的记录不重复处理，失败可修复后继续。迁移工具的文件读取仅用于一次性数据迁移。

备份必须覆盖 PostgreSQL、SeaweedFS filer 元数据及 volume 数据，或经过验证的 S3 导出；不能只备份应用数据库。完整恢复演练、容量和生产部署仍属于 M6。

## 2026-10-28：替换为用户现有 Docker 容器

当前使用用户已创建的 seaweedfs 容器：chrislusf/seaweedfs:latest、unless-stopped、8333:8333、seaweedfs-data:/data，桶 my-bucket、访问标识 admin，密钥仅保存在 .env。本次读取到该容器内实际版本为 4.50；沿用已有镜像，不把 latest 标签当作固定版本号。

旧原生服务的 3 份业务附件先导出并校验 SHA-256，再关闭旧进程、重启既有容器使 8333 映射生效。按原对象键复制到 my-bucket 并逐一回读校验，最后更新迁移后数据库中的 storageBucket。原资源 ID、业务关联、文件内容和旧目录保留；应用配置与测试隔离桶分别改为 my-bucket、my-bucket-test。此追加替代此前本机原生进程的运行方式，S3 授权、补偿和引用规则不变。
