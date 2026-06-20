import express from "express";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const app = express();
const require = createRequire(import.meta.url);
const port = Number(process.env.PORT || 3200);
const debugUrl = process.env.MEET_BROWSER_DEBUG_URL || "http://meet-browser-sofia:9222";
const defaultMeetUrl = process.env.MEET_DEFAULT_URL || "";
const displayName = process.env.MEET_AGENT_DISPLAY_NAME || "Sofia";
const vncPort = process.env.MEET_BROWSER_NOVNC_PORT || "7900";
const anamApiUrl = process.env.ANAM_API_URL || "https://api.anam.ai";
const anamApiKey = process.env.ANAM_API_KEY || "";
const elevenLabsApiKey = process.env.SUPPORT_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || "";
const meetAvatarId = process.env.MEET_ANAM_AVATAR_ID || process.env.SUPPORT_PERSONA_2_AVATAR_ID || "";
const meetAgentId = process.env.MEET_ELEVENLABS_AGENT_ID || process.env.SUPPORT_PERSONA_2_AGENT_ID || "";
const anamSdkSource = readFileSync(require.resolve("@anam-ai/js-sdk/dist/umd/anam.js"), "utf8");

let browser;
let page;
let state = {
  status: "idle",
  meetUrl: "",
  message: "Meet bridge listo."
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function setState(next) {
  state = {
    ...state,
    ...next,
    updatedAt: new Date().toISOString()
  };
  console.log(JSON.stringify(state));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function browserWebSocketEndpoint() {
  const response = await fetch(`${debugUrl}/json/version`);
  if (!response.ok) throw new Error(`Chromium remoto no disponible: ${response.status}`);
  const data = await response.json();
  if (!data.webSocketDebuggerUrl) throw new Error("Chromium remoto no expuso webSocketDebuggerUrl.");
  const debug = new URL(debugUrl);
  const websocket = new URL(data.webSocketDebuggerUrl);
  websocket.hostname = debug.hostname;
  websocket.port = debug.port;
  return websocket.toString();
}

async function browserInstance() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.connect({
    browserWSEndpoint: await browserWebSocketEndpoint(),
    defaultViewport: { width: 1366, height: 768 }
  });
  await browser.defaultBrowserContext().overridePermissions("https://meet.google.com", ["camera", "microphone"]).catch(() => {});
  browser.on("disconnected", () => {
    browser = null;
    page = null;
    setState({ status: "idle", message: "Navegador desconectado." });
  });
  return browser;
}

async function activePage() {
  const instance = await browserInstance();
  if (page && !page.isClosed()) return page;
  const pages = await instance.pages();
  page = pages.find((candidate) => candidate.url().startsWith("https://meet.google.com/"))
    || pages.find((candidate) => !candidate.url().startsWith("devtools://"))
    || await instance.newPage();
  page.setDefaultTimeout(5000);
  await page.bringToFront().catch(() => {});
  return page;
}

async function clickButtonByText(pageInstance, labels) {
  return pageInstance.evaluate((buttonLabels) => {
    const normalizedLabels = buttonLabels.map((item) => item.toLowerCase());
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const button = buttons.find((candidate) => {
      const text = [
        candidate.innerText,
        candidate.textContent,
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("data-tooltip")
      ].filter(Boolean).join(" ").toLowerCase();
      return normalizedLabels.some((label) => text.includes(label));
    });
    if (!button) return false;
    button.click();
    return true;
  }, labels);
}

async function clickButtonByAria(pageInstance, labels) {
  return pageInstance.evaluate((buttonLabels) => {
    const normalizedLabels = buttonLabels.map((item) => item.toLowerCase());
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const button = buttons.find((candidate) => {
      const label = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("data-tooltip"),
        candidate.innerText,
        candidate.textContent
      ].filter(Boolean).join(" ").toLowerCase();
      return normalizedLabels.some((item) => label.includes(item));
    });
    if (!button) return false;
    button.click();
    return true;
  }, labels);
}

async function fillNameIfPresent(pageInstance) {
  await pageInstance.evaluate((name) => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const input = inputs.find((candidate) => {
      const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.placeholder || ""}`.toLowerCase();
      return label.includes("your name") || label.includes("tu nombre") || label.includes("nombre");
    });
    if (!input) return false;
    input.focus();
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, displayName).catch(() => false);
}

async function enableMediaIfOff(pageInstance) {
  await clickButtonByAria(pageInstance, [
    "turn on microphone",
    "activar mic",
    "activar el mic",
    "activar microfono",
    "activar micrófono",
    "unmute"
  ]).catch(() => false);
  await clickButtonByAria(pageInstance, [
    "turn on camera",
    "activar cam",
    "activar la cam",
    "activar camara",
    "activar cámara",
    "start video"
  ]).catch(() => false);
}

async function createAnamSessionToken() {
  if (!anamApiKey) throw new Error("ANAM_API_KEY no esta configurada en meet-bridge.");
  if (!elevenLabsApiKey) throw new Error("SUPPORT_ELEVENLABS_API_KEY no esta configurada en meet-bridge.");
  if (!meetAvatarId || !meetAgentId) throw new Error("Sofia no tiene avatarId/agentId configurados para Meet.");

  const signedUrlRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(meetAgentId)}`,
    { headers: { "xi-api-key": elevenLabsApiKey } }
  );
  if (!signedUrlRes.ok) {
    throw new Error(`ElevenLabs signed URL error: ${signedUrlRes.status} ${await signedUrlRes.text()}`);
  }
  const { signed_url: signedUrl } = await signedUrlRes.json();
  const tokenRes = await fetch(`${anamApiUrl}/v1/auth/session-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${anamApiKey}`
    },
    body: JSON.stringify({
      personaConfig: { avatarId: meetAvatarId },
      environment: {
        elevenLabsAgentSettings: { signedUrl, agentId: meetAgentId },
        ...(process.env.ANAM_POD_NAME ? { podName: process.env.ANAM_POD_NAME } : {})
      }
    })
  });
  if (!tokenRes.ok) {
    throw new Error(`Anam session token error: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const data = await tokenRes.json();
  if (!data.sessionToken) throw new Error("Anam no devolvio sessionToken.");
  return data.sessionToken;
}

async function injectSofiaMediaBridge(pageInstance) {
  const sessionToken = await createAnamSessionToken();
  await pageInstance.evaluateOnNewDocument(anamSdkSource);
  await pageInstance.evaluateOnNewDocument((config) => {
    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!originalGetUserMedia || window.__luzunoMeetBridgeInstalled) return;
    window.__luzunoMeetBridgeInstalled = true;
    window.__luzunoMeetBridgeState = { status: "installed", message: "Luzuno Meet bridge instalado." };

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function loadAnamSdk() {
      if (window.anam?.createClient) return;
      if (!window.anam?.createClient) throw new Error("No se pudo cargar el SDK de Anam en Meet.");
    }

    function createSilentAudioTrack() {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      return destination.stream.getAudioTracks()[0];
    }

    function createFallbackVideoTrack() {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      context.fillStyle = "#10233a";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#55c3f2";
      context.font = "52px Arial";
      context.fillText(config.displayName, 72, 120);
      return canvas.captureStream(15).getVideoTracks()[0];
    }

    async function createMeetAudioInput() {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const connected = new WeakSet();

      const connectElement = (element) => {
        if (connected.has(element) || element.id === "luzuno-sofia-video") return;
        if (typeof element.captureStream !== "function") return;
        try {
          const stream = element.captureStream();
          if (!stream.getAudioTracks().length) return;
          const source = context.createMediaStreamSource(stream);
          source.connect(destination);
          connected.add(element);
        } catch {}
      };

      const scan = () => {
        document.querySelectorAll("audio, video").forEach(connectElement);
      };
      scan();
      setInterval(scan, 1000);

      const fallback = await originalGetUserMedia({ audio: true }).catch(() => null);
      if (!destination.stream.getAudioTracks().length && fallback?.getAudioTracks().length) {
        try {
          context.createMediaStreamSource(fallback).connect(destination);
        } catch {}
      }
      return destination.stream.getAudioTracks().length ? destination.stream : fallback || new MediaStream([createSilentAudioTrack()]);
    }

    async function createSofiaStream() {
      if (window.__luzunoSofiaStreamPromise) return window.__luzunoSofiaStreamPromise;
      window.__luzunoSofiaStreamPromise = (async () => {
        window.__luzunoMeetBridgeState = { status: "starting", message: "Iniciando Sofia en Anam." };
        loadAnamSdk();

        const video = document.createElement("video");
        video.id = "luzuno-sofia-video";
        video.autoplay = true;
        video.playsInline = true;
        video.style.cssText = "position:fixed;right:12px;bottom:12px;width:220px;height:124px;z-index:2147483647;border:2px solid #55c3f2;background:#10233a;";
        document.documentElement.append(video);

        const micStream = await createMeetAudioInput();
        const client = window.anam.createClient(config.sessionToken, {
          ...(config.anamApiUrl ? { api: { baseUrl: config.anamApiUrl } } : {})
        });
        window.__luzunoAnamClient = client;
        await client.streamToVideoElement("luzuno-sofia-video", micStream);
        await video.play().catch(() => {});
        await wait(1000);

        const sourceStream = video.captureStream ? video.captureStream(30) : video.mozCaptureStream?.(30);
        const tracks = [];
        const videoTrack = sourceStream?.getVideoTracks()[0] || createFallbackVideoTrack();
        const audioTrack = sourceStream?.getAudioTracks()[0] || createSilentAudioTrack();
        tracks.push(videoTrack, audioTrack);
        window.__luzunoMeetBridgeState = { status: "streaming", message: "Sofia esta conectada a la camara y microfono de Meet." };
        return new MediaStream(tracks);
      })();
      return window.__luzunoSofiaStreamPromise;
    }

    navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
      const wantsVideo = Boolean(constraints.video);
      const wantsAudio = Boolean(constraints.audio);
      if (location.hostname === "meet.google.com" && (wantsVideo || wantsAudio)) {
        const sofiaStream = await createSofiaStream();
        return new MediaStream([
          ...(wantsVideo ? sofiaStream.getVideoTracks() : []),
          ...(wantsAudio ? sofiaStream.getAudioTracks() : [])
        ]);
      }
      return originalGetUserMedia(constraints);
    };
  }, {
    sessionToken,
    anamApiUrl,
    displayName
  });
}

async function maybePrepareMeet(pageInstance) {
  await pageInstance.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {});
  await sleep(2500);
  await enableMediaIfOff(pageInstance);
  await fillNameIfPresent(pageInstance);
  await pageInstance.bringToFront().catch(() => {});
}

async function leaveMeet() {
  const pageInstance = await activePage();
  await pageInstance.bringToFront().catch(() => {});
  const wasInMeet = pageInstance.url().startsWith("https://meet.google.com/");
  const left = await clickButtonByAria(pageInstance, [
    "leave call",
    "leave meeting",
    "hang up",
    "salir de la llamada",
    "salir de la reunion",
    "salir de la reunión",
    "abandonar llamada",
    "abandonar la llamada",
    "finalizar llamada"
  ]).catch(() => false);
  await sleep(1500);
  await pageInstance.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
  setState({
    status: "idle",
    meetUrl: "",
    message: left || wasInMeet
      ? `${displayName} salio de la reunion.`
      : "No habia una reunion activa; el navegador quedo en blanco."
  });
}

async function joinMeet(meetUrl) {
  const pageInstance = await activePage();
  setState({ status: "joining", meetUrl, message: "Abriendo Google Meet." });
  await injectSofiaMediaBridge(pageInstance);
  await pageInstance.goto(meetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await maybePrepareMeet(pageInstance);
  const joined = await clickButtonByText(pageInstance, [
    "join now",
    "ask to join",
    "join",
    "request to join",
    "unirse ahora",
    "unirme ahora",
    "solicitar unirse",
    "pedir unirme",
    "participar ahora",
    "unirse"
  ]).catch(() => false);
  await sleep(1500);
  setState({
    status: joined ? "in_meeting" : "needs_attention",
    meetUrl,
    message: joined
      ? `${displayName} intento entrar a la reunion.`
      : "No pude encontrar el boton de ingreso; revisar por noVNC."
  });
}

function html(req) {
  const host = req.get("host")?.split(":")[0] || "localhost";
  const scheme = req.protocol || "http";
  const vncUrl = `${scheme}://${host}:${vncPort}/vnc.html?autoconnect=true&resize=scale&password=`;
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Meet Bridge - Luzuno</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #13263a; background: #eef4f8; }
    main { max-width: 760px; margin: auto; background: white; border: 1px solid #d8e5ee; border-radius: 12px; padding: 24px; }
    input { width: 100%; box-sizing: border-box; padding: 12px; margin: 8px 0 16px; border: 1px solid #bfd1df; border-radius: 8px; }
    button, a.button { background: #123957; color: white; border: 0; padding: 11px 14px; border-radius: 8px; text-decoration: none; display: inline-flex; margin-right: 8px; cursor: pointer; }
    pre { background: #f2f6f9; padding: 12px; border-radius: 8px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <h1>Meet Bridge - ${displayName}</h1>
    <p>Use noVNC para iniciar sesion una vez con la cuenta Google del agente. Luego puede ordenar el ingreso a una reunion.</p>
    <p><a class="button" href="${vncUrl}" target="_blank">Abrir consola noVNC</a><a class="button" href="/login">Abrir login Google</a></p>
    <form method="post" action="/join">
      <label>URL de Google Meet</label>
      <input name="meetUrl" value="${defaultMeetUrl}">
      <button type="submit">Entrar a Meet</button>
    </form>
    <form method="post" action="/leave">
      <button type="submit">Salir de Meet</button>
    </form>
    <form method="post" action="/close">
      <button type="submit">Desconectar controlador tecnico</button>
    </form>
    <h2>Estado</h2>
    <pre>${JSON.stringify(state, null, 2)}</pre>
  </main>
</body>
</html>`;
}

app.get("/", (req, res) => res.type("html").send(html(req)));
app.get("/health", (_req, res) => res.json({ ok: true, state }));
app.get("/media-state", async (_req, res, next) => {
  try {
    const pageInstance = await activePage();
    const mediaState = await pageInstance.evaluate(() => ({
      url: location.href,
      bridge: window.__luzunoMeetBridgeState || null,
      hasAnamClient: Boolean(window.__luzunoAnamClient),
      localVideo: (() => {
        const video = document.getElementById("luzuno-sofia-video");
        if (!video) return null;
        const stream = video.captureStream?.();
        return {
          readyState: video.readyState,
          width: video.videoWidth,
          height: video.videoHeight,
          audioTracks: stream?.getAudioTracks().length || 0,
          videoTracks: stream?.getVideoTracks().length || 0
        };
      })(),
      mediaElements: Array.from(document.querySelectorAll("audio, video")).map((element) => ({
        id: element.id || "",
        tag: element.tagName,
        muted: element.muted,
        paused: element.paused,
        readyState: element.readyState,
        width: element.videoWidth || 0,
        height: element.videoHeight || 0
      })).slice(0, 20)
    })).catch((error) => ({ error: error.message }));
    res.json({ ok: true, state, mediaState });
  } catch (error) {
    next(error);
  }
});

app.get("/login", async (_req, res, next) => {
  try {
    const pageInstance = await activePage();
    await pageInstance.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    setState({ status: "login_required", message: "Complete el login por noVNC." });
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.post("/join", async (req, res, next) => {
  try {
    const meetUrl = String(req.body.meetUrl || "").trim();
    if (!/^https:\/\/meet\.google\.com\/[a-z-]+/i.test(meetUrl)) {
      return res.status(400).send("URL de Meet invalida.");
    }
    joinMeet(meetUrl).catch((error) => {
      console.error(error);
      setState({ status: "error", message: error.message });
    });
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.post("/leave", async (_req, res, next) => {
  try {
    leaveMeet().catch((error) => {
      console.error(error);
      setState({ status: "error", message: error.message });
    });
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.post("/close", async (_req, res, next) => {
  try {
    await leaveMeet().catch(() => {});
    await browser?.disconnect();
    browser = null;
    page = null;
    setState({ status: "idle", meetUrl: "", message: "Controlador tecnico desconectado y reunion cerrada." });
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  setState({ status: "error", message: error.message });
  res.status(500).send(`<pre>${String(error.stack || error.message || error)}</pre>`);
});

app.listen(port, () => {
  console.log(`Meet bridge listening on ${port}`);
});
