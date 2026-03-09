const { getAllActiveUsers, saveMessage } = require('../db');

const moderatorIds = (process.env.MODERATOR_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

async function broadcastMessage(bot, senderId, senderUser, text) {
  const users = getAllActiveUsers();

  saveMessage(senderUser.id, text);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [${senderUser.pseudonym}]: ${text}`);

  // Получатели: активные пользователи + модераторы (кроме отправителя)
  const recipientIds = new Set([
    ...users.map(u => String(u.telegram_id)),
    ...moderatorIds,
  ]);
  recipientIds.delete(String(senderId));

  for (const telegramId of recipientIds) {
    try {
      await bot.telegram.sendMessage(telegramId, `[${senderUser.pseudonym}]: ${text}`);
    } catch (e) {
      console.warn(`Не удалось доставить сообщение ${telegramId}: ${e.message}`);
    }
  }
}

function registerBroadcastHandler(bot) {
  bot.on('text', async (ctx) => {
    const user = ctx.state.user; // установлен в блоке 2.1
    const text = ctx.message.text.trim();

    await broadcastMessage(bot, ctx.from.id, user, text);
  });
}

module.exports = { registerBroadcastHandler };
