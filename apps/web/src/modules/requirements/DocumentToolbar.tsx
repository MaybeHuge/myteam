import { useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { App, Button, ColorPicker, Input, Modal, Select, Tooltip } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  StrikethroughOutlined,
  CodeOutlined,
  DashOutlined,
  PictureOutlined,
  LinkOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  UndoOutlined,
  RedoOutlined,
  FontColorsOutlined,
} from '@ant-design/icons';
import { validDocumentLink } from '@myteam/contracts';
import { t, useLocale } from '../../i18n';
import styles from './documents.module.css';
export function DocumentToolbar({
  editor,
  applying,
  onImage,
  onShowImages,
}: {
  editor: Editor;
  applying: boolean;
  onImage: () => void;
  onShowImages: () => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [link, setLink] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const tool = (
    label: string,
    action: () => void,
    icon?: ReactNode,
    active?: boolean,
    enabled = true,
  ) => (
    <Tooltip key={label} title={label}>
      <Button
        aria-label={label}
        type={active ? 'primary' : 'default'}
        size="small"
        icon={icon}
        disabled={applying || !enabled}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={action}
      >
        {icon ? undefined : label}
      </Button>
    </Tooltip>
  );
  return (
    <>
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
          t('下划线'),
          () => editor.chain().focus().toggleUnderline().run(),
          <UnderlineOutlined />,
          editor.isActive('underline'),
        )}
        {tool(
          t('删除线'),
          () => editor.chain().focus().toggleStrike().run(),
          <StrikethroughOutlined />,
          editor.isActive('strike'),
        )}
        {tool(
          t('行内代码'),
          () => editor.chain().focus().toggleCode().run(),
          <CodeOutlined />,
          editor.isActive('code'),
        )}
        {tool(t('清除文字格式'), () => editor.chain().focus().unsetAllMarks().run())}
        {tool(
          t('引用'),
          () => editor.chain().focus().toggleBlockquote().run(),
          undefined,
          editor.isActive('blockquote'),
        )}
        {tool(
          t('代码块'),
          () => editor.chain().focus().toggleCodeBlock().run(),
          undefined,
          editor.isActive('codeBlock'),
        )}
        {tool(
          t('分隔线'),
          () => editor.chain().focus().setHorizontalRule().run(),
          <DashOutlined />,
          undefined,
          editor.can().setHorizontalRule(),
        )}
        {tool(
          t('插入换行'),
          () => editor.chain().focus().setHardBreak().run(),
          undefined,
          undefined,
          editor.can().setHardBreak(),
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
          t('增加列表缩进'),
          () => editor.chain().focus().sinkListItem('listItem').run(),
          undefined,
          undefined,
          editor.can().sinkListItem('listItem'),
        )}
        {tool(
          t('减少列表缩进'),
          () => editor.chain().focus().liftListItem('listItem').run(),
          undefined,
          undefined,
          editor.can().liftListItem('listItem'),
        )}
        {tool(
          t('插入链接'),
          () => setLink(String(editor.getAttributes('link').href ?? '')),
          <LinkOutlined />,
        )}
        {tool(
          t('移除链接'),
          () => editor.chain().focus().extendMarkRange('link').unsetLink().run(),
          undefined,
          undefined,
          editor.isActive('link'),
        )}
        {tool(
          t('插入表格'),
          () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          undefined,
          undefined,
          editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
        )}
        {tool(
          t('在上方增加行'),
          () => editor.chain().focus().addRowBefore().run(),
          undefined,
          undefined,
          editor.can().addRowBefore(),
        )}
        {tool(
          t('增加行'),
          () => editor.chain().focus().addRowAfter().run(),
          undefined,
          undefined,
          editor.can().addRowAfter(),
        )}
        {tool(
          t('删除行'),
          () => editor.chain().focus().deleteRow().run(),
          undefined,
          undefined,
          editor.can().deleteRow(),
        )}
        {tool(
          t('在左侧增加列'),
          () => editor.chain().focus().addColumnBefore().run(),
          undefined,
          undefined,
          editor.can().addColumnBefore(),
        )}
        {tool(
          t('增加列'),
          () => editor.chain().focus().addColumnAfter().run(),
          undefined,
          undefined,
          editor.can().addColumnAfter(),
        )}
        {tool(
          t('删除列'),
          () => editor.chain().focus().deleteColumn().run(),
          undefined,
          undefined,
          editor.can().deleteColumn(),
        )}
        {tool(
          t('合并单元格'),
          () => editor.chain().focus().mergeCells().run(),
          undefined,
          undefined,
          editor.can().mergeCells(),
        )}
        {tool(
          t('拆分单元格'),
          () => editor.chain().focus().splitCell().run(),
          undefined,
          undefined,
          editor.can().splitCell(),
        )}
        {tool(
          t('切换表头行'),
          () => editor.chain().focus().toggleHeaderRow().run(),
          undefined,
          undefined,
          editor.can().toggleHeaderRow(),
        )}
        {tool(
          t('切换表头列'),
          () => editor.chain().focus().toggleHeaderColumn().run(),
          undefined,
          undefined,
          editor.can().toggleHeaderColumn(),
        )}
        {tool(
          t('切换表头单元格'),
          () => editor.chain().focus().toggleHeaderCell().run(),
          undefined,
          undefined,
          editor.can().toggleHeaderCell(),
        )}
        {tool(
          t('删除表格'),
          () => editor.chain().focus().deleteTable().run(),
          undefined,
          undefined,
          editor.can().deleteTable(),
        )}
        {tool(t('插入图片'), onImage, <PictureOutlined />)}
        {tool(t('已上传图片'), () => {
          onShowImages();
        })}
        {tool(
          t('图片说明'),
          () => setCaption(String(editor.getAttributes('image').alt ?? '')),
          undefined,
          undefined,
          editor.isActive('image'),
        )}
        <Select
          aria-label={t('图片宽度')}
          size="small"
          disabled={applying || !editor.isActive('image')}
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
        {tool(
          t('移除图片'),
          () => editor.chain().focus().deleteSelection().run(),
          undefined,
          undefined,
          editor.isActive('image'),
        )}
        {tool(
          t('撤销'),
          () => editor.chain().focus().undo().run(),
          <UndoOutlined />,
          undefined,
          editor.can().undo(),
        )}
        {tool(
          t('重做'),
          () => editor.chain().focus().redo().run(),
          <RedoOutlined />,
          undefined,
          editor.can().redo(),
        )}
      </div>
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
    </>
  );
}
