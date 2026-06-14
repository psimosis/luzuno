import { AnamEvent, createClient } from "/vendor/anam-sdk/index.js";

const config = JSON.parse(document.getElementById("support-config")?.textContent || "{}");
const presets = config.presets || [];
let selectedIndex = 0;
let client = null;
let status = "idle";
const messages = new Map();

const video = document.getElementById("support-avatar-video");
const preview = document.getElementById("support-avatar-preview");
const connecting = document.getElementById("support-connecting");
const transcript = document.getElementById("support-transcript");
const errorBox = document.getElementById("support-error");
const personas = document.getElementById("support-personas");
const startButton = document.getElementById("support-start");
const stopButton = document.getElementById("support-stop");
const prevButton = document.getElementById("support-prev");
const nextButton = document.getElementById("support-next");

function currentPreset() {
  return presets[Math.min(selectedIndex, Math.max(presets.length - 1, 0))] || null;
}

function setStatus(nextStatus) {
  status = nextStatus;
  const active = status === "connecting" || status === "connected";
  document.body.classList.toggle("support-session-active", active);
  connecting.classList.toggle("is-visible", status === "connecting");
  preview.classList.toggle("is-hidden", active);
  startButton.disabled = active || !currentPreset();
  stopButton.disabled = status !== "connected";
  prevButton.disabled = active || presets.length < 2;
  nextButton.disabled = active || presets.length < 2;
}

function setError(message = "") {
  errorBox.textContent = message ? `Error: ${message}` : "";
  errorBox.classList.toggle("is-visible", Boolean(message));
}

function renderMessages() {
  transcript.innerHTML = "";
  for (const item of messages.values()) {
    const row = document.createElement("div");
    row.className = `support-message ${item.role === "user" ? "is-user" : "is-agent"}`;
    const label = document.createElement("span");
    label.textContent = item.role === "user" ? "USTED" : "SOPORTE";
    const bubble = document.createElement("p");
    bubble.textContent = item.content;
    row.append(label, bubble);
    transcript.append(row);
  }
  transcript.scrollTop = transcript.scrollHeight;
}

function renderPersonas() {
  personas.innerHTML = "";
  presets.forEach((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `support-persona ${index === selectedIndex ? "is-selected" : ""}`;
    button.disabled = status === "connecting" || status === "connected";
    button.innerHTML = `<img src="${preset.previewImage}" alt=""><span>${preset.label}</span>`;
    button.addEventListener("click", () => {
      selectedIndex = index;
      preview.src = preset.previewImage;
      renderPersonas();
    });
    personas.append(button);
  });
}

async function start() {
  const preset = currentPreset();
  if (!preset) {
    setError("No hay una persona de soporte configurada.");
    return;
  }
  setStatus("connecting");
  setError("");
  messages.clear();
  renderMessages();

  try {
    const response = await fetch("/api/anam-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatarId: preset.avatarId, agentId: preset.agentId })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo iniciar la sesion de soporte.");

    client = createClient(body.sessionToken, {
      ...(config.anamApiUrl ? { api: { baseUrl: config.anamApiUrl } } : {})
    });

    client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
      const previous = messages.get(event.id);
      messages.set(event.id, {
        id: event.id,
        role: event.role === "user" ? "user" : "persona",
        content: `${previous?.content || ""}${event.content || ""}`
      });
      renderMessages();
    });
    client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
      client = null;
      setStatus("idle");
    });

    await client.streamToVideoElement("support-avatar-video");
    setStatus("connected");
  } catch (error) {
    console.error(error);
    client = null;
    setError(error instanceof Error ? error.message : String(error));
    setStatus("error");
  }
}

async function stop() {
  try {
    await client?.stopStreaming();
  } catch {}
  client = null;
  setStatus("idle");
}

startButton.addEventListener("click", start);
stopButton.addEventListener("click", stop);
prevButton.addEventListener("click", () => {
  if (!presets.length || status !== "idle") return;
  selectedIndex = (selectedIndex - 1 + presets.length) % presets.length;
  preview.src = currentPreset().previewImage;
  renderPersonas();
});
nextButton.addEventListener("click", () => {
  if (!presets.length || status !== "idle") return;
  selectedIndex = (selectedIndex + 1) % presets.length;
  preview.src = currentPreset().previewImage;
  renderPersonas();
});

preview.src = currentPreset()?.previewImage || "/support-avatar-preview.png";
renderPersonas();
setStatus("idle");
if (!presets.length) setError("No hay personas de soporte configuradas.");
