import { hasAdminRole } from "./keycloak.js";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function currentSystemPrompt(agent) {
  const prompt = agent.conversation_config?.agent?.prompt;
  if (typeof prompt === "string") return prompt;
  return prompt?.prompt || "";
}

export function layout(req, title, body) {
  const user = req.session.user;
  const admin = hasAdminRole(user);
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
    <a class="brand" href="/dashboard"><img src="/logo-luzuno.png" alt="Luzuno"><span>Panel de Control</span></a>
    <nav>
      ${user ? `<a href="/dashboard">Dashboard</a>${admin ? `<a href="/admin">Administracion</a>` : ""}<a href="/logout">Salir</a>` : ""}
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

export function dashboard(req, agents, settings, agentSettings = [], error = "") {
  const imagesByAgent = new Map(agentSettings.map((item) => [item.agent_id, item.profile_image_path]));
  const cards = agents.map((agent) => `
    <a class="agent-card" href="/agents/${esc(agent.agent_id)}">
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
  `);
}

export function agentDetail(req, agent, local, message = "", error = "") {
  const systemPrompt = local.system_prompt || currentSystemPrompt(agent);
  return layout(req, agent.name || "Agente", `
    <section class="page-head">
      <div>
        <p class="eyebrow">Anub</p>
        <h1>${esc(agent.name || agent.agent_id)}</h1>
        <p class="meta">${esc(agent.agent_id)}</p>
      </div>
      <a class="secondary" href="/dashboard">Volver</a>
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
        <form class="panel form quadrant-prompt" method="post" action="/agents/${esc(agent.agent_id)}/prompt">
          <h2>Instrucciones de Comportamiento</h2>
          <textarea class="code prompt-editor" name="systemPrompt" rows="12">${esc(systemPrompt)}</textarea>
          <button class="primary" type="submit">Guardar Configuracion</button>
        </form>
      </div>
      <div class="editor-column">
        <article class="panel form quadrant-photo">
          <h2>Foto de Perfil</h2>
          <form class="form compact-form" method="post" action="/agents/${esc(agent.agent_id)}/profile-image" data-generation-form>
            <div class="profile-preview">${profileImageMarkup(local.profile_image_path, "profile-image")}</div>
            <label>Estilo de la foto</label>
            <select name="imageStyle">${imageStyleOptions(local.profile_image_style || "Corporativa")}</select>
            <label>Caracteristicas de la Persona</label>
            <textarea name="imagePrompt" rows="4" placeholder="Ej: mujer ejecutiva de 35 anos, cabello oscuro, expresion amable">${esc(local.profile_image_prompt || "")}</textarea>
            <button class="primary" type="submit">Generar Imagen de Perfil</button>
          </form>
          <form class="form compact-form upload-form" method="post" action="/agents/${esc(agent.agent_id)}/profile-image/upload" enctype="multipart/form-data">
            <label>Subir una foto desde su PC</label>
            <input name="profileImage" type="file" accept="image/png,image/jpeg,image/webp" required>
            <button class="secondary" type="submit">Subir una Imagen</button>
          </form>
        </article>
        <form class="panel form quadrant-notes" method="post" action="/agents/${esc(agent.agent_id)}/local">
          <h2>Notas locales</h2>
          <label>Nombre interno</label>
          <input name="display_name" value="${esc(local.display_name || "")}">
          <label>Notas</label>
          <textarea name="notes" rows="8">${esc(local.notes || "")}</textarea>
          <button class="secondary" type="submit">Guardar notas</button>
        </form>
      </div>
    </section>
  `);
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
  `);
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
