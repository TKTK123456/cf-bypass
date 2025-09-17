import { connect } from "puppeteer-real-browser";
import fs from "fs";
import blessed from "blessed";

// ====== Blessed UI setup ======
const screen = blessed.screen({
  smartCSR: true,
  title: 'Scraper'
});

// Top panel: fetch output
const fetchBox = blessed.box({
  top: 0,
  left: 0,
  width: '100%',
  height: '20%',
  label: 'Fetch Status',
  border: { type: 'line' },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'green' } },
  keys: true,
  vi: true
});

// Middle panel: main logs/status
const logBox = blessed.box({
  top: '20%',
  left: 0,
  width: '100%',
  height: '60%',
  label: 'Logs / Status',
  border: { type: 'line' },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'blue' } },
  keys: true,
  vi: true
});

// Bottom panel: command input
const inputBox = blessed.textbox({
  bottom: 0,
  left: 0,
  width: '100%',
  height: '20%',
  label: 'Command',
  border: { type: 'line' },
  inputOnFocus: true
});

screen.append(fetchBox);
screen.append(logBox);
screen.append(inputBox);
inputBox.focus();
screen.render();

// ====== Helpers ======
function appendLog(...text) {
  logBox.pushLine(text.join(" "));
  logBox.setScrollPerc(100);
  screen.render();
}

function fetchStatus(text, line) {
  const content = fetchBox.content.split("\n")
//  while (line>content.length) content.push("");
  content[line] = text
  fetchBox.setContent(content.join("\n"));
  screen.render();
}
// ====== Puppeteer setup ======
let page, browser;

let timesLoaded = 0

async function reload() {
 await page.reload();
 setTimeout(async () => {await load()}, 3000)
}

async function load() {
  // Wait for title to change (challenge)
  appendLog("Waiting for title to change from challenge page...");
  let title = await page.title();
  const start = Date.now();
  while ((title === "Just a moment..." || title.includes("Checking your browser")) &&
         Date.now() - start < 60000) {
    await new Promise(r => setTimeout(r, 500));
    title = await page.title();
  }
  appendLog("Title changed to: " + title);

  await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 }).catch(() => {});
  appendLog("✅ Challenge passed! Final URL: " + page.url());

  // Expose functions
  if (timesLoaded>0) {
    await page.removeExposedFunction('updateStatus')
    await page.removeExposedFunction('reload')
  }
  timesLoaded++
  await page.exposeFunction("updateStatus", ({ working, lastLog }, ...line) => {
    if (working !== undefined) fetchStatus("Status: " + (working ? "Working ✅" : "Stopped ❌"), line[1] || 0);
    if (lastLog) fetchStatus(lastLog,line[0] || 1);
   // appendLog(msg, line)
//    fetchStatus(msg, line)
  });
  await page.exposeFunction("reload", reload)
  // Inject fetch override
  await page.evaluate(() => {
    const oldFetch = window.fetch;
    window.__openfront_status = { working: true, lastLog: "Fetch override installed" };
    window.updateStatus(window.__openfront_status);

    window.fetch = async (url, ...args) => {
      const res = await oldFetch(url, ...args);

      if (url === "/api/public_lobbies") {
        const json = await res.clone().json();
        window.__openfront_status = {
          working: true,
          lastLog: `Intercepted ${url} (${json.lobbies.length} items)`
        };
        window.updateStatus(window.__openfront_status);

        // Send data to fetch box
        sendToOpenfrontPro(json);

        return { ok: true, json: async () => json };
      }
      return res;
    };

    async function sendToOpenfrontPro(payload) {
      try {
        const res = await oldFetch("https://openfront.pro/api/v1/lobbies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          window.__openfront_status = { working: false, lastLog: `Failed to send: ${res.status}` };
        } else {
          window.__openfront_status = { working: true, lastLog: "Data sent successfully" };
        }
      } catch (err) {
        window.__openfront_status = { working: false, lastLog: `Error: ${err.message}` };
        window.updateStatus(window.__openfront_status, [2]);
        await window.reload()
      }
      window.updateStatus(window.__openfront_status, [2]);
    }
  });

  // Save cookies
  const newCookies = await page.cookies();
  fs.writeFileSync("cookies.json", JSON.stringify(newCookies, null, 2));
  appendLog("Cookies saved to cookies.json");
}
(async () => {
  const { browser: b, page: p } = await connect({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--enable-accelerated-2d-canvas",
      "--disable-software-rasterizer",
    ],
    turnstile: true,
    disableXvfb: false
  });

  browser = b;
  page = p;

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/116.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });

  // Load cookies
  try {
    const cookiesString = fs.readFileSync("cookies.json", "utf-8");
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
    appendLog("Cookies loaded from cookies.json");
  } catch {
    appendLog("No cookies found, starting fresh.");
  }

  // Forward page console to logBox
  page.on("console", msg => {
    appendLog(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });

  // Navigate
  appendLog("Navigating to site...");
  await page.goto("https://openfront.io", { waitUntil: "domcontentloaded" });
  await load()
})();

// ===== Command handling =====
async function exit() {
  const cookies = await page.cookies();
  fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
  appendLog("Cookies saved. Exiting...");
  screen.render();
  await browser.close();
  process.exit(0);
}

inputBox.on('submit', async value => {
  const args = value.split(" ")
  const input = args.shift()
  appendLog(`> ${input}`);
  inputBox.clearValue();
  inputBox.focus();
  screen.render();
  if (input === 'exit') await exit();
  else if (input === 'title') appendLog("Page title: " + await page.title());
  else if (input === 'url') appendLog("Page URL: " + page.url());
  else if (input.startsWith('screenshot')) {
    if (args.length) {
      await page.screenshot({ path: args[0] });
      appendLog(`Screenshot saved as ${args[0]}`);
    } else appendLog("Usage: screenshot filename.png");
  } else if (input === 'help') appendLog("Commands: title, url, screenshot <file>, timesLoaded, reload, exit, help");
  else if (input === "reload") {
    await page.reload();
    setTimeout(async () => {await load()}, 3000)
  }
  else if (input === "timesLoaded") {
    appendLog(`The amount of times loaded is ${timesLoaded}`)
  }
  else appendLog(`Unknown command: ${input}`);
});

// Quit on Escape, q, or Ctrl-C
screen.key(['escape', 'q', 'C-c'], async () => await exit());
inputBox.key(['escape', 'C-c'], async () => await exit());
//inputBox.key(["e"], () =>{throw new Error("Test error")})
setInterval(reload, 31*60*1000)
