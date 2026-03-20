const Database = require('better-sqlite3');

const db = new Database('chat.db');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      pseudonym TEXT UNIQUE NOT NULL,
      is_banned INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      joined_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      is_deleted INTEGER DEFAULT 0,
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_db_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      FOREIGN KEY (message_db_id) REFERENCES messages(id)
    );
  `);

  // Миграция: добавить ban_until если колонки ещё нет
  const columns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!columns.includes('ban_until')) {
    db.exec('ALTER TABLE users ADD COLUMN ban_until TEXT DEFAULT NULL');
  }

  console.log('БД инициализирована: chat.db');
}

function findUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findUserByPseudonym(pseudonym) {
  return db.prepare('SELECT * FROM users WHERE pseudonym = ?').get(pseudonym);
}

function createUser(telegramId, pseudonym) {
  const stmt = db.prepare(
    'INSERT INTO users (telegram_id, pseudonym) VALUES (?, ?)'
  );
  stmt.run(String(telegramId), pseudonym);
  return findUser(telegramId);
}

function getAllActiveUsers() {
  return db.prepare(
    'SELECT * FROM users WHERE is_active = 1 AND is_banned = 0'
  ).all();
}

function getUsersList() {
  return db.prepare(`
    SELECT u.id, u.pseudonym, u.joined_at,
           COUNT(m.id) AS message_count
    FROM users u
    LEFT JOIN messages m ON m.user_id = u.id AND m.is_deleted = 0
    WHERE u.is_active = 1
    GROUP BY u.id
    ORDER BY u.joined_at ASC
  `).all();
}

function saveMessage(userId, text) {
  const stmt = db.prepare(
    'INSERT INTO messages (user_id, text) VALUES (?, ?)'
  );
  return stmt.run(userId, text);
}

function updatePseudonym(telegramId, newPseudonym) {
  db.prepare('UPDATE users SET pseudonym = ? WHERE telegram_id = ?')
    .run(newPseudonym, String(telegramId));
}

function warnUser(userId, reason) {
  db.prepare('INSERT INTO warnings (user_id, reason) VALUES (?, ?)').run(userId, reason);
}

function getWarningsCount(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM warnings WHERE user_id = ?').get(userId).count;
}

// hours = null означает постоянный бан
function banUser(pseudonym, hours = null) {
  const banUntil = hours
    ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    : null;
  db.prepare('UPDATE users SET is_banned = 1, ban_until = ? WHERE pseudonym = ?')
    .run(banUntil, pseudonym);
}

function unbanUser(pseudonym) {
  db.prepare('UPDATE users SET is_banned = 0, ban_until = NULL WHERE pseudonym = ?')
    .run(pseudonym);
}

// Проверить истёк ли бан и снять его автоматически
function checkAndExpireBan(user) {
  if (!user.is_banned || !user.ban_until) return user;
  if (new Date(user.ban_until) <= new Date()) {
    unbanUser(user.pseudonym);
    return { ...user, is_banned: 0, ban_until: null };
  }
  return user;
}

function saveBroadcastMessage(messageDbId, chatId, messageId) {
  db.prepare('INSERT INTO broadcast_messages (message_db_id, chat_id, message_id) VALUES (?, ?, ?)')
    .run(messageDbId, String(chatId), messageId);
}

function getLastMessagesByUser(userId, count = 1) {
  return db.prepare(
    'SELECT * FROM messages WHERE user_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT ?'
  ).all(userId, count);
}

function getBroadcastMessages(messageDbId) {
  return db.prepare('SELECT * FROM broadcast_messages WHERE message_db_id = ?').all(messageDbId);
}

function findBroadcastByChatAndMessage(chatId, messageId) {
  return db.prepare(
    'SELECT * FROM broadcast_messages WHERE chat_id = ? AND message_id = ?'
  ).get(String(chatId), messageId);
}

function markMessageDeleted(messageDbId) {
  db.prepare('UPDATE messages SET is_deleted = 1 WHERE id = ?').run(messageDbId);
}

function deactivateUser(telegramId) {
  db.prepare('UPDATE users SET is_active = 0 WHERE telegram_id = ?')
    .run(String(telegramId));
}

function reactivateUser(telegramId) {
  db.prepare('UPDATE users SET is_active = 1 WHERE telegram_id = ?')
    .run(String(telegramId));
}

module.exports = { initDB, findUser, findUserById, findUserByPseudonym, createUser, getAllActiveUsers, getUsersList, saveMessage, updatePseudonym, warnUser, getWarningsCount, banUser, unbanUser, checkAndExpireBan, deactivateUser, reactivateUser, saveBroadcastMessage, getLastMessagesByUser, getBroadcastMessages, markMessageDeleted, findBroadcastByChatAndMessage };
