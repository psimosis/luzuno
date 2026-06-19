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
  return `<form class="header-tenant-selector" method="get" action="${esc(req.path || "/dashboard")}">
    <select name="userId" onchange="this.form.submit()">${adminUserOptions(adminUsers, selectedUserId)}</select>
  </form>`;
}

export function layout(req, title, body, options = {}) {
  const user = req.session.user;
  const admin = hasAdminRole(user);
  const selectedQuery = options.selectedUserId ? userQuery(req, options.selectedUserId) : "";
  const client = options.clientProfile || req.res?.locals?.clientProfile || {};
  const clientUsername = client.username || user?.preferred_username || user?.email || user?.sub || "";
  const clientCompany = client.company_name || (clientUsername === "panel-admin" ? "Luzuno" : clientUsername);
  const clientFooter = user ? `<footer class="site-footer"><span>Cliente: ${esc(clientCompany)}${clientUsername ? ` (${esc(clientUsername)})` : ""}</span></footer>` : "";
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
      ${user ? `${headerTenantSelector(req, options.adminUsers, options.selectedUserId)}<a href="/dashboard${selectedQuery}">Dashboard</a>${admin ? `<a href="/clients">Clientes</a><a href="/admin">Administracion</a>` : ""}<a href="/billing${selectedQuery}">Facturacion</a><a href="/support${selectedQuery}">Soporte Tecnico</a><a href="/logout">Salir</a>` : ""}
    </nav>
  </header>
  <main>${body}</main>
  ${clientFooter}
  <script>
    document.querySelectorAll("[data-generation-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        if (!form.checkValidity()) {
          event.preventDefault();
          form.reportValidity();
          return;
        }
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

function cardLabel(label) {
  return `<span>${esc(label)}</span>`;
}

function lineIcon(name) {
  const icons = {
    data: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>`,
    person: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
    prompt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
    image: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 16 5-5 4 4 2-2 5 5"/><path d="M15 9h.01"/></svg>`,
    voice: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M17 9a4 4 0 0 1 0 6"/><path d="M19.5 6.5a8 8 0 0 1 0 11"/></svg>`,
    notes: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M16 4v4h4"/><path d="M8 12h8M8 16h6"/></svg>`
  };
  return `<span class="section-icon">${icons[name] || icons.data}</span>`;
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
  const settingsByAgent = new Map(agentSettings.map((item) => [item.agent_id, item]));
  const query = userQuery(req, selectedUserId);
  const localValue = (value) => value ? esc(value) : "";
  const cards = agents.map((agent) => {
    const local = settingsByAgent.get(agent.agent_id) || {};
    return `
    <a class="agent-card profile-agent-card" href="/agents/${esc(agent.agent_id)}${query}">
      <div class="agent-card-media">
        <div class="agent-card-title">
          <h2>${esc(agent.name || "Sin nombre")}</h2>
        </div>
        ${profileImageMarkup(local.profile_image_path, "agent-card-photo")}
        <span class="${agent.archived ? "pill inactive-pill" : "pill active-pill"}">${agent.archived ? "Inactivo" : "Activo"}</span>
      </div>
      <div class="agent-grid persona-grid">
        ${cardLabel("Rol")}<strong>${localValue(local.role_title)}</strong>
        ${cardLabel("Area o Departamento")}<strong>${localValue(local.department)}</strong>
        ${cardLabel("Correo Electronico")}<strong>${localValue(local.contact_email)}</strong>
        ${cardLabel("Nro de Contacto")}<strong>${localValue(local.contact_phone)}</strong>
        ${cardLabel("Pais")}<strong>${localValue(local.country)}</strong>
        ${cardLabel("Sexo")}<strong>${localValue(local.gender)}</strong>
      </div>
      <p class="agent-tags">${(agent.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</p>
    </a>`;
  }).join("");
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

export function agentDetail(req, agent, local, voices = [], currentVoiceId = "", voiceError = "", message = "", error = "", selectedUserId = "", adminUsers = []) {
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
          <h2>${lineIcon("data")}Datos Principales</h2>
          <dl class="details">
            <dt>Estado</dt><dd>${agent.archived ? "Archivado" : "Activo"}</dd>
            <dt>Creado</dt><dd>${agent.created_at_unix_secs ? new Date(agent.created_at_unix_secs * 1000).toLocaleString("es-AR") : "-"}</dd>
            <dt>Ultima llamada</dt><dd>${agent.last_call_time_unix_secs ? new Date(agent.last_call_time_unix_secs * 1000).toLocaleString("es-AR") : "-"}</dd>
            <dt>Tags</dt><dd>${(agent.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("") || "-"}</dd>
          </dl>
        </article>
        <form class="panel form" method="post" action="/agents/${esc(agent.agent_id)}/persona">
          ${hiddenUser}
          <h2>${lineIcon("person")}Caracteristicas de la Persona</h2>
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
          <h2>${lineIcon("prompt")}Instrucciones de Comportamiento</h2>
          <textarea class="code prompt-editor" name="systemPrompt" rows="12">${esc(systemPrompt)}</textarea>
          <button class="primary" type="submit">Guardar Configuracion</button>
        </form>
      </div>
      <div class="editor-column">
        <article class="panel form quadrant-photo">
          <h2>${lineIcon("image")}Foto de Perfil</h2>
          <form class="form compact-form" method="post" action="/agents/${esc(agent.agent_id)}/profile-image" data-generation-form>
            ${hiddenUser}
            <div class="profile-preview">${profileImageMarkup(local.profile_image_path, "profile-image")}</div>
            <label>Estilo de la foto</label>
            <select name="imageStyle">${imageStyleOptions(local.profile_image_style || "Corporativa")}</select>
            <label>Caracteristicas de la Persona</label>
            <textarea name="imagePrompt" rows="4" required placeholder="Ej: mujer ejecutiva de 35 anos, cabello oscuro, expresion amable">${esc(local.profile_image_prompt || "")}</textarea>
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
          <h2>${lineIcon("voice")}Voz del Anub</h2>
          ${voiceError ? `<div class="alert compact-alert">No se pudieron cargar las voces. La API key necesita el permiso voices_read.</div>` : ""}
          <input id="voice-name" type="hidden" name="voiceName" value="${esc(local.voice_name || "")}">
          <label>Voces disponibles</label>
          <select id="voice-select" name="voiceId" data-agent-id="${esc(agent.agent_id)}" ${voiceError ? "disabled" : ""}>
            <option value="">Seleccionar voz</option>
            ${voiceOptions(voices, selectedVoiceId)}
          </select>
          <div class="voice-actions">
            <button id="voice-play" class="secondary" type="button" ${voiceError ? "disabled" : ""}>Play</button>
            <audio id="voice-audio"></audio>
          </div>
          <button class="primary" type="submit" ${voiceError ? "disabled" : ""}>Guardar Voz</button>
        </form>
        <form class="panel form quadrant-notes" method="post" action="/agents/${esc(agent.agent_id)}/local">
          ${hiddenUser}
          <h2>${lineIcon("notes")}Notas locales</h2>
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
        <a class="primary" href="/admin/billing">Ir a Facturacion</a>
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

export function clientsPage(req, users, localUsers, selectedUserId = "", message = "", error = "", footerProfile = null) {
  const localById = new Map(localUsers.map((item) => [item.user_id, item]));
  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0] || null;
  const selectedLocal = selectedUser ? localById.get(selectedUser.id) || {} : {};
  const selectedProfile = selectedUser ? {
    ...selectedLocal,
    user_id: selectedUser.id,
    username: selectedUser.username || selectedLocal.username,
    email: selectedUser.email || selectedLocal.email
  } : null;
  return layout(req, "Clientes", `
    <section class="page-head">
      <div><p class="eyebrow">Gestion</p><h1>Clientes</h1></div>
    </section>
    ${message ? `<div class="notice">${esc(message)}</div>` : ""}
    ${error ? `<div class="alert">${esc(error)}</div>` : ""}
    <section class="clients-layout">
      <article class="panel clients-list">
        <h2>${lineIcon("person")}Clientes</h2>
        <div class="client-search">
          <span aria-hidden="true">⌕</span>
          <input id="client-search" type="search" placeholder="Buscar cliente">
        </div>
        <div class="client-list-items">${clientListRows(users, localById, selectedUserId)}</div>
      </article>
      <div class="clients-main">
        <form class="panel form" method="post" action="/clients">
          <h2>${lineIcon("person")}Nuevo Cliente</h2>
          <label>Nombre de la Empresa</label><input name="company_name" required>
          <label>CUIT</label><input name="cuit">
          <label>Direccion</label><input name="address">
          <label>Telefono</label><input name="phone">
          <label>Persona de Contacto</label><input name="contact_person">
          <label>Correo Electronico</label><input name="contact_email" type="email">
          <label>Margen %</label><input name="margin_percent" type="number" min="0" step="0.01" value="0">
          <label>u$s Min</label><input name="cost_per_minute_usd" type="number" min="0" step="0.0001" value="0">
          <label>Nombre de Usuario</label><input name="username" required>
          <label>Contraseña</label><input name="password" type="password" required>
          <button class="primary" type="submit">Crear Cliente</button>
        </form>
        ${selectedUser ? clientEditForm(selectedProfile) : `<article class="panel empty">No hay clientes para editar.</article>`}
      </div>
    </section>
    <script src="/clients.js"></script>
  `, { adminUsers: users, selectedUserId, clientProfile: footerProfile || selectedProfile || req.res?.locals?.clientProfile });
}

function clientListRows(users, localById, selectedUserId) {
  return users.map((user) => {
    const local = localById.get(user.id) || {};
    const company = local.company_name || (user.username === "panel-admin" ? "Luzuno" : user.username);
    const searchable = `${company} ${user.username || ""} ${user.email || ""}`.toLowerCase();
    return `<a class="client-list-item ${user.id === selectedUserId ? "is-selected" : ""}" href="/clients/${esc(user.id)}" data-search="${esc(searchable)}">
      <strong>${esc(company)}</strong>
      <span>${esc(user.username || "")}</span>
    </a>`;
  }).join("");
}

function clientEditForm(client) {
  return `<form class="panel form" method="post" action="/clients/${esc(client.user_id)}">
    <h2>${lineIcon("data")}Datos del Cliente</h2>
    <label>Nombre de la Empresa</label><input name="company_name" value="${esc(client.company_name || "")}" required>
    <label>CUIT</label><input name="cuit" value="${esc(client.cuit || "")}">
    <label>Direccion</label><input name="address" value="${esc(client.address || "")}">
    <label>Telefono</label><input name="phone" value="${esc(client.phone || "")}">
    <label>Persona de Contacto</label><input name="contact_person" value="${esc(client.contact_person || "")}">
    <label>Correo Electronico</label><input name="contact_email" type="email" value="${esc(client.contact_email || client.email || "")}">
    <label>Margen %</label><input name="margin_percent" type="number" min="0" step="0.01" value="${esc(client.margin_percent ?? 0)}">
    <label>u$s Min</label><input name="cost_per_minute_usd" type="number" min="0" step="0.0001" value="${esc(client.cost_per_minute_usd ?? 0)}">
    <label>Nombre de Usuario</label><input name="username" value="${esc(client.username || "")}" readonly>
    <label>Contraseña</label><input name="password" type="password" placeholder="Dejar vacio para conservar">
    <button class="primary" type="submit">Guardar Cliente</button>
  </form>`;
}

function money(value) {
  return `U$D ${Number(value || 0).toFixed(2)}`;
}

function billingRows(rows = []) {
  return rows.map((row) => `<tr>
    <td><strong>${esc(row.agentName)}</strong><span>${esc(row.agentId)}</span></td>
    <td>${row.conversationCount}</td>
    <td>${Number(row.totalMinutes || 0).toFixed(2)}</td>
    <td>${money(row.billedCostPerMinuteUsd)}</td>
    <td>${money(row.subtotalUsd)}</td>
    <td>${money(row.ivaUsd)}</td>
    <td>${money(row.igUsd)}</td>
    <td>${money(row.totalUsd)}</td>
  </tr>`).join("");
}

function invoiceRows(invoices = [], query = "") {
  return invoices.map((invoice) => {
    const period = `${String(invoice.period_month).padStart(2, "0")}/${invoice.period_year}`;
    const createdAt = invoice.created_at ? new Date(invoice.created_at).toLocaleString("es-AR") : "-";
    const href = `/billing/invoices/${esc(invoice.id)}.pdf${query}`;
    return `<tr>
      <td>${esc(period)}</td>
      <td>${esc(invoice.invoice_type)}</td>
      <td>${esc(invoice.invoice_number)}</td>
      <td>${esc(createdAt)}</td>
      <td><a class="secondary" href="${href}" target="_blank">Reimprimir</a></td>
    </tr>`;
  }).join("");
}

export function billingPage(req, users, localUsers, selectedUserId = "", billing = {}, error = "") {
  const isAdmin = hasAdminRole(req.session.user);
  const localById = new Map(localUsers.map((item) => [item.user_id, item]));
  const selectedLocal = localById.get(selectedUserId) || billing.settings || {};
  const totals = billing.totals || {};
  const query = userQuery(req, selectedUserId);
  const documentType = billing.period?.isClosed ? "A" : "X";
  const documentLabel = billing.period?.isClosed
    ? (billing.finalInvoice ? "Reimprimir Factura" : "Generar Factura")
    : "Generar Documento X";
  const invoiceUrl = billing.finalInvoice
    ? `/billing/invoices/${billing.finalInvoice.id}.pdf${query}`
    : `/billing/document.pdf${query}${query ? "&" : "?"}type=${documentType}`;
  return layout(req, "Facturacion", `
    <section class="page-head">
      <div><p class="eyebrow">Facturacion</p><h1>Consumo mensual</h1><p class="meta">${esc(billing.period?.label || "")}</p></div>
    </section>
    ${error ? `<div class="alert">${esc(error)}</div>` : ""}
    <section class="panel billing-toolbar">
      <div class="billing-client-summary">
        <span>Cliente</span>
        <strong>${esc(selectedLocal.company_name || selectedLocal.username || "")}</strong>
      </div>
      ${isAdmin ? `<form method="post" action="/admin/billing/margin" class="inline-form billing-margin-form">
        <input type="hidden" name="userId" value="${esc(selectedUserId)}">
        <label>% Margen</label>
        <input name="margin_percent" type="number" min="0" step="0.01" value="${esc(selectedLocal.margin_percent ?? 0)}">
        <label>u$s Min</label>
        <input name="cost_per_minute_usd" type="number" min="0" step="0.0001" value="${esc(selectedLocal.cost_per_minute_usd ?? 0)}">
        <button class="primary" type="submit">Guardar</button>
      </form>` : ""}
      ${selectedUserId ? `<button class="primary" type="button" data-invoice-url="${esc(invoiceUrl)}">${documentLabel}</button>` : ""}
    </section>
    <section class="panel billing-table-panel">
      <h2>Consumo temporal del mes</h2>
      <table class="billing-table">
        <thead><tr>
          <th>Agente</th>
          <th>Numero de Conversaciones</th>
          <th>Minutos</th>
          <th>Costo x minuto</th>
          <th>Total agente</th>
          <th>IVA 21%</th>
          <th>IG 3,5%</th>
          <th>Total U$D</th>
        </tr></thead>
        <tbody>${billingRows(billing.rows || []) || `<tr><td colspan="8">No hay datos de facturacion para mostrar.</td></tr>`}</tbody>
        <tfoot><tr>
          <th>Total</th>
          <th>${totals.conversationCount || 0}</th>
          <th>${Number(totals.totalMinutes || 0).toFixed(2)}</th>
          <th>-</th>
          <th>${money(totals.subtotalUsd)}</th>
          <th>${money(totals.ivaUsd)}</th>
          <th>${money(totals.igUsd)}</th>
          <th>${money(totals.totalUsd)}</th>
        </tr></tfoot>
      </table>
    </section>
    <section class="panel">
      <h2>Facturas mensuales</h2>
      <table><thead><tr><th>Periodo</th><th>Tipo</th><th>Comprobante</th><th>Emitida</th><th>Accion</th></tr></thead>
        <tbody>${invoiceRows(billing.invoices || [], query) || `<tr><td colspan="5">No hay facturas emitidas.</td></tr>`}</tbody>
      </table>
    </section>
    <div class="invoice-modal" id="invoice-modal" aria-hidden="true">
      <div class="invoice-dialog">
        <div class="invoice-dialog-head">
          <strong>${documentType === "A" ? "Factura A" : "Documento X"}</strong>
          <button class="secondary" type="button" data-invoice-close>Cerrar</button>
        </div>
        <iframe id="invoice-frame" title="Factura PDF"></iframe>
        <a id="invoice-download" class="primary" href="${esc(invoiceUrl)}" download>Descargar PDF</a>
      </div>
    </div>
    <script src="/billing.js"></script>
  `, { adminUsers: users, selectedUserId, clientProfile: selectedLocal || req.res?.locals?.clientProfile });
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
    const label = local?.company_name || user.username;
    return `<tr>
      <td><strong>${esc(label)}</strong><span>${esc(user.username || "")}${user.email ? ` · ${esc(user.email)}` : ""}</span></td>
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
