const { getAllActiveUsers, saveMessage, saveBroadcastMessage, findBroadcastByChatAndMessage, getBroadcastMessages } = require('../db');

const moderatorIds = (process.env.MODERATOR_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

async function broadcastMessage(bot, senderId, senderUser, text, replyToMessageId = null) {
  const users = getAllActiveUsers();

  const result = saveMessage(senderUser.id, text);
  const messageDbId = result.lastInsertRowid;

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [${senderUser.pseudonym}]: ${text}`);

  // Если это реплай — найти оригинальное сообщение в БД
  let replyMessageDbId = null;
  if (replyToMessageId) {
    const original = findBroadcastByChatAndMessage(senderId, replyToMessageId);
    if (original) {
      replyMessageDbId = original.message_db_id;
    }
  }

  // Загрузить маппинг reply message_id для каждого получателя
  let replyMap = {};
  if (replyMessageDbId) {
    const copies = getBroadcastMessages(replyMessageDbId);
    for (const copy of copies) {
      replyMap[copy.chat_id] = copy.message_id;
    }
  }

  // Получатели: активные пользователи + модераторы (кроме отправителя)
  const recipientIds = new Set([
    ...users.map(u => String(u.telegram_id)),
    ...moderatorIds,
  ]);
  recipientIds.delete(String(senderId));

  for (const telegramId of recipientIds) {
    try {
      const options = {};
      // Если это ответ — добавить reply_to_message_id для этого получателя
      if (replyMap[telegramId]) {
        options.reply_parameters = { message_id: replyMap[telegramId], allow_sending_without_reply: true };
      }
      const sent = await bot.telegram.sendMessage(telegramId, `[${senderUser.pseudonym}]: ${text}`, options);
      saveBroadcastMessage(messageDbId, telegramId, sent.message_id);
    } catch (e) {
      console.warn(`Не удалось доставить сообщение ${telegramId}: ${e.message}`);
    }
  }

  return messageDbId;
}

function registerBroadcastHandler(bot) {
  bot.on('text', async (ctx) => {
    const user = ctx.state.user;
    const text = ctx.message.text.trim();
    const senderMessageId = ctx.message.message_id;

    // Проверить, является ли сообщение ответом (реплаем)
    const replyToMsgId = ctx.message.reply_to_message
      ? ctx.message.reply_to_message.message_id
      : null;

    const messageDbId = await broadcastMessage(bot, ctx.from.id, user, text, replyToMsgId);

    // Сохранить message_id отправителя, чтобы на его сообщение тоже могли ответить
    saveBroadcastMessage(messageDbId, ctx.from.id, senderMessageId);
  });
}

module.exports = { registerBroadcastHandler };
