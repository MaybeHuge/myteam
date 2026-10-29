# 通用契约与接口约定

关联任务：M0-03、M1-01—M1-04；当前范围：基础契约、账号会话、账号创建/启停、项目与成员、迭代、评论/附件及站内通知已实现。后续领域继续接入。

## 协议与校验

- API 前缀 `/api/v1`，普通接口使用 JSON 输入输出，附件上传/下载使用二进制文件体；内部状态代码使用英文枚举。
- 共享 Zod schema、公开 DTO、生命周期枚举和角色权限定义位于 `packages/contracts/src/index.ts`。
- API 显式调用同一 schema 执行校验；OpenAPI 通过该 schema 转换，当前地址 `/api/v1/openapi.json`。
- 数据库实体不直接返回浏览器；公开用户对象只包含 id、email、name、isSystemAdmin。
- 查询分页为 page/pageSize，默认 1/20，page 最大 100000，pageSize 最大 100；稳定排序最后包含唯一 ID。账号列表返回 items、total、page、pageSize。
- 时间点采用带时区 ISO 8601；计划日期和业务编号会在对应模块增加。

## 错误结构

```json
{
  "code": "CONFLICT",
  "message": "账号已被其他人修改，请刷新",
  "requestId": "服务端生成的唯一请求编号"
}
```

校验错误可包含 details 数组，但不返回输入密码、堆栈或数据库错误。所有响应携带 X-Request-Id，应用日志使用同一编号。

客户端通过 `Accept-Language` 请求中文或英语（`zh-CN` / `en-US`，接受同语言的区域变体及 q 权重）；缺省或不支持的语言回退中文。错误响应按语言返回 `message` 和自定义字段校验提示，并携带 `Content-Language`、`Vary: Accept-Language`。错误代码、状态枚举、标识和业务数据保持稳定，客户端应依赖 `code` 而非翻译后的文字判断行为。

| HTTP 状态 | 业务代码                | 语义                                   |
| --------- | ----------------------- | -------------------------------------- |
| 400       | VALIDATION_ERROR        | 参数/结构无效                          |
| 401       | UNAUTHENTICATED         | 缺少、过期、撤销或停用账号的会话       |
| 403       | FORBIDDEN               | 权限、Origin 或 CSRF 不满足            |
| 404       | NOT_FOUND               | 资源不存在或按项目隔离策略不可见       |
| 409       | CONFLICT                | 乐观版本冲突，或相同幂等键对应不同操作 |
| 422       | BUSINESS_RULE_VIOLATION | 前置状态或业务条件不满足               |
| 429       | RATE_LIMITED            | 登录错误频次达到阈值                   |
| 500       | INTERNAL_ERROR          | 未预期错误，内部细节不返回客户端       |
| 503       | SERVICE_UNAVAILABLE     | 就绪检查发现数据库不可用               |

## 会话与 CSRF

1. GET `/auth/csrf` 获取一次页面凭据，并设置 HttpOnly CSRF Cookie。
2. POST `/auth/login` 携带 Origin、X-CSRF-Token、页面 Cookie 和邮箱/密码。
3. 登录成功返回公开用户、expiresAt 和 csrfToken；会话令牌仅经 HttpOnly Cookie 发送，数据库保存其 SHA-256 摘要。
4. GET `/auth/me` 恢复当前会话；POST `/auth/logout` 校验 Origin 和会话 CSRF 后撤销会话。
5. POST `/auth/password` 校验原密码及新密码，成功后保留当前会话并撤销其他会话；密码最少 6 位，原密码错误受登录尝试限流保护。

`APP_ORIGIN` 支持固定来源或 `*`。通配模式允许任意有效 HTTP(S) Origin，缺失、`null`、非网页协议及带路径的值仍拒绝；生产只允许 HTTPS 来源且必须启用 Secure Cookie。CSRF、会话和角色校验继续执行，前端沿用同源 `/api` 代理。5. 登录轮换当前 Cookie 对应的旧会话，账号停用撤销该账号全部会话。每次读取会话检查账号状态与有效期。6. 请求必须经同源代理，生产启用 Secure Cookie/HTTPS；开发 Cookie 仅用于本机 HTTP。7. 登录失败按邮箱/IP 的 15 分钟窗口限速；初期邮箱阈值 5、IP 阈值 50，429 返回 Retry-After。统计保存在数据库。该计数是首期基础防护，并非全局原子分布式限流器。

## 并发与幂等

- 普通编辑携带 version，状态写入在事务内核对旧版本，并成功后递增。
- 当前账号创建/启停、项目创建/编辑/状态、成员变更、迭代、评论/附件及通知已读接口要求 UUID 格式的 Idempotency-Key。
- 幂等范围为操作者 + 键；请求摘要同时绑定动作、目标及规范化输入。
- 同键同参数返回已提交结果，同键不同参数返回 409；记录有效期 24 小时。
- `Commands.run` 使用 PostgreSQL 事务级 advisory lock，幂等结果与业务、审计在同一事务写入。
- 跨记录资格判断仍需对应领域锁和规则，幂等锁不替代发布门禁及项目授权。
- 登录/退出采用明确会话语义，不自动重试写请求；退出后的旧会话再次访问返回 401。

## 权限与状态

项目角色矩阵定义在共享契约中，包含负责人、产品、开发、测试、发布和只读角色；开发角色没有复测权限，兼任测试后才获得。

当前已实现账号/系统管理员边界和项目成员/角色校验。项目列表、统计、详情、成员与动态均按项目授权，归档项目不可写。角色权限采用合并语义；只读角色不否决其他同时拥有的角色权限。其他领域 BR 规则随模块实现，枚举存在不代表这些功能已可用。

尚未实现单点登录、会话管理列表、审计查询界面及过期记录定期清理。账号停用已阻止尚有未结束项目的主负责人；任务模块接入后继续补充未结任务改派检查。

## 项目与成员接口

| 接口                                      | 功能与授权                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| GET /projects                             | 按当前身份返回项目、分页和可见范围统计，支持 q/status/scope            |
| POST /projects                            | 仅系统管理员创建，默认创建者为主负责人；同一事务建立 OWNER 成员        |
| GET /projects/:id                         | 成员或管理员可读，返回当前 allowedActions                              |
| POST /projects/:id/update                 | 项目管理权限，校验 version；主负责人必须为有效项目成员                 |
| POST /projects/:id/status                 | 当前仅支持启动/暂停/继续，暂停须原因                                   |
| GET /projects/:id/members                 | 授权项目内分页/按 q 搜索姓名或邮箱，不提供全局账号枚举                 |
| GET /projects/:id/member-options          | 需成员管理权限；分页/按 q 搜索可加入的系统账号，排除已加入与已停用账号 |
| POST /projects/:id/members                | 成员管理权限，以已有有效账号邮箱加入                                   |
| POST /projects/:id/members/:userId/roles  | 成员管理权限，校验成员 version，主负责人保留 OWNER                     |
| POST /projects/:id/members/:userId/remove | 成员管理权限，校验 version，不能移除主负责人                           |
| GET /projects/:id/activity                | 授权项目内的近期真实操作，不返回其他项目动态                           |
| POST /users                               | 仅系统管理员创建普通账号；不接受提权参数，不发送外部消息               |

非成员与不存在项目统一返回 404；已是成员但缺操作权限返回 403。管理员跨项目访问留痕。写入在项目锁内复查角色和状态；Commands 在返回旧幂等结果前也重新执行授权回调。

后续模块通过 ProjectsModule 导出的 ProjectsService.authorize 在自身事务内复用授权，不自行复制成员判断。该服务接口不是公开 HTTP API。

主负责人和 OWNER 角色分开：每个项目有一个主负责人，可以有多名 OWNER 角色成员。移交会给新负责人增加 OWNER，保留原成员角色，必要时另行降权。未结束项目的主负责人必须先移交，才能停用其账号。

账号创建的密码证明经过 Argon2id，不以可快速枚举的普通密码摘要做幂等比较；原始密码和证明不进入日志或接口响应。

成员重新加入时使用高于原记录的版本代次，移除前的旧角色表单不能命中新成员记录。项目版本更新与成员变更在同一事务中提交。

添加成员选择器使用 `member-options`，支持 `q`（姓名或邮箱，不区分大小写，最多 100 字符）、`page` 和 `pageSize`（默认 20，最多 100）。响应只包含账号 `id/name/email` 与分页信息，不返回密码、管理员标记或账号管理能力；该查询只对当前项目具有成员管理权限的人与系统管理员开放，归档项目返回 403。项目内普通成员列表与候选账号查询分别授权，普通开发/只读成员不能借此查询系统账号。前端选中账号后仍以邮箱提交现有添加命令，提交时重新校验账号状态、重复关系及操作者权限。

## 基础迭代接口

统一前缀 `/projects/:projectId/iterations`：

| 方法与后缀       | 行为                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| GET /            | 项目内成员可读，支持 q/status/ownerId/page/pageSize；统计为整个当前项目，不受列表筛选影响 |
| POST /           | 迭代管理权限；name/ownerId/startDate/endDate 必填，goal 规划时可空；初始 PLANNING         |
| GET /:id         | 同项目详情及分页范围条目；page/pageSize 默认 1/20，上限 100                               |
| POST /:id/update | 完整计划字段和 version；不能改已关闭迭代或任意设置 status                                 |
| POST /:id/start  | version；须 PLANNING、目标非空且项目 ACTIVE                                               |
| POST /:id/close  | version 和非空 summary；须 ACTIVE，全部 OPEN 事项为零，保存关闭时间及总结                 |

写操作复用 CSRF、幂等键和项目级事务授权，只有 OWNER 或系统管理员具备当前迭代管理权限。已完成/待验收/已归档项目只读；暂停项目可编辑计划和关闭迭代但不能启动。日期不能倒置，也不能超出项目已设置的边界。负责人必须为项目可用成员；项目内迭代名称唯一。并发版本或重复名称返回 409，门禁/非法状态/跨日期范围返回 422，跨项目标识返回 404，无写权限返回 403。

关闭失败会返回 open 数量，界面保留填写的总结；服务端统计全部范围，不以客户端数字作为依据。当前没有迭代删除、重新打开、WorkItem 状态修改或结转 HTTP 接口；后续领域模块遵守 [架构中的接入约定](architecture.md#16-基础迭代实施与-m2-接入约定)。

## 通用协作与通知（M1-04）

对象前缀为 `/projects/:projectId/collaboration/:targetType/:targetId`。目前仅接受 `PROJECT` 和 `ITERATION`，前者 targetId 必须等于 projectId，后者须为当前项目的迭代；其他领域随对应模块接入，不能仅扩展前端枚举。

| 方法与路径                                        | 输入、行为与授权                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET 对象前缀/comments                             | 按 page/pageSize 倒序分页，返回作者姓名、纯文本、时间和 canWrite                    |
| POST 对象前缀/comments                            | `{body}`，去除首尾空白后 1—5000 字符；写入评论、审计及负责人通知                    |
| GET 对象前缀/attachments                          | 分页返回文件名、识别类型、大小、上传人姓名、时间与 canWrite；不公开存储键           |
| POST 对象前缀/attachments?filename=文件名         | `application/octet-stream` 原始文件体，最大 20 MiB；文件名不含路径和控制字符        |
| GET /projects/:projectId/attachments/:id/download | 重新检查项目和目标对象，私有文件流以 attachment、UTF-8 文件名、nosniff 返回         |
| GET /notifications                                | 仅本人且仍有项目访问权的消息，支持 page/pageSize、unread=true；返回当前可见未读总数 |
| POST /notifications/:id/read                      | 自己的可见消息标为已读；重复调用保留首次已读时间                                    |

写入均要求 Origin、CSRF 与 UUID 幂等键。评论和附件的 `collaboration:write` 授予所有业务角色，只读角色仅可查看；已关闭迭代、已完成和归档项目不可新增协作内容，仍允许授权读取历史。通知已读属于个人操作，不要求项目业务写权限。非成员、跨项目对象或他人通知返回 404，缺少写权限返回 403。

附件同键摘要绑定目标、文件名和内容 SHA-256；成功重试最终仅保留一份资源对象、元信息和业务通知；临时多余对象会在事务完成后回收。先检查权限再读取最多 20 MiB 内容，将对象上传到 SeaweedFS 后，在短数据库事务的项目锁内再次授权并保存引用；S3 网络 I/O 不占用业务事务。允许 PNG/JPEG/WebP、PDF、UTF-8 TXT/Markdown，扩展名须匹配可识别内容；任意 HTML/SVG/可执行扩展名不接受。文件内容不进入审计。

`CollaborationEvents.record(tx, event)` 由业务模块在同一事务内调用，审计与站内消息任一失败则整体回滚。评论/附件通知目标负责人；迭代创建、更新/改派、启动与关闭通知当前迭代负责人，排除操作者本人、已停用或已不在项目的接收者。通知是历史消息，不作为未完成待办计算依据。前端每 30 秒查询，页面不可见时暂停轮询，暂无实时推送或外部消息。

明确事务回滚时补偿删除对象，补偿故障记录待清理事件并保留原错误；数据库提交结果不明时保留对象，避免误删已提交附件。同键并发请求提交一份引用，其他独立上传被回收。S3 不可用返回 503，就绪检查同时检查数据库和资源桶。

`./scripts/pnpm.sh storage:prune` 只清理配置桶/前缀下超过 24 小时且无最新数据库引用的随机命名对象。生产需将此命令纳入定期维护，本次未创建外部调度。旧附件用 `storage:migrate-local --source=旧目录` 校验迁移，未迁移记录不回退本地读取；详见 [ADR-004](adr/004-seaweedfs-resource-storage.md)。数据库和 SeaweedFS 元数据/内容需配套备份。

## 工作台与应用框架（M1-05）

`GET /workbench/todos` 仅返回当前会话用户负责、当前仍为项目成员的未关闭迭代，公开类型为 `ITERATION_FOLLOW_UP`。系统管理员同样遵守“我的”范围，不利用跨项目管理能力读取他人的待办。只读成员可以跟进自己负责的迭代，管理命令仍受原有角色校验约束。

| 参数          | 规则                                                |
| ------------- | --------------------------------------------------- |
| q             | 可选，最多 100 字符，搜索迭代名称、项目名称或标识   |
| status        | all（默认）、PLANNING、ACTIVE 或 overdue            |
| projectId     | 可选 UUID；无权项目与不存在项目均返回空列表及零统计 |
| page/pageSize | 默认 1/20，page 上限 100000，pageSize 上限 100      |

返回 items/total/page/pageSize，以及 summary.total/planning/active/overdue、today、timeZone。summary 随关键词及项目范围变化，不随状态页签收窄；列表与统计在同一 RepeatableRead 事务中查询。按截止日期升序、ID 排序，分页稳定，不暴露原始账号或无关领域信息。

已关闭迭代，以及待验收、已完成、已归档项目不进入跟进列表；暂停项目仍保留负责人安排。逾期按 Asia/Shanghai 当天日期判断，截止日当天不算逾期。改派、关闭和成员权限变化后，下一次查询立即反映当前状态，不读取通知来推算待办。接口不接受由客户端选择待办所属用户，亦不提供手工勾选完成命令。

前端工作台每 30 秒查询，页面隐藏时暂停轮询，支持手动刷新。业务命令成功使待办查询失效；任意查询/命令返回 401 时统一取消请求、清理旧业务查询缓存并退出客户端会话，403 保留当前会话并展示权限反馈。

项目切换从授权项目接口分页搜索，保留共用页签，清除原项目的详情 ID、筛选、分页和表单状态。项目、迭代、成员、账号及待办列表的筛选/分页保存在 URL；不合理页码按第一页展示，合法但已超出当前结果的页面可返回第一页。项目列表进入详情及切换页签后，刷新和返回仍保留原项目列表的搜索/视图上下文。

## 需求维护与评审（M2-01）

需求前缀为 `/projects/:projectId/requirements`。读取需要项目访问权限；写草稿、送审、撤回、取消需要 `requirement:write`；确认/退回需要 `requirement:review` 且是本轮指定评审人。系统管理员代审必须填写原因，审计记录 `adminOverride`。

| 方法与路径           | 输入 / 行为                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| GET 前缀             | `q/status/priority/type/ownerId/iterationId/page/pageSize`；返回分页需求与 `canCreate`            |
| POST 前缀            | `title/description/acceptanceCriteria/type/priority/ownerId/iterationId`；创建 DRAFT，返回 `{id}` |
| GET `/people`        | `purpose=owner\|reviewer`、`q/page/pageSize`；返回本项目可用成员；评审候选额外校验评审权限        |
| GET `/:id`           | 需求、`allowedActions` 与分页 `history`；`page/pageSize` 控制评审历史                             |
| POST `/:id/update`   | 全量草稿字段与 `version`，调整已有迭代需 `changeReason`                                           |
| POST `/:id/submit`   | `version/reviewerId/comment?`；校验完整性、保存快照，进入 IN_REVIEW                               |
| POST `/:id/approve`  | `version/comment?`；再校验完整性及快照一致性，进入 CONFIRMED                                      |
| POST `/:id/return`   | `version/comment`；附原因退回 DRAFT                                                               |
| POST `/:id/withdraw` | `version/comment`；附原因撤回 DRAFT，可重新安排评审人                                             |
| POST `/:id/cancel`   | `version/comment`；仅草稿可取消，标记 CANCELLED，保留记录                                         |

所有写命令需要会话、CSRF、UUID 幂等键，先重新授权再重放成功结果；`version` 冲突返回 409。草稿仅要求标题；送审及确认必须具有描述、项目可用负责人和可判断的验收标准。状态不能由创建/更新参数直接设置。`revision` 表示内容版本，编辑递增；`version` 表示命令并发版本，每次变更递增；`reviewRound` 表示送审轮次。评审记录保存本轮原始快照，退回、撤回和重新提交均不会覆盖旧内容。

编号格式为 `项目标识-REQ-0001`，按项目在事务内递增，失败回滚编号。计划归属只存在于同 ID 的 WorkItem；不允许直接清空已有迭代，跨迭代调整需要原因且双方均未关闭。确认只形成需求基线，WorkItem 仍为 OPEN；取消草稿才同步 CANCELED。

协作目标新增 `REQUIREMENT`，评论和附件沿用现有接口与 SeaweedFS 私有资源授权；取消/完成需求或所属迭代关闭后协作只读。评审通知定位到 `?tab=requirements&requirement=:id`。已确认内容变更与影响机制在 M2-04 实现，待评审工作台聚合在 M2-05 实现。

## 任务拆解与分配（M2-02）

前缀为 `/projects/:projectId/tasks`。任务读取需要项目访问权限；任务写入需要 `task:write`（负责人、开发；系统管理员可留痕代办）。开发可维护本人负责，或本人创建且未分配的待开始任务；`task:assign` 允许项目负责人维护和改派其他成员任务。产品、测试、发布及只读角色不能借任务页面获得任务写权限。

| 方法与路径          | 行为                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET 前缀            | `q/status/priority/requirementId/iterationId/assigneeId/unassigned/page/pageSize`；标题、编号或说明搜索与分页           |
| POST 前缀           | `requirementId/title/description/priority/estimatedHours/dueDate/assigneeId/iterationId?`；在同项目需求下建立 TODO 任务 |
| GET `/people`       | 分页搜索可分配成员；负责人可选具备任务权限的项目可用成员，开发仅返回本人                                                |
| GET `/requirements` | 分页搜索可拆分需求，支持标题或编号；排除结束需求及需求迭代关闭的对象                                                    |
| GET `/:id`          | 任务、关联需求、当前负责人/计划、`allowedActions`、`canAssignOthers` 与分页 `history`                                   |
| POST `/:id/update`  | 标题、说明、优先级、估算、截止日、迭代及 `version`；计划改变需要 `changeReason`                                         |
| POST `/:id/assign`  | `version/assigneeId/reason`；负责人分配/改派/撤销待开始任务分配；开发可认领未分配任务                                   |
| POST `/:id/start`   | `version/reason?`；本人开始，负责人代为开始必须说明原因                                                                 |

所有命令需要会话、CSRF 和 UUID 幂等键；成功重放前重新校验当前角色与任务责任范围。编辑/改派/开始均校验 version，冲突不产生部分修改。任务所属需求在创建后固定，不能通过更新参数偷偷改关联、负责人或业务状态。

估算单位为小时，可留空，范围 0—10000，按 0.25 小时递增；截止日为可空的合法日历日期。截止日不额外强制限制在迭代日期内。任务优先级为 LOW/MEDIUM/HIGH/URGENT，与需求独立。编号为 `项目标识-TASK-0001`，按项目在事务内递增。

任务可以在草稿或待评审需求下先做计划，开始前关联需求必须为 CONFIRMED/IMPLEMENTING，任务有合资格负责人，项目为 ACTIVE；已安排的任务迭代也须 ACTIVE。首次开始使关联需求从 CONFIRMED 进入 IMPLEMENTING，与任务、审计、通知及幂等同事务；评审快照和内容修订保持原值。任务与需求 WorkItem 仍为 OPEN。

任务迭代默认沿用创建时的需求迭代，也可显式指定同项目其他未关闭迭代或项目待安排；任务维护独立的 WorkItem 计划归属。已有迭代不能直接清空；调整必须写原因，进行中任务只能调整至进行中的迭代。结束需求或关闭迭代只读。有未结束任务的需求不能直接取消。

改派在一条业务审计中保存前后快照和原因，通知新旧负责人并排除操作者、去重；通知和审计失败一起回滚。未结束任务负责人移出、停用或收回任务权限前必须改派。TASK 协作目标沿用评论、SeaweedFS 私有附件及下载授权，通知定位到 `?tab=tasks&task=:id`。

本批只开放 TODO → IN_PROGRESS。看板、独立阻塞标记、恢复及取消在 M2-03 实现；待测试、测试、验收、完成由 M4/M5 领域命令接入，不能任意跳转；完整任务待办与追溯在 M2-05 接入。

## M2 完成范围：看板、阻塞、修订与工作台

前述 M2-01/02 的“待后续”说明是当时的阶段边界，本节为当前接口行为。

### 看板及任务命令

`GET /projects/:projectId/tasks/board` 使用任务列表的关键词、负责人、需求、迭代、优先级、blocked/overdue 筛选；三列 TODO/IN_PROGRESS/CANCELLED 各自分页，参数为 todoPage/progressPage/cancelledPage/pageSize。每列返回完整 total，summary 是同一筛选范围的总数、阻塞数和逾期数。状态筛选用于列表；看板通过列表达状态。拖动只映射既有开始/取消命令，必须确认服务端成功后才移动卡片，非法或失败操作保留原位置。

任务前缀 `/projects/:projectId/tasks/:id` 新增：

| POST 路径      | 输入与行为                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `/block`       | version/reason/helperId；原因必填，协助人须为本项目可用且具有协作权限的成员；可调整已有阻塞安排     |
| `/resume`      | version/reason；清除阻塞，不改变业务状态；运行中任务需要当前需求依据及进行中的项目/任务迭代         |
| `/cancel`      | version/reason；仅 TODO/IN_PROGRESS，可按原责任权限取消；清除阻塞并同步 WorkItem.CANCELED，保留历史 |
| `/acknowledge` | version/reason/requirementRevision；新修订确认后明确核对任务影响，绑定具体修订；不自动恢复阻塞      |

这些命令使用原任务维护权限，协助身份不会自动授予编辑、恢复或取消别人的任务权限。`GET /tasks/people?purpose=helper` 返回可协助成员；默认 purpose=assignee 保留原分配限制。阻塞仍是独立标记，不新增 BLOCKED 业务状态；Task DTO 新增 blocked/blockedReason/helper/blockedAt/basisRevision/needsRequirementReview。

开始禁止阻塞任务。取消不支持跳到测试、验收或完成。未处理的协助责任也受移出、停用和协作失权保护，须先恢复、取消或调整协助人。

### 需求修订与追溯

`POST /projects/:projectId/requirements/:id/revise` 使用全量需求字段、version、reason、impact；仅具有需求维护权限的成员可对 CONFIRMED/IMPLEMENTING 发起新草稿。原因、影响说明与实际变化必填，原迭代不可直接清空。修订后必须重新送审；有运行中任务时重新确认回 IMPLEMENTING，否则回 CONFIRMED。

Requirement DTO 增加 acceptedRevision/scopeVersion；详情增加 baseline、分页 changes、分页 tasks 及 taskSummary。page/pageSize 控制评审与修订历史，taskPage 单独控制关联任务页。修订历史保留发起时前后快照，后续草稿编辑另有审计，最终确认快照仍以评审记录为准。

旧依据以 requirementId/revision/scopeVersion 令牌校验，细节见 [ADR-005](adr/005-requirement-baseline-invalidation.md)。没有面向浏览器的伪造验收或发布检查接口；后续模块在自身授权事务中调用 RequirementValidity。每次修订持久保存 affectedTaskIds 和用例复审/验收失效/发布检查失效标记。

### 当前工作台

`GET /workbench/todos` 默认聚合当前用户的迭代跟进、未结束任务、待评审需求及阻塞协助。kind 可为 ITERATION_FOLLOW_UP/TASK/REQUIREMENT_REVIEW/TASK_ASSIST；支持 q/projectId/page/pageSize，以及 all/pending/active/overdue/blocked 或具体领域状态筛选。逾期按上海日期判断，截止日当天不算逾期。

管理员同样只聚合本人责任且仍为项目成员的事项；评审限定当前指定且有评审权限的用户，协助不重复计算同一个人负责的任务。结束/关闭或无权对象不进入工作台。通知保留历史，改派、取消、评审结论、恢复和权限变化后列表立即反映当前状态。

统一 SQL 范围在 RepeatableRead 事务中分页、计数及统计，不把通知或当前页数量作为全部待办。summary 按 q/projectId/kind 范围统计，独立于当前 status 页筛选；新增 tasks/reviews/assistance/blocked 计数。

## M3-01/02 用例库与评审

`/projects/:projectId/test-cases` 提供项目内用例列表和草稿创建；`/:id` 返回详情、独立分页的修订与评审历史。筛选支持 q/status/priority/ownerId/requirementId/usable，页码仍为 page/pageSize；详情修订页码为 revisionPage。`/people?purpose=owner|reviewer` 和 `/requirements` 是分页候选接口。

写命令为 update/revise/submit/approve/return/withdraw/deprecate，均要求当前会话、Origin、CSRF、幂等键和目标 version（创建除外）。负责人及测试角色可编写；只有指定且仍具资格的评审人可给出结论，管理员代评须说明并留痕。负责人必须为本项目有用例编写权限的可用成员。移除、停用或收回权限前，须处理未废弃用例负责人和待评审人职责。

创建及保存内容时校验关联需求已经确认或实现中，并捕获 ADR-005 需求依据；一个用例可关联 1—50 个本项目需求。草稿可缺少负责人和步骤，但送审与通过都要求负责人有效、至少一个步骤且每步操作/预期非空。前置条件可以为空。送审后内容不可编辑，退回和撤回必须说明原因。

每次内容保存追加 TestCaseRevision，保留当时标题、前置条件、有序步骤/预期、优先级、负责人、需求名称及需求依据。READY 用例修改须走 revise，附原因生成新草稿，不覆盖旧修订或通过记录。废弃不可恢复；历史与已授权附件仍可查看。

需求修订与关联用例 needsReview 标记及 version 递增在同一项目事务锁内执行。READY 是最近评审状态；`usable` 才表示当前修订是否仍可用于正式测试，不能单凭 READY 判断。列表的 usable=true 排除需重新评审的用例；重新确认需求不会清除此标记。后续正式测试选择在自身授权事务内调用 `TestCasesService.selectUsableRevision`，校验当前修订、评审结论以及全部需求令牌，不能选择草稿、废弃、旧修订或已失效依据。

用例协作目标为 TEST_CASE，评论、私有 SeaweedFS 附件和站内评审通知沿用既有授权与事务机制。覆盖提示、复查工作台、测试批次完整快照分别继续在 M3-03/04、M4 接入。

## M3-03 测试准备与当前用例待办

`GET /projects/:projectId/requirements/:id` 新增 `cases` 与 `testPreparation`。`casePage` 独立控制关联用例分页，共用 `pageSize`；任务仍使用 `taskPage`，评审/修订历史仍使用 `page`。只读成员可以查看，非成员及跨项目对象按既有规则返回 404。明细、总数与准备统计在同一 RepeatableRead 事务读取。

`testPreparation` 包含 requirementConfirmed、total、draft、inReview、usable、needsReview、deprecated。total 包含废弃历史；draft/inReview 是当前状态数，needsReview 是未废弃用例中的失效标记数，会与状态数重叠，不能把各字段简单相加。usable 与用例库筛选共用条件：READY、approvedRevision 等于当前 revision、needsReview=false。多需求用例按用例身份计一次，任一关联需求修订都会使它不可用。requirementConfirmed 表示该需求处于 CONFIRMED/IMPLEMENTING 且 acceptedRevision 等于 revision。

页面提示无有效用例、仅草稿、尚待评审或需求变更复查；存在可使用用例时显示真实数量。该提示不是场景覆盖率，也不代替 M4 的提测范围、构建及接收条件检查。

工作台 `kind` 新增 TEST_CASE_REVIEW、TEST_CASE_RECHECK。评审按当前指定评审人及当前评审权限聚合；复查按当前用例负责人聚合，未分配负责人时由当前项目主负责人跟进，且须具备用例编写权限。两种责任可以同时存在，同一对象用 kind/id 区分。NEEDS_REVIEW 是复查待办的展示状态，不是新增用例业务状态。

需求修订事务中的 needsReview 标记即为复查来源；需求重新确认不会清除此待办。核对新需求、保存新内容修订后复查待办退出，此时用例仍为草稿，重新提交后形成评审待办，通过后才可使用。退回/撤回/通过使原评审待办退出，废弃移除两种待办；旧通知保留但不影响待办。权限、成员身份和项目状态按当前值查询，管理员只看本人且仍为项目成员的责任。

summary 新增 caseReviews/caseRechecks，reviews 统计需求及用例评审之和；均延续 q/projectId/kind 范围，独立于当前 status 和页码。无新增数据库结构、配置或迁移。

## M3-04 正式执行快照契约

共享契约新增 `testCaseExecutionSnapshotSchema` / `TestCaseExecutionSnapshot`，OpenAPI 的 components.schemas.TestCaseExecutionSnapshot 同步公开结构供后续模块引用，现有 HTTP 路径保持不变。

| 字段                    | 内容                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| schemaVersion           | 固定 1；缺少或未知版本拒绝                                                      |
| projectId               | 快照所属项目                                                                    |
| source                  | testCaseId、revisionId、revision，指向具体不可覆盖内容修订                      |
| content                 | code、title、preconditions、有序 steps（action/expected）、priority、owner 身份 |
| requirements            | 全部 requirementId/revision/scopeVersion 及当时 code/title，1—50 个且不重复     |
| approval                | reviewId、round、reviewer、decidedBy、approvedAt，引用实际通过结论              |
| capturedAt / capturedBy | 数据库 UTC 冻结时间、已认证操作者身份                                           |

正式快照要求有效负责人、1—100 个完整步骤及每步非空白预期；前置条件可以为空。每层严格校验未知字段，不接受执行结果注入；步骤原文不 trim，JSON 往返保留换行和空白。解析结果在运行时及 TypeScript 类型上逐层只读。旧草稿历史 schema 保持原有默认值及兼容行为。

服务端内部使用 `TestCasesService.freezeExecutionSnapshot(tx, projectId, id, revision, capturedBy)`。调用方先进行真实用户、test:execute、项目与批次状态/范围授权，并在同一事务内保存返回 JSON。工厂使用项目行锁复核当前可用修订、真实 APPROVED 轮次、修订内容及全部需求依据；不能选择草稿、废弃、旧修订、已失效依据或伪 READY。数据不完整/不一致返回 422，跨项目对象返回 404。完整规则及 M4 持久化职责见 [ADR-006](adr/006-test-case-execution-snapshot.md)。

读取历史 JSON 使用版本化快照 schema，不重新查询最新用例来组装正文。后续资格检查继续使用 ADR-005 及构建/结果条件；M4 已接入实际测试批次、执行项和不可覆盖存储约束，对外领域命令见下节。

## 当前版本、测试记录与缺陷接口

统一前缀 `/api/v1/projects/:projectId/quality`。写接口继续要求当前授权、版本号、幂等键、可写项目和事务事件。

| 对象     | 查询                       | 命令                                                                         |
| -------- | -------------------------- | ---------------------------------------------------------------------------- |
| 版本     | GET releases、releases/:id | POST releases、releases/:id/update                                           |
| 构建     | GET builds                 | POST builds                                                                  |
| 测试记录 | GET records、records/:id   | POST records、records/:id/finish                                             |
| 缺陷     | GET defects、defects/:id   | POST defects、:id/confirm、assign、start、fix、retest、reopen、dispose、link |
| 候选     | GET options、people        | 授权分页、搜索及已选 ID 回显                                                 |

任务另有 `/tasks/:id/start`、`complete`、`reopen`、`reset`，均受责任、版本和当前需求依据约束。已移除任务取消命令和提测、测试批次接口。

创建测试记录需要 testCaseId、requirementId、environment，可选 buildId、type 和 defectIds。结果初始为 NOT_RUN；finish 仅接受 PASSED/FAILED，需要实际表现，可引用当前记录附件并选择已有缺陷。未通过自动创建或复用缺陷。最终结果不能覆盖，再次测试创建新记录。

缺陷创建的 testCaseIds 和 testRecordIds 均可留空，关联记录自动带出用例。foundBuildId 可选；已有构建上下文的缺陷修复和复测继续校验实际构建。未关联用例的手工缺陷允许不引用测试记录直接登记复测，但必须有原因和证据。

工作台类型 TEST_RECORD 代替 SUBMISSION_REVIEW/TEST_EXECUTION。附件协作目标为 TEST_RECORD。记录提供 current 判断依据是否有效，失效记录不可提交结果。详情与列表只展示服务端给出的 allowedActions；权限仍由服务端独立复查。完整规则见 [ADR-008](adr/008-lightweight-testing-records.md)。

## 简化版本交付接口

- `GET /projects/:projectId/quality/releases/:id/check?buildId=…` 返回当前版本范围、需求状态、构建和阻断原因；`buildId` 可省略，用于提示选择构建。
- `GET /projects/:projectId/quality/releases/:id/events` 分页返回发布、上线验证及回滚历史。
- `POST /projects/:projectId/quality/releases/:id/publish` 需发布管理权限、版本号与幂等键，登记成功或失败并在事务内重新检查；成功时版本变为已发布。
- `POST /projects/:projectId/quality/releases/:id/followup` 对当前成功发布追加验证通过、失败或回滚记录；回滚后版本恢复未发布。
- 检查快照记录需求修订、测试轮次和构建范围，但不证明所选构建本身经过测试；实际包与测试依据由发布负责人核实。
