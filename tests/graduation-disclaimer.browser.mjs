// Build first. PLANNER_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GraduationProgress from '../src/components/planner/graduation/GraduationProgress.tsx';
import { displayScenarios } from './fixtures/graduation-disclaimer.mjs';

test('Chromium desktop/mobile: four display states, sources and keyboard', async () => {
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true });
  const output = process.env.GRADUATION_SCREENSHOTS || '/private/tmp/issue131-display';
  mkdirSync(output, { recursive: true });
  const css = readdirSync('dist/assets').filter(f => f.endsWith('.css')).map(f => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n');
  try {
    for (const width of [1280, 390]) for (const scenario of displayScenarios()) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const html = renderToStaticMarkup(createElement(GraduationProgress, { ...scenario, onOpenProfile() {} }));
      await page.setContent(`<html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main style="max-width:1200px;margin:auto">${html}</main></html>`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('heading', { name: '卒業要件の部分進捗' }).waitFor();
      if (scenario.name === 'unset') {
        const button = page.getByRole('button', { name: 'プロフィールを開く' }).first();
        await button.focus();
        assert.equal(await button.evaluate(el => el === document.activeElement), true);
      }
      const details = await page.locator('details').all();
      const closed = [];
      for (const detail of details) if (!await detail.evaluate(el => el.open)) closed.push(detail);
      if (closed.length) {
        const summary = closed[0].locator('summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await summary.evaluate(el => el.parentElement.open), true);
        await page.keyboard.press('Space');
        assert.equal(await summary.evaluate(el => el.parentElement.open), false);
      }
      const link = page.locator('a[href^="https://"]').first();
      if (await link.count()) {
        await link.focus();
        assert.equal(await link.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await link.evaluate(el => el === document.activeElement), false);
      }
      writeFileSync(`${output}/${scenario.name}.json`, JSON.stringify(scenario.progress, null, 2));
      await page.screenshot({ path: `${output}/${width}-${scenario.name}.png`, fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});
