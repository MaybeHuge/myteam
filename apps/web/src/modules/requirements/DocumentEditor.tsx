import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontSize, Color } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
import {
  Alert,
  App,
  Button,
  ColorPicker,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  PictureOutlined,
  LinkOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  UndoOutlined,
  RedoOutlined,
  FontColorsOutlined,
} from '@ant-design/icons';
import {
  documentContentSchema,
  documentImageListSchema,
  documentPlainText,
  validDocumentLink,
  requirementDocumentSchema,
  type DocumentContent,
  type DocumentNode,
  type RequirementDocument,
  type SessionResponse,
} from '@myteam/contracts';
import { z } from 'zod';
import { ApiError, errorMessage, request } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { projectKey, useProjectCommand } from '../projects/api';
import { documentImageExtensions, replaceDocumentUpload } from './document-images';
import { documentImageUrl } from './document-urls';
import { persistedContent } from './document-content';
import styles from './documents.module.css';

type Upload = {
  id: string;
  file: File;
  url: string;
  key: string;
  status: 'uploading' | 'failed';
  error?: string;
  controller?: AbortController;
};
// PostgreSQL JSONB and the editor emit object keys in different orders.
function documentFingerprint(content: DocumentContent): string {
  return JSON.stringify(content, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]]),
    );
  });
}
export default function DocumentEditor({
  initial,
  session,
  onApplied,
  onReload,
}: {
  initial: RequirementDocument;
  session: SessionResponse;
  onApplied: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const locale = useLocale();
  const draft = initial.draft!;
  const requirement = initial.requirement;
  const base = `/projects/${requirement.projectId}/requirements/${requirement.id}/document`;
  const client = useQueryClient();
  const { message, modal } = App.useApp();
  const [content, setContent] = useState<DocumentContent>(draft.content);
  const [version, setVersion] = useState(draft.version);
  const versionRef = useRef(draft.version);
  const bodyRef = useRef(draft.content);
  const saved = useRef(documentFingerprint(draft.content));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showApply, setShowApply] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [showImages, setShowImages] = useState(false);
  const [imagePage, setImagePage] = useState(1);
  const imageKey = [
    ...projectKey(session.user.id, requirement.projectId),
    'document-images',
    requirement.id,
  ];
  const imageLibrary = useQuery({
    queryKey: [...imageKey, imagePage],
    enabled: showImages,
    queryFn: async ({ signal }) =>
      documentImageListSchema.parse(
        await request(`${base}/images?page=${imagePage}&pageSize=12`, { signal }),
      ),
  });
  const uploadMap = useRef(new Map<string, Upload>());
  const input = useRef<HTMLInputElement>(null);
  const enqueueRef = useRef<(files: File[], position?: number) => void>(() => {});
  const live = useRef(true);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const attempt = useRef<{
    key: string;
    content: DocumentContent;
    version: number;
    fingerprint: string;
  } | null>(null);
  const [form] = Form.useForm();
  const needsRevision = requirement.status !== 'DRAFT';
  const apply = useProjectCommand(session);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          isAllowedUri: validDocumentLink,
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
        },
      }),
      TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
      TextStyle,
      FontSize,
      Color,
      ...documentImageExtensions(requirement.projectId, requirement.id),
    ],
    [requirement.id, requirement.projectId],
  );
  const editor = useEditor({
    extensions,
    content: draft.content,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': t('文档正文'), 'aria-multiline': 'true' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        enqueueRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (moved || !files.length) return false;
        event.preventDefault();
        enqueueRef.current(
          files,
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos,
        );
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const next = persistedContent(editor.getJSON() as DocumentNode);
      bodyRef.current = next;
      setContent(next);
      setDirty(documentFingerprint(next) !== saved.current);
    },
  });
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: { role: 'textbox', 'aria-label': t('文档正文'), 'aria-multiline': 'true' },
      },
    });
  }, [editor, locale]);
  useEffect(() => {
    editor?.setEditable(!applying);
  }, [applying, editor]);
  useEffect(() => {
    live.current = true;
    const pending = uploadMap.current;
    return () => {
      live.current = false;
      pending.forEach((item) => {
        item.controller?.abort();
        URL.revokeObjectURL(item.url);
      });
    };
  }, []);
  const blocked = dirty || saving || uploads.length > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      blocked &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (blocked) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [blocked]);
  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const fingerprint = documentFingerprint(bodyRef.current);
    if (!attempt.current && saved.current === fingerprint) return Promise.resolve(true);
    if (!attempt.current)
      attempt.current = {
        key: crypto.randomUUID(),
        content: bodyRef.current,
        version: versionRef.current,
        fingerprint,
      };
    const current = attempt.current;
    const execute = async () => {
      setSaving(true);
      setError('');
      try {
        const payload = {
          version: current.version,
          content: documentContentSchema.parse(current.content),
        };
        const result = z.object({ version: z.number().int() }).parse(
          await request(`${base}/save`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': current.key },
            body: JSON.stringify(payload),
          }),
        );
        versionRef.current = result.version;
        saved.current = current.fingerprint;
        attempt.current = null;
        if (live.current) {
          setVersion(result.version);
          setDirty(documentFingerprint(bodyRef.current) !== saved.current);
          setConflict(false);
        }
        void client.invalidateQueries({
          queryKey: [
            ...projectKey(session.user.id, requirement.projectId),
            'requirement-document',
            requirement.id,
          ],
          refetchType: 'none',
        });
        return true;
      } catch (failure) {
        if (
          failure instanceof z.ZodError ||
          (failure instanceof ApiError && failure.status > 0 && failure.status < 500)
        )
          attempt.current = null;
        if (live.current) {
          setError(
            failure instanceof z.ZodError ? t('文档内容无效或超过大小限制') : errorMessage(failure),
          );
          setConflict(failure instanceof ApiError && [403, 409].includes(failure.status));
        }
        return false;
      } finally {
        if (live.current) setSaving(false);
      }
    };
    const task = execute();
    inFlight.current = task;
    void task.then(() => {
      inFlight.current = null;
    });
    return task;
  }, [base, session.csrfToken, session.user.id, client, requirement.id, requirement.projectId]);
  useEffect(() => {
    if (!dirty || error || applying) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  }, [dirty, content, version, error, applying, save]);
  const replaceUpload = useCallback(
    (localId: string, imageId?: string, filename?: string) => {
      if (editor) replaceDocumentUpload(editor, localId, imageId, filename);
    },
    [editor],
  );
  const uploadOne = useCallback(
    async (item: Upload) => {
      item.status = 'uploading';
      item.error = undefined;
      item.controller = new AbortController();
      setUploads([...uploadMap.current.values()]);
      try {
        const result = z.object({ id: z.uuid(), filename: z.string() }).parse(
          await request(`${base}/images?filename=${encodeURIComponent(item.file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-CSRF-Token': session.csrfToken,
              'Idempotency-Key': item.key,
            },
            body: item.file,
            signal: AbortSignal.any([item.controller.signal, AbortSignal.timeout(60000)]),
          }),
        );
        if (!live.current) return;
        replaceUpload(item.id, result.id, result.filename);
        void client.invalidateQueries({
          queryKey: [
            ...projectKey(session.user.id, requirement.projectId),
            'document-images',
            requirement.id,
          ],
        });
        uploadMap.current.delete(item.id);
        URL.revokeObjectURL(item.url);
        setUploads([...uploadMap.current.values()]);
      } catch (failure) {
        if (live.current) {
          item.status = 'failed';
          item.error = errorMessage(failure);
          setUploads([...uploadMap.current.values()]);
        }
      }
    },
    [
      base,
      session.csrfToken,
      session.user.id,
      requirement.projectId,
      requirement.id,
      client,
      replaceUpload,
    ],
  );
  const enqueue = useCallback(
    (files: File[], position?: number) => {
      if (!editor || applying) return;
      if (files.length + uploadMap.current.size > 100) {
        void message.error(t('最多选择 100 个附件'));
        return;
      }
      const accepted = files.filter((file) => {
        if (
          !/\.(png|jpe?g|webp)$/i.test(file.name) ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
        ) {
          void message.error(t('请选择 PNG、JPG 或 WebP 图片'));
          return false;
        }
        if (!file.size || file.size > 20 * 1024 * 1024) {
          void message.error(t('图片大小须在 1 字节至 20 MiB 之间'));
          return false;
        }
        return true;
      });
      if (position !== undefined) editor.commands.setTextSelection(position);
      for (const file of accepted) {
        const item: Upload = {
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          key: crypto.randomUUID(),
          status: 'uploading',
        };
        uploadMap.current.set(item.id, item);
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.selection.to, {
            type: 'uploadingImage',
            attrs: { localId: item.id, src: item.url, filename: file.name },
          })
          .run();
        void uploadOne(item);
      }
    },
    [editor, applying, message, uploadOne],
  );
  useEffect(() => {
    enqueueRef.current = enqueue;
  }, [enqueue]);
  const applyNow = async (values: { reason?: string; impact?: string }) => {
    if (uploadMap.current.size) return;
    setApplying(true);
    try {
      // A timed-out save is retried with its original key before the latest local content is sent.
      for (
        let i = 0;
        i < 3 && (attempt.current || saved.current !== documentFingerprint(bodyRef.current));
        i++
      )
        if (!(await save())) return;
      if (saved.current !== documentFingerprint(bodyRef.current)) return;
      await apply.mutateAsync({
        path: `${base}/apply`,
        input: { version: versionRef.current, requirementVersion: requirement.version, ...values },
      });
      setShowApply(false);
      await onApplied();
    } catch (failure) {
      setError(errorMessage(failure));
      setConflict(failure instanceof ApiError && [403, 409].includes(failure.status));
    } finally {
      if (live.current) setApplying(false);
    }
  };
  const reload = () =>
    modal.confirm({
      title: t('加载最新草稿？'),
      content: t('将放弃当前未保存内容；若需求已修订，将从当前文档重新开始。'),
      okText: t('加载最新草稿'),
      cancelText: t('取消'),
      onOk: async () => {
        const latest = requirementDocumentSchema.parse(await request(base));
        if (!latest.canEdit || !latest.draft) throw new Error(t('当前需求文档仅可查看'));
        if (latest.draft.baseRevision !== latest.requirement.revision)
          await request(`${base}/reset`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({ version: latest.draft.version }),
          });
        await onReload();
      },
    });
  const reset = () =>
    modal.confirm({
      title: t('放弃未应用修改？'),
      content: t('工作草稿将恢复为当前文档；尚无文档时恢复为空白。历史版本不变。'),
      okText: t('放弃修改'),
      cancelText: t('取消'),
      onOk: async () => {
        await request(`${base}/reset`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ version: versionRef.current }),
        });
        saved.current = documentFingerprint(bodyRef.current);
        attempt.current = null;
        setDirty(false);
        await onApplied();
      },
    });
  if (!editor) return null;
  const tool = (label: string, action: () => void, icon?: ReactNode, active = false) => (
    <Tooltip key={label} title={label}>
      <Button
        aria-label={label}
        type={active ? 'primary' : 'default'}
        size="small"
        icon={icon}
        disabled={applying}
        onMouseDown={(e) => e.preventDefault()}
        onClick={action}
      >
        {icon ? undefined : label}
      </Button>
    </Tooltip>
  );
  return (
    <>
      <div className={styles.status}>
        <Space wrap>
          <Tag color={error ? 'error' : dirty || saving ? 'processing' : 'success'} role="status">
            {error
              ? t('保存失败，编辑内容仍保留在本页')
              : saving
                ? t('保存中…')
                : dirty
                  ? t('等待自动保存')
                  : t('草稿已保存')}
          </Tag>
          <small>{t('正文 {{0}} 字', { 0: documentPlainText(content).length })}</small>
        </Space>
        <Space wrap>
          <Button
            onClick={() => void reset()}
            disabled={saving || applying || uploads.length > 0 || conflict}
          >
            {t('放弃未应用修改')}
          </Button>
          <Button onClick={() => void reload()} disabled={saving || applying || uploads.length > 0}>
            {t('加载最新草稿')}
          </Button>
          <Button disabled={applying || conflict} loading={saving} onClick={() => void save()}>
            {t('保存草稿')}
          </Button>
          <Button
            type="primary"
            disabled={uploads.length > 0 || conflict}
            loading={applying}
            onClick={() => {
              form.resetFields();
              setShowApply(true);
            }}
          >
            {needsRevision ? t('提交文档修订') : t('应用到需求')}
          </Button>
        </Space>
      </div>
      <Alert
        type="info"
        showIcon
        title={t('自动保存只更新文档草稿，不改变需求基线。应用后再按需求流程提交评审。')}
      />
      {error && (
        <Alert
          type="error"
          showIcon
          title={t(error)}
          description={
            conflict ? t('当前编辑内容已保留。可在新标签页查看最新草稿，核对后再加载。') : undefined
          }
          action={
            conflict ? (
              <a href={`${location.pathname}?edit=1`} target="_blank" rel="noopener noreferrer">
                {t('查看最新草稿')}
              </a>
            ) : (
              <Button onClick={() => void save()}>{t('重试保存')}</Button>
            )
          }
        />
      )}
      <div className={styles.toolbar} role="toolbar" aria-label={t('文档格式工具')}>
        <Select
          aria-label={t('字体大小')}
          size="small"
          style={{ width: 106 }}
          disabled={applying}
          value={editor.getAttributes('textStyle').fontSize || ''}
          options={[
            { value: '', label: t('默认字号') },
            ...[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96].map((size) => ({
              value: `${size}px`,
              label: `${size}px`,
            })),
          ]}
          onChange={(size) =>
            size
              ? editor.chain().focus().setFontSize(size).run()
              : editor.chain().focus().unsetFontSize().run()
          }
        />
        <ColorPicker
          size="small"
          disabledAlpha
          disabled={applying}
          format="hex"
          value={editor.getAttributes('textStyle').color || '#304538'}
          onChange={(color) => editor.chain().focus().setColor(color.toHexString()).run()}
          presets={[
            {
              label: t('常用颜色'),
              colors: [
                '#304538',
                '#000000',
                '#dc2626',
                '#ea580c',
                '#ca8a04',
                '#16a34a',
                '#2563eb',
                '#9333ea',
              ],
            },
          ]}
        >
          <Button
            size="small"
            aria-label={t('文字颜色')}
            disabled={applying}
            icon={
              <FontColorsOutlined
                style={{ color: editor.getAttributes('textStyle').color || '#304538' }}
              />
            }
          />
        </ColorPicker>
        {tool(t('恢复默认颜色'), () => editor.chain().focus().unsetColor().run())}
        <Select
          aria-label={t('段落样式')}
          size="small"
          value={
            editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph'
          }
          style={{ width: 112 }}
          onChange={(value) =>
            value === 'paragraph'
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(value) as 1 | 2 | 3 })
                  .run()
          }
          options={[
            { value: 'paragraph', label: t('正文') },
            { value: '1', label: t('一级标题') },
            { value: '2', label: t('二级标题') },
            { value: '3', label: t('三级标题') },
          ]}
          disabled={applying}
        />
        {tool(
          t('加粗'),
          () => editor.chain().focus().toggleBold().run(),
          <BoldOutlined />,
          editor.isActive('bold'),
        )}
        {tool(
          t('斜体'),
          () => editor.chain().focus().toggleItalic().run(),
          <ItalicOutlined />,
          editor.isActive('italic'),
        )}
        {tool(
          t('无序列表'),
          () => editor.chain().focus().toggleBulletList().run(),
          <UnorderedListOutlined />,
          editor.isActive('bulletList'),
        )}
        {tool(
          t('有序列表'),
          () => editor.chain().focus().toggleOrderedList().run(),
          <OrderedListOutlined />,
          editor.isActive('orderedList'),
        )}
        {tool(
          t('插入链接'),
          () => setLink(String(editor.getAttributes('link').href ?? '')),
          <LinkOutlined />,
        )}
        {tool(t('插入表格'), () =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        )}
        {editor.isActive('table') && (
          <>
            {tool(t('增加行'), () => editor.chain().focus().addRowAfter().run())}
            {tool(t('增加列'), () => editor.chain().focus().addColumnAfter().run())}
            {tool(t('删除表格'), () => editor.chain().focus().deleteTable().run())}
          </>
        )}
        {tool(t('插入图片'), () => input.current?.click(), <PictureOutlined />)}
        {tool(t('已上传图片'), () => {
          setImagePage(1);
          setShowImages(true);
        })}
        {editor.isActive('image') && (
          <>
            {tool(t('图片说明'), () => setCaption(String(editor.getAttributes('image').alt ?? '')))}
            <Select
              aria-label={t('图片宽度')}
              size="small"
              value={editor.getAttributes('image').width ?? 0}
              onChange={(width) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes('image', { width: width || null })
                  .run()
              }
              options={[
                { value: 0, label: t('自适应宽度') },
                { value: 300, label: '300px' },
                { value: 600, label: '600px' },
                { value: 1000, label: '1000px' },
              ]}
            />
            {tool(t('移除图片'), () => editor.chain().focus().deleteSelection().run())}
          </>
        )}
        {tool(t('撤销'), () => editor.chain().focus().undo().run(), <UndoOutlined />)}
        {tool(t('重做'), () => editor.chain().focus().redo().run(), <RedoOutlined />)}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        aria-label={t('选择文档图片')}
        onChange={(event) => {
          enqueue(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      {!!uploads.length && (
        <div className={styles.uploads}>
          {uploads.map((item) => (
            <div key={item.id} className={styles.upload}>
              <img src={item.url} alt={item.file.name} />
              <small>{item.file.name}</small>
              <Tag color={item.status === 'failed' ? 'red' : 'blue'}>
                {item.status === 'failed' ? t('上传失败') : t('图片上传中…')}
              </Tag>
              {item.error && <small>{t(item.error)}</small>}
              <Space>
                {item.status === 'failed' && (
                  <Button size="small" onClick={() => void uploadOne(item)}>
                    {t('重试上传')}
                  </Button>
                )}
                <Button
                  size="small"
                  onClick={() => {
                    item.controller?.abort();
                    replaceUpload(item.id);
                    uploadMap.current.delete(item.id);
                    URL.revokeObjectURL(item.url);
                    setUploads([...uploadMap.current.values()]);
                  }}
                >
                  {t('移除')}
                </Button>
              </Space>
            </div>
          ))}
        </div>
      )}
      <div className={styles.body}>
        <EditorContent editor={editor} />
      </div>
      <Modal
        open={showImages}
        title={t('已上传图片')}
        footer={null}
        onCancel={() => setShowImages(false)}
        width={720}
      >
        <p>{t('选择图片插入光标位置；已上传但未保留在正文的图片也可从这里找回。')}</p>
        {imageLibrary.isPending ? (
          <Skeleton active />
        ) : imageLibrary.isError ? (
          <Alert
            type="error"
            title={errorMessage(imageLibrary.error)}
            action={<Button onClick={() => void imageLibrary.refetch()}>{t('重试')}</Button>}
          />
        ) : imageLibrary.data.items.length ? (
          <>
            <div className={styles.imageLibrary}>
              {imageLibrary.data.items.map((image) => (
                <div className={styles.libraryImage} key={image.id}>
                  <img
                    src={documentImageUrl(requirement.projectId, requirement.id, image.id)}
                    alt={image.filename}
                  />
                  <small>{image.filename}</small>
                  <Button
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .insertContentAt(editor.state.selection.to, {
                          type: 'image',
                          attrs: {
                            attachmentId: image.id,
                            alt: image.filename,
                            title: null,
                            width: null,
                          },
                        })
                        .run();
                      setShowImages(false);
                    }}
                  >
                    {t('插入此图片')}
                  </Button>
                </div>
              ))}
            </div>
            <Pagination
              current={imagePage}
              pageSize={12}
              total={imageLibrary.data.total}
              hideOnSinglePage
              showSizeChanger={false}
              onChange={setImagePage}
            />
          </>
        ) : (
          <Empty description={t('暂无已上传图片')} />
        )}
      </Modal>
      <Modal
        open={showApply}
        title={needsRevision ? t('提交文档修订') : t('应用到需求')}
        confirmLoading={applying}
        okText={t('确认应用')}
        cancelText={t('取消')}
        onCancel={() => {
          if (!applying) setShowApply(false);
        }}
        onOk={() => form.submit()}
      >
        <p>
          {needsRevision
            ? t('将创建需求新修订，重新评审，并使相关旧测试依据失效。')
            : t('将生成固定文档版本，供需求评审使用。')}
        </p>
        <Form form={form} layout="vertical" onFinish={(values) => void applyNow(values)}>
          {needsRevision && (
            <>
              <Form.Item
                name="reason"
                label={t('修订原因')}
                rules={[{ required: true, whitespace: true }]}
              >
                <Input.TextArea maxLength={500} />
              </Form.Item>
              <Form.Item
                name="impact"
                label={t('影响范围与处理安排')}
                rules={[{ required: true, whitespace: true }]}
              >
                <Input.TextArea maxLength={2000} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      <Modal
        open={link !== null}
        title={t('插入链接')}
        okText={t('确认')}
        cancelText={t('取消')}
        onCancel={() => setLink(null)}
        onOk={() => {
          if (link && !validDocumentLink(link)) {
            void message.error(t('仅支持 HTTP/HTTPS 链接'));
            return;
          }
          if (link) editor.chain().focus().extendMarkRange('link').setLink({ href: link }).run();
          else editor.chain().focus().unsetLink().run();
          setLink(null);
        }}
      >
        <Input
          aria-label={t('链接地址')}
          value={link ?? ''}
          onChange={(event) => setLink(event.target.value)}
          maxLength={2000}
        />
      </Modal>
      <Modal
        open={caption !== null}
        title={t('图片说明')}
        okText={t('确认')}
        cancelText={t('取消')}
        onCancel={() => setCaption(null)}
        onOk={() => {
          editor
            .chain()
            .focus()
            .updateAttributes('image', { alt: caption ?? '', title: caption || null })
            .run();
          setCaption(null);
        }}
      >
        <Input
          aria-label={t('图片说明')}
          value={caption ?? ''}
          maxLength={500}
          onChange={(event) => setCaption(event.target.value)}
        />
      </Modal>
      <Modal
        open={blocker.state === 'blocked'}
        title={t('仍有未保存的文档内容')}
        okText={t('放弃并离开')}
        cancelText={t('继续编辑')}
        onOk={() => blocker.state === 'blocked' && blocker.proceed()}
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
      >
        <p>{t('尚未保存的文字或上传中的图片可能丢失。')}</p>
      </Modal>
    </>
  );
}
