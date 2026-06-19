const baseUrl = process.env.KEYCLOAK_BASE_URL || "http://keycloak:8080";
const publicBaseUrl = process.env.KEYCLOAK_PUBLIC_URL || "auto";
const publicPort = process.env.KEYCLOAK_PUBLIC_PORT || "8080";
const publicProtocol = process.env.KEYCLOAK_PUBLIC_PROTOCOL || "http";
const realm = process.env.KEYCLOAK_REALM || "agents-panel";
const adminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID || "agents-panel-admin";
const adminClientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

export const oidcIssuer = `${publicBaseUrl === "auto" ? "http://localhost:8080" : publicBaseUrl}/realms/${realm}`;
export const internalIssuer = `${baseUrl}/realms/${realm}`;
export const tokenUrl = `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;

function requestHostname(req) {
  const host = req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return new URL(`${proto}://${host}`).hostname;
}

export function publicKeycloakBaseUrl(req) {
  if (publicBaseUrl !== "auto") return publicBaseUrl;
  return `${publicProtocol}://${requestHostname(req)}:${publicPort}`;
}

export function requestOidcIssuer(req) {
  return `${publicKeycloakBaseUrl(req)}/realms/${realm}`;
}

export function authUrl(req) {
  return `${requestOidcIssuer(req)}/protocol/openid-connect/auth`;
}

export function logoutUrl(req) {
  return `${requestOidcIssuer(req)}/protocol/openid-connect/logout`;
}

export function hasAdminRole(user) {
  const roles = user?.realm_access?.roles || [];
  return roles.includes("Administrador");
}

export async function getAdminToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: adminClientId,
    client_secret: adminClientSecret
  });
  const res = await fetch(`${baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`Keycloak admin token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function kcFetch(path, options = {}) {
  const token = await getAdminToken();
  const res = await fetch(`${baseUrl}/admin/realms/${realm}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    throw new Error(`Keycloak request failed: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function listUsers() {
  const users = await kcFetch("/users?max=1000");
  return Promise.all(users.map(async (user) => {
    const roles = await kcFetch(`/users/${encodeURIComponent(user.id)}/role-mappings/realm`);
    return { ...user, realmRoles: roles.map((role) => role.name) };
  }));
}

export async function createUser({ username, email, password, admin }) {
  const user = {
    username,
    email: email || undefined,
    enabled: true,
    emailVerified: Boolean(email),
    credentials: [{ type: "password", value: password, temporary: false }]
  };
  await kcFetch("/users", { method: "POST", body: JSON.stringify(user) });
  const users = await kcFetch(`/users?username=${encodeURIComponent(username)}&exact=true`);
  const created = users[0];
  if (admin && created) await setUserAdmin(created.id, true);
  return created;
}

export async function deleteUser(userId) {
  return kcFetch(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export async function resetPassword(userId, password) {
  return kcFetch(`/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: password, temporary: false })
  });
}

export async function setUserAdmin(userId, enabled) {
  const role = await kcFetch("/roles/Administrador");
  const current = await kcFetch(`/users/${encodeURIComponent(userId)}/role-mappings/realm`);
  const hasRole = current.some((item) => item.name === "Administrador");
  if (enabled && !hasRole) {
    return kcFetch(`/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([role])
    });
  }
  if (!enabled && hasRole) {
    return kcFetch(`/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
      method: "DELETE",
      body: JSON.stringify([role])
    });
  }
  return null;
}
