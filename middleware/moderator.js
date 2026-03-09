// Список ID модераторов из .env (через запятую)
const moderatorIds = (process.env.MODERATOR_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function isModerator(telegramId) {
  return moderatorIds.includes(String(telegramId));
}

// Добавляет ctx.state.isModerator для всех обработчиков
function moderatorMiddleware(ctx, next) {
  ctx.state.isModerator = isModerator(ctx.from?.id);
  return next();
}

// Блокирует доступ не-модераторам
function requireModerator(ctx, next) {
  if (!ctx.state.isModerator) {
    return ctx.reply('Команда недоступна.');
  }
  return next();
}

module.exports = { moderatorMiddleware, requireModerator, isModerator };
