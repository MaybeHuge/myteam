import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 本机测试不经过开发环境可能配置的网络代理。
process.env.NO_PROXY = `${process.env.NO_PROXY ?? ''},localhost,127.0.0.1,::1`;
process.env.no_proxy = process.env.NO_PROXY;
for (const name of [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
]) {
  delete process.env[name];
}
const localLibraries = resolve('.tools/browser-libs/usr/lib/x86_64-linux-gnu');
const localFonts = resolve('.tools/browser-fonts.conf');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTimeout: 600000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: existsSync(localLibraries)
      ? {
          env: {
            ...process.env,
            LD_LIBRARY_PATH: `${localLibraries}:${process.env.LD_LIBRARY_PATH ?? ''}`,
            ...(existsSync(localFonts) ? { FONTCONFIG_FILE: localFonts } : {}),
          },
        }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      wait: { stdout: /MYTEAM_E2E_READY/ },
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'pnpm --filter @myteam/web dev --port 5174',
      wait: { stdout: /Local:\s+http:\/\/(?:localhost|127\.0\.0\.1):5174\// },
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3001' },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
