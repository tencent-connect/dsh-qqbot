import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DUMMY_APP_ID } from './command-protocol.mjs';

const workbench = '/api/qqbot/workbench/';
const directId = 'local-fixture-allowed-user';
const groupId = 'local-fixture-allowed-group';
const scopeQuery = new URLSearchParams({ appId: DUMMY_APP_ID, scope: 'c2c', openId: directId });
const presetsKey = 'im-qqbot/tool-presets/v1';
const legacyCombination = { id: 'u123', label: '旧只读组合', tools: ['read', 'run_code'] };
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

async function verifyMessages(page, client, fixture, until) {
  const pane = page.getByRole('region', { name: '当前 QQ 会话' });
  const history = pane.getByRole('region', { name: 'QQ 消息', exact: true });
  const composer = history.getByRole('form', { name: '发送到 QQ', exact: true });
  await composer.waitFor();
  const entries = async () => (await client.get(workbench + 'timeline?' + scopeQuery)).entries;
  const inbound = await until(async () => (await entries()).find(row =>
    row.direction === 'inbound' && row.sessionId && row.platformId && row.text.includes('只回复')), 'linked QQ message');
  const row = history.locator(`[data-entry-id="${inbound.id}"]`);
  const menu = name => page.getByRole('menuitem', { name, exact: true });
  const messageActions = row.locator('button.imqw-message-action');
  const attachment = button(composer, '附件');
  const send = button(composer, '发送到 QQ');
  const text = composer.getByRole('textbox', { name: '发送到 QQ 的消息' });

  assert(await send.isDisabled());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), attachment.click()]);
  await chooser.setFiles({ name: '验收.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture file') });
  await composer.getByText('验收.txt', { exact: true }).waitFor();
  assert(await send.isEnabled());
  await button(composer, '移除附件').click();

  assert.equal(await row.getByText('响应详情', { exact: true }).count(), 0);
  await messageActions.click();
  await menu('响应详情').click();
  await row.getByRole('region', { name: '响应详情' }).getByText('已提交到 DSH').waitFor();
  await messageActions.click();
  await menu('收起响应详情').click();
  await messageActions.click();
  await menu('引用回复').click();
  assert(await text.evaluate(element => element === document.activeElement));
  assert(await attachment.isDisabled());
  await text.fill('网页引用验收');
  await text.press('Shift+Enter');
  await text.press('End');
  await text.type('下一行');
  const quoted = '网页引用验收\n下一行';
  assert.equal(await text.inputValue(), quoted);
  await text.press('Enter');
  await composer.getByRole('status').filter({ hasText: 'QQ 接口已接受' }).waitFor();
  const outbound = await until(async () => (await entries()).find(entry => entry.text === quoted), 'quoted outgoing record');
  assert.equal(outbound.status, 'accepted');
  assert.equal(outbound.quote.text, inbound.text);
  assert((await fixture('observations')).outbound.some(request => request.content.includes('网页引用验收')));
  await history.locator(`[data-entry-id="${outbound.id}"] blockquote`).getByText(inbound.text, { exact: true }).waitFor();
  assert.equal(await text.inputValue(), '');

  await fixture('outbound', { mode: 'failure' });
  await text.fill('网页发送失败验收');
  await send.click();
  await composer.getByRole('status').filter({ hasText: '消息未发送' }).waitFor();
  await history.locator('.imqw-timeline-row').filter({ hasText: '网页发送失败验收' })
    .getByText('QQ 拒绝', { exact: true }).waitFor();
  await fixture('outbound', { mode: 'success' });

  const tree = page.getByRole('complementary', { name: 'QQ 会话列表' });
  const refreshList = button(tree, '刷新会话列表');
  const refreshMessages = button(pane, '刷新消息');
  for (const refresh of [refreshList, refreshMessages]) {
    assert.equal((await refresh.textContent()).trim(), '');
    assert.equal(await refresh.locator('svg').count(), 1);
  }
  const [conversationsResponse] = await Promise.all([
    page.waitForResponse(response => response.url().includes(workbench + 'conversations?') && response.request().method() === 'GET'),
    refreshList.click(),
  ]);
  assert(conversationsResponse.ok());

  await page.route('**/api/qqbot/workbench/timeline?*', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: '夹具读取失败' }),
  }), { times: 1 });
  await refreshMessages.click();
  const error = history.getByRole('alert').filter({ hasText: '夹具读取失败' });
  await error.waitFor();
  await button(history, '重试').click();
  await error.waitFor({ state: 'hidden' });

  const openCurrent = button(pane, '当前 Session');
  const newSession = button(pane, '新建 Session');
  await newSession.click();
  await button(page.getByRole('dialog', { name: '新建 QQ Session' }), '取消').click();
  await openCurrent.click();
  await button(page, '返回 QQ 对话').click();
  await row.waitFor();
  await messageActions.click();
  await menu('打开关联 Session').click();
  await button(page, '返回 QQ 对话').click();
  await row.waitFor();

  const archived = await client.rpc('workspace/archiveSession', { request: { sessionId: inbound.sessionId } });
  assert(archived.archivedSessionIds.includes(inbound.sessionId));
  await page.reload();
  await button(page, 'QQ 机器人').click();
  await page.locator('.imqw-peer-select').filter({ hasText: directId.slice(-8) }).click();
  await button(pane, '恢复当前 Session').click();
  await openCurrent.waitFor();
  assert(await openCurrent.isEnabled());
  const { conversations } = await client.get(workbench + 'conversations?appId=' + DUMMY_APP_ID);
  assert.equal(conversations.find(peer => peer.openId === directId).currentSessionId, inbound.sessionId);

  await fixture('message', { scope: 'c2c', identity: 'denied', command: 'ping' });
  await page.locator('.imqw-peer-select').filter({ hasText: 'ied-user' }).click();
  assert(await openCurrent.isDisabled(), 'a peer without a Session cannot open one');
  assert(await newSession.isEnabled(), 'a new peer can create its first Session');

  await page.locator('.imqw-peer-select').filter({ hasText: groupId.slice(-8) }).click();
  await page.setViewportSize({ width: 840, height: 900 });
  const messages = page.locator('.imqw-small-nav').getByRole('button', { name: '消息', exact: true });
  if (await messages.isVisible()) await messages.click();
  await composer.waitFor();
  assert(await composer.evaluate(node => {
    const toolbar = node.querySelector('.imqw-composer-toolbar');
    return toolbar.scrollWidth <= toolbar.clientWidth + 1 && node.scrollWidth <= node.clientWidth + 1;
  }), 'composer and toolbar fit a narrow viewport');
  for (const action of [openCurrent, newSession, refreshMessages, button(pane, '会话设置')]) await action.waitFor();
  assert(await pane.locator('.imqw-main-head').evaluate(node => node.scrollWidth <= node.clientWidth + 1),
    'header actions fit a narrow viewport');
  await page.setViewportSize({ width: 1640, height: 1040 });
  return { attachment: true, quoteAndSend: true, responseDetails: true, listRefresh: true, messageRefreshAndRetry: true,
    sendFailure: true, nativeSessionReturn: true, restoreArchivedSession: true, firstSessionAction: true, narrowLayout: true };
}

async function verifyToolPicker(page, client, until) {
  const defaults = () => client.get(workbench + 'defaults?appId=' + DUMMY_APP_ID);
  const conversation = async () => (await client.get(workbench + 'conversations?appId=' + DUMMY_APP_ID))
    .conversations.find(row => row.openId === directId && row.scope === 'c2c');
  const openPicker = async scope => {
    const entry = scope.getByRole('button', { name: /^执行权限：/ });
    await entry.waitFor();
    assert.equal(await entry.count(), 1);
    assert.equal(await scope.getByText('权限上限', { exact: true }).count(), 0);
    await entry.click();
    await page.getByRole('menuitem', { name: /^自定义工具/ }).click();
    const dialog = page.getByRole('dialog', { name: '自定义工具', exact: true });
    await dialog.getByRole('group', { name: '工具分类' }).waitFor();
    return dialog;
  };
  await button(page, '设置主机器人').click();
  await page.getByRole('tab', { name: '新会话默认设置' }).click();
  const defaultsForm = page.getByRole('tabpanel', { name: '新会话默认设置' });
  const baseline = await defaults();
  let dialog = await openPicker(defaultsForm);
  const tool = name => dialog.getByRole('checkbox', { name, exact: true });
  const confirm = () => button(dialog, '确认选择').click();
  assert(await button(defaultsForm, '保存').isDisabled());
  await tool('write').check();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert(await button(defaultsForm, '保存').isDisabled());
  assert.deepEqual(await defaults(), baseline);

  dialog = await openPicker(defaultsForm);
  assert.equal(await tool('write').isChecked(), false, 'cancelling drops modal edits');
  await dialog.getByRole('button', { name: /^权限上限：/ }).click();
  await page.getByRole('menuitem', { name: /^仅可查看/ }).click();
  await button(dialog, '只读：文件与搜索').click();
  assert(await tool('read').isChecked());
  assert.equal(await tool('write').isChecked(), false);
  await button(dialog, '只读 + 网页').click();
  assert(await tool('read').isChecked());
  await tool('仅看已选').check();
  assert.equal(await tool('write').count(), 0);
  await tool('仅看已选').uncheck();

  const personal = dialog.getByRole('region', { name: '我的组合' });
  const selected = dialog.getByRole('region', { name: '已选工具' });
  await tool('write').check();
  await button(personal, legacyCombination.label).click();
  const change = dialog.getByRole('status', { name: '组合变更' });
  await change.getByText('run_code', { exact: true }).waitFor();
  assert.match(await change.textContent(), /移除.*write/);
  assert.equal(await button(personal, legacyCombination.label).getAttribute('aria-pressed'), 'true');
  await selected.getByText('read', { exact: true }).waitFor();
  assert.equal(await selected.getByText('write', { exact: true }).count(), 0);
  assert.equal(await tool('run_code').count(), 0);
  const categories = dialog.getByRole('group', { name: '工具分类' });
  await button(categories, '文件').click();
  const files = dialog.getByRole('region', { name: '文件', exact: true });
  await button(files, '全选本组').click();
  assert(await tool('write').isChecked());
  await button(files, '取消本组勾选').click();
  assert.equal(await tool('write').isChecked(), false);
  await button(dialog, legacyCombination.label).click();
  await button(categories, '命令与代码').click();
  const search = dialog.getByRole('searchbox', { name: '搜索工具' });
  await search.fill('bash');
  await button(dialog, '全选当前筛选').click();
  assert(await tool('bash').isChecked());
  assert.equal(await tool('read').count(), 0, 'filters hide out-of-category tools');
  await selected.getByText('read', { exact: true }).waitFor();
  await selected.getByText('bash', { exact: true }).waitFor();
  await button(dialog, '取消当前筛选的勾选').click();
  assert.equal(await tool('bash').isChecked(), false);
  await button(personal, '新建组合').click();
  const name = personal.getByRole('textbox', { name: '组合名称' });
  await name.fill('本轮验收组合');
  await button(personal, '保存组合').click();
  await button(dialog, '本轮验收组合').waitFor();
  const combinations = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), presetsKey);
  assert.deepEqual(combinations[0], legacyCombination);
  assert.deepEqual(combinations[1].tools, ['read']);
  await confirm();
  await defaultsForm.getByRole('button', { name: /执行权限：自定义工具.*仅可查看.*已选 1 项/ }).waitFor();
  assert(await button(defaultsForm, '保存').isEnabled());
  assert.deepEqual(await defaults(), baseline, 'modal confirmation updates the draft only');
  await button(defaultsForm, '保存').click();
  await defaultsForm.getByText('默认设置已保存。', { exact: true }).waitFor();
  const saved = await defaults();
  assert.equal(saved.settings.permission, 'read-only');
  assert.deepEqual(saved.settings.tools, ['read']);
  dialog = await openPicker(defaultsForm);
  assert(await tool('read').isChecked(), 'current custom selection can be edited again');
  await button(personal, '删除组合 本轮验收组合').click();
  await button(personal, '本轮验收组合').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), presetsKey), [legacyCombination]);
  await button(dialog, '取消').click();
  await button(page, '返回会话').click();

  await page.locator('.imqw-peer-select').filter({ hasText: directId.slice(-8) }).click();
  const settings = page.getByRole('complementary', { name: '会话设置', exact: true });
  if (!(await settings.isVisible())) {
    await button(page.getByRole('region', { name: '当前 QQ 会话' }), '会话设置').click();
  }
  await settings.waitFor();
  const agentSummary = settings.locator('summary').filter({ hasText: 'Agent 设置' });
  if (!(await settings.getByRole('button', { name: /^执行权限：/ }).isVisible())) await agentSummary.click();
  const before = await conversation();
  dialog = await openPicker(settings);
  await page.setViewportSize({ width: 560, height: 720 });
  assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await button(dialog, '清空选择').click();
  await confirm();
  assert.deepEqual((await conversation()).agent.tools, before.agent.tools);
  await page.setViewportSize({ width: 1640, height: 1040 });
  await button(settings, '保存').click();
  await until(async () => (await conversation())?.agent.tools?.length === 0, 'saved empty allowlist');
  assert.deepEqual((await defaults()).settings.tools, ['read'], 'conversation saves leave bot defaults intact');
  return { legacyCombinations: true, templates: true, filtersAndBulk: true, cancelAndReopen: true,
    defaultsSaveBoundary: true, conversationSaveBoundary: true, narrowDialog: true, selectedOutsideFilter: true,
    visibleCombinationCreation: true, appliedToolChanges: true };
}

async function verifyPromptPaths(page, client, until, { path, initial, edited, word }) {
  const defaults = () => client.get(workbench + 'defaults?appId=' + DUMMY_APP_ID);
  const conversation = async () => (await client.get(workbench + 'conversations?appId=' + DUMMY_APP_ID))
    .conversations.find(row => row.openId === directId && row.scope === 'c2c');
  const bind = async (panel, label, file) => {
    await panel.getByRole('tablist', { name: label + '来源' }).getByRole('tab', { name: '文件路径', exact: true }).click();
    const input = panel.getByRole('textbox', { name: label + '文件路径', exact: true });
    await input.fill(file.path);
    const preview = button(panel, '预览' + label + '文件');
    const text = panel.getByLabel(label + '预览', { exact: true });
    await preview.click();
    await text.filter({ hasText: file.initial.trim() }).waitFor();
    assert.equal(await text.textContent(), file.initial);
    return { input, preview, text };
  };

  await button(page, '设置主机器人').click();
  await page.getByRole('tab', { name: '新会话默认设置' }).click();
  const defaultsForm = page.getByRole('tabpanel', { name: '新会话默认设置' });
  const baseline = await defaults();
  await bind(defaultsForm, '群聊补充提示词', word);
  assert.deepEqual(await defaults(), baseline);
  await button(defaultsForm, '保存').click();
  await defaultsForm.getByText('默认设置已保存。', { exact: true }).waitFor();
  const savedDefaults = await defaults();
  const source = { kind: 'file', path };
  assert.deepEqual(savedDefaults.settings.groupPrompt, { kind: 'file', path: word.path });
  assert.deepEqual(savedDefaults.settings.directPrompt, baseline.settings.directPrompt);
  await button(page, '返回会话').click();

  await page.locator('.imqw-peer-select').filter({ hasText: directId.slice(-8) }).click();
  const settings = page.getByRole('complementary', { name: '会话设置', exact: true });
  const promptEditor = settings.getByRole('tablist', { name: '私聊补充提示词来源' });
  if (!(await promptEditor.isVisible())) await settings.locator('summary').filter({ hasText: 'QQ 回复' }).click();
  const prior = await conversation();
  const { input, preview, text } = await bind(settings, '私聊补充提示词', { path, initial });
  assert.deepEqual((await conversation()).agent.directPrompt, prior.agent.directPrompt);
  await button(settings, '保存').click();
  const saved = await until(async () => {
    const latest = await conversation();
    return latest.agent.directPrompt?.path === path && latest;
  }, 'saved conversation prompt path');
  assert.deepEqual(saved.agent.directPrompt, source);
  assert.deepEqual(saved.agent.groupPrompt, prior.agent.groupPrompt);
  await writeFile(path, edited, { mode: 0o600 });
  await preview.click();
  await text.filter({ hasText: edited.trim() }).waitFor();
  assert.equal(await text.textContent(), edited);
  await input.fill(path + '.missing.md');
  await preview.click();
  await settings.getByText('找不到补充提示词文件。', { exact: true }).waitFor();
  await text.waitFor({ state: 'hidden' });
  await input.fill(path);
  assert.equal((await conversation()).revision, saved.revision);
  assert.deepEqual(await defaults(), savedDefaults);
  return { botDefaultsDocxPath: true, conversationPath: true, latestPreview: true, storedOnlyPath: true, missingPreview: true };
}

export async function verifyWorkbenchBrowser({ source, hostOrigin, hostLog, client, qq, dir, until, prompt }) {
  const require = createRequire(join(source, 'apps/web/package.json'));
  const { chromium } = require('playwright');
  const login = (await readFile(hostLog, 'utf8')).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._~%+-]+/g)?.at(-1);
  assert(login && new URL(login).origin === hostOrigin, 'isolated Host login');
  const fixture = async (path, payload) => {
    const response = await fetch(qq.origin + '/__fixture/' + path, payload === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert(response.ok, 'fixture ' + path);
    return response.json();
  };
  const browser = await chromium.launch({ channel: process.env.QQBOT_BROWSER_CHANNEL || undefined, headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1640, height: 1040 }, locale: 'zh-CN', colorScheme: 'dark' });
    page.setDefaultTimeout(10_000);
    await page.addInitScript(({ key, combination }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify([combination]));
    }, { key: presetsKey, combination: legacyCombination });
    await page.goto(login);
    await button(page.getByRole('dialog', { name: '预览版说明' }), '继续').click();
    await button(page, 'QQ 机器人').click();
    await page.locator('.imqw-peer-select').filter({ hasText: directId.slice(-8) }).click();
    const messages = await verifyMessages(page, client, fixture, until);
    const toolPicker = await verifyToolPicker(page, client, until);
    const promptPaths = await verifyPromptPaths(page, client, until, prompt);
    return { messages, toolPicker, promptPaths };
  } catch (error) {
    await page?.screenshot({ path: join(dir, 'workbench-failure.png') }).catch(() => {});
    throw new Error(String(error.stack ?? error).replace(/([?&]token=)[^\s&"]+/g, '$1[redacted]'));
  } finally {
    await browser.close();
  }
}
