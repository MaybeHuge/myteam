import type { ReactNode } from 'react';
import { Image } from 'antd';
import { Link } from 'react-router';
import type { DocumentContent, DocumentNode } from '@myteam/contracts';
import { t, useLocale } from '../../i18n';
import styles from './documents.module.css';
import { documentUrl, documentImageUrl } from './document-urls';
export { documentUrl, documentImageUrl } from './document-urls';
export function DocumentVersionLink({
  projectId,
  requirementId,
  document,
}: {
  projectId: string;
  requirementId: string;
  document?: { id: string; number: number } | null;
}) {
  useLocale();
  return document ? (
    <Link
      to={documentUrl(projectId, requirementId, document.id)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {t('查看文档 V{{0}}', { 0: document.number })}
    </Link>
  ) : null;
}
export function DocumentView({
  content,
  projectId,
  requirementId,
}: {
  content: DocumentContent;
  projectId: string;
  requirementId: string;
}) {
  useLocale();
  function render(node: DocumentNode, key: number): ReactNode {
    const children = node.content?.map(render);
    const attrs = node.attrs ?? {};
    if (node.type === 'text') {
      let value: ReactNode = node.text;
      for (const [index, mark] of [...(node.marks ?? [])].reverse().entries()) {
        if (mark.type === 'bold') value = <strong key={index}>{value}</strong>;
        else if (mark.type === 'italic') value = <em key={index}>{value}</em>;
        else if (mark.type === 'strike') value = <s key={index}>{value}</s>;
        else if (mark.type === 'underline') value = <u key={index}>{value}</u>;
        else if (mark.type === 'code') value = <code key={index}>{value}</code>;
        else if (mark.type === 'textStyle')
          value = (
            <span
              key={index}
              style={{
                fontSize:
                  typeof mark.attrs?.fontSize === 'string' ? mark.attrs.fontSize : undefined,
                color: typeof mark.attrs?.color === 'string' ? mark.attrs.color : undefined,
              }}
            >
              {value}
            </span>
          );
        else if (mark.type === 'link')
          value = (
            <a
              key={index}
              href={String(mark.attrs?.href)}
              title={typeof mark.attrs?.title === 'string' ? mark.attrs.title : undefined}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {value}
            </a>
          );
      }
      return <span key={key}>{value}</span>;
    }
    switch (node.type) {
      case 'paragraph':
        return <p key={key}>{children?.length ? children : <br />}</p>;
      case 'heading':
        return attrs.level === 1 ? (
          <h1 key={key}>{children}</h1>
        ) : attrs.level === 3 ? (
          <h3 key={key}>{children}</h3>
        ) : (
          <h2 key={key}>{children}</h2>
        );
      case 'bulletList':
        return <ul key={key}>{children}</ul>;
      case 'orderedList':
        return (
          <ol key={key} start={Number(attrs.start ?? 1)}>
            {children}
          </ol>
        );
      case 'listItem':
        return <li key={key}>{children}</li>;
      case 'blockquote':
        return <blockquote key={key}>{children}</blockquote>;
      case 'codeBlock':
        return (
          <pre key={key}>
            <code>{children}</code>
          </pre>
        );
      case 'hardBreak':
        return <br key={key} />;
      case 'horizontalRule':
        return <hr key={key} />;
      case 'table':
        return (
          <div key={key} className={styles.tableScroll}>
            <table>
              <tbody>{children}</tbody>
            </table>
          </div>
        );
      case 'tableRow':
        return <tr key={key}>{children}</tr>;
      case 'tableCell':
        return (
          <td key={key} colSpan={Number(attrs.colspan ?? 1)} rowSpan={Number(attrs.rowspan ?? 1)}>
            {children}
          </td>
        );
      case 'tableHeader':
        return (
          <th key={key} colSpan={Number(attrs.colspan ?? 1)} rowSpan={Number(attrs.rowspan ?? 1)}>
            {children}
          </th>
        );
      case 'image':
        return (
          <figure key={key} data-document-image={String(attrs.attachmentId)}>
            <Image
              src={documentImageUrl(projectId, requirementId, String(attrs.attachmentId))}
              alt={String(attrs.alt || t('文档图片'))}
              width={attrs.width ? Number(attrs.width) : undefined}
              style={{ maxWidth: '100%', height: 'auto' }}
            />
            {attrs.alt ? <figcaption>{String(attrs.alt)}</figcaption> : null}
          </figure>
        );
      default:
        return null;
    }
  }
  return (
    <Image.PreviewGroup>
      <div className={styles.body}>{content.content.map(render)}</div>
    </Image.PreviewGroup>
  );
}
