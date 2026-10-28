import { Alert, Empty, Pagination, Space, Tag } from 'antd';
import { Link } from 'react-router';
import { testCaseStatusLabels, type requirementDetailSchema } from '@myteam/contracts';
import type { z } from 'zod';
import { EmptyPage } from '../../shared/EmptyPage';
import styles from './requirements.module.css';

type Detail = z.infer<typeof requirementDetailSchema>;
export function PreparationNotice({ item }: { item: Detail }) {
  const s = item.testPreparation;
  const active = s.total - s.deprecated;
  const title = s.needsReview
    ? '需求已变化，关联用例需要复查'
    : !s.requirementConfirmed
      ? '需求尚无有效确认基线'
      : !active
        ? '尚无有效用例，请准备测试场景'
        : active === s.draft
          ? '仅有草稿用例，尚不能用于正式测试'
          : !s.usable
            ? '尚无可使用用例，请完成用例评审'
            : `已有 ${s.usable} 条可使用用例`;
  return (
    <Alert
      style={{ marginTop: 16 }}
      showIcon
      type={
        s.needsReview || (s.requirementConfirmed && !s.usable)
          ? 'warning'
          : s.requirementConfirmed && s.usable
            ? 'success'
            : 'info'
      }
      title={title}
      description={
        <>
          <p>
            草稿 {s.draft} · 待评审 {s.inReview} · 可使用 {s.usable} · 需复查 {s.needsReview} ·
            已废弃 {s.deprecated}
          </p>
          {s.needsReview > 0 && (
            <p>
              请先确认需求，再由用例负责人核对、修订并重新送审；未指定负责人时由项目主负责人跟进。
            </p>
          )}
          <span>
            可使用表示当前修订已通过评审且未因需求变更失效；测试前仍需核对场景是否覆盖验收标准。
          </span>
        </>
      }
    />
  );
}

export function RequirementCases({
  item,
  projectId,
  listContext,
  onPage,
}: {
  item: Detail;
  projectId: string;
  listContext: string | null;
  onPage: (page: number) => void;
}) {
  const href = (id?: string) =>
    `/projects/${projectId}?${new URLSearchParams({
      tab: 'test-cases',
      crequirement: item.id,
      ...(id ? { case: id } : {}),
      ...(listContext ? { list: listContext } : {}),
    })}`;
  return (
    <>
      <p>
        <Link to={href()}>在用例库查看此需求的用例</Link>
      </p>
      {!item.cases.total ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未关联测试用例" />
      ) : !item.cases.items.length ? (
        <EmptyPage onReset={() => onPage(1)} />
      ) : (
        item.cases.items.map((row) => (
          <article className={styles.review} key={row.id}>
            <Link to={href(row.id)}>
              {row.code} · {row.title}
            </Link>
            <Space wrap style={{ marginTop: 12 }}>
              <Tag color={row.usable ? 'green' : 'default'}>
                {row.status === 'READY' && !row.usable
                  ? '待重新评审'
                  : testCaseStatusLabels[row.status]}
              </Tag>
              {row.needsReview && row.status !== 'DEPRECATED' && (
                <Tag color="orange">需求变化待复查</Tag>
              )}
              <span>负责人：{row.owner?.name ?? '待分配'}</span>
              <span>评审人：{row.reviewer?.name ?? '尚未指定'}</span>
            </Space>
          </article>
        ))
      )}
      <Pagination
        size="small"
        current={item.cases.page}
        pageSize={item.cases.pageSize}
        total={item.cases.total}
        hideOnSinglePage
        showSizeChanger={false}
        onChange={onPage}
      />
    </>
  );
}
