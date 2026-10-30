import {
  emptyDocument,
  validDocumentFontSize,
  validDocumentTextColor,
  type DocumentContent,
  type DocumentNode,
} from '@myteam/contracts';

function textStyle(attrs: Record<string, unknown> = {}) {
  let fontSize = attrs.fontSize;
  if (typeof fontSize === 'string' && /^\d+(?:\.\d+)?pt$/.test(fontSize))
    fontSize = `${Math.round(((Number.parseFloat(fontSize) * 4) / 3) * 100) / 100}px`;
  return {
    fontSize: validDocumentFontSize(fontSize) ? fontSize : null,
    color: validDocumentTextColor(attrs.color) ? attrs.color : null,
  };
}

export function persistedContent(node: DocumentNode): DocumentContent {
  const clean = (value: DocumentNode): DocumentNode => ({
    ...value,
    ...(value.marks
      ? {
          marks: value.marks.map((mark) =>
            mark.type === 'link'
              ? {
                  ...mark,
                  attrs: {
                    ...mark.attrs,
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                  },
                }
              : mark.type === 'textStyle'
                ? { ...mark, attrs: textStyle(mark.attrs) }
                : mark,
          ),
        }
      : {}),
    ...(value.content
      ? { content: value.content.filter((child) => child.type !== 'uploadingImage').map(clean) }
      : {}),
  });
  const result = clean(node) as DocumentContent;
  return result.content.length ? result : emptyDocument();
}
