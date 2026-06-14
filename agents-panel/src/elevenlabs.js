const baseUrl = "https://api.elevenlabs.io";

async function elevenFetch(apiKey, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`ElevenLabs ${res.status}: ${message}`);
  }
  return body;
}

export async function listAgents(apiKey, query = {}) {
  const params = new URLSearchParams({
    page_size: query.page_size || "100",
    sort_by: query.sort_by || "name",
    sort_direction: query.sort_direction || "asc"
  });
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  return elevenFetch(apiKey, `/v1/convai/agents?${params}`);
}

export async function getAgent(apiKey, agentId) {
  return elevenFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}`);
}

export async function updateAgent(apiKey, agentId, patch) {
  return elevenFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function listAgentBranches(apiKey, agentId) {
  return elevenFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}/branches?limit=100`);
}

export async function createDeployment(apiKey, agentId, branchId) {
  return elevenFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}/deployments`, {
    method: "POST",
    body: JSON.stringify({
      deployment_request: {
        requests: [
          {
            branch_id: branchId,
            deployment_strategy: {
              type: "percentage",
              traffic_percentage: 1
            }
          }
        ]
      }
    })
  });
}

export async function publishAgent(apiKey, agentId) {
  const branches = await listAgentBranches(apiKey, agentId);
  const candidates = (branches.results || []).filter((branch) => !branch.is_archived);
  const branch = candidates.find((item) => item.current_live_percentage === 100)
    || candidates.find((item) => item.current_live_percentage === 1)
    || candidates.sort((a, b) => (b.current_live_percentage || 0) - (a.current_live_percentage || 0))[0];
  if (!branch?.id) {
    throw new Error("No se encontro una rama disponible para publicar el agente.");
  }
  return createDeployment(apiKey, agentId, branch.id);
}
