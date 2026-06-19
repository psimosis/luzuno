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
  for (const statement of [
    "ALTER TABLE user_settings ADD COLUMN company_name VARCHAR(255) NULL",
    "ALTER TABLE user_settings ADD COLUMN cuit VARCHAR(80) NULL",
    "ALTER TABLE user_settings ADD COLUMN address VARCHAR(255) NULL",
    "ALTER TABLE user_settings ADD COLUMN phone VARCHAR(80) NULL",
    "ALTER TABLE user_settings ADD COLUMN contact_person VARCHAR(255) NULL",
    "ALTER TABLE user_settings ADD COLUMN contact_email VARCHAR(255) NULL",
    "ALTER TABLE user_settings ADD COLUMN margin_percent DECIMAL(8,2) NOT NULL DEFAULT 0",
    "ALTER TABLE user_settings ADD COLUMN cost_per_minute_usd DECIMAL(10,4) NOT NULL DEFAULT 0"
  ]) {
    await db.query(statement).catch((error) => {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    });
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(128) NOT NULL,
      period_year INT NOT NULL,
      period_month INT NOT NULL,
      invoice_type VARCHAR(4) NOT NULL,
      invoice_number VARCHAR(80) NOT NULL,
      pdf_blob MEDIUMBLOB NOT NULL,
      snapshot_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_final_invoice (user_id, period_year, period_month, invoice_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_concepts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(128) NOT NULL,
      description VARCHAR(255) NOT NULL,
      amount_usd DECIMAL(12,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_billing_concepts_user (user_id)
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
  await db.query("ALTER TABLE agent_settings ADD COLUMN profile_image_path VARCHAR(512) NULL").catch((error) => {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  });
  await db.query("ALTER TABLE agent_settings ADD COLUMN profile_image_prompt TEXT NULL").catch((error) => {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  });
  await db.query("ALTER TABLE agent_settings ADD COLUMN profile_image_style VARCHAR(40) NULL").catch((error) => {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  });
  for (const statement of [
    "ALTER TABLE agent_settings ADD COLUMN role_title VARCHAR(255) NULL",
    "ALTER TABLE agent_settings ADD COLUMN department VARCHAR(255) NULL",
    "ALTER TABLE agent_settings ADD COLUMN contact_email VARCHAR(255) NULL",
    "ALTER TABLE agent_settings ADD COLUMN contact_phone VARCHAR(80) NULL",
    "ALTER TABLE agent_settings ADD COLUMN country VARCHAR(80) NULL",
    "ALTER TABLE agent_settings ADD COLUMN gender VARCHAR(40) NULL",
    "ALTER TABLE agent_settings ADD COLUMN voice_id VARCHAR(128) NULL",
    "ALTER TABLE agent_settings ADD COLUMN voice_name VARCHAR(255) NULL"
  ]) {
    await db.query(statement).catch((error) => {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    });
  }
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
    "SELECT user_id, username, email, company_name, cuit, address, phone, contact_person, contact_email, margin_percent, cost_per_minute_usd, api_key_last4, updated_at FROM user_settings ORDER BY COALESCE(company_name, username), username"
  );
  return rows;
}

export async function saveClientDetails(userId, values) {
  await getPool().execute(
    `INSERT INTO user_settings (user_id, username, email, company_name, cuit, address, phone, contact_person, contact_email)
     VALUES (:user_id, :username, :email, :company_name, :cuit, :address, :phone, :contact_person, :contact_email)
     ON DUPLICATE KEY UPDATE username = VALUES(username),
       email = VALUES(email),
       company_name = VALUES(company_name),
       cuit = VALUES(cuit),
       address = VALUES(address),
       phone = VALUES(phone),
       contact_person = VALUES(contact_person),
       contact_email = VALUES(contact_email)`,
    {
      user_id: userId,
      username: values.username,
      email: values.email || null,
      company_name: values.company_name || null,
      cuit: values.cuit || null,
      address: values.address || null,
      phone: values.phone || null,
      contact_person: values.contact_person || null,
      contact_email: values.contact_email || null
    }
  );
}

export async function saveClientBillingSettings(userId, values) {
  await getPool().execute(
    "UPDATE user_settings SET margin_percent = ?, cost_per_minute_usd = ? WHERE user_id = ?",
    [Number(values.margin_percent || 0), Number(values.cost_per_minute_usd || 0), userId]
  );
}

export async function listBillingConcepts(userId) {
  const [rows] = await getPool().execute(
    "SELECT id, user_id, description, amount_usd, created_at FROM billing_concepts WHERE user_id = ? ORDER BY created_at ASC, id ASC",
    [userId]
  );
  return rows;
}

export async function addBillingConcept(userId, description, amountUsd) {
  await getPool().execute(
    "INSERT INTO billing_concepts (user_id, description, amount_usd) VALUES (?, ?, ?)",
    [userId, description, Number(amountUsd || 0)]
  );
}

export async function deleteBillingConcept(userId, conceptId) {
  await getPool().execute(
    "DELETE FROM billing_concepts WHERE user_id = ? AND id = ?",
    [userId, conceptId]
  );
}

export async function listBillingInvoices(userId) {
  const [rows] = await getPool().execute(
    `SELECT id, user_id, period_year, period_month, invoice_type, invoice_number, created_at
     FROM billing_invoices WHERE user_id = ?
     ORDER BY period_year DESC, period_month DESC, created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getBillingInvoice(id, userId) {
  const [rows] = await getPool().execute(
    "SELECT * FROM billing_invoices WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  return rows[0] || null;
}

export async function findBillingInvoice(userId, year, month, type = "A") {
  const [rows] = await getPool().execute(
    "SELECT * FROM billing_invoices WHERE user_id = ? AND period_year = ? AND period_month = ? AND invoice_type = ?",
    [userId, year, month, type]
  );
  return rows[0] || null;
}

export async function createBillingInvoice({ userId, year, month, type, invoiceNumber, pdf, snapshot }) {
  await getPool().execute(
    `INSERT INTO billing_invoices (user_id, period_year, period_month, invoice_type, invoice_number, pdf_blob, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, year, month, type, invoiceNumber, pdf, JSON.stringify(snapshot || {})]
  );
  return findBillingInvoice(userId, year, month, type);
}

export async function saveAgentSettings(userId, agentId, values) {
  await getPool().execute(
    `INSERT INTO agent_settings (user_id, agent_id, display_name, notes, system_prompt, patch_template, profile_image_path, profile_image_prompt, profile_image_style, role_title, department, contact_email, contact_phone, country, gender, voice_id, voice_name)
     VALUES (:user_id, :agent_id, :display_name, :notes, :system_prompt, :patch_template, :profile_image_path, :profile_image_prompt, :profile_image_style, :role_title, :department, :contact_email, :contact_phone, :country, :gender, :voice_id, :voice_name)
     ON DUPLICATE KEY UPDATE display_name = COALESCE(VALUES(display_name), display_name),
       notes = COALESCE(VALUES(notes), notes),
       system_prompt = COALESCE(VALUES(system_prompt), system_prompt),
       patch_template = COALESCE(VALUES(patch_template), patch_template),
       profile_image_path = COALESCE(VALUES(profile_image_path), profile_image_path),
       profile_image_prompt = COALESCE(VALUES(profile_image_prompt), profile_image_prompt),
       profile_image_style = COALESCE(VALUES(profile_image_style), profile_image_style),
       role_title = COALESCE(VALUES(role_title), role_title),
       department = COALESCE(VALUES(department), department),
       contact_email = COALESCE(VALUES(contact_email), contact_email),
       contact_phone = COALESCE(VALUES(contact_phone), contact_phone),
       country = COALESCE(VALUES(country), country),
       gender = COALESCE(VALUES(gender), gender),
       voice_id = COALESCE(VALUES(voice_id), voice_id),
       voice_name = COALESCE(VALUES(voice_name), voice_name)`,
    {
      user_id: userId,
      agent_id: agentId,
      display_name: values.display_name ?? null,
      notes: values.notes ?? null,
      system_prompt: values.system_prompt ?? null,
      patch_template: values.patch_template ?? null,
      profile_image_path: values.profile_image_path ?? null,
      profile_image_prompt: values.profile_image_prompt ?? null,
      profile_image_style: values.profile_image_style ?? null,
      role_title: values.role_title ?? null,
      department: values.department ?? null,
      contact_email: values.contact_email ?? null,
      contact_phone: values.contact_phone ?? null,
      country: values.country ?? null,
      gender: values.gender ?? null,
      voice_id: values.voice_id ?? null,
      voice_name: values.voice_name ?? null
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

export async function listAgentSettingsForUser(userId) {
  const [rows] = await getPool().execute(
    "SELECT agent_id, profile_image_path, profile_image_prompt, role_title, department, contact_email, contact_phone, country, gender FROM agent_settings WHERE user_id = ?",
    [userId]
  );
  return rows;
}

export async function saveAgentProfileImage(userId, agentId, imagePath, prompt, style) {
  await saveAgentSettings(userId, agentId, {
    display_name: null,
    notes: null,
    system_prompt: null,
    patch_template: null,
    profile_image_path: imagePath,
    profile_image_prompt: prompt,
    profile_image_style: style
  });
}

export async function saveAgentPersonaDetails(userId, agentId, values) {
  await saveAgentSettings(userId, agentId, {
    display_name: null,
    notes: null,
    system_prompt: null,
    patch_template: null,
    profile_image_path: null,
    profile_image_prompt: null,
    profile_image_style: null,
    role_title: values.role_title,
    department: values.department,
    contact_email: values.contact_email,
    contact_phone: values.contact_phone,
    country: values.country,
    gender: values.gender
  });
}

export async function saveAgentVoice(userId, agentId, voiceId, voiceName) {
  await saveAgentSettings(userId, agentId, {
    display_name: null,
    notes: null,
    system_prompt: null,
    patch_template: null,
    profile_image_path: null,
    profile_image_prompt: null,
    profile_image_style: null,
    voice_id: voiceId,
    voice_name: voiceName
  });
}
