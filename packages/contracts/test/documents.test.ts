import { describe, expect, it } from 'vitest';
import {
  documentContentSchema,
  documentImageIds,
  documentPlainText,
  emptyDocument,
  validDocumentLink,
  type DocumentContent,
} from '../src/documents/index.js';
const imageId = '30d7dc51-2d5d-45cf-acf6-a4745916cd20';
const text = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
describe('requirement documents', () => {
  it('allows bounded font sizes and safe text colors, rejecting arbitrary CSS attributes', () => {
    const doc = (attrs: Record<string, unknown>) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '样式', marks: [{ type: 'textStyle', attrs }] }],
        },
      ],
    });
    for (const attrs of [
      { fontSize: '24px', color: '#dc2626' },
      { fontSize: null, color: 'rgb(220, 38, 38)' },
      { fontSize: '8px', color: 'blue' },
      { fontSize: '96px', color: null },
    ])
      expect(documentContentSchema.safeParse(doc(attrs)).success).toBe(true);
    for (const attrs of [
      { fontSize: '1000px' },
      { fontSize: '0px' },
      { fontSize: '16px;position:fixed' },
      { color: 'url(https://example.test)' },
      { color: 'red;position:fixed' },
      { color: 'rgb(999,0,0)' },
      { color: '#ff0000', backgroundImage: 'url(x)' },
    ])
      expect(documentContentSchema.safeParse(doc(attrs)).success).toBe(false);
  });
  it('accepts structured text, formatting, tables and stable image identities', () => {
    const doc: DocumentContent = {
      type: 'doc',
      content: [
        text('背景'),
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                  content: [text('规则')],
                },
              ],
            },
          ],
        },
        { type: 'image', attrs: { attachmentId: imageId, alt: '中文说明', width: 600 } },
        { type: 'image', attrs: { attachmentId: imageId } },
      ],
    };
    expect(documentContentSchema.parse(doc)).toEqual(doc);
    expect(documentImageIds(doc)).toEqual([imageId]);
    expect(documentPlainText(doc)).toContain('规则');
    expect(documentContentSchema.safeParse(emptyDocument()).success).toBe(true);
  });
  it('rejects scripts, remote/base64 image sources, foreign attributes, and unsafe links', () => {
    for (const node of [
      { type: 'script' },
      { type: 'image', attrs: { src: 'data:image/png;base64,AAA' } },
      { type: 'image', attrs: { attachmentId: imageId, src: 'https://example.test/x.png' } },
      { type: 'paragraph', attrs: { onclick: 'bad()' } },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'click',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      },
    ]) {
      expect(documentContentSchema.safeParse({ type: 'doc', content: [node] }).success).toBe(false);
    }
    expect(validDocumentLink('https://example.test/path')).toBe(true);
    expect(validDocumentLink('//example.test/path')).toBe(false);
    expect(validDocumentLink('file:///tmp/secret')).toBe(false);
  });
  it('rejects local upload placeholders and limits document complexity before recursive rendering', () => {
    expect(
      documentContentSchema.safeParse({
        type: 'doc',
        content: [{ type: 'uploadingImage', attrs: { localId: 'local' } }],
      }).success,
    ).toBe(false);
    let doc: unknown = text('deep');
    for (let i = 0; i < 100; i++) doc = { type: 'blockquote', content: [doc] };
    expect(documentContentSchema.safeParse({ type: 'doc', content: [doc] }).success).toBe(false);
    expect(
      documentContentSchema.safeParse({ type: 'doc', content: [text('x'.repeat(200001))] }).success,
    ).toBe(false);
  });

  it('validates link attributes on text and line breaks without allowing marks on blocks', () => {
    for (const type of ['text', 'hardBreak']) {
      const node = { type, ...(type === 'text' ? { text: '链接' } : {}) };
      const doc = (attrs: Record<string, unknown>) => ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ ...node, marks: [{ type: 'link', attrs }] }] }],
      });
      for (const title of [undefined, null, '', '来源说明', 'x'.repeat(500)]) {
        expect(
          documentContentSchema.safeParse(doc({ href: 'https://example.test', title })).success,
        ).toBe(true);
      }
      for (const attrs of [
        { href: 'javascript:alert(1)', title: '说明' },
        { href: 'data:text/html,bad', title: null },
        { href: 'https://example.test', title: 1 },
        { href: 'https://example.test', title: 'x'.repeat(501) },
        { href: 'https://example.test', title: null, onclick: 'bad()' },
      ])
        expect(documentContentSchema.safeParse(doc(attrs)).success).toBe(false);
    }
    expect(
      documentContentSchema.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', marks: [{ type: 'bold' }] }],
      }).success,
    ).toBe(false);
  });
});
