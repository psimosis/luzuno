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

async function elevenAudioFetch(apiKey, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
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

export async function listConversations(apiKey, query = {}) {
  const params = new URLSearchParams({
    page_size: query.page_size || "100",
    summary_mode: query.summary_mode || "exclude"
  });
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  return elevenFetch(apiKey, `/v1/convai/conversations?${params}`);
}

export async function listAllConversationsForAgent(apiKey, agentId, { maxPages = 20 } = {}) {
  const conversations = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page += 1) {
    const data = await listConversations(apiKey, {
      agent_id: agentId,
      cursor,
      page_size: "100",
      summary_mode: "exclude"
    });
    conversations.push(...(data.conversations || []));
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return conversations;
}

export async function updateAgent(apiKey, agentId, patch) {
  return elevenFetch(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function listVoices(apiKey) {
  try {
    const data = await elevenFetch(apiKey, "/v2/voices?page_size=100&include_total_count=true");
    return data.voices || [];
  } catch {
    const data = await elevenFetch(apiKey, "/v1/voices");
    return data.voices || [];
  }
}

export function filterVoices(voices, { country = "", gender = "" } = {}) {
  const genderMap = { Masculino: "male", Femenino: "female" };
  const countryNeedles = {
    Argentina: ["es-ar", "argentina", "argentinian", "spanish"],
    "United States": ["en-us", "american", "english"],
    German: ["de-de", "german", "deutsch"],
    Mexico: ["es-mx", "mexico", "mexican", "spanish"]
  };
  const wantedGender = genderMap[gender] || "";
  const needles = countryNeedles[country] || [];
  return voices.filter((voice) => {
    const labels = voice.labels || {};
    const voiceGender = String(labels.gender || voice.gender || "").toLowerCase();
    const genderOk = !wantedGender || voiceGender === wantedGender || !voiceGender;
    const languageText = [
      labels.accent,
      labels.language,
      labels.locale,
      ...(voice.verified_languages || []).flatMap((item) => [item.language, item.locale, item.accent])
    ].filter(Boolean).join(" ").toLowerCase();
    const countryOk = !needles.length || needles.some((needle) => languageText.includes(needle));
    return genderOk && countryOk;
  });
}

export async function createVoicePreview(apiKey, voiceId, text) {
  return elevenAudioFetch(apiKey, `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2"
    })
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
              traffic_percentage: 100
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
