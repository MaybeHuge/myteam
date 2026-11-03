import { t } from '../../i18n';

const providerNames: Record<string, string> = {
  bailian: '阿里百炼',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
};

export function providerLabel(id: string, fallback: string) {
  const name = providerNames[id];
  return name ? t(name) : fallback;
}
