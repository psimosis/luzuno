const countrySelect = document.getElementById("persona-country");
const genderSelect = document.getElementById("persona-gender");
const voiceSelect = document.getElementById("voice-select");
const voiceNameInput = document.getElementById("voice-name");
const playButton = document.getElementById("voice-play");
const audio = document.getElementById("voice-audio");

function selectedUserQuery() {
  const userInput = document.querySelector('input[name="userId"]');
  return userInput?.value ? `&userId=${encodeURIComponent(userInput.value)}` : "";
}

function syncVoiceName() {
  const option = voiceSelect?.selectedOptions?.[0];
  if (voiceNameInput) voiceNameInput.value = option?.dataset.name || option?.textContent || "";
}

async function refreshVoices() {
  if (!voiceSelect) return;
  const previous = voiceSelect.value;
  const params = new URLSearchParams({
    country: countrySelect?.value || "",
    gender: genderSelect?.value || ""
  });
  const userInput = document.querySelector('input[name="userId"]');
  if (userInput?.value) params.set("userId", userInput.value);
  const response = await fetch(`/api/voices?${params}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar las voces.");
  voiceSelect.innerHTML = '<option value="">Seleccionar voz</option>';
  for (const voice of body.voices || []) {
    const option = document.createElement("option");
    option.value = voice.voice_id;
    option.dataset.name = voice.name;
    option.dataset.preview = voice.preview_url || "";
    option.textContent = voice.name;
    if (voice.voice_id === previous) option.selected = true;
    voiceSelect.append(option);
  }
  syncVoiceName();
}

countrySelect?.addEventListener("change", () => {
  refreshVoices().catch(console.error);
});
genderSelect?.addEventListener("change", () => {
  refreshVoices().catch(console.error);
});
voiceSelect?.addEventListener("change", syncVoiceName);

playButton?.addEventListener("click", async () => {
  if (!voiceSelect?.value || !audio) return;
  const agentId = voiceSelect.dataset.agentId;
  audio.src = `/agents/${encodeURIComponent(agentId)}/voice-preview?voiceId=${encodeURIComponent(voiceSelect.value)}${selectedUserQuery()}`;
  await audio.play();
});

syncVoiceName();
