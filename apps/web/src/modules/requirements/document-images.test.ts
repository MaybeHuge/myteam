// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { documentContentSchema } from '@myteam/contracts';
import { documentImageExtensions, replaceDocumentUpload } from './document-images';
import { documentImageUrl } from './document-urls';
const projectId = 'd2bfbd68-902a-4d62-b582-abf045412941';
const requirementId = '9d118246-03fc-466d-9964-abd146900302';
const imageId = '111e6a9f-92f0-4fbe-b997-5398b291734a';
const image = {
  type: 'image',
  attrs: { attachmentId: imageId, alt: '原型', title: null, width: 600 },
};
const create = () =>
  new Editor({ extensions: [StarterKit, ...documentImageExtensions(projectId, requirementId)] });
describe('document images', () => {
  it('recognizes the authorized image URL copied from the reading view without editor metadata', () => {
    const editor = create();
    try {
      editor.commands.setContent(
        `<img src="${documentImageUrl(projectId, requirementId, imageId)}" alt="阅读图片">`,
      );
      expect(
        editor.getJSON().content?.find((node) => node.type === 'image')?.attrs?.attachmentId,
      ).toBe(imageId);
    } finally {
      editor.destroy();
    }
  });
  it('preserves an existing image when editor HTML is copied and parsed again', () => {
    const editor = create();
    try {
      editor.commands.insertContentAt(0, image);
      editor.commands.setContent(editor.getHTML());
      expect(editor.getJSON().content?.find((node) => node.type === 'image')?.attrs).toEqual(
        image.attrs,
      );
      expect(documentContentSchema.safeParse(editor.getJSON()).success).toBe(true);
    } finally {
      editor.destroy();
    }
  });
  it('does not import external, base64, or another requirement’s image URLs', () => {
    const editor = create();
    try {
      for (const source of [
        'https://example.test/x.png',
        'data:image/png;base64,AAA',
        documentImageUrl(projectId, imageId, imageId),
      ]) {
        editor.commands.setContent(
          `<p>保留文字</p><img src="${source}" data-document-image="${imageId}">`,
        );
        expect(editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false);
      }
    } finally {
      editor.destroy();
    }
  });
  it('undo and redo after upload completion restore the final image rather than a revoked blob placeholder', () => {
    const editor = create();
    try {
      editor.commands.insertContentAt(0, {
        type: 'uploadingImage',
        attrs: { localId: 'local', src: 'blob:test', filename: '原型.png' },
      });
      replaceDocumentUpload(editor, 'local', imageId, '原型.png');
      expect(editor.getJSON().content?.some((node) => node.type === 'image')).toBe(true);
      editor.commands.undo();
      expect(
        editor.getJSON().content?.some((node) => ['image', 'uploadingImage'].includes(node.type)),
      ).toBe(false);
      editor.commands.redo();
      expect(
        editor.getJSON().content?.find((node) => node.type === 'image')?.attrs?.attachmentId,
      ).toBe(imageId);
      expect(JSON.stringify(editor.getJSON())).not.toContain('blob:');
    } finally {
      editor.destroy();
    }
  });
});
