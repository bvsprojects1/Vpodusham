const RATE_LIMIT_MS = 2000; // 2 секунды между сообщениями

const lastMessageTime = new Map();

function checkRateLimit(telegramId) {
  const now = Date.now();
  const last = lastMessageTime.get(telegramId) || 0;

  if (now - last < RATE_LIMIT_MS) {
    return false; // слишком быстро
  }

  lastMessageTime.set(telegramId, now);
  return true; // ок
}

function rateLimitMiddleware(ctx, next) {
  const telegramId = ctx.from.id;

  if (!checkRateLimit(telegramId)) {
    return ctx.reply('Не так быстро, подождите немного.');
  }

  return next();
}

module.exports = { rateLimitMiddleware };
