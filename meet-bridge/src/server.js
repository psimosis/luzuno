import express from "express";
import puppeteer from "puppeteer-core";

const app = express();
const port = Number(process.env.PORT || 3200);
const debugUrl = process.env.MEET_BROWSER_DEBUG_URL || "http://meet-browser-sofia:9222";
const defaultMeetUrl = process.env.MEET_DEFAULT_URL || "";
const displayName = process.env.MEET_AGENT_DISPLAY_NAME || "Sofia";
const vncPort = process.env.MEET_BROWSER_NOVNC_PORT || "7900";

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
  page = pages.find((candidate) => !candidate.url().startsWith("devtools://")) || await instance.newPage();
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

async function maybePrepareMeet(pageInstance) {
  await pageInstance.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {});
  await sleep(2500);
  await clickButtonByAria(pageInstance, ["turn off microphone", "desactivar mic", "microphone", "mic"]).catch(() => false);
  await clickButtonByAria(pageInstance, ["turn off camera", "desactivar cam", "desactivar c", "camera", "camara", "cámara"]).catch(() => false);
  await fillNameIfPresent(pageInstance);
  await pageInstance.bringToFront().catch(() => {});
}

async function joinMeet(meetUrl) {
  const pageInstance = await activePage();
  setState({ status: "joining", meetUrl, message: "Abriendo Google Meet." });
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
    <form method="post" action="/close">
      <button type="submit">Desconectar controlador</button>
    </form>
    <h2>Estado</h2>
    <pre>${JSON.stringify(state, null, 2)}</pre>
  </main>
</body>
</html>`;
}

app.get("/", (req, res) => res.type("html").send(html(req)));
app.get("/health", (_req, res) => res.json({ ok: true, state }));

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

app.post("/close", async (_req, res, next) => {
  try {
    await browser?.disconnect();
    browser = null;
    page = null;
    setState({ status: "idle", message: "Controlador desconectado." });
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
