import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import session from "express-session";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { migrate, upsertUserProfile, getUserSettings, getApiKey, setApiKeyForUser, listUserSettings, saveAgentSettings, getAgentSettings, listAgentSettingsForUser, saveAgentProfileImage } from "./db.js";
import { listAgents, getAgent, updateAgent, publishAgent } from "./elevenlabs.js";
import { generateProfileImage } from "./openai-images.js";
import { adminPage, agentDetail, dashboard, loginPage } from "./views.js";
import { supportPage } from "./views.js";
import { authUrl, hasAdminRole, internalIssuer, listUsers, createUser, deleteUser, resetPassword, setUserAdmin, tokenUrl, logoutUrl, oidcIssuer } from "./keycloak.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const clientId = process.env.KEYCLOAK_CLIENT_ID || "agents-panel-web";
const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
const publicUrl = process.env.PUBLIC_URL || "http://192.168.0.115:3000";
const jwks = createRemoteJWKSet(new URL(`${internalIssuer}/protocol/openid-connect/certs`));
const imageDir = process.env.AGENT_IMAGE_DIR || "/app/data/agent-images";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) return callback(null, true);
    return callback(new Error("Formato no soportado. Usa PNG, JPG o WebP."));
  }
});

app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use("/vendor/anam", express.static("node_modules/@anam-ai/js-sdk/dist/umd"));
app.use(express.static("public"));
app.use("/agent-images", express.static(imageDir));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  if (!hasAdminRole(req.session.user)) return res.status(403).send("Acceso solo para Administrador");
  return next();
}

function targetUserId(req) {
  if (!hasAdminRole(req.session.user)) return req.session.user.sub;
  return req.body?.userId || req.query?.userId || req.session.user.sub;
}

function targetUserQuery(req, userId) {
  return hasAdminRole(req.session.user) && userId !== req.session.user.sub
    ? `?userId=${encodeURIComponent(userId)}`
    : "";
}

function supportPresets() {
  return [1, 2, 3]
    .map((index) => ({
      label: process.env[`SUPPORT_PERSONA_${index}_NAME`] || process.env[`PERSONA_${index}_NAME`] || `Soporte ${index}`,
      avatarId: process.env[`SUPPORT_PERSONA_${index}_AVATAR_ID`] || process.env[`PERSONA_${index}_AVATAR_ID`] || "",
      agentId: process.env[`SUPPORT_PERSONA_${index}_AGENT_ID`] || process.env[`PERSONA_${index}_AGENT_ID`] || "",
      previewImage: index === 1 ? "/support-avatar-preview.png" : "/support-avatar-preview.png"
    }))
    .filter((preset) => preset.avatarId && preset.agentId);
}

function publicSupportPresets() {
  return supportPresets().map((preset) => ({
    label: preset.label,
    avatarId: preset.avatarId,
    agentId: preset.agentId,
    previewImage: preset.previewImage
  }));
}

function findSupportPreset(avatarId, agentId) {
  return supportPresets().find((preset) => preset.avatarId === avatarId && preset.agentId === agentId);
}

function systemPromptPatch(systemPrompt) {
  return {
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt
        }
      }
    }
  };
}

function profileStylePrompt(style) {
  const styles = {
    Corporativa: "Corporate executive portrait: business attire, polished office lighting, confident and approachable expression, neutral technology office background.",
    Medicina: "Healthcare professional portrait: clean medical or clinical environment, white coat or healthcare attire, calm trustworthy expression, bright sanitary lighting.",
    Informal: "Informal professional portrait: smart casual clothing, relaxed approachable expression, warm modern workspace background, still realistic and business appropriate.",
    Industrial: "Industrial professional portrait: engineering or operations environment, safety-conscious industrial attire when appropriate, factory or technical facility background."
  };
  return styles[style] || styles.Corporativa;
}

function profileImagePrompt(agent, instructions, style) {
  const name = agent.name || agent.agent_id;
  const requestedDescription = `Generar imagen de una persona humana ficticia corporativa con apariencia realista y la siguiente descripcion: ${instructions}`;
  return [
    `Generate a square corporate profile photo for an AI agent named "${name}".`,
    "The subject must look like a real human being in a professional corporate headshot, but must be completely fictional and not resemble any real identifiable person.",
    "Use photorealistic lighting, realistic skin texture, realistic facial proportions, business attire, and a neutral modern office or technology background.",
    "Do not generate cartoon, caricature, anime, illustration, 3D render, mascot, plastic-looking avatar, fantasy character, painted style, readable text, watermarks, UI mockups, or brand logos.",
    "Style: premium corporate photography, modern artificial intelligence company aesthetic, suitable for a business control panel profile image.",
    `Selected photo style: ${style}. ${profileStylePrompt(style)}`,
    requestedDescription
  ].join("\n");
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function profileImageExtension(mimetype) {
  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  };
  return extensions[mimetype] || "png";
}

async function replaceProfileImage(userId, agentId, imageBuffer, extension, prompt, style) {
  await fs.mkdir(imageDir, { recursive: true });
  const filename = `${safeSegment(userId)}-${safeSegment(agentId)}.${extension}`;
  const imagePath = path.join(imageDir, filename);
  const local = await getAgentSettings(userId, agentId);
  const previousPath = local.profile_image_path ? new URL(local.profile_image_path, publicUrl).pathname : "";
  if (previousPath && previousPath.startsWith("/agent-images/") && path.basename(previousPath) !== filename) {
    await fs.unlink(path.join(imageDir, path.basename(previousPath))).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await fs.writeFile(imagePath, imageBuffer);
  await saveAgentProfileImage(userId, agentId, `/agent-images/${filename}?v=${Date.now()}`, prompt, style);
}

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  return res.send(loginPage());
});

app.get("/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  req.session.oauth = { state, nonce };
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${publicUrl}/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce
  });
  res.redirect(`${authUrl}?${params}`);
});

app.get("/callback", async (req, res, next) => {
  try {
    if (!req.session.oauth || req.query.state !== req.session.oauth.state) {
      return res.status(400).send("Estado OAuth invalido");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: req.query.code,
      redirect_uri: `${publicUrl}/callback`,
      client_id: clientId,
      client_secret: clientSecret
    });
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const tokens = await tokenRes.json();
    const { payload: idPayload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: oidcIssuer,
      audience: clientId
    });
    const { payload: accessPayload } = await jwtVerify(tokens.access_token, jwks, {
      issuer: oidcIssuer
    });
    const user = {
      ...idPayload,
      realm_access: accessPayload.realm_access || idPayload.realm_access,
      resource_access: accessPayload.resource_access || idPayload.resource_access
    };
    req.session.user = user;
    req.session.tokens = { id_token: tokens.id_token };
    await upsertUserProfile(user);
    res.redirect("/dashboard");
  } catch (error) {
    next(error);
  }
});

app.get("/logout", (req, res) => {
  const idToken = req.session.tokens?.id_token;
  req.session.destroy(() => {
    const params = new URLSearchParams({ post_logout_redirect_uri: publicUrl });
    if (idToken) params.set("id_token_hint", idToken);
    res.redirect(`${logoutUrl}?${params}`);
  });
});

app.get("/dashboard", requireAuth, async (req, res) => {
  const userId = targetUserId(req);
  const adminUsers = hasAdminRole(req.session.user) ? await listUsers() : [];
  const settings = await getUserSettings(userId);
  const agentSettings = await listAgentSettingsForUser(userId);
  let agents = [];
  let error = "";
  const apiKey = await getApiKey(userId);
  if (apiKey) {
    try {
      const data = await listAgents(apiKey, { search: req.query.search });
      agents = data.agents || [];
    } catch (err) {
      error = err.message;
    }
  }
  res.send(dashboard(req, agents, settings, agentSettings, error, adminUsers, userId));
});

app.get("/settings", requireAuth, (_req, res) => res.redirect("/dashboard"));
app.post("/settings/api-key", requireAuth, (_req, res) => res.status(403).send("Las API keys solo pueden ser configuradas por un Administrador."));

app.get("/support", requireAuth, async (req, res, next) => {
  try {
    const userId = targetUserId(req);
    const adminUsers = hasAdminRole(req.session.user) ? await listUsers() : [];
    res.send(supportPage(req, publicSupportPresets(), adminUsers, userId, process.env.ANAM_PUBLIC_API_URL || process.env.NEXT_PUBLIC_ANAM_API_URL || process.env.ANAM_API_URL || ""));
  } catch (error) {
    next(error);
  }
});

app.post("/api/anam-session", requireAuth, async (req, res, next) => {
  try {
    const anamApiKey = process.env.ANAM_API_KEY;
    if (!anamApiKey) return res.status(500).json({ error: "ANAM_API_KEY no esta configurada." });
    const elevenLabsApiKey = process.env.SUPPORT_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsApiKey) return res.status(500).json({ error: "SUPPORT_ELEVENLABS_API_KEY no esta configurada." });

    const { avatarId, agentId } = req.body || {};
    if (!avatarId || !agentId) return res.status(400).json({ error: "avatarId y agentId son requeridos." });
    if (!findSupportPreset(avatarId, agentId)) return res.status(403).json({ error: "Persona de soporte no autorizada." });

    const signedUrlRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": elevenLabsApiKey } }
    );
    if (!signedUrlRes.ok) {
      return res.status(signedUrlRes.status).json({ error: `ElevenLabs API error: ${signedUrlRes.status} ${await signedUrlRes.text()}` });
    }
    const { signed_url: signedUrl } = await signedUrlRes.json();
    const anamApiUrl = process.env.ANAM_API_URL || "https://api.anam.ai";
    const sessionTokenRes = await fetch(`${anamApiUrl}/v1/auth/session-token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${anamApiKey}`
      },
      body: JSON.stringify({
        personaConfig: { avatarId },
        environment: {
          elevenLabsAgentSettings: { signedUrl, agentId },
          ...(process.env.ANAM_POD_NAME ? { podName: process.env.ANAM_POD_NAME } : {})
        }
      })
    });
    if (!sessionTokenRes.ok) {
      return res.status(sessionTokenRes.status).json({ error: `Anam API error: ${sessionTokenRes.status} ${await sessionTokenRes.text()}` });
    }
    const data = await sessionTokenRes.json();
    res.json({ sessionToken: data.sessionToken });
  } catch (error) {
    next(error);
  }
});

app.get("/agents/:agentId", requireAuth, async (req, res, next) => {
  try {
    const userId = targetUserId(req);
    const apiKey = await getApiKey(userId);
    if (!apiKey) return res.redirect("/dashboard");
    const agent = await getAgent(apiKey, req.params.agentId);
    const local = await getAgentSettings(userId, req.params.agentId);
    const adminUsers = hasAdminRole(req.session.user) ? await listUsers() : [];
    const message = req.query.saved ? "Configuracion guardada y publicada." : req.query.image ? "Foto de perfil generada." : "";
    res.send(agentDetail(req, agent, local, message, "", userId, adminUsers));
  } catch (error) {
    next(error);
  }
});

app.post("/agents/:agentId/profile-image", requireAuth, async (req, res, next) => {
  try {
    const userId = targetUserId(req);
    const apiKey = await getApiKey(userId);
    if (!apiKey) return res.status(403).send("Cuenta nueva, aguarde a que un administrador de Luzuno configure su cuenta.");
    const instructions = String(req.body.imagePrompt || "").trim();
    if (!instructions) return res.status(400).send("Ingresa instrucciones para generar la imagen de perfil.");
    const imageStyle = ["Corporativa", "Medicina", "Informal", "Industrial"].includes(req.body.imageStyle)
      ? req.body.imageStyle
      : "Corporativa";
    const agent = await getAgent(apiKey, req.params.agentId);
    const prompt = profileImagePrompt(agent, instructions, imageStyle);
    const imageBuffer = await generateProfileImage(prompt);
    await replaceProfileImage(userId, req.params.agentId, imageBuffer, "png", instructions, imageStyle);
    res.redirect(`/agents/${encodeURIComponent(req.params.agentId)}${targetUserQuery(req, userId)}${targetUserQuery(req, userId) ? "&" : "?"}image=1`);
  } catch (error) {
    next(error);
  }
});

app.post("/agents/:agentId/profile-image/upload", requireAuth, upload.single("profileImage"), async (req, res, next) => {
  try {
    const userId = targetUserId(req);
    const apiKey = await getApiKey(userId);
    if (!apiKey) return res.status(403).send("Cuenta nueva, aguarde a que un administrador de Luzuno configure su cuenta.");
    if (!req.file) return res.status(400).send("Selecciona una imagen para subir.");
    const local = await getAgentSettings(userId, req.params.agentId);
    const extension = profileImageExtension(req.file.mimetype);
    await replaceProfileImage(
      userId,
      req.params.agentId,
      req.file.buffer,
      extension,
      local.profile_image_prompt || "",
      local.profile_image_style || "Corporativa"
    );
    res.redirect(`/agents/${encodeURIComponent(req.params.agentId)}${targetUserQuery(req, userId)}${targetUserQuery(req, userId) ? "&" : "?"}image=1`);
  } catch (error) {
    next(error);
  }
});

app.post("/agents/:agentId/local", requireAuth, async (req, res) => {
  const userId = targetUserId(req);
  await saveAgentSettings(userId, req.params.agentId, {
    display_name: req.body.display_name,
    notes: req.body.notes,
    system_prompt: null,
    patch_template: null
  });
  res.redirect(`/agents/${encodeURIComponent(req.params.agentId)}${targetUserQuery(req, userId)}`);
});

app.post("/agents/:agentId/prompt", requireAuth, async (req, res, next) => {
  try {
    const userId = targetUserId(req);
    const apiKey = await getApiKey(userId);
    if (!apiKey) return res.status(403).send("Cuenta nueva, aguarde a que un administrador de Luzuno configure su cuenta.");
    const systemPrompt = req.body.systemPrompt || "";
    const patch = systemPromptPatch(systemPrompt);
    await saveAgentSettings(userId, req.params.agentId, {
      display_name: null,
      notes: null,
      system_prompt: systemPrompt,
      patch_template: JSON.stringify(patch)
    });
    await updateAgent(apiKey, req.params.agentId, patch);
    await publishAgent(apiKey, req.params.agentId);
    res.redirect(`/agents/${encodeURIComponent(req.params.agentId)}${targetUserQuery(req, userId)}${targetUserQuery(req, userId) ? "&" : "?"}saved=1`);
  } catch (error) {
    next(error);
  }
});

app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const users = await listUsers();
    const localUsers = await listUserSettings();
    res.send(adminPage(req, users, localUsers, req.query.saved ? "Cambios guardados." : ""));
  } catch (error) {
    res.send(adminPage(req, [], [], "", error.message));
  }
});

app.post("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    await createUser(req.body);
    res.redirect("/admin?saved=1");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:userId/api-key", requireAdmin, async (req, res, next) => {
  try {
    const users = await listUsers();
    const user = users.find((item) => item.id === req.params.userId);
    await setApiKeyForUser(req.params.userId, user?.username || req.params.userId, user?.email || null, req.body.apiKey);
    res.redirect("/admin?saved=1");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:userId/delete", requireAdmin, async (req, res, next) => {
  try {
    if (req.params.userId === req.session.user.sub) return res.status(400).send("No podes eliminar tu propio usuario activo.");
    await deleteUser(req.params.userId);
    res.redirect("/admin?saved=1");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:userId/password", requireAdmin, async (req, res, next) => {
  try {
    await resetPassword(req.params.userId, req.body.password);
    res.redirect("/admin?saved=1");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:userId/admin", requireAdmin, async (req, res, next) => {
  try {
    await setUserAdmin(req.params.userId, req.body.enabled === "1");
    res.redirect("/admin?saved=1");
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send(req.session?.user ? `<pre>${String(err.stack || err.message || err)}</pre>` : loginPage("Ocurrio un error iniciando sesion."));
});

await fs.mkdir(imageDir, { recursive: true });
await migrate();
app.listen(port, () => {
  console.log(`Control Panel listening on ${port}`);
});
