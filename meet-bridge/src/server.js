import express from "express";
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const app = express();
const port = Number(process.env.PORT || 3200);
const seleniumUrl = process.env.SELENIUM_REMOTE_URL || "http://meet-browser-sofia:4444/wd/hub";
const defaultMeetUrl = process.env.MEET_DEFAULT_URL || "";
const displayName = process.env.MEET_AGENT_DISPLAY_NAME || "Sofia";
const vncPort = process.env.MEET_BROWSER_NOVNC_PORT || "7900";

let driver;
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

async function browserDriver() {
  if (driver) return driver;
  const options = new chrome.Options()
    .addArguments(
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
      "--window-size=1366,768",
      "--user-data-dir=/home/seluser/chrome-profile"
    );
  driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .usingServer(seleniumUrl)
    .build();
  return driver;
}

async function findClickable(driverInstance, candidates, timeoutMs = 2500) {
  for (const candidate of candidates) {
    try {
      const element = await driverInstance.wait(until.elementLocated(candidate), timeoutMs);
      await driverInstance.wait(until.elementIsVisible(element), timeoutMs);
      await driverInstance.wait(until.elementIsEnabled(element), timeoutMs);
      return element;
    } catch {}
  }
  return null;
}

async function clickFirst(driverInstance, candidates, timeoutMs = 2500) {
  const element = await findClickable(driverInstance, candidates, timeoutMs);
  if (!element) return false;
  await element.click();
  return true;
}

async function maybePrepareMeet(driverInstance) {
  await driverInstance.sleep(3500);
  await clickFirst(driverInstance, [
    By.css("button[aria-label*='Turn off microphone']"),
    By.css("button[aria-label*='Desactivar mic']"),
    By.css("button[aria-label*='microphone']"),
    By.css("button[aria-label*='mic']")
  ], 1200);
  await clickFirst(driverInstance, [
    By.css("button[aria-label*='Turn off camera']"),
    By.css("button[aria-label*='Desactivar c']"),
    By.css("button[aria-label*='camera']"),
    By.css("button[aria-label*='cámara']")
  ], 1200);
  const nameInput = await findClickable(driverInstance, [
    By.css("input[aria-label*='Your name']"),
    By.css("input[aria-label*='Tu nombre']"),
    By.css("input[aria-label*='Nombre']")
  ], 1000);
  if (nameInput) {
    await nameInput.clear();
    await nameInput.sendKeys(displayName);
  }
}

async function joinMeet(meetUrl) {
  const driverInstance = await browserDriver();
  setState({ status: "joining", meetUrl, message: "Abriendo Google Meet." });
  await driverInstance.get(meetUrl);
  await maybePrepareMeet(driverInstance);
  const joined = await clickFirst(driverInstance, [
    By.xpath("//button[.//*[contains(text(),'Join now')] or contains(.,'Join now')]"),
    By.xpath("//button[.//*[contains(text(),'Ask to join')] or contains(.,'Ask to join')]"),
    By.xpath("//button[.//*[contains(text(),'Unirse ahora')] or contains(.,'Unirse ahora')]"),
    By.xpath("//button[.//*[contains(text(),'Solicitar unirse')] or contains(.,'Solicitar unirse')]"),
    By.xpath("//button[.//*[contains(text(),'Participar ahora')] or contains(.,'Participar ahora')]")
  ], 10000);
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
  const vncUrl = `${scheme}://${host}:${vncPort}/`;
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
    <p><a class="button" href="${vncUrl}" target="_blank">Abrir consola noVNC</a><a class="button" href="/login" target="_blank">Abrir login Google</a></p>
    <form method="post" action="/join">
      <label>URL de Google Meet</label>
      <input name="meetUrl" value="${defaultMeetUrl}">
      <button type="submit">Entrar a Meet</button>
    </form>
    <form method="post" action="/close">
      <button type="submit">Cerrar navegador</button>
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
    const driverInstance = await browserDriver();
    await driverInstance.get("https://accounts.google.com/");
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
    if (driver) await driver.quit();
    driver = null;
    setState({ status: "idle", message: "Navegador cerrado." });
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
