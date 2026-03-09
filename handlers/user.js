const { findUser, createUser, updatePseudonym, getAllActiveUsers, deactivateUser, reactivateUser, checkAndExpireBan } = require('../db');
const { rateLimitMiddleware } = require('../middleware/rateLimit');

// Храним telegram_id пользователей, которые сейчас выбирают псевдоним
const awaitingPseudonym = new Set();

function validatePseudonym(name) {
  if (name.length < 2 || name.length > 20) {
    return 'Псевдоним должен быть от 2 до 20 символов.';
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\- ]+$/.test(name)) {
    return 'Псевдоним может содержать только буквы, цифры, пробел, _ и -.';
  }
  return null;
}

function registerUserHandlers(bot) {
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const user = findUser(telegramId);

    if (user) {
      if (!user.is_active) {
        reactivateUser(telegramId);
        return ctx.reply(`Добро пожаловать назад, ${user.pseudonym}! Вы снова в чате.`);
      }
      return ctx.reply(`Добро пожаловать назад, ${user.pseudonym}!`);
    }

    awaitingPseudonym.add(telegramId);
    ctx.reply('Придумайте псевдоним для чата (от 2 до 20 символов):');
  });

  // Обработка ввода псевдонима
  bot.on('text', (ctx, next) => {
    const telegramId = ctx.from.id;

    if (!awaitingPseudonym.has(telegramId)) {
      return next(); // не в режиме выбора ника — передаём дальше
    }

    const pseudonym = ctx.message.text.trim();

    // Валидация
    const error = validatePseudonym(pseudonym);
    if (error) {
      return ctx.reply(`${error}\nПопробуйте ещё раз:`);
    }

    // Проверка уникальности
    try {
      createUser(telegramId, pseudonym);
    } catch (e) {
      // UNIQUE constraint — псевдоним занят
      return ctx.reply('Этот псевдоним уже занят. Придумайте другой:');
    }

    awaitingPseudonym.delete(telegramId);
    ctx.reply(`Вы вошли как ${pseudonym}. Теперь можете писать в чат!`);
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      'Доступные команды:\n\n' +
      '/start — войти в чат\n' +
      '/nick <псевдоним> — сменить псевдоним\n' +
      '/who — узнать свой текущий ник\n' +
      '/leave — покинуть чат'
    );
  });

  bot.command('who', (ctx) => {
    const user = findUser(ctx.from.id);

    if (!user) {
      return ctx.reply('Сначала войдите через /start');
    }

    const date = user.joined_at.slice(0, 10); // YYYY-MM-DD
    ctx.reply(`Вы в чате как [${user.pseudonym}] с ${date}`);
  });

  bot.command('nick', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = findUser(telegramId);

    if (!user) {
      return ctx.reply('Сначала войдите через /start');
    }

    const newPseudonym = ctx.message.text.replace('/nick', '').trim();

    if (!newPseudonym) {
      return ctx.reply('Укажите псевдоним: /nick НовыйНик');
    }

    const error = validatePseudonym(newPseudonym);
    if (error) {
      return ctx.reply(error);
    }

    if (newPseudonym === user.pseudonym) {
      return ctx.reply('Это уже ваш текущий псевдоним.');
    }

    try {
      updatePseudonym(telegramId, newPseudonym);
    } catch (e) {
      return ctx.reply('Этот псевдоним уже занят. Придумайте другой.');
    }

    const oldPseudonym = user.pseudonym;
    const users = getAllActiveUsers();

    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(
          u.telegram_id,
          `[${oldPseudonym}] теперь известен как [${newPseudonym}]`
        );
      } catch (e) {
        console.warn(`Не удалось уведомить ${u.pseudonym}: ${e.message}`);
      }
    }
  });

  bot.command('leave', (ctx) => {
    const user = findUser(ctx.from.id);

    if (!user || !user.is_active) {
      return ctx.reply('Вы и так не в чате. Войдите через /start');
    }

    deactivateUser(ctx.from.id);
    ctx.reply('Вы покинули чат. Вернуться можно через /start');
  });

  // Проверка регистрации и бана перед обработкой обычных сообщений
  bot.on('text', (ctx, next) => {
    // Модераторы обрабатываются в moderator.js раньше — пропускаем
    if (ctx.state.isModerator) return;

    const telegramId = ctx.from.id;
    const user = findUser(telegramId);

    if (!user) {
      return ctx.reply('Сначала войдите через /start');
    }

    if (user.is_banned) {
      const checked = checkAndExpireBan(user);
      if (checked.is_banned) {
        const until = user.ban_until
          ? ` до ${new Date(user.ban_until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
          : ' навсегда';
        return ctx.reply(`Вы заблокированы в этом чате${until}.`);
      }
      // Бан истёк — продолжаем
      ctx.state.user = checked;
    }

    // Прикрепляем пользователя к контексту для следующих обработчиков
    ctx.state.user = user;
    return rateLimitMiddleware(ctx, next);
  });
}

module.exports = { registerUserHandlers, awaitingPseudonym };
