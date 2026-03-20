const { requireModerator } = require('../middleware/moderator');
const { getAllActiveUsers, getUsersList, findUserById, findUserByPseudonym, banUser, unbanUser, warnUser, getWarningsCount, getLastMessagesByUser, getBroadcastMessages, markMessageDeleted } = require('../db');

const MOD_PSEUDONYM = process.env.MOD_PSEUDONYM || 'Модератор';

// Модераторы, ожидающие ввода текста для рассылки всем
const awaitingModBroadcast = new Set();

// Шаг 1: модератор вводит псевдоним получателя
const awaitingModDmTarget = new Set();

// Шаг 2: модератор вводит текст сообщения → moderatorId → targetUserId
const awaitingModDm = new Map();

async function sendToAll(bot, text, excludeId = null) {
  const users = getAllActiveUsers();
  for (const user of users) {
    if (excludeId && String(user.telegram_id) === String(excludeId)) continue;
    try {
      await bot.telegram.sendMessage(user.telegram_id, `[${MOD_PSEUDONYM}]: ${text}`);
    } catch (e) {
      console.warn(`Не удалось доставить сообщение ${user.pseudonym}: ${e.message}`);
    }
  }
}

function registerModeratorHandlers(bot) {
  // /ban <псевдоним> [часы] — забанить пользователя
  bot.command('ban', requireModerator, async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      return ctx.reply('Использование: /ban <псевдоним> [часы]\nПример: /ban Grom 24\nБез часов — бан навсегда.');
    }

    // Сначала пробуем весь текст как псевдоним (приоритет у точного ника)
    const fullText = args.join(' ');
    let target = findUserByPseudonym(fullText);
    let pseudonym, hours;

    if (target) {
      // Весь текст — это ник (например "Прогер 24"), бан навсегда
      pseudonym = fullText;
      hours = null;
    } else {
      // Если не нашли, пробуем последний аргумент как часы
      const lastArg = args[args.length - 1];
      const lastIsNumber = args.length > 1 && /^\d+$/.test(lastArg) && parseInt(lastArg) > 0;

      if (lastIsNumber) {
        pseudonym = args.slice(0, -1).join(' ');
        target = findUserByPseudonym(pseudonym);
        hours = target ? parseInt(lastArg) : null;
      }

      if (!target) {
        // Ни полный текст, ни без последнего слова не дали результат
        return ctx.reply(`Пользователь [${fullText}] не найден.`);
      }
    }

    banUser(pseudonym, hours);

    const durationText = hours ? `на ${hours} ч.` : 'навсегда';

    // Уведомить забаненного
    try {
      await bot.telegram.sendMessage(
        target.telegram_id,
        `Вы получили бан в этом чате ${durationText}.`
      );
    } catch (e) { /* пользователь заблокировал бота */ }

    // Уведомить чат
    await sendToAll(bot, `[${pseudonym}] был удалён из чата ${durationText}.`);

    console.log(`[BAN] [${pseudonym}] ${durationText}`);
    ctx.reply(`Пользователь [${pseudonym}] заблокирован ${durationText}.`);
  });

  // /del <псевдоним> [количество] — удалить последние сообщения пользователя у всех
  bot.command('del', requireModerator, async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      return ctx.reply('Использование: /del <псевдоним> [количество]\nПример: /del Grom 5\nБез количества — удалит последнее сообщение.');
    }

    // Аналогично /ban: сначала проверяем весь текст как ник
    const fullText = args.join(' ');
    let target = findUserByPseudonym(fullText);
    let pseudonym, count;

    if (target) {
      pseudonym = fullText;
      count = 1;
    } else {
      const lastArg = args[args.length - 1];
      const lastIsNumber = args.length > 1 && /^\d+$/.test(lastArg) && parseInt(lastArg) > 0;

      if (lastIsNumber) {
        pseudonym = args.slice(0, -1).join(' ');
        target = findUserByPseudonym(pseudonym);
        count = target ? parseInt(lastArg) : null;
      }

      if (!target) {
        return ctx.reply(`Пользователь [${fullText}] не найден.`);
      }
    }

    const messages = getLastMessagesByUser(target.id, count);
    if (messages.length === 0) {
      return ctx.reply(`У [${pseudonym}] нет сообщений для удаления.`);
    }

    let deleted = 0;
    for (const msg of messages) {
      const copies = getBroadcastMessages(msg.id);
      for (const copy of copies) {
        try {
          await bot.telegram.deleteMessage(copy.chat_id, copy.message_id);
          deleted++;
        } catch (e) {
          // Сообщение уже удалено или слишком старое
        }
      }
      markMessageDeleted(msg.id);
    }

    console.log(`[DEL] [${pseudonym}]: удалено ${messages.length} сообщ., ${deleted} копий`);
    ctx.reply(`Удалено ${messages.length} сообщ. от [${pseudonym}] (${deleted} копий из чатов).`);
  });

  // /warn <псевдоним> | <причина>
  bot.command('warn', requireModerator, async (ctx) => {
    const rawArgs = ctx.message.text.split(' ').slice(1).join(' ');
    const separatorIndex = rawArgs.indexOf('|');

    let pseudonym, reason;
    if (separatorIndex !== -1) {
      pseudonym = rawArgs.slice(0, separatorIndex).trim();
      reason = rawArgs.slice(separatorIndex + 1).trim();
    } else {
      // Обратная совместимость: первое слово — псевдоним, остальное — причина
      const parts = rawArgs.split(' ');
      pseudonym = parts[0];
      reason = parts.slice(1).join(' ');
    }

    if (!pseudonym || !reason) {
      return ctx.reply('Использование: /warn <псевдоним> | <причина>\nПример: /warn Grom | оскорбления\nДля ников с пробелами используйте | как разделитель.');
    }

    const target = findUserByPseudonym(pseudonym);
    if (!target) {
      return ctx.reply(`Пользователь [${pseudonym}] не найден.`);
    }

    warnUser(target.id, reason);
    const count = getWarningsCount(target.id);

    // Уведомить пользователя
    try {
      await bot.telegram.sendMessage(
        target.telegram_id,
        `Предупреждение от модератора: ${reason}\n(предупреждений: ${count}/3)`
      );
    } catch (e) { /* пользователь заблокировал бота */ }

    // Автобан на 3-м предупреждении
    if (count >= 3) {
      banUser(pseudonym, null);
      try {
        await bot.telegram.sendMessage(
          target.telegram_id,
          'Вы получили бан в этом чате навсегда (3 предупреждения).'
        );
      } catch (e) { /* игнорируем */ }
      await sendToAll(bot, `[${pseudonym}] был удалён из чата навсегда.`);
      console.log(`[AUTOBAN] [${pseudonym}] — 3 предупреждения`);
      return ctx.reply(`[${pseudonym}] автоматически заблокирован (3 предупреждения).`);
    }

    console.log(`[WARN ${count}/3] [${pseudonym}]: ${reason}`);
    ctx.reply(`Предупреждение выдано [${pseudonym}] (${count}/3). Причина: ${reason}`);
  });

  // /unban <псевдоним>
  bot.command('unban', requireModerator, async (ctx) => {
    const pseudonym = ctx.message.text.split(' ').slice(1).join(' ');

    if (!pseudonym) {
      return ctx.reply('Использование: /unban <псевдоним>');
    }

    const target = findUserByPseudonym(pseudonym);
    if (!target) {
      return ctx.reply(`Пользователь [${pseudonym}] не найден.`);
    }

    if (!target.is_banned) {
      return ctx.reply(`Пользователь [${pseudonym}] не заблокирован.`);
    }

    unbanUser(pseudonym);

    try {
      await bot.telegram.sendMessage(
        target.telegram_id,
        'Ваш бан снят. Можете вернуться через /start'
      );
    } catch (e) { /* пользователь заблокировал бота */ }

    console.log(`[UNBAN] [${pseudonym}]`);
    ctx.reply(`Бан с [${pseudonym}] снят.`);
  });

  // /mod — открыть панель модератора
  bot.command('mod', requireModerator, (ctx) => {
    ctx.reply('Панель модератора:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Написать всем', callback_data: 'mod_broadcast' }],
          [{ text: 'Список участников', callback_data: 'mod_list' }],
          [{ text: 'Написать пользователю', callback_data: 'mod_dm' }],
        ],
      },
    });
  });

  // Кнопка "Написать всем"
  bot.action('mod_broadcast', requireModerator, (ctx) => {
    ctx.answerCbQuery();
    awaitingModBroadcast.add(ctx.from.id);
    ctx.reply(`Введите сообщение — оно придёт всем участникам как [${MOD_PSEUDONYM}]:`);
  });

  // Кнопка "Список участников"
  bot.action('mod_list', requireModerator, (ctx) => {
    ctx.answerCbQuery();
    const users = getUsersList();

    if (users.length === 0) {
      return ctx.reply('Нет активных участников.');
    }

    const lines = users.map((u, i) => {
      const date = u.joined_at.slice(0, 10);
      return `${i + 1}. [${u.pseudonym}] — с ${date}, сообщений: ${u.message_count}`;
    });

    ctx.reply(lines.join('\n'));
  });

  // Кнопка "Написать пользователю" — шаг 1: запросить псевдоним
  bot.action('mod_dm', requireModerator, (ctx) => {
    ctx.answerCbQuery();
    awaitingModDmTarget.add(ctx.from.id);
    ctx.reply('Введите псевдоним пользователя:');
  });

  // Перехват текстовых сообщений модератора
  bot.on('text', async (ctx, next) => {
    if (!ctx.state.isModerator) return next();

    const text = ctx.message.text.trim();

    // Рассылка всем
    if (awaitingModBroadcast.has(ctx.from.id)) {
      awaitingModBroadcast.delete(ctx.from.id);
      await sendToAll(bot, text, ctx.from.id);
      console.log(`[MOD BROADCAST] [${MOD_PSEUDONYM}]: ${text}`);
      return ctx.reply(`Сообщение отправлено всем как [${MOD_PSEUDONYM}].`);
    }

    // Шаг 1 DM: модератор ввёл псевдоним получателя
    if (awaitingModDmTarget.has(ctx.from.id)) {
      awaitingModDmTarget.delete(ctx.from.id);
      const target = findUserByPseudonym(text);

      if (!target || !target.is_active) {
        return ctx.reply(`Пользователь [${text}] не найден или не в чате.\nПопробуйте снова через /mod`);
      }

      awaitingModDm.set(ctx.from.id, target.id);
      return ctx.reply(`Введите сообщение для [${target.pseudonym}]:`);
    }

    // Шаг 2 DM: модератор ввёл текст сообщения
    if (awaitingModDm.has(ctx.from.id)) {
      const targetUserId = awaitingModDm.get(ctx.from.id);
      awaitingModDm.delete(ctx.from.id);

      const target = findUserById(targetUserId);
      if (!target) {
        return ctx.reply('Пользователь не найден.');
      }

      try {
        await bot.telegram.sendMessage(target.telegram_id, `Сообщение от модератора: ${text}`);
        console.log(`[MOD DM → ${target.pseudonym}]: ${text}`);
        return ctx.reply(`Сообщение доставлено [${target.pseudonym}].`);
      } catch (e) {
        return ctx.reply('Не удалось доставить: пользователь заблокировал бота.');
      }
    }

    // Нет активного режима
    return ctx.reply('Используйте /mod для открытия панели управления.');
  });
}

module.exports = { registerModeratorHandlers, sendToAll };
