import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { economics, correspondence, item, state } from '../tests/fixtures/curriculum-course-ui.mjs';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const root = resolve(process.env.PLANNER_DIST);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + '/') || !extname(path)) file = resolve(root, 'index.html');
  try { res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLANNER_BROWSER_EXECUTABLE });
const key = 'hosei-planner:v1';
const initial = state({items:[item(correspondence)]});
try {
  for (const width of [1280,390]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    try {
      await context.addInitScript(({key,raw}) => { if (!localStorage.getItem('fixture-loaded')) {localStorage.setItem(key,raw);localStorage.setItem('fixture-loaded','1');}}, {key,raw:JSON.stringify(initial)});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      await page.goto(origin+'/planner');
      const card=page.locator(`[data-curriculum-course-id="${economics.id}"]`); await card.waitFor();
      await card.getByRole('button',{name:'詳細・編集を開く'}).click();
      const attempt=card.locator(`[data-attempt-id="${correspondence.id}"]`);
      const grade=attempt.getByLabel(`${correspondence.name}の最終評価`);
      for (const value of ['S','A','B']) {
        await grade.selectOption(value);
        await page.waitForFunction(({key,id,value})=>JSON.parse(localStorage.getItem(key)).courseEvaluations?.[id]?.finalGrade===value,{key,id:correspondence.id,value});
        await page.reload(); await card.waitFor(); await card.getByRole('button',{name:'詳細・編集を開く'}).click();
        assert.equal(await grade.inputValue(),value);
      }
      await attempt.getByText('履修状況の詳細・編集',{exact:true}).click();
      const exam=attempt.locator('label').filter({hasText:/^単位修得試験/}).locator('select');
      await exam.selectOption('S');
      await page.waitForFunction(({key,id})=>JSON.parse(localStorage.getItem(key)).correspondenceProgress?.[id]?.examGrade==='S',{key,id:correspondence.id});
      const saved=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));
      await page.reload(); await card.waitFor(); await card.getByRole('button',{name:'詳細・編集を開く'}).click();
      await attempt.getByText('履修状況の詳細・編集',{exact:true}).click();
      assert.equal(await exam.inputValue(),'S');
      assert.deepEqual(saved.items,initial.items);
      console.log(JSON.stringify({width,grades:['S','A','B'],exam:'S',itemPreserved:true,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));
    } finally {await context.close();}
  }
  console.log('PASS final grades and correspondence exam through real planner/reload');
} finally {await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
