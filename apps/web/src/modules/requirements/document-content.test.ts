// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontSize, Color } from '@tiptap/extension-text-style';
import { documentContentSchema } from '@myteam/contracts';
import { persistedContent } from './document-content';

describe('editor document compatibility', () => {
  it('retains selected text size and color and can reset each independently', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize, Color],
      content: '<p>字号与颜色</p>',
    });
    try {
      editor.chain().selectAll().setFontSize('24px').setColor('#dc2626').run();
      let content = persistedContent(editor.getJSON());
      expect(content.content[0]?.content?.[0]?.marks).toContainEqual({
        type: 'textStyle',
        attrs: { fontSize: '24px', color: '#dc2626' },
      });
      expect(documentContentSchema.safeParse(content).success).toBe(true);
      editor.commands.unsetColor();
      content = persistedContent(editor.getJSON());
      expect(content.content[0]?.content?.[0]?.marks).toContainEqual({
        type: 'textStyle',
        attrs: { fontSize: '24px', color: null },
      });
      editor.commands.unsetFontSize();
      expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });
  it('normalizes pasted point sizes and omits unsupported styling without losing text', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize, Color],
      content: '<p><span style="font-size:18pt;color:rgb(220, 38, 38)">粘贴正文</span></p>',
    });
    try {
      const content = persistedContent(editor.getJSON());
      expect(content.content[0]?.content?.[0]?.marks?.[0]?.attrs).toEqual({
        fontSize: '24px',
        color: 'rgb(220, 38, 38)',
      });
      expect(documentContentSchema.safeParse(content).success).toBe(true);
    } finally {
      editor.destroy();
    }
  });
  it('normalizes external link presentation attributes while retaining its text, URL and title', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content:
        '<p><a href="https://example.test" class="external-link" target="_self" rel="noreferrer" title="来源">粘贴的链接</a></p>',
    });
    try {
      const content = persistedContent(editor.getJSON());
      expect(content.content[0]?.content?.[0]).toMatchObject({
        text: '粘贴的链接',
        marks: [
          {
            type: 'link',
            attrs: {
              href: 'https://example.test',
              title: '来源',
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              class: null,
            },
          },
        ],
      });
      expect(documentContentSchema.safeParse(content).success).toBe(true);
    } finally {
      editor.destroy();
    }
  });
  it('accepts links emitted by the editor, including its default title attribute', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>需求说明</p>' });
    try {
      editor.commands.selectAll();
      editor.commands.setLink({ href: 'https://example.test/requirement' });
      const content = editor.getJSON();
      expect(content.content?.[0]?.content?.[0]?.marks?.[0]?.attrs).toMatchObject({
        href: 'https://example.test/requirement',
        title: null,
      });
      expect(documentContentSchema.safeParse(content).success).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('accepts pasted link titles and formatting on inline line breaks', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content:
        '<p><a href="https://example.test" title="原始说明">链接</a><strong>第一行<br>第二行</strong></p>',
    });
    try {
      const content = editor.getJSON();
      expect(content.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.title).toBe('原始说明');
      expect(
        content.content?.[0]?.content?.find((node) => node.type === 'hardBreak')?.marks,
      ).toEqual([{ type: 'bold' }]);
      expect(documentContentSchema.safeParse(content).success).toBe(true);
    } finally {
      editor.destroy();
    }
  });
});
