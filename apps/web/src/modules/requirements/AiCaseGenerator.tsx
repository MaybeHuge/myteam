import { randomUUID } from '../../shared/random-uuid';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Input, Modal, Select, Space } from 'antd';
import type { Project, Requirement, SessionResponse } from '@myteam/contracts';
import { errorMessage, request } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { loadRequirement } from './api';
import { providerLabel } from '../ai/provider-label';

type Candidate = {
  title: string;
  basis: string;
  preconditions: string;
  steps: { action: string; expected: string }[];
  selected: boolean;
  saved: boolean;
  locked: boolean;
  key: string;
};
type Result = {
  revision: number;
  questions: string[];
  cases: Omit<Candidate, 'selected' | 'saved' | 'locked' | 'key'>[];
};
export function AiCaseGenerator({
  project,
  item,
  session,
  onClose,
}: {
  project: Project;
  item: Requirement;
  session: SessionResponse;
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const { message } = App.useApp();
  const [cases, setCases] = useState<Candidate[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [revision, setRevision] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<string>();
  const providers = useQuery({
    queryKey: ['ai-providers', session.user.id, project.id],
    queryFn: ({ signal }) =>
      request<{ id: string; name: string; model: string }[]>(
        `/projects/${project.id}/test-cases/ai-providers`,
        { signal },
      ),
  });

  const update = (index: number, patch: Partial<Candidate>) =>
    setCases((old) => old.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await request<Result>(
        `/projects/${project.id}/test-cases/ai-generate/${item.id}`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': session.csrfToken },
          body: JSON.stringify({ provider }),
          signal: AbortSignal.timeout(70000),
        },
      );
      setRevision(result.revision);
      setQuestions(result.questions);
      setCases(
        result.cases.map((c) => ({
          ...c,
          selected: true,
          saved: false,
          locked: false,
          key: randomUUID(),
        })),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const current = await loadRequirement(project.id, item.id, 1);
      if (
        current.revision !== revision ||
        !['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(current.status)
      )
        throw new Error(t('需求已变更，请关闭后重新生成用例'));
      for (const [index, candidate] of cases.entries()) {
        if (!candidate.selected || candidate.saved) continue;
        if (
          !candidate.title.trim() ||
          candidate.steps.some((step) => !step.action.trim() || !step.expected.trim())
        )
          throw new Error(t('请填写所选用例的标题、步骤和预期'));
        update(index, { locked: true });
        await request(`/projects/${project.id}/test-cases`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': candidate.key },
          body: JSON.stringify({
            title: candidate.title,
            preconditions: candidate.preconditions,
            steps: candidate.steps,
            priority: 'MEDIUM',
            ownerId: session.user.id,
            requirementIds: [item.id],
            expectedRequirementRevision: revision,
          }),
        });
        update(index, { saved: true, selected: false });
      }
      await client.invalidateQueries({ queryKey: ['projects'] });
      void message.success(t('所选用例已保存为草稿'));
    } catch (e) {
      setError(errorMessage(e));
      await client.invalidateQueries({ queryKey: ['projects'] });
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (cases.some((c) => !c.saved)) {
      Modal.confirm({
        title: t('放弃未保存的候选用例？'),
        content: t('关闭后未保存的候选内容将丢失。'),
        okText: t('放弃并关闭'),
        cancelText: t('继续编辑'),
        onOk: onClose,
      });
    } else onClose();
  };
  return (
    <Modal
      open
      width={800}
      title={t('AI 生成测试用例')}
      onCancel={busy ? undefined : close}
      closable={!busy}
      mask={{ closable: !busy }}
      footer={
        <Space wrap>
          <Button disabled={busy} onClick={close}>
            {t('关闭')}
          </Button>
          {revision === undefined && (
            <Button
              type="primary"
              loading={busy}
              disabled={!provider}
              onClick={() => void generate()}
            >
              {t('开始生成')}
            </Button>
          )}
          {revision !== undefined && (
            <Button
              type="primary"
              loading={busy}
              disabled={!cases.some((c) => c.selected && !c.saved)}
              onClick={() => void save()}
            >
              {t('保存所选草稿')}
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        showIcon
        type="info"
        title={t(
          '生成时会将需求标题、描述和验收标准发送给配置的 AI 服务。请检查结果，保存后仍需评审。',
        )}
      />
      {revision === undefined && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="ai-provider">{t('选择 AI 平台')}</label>
          <Select
            id="ai-provider"
            style={{ width: '100%', marginTop: 8 }}
            loading={providers.isLoading}
            value={provider}
            onChange={setProvider}
            placeholder={t('请选择可用平台')}
            options={providers.data?.map((p) => ({
              value: p.id,
              label: `${providerLabel(p.id, p.name)} · ${p.model}`,
            }))}
          />
          {providers.isError && (
            <Alert
              type="error"
              showIcon
              title={errorMessage(providers.error)}
              action={<Button onClick={() => void providers.refetch()}>{t('重试')}</Button>}
            />
          )}
          {providers.data?.length === 0 && (
            <Alert type="warning" showIcon title={t('暂无可用 AI 平台，请联系管理员配置')} />
          )}
        </div>
      )}
      {error && <Alert showIcon type="error" title={error} style={{ marginTop: 12 }} />}
      {revision !== undefined && (
        <p>
          {t('需求内容版本')} {revision}
        </p>
      )}
      {questions.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t('需要确认的信息')}
          description={
            <ul>
              {questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          }
        />
      )}
      {cases.map((c, index) => (
        <section
          key={c.key}
          style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginTop: 16 }}
        >
          <Checkbox
            checked={c.selected}
            disabled={c.saved || busy}
            onChange={(e) => update(index, { selected: e.target.checked })}
          >
            {c.saved ? t('已保存') : t('选择此用例')}
          </Checkbox>
          {c.locked && !c.saved && (
            <Alert
              type="warning"
              title={t('保存结果未确认，请重试此用例；内容暂时锁定以避免重复创建。')}
            />
          )}
          <p>
            {t('依据')}：{c.basis}
          </p>
          <label>
            {t('用例标题')}
            <Input
              disabled={c.saved || c.locked || busy}
              maxLength={200}
              value={c.title}
              onChange={(e) => update(index, { title: e.target.value })}
            />
          </label>
          <label>
            {t('前置条件')}
            <Input.TextArea
              disabled={c.saved || c.locked || busy}
              maxLength={5000}
              value={c.preconditions}
              onChange={(e) => update(index, { preconditions: e.target.value })}
            />
          </label>
          {c.steps.map((step, stepIndex) => (
            <div key={stepIndex} style={{ marginTop: 8 }}>
              <label>
                {t('操作')} {stepIndex + 1}
                <Input.TextArea
                  disabled={c.saved || c.locked || busy}
                  maxLength={2000}
                  value={step.action}
                  onChange={(e) =>
                    update(index, {
                      steps: c.steps.map((s, i) =>
                        i === stepIndex ? { ...s, action: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t('预期结果')}
                <Input.TextArea
                  disabled={c.saved || c.locked || busy}
                  maxLength={2000}
                  value={step.expected}
                  onChange={(e) =>
                    update(index, {
                      steps: c.steps.map((s, i) =>
                        i === stepIndex ? { ...s, expected: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </section>
      ))}
    </Modal>
  );
}
