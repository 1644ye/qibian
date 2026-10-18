import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// CI uses the locked project dependency; a local harness may supply its own runtime.
export async function loadChromium(explicitModule) {
  const configured = process.env.PLAYWRIGHT_MODULE || explicitModule;
  try {
    const module = configured
      ? await import(configured.startsWith('file:') ? configured : pathToFileURL(resolve(configured)).href)
      : await import('playwright');
    return module.chromium;
  } catch (error) {
    throw new Error('Cannot load Playwright. Install the locked development dependencies, or set PLAYWRIGHT_MODULE to playwright/index.mjs.', { cause:error });
  }
}

export function edgeLaunchOptions() {
  return process.env.QIBIAN_EDGE_PATH ? { executablePath:resolve(process.env.QIBIAN_EDGE_PATH) } : { channel:'msedge' };
}

export async function chromeLaunchOptions() {
  if (process.env.QIBIAN_CHROME_PATH) {
    const executablePath = resolve(process.env.QIBIAN_CHROME_PATH);
    await access(executablePath);
    return { executablePath };
  }
  const bases = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const base of bases) {
    const executablePath = join(base, 'Google', 'Chrome', 'Application', 'chrome.exe');
    try { await access(executablePath); return { executablePath }; } catch {}
  }
  throw new Error('Google Chrome is required for the cross-browser test. Install Chrome or set QIBIAN_CHROME_PATH; this test does not substitute Chromium.');
}
