import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontSize, Color } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
import { Alert, App, Button, Empty, Input, Modal, Pagination, Skeleton, Space, Tag } from 'antd';
import { z } from 'zod';
import {
  documentContentSchema,
  projectDocumentSchema,
  documentImageListSchema,
  validDocumentLink,
  type DocumentContent,
  type DocumentNode,
  type SessionResponse,
} from '@myteam/contracts';
import { request, errorMessage } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { randomUUID } from '../../shared/random-uuid';
import { projectKey, useProjectCommand } from '../projects/api';
import {
  documentImageExtensionsForUrl,
  replaceDocumentUpload,
} from '../requirements/document-images';
import { persistedContent } from '../requirements/document-content';
import { DocumentToolbar } from '../requirements/DocumentToolbar';
import { DocumentView } from '../requirements/DocumentView';
import styles from '../requirements/documents.module.css';

type Doc = {
  id: string;
  title: string;
  content: DocumentContent;
  version: number;
  canEdit: boolean;
  updatedByName: string;
  updatedAt: string;
};
type Upload = {
  id: string;
  file: File;
  url: string;
  key: string;
  status: 'uploading' | 'failed';
  error?: string;
  controller?: AbortController;
};
export function ProjectDocumentPage({ session }: { session: SessionResponse }) {
  useLocale();
  const { projectId = '', documentId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Doc | null>(null);
  const base = `/projects/${projectId}/documents/${documentId}`;
  const detail = useQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'project-document', documentId],
    queryFn: async ({ signal }) => {
      return projectDocumentSchema.parse(await request(base, { signal }));
    },
  });
  useEffect(() => {
    if (params.get('edit') === '1' && detail.data?.canEdit) {
      setEditing(detail.data);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('edit');
          return next;
        },
        { replace: true },
      );
    }
  }, [params, setParams, detail.data]);
  const imageUrl = (id: string) => `/api/v1${base}/images/${id}/preview`;
  return (
    <div className={styles.page}>
      <Link to={`/projects/${projectId}?tab=documents`}>{t('返回项目文档')}</Link>
      <div className={styles.header}>
        <div>
          <h1>{detail.data?.title ?? t('项目文档')}</h1>
          <small>{t('项目文档')}</small>
        </div>
        {detail.data?.canEdit && !editing && (
          <Button onClick={() => setEditing(detail.data!)}>{t('编辑文档')}</Button>
        )}
      </div>
      {detail.isError && (
        <Alert
          type="error"
          title={errorMessage(detail.error)}
          action={<Button onClick={() => void detail.refetch()}>{t('重试')}</Button>}
        />
      )}
      <div className={styles.sheet}>
        {detail.isPending ? (
          <Skeleton active />
        ) : detail.data ? (
          editing ? (
            <ProjectDocumentEditor
              key={`${documentId}:${editing.version}`}
              initial={editing}
              base={base}
              session={session}
              onSaved={async () => {
                await detail.refetch();
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <DocumentView content={detail.data.content} imageUrl={imageUrl} />
          )
        ) : null}
      </div>
    </div>
  );
}
function ProjectDocumentEditor({
  initial,
  base,
  session,
  onSaved,
  onCancel,
}: {
  initial: Doc;
  base: string;
  session: SessionResponse;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const { message, modal } = App.useApp();
  const [title, setTitle] = useState(initial.title),
    [content, setContent] = useState(initial.content);
  const [uploads, setUploads] = useState<Upload[]>([]),
    [showImages, setShowImages] = useState(false),
    [imagePage, setImagePage] = useState(1);
  const input = useRef<HTMLInputElement>(null),
    pending = useRef(new Map<string, Upload>()),
    live = useRef(true),
    enqueueRef = useRef<(files: File[], pos?: number) => void>(() => {});
  const dirty =
    title !== initial.title ||
    JSON.stringify(content) !== JSON.stringify(initial.content) ||
    uploads.length > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  const save = useProjectCommand(session);
  const imageUrl = useCallback((id: string) => `/api/v1${base}/images/${id}/preview`, [base]);
  const images = useQuery({
    queryKey: ['project-document-images', session.user.id, base, imagePage],
    enabled: showImages,
    queryFn: async ({ signal }) =>
      documentImageListSchema.parse(
        await request(`${base}/images?page=${imagePage}&pageSize=12`, { signal }),
      ),
  });
  const { refetch: refetchImages } = images;
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
      ...documentImageExtensionsForUrl(imageUrl),
    ],
    [imageUrl],
  );
  const editor = useEditor({
    extensions,
    content: initial.content,
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
    onUpdate: ({ editor }) => setContent(persistedContent(editor.getJSON() as DocumentNode)),
  });
  useEffect(() => {
    live.current = true;
    const entries = pending.current;
    return () => {
      live.current = false;
      entries.forEach((item) => {
        item.controller?.abort();
        URL.revokeObjectURL(item.url);
      });
    };
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  useEffect(() => {
    editor?.setEditable(!save.isPending);
  }, [editor, save.isPending]);
  const refresh = () => setUploads([...pending.current.values()]);
  const uploadOne = useCallback(
    async (item: Upload) => {
      item.status = 'uploading';
      item.error = undefined;
      item.controller = new AbortController();
      setUploads([...pending.current.values()]);
      try {
        const response = z.object({ id: z.uuid(), filename: z.string() }).parse(
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
        if (!live.current || !pending.current.has(item.id)) return;
        if (editor) replaceDocumentUpload(editor, item.id, response.id, response.filename);
        pending.current.delete(item.id);
        URL.revokeObjectURL(item.url);
        setUploads([...pending.current.values()]);
        void refetchImages();
      } catch (error) {
        if (live.current && pending.current.has(item.id)) {
          item.status = 'failed';
          item.error = errorMessage(error);
          setUploads([...pending.current.values()]);
        }
      }
    },
    [base, editor, session.csrfToken, refetchImages],
  );
  const enqueue = useCallback(
    (files: File[], position?: number) => {
      if (!editor) return;
      if (files.length + pending.current.size > 100) {
        void message.error(t('最多选择 100 个附件'));
        return;
      }
      if (position !== undefined) editor.commands.setTextSelection(position);
      for (const file of files) {
        if (
          !/\.(png|jpe?g|webp)$/i.test(file.name) ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
        ) {
          void message.error(t('请选择 PNG、JPG 或 WebP 图片'));
          continue;
        }
        if (!file.size || file.size > 20 * 1024 * 1024) {
          void message.error(t('图片大小须在 1 字节至 20 MiB 之间'));
          continue;
        }
        const item: Upload = {
          id: randomUUID(),
          key: randomUUID(),
          file,
          url: URL.createObjectURL(file),
          status: 'uploading',
        };
        pending.current.set(item.id, item);
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
    [editor, message, uploadOne],
  );
  useEffect(() => {
    enqueueRef.current = enqueue;
  }, [enqueue]);
  const submit = async () => {
    if (!title.trim()) {
      void message.error(t('请输入文档标题'));
      return;
    }
    try {
      await save.mutateAsync({
        path: `${base}/save`,
        input: { title, version: initial.version, content: documentContentSchema.parse(content) },
      });
      await onSaved();
    } catch (error) {
      void message.error(errorMessage(error));
    }
  };
  if (!editor) return <Skeleton active />;
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          aria-label={t('文档标题')}
          maxLength={200}
          disabled={save.isPending}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="primary"
          disabled={!!uploads.length}
          loading={save.isPending}
          onClick={() => void submit()}
        >
          {t('保存文档')}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            if (!dirty) onCancel();
            else
              modal.confirm({
                title: t('仍有未保存的文档内容'),
                content: t('尚未保存的文字或上传中的图片可能丢失。'),
                okText: t('放弃并离开'),
                cancelText: t('继续编辑'),
                onOk: onCancel,
              });
          }}
        >
          {t('取消')}
        </Button>
      </Space>
      <DocumentToolbar
        editor={editor}
        applying={save.isPending}
        onImage={() => input.current?.click()}
        onShowImages={() => {
          setImagePage(1);
          setShowImages(true);
        }}
      />
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
              {item.error && <small>{item.error}</small>}
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
                    replaceDocumentUpload(editor, item.id);
                    pending.current.delete(item.id);
                    URL.revokeObjectURL(item.url);
                    refresh();
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
        {images.isPending ? (
          <Skeleton active />
        ) : images.isError ? (
          <Alert
            type="error"
            title={errorMessage(images.error)}
            action={<Button onClick={() => void images.refetch()}>{t('重试')}</Button>}
          />
        ) : images.data.items.length ? (
          <>
            <div className={styles.imageLibrary}>
              {images.data.items.map((image) => (
                <div className={styles.libraryImage} key={image.id}>
                  <img src={imageUrl(image.id)} alt={image.filename} />
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
              total={images.data.total}
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
