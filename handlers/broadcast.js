const { getAllActiveUsers, saveMessage } = require('../db');

async function broadcastMessage(bot, senderId, senderUser, text) {
  const users = getAllActiveUsers();

  saveMessage(senderUser.id, text);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [${senderUser.pseudonym}]: ${text}`);

  for (const user of users) {
    const isSender = String(user.telegram_id) === String(senderId);
    if (isSender) continue; // отправитель не получает дубль своего сообщения

    try {
      await bot.telegram.sendMessage(user.telegram_id, `[${senderUser.pseudonym}]: ${text}`);
    } catch (e) {
      // Пользователь заблокировал бота или удалил чат — пропускаем
      console.warn(`Не удалось доставить сообщение пользователю ${user.pseudonym}: ${e.message}`);
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
