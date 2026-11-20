import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { DUMMY_SECRET, DUMMY_TOKEN } from './command-protocol.mjs';

export const cachedBotName = '已绑定 QQ 机器人';
export const scannedBot = {
  appId: '0000000002', token: DUMMY_TOKEN + '-scan', name: '扫码绑定的 QQ 机器人',
  userOpenid: 'local-fixture-scanner', nickname: '同一 AppID 的扫码账号',
};

// Exercise the installed connector with local responses and synthetic credentials.
export function createQrBindingFixture() {
  let task;
  return {
    create(body) {
      const key = Buffer.from(typeof body.key === 'string' ? body.key : '', 'base64');
      if (key.length !== 32) throw new Error('Invalid local binding key');
      const id = randomUUID();
      task = { id, key, completed: false };
      return { retcode: 0, data: { task_id: id } };
    },
    complete(id) {
      if (!task || task.id !== id) throw new Error('Invalid local binding task');
      task.completed = true;
    },
    poll(id) {
      if (!task || task.id !== id) return { retcode: 0, data: { status: 3 } };
      if (!task.completed) return { retcode: 0, data: { status: 1 } };
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', task.key, iv);
      const data = Buffer.concat([iv, cipher.update(DUMMY_SECRET, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return { retcode: 0, data: {
        status: 2, bot_appid: scannedBot.appId, bot_encrypt_secret: data.toString('base64'), user_openid: scannedBot.userOpenid,
      } };
    },
  };
}
