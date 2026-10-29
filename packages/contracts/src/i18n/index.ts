import { english } from './en.js';

export const locales = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof locales)[number];
export type TranslationValues = Record<string, unknown>;

export function resolveLocale(value: string | null | undefined): Locale {
  const preferences = (value ?? '')
    .split(',')
    .map((entry) => {
      const [language = '', ...parameters] = entry
        .trim()
        .toLowerCase()
        .split(';')
        .map((part) => part.trim());
      const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
      return { language, quality: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality);
  for (const { language } of preferences) {
    if (language === 'en' || language.startsWith('en-')) return 'en-US';
    if (language === 'zh' || language.startsWith('zh-')) return 'zh-CN';
  }
  return 'zh-CN';
}

export function translate(text: string, locale: Locale, values: TranslationValues = {}) {
  const template = locale === 'en-US' && Object.hasOwn(english, text) ? english[text]! : text;
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name] ?? '') : placeholder,
  );
}

function messagePattern(template: string) {
  const names: string[] = [];
  const parts = template.split(/(\{\{\w+\}\})/g).map((part) => {
    const placeholder = /^\{\{(\w+)\}\}$/.exec(part);
    if (placeholder) {
      names.push(placeholder[1]!);
      return '([\\s\\S]*?)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { expression: new RegExp(`^${parts.join('')}$`), names };
}

const chineseByEnglish = new Map(Object.entries(english).map(([zh, en]) => [en, zh]));
const messagePatterns = Object.entries(english)
  .filter(([key]) => key.includes('{{'))
  .map(([zh, en]) => ({ zh, en, chinese: messagePattern(zh), english: messagePattern(en) }));
const fixedLength = (text: string) => text.replace(/\{\{\w+\}\}/g, '').length;
const chinesePatterns = [...messagePatterns].sort((a, b) => fixedLength(b.zh) - fixedLength(a.zh));
const englishPatterns = [...messagePatterns]
  .filter(({ en }) => fixedLength(en) > 0)
  .sort((a, b) => fixedLength(b.en) - fixedLength(a.en));

// Only call for system-generated messages. Captured titles and names remain verbatim.
// Recognizing both languages also lets an already-displayed error follow a language switch.
export function translateMessage(message: string, locale: Locale): string {
  if (!message) return message;
  if (Object.hasOwn(english, message)) return translate(message, locale);
  if (locale === 'zh-CN') {
    const source = chineseByEnglish.get(message);
    if (source !== undefined) return source;
  }
  for (const pattern of locale === 'en-US' ? chinesePatterns : englishPatterns) {
    const { expression, names } = locale === 'en-US' ? pattern.chinese : pattern.english;
    const match = expression.exec(message);
    if (!match) continue;
    const values = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
    const template = locale === 'en-US' ? pattern.en : pattern.zh;
    return translate(template, 'zh-CN', values);
  }
  return message;
}
