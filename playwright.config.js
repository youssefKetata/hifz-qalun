import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'chrome',
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm start', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
});
