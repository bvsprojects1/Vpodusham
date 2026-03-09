require('dotenv').config();
const { Telegraf } = require('telegraf');
const { initDB } = require('./db');
const { registerUserHandlers } = require('./handlers/user');
const { registerBroadcastHandler } = require('./handlers/broadcast');
const { moderatorMiddleware } = require('./middleware/moderator');
const { registerModeratorHandlers } = require('./handlers/moderator');

const bot = new Telegraf(process.env.BOT_TOKEN);

initDB();

// Проверка что бот запустился + регистрация команд в меню Telegram
bot.telegram.getMe().then((botInfo) => {
  console.log(`Бот запущен: @${botInfo.username}`);
});

bot.telegram.setMyCommands([
  { command: 'start',  description: 'Войти в чат' },
  { command: 'nick',   description: 'Сменить псевдоним' },
  { command: 'who',    description: 'Узнать свой текущий ник' },
  { command: 'leave',  description: 'Покинуть чат' },
  { command: 'help',   description: 'Список команд' },
]);

// Глобальный middleware — проставляет ctx.state.isModerator для всех запросов
bot.use(moderatorMiddleware);

registerModeratorHandlers(bot);
registerUserHandlers(bot);
registerBroadcastHandler(bot);

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch();
console.log('Запуск бота...');
