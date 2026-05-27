// database.js
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db;

async function initDB() {
  db = await open({
    filename: path.join(__dirname, 'database.db'),
    driver: sqlite3.Database
  });

  // Таблица пользователей (все, кто когда-либо заходил)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL,
      can_invite INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Таблица приглашений
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      invited_id TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (invited_id) REFERENCES users(discord_id),
      FOREIGN KEY (inviter_id) REFERENCES users(discord_id)
    )
  `);

  console.log('✅ База данных инициализирована');
  return db;
}

async function canUserInvite(userId) {
  const user = await db.get('SELECT can_invite FROM users WHERE discord_id = ?', userId);
  return user ? user.can_invite === 1 : false;
}

async function registerNewUser(userId, joinTime) {
  const existing = await db.get('SELECT discord_id FROM users WHERE discord_id = ?', userId);
  if (existing) {
    return false;
  }
  await db.run(
    'INSERT INTO users (discord_id, first_seen, can_invite) VALUES (?, ?, 1)',
    userId, joinTime
  );
  return true;
}

async function markExistingAsOld(memberIds) {
  for (const id of memberIds) {
    const existing = await db.get('SELECT discord_id FROM users WHERE discord_id = ?', id);
    if (!existing) {
      await db.run(
        'INSERT INTO users (discord_id, first_seen, can_invite) VALUES (?, ?, 0)',
        id, Date.now()
      );
    } else {
      await db.run('UPDATE users SET can_invite = 0 WHERE discord_id = ?', id);
    }
  }
  console.log(`✅ Помечено ${memberIds.length} существующих участников как "старые"`);
}

async function saveReferral(invitedId, inviterId) {
  const exists = await db.get('SELECT invited_id FROM referrals WHERE invited_id = ?', invitedId);
  if (exists) {
    return false;
  }
  await db.run(
    'INSERT INTO referrals (invited_id, inviter_id, status, created_at) VALUES (?, ?, ?, ?)',
    invitedId, inviterId, 'pending', Date.now()
  );
  return true;
}

async function getReferral(invitedId) {
  return db.get('SELECT * FROM referrals WHERE invited_id = ?', invitedId);
}

async function completeReferral(invitedId) {
  await db.run(
    'UPDATE referrals SET status = ?, completed_at = ? WHERE invited_id = ?',
    'completed', Date.now(), invitedId
  );
}

async function hasSentInvite(userId) {
  const ref = await db.get('SELECT invited_id FROM referrals WHERE invited_id = ?', userId);
  return !!ref;
}

async function deleteReferral(invitedId) {
  await db.run('DELETE FROM referrals WHERE invited_id = ?', invitedId);
}

async function getUserStats(userId) {
  const invited = await db.all('SELECT * FROM referrals WHERE inviter_id = ?', userId);
  const completed = invited.filter(r => r.status === 'completed');
  return {
    total: invited.length,
    completed: completed.length
  };
}

module.exports = {
  initDB,
  canUserInvite,
  registerNewUser,
  markExistingAsOld,
  saveReferral,
  getReferral,
  completeReferral,
  hasSentInvite,
  deleteReferral,
  getUserStats,
  getDb: () => db
};