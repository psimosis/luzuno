import { hasAdminRole } from "./keycloak.js";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function currentSystemPrompt(agent) {
  const prompt = agent.conversation_config?.agent?.prompt;
  if (typeof prompt === "string") return prompt;
  return prompt?.prompt || "";
}

function headerTenantSelector(req, adminUsers = [], selectedUserId = "") {
  if (!hasAdminRole(req.session.user) || !adminUsers.length) return "";
  return `<form class="header-tenant-selector" method="get" action="/dashboard">
    <select name="userId" onchange="this.form.submit()">${adminUserOptions(adminUsers, selectedUserId)}</select>
  </form>`;
}

export function layout(req, title, body, options = {}) {
  const user = req.session.user;
  const admin = hasAdminRole(user);
  const selectedQuery = options.selectedUserId ? userQuery(req, options.selectedUserId) : "";
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} - Luzuno</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="generation-overlay" id="generationOverlay">
    <div class="generation-card">
      <img src="/logo-luzuno.png" alt="Luzuno">
      <span>Generacion de Imagen en Proceso</span>
    </div>
  </div>
  <header class="topbar">
    <a class="brand" href="/dashboard${selectedQuery}"><img src="/logo-luzuno.png" alt="Luzuno"><span>Panel de Control</span></a>
    <nav>
      ${user ? `${headerTenantSelector(req, options.adminUsers, options.selectedUserId)}<a href="/dashboard${selectedQuery}">Dashboard</a>${admin ? `<a href="/admin">Administracion</a>` : ""}<a href="/support${selectedQuery}">Soporte Tecnico</a><a href="/logout">Salir</a>` : ""}
    </nav>
  </header>
  <main>${body}</main>
  <script>
    document.querySelectorAll("[data-generation-form]").forEach((form) => {
      form.addEventListener("submit", () => {
        document.getElementById("generationOverlay")?.classList.add("is-visible");
      });
    });
  </script>
</body>
</html>`;
}

export function loginPage(message = "") {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login - CONTROL-PANEL</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="login-body">
  <div class="ai-lines"></div>
  <main class="login-shell">
    <section class="login-panel">
      <img class="login-logo" src="/logo-luzuno.png" alt="Luzuno">
      <p class="eyebrow">Luzuno AI</p>
      <h1>Panel de Control</h1>
      <p class="muted">Luzuno, una empresa de Inteligancia Artificial</p>
      ${message ? `<div class="notice">${esc(message)}</div>` : ""}
      <a class="primary wide" href="/login">Ingresar</a>
    </section>
  </main>
</body>
</html>`;
}

function profileImageMarkup(path, className = "agent-avatar") {
  return path
    ? `<img class="${className}" src="${esc(path)}" alt="Foto de perfil">`
    : `<div class="${className} avatar-placeholder" aria-label="Sin foto de perfil"></div>`;
}

function imageStyleOptions(selected = "Corporativa") {
  return ["Corporativa", "Medicina", "Informal", "Industrial"]
    .map((style) => `<option value="${esc(style)}" ${style === selected ? "selected" : ""}>${esc(style)}</option>`)
    .join("");
}

function optionList(values, selected = "") {
  return values
    .map((value) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`)
    .join("");
}

function voiceOptions(voices = [], selectedVoiceId = "") {
  return voices
    .map((voice) => `<option value="${esc(voice.voice_id)}" data-name="${esc(voice.name)}" data-preview="${esc(voice.preview_url || "")}" ${voice.voice_id === selectedVoiceId ? "selected" : ""}>${esc(voice.name || voice.voice_id)}</option>`)
    .join("");
}

function adminUserOptions(users, selectedUserId) {
  return users
    .map((user) => `<option value="${esc(user.id)}" ${user.id === selectedUserId ? "selected" : ""}>${esc(user.username || user.email || user.id)}</option>`)
    .join("");
}

function userQuery(req, selectedUserId) {
  return hasAdminRole(req.session.user) && selectedUserId && selectedUserId !== req.session.user.sub
    ? `?userId=${encodeURIComponent(selectedUserId)}`
    : "";
}

function hiddenUserInput(req, selectedUserId) {
  return hasAdminRole(req.session.user) && selectedUserId
    ? `<input type="hidden" name="userId" value="${esc(selectedUserId)}">`
    : "";
}

export function dashboard(req, agents, settings, agentSettings = [], error = "", adminUsers = [], selectedUserId = "") {
  const imagesByAgent = new Map(agentSettings.map((item) => [item.agent_id, item.profile_image_path]));
  const query = userQuery(req, selectedUserId);
  const cards = agents.map((agent) => `
    <a class="agent-card" href="/agents/${esc(agent.agent_id)}${query}">
      <div class="agent-card-header">
        <h2>${esc(agent.name || "Sin nombre")}</h2>
        <div class="agent-card-side">
          ${profileImageMarkup(imagesByAgent.get(agent.agent_id))}
          <span class="${agent.archived ? "pill inactive-pill" : "pill active-pill"}">${agent.archived ? "Inactivo" : "Activo"}</span>
        </div>
      </div>
      <p class="meta">ID ${esc(agent.agent_id)}</p>
      <p>${(agent.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</p>
      <div class="agent-grid">
        <span>Rol</span><strong>${esc(agent.access_info?.role || "-")}</strong>
        <span>Creador</span><strong>${esc(agent.access_info?.creator_name || agent.access_info?.creator_email || "-")}</strong>
      </div>
    </a>`).join("");
  return layout(req, "Dashboard", `
    <section class="page-head">
      <div>
        <p class="eyebrow">Dashboard</p>
        <h1>Anubs Disponibles</h1>
      </div>
    </section>
    ${error ? `<div class="alert">${esc(error)}</div>` : ""}
    ${!settings?.api_key_last4 ? `<div class="notice">Cuenta nueva, aguarde a que un administrador de Luzuno configure su cuenta.</div>` : ""}
    <section class="cards">${cards || `<div class="empty">No hay Anubs para mostrar</div>`}</section>
  `, { adminUsers, selectedUserId });
}

export function agentDetail(req, agent, local, voices = [], currentVoiceId = "", message = "", error = "", selectedUserId = "", adminUsers = []) {
  const systemPrompt = local.system_prompt || currentSystemPrompt(agent);
  const query = userQuery(req, selectedUserId);
  const hiddenUser = hiddenUserInput(req, selectedUserId);
  const selectedVoiceId = local.voice_id || currentVoiceId;
  return layout(req, agent.name || "Agente", `
    <section class="page-head">
      <div>
        <p class="eyebrow">Anub</p>
        <h1>${esc(agent.name || agent.agent_id)}</h1>
        <p class="meta">${esc(agent.agent_id)}</p>
      </div>
      <a class="secondary" href="/dashboard${query}">Volver</a>
    </section>
    ${message ? `<div class="notice">${esc(message)}</div>` : ""}
    ${error ? `<div class="alert">${esc(error)}</div>` : ""}
    <section class="agent-editor-grid">
      <div class="editor-column">
        <article class="panel quadrant-data">
          <h2>Datos Principales</h2>
          <dl class="details">
            <dt>Estado</dt><dd>${agent.archived ? "Archivado" : "Activo"}</dd>
            <dt>Creado</dt><dd>${agent.created_at_unix_secs ? new Date(agent.created_at_unix_secs * 1000).toLocaleString("es-AR") : "-"}</dd>
            <dt>Ultima llamada</dt><dd>${agent.last_call_time_unix_secs ? new Date(agent.last_call_time_unix_secs * 1000).toLocaleString("es-AR") : "-"}</dd>
            <dt>Tags</dt><dd>${(agent.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("") || "-"}</dd>
          </dl>
        </article>
        <form class="panel form" method="post" action="/agents/${esc(agent.agent_id)}/persona">
          ${hiddenUser}
          <h2>Caracteristicas de la Persona</h2>
          <label>Rol</label>
          <input name="role_title" value="${esc(local.role_title || "")}">
          <label>Area o Departamento</label>
          <input name="department" value="${esc(local.department || "")}">
          <label>Correo Electronico</label>
          <input name="contact_email" type="email" value="${esc(local.contact_email || "")}">
          <label>Nro de Contacto</label>
          <input name="contact_phone" value="${esc(local.contact_phone || "")}">
          <label>Pais</label>
          <select id="persona-country" name="country">
            <option value="">Seleccionar</option>
            ${optionList(["Argentina", "United States", "German", "Mexico"], local.country || "")}
          </select>
          <label>Sexo</label>
          <select id="persona-gender" name="gender">
            <option value="">Seleccionar</option>
            ${optionList(["Masculino", "Femenino"], local.gender || "")}
          </select>
          <button class="primary" type="submit">Guardar Datos</button>
        </form>
        <form class="panel form quadrant-prompt" method="post" action="/agents/${esc(agent.agent_id)}/prompt">
          ${hiddenUser}
          <h2>Instrucciones de Comportamiento</h2>
          <textarea class="code prompt-editor" name="systemPrompt" rows="12">${esc(systemPrompt)}</textarea>
          <button class="primary" type="submit">Guardar Configuracion</button>
        </form>
      </div>
      <div class="editor-column">
        <article class="panel form quadrant-photo">
          <h2>Foto de Perfil</h2>
          <form class="form compact-form" method="post" action="/agents/${esc(agent.agent_id)}/profile-image" data-generation-form>
            ${hiddenUser}
            <div class="profile-preview">${profileImageMarkup(local.profile_image_path, "profile-image")}</div>
            <label>Estilo de la foto</label>
            <select name="imageStyle">${imageStyleOptions(local.profile_image_style || "Corporativa")}</select>
            <label>Caracteristicas de la Persona</label>
            <textarea name="imagePrompt" rows="4" placeholder="Ej: mujer ejecutiva de 35 anos, cabello oscuro, expresion amable">${esc(local.profile_image_prompt || "")}</textarea>
            <button class="primary" type="submit">Generar Imagen de Perfil</button>
          </form>
          <form class="form compact-form upload-form" method="post" action="/agents/${esc(agent.agent_id)}/profile-image/upload" enctype="multipart/form-data">
            ${hiddenUser}
            <label>Subir una foto desde su PC</label>
            <input name="profileImage" type="file" accept="image/png,image/jpeg,image/webp" required>
            <button class="primary" type="submit">Subir una Imagen</button>
          </form>
        </article>
        <form class="panel form" method="post" action="/agents/${esc(agent.agent_id)}/voice">
          ${hiddenUser}
          <h2>Voz del Anub</h2>
          <input id="voice-name" type="hidden" name="voiceName" value="${esc(local.voice_name || "")}">
          <label>Voces disponibles</label>
          <select id="voice-select" name="voiceId" data-agent-id="${esc(agent.agent_id)}">
            <option value="">Seleccionar voz</option>
            ${voiceOptions(voices, selectedVoiceId)}
          </select>
          <div class="voice-actions">
            <button id="voice-play" class="secondary" type="button">Play</button>
            <audio id="voice-audio"></audio>
          </div>
          <button class="primary" type="submit">Guardar Voz</button>
        </form>
        <form class="panel form quadrant-notes" method="post" action="/agents/${esc(agent.agent_id)}/local">
          ${hiddenUser}
          <h2>Notas locales</h2>
          <label>Nombre interno</label>
          <input name="display_name" value="${esc(local.display_name || "")}">
          <label>Notas</label>
          <textarea name="notes" rows="8">${esc(local.notes || "")}</textarea>
          <button class="primary" type="submit">Guardar notas</button>
        </form>
      </div>
    </section>
    <script src="/agent-detail.js"></script>
  `, { adminUsers, selectedUserId });
}

export function supportPage(req, presets, adminUsers = [], selectedUserId = "", anamApiUrl = "") {
  const config = {
    presets,
    anamApiUrl
  };
  return layout(req, "Soporte Tecnico", `
    <section class="page-head">
      <div>
        <p class="eyebrow">Soporte Tecnico</p>
        <h1>Comunicacion con soporte</h1>
      </div>
    </section>
    <section class="support-shell">
      <article class="support-video-panel">
        <div class="support-video-wrap">
          <video id="support-avatar-video" autoplay playsinline></video>
          <img id="support-avatar-preview" class="support-preview-image" src="${esc(presets[0]?.previewImage || "/support-avatar-preview.png")}" alt="Soporte Tecnico">
          <div id="support-connecting" class="support-connecting">Conectando...</div>
          <button id="support-start" class="support-phone-button" type="button" aria-label="Iniciar comunicacion">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
          </button>
          <button id="support-stop" class="support-phone-button support-end-button" type="button" aria-label="Finalizar comunicacion">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
          </button>
        </div>
        <div class="support-controls">
          <button id="support-prev" class="support-round-button" type="button" aria-label="Anterior">‹</button>
          <span class="support-call-hint">Presione el telefono para iniciar</span>
          <button id="support-next" class="support-round-button" type="button" aria-label="Siguiente">›</button>
        </div>
        <div id="support-personas" class="support-personas"></div>
      </article>
      <article class="panel support-chat-panel">
        <h2>Chat</h2>
        <div id="support-transcript" class="support-transcript"></div>
        <div class="support-chat-input">
          <input id="support-chat-input" type="text" placeholder="Inicie la comunicacion para escribir" disabled>
        </div>
        <div id="support-error" class="alert support-error"></div>
      </article>
    </section>
    <script id="support-config" type="application/json">${scriptJson(config)}</script>
    <script src="/vendor/anam/anam.js"></script>
    <script src="/support.js"></script>
  `, { adminUsers, selectedUserId });
}

export function adminPage(req, users, localUsers, message = "", error = "") {
  const localById = new Map(localUsers.map((item) => [item.user_id, item]));
  return layout(req, "Administracion", `
    <section class="page-head">
      <div><p class="eyebrow">Parametrizacion</p><h1>Administracion</h1></div>
    </section>
    ${message ? `<div class="notice">${esc(message)}</div>` : ""}
    ${error ? `<div class="alert">${esc(error)}</div>` : ""}
    <section class="split">
      <form class="panel form" method="post" action="/admin/users">
        <h2>Alta de usuario</h2>
        <label>Usuario</label><input name="username" required>
        <label>Email</label><input name="email" type="email">
        <label>Password</label><input name="password" type="password" required>
        <label class="check"><input name="admin" type="checkbox" value="1"> Administrador</label>
        <button class="primary" type="submit">Crear usuario</button>
      </form>
      <article class="panel">
        <h2>Politica</h2>
        <p class="muted">Los usuarios administran solo el system prompt de sus agentes. Las API keys de ElevenLabs se asignan exclusivamente desde Administracion.</p>
      </article>
    </section>
    <section class="panel">
      <h2>Usuarios</h2>
      <table><thead><tr><th>Usuario</th><th>Rol</th><th>Acciones</th></tr></thead><tbody>${userRows(users)}</tbody></table>
    </section>
    <section class="panel">
      <h2>Api Keys</h2>
      <table><thead><tr><th>Cliente</th><th>API key</th><th>Actualizar</th></tr></thead><tbody>${apiKeyRows(users, localById)}</tbody></table>
    </section>
  `, { adminUsers: users, selectedUserId: req.query.userId || req.session.user.sub });
}

function userRows(users) {
  return users.map((user) => {
    const roles = user.realmRoles || [];
    return `<tr>
      <td><strong>${esc(user.username)}</strong><span>${esc(user.email || "")}</span></td>
      <td>${roles.includes("Administrador") ? `<span class="pill">Administrador</span>` : `<span class="pill muted-pill">Usuario</span>`}</td>
      <td>
        <form method="post" action="/admin/users/${esc(user.id)}/admin" class="inline-form">
          <input type="hidden" name="enabled" value="${roles.includes("Administrador") ? "0" : "1"}">
          <button class="secondary" title="Cambiar rol">${roles.includes("Administrador") ? "Quitar admin" : "Hacer admin"}</button>
        </form>
        <form method="post" action="/admin/users/${esc(user.id)}/password" class="inline-form">
          <input name="password" type="password" placeholder="Nueva contraseña" required>
          <button class="secondary" title="Cambiar contraseña">Cambiar contraseña</button>
        </form>
        <form method="post" action="/admin/users/${esc(user.id)}/delete" class="inline-form">
          <button class="danger" title="Eliminar usuario">Eliminar</button>
        </form>
      </td>
    </tr>`;
  }).join("");
}

function apiKeyRows(users, localById) {
  return users.map((user) => {
    const local = localById.get(user.id);
    return `<tr>
      <td><strong>${esc(user.username)}</strong><span>${esc(user.email || "")}</span></td>
      <td>${local?.api_key_last4 ? `****${esc(local.api_key_last4)}` : "-"}</td>
      <td>
        <form method="post" action="/admin/users/${esc(user.id)}/api-key" class="inline-form">
          <input name="apiKey" type="password" placeholder="API key ElevenLabs" required>
          <button class="primary" title="Guardar API key">Guardar</button>
        </form>
      </td>
    </tr>`;
  }).join("");
}
