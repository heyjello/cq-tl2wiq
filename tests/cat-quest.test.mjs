// Temporary browser harness for the single-file Cat Quest app.
// Drives system Chrome via puppeteer-core. The narrow-viewport case is
// Chromium device emulation only: it is not WebKit, Safari, or a physical iPhone.
//
// Run from the repo root: npm install && npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ARTIFACTS = '/opt/cursor/artifacts';

const LEGACY = {
  xp: 420,
  run: 2,
  q: {
    'sql-01': { seen: 3, first: 1, ever: true, missed: true },
    'ds-01': { seen: 1, first: 1, ever: true, missed: false },
    'custom-note': { seen: 1, first: 0, ever: false, missed: false, note: 'keep me' },
  },
  tags: { sql: { seen: 3, first: 1 }, ds: { seen: 1, first: 1 }, custom: { seen: 4, first: 2 } },
  pounceDates: ['2026-11-04', '2026-11-05'],
  lastPounce: '2026-11-05',
  streak: 4,
  bestStreak: 6,
  pounceCount: 9,
  freezes: 2,
  freezeAtStreak: 7,
  boss: { 'boss-1': { best: 5, last: '2026-11-05' } },
  bossDay: { 'boss-1|2026-11-05': 5 },
  fullTicks: 1,
  badges: { firstPounce: '2026-11-04' },
  level: 2,
  savedAt: 1000,
};

let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function newPage(options = {}) {
  const context = await browser.createBrowserContext();
  if (options.permissions) {
    await context.overridePermissions(base, options.permissions);
  }
  const page = await context.newPage();
  if (options.viewport) await page.setViewport(options.viewport);
  if (options.state) {
    await page.evaluateOnNewDocument((raw) => {
      localStorage.setItem('catQuest.v1', raw);
    }, JSON.stringify(options.state));
  }
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.catQuestTest && document.getElementById('view'));
  return page;
}

async function closePage(page) {
  await page.browserContext().close();
}

async function stateOf(page) {
  return page.evaluate(() => {
    const S = catQuestTest.state();
    return JSON.parse(JSON.stringify({
      xp: S.xp,
      run: S.run,
      streak: S.streak,
      bestStreak: S.bestStreak,
      lastPounce: S.lastPounce,
      pounceCount: S.pounceCount,
      pounceDates: S.pounceDates,
      freezes: S.freezes,
      freezeAtStreak: S.freezeAtStreak,
      fullTicks: S.fullTicks,
      level: S.level,
      badges: S.badges,
      boss: S.boss,
      bossDay: S.bossDay,
      tags: S.tags,
      q: S.q,
      pile: catQuestTest.reviewPile().map((q) => q.id),
      key: catQuestTest.KEY,
    }));
  });
}

async function startSession(page, ids, title, mode) {
  await page.evaluate((ids, title, mode) => {
    startSession(ids.map(byId), title, mode);
  }, ids, title, mode);
  await page.waitForSelector('#qtext');
}

function yesterdayExpr() {
  return `(() => { const d = new Date(); d.setDate(d.getDate() - 1); return catQuestTest.today(d); })()`;
}

test('unknown answer awards 0 XP, reveals the answer, and can finish', { timeout: 60000 }, async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => {
      const S = catQuestTest.state();
      S.xp = 80;
      S.run = 4;
      S.freezes = 2;
      save();
    });
    await startSession(page, ['sql-01', 'sql-07'], 'Daily Pounce', 'pounce');
    assert.equal(await page.$eval('#dunno', (el) => el.textContent), "I don't know 0");
    await page.click('#dunno');
    await page.waitForSelector('#next');
    const mid = await page.evaluate(() => {
      const q = catQuestTest.currentSession().q;
      const right = document.querySelector('.opt.right');
      return {
        xp: catQuestTest.state().xp,
        run: catQuestTest.state().run,
        freezes: catQuestTest.state().freezes,
        sessionXp: catQuestTest.currentSession().xp,
        readIt: !!document.getElementById('readIt'),
        next: document.getElementById('next').textContent,
        fb: document.getElementById('fb').innerText,
        rightText: right ? right.innerText : '',
        rightIndex: right ? right.dataset.i : '',
        answer: String(q.answer),
        explain: q.explain,
        missed: catQuestTest.state().q['sql-01'],
        dunnoDisabled: document.getElementById('dunno').disabled,
        optionsDisabled: [...document.querySelectorAll('.opt')].every((b) => b.disabled),
      };
    });
    assert.equal(mid.xp, 80);
    assert.equal(mid.sessionXp, 0);
    assert.equal(mid.run, 0);
    assert.equal(mid.freezes, 2);
    assert.equal(mid.readIt, false);
    assert.equal(mid.next, 'Next →');
    assert.match(mid.fb, /0 XP/);
    assert.match(mid.fb, /Review Pile/);
    assert.ok(mid.fb.includes(mid.explain));
    assert.equal(mid.rightIndex, mid.answer);
    assert.match(mid.rightText, /\b6\b/);
    assert.equal(mid.missed.missed, true);
    assert.equal(mid.missed.unknown, true);
    assert.equal(mid.missed.ever, false);
    assert.equal(mid.dunnoDisabled, true);
    assert.equal(mid.optionsDisabled, true);

    await page.click('#next');
    await page.waitForSelector('#qtext');
    const secondId = await page.evaluate(() => catQuestTest.currentSession().q.id);
    assert.equal(secondId, 'sql-07');
    await page.click('.opt[data-i="2"]');
    await page.waitForSelector('#next');
    const scored = await stateOf(page);
    assert.equal(scored.xp, 90);
    assert.ok(!scored.pile.includes('sql-07'));
    assert.ok(scored.pile.includes('sql-01'));
    await page.click('#next');
    await page.waitForSelector('#homeBtn');
    const done = await page.$eval('h2', (el) => el.textContent);
    assert.match(done, /complete/);
    await page.click('#homeBtn');
    await page.waitForSelector('[data-go="pounce"]');
    await startSession(page, ['sql-01'], 'Review Pile', 'review');
    await page.keyboard.press('2');
    await page.waitForSelector('.fb.good');
    const cleared = await stateOf(page);
    assert.ok(!cleared.pile.includes('sql-01'));
    assert.equal(cleared.q['sql-01'].missed, false);
    assert.equal(cleared.q['sql-01'].unknown, false);
    assert.equal(cleared.q['sql-01'].ever, true);
    assert.ok(cleared.xp > 90);
  } finally {
    await closePage(page);
  }
});

test('keyboard 0 marks unknown and 2 still scores a correct answer', { timeout: 60000 }, async () => {
  const page = await newPage();
  try {
    await startSession(page, ['sql-07'], 'Topic Sprint', 'sprint');
    await page.keyboard.press('0');
    await page.waitForSelector('#next');
    let s = await stateOf(page);
    assert.equal(s.xp, 0);
    assert.deepEqual(s.pile, ['sql-07']);
    assert.equal(s.q['sql-07'].reason, 'unknown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#homeBtn');

    await startSession(page, ['sql-01'], 'Topic Sprint', 'sprint');
    await page.keyboard.press('2');
    await page.waitForSelector('.fb.good');
    s = await stateOf(page);
    assert.equal(s.xp, 10);
    assert.ok(!s.pile.includes('sql-01'));
    assert.equal(s.q['sql-01'].ever, true);
    assert.equal(s.q['sql-01'].missed, false);
  } finally {
    await closePage(page);
  }
});

test('wrong then corrected on the retry still enters the review pile', { timeout: 60000 }, async () => {
  const page = await newPage();
  try {
    await startSession(page, ['sql-07'], 'Topic Sprint', 'sprint');
    await page.click('.opt[data-i="0"]');
    await page.waitForSelector('#peek');
    let s = await stateOf(page);
    assert.equal(s.xp, 0);
    assert.ok(s.pile.includes('sql-07'));
    assert.equal(s.q['sql-07'].reason, 'incorrect');
    assert.equal(s.q['sql-07'].wrong, true);
    assert.equal(await page.$('#next'), null);
    assert.equal(await page.$eval('#dunno', (el) => el.disabled), true);

    await page.keyboard.press('0');
    assert.equal(await page.$('#next'), null, 'I don\'t know must not replace the ordinary second-chance scoring');

    await page.click('.opt[data-i="2"]');
    await page.waitForSelector('#next');
    s = await stateOf(page);
    assert.equal(s.xp, 5);
    assert.equal(s.q['sql-07'].ever, true);
    assert.equal(s.q['sql-07'].missed, true);
    assert.equal(s.q['sql-07'].unknown, false);
    assert.equal(s.q['sql-07'].reason, 'incorrect');
    assert.ok(s.pile.includes('sql-07'));
    const fb = await page.$eval('#fb', (el) => el.innerText);
    assert.match(fb, /\+5 XP/);
    assert.doesNotMatch(fb, /\+10 XP/);

    await page.click('#next');
    await page.waitForSelector('#homeBtn');
    await startSession(page, ['sql-07'], 'Review Pile', 'review');
    await page.click('.opt[data-i="2"]');
    await page.waitForSelector('#next');
    s = await stateOf(page);
    assert.equal(s.xp, 15);
    assert.ok(!s.pile.includes('sql-07'));
    assert.equal(s.q['sql-07'].missed, false);
    assert.equal(s.q['sql-07'].ever, true);
  } finally {
    await closePage(page);
  }
});

test('giving up still awards the existing +2 XP and stays in review', { timeout: 60000 }, async () => {
  const page = await newPage();
  try {
    await startSession(page, ['ds-05'], 'Topic Sprint', 'sprint');
    await page.click('.opt[data-i="0"]');
    await page.waitForSelector('#peek');
    await page.click('#peek');
    await page.waitForSelector('#readIt');
    assert.equal(await page.$('#next'), null);
    assert.equal((await stateOf(page)).xp, 0);
    await page.click('#readIt');
    await page.waitForSelector('#next');
    const s = await stateOf(page);
    assert.equal(s.xp, 2);
    assert.ok(s.pile.includes('ds-05'));
    assert.equal(s.q['ds-05'].reason, 'incorrect');
    assert.equal(s.q['ds-05'].unknown, false);
  } finally {
    await closePage(page);
  }
});

test('Daily Pounce completes and extends the streak after every answer is unknown', { timeout: 60000 }, async () => {
  const page = await newPage();
  try {
    const preset = await page.evaluate((ydayExpr) => {
      const S = catQuestTest.state();
      const yday = eval(ydayExpr);
      S.xp = 80;
      S.streak = 2;
      S.bestStreak = 2;
      S.lastPounce = yday;
      S.pounceCount = 4;
      S.pounceDates = [yday];
      S.run = 3;
      S.freezes = 1;
      save();
      home();
      return { yday, today: catQuestTest.today() };
    }, yesterdayExpr());
    await page.click('[data-go="pounce"]');
    await page.waitForSelector('#dunno');
    const ids = await page.evaluate(() => catQuestTest.currentSession().list.map((q) => q.id));
    assert.equal(ids.length, 5);
    for (let n = 0; n < 5; n++) {
      await page.waitForSelector('#dunno:not([disabled])');
      const label = await page.$eval('#next, #dunno', () => document.querySelector('#qtext').textContent);
      assert.ok(label.length > 0);
      await page.click('#dunno');
      await page.waitForSelector('#next');
      const snap = await page.evaluate(() => ({
        xp: catQuestTest.state().xp,
        readIt: !!document.getElementById('readIt'),
        next: document.getElementById('next').textContent,
        right: !!document.querySelector('.opt.right'),
      }));
      assert.equal(snap.xp, 80);
      assert.equal(snap.readIt, false);
      assert.equal(snap.right, true);
      assert.equal(snap.next, n === 4 ? 'Finish' : 'Next →');
      await page.click('#next');
    }
    await page.waitForSelector('#homeBtn');
    const s = await stateOf(page);
    assert.equal(s.xp, 80);
    assert.equal(s.streak, 3);
    assert.equal(s.bestStreak, 3);
    assert.equal(s.lastPounce, preset.today);
    assert.equal(s.pounceCount, 5);
    assert.ok(s.pounceDates.includes(preset.today));
    assert.ok(s.pounceDates.includes(preset.yday));
    assert.equal(s.freezes, 1);
    assert.equal(s.run, 0);
    assert.deepEqual(s.pile.slice().sort(), ids.slice().sort());
    for (const id of ids) {
      assert.equal(s.q[id].unknown, true);
      assert.equal(s.q[id].reason, 'unknown');
      assert.equal(s.q[id].missed, true);
    }
    const body = await page.$eval('.card', (el) => el.innerText);
    assert.match(body, /Daily streak: 3 days/);
    assert.match(body, /0 of 5/);
    assert.match(body, /\+0 XP/);
    await page.screenshot({ path: path.join(ARTIFACTS, 'pounce-complete.png') });
  } finally {
    await closePage(page);
  }
});

test('review export markdown contains question, choices, answer, explanation, tag, and reason', { timeout: 60000 }, async () => {
  const page = await newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await startSession(page, ['sql-02'], 'Daily Pounce', 'pounce');
    await page.click('#dunno');
    await page.waitForSelector('#next');
    await page.click('#next');
    await page.waitForSelector('#homeBtn');

    await startSession(page, ['sql-07'], 'Topic Sprint', 'sprint');
    await page.click('.opt[data-i="0"]');
    await page.click('.opt[data-i="2"]');
    await page.waitForSelector('#next');
    await page.click('#next');
    await page.waitForSelector('#homeBtn');

    await startSession(page, ['rc-01'], 'Topic Sprint', 'sprint');
    await page.keyboard.press('0');
    await page.waitForSelector('#next');
    await page.click('#next');
    await page.waitForSelector('#copyReview');

    await page.click('[data-go="home"]');
    await page.waitForSelector('[data-go="review"]');
    await page.click('[data-go="review"]');
    await page.waitForSelector('#reviewMd');
    const md = await page.$eval('#reviewMd', (el) => el.value);
    const direct = await page.evaluate(() => catQuestTest.exportReviewMarkdown(catQuestTest.today()));
    assert.equal(md, direct);

    const sql02 = await page.evaluate(() => DATA.questions.find((q) => q.id === 'sql-02'));
    const sql07 = await page.evaluate(() => DATA.questions.find((q) => q.id === 'sql-07'));
    const rc01 = await page.evaluate(() => DATA.questions.find((q) => q.id === 'rc-01'));

    assert.match(md, /# Cat Quest review pile/);
    for (const q of [sql02, sql07, rc01]) {
      assert.ok(md.includes(q.q), q.id + ' question text');
      assert.ok(md.includes(q.explain), q.id + ' explanation');
      assert.ok(md.includes('- **Id:** ' + q.id), q.id + ' id');
      q.options.forEach((opt, i) => {
        const raw = String(opt).replace(/\r\n/g, '\n').trim();
        const flat = raw.replace(/\s+/g, ' ').trim();
        assert.ok(md.includes(raw) || md.includes(flat), q.id + ' choice ' + i);
      });
      const correct = q.options[q.answer].replace(/\s+/g, ' ').trim();
      assert.ok(md.includes('**Correct answer:** ' + 'ABCD'[q.answer] + '. ' + correct), q.id + ' correct');
    }
    assert.match(md, /- \*\*Tag:\*\* SQL/);
    assert.match(md, /- \*\*Tag:\*\* RevenueCat & subscriptions/);
    assert.match(md, /- \*\*Reason:\*\* I don't know/);
    assert.match(md, /- \*\*Reason:\*\* Incorrect/);
    assert.ok(md.includes('**Tables:** users, subscriptions'));
    assert.ok(md.includes(sql07.code));
    assert.ok(md.includes(rc01.source));
    assert.equal((md.match(/\(correct\)/g) || []).length, 3);
    assert.ok(!md.includes('live-05'));
    assert.ok(!md.includes('ds-14'));
    const sql02Block = md.split('## ').find((part) => part.includes('sql-02'));
    assert.match(sql02Block, /\*\*Reason:\*\* I don't know/);
    assert.match(sql02Block, /\*\*D\.\*\* \*\*\(correct\)\*\*/);
    const sql07Block = md.split('## ').find((part) => part.includes('sql-07'));
    assert.match(sql07Block, /\*\*Reason:\*\* Incorrect/);
    assert.match(sql07Block, /\*\*C\.\*\* trial \*\*\(correct\)\*\*/);

    await page.click('#copyReview');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('on'));
    const copied = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch (e) { return 'CLIPBOARD:' + e.message; }
    });
    assert.equal(copied, md);
    await page.screenshot({ path: path.join(ARTIFACTS, 'review-export.png'), fullPage: true });

    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-review-'));
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    await page.click('#downloadReview');
    const file = path.join(downloadDir, 'cat-quest-review.md');
    const started = Date.now();
    while (!fs.existsSync(file)) {
      if (Date.now() - started > 5000) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(fs.readFileSync(file, 'utf8'), md);
  } finally {
    await closePage(page);
  }
});

test('unknown and legacy misses survive reload under catQuest.v1', { timeout: 60000 }, async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => {
      const S = catQuestTest.state();
      S.xp = 80;
      S.streak = 2;
      S.badges = { firstPounce: '2026-11-01' };
      save();
    });
    await startSession(page, ['sql-01', 'ds-09'], 'Daily Pounce', 'pounce');
    await page.click('#dunno');
    await page.waitForSelector('#next');
    const before = await page.evaluate(() => ({
      key: catQuestTest.KEY,
      raw: localStorage.getItem('catQuest.v1'),
      other: localStorage.getItem('catQuest.v2'),
    }));
    assert.equal(before.key, 'catQuest.v1');
    assert.equal(before.other, null);
    assert.match(before.raw, /"unknown":true/);
    assert.equal(JSON.parse(before.raw).xp, 80);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#resumeBtn');
    let s = await stateOf(page);
    assert.equal(s.key, 'catQuest.v1');
    assert.equal(s.xp, 80);
    assert.equal(s.streak, 2);
    assert.equal(s.badges.firstPounce, '2026-11-01');
    assert.ok(s.pile.includes('sql-01'));
    assert.equal(s.q['sql-01'].unknown, true);
    assert.equal(s.q['sql-01'].reason, 'unknown');
    assert.equal(s.q['sql-01'].missed, true);
    const resume = await page.$eval('#view', (el) => el.innerText);
    assert.match(resume, /question 2 of 2/);
    await page.click('#resumeBtn');
    await page.waitForSelector('#qtext');
    const q = await page.$eval('#qtext', (el) => el.textContent);
    assert.match(q, /Dedupe|Set/);
    await page.click('.opt[data-i="2"]');
    await page.waitForSelector('#next');
    s = await stateOf(page);
    assert.equal(s.xp, 90);
    assert.ok(s.pile.includes('sql-01'));
    assert.ok(!s.pile.includes('ds-09'));
    await page.click('#next');
    await page.waitForSelector('#homeBtn');
  } finally {
    await closePage(page);
  }
});

test('existing catQuest.v1 progress migrates without resetting user data', { timeout: 60000 }, async () => {
  const page = await newPage({ state: LEGACY });
  try {
    const s = await stateOf(page);
    assert.equal(s.key, 'catQuest.v1');
    assert.equal(s.xp, 420);
    assert.equal(s.run, 2);
    assert.equal(s.streak, 4);
    assert.equal(s.bestStreak, 6);
    assert.equal(s.lastPounce, '2026-11-05');
    assert.equal(s.pounceCount, 9);
    assert.deepEqual(s.pounceDates, ['2026-11-04', '2026-11-05']);
    assert.equal(s.freezes, 2);
    assert.equal(s.freezeAtStreak, 7);
    assert.equal(s.fullTicks, 1);
    assert.equal(s.level, 2);
    assert.equal(s.badges.firstPounce, '2026-11-04');
    assert.equal(s.boss['boss-1'].best, 5);
    assert.equal(s.bossDay['boss-1|2026-11-05'], 5);
    assert.equal(s.tags.custom.seen, 4);
    assert.equal(s.q['custom-note'].note, 'keep me');
    assert.equal(s.q['sql-01'].seen, 3);
    assert.equal(s.q['sql-01'].first, 1);
    assert.equal(s.q['sql-01'].ever, true);
    assert.equal(s.q['sql-01'].missed, true);
    assert.equal(s.q['sql-01'].unknown, false);
    assert.equal(s.q['sql-01'].wrong, true);
    assert.equal(s.q['sql-01'].reason, 'incorrect');
    assert.equal(s.q['ds-01'].missed, false);
    assert.ok(s.pile.includes('sql-01'));
    assert.ok(!s.pile.includes('ds-01'));
    assert.equal(await page.$eval('#hudXp', (el) => el.textContent), '420 XP');
    assert.match(await page.$eval('#hudLevel', (el) => el.textContent), /Tabby/);

    const raw = await page.evaluate(() => localStorage.getItem('catQuest.v1'));
    assert.equal(JSON.parse(raw).xp, 420);
    assert.equal(JSON.parse(raw).q['sql-01'].missed, true);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#hudXp');
    const again = await stateOf(page);
    assert.equal(again.xp, 420);
    assert.equal(again.streak, 4);
    assert.equal(again.q['custom-note'].note, 'keep me');
    assert.ok(again.pile.includes('sql-01'));
    assert.equal(again.q['sql-01'].reason, 'incorrect');

    await startSession(page, ['rc-01'], 'Daily Pounce', 'pounce');
    await page.click('#dunno');
    await page.waitForSelector('#next');
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem(catQuestTest.KEY)));
    assert.equal(saved.xp, 420);
    assert.equal(saved.streak, 4);
    assert.equal(saved.pounceCount, 9);
    assert.equal(saved.badges.firstPounce, '2026-11-04');
    assert.equal(saved.q['custom-note'].note, 'keep me');
    assert.equal(saved.q['sql-01'].missed, true);
    assert.equal(saved.q['sql-01'].seen, 3);
    assert.equal(saved.q['rc-01'].unknown, true);
    assert.equal(saved.q['rc-01'].missed, true);
    assert.equal(saved.q['ds-01'].missed, false);
    assert.equal(saved.freezes, 2);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#hudXp');
    const after = await stateOf(page);
    assert.equal(after.xp, 420);
    assert.equal(after.bestStreak, 6);
    assert.equal(after.q['custom-note'].note, 'keep me');
    assert.ok(after.pile.includes('sql-01'));
    assert.ok(after.pile.includes('rc-01'));
    assert.ok(!after.pile.includes('ds-01'));
    assert.equal(after.q['rc-01'].reason, 'unknown');
    assert.equal(after.q['sql-01'].ever, true);
  } finally {
    await closePage(page);
  }
});

test('narrow mobile viewport keeps the new controls on screen (Chromium emulation, not Safari or iPhone)', { timeout: 60000 }, async () => {
  const viewport = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const page = await newPage({ viewport, state: LEGACY });
  try {
    const ua = await page.evaluate(() => navigator.userAgent);
    assert.match(ua, /Chrome/);
    const homeOverflow = await page.evaluate(() => {
      document.activeElement && document.activeElement.blur();
      return {
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      };
    });
    assert.ok(homeOverflow.scroll <= homeOverflow.client + 2, 'home overflow ' + homeOverflow.scroll + ' > ' + homeOverflow.client + ' UA ' + ua);

    await page.click('[data-go="review"]');
    await page.waitForSelector('#copyReview');
    const reviewBox = await page.$eval('#copyReview', (el) => {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    });
    assert.ok(reviewBox.height >= 40, 'copy control tap size');
    assert.ok(reviewBox.left >= -1 && reviewBox.right <= 376, 'copy control inside 375px viewport ' + JSON.stringify(reviewBox));
    const startBox = await page.$eval('#startReview', (el) => {
      const r = el.getBoundingClientRect();
      return { height: r.height, right: r.right, left: r.left };
    });
    assert.ok(startBox.height >= 40);
    assert.ok(startBox.right <= 376 && startBox.left >= -1);

    await startSession(page, ['sql-02'], 'Daily Pounce', 'pounce');
    const dunno = await page.$eval('#dunno', (el) => {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height, text: el.innerText };
    });
    assert.match(dunno.text, /I don't know/);
    assert.ok(dunno.height >= 40, 'I don\'t know tap size');
    assert.ok(dunno.width >= 200, 'I don\'t know uses the question width');
    assert.ok(dunno.left >= 0 && dunno.right <= 375, JSON.stringify(dunno));
    const questionOverflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    assert.ok(questionOverflow.scroll <= questionOverflow.client + 2, 'question overflow ' + questionOverflow.scroll);

    await page.screenshot({ path: path.join(ARTIFACTS, 'dunno-mobile.png') });
    await page.click('#dunno');
    await page.waitForSelector('#next');
    const nextBox = await page.$eval('#next', (el) => {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { right: r.right, left: r.left, height: r.height };
    });
    assert.ok(nextBox.height >= 32);
    assert.ok(nextBox.right <= 376 && nextBox.left >= -1);
    await page.screenshot({ path: path.join(ARTIFACTS, 'dunno-revealed-mobile.png') });
    console.log('Narrow viewport UA (Chromium emulation, not WebKit/Safari and not a physical iPhone): ' + ua);
  } finally {
    await closePage(page);
  }
});

test('desktop Daily Pounce shows I don\'t know without disturbing boss fights', { timeout: 60000 }, async () => {
  const page = await newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.click('[data-go="pounce"]');
    await page.waitForSelector('#dunno');
    await page.screenshot({ path: path.join(ARTIFACTS, 'dunno-desktop.png') });
    assert.equal(await page.$eval('.opt', (el) => el.classList.contains('dunno')), false);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-go="boss"]');
    await page.click('[data-go="boss"]');
    await page.waitForSelector('[data-go="bossN"]');
    assert.equal(await page.$('#dunno'), null);
  } finally {
    await closePage(page);
  }
});
