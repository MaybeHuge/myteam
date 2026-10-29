import { projectStatusLabels } from '../../i18n/labels';
import { t, useLocale, getLocale } from '../../i18n';
import {
  AppstoreOutlined,
  CodeOutlined,
  CompassOutlined,
  DeploymentUnitOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Tooltip } from 'antd';
import { type Project } from '@myteam/contracts';
import styles from './projects.module.css';

const icons = {
  layers: <DeploymentUnitOutlined />,
  rocket: <RocketOutlined />,
  code: <CodeOutlined />,
  compass: <CompassOutlined />,
  shield: <SafetyCertificateOutlined />,
  cube: <AppstoreOutlined />,
};
export function ProjectIcon({
  project,
  size = 'normal',
}: {
  project: Pick<Project, 'icon' | 'color'>;
  size?: 'small' | 'normal' | 'large';
}) {
  useLocale();
  return (
    <span className={`${styles.projectIcon} ${styles[project.color]} ${styles[size]}`}>
      {icons[project.icon]}
    </span>
  );
}
export function ProjectStatus({ status }: { status: Project['status'] }) {
  useLocale();
  return (
    <span className={`${styles.status} ${styles[`status${status}`]}`}>
      <i />
      {projectStatusLabels[status]}
    </span>
  );
}
const tones = ['#dceee7', '#e5ebfb', '#eee6f6', '#f6ead5', '#f5e2e4'];
export function PersonAvatar({
  name,
  size = 28,
  index = 0,
}: {
  name: string;
  size?: number;
  index?: number;
}) {
  useLocale();
  return (
    <Tooltip title={name}>
      <span
        className={styles.personAvatar}
        style={{
          width: size,
          height: size,
          background: tones[index % tones.length],
          fontSize: size > 36 ? 16 : 11,
        }}
      >
        {name.slice(0, 1)}
      </span>
    </Tooltip>
  );
}
export function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(getLocale(), {
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(value))
    : t('未设置');
}
export function relativeDate(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return t('刚刚');
  if (getLocale() === 'en-US' && minutes < 10080) {
    const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' });
    if (minutes < 60) return formatter.format(-minutes, 'minute');
    if (minutes < 1440) return formatter.format(-Math.floor(minutes / 60), 'hour');
    return formatter.format(-Math.floor(minutes / 1440), 'day');
  }
  if (minutes < 60) return t('{{0}} 分钟前', { '0': minutes });
  if (minutes < 1440) return t('{{0}} 小时前', { '0': Math.floor(minutes / 60) });
  if (minutes < 10080) return t('{{0}} 天前', { '0': Math.floor(minutes / 1440) });
  return formatDate(value);
}
