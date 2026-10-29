import { t, useLocale } from '../i18n';
import { Button, Empty } from 'antd';
export function EmptyPage({ onReset }: { onReset: () => void }) {
  useLocale();
  return (
    <div className="empty-page">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前页已无记录')} />
      <Button onClick={onReset}>{t('返回第一页')}</Button>
    </div>
  );
}
