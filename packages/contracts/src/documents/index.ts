import { z } from 'zod';

export type DocumentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocumentNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};
export type DocumentContent = DocumentNode & { type: 'doc'; content: DocumentNode[] };
const uuid = z.uuid();
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
export function validDocumentFontSize(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{1,2}(?:\.\d{1,2})?px$/.test(value)) return false;
  const size = Number.parseFloat(value);
  return size >= 8 && size <= 96;
}
export function validDocumentTextColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  if (
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
    /^[a-z]{1,20}$/i.test(value)
  )
    return true;
  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i.exec(
      value,
    );
  return !!rgb && rgb.slice(1, 4).every((channel) => Number(channel) <= 255);
}
export function validDocumentLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}
const inline = ['text', 'hardBreak'];
const blocks = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
];
const children: Record<string, string[]> = {
  doc: blocks,
  paragraph: inline,
  heading: inline,
  codeBlock: ['text'],
  blockquote: blocks,
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  listItem: blocks,
  table: ['tableRow'],
  tableRow: ['tableCell', 'tableHeader'],
  tableCell: blocks,
  tableHeader: blocks,
  image: [],
  text: [],
  hardBreak: [],
  horizontalRule: [],
};
export function validDocument(value: unknown): value is DocumentContent {
  if (
    !record(value) ||
    value.type !== 'doc' ||
    !Array.isArray(value.content) ||
    !value.content.length
  )
    return false;
  const pending: Array<{ node: unknown; depth: number; parent: string | null }> = [
    { node: value, depth: 0, parent: null },
  ];
  let count = 0,
    length = 0,
    images = 0;
  while (pending.length) {
    const { node, depth, parent } = pending.pop()!;
    if (
      ++count > 10000 ||
      depth > 20 ||
      !record(node) ||
      !only(node, ['type', 'attrs', 'content', 'text', 'marks']) ||
      typeof node.type !== 'string' ||
      !Object.hasOwn(children, node.type)
    )
      return false;
    if (parent && !children[parent]!.includes(node.type)) return false;
    if (node.attrs !== undefined && !record(node.attrs)) return false;
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    if (node.type === 'image') {
      if (
        ++images > 100 ||
        !only(attrs, ['attachmentId', 'alt', 'title', 'width']) ||
        !uuid.safeParse(attrs.attachmentId).success
      )
        return false;
      if (
        attrs.width != null &&
        (!Number.isInteger(attrs.width) || Number(attrs.width) < 80 || Number(attrs.width) > 1600)
      )
        return false;
      if (
        ['alt', 'title'].some(
          (k) =>
            attrs[k] != null && (typeof attrs[k] !== 'string' || String(attrs[k]).length > 500),
        )
      )
        return false;
    } else if (node.type === 'heading') {
      if (!only(attrs, ['level']) || ![1, 2, 3].includes(Number(attrs.level))) return false;
    } else if (node.type === 'orderedList') {
      if (
        !only(attrs, ['start', 'type']) ||
        (attrs.start != null &&
          (!Number.isInteger(attrs.start) ||
            Number(attrs.start) < 1 ||
            Number(attrs.start) > 1000000)) ||
        (attrs.type != null && !['1', 'a', 'A', 'i', 'I'].includes(String(attrs.type)))
      )
        return false;
    } else if (['tableCell', 'tableHeader'].includes(node.type)) {
      if (
        !only(attrs, ['colspan', 'rowspan', 'colwidth', 'align']) ||
        ['colspan', 'rowspan'].some(
          (k) =>
            attrs[k] != null &&
            (!Number.isInteger(attrs[k]) || Number(attrs[k]) < 1 || Number(attrs[k]) > 50),
        )
      )
        return false;
      if (
        attrs.align != null &&
        !['left', 'center', 'right', 'justify'].includes(String(attrs.align))
      )
        return false;
      if (
        attrs.colwidth != null &&
        (!Array.isArray(attrs.colwidth) ||
          attrs.colwidth.length > 50 ||
          attrs.colwidth.some((n) => !Number.isInteger(n) || n < 0 || n > 1600))
      )
        return false;
    } else if (node.type === 'codeBlock') {
      if (
        !only(attrs, ['language']) ||
        (attrs.language != null &&
          (typeof attrs.language !== 'string' || attrs.language.length > 40))
      )
        return false;
    } else if (Object.keys(attrs).length) return false;
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text.length) return false;
      length += node.text.length;
    } else if (node.text !== undefined) return false;
    if (length > 200000) return false;
    if (node.marks !== undefined) {
      if (
        !['text', 'hardBreak'].includes(node.type) ||
        !Array.isArray(node.marks) ||
        node.marks.length > 7
      )
        return false;
      const seen = new Set<string>();
      for (const mark of node.marks) {
        if (
          !record(mark) ||
          !only(mark, ['type', 'attrs']) ||
          typeof mark.type !== 'string' ||
          seen.has(mark.type) ||
          !['bold', 'italic', 'strike', 'underline', 'code', 'link', 'textStyle'].includes(
            mark.type,
          )
        )
          return false;
        seen.add(mark.type);
        if (mark.attrs !== undefined && !record(mark.attrs)) return false;
        const a = (mark.attrs ?? {}) as Record<string, unknown>;
        if (mark.type === 'link') {
          if (
            !only(a, ['href', 'target', 'rel', 'class', 'title']) ||
            !validDocumentLink(a.href) ||
            (a.target != null && a.target !== '_blank') ||
            (a.rel != null && a.rel !== 'noopener noreferrer nofollow') ||
            a.class != null ||
            (a.title != null && (typeof a.title !== 'string' || a.title.length > 500))
          )
            return false;
        } else if (mark.type === 'textStyle') {
          if (
            !only(a, ['fontSize', 'color']) ||
            (a.fontSize != null && !validDocumentFontSize(a.fontSize)) ||
            (a.color != null && !validDocumentTextColor(a.color))
          )
            return false;
        } else if (Object.keys(a).length) return false;
      }
    }
    if (node.content !== undefined && !Array.isArray(node.content)) return false;
    const list = (node.content ?? []) as unknown[];
    if (list.length > 2000 || (!children[node.type]!.length && list.length)) return false;
    if (
      [
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'table',
        'tableRow',
        'tableCell',
        'tableHeader',
      ].includes(node.type) &&
      !list.length
    )
      return false;
    for (const child of list) pending.push({ node: child, depth: depth + 1, parent: node.type });
  }
  return JSON.stringify(value).length <= 512000;
}
export const documentContentSchema = z.custom<DocumentContent>(
  validDocument,
  '文档内容无效或超过大小限制',
);
export function documentImageIds(content: DocumentContent): string[] {
  const ids = new Set<string>();
  const walk = (node: DocumentNode) => {
    if (node.type === 'image') ids.add(String(node.attrs!.attachmentId));
    node.content?.forEach(walk);
  };
  walk(content);
  return [...ids];
}
export function documentPlainText(content: DocumentContent): string {
  const walk = (node: DocumentNode): string =>
    node.text ??
    (node.type === 'image'
      ? String(node.attrs?.alt ?? '')
      : (node.content ?? [])
          .map(walk)
          .join(['paragraph', 'heading'].includes(node.type) ? '' : '\n'));
  return walk(content).trim();
}
export const emptyDocument = (): DocumentContent => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});
export const createDocumentSchema = z.object({
  template: z.enum(['blank', 'requirement']).default('blank'),
});
export const saveDocumentSchema = z.object({
  version: z.number().int().positive(),
  content: documentContentSchema,
});
export const applyDocumentSchema = z.object({
  version: z.number().int().positive(),
  requirementVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).default(''),
  impact: z.string().trim().max(2000).default(''),
});
export const resetDocumentSchema = z.object({ version: z.number().int().positive() });
export const documentPointerSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
});
const author = z.object({ id: z.uuid(), name: z.string() });
export const documentVersionSchema = documentPointerSchema.extend({
  content: documentContentSchema,
  createdAt: z.iso.datetime(),
  createdBy: author,
});
export const documentDraftSchema = z.object({
  content: documentContentSchema,
  version: z.number().int().positive(),
  baseRevision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  updatedBy: author,
});
export const requirementDocumentSchema = z.object({
  requirement: z.object({
    id: z.uuid(),
    projectId: z.uuid(),
    title: z.string(),
    code: z.string(),
    version: z.number().int(),
    revision: z.number().int(),
    status: z.string(),
  }),
  current: documentVersionSchema.nullable(),
  draft: documentDraftSchema.nullable(),
  canEdit: z.boolean(),
  hasPendingChanges: z.boolean(),
});
export const documentVersionListSchema = z.object({
  items: z.array(documentVersionSchema.omit({ content: true })),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export const documentImageListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      filename: z.string(),
      size: z.number().int().positive(),
      createdAt: z.iso.datetime(),
    }),
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type RequirementDocument = z.infer<typeof requirementDocumentSchema>;
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
