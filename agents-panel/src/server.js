import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { migrate, upsertUserProfile, getUserSettings, getApiKey, setApiKeyForUser, listUserSettings, saveAgentSettings, getAgentSettings } from "./db.js";
import { listAgents, getAgent, updateAgent, publishAgent } from "./elevenlabs.js";
import { adminPage, agentDetail, dashboard, loginPage } from "./views.js";
import { authUrl, hasAdminRole, internalIssuer, listUsers, createUser, deleteUser, resetPassword, setUserAdmin, tokenUrl, logoutUrl, oidcIssuer } from "./keycloak.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const clientId = process.env.KEYCLOAK_CLIENT_ID || "agents-panel-web";
const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
const publicUrl = process.env.PUBLIC_URL || "http://192.168.0.115:3000";
const jwks = createRemoteJWKSet(new URL(`${internalIssuer}/protocol/openid-connect/certs`));

app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));
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
  const settings = await getUserSettings(req.session.user.sub);
  let agents = [];
  let error = "";
  const apiKey = await getApiKey(req.session.user.sub);
  if (apiKey) {
    try {
      const data = await listAgents(apiKey, { search: req.query.search });
      agents = data.agents || [];
    } catch (err) {
      error = err.message;
    }
  }
  res.send(dashboard(req, agents, settings, error));
});

app.get("/settings", requireAuth, (_req, res) => res.redirect("/dashboard"));
app.post("/settings/api-key", requireAuth, (_req, res) => res.status(403).send("Las API keys solo pueden ser configuradas por un Administrador."));

app.get("/agents/:agentId", requireAuth, async (req, res, next) => {
  try {
    const apiKey = await getApiKey(req.session.user.sub);
    if (!apiKey) return res.redirect("/dashboard");
    const agent = await getAgent(apiKey, req.params.agentId);
    const local = await getAgentSettings(req.session.user.sub, req.params.agentId);
    res.send(agentDetail(req, agent, local, req.query.saved ? "Configuracion guardada y publicada." : ""));
  } catch (error) {
    next(error);
  }
});

app.post("/agents/:agentId/local", requireAuth, async (req, res) => {
  await saveAgentSettings(req.session.user.sub, req.params.agentId, {
    display_name: req.body.display_name,
    notes: req.body.notes,
    system_prompt: null,
    patch_template: null
  });
  res.redirect(`/agents/${encodeURIComponent(req.params.agentId)}`);
});

app.post("/agents/:agentId/prompt", requireAuth, async (req, res, next) => {
  try {
    const apiKey = await getApiKey(req.session.user.sub);
    if (!apiKey) return res.status(403).send("Cuenta nueva, aguarde a que un administrador de Luzuno configure su cuenta.");
    const systemPrompt = req.body.systemPrompt || "";
    const patch = systemPromptPatch(systemPrompt);
    await saveAgentSettings(req.session.user.sub, req.params.agentId, {
      display_name: null,
      notes: null,
      system_prompt: systemPrompt,
      patch_template: JSON.stringify(patch)
    });
    await updateAgent(apiKey, req.params.agentId, patch);
    await publishAgent(apiKey, req.params.agentId);
    res.redirect(`/agents/${encodeURIComponent(req.params.agentId)}?saved=1`);
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

await migrate();
app.listen(port, () => {
  console.log(`Control Panel listening on ${port}`);
});
