import crypto from "node:crypto";
import mysql from "mysql2/promise";

let pool;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "mysql",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "agents_panel",
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "agents_panel",
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
  }
  return pool;
}

export async function migrate() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id VARCHAR(128) PRIMARY KEY,
      username VARCHAR(190) NOT NULL,
      email VARCHAR(255) NULL,
      eleven_api_key_enc TEXT NULL,
      api_key_last4 VARCHAR(12) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_settings (
      user_id VARCHAR(128) NOT NULL,
      agent_id VARCHAR(128) NOT NULL,
      display_name VARCHAR(255) NULL,
      notes TEXT NULL,
      system_prompt TEXT NULL,
      patch_template JSON NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, agent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.query("ALTER TABLE agent_settings ADD COLUMN system_prompt TEXT NULL").catch((error) => {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  });
}

function secretKey() {
  const secret = process.env.APP_SECRET || "dev-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(payload) {
  if (!payload) return null;
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function upsertUserProfile(user) {
  const db = getPool();
  await db.execute(
    `INSERT INTO user_settings (user_id, username, email)
     VALUES (:user_id, :username, :email)
     ON DUPLICATE KEY UPDATE username = VALUES(username), email = VALUES(email)`,
    {
      user_id: user.sub,
      username: user.preferred_username || user.name || user.email || user.sub,
      email: user.email || null
    }
  );
}

export async function setApiKeyForUser(userId, username, email, apiKey) {
  const db = getPool();
  await db.execute(
    `INSERT INTO user_settings (user_id, username, email, eleven_api_key_enc, api_key_last4)
     VALUES (:user_id, :username, :email, :enc, :last4)
     ON DUPLICATE KEY UPDATE username = VALUES(username), email = VALUES(email),
       eleven_api_key_enc = VALUES(eleven_api_key_enc), api_key_last4 = VALUES(api_key_last4)`,
    {
      user_id: userId,
      username,
      email: email || null,
      enc: encrypt(apiKey),
      last4: apiKey ? apiKey.slice(-4) : null
    }
  );
}

export async function clearApiKeyForUser(userId) {
  await getPool().execute(
    "UPDATE user_settings SET eleven_api_key_enc = NULL, api_key_last4 = NULL WHERE user_id = ?",
    [userId]
  );
}

export async function getUserSettings(userId) {
  const [rows] = await getPool().execute("SELECT * FROM user_settings WHERE user_id = ?", [userId]);
  return rows[0] || null;
}

export async function getApiKey(userId) {
  const settings = await getUserSettings(userId);
  return settings ? decrypt(settings.eleven_api_key_enc) : null;
}

export async function listUserSettings() {
  const [rows] = await getPool().query(
    "SELECT user_id, username, email, api_key_last4, updated_at FROM user_settings ORDER BY username"
  );
  return rows;
}

export async function saveAgentSettings(userId, agentId, values) {
  await getPool().execute(
    `INSERT INTO agent_settings (user_id, agent_id, display_name, notes, system_prompt, patch_template)
     VALUES (:user_id, :agent_id, :display_name, :notes, :system_prompt, :patch_template)
     ON DUPLICATE KEY UPDATE display_name = COALESCE(VALUES(display_name), display_name),
       notes = COALESCE(VALUES(notes), notes),
       system_prompt = COALESCE(VALUES(system_prompt), system_prompt),
       patch_template = COALESCE(VALUES(patch_template), patch_template)`,
    {
      user_id: userId,
      agent_id: agentId,
      display_name: values.display_name ?? null,
      notes: values.notes ?? null,
      system_prompt: values.system_prompt ?? null,
      patch_template: values.patch_template ?? null
    }
  );
}

export async function getAgentSettings(userId, agentId) {
  const [rows] = await getPool().execute(
    "SELECT * FROM agent_settings WHERE user_id = ? AND agent_id = ?",
    [userId, agentId]
  );
  return rows[0] || {};
}
