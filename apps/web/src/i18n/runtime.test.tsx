// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLocale, localeStorageKey, localizeLabels, setLocale, t, useLocale } from './runtime';
import { relativeDate } from '../modules/projects/presentation';

afterEach(() => {
  cleanup();
  setLocale('zh-CN');
  localStorage.clear();
  vi.restoreAllMocks();
});

const labels = localizeLabels({ PLANNING: '规划中', CLOSED: '已关闭' });
function Editor() {
  useLocale();
  return (
    <>
      <label>
        {t('项目名称')}
        <input aria-label="name" defaultValue="用户填写的项目" />
      </label>
      <span>{labels.CLOSED}</span>
    </>
  );
}

describe('workspace language preference', () => {
  it('updates text and module-level labels without remounting or losing input', () => {
    render(<Editor />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved 中文' } });
    act(() => setLocale('en-US'));
    expect(screen.getByText('Project name')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Unsaved 中文');
    expect(localStorage.getItem(localeStorageKey)).toBe('en-US');
    act(() => setLocale('zh-CN'));
    expect(screen.getByText('项目名称')).toBeTruthy();
    expect(screen.getByText('已关闭')).toBeTruthy();
  });

  it('follows language changes and resets in other tabs', () => {
    render(<Editor />);
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: localeStorageKey, newValue: 'en-US' }),
      ),
    );
    expect(screen.getByText('Closed')).toBeTruthy();
    act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: localeStorageKey, newValue: null })),
    );
    expect(screen.getByText('已关闭')).toBeTruthy();
  });

  it('still switches when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    expect(() => setLocale('en-US')).not.toThrow();
    expect(getLocale()).toBe('en-US');
    expect(t('登录工作空间')).toBe('Sign in to workspace');
  });

  it('uses correct English relative time for one and multiple minutes', () => {
    setLocale('en-US');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T08:00:00Z'));
    expect(relativeDate('2026-10-29T07:59:00Z')).toBe('1 minute ago');
    expect(relativeDate('2026-10-29T07:58:00Z')).toBe('2 minutes ago');
  });
});
