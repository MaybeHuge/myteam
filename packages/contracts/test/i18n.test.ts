import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveLocale, translate, translateMessage } from '../src/i18n/index.js';
import { english } from '../src/i18n/en.js';

describe('Chinese and English localization', () => {
  it('negotiates supported languages by quality and falls back to Chinese', () => {
    expect(resolveLocale('en-GB,en;q=0.9,zh-CN;q=0.8')).toBe('en-US');
    expect(resolveLocale('EN ; q=1')).toBe('en-US');
    expect(resolveLocale('en;q=0.2, zh-CN;q=0.9')).toBe('zh-CN');
    expect(resolveLocale('fr-FR, en-US;q=0.7')).toBe('en-US');
    expect(resolveLocale('en;q=0,zh;q=0.5')).toBe('zh-CN');
    expect(resolveLocale('en;q=invalid')).toBe('zh-CN');
    expect(resolveLocale('unsupported')).toBe('zh-CN');
    expect(resolveLocale(undefined)).toBe('zh-CN');
  });

  it('interpolates without interpreting or translating user content', () => {
    const title = '中文标题 $& <script> {{1}}';
    expect(translate('查看迭代 {{0}}', 'en-US', { 0: title })).toBe(`View iteration ${title}`);
    expect(translate('查看迭代 {{0}}', 'zh-CN', { 0: title })).toBe(`查看迭代 ${title}`);
    expect(translate('查看迭代 {{0}}', 'en-US')).toBe('View iteration {{0}}');
    expect(translate(title, 'en-US')).toBe(title);
    expect(translate('constructor', 'en-US')).toBe('constructor');
    expect(translateMessage('', 'zh-CN')).toBe('');
    expect(translateMessage('42', 'zh-CN')).toBe('42');
  });

  it('localizes API messages and can switch an existing error back to Chinese', () => {
    const chinese = '需求「中文需求 (A+B)」尚未完成';
    const translated = 'Requirement “中文需求 (A+B)” is not complete';
    expect(translateMessage(chinese, 'en-US')).toBe(translated);
    expect(translateMessage(translated, 'zh-CN')).toBe(chinese);
    expect(translateMessage('邮箱或密码错误', 'en-US')).toBe('Incorrect email or password');
    expect(translateMessage('Incorrect email or password', 'zh-CN')).toBe('邮箱或密码错误');
    expect(translateMessage('未知消息 unique content', 'en-US')).toBe('未知消息 unique content');
  });

  it('localizes notification wording while keeping names and titles unchanged', () => {
    expect(translateMessage('陈青 向你分配了任务「实现搜索」', 'en-US')).toBe(
      '陈青 assigned you task “实现搜索”',
    );
    expect(translateMessage('用例「验证码测试」待你评审', 'en-US')).toBe(
      'Test case “验证码测试” awaits your review',
    );
  });

  it('keeps all catalog placeholders and supplies English for every static UI key', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{\w+\}\}/g)].map(([v]) => v).sort();
    for (const [source, translated] of Object.entries(english)) {
      expect(placeholders(translated), source).toEqual(placeholders(source));
      expect(translated, source).not.toMatch(/[\u3400-\u9fff]/);
    }
    const web = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/src');
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
      });
    let keys = 0;
    for (const file of files(web)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't') {
          const key = node.arguments[0];
          if (key && ts.isStringLiteral(key) && /[\u3400-\u9fff]/.test(key.text)) {
            expect(Object.hasOwn(english, key.text), `${file}: ${key.text}`).toBe(true);
            keys++;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(keys).toBeGreaterThan(1000);
  });
});
