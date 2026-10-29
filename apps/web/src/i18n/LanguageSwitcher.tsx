import { GlobalOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import { setLocale, t, useLocale } from './runtime';

export function LanguageSwitcher() {
  const locale = useLocale();
  return (
    <Select
      aria-label={t('界面语言')}
      className="language-switcher"
      value={locale}
      onChange={setLocale}
      prefix={<GlobalOutlined aria-hidden />}
      popupMatchSelectWidth={false}
      options={[
        { value: 'zh-CN', label: '简体中文' },
        { value: 'en-US', label: 'English' },
      ]}
    />
  );
}
