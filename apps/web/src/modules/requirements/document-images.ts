import ImageExtension from '@tiptap/extension-image';
import type { Editor } from '@tiptap/react';
import { z } from 'zod';
import { documentImageUrl } from './document-urls';

function ownedImageId(
  element: HTMLElement,
  projectId: string,
  requirementId: string,
): string | null {
  try {
    const source = new URL(element.getAttribute('src') ?? '', window.location.origin);
    const id = source.pathname.split('/').at(-2);
    if (!z.uuid().safeParse(id).success) return null;
    const marker = element.getAttribute('data-document-image');
    if (marker && marker !== id) return null;
    return source.href ===
      new URL(documentImageUrl(projectId, requirementId, id!), window.location.origin).href
      ? id!
      : null;
  } catch {
    return null;
  }
}
export function documentImageExtensions(projectId: string, requirementId: string) {
  return [
    ImageExtension.extend({
      addAttributes() {
        return {
          attachmentId: {
            default: null,
            parseHTML: (element) => ownedImageId(element, projectId, requirementId),
          },
          alt: { default: '' },
          title: { default: null },
          width: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.getAttribute('width'));
              return Number.isInteger(value) && value >= 80 && value <= 1600 ? value : null;
            },
          },
        };
      },
      parseHTML() {
        return [
          {
            tag: 'img[src]',
            getAttrs: (element) => (ownedImageId(element, projectId, requirementId) ? {} : false),
          },
        ];
      },
      addInputRules() {
        return [];
      },
      renderHTML({ node }) {
        return [
          'img',
          {
            src: documentImageUrl(projectId, requirementId, String(node.attrs.attachmentId)),
            alt: node.attrs.alt,
            title: node.attrs.title,
            width: node.attrs.width,
            'data-document-image': node.attrs.attachmentId,
          },
        ];
      },
    }),
    ImageExtension.extend({
      name: 'uploadingImage',
      draggable: false,
      addAttributes() {
        return { localId: { default: null }, src: { default: null }, filename: { default: '' } };
      },
      parseHTML() {
        return [];
      },
      addInputRules() {
        return [];
      },
      renderHTML({ node }) {
        return [
          'figure',
          { 'data-upload-placeholder': node.attrs.localId, contenteditable: 'false' },
          ['img', { src: node.attrs.src, alt: node.attrs.filename }],
          ['figcaption', {}, node.attrs.filename],
        ];
      },
    }),
  ];
}

export function replaceDocumentUpload(
  editor: Editor,
  localId: string,
  imageId?: string,
  filename?: string,
) {
  if (editor.isDestroyed) return;
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'uploadingImage' && node.attrs.localId === localId) position = pos;
  });
  if (position === undefined) return;
  // Upload completion changes the same atom without recording a temporary blob in undo history.
  const transaction = imageId
    ? editor.state.tr.setNodeMarkup(position, editor.schema.nodes.image, {
        attachmentId: imageId,
        alt: filename ?? '',
        title: null,
        width: null,
      })
    : editor.state.tr.delete(position, position + 1);
  editor.view.dispatch(transaction.setMeta('addToHistory', false));
}
