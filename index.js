import { connect } from "puppeteer-real-browser";
import fs from "fs";

class SmartPage {
  constructor(page, browser) {
    Object.setPrototypeOf(page, SmartPage.prototype); // extend Puppeteer's Page
    this.browser = browser;
    this.timesLoaded = 0;
    this._setupDone = false;
    return page;
  }

  async setup() {
    if (this._setupDone) return;
    this._setupDone = true;

    await this.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/116.0.0.0 Safari/537.36"
    );
    await this.setViewport({ width: 1366, height: 768 });

    // Load cookies if available
    try {
      const cookiesString = fs.readFileSync("cookies.json", "utf-8");
      const cookies = JSON.parse(cookiesString);
      await this.setCookie(...cookies);
      console.log("Cookies loaded from cookies.json");
    } catch {
      console.log("No cookies found, starting fresh.");
    }

    this.on("console", msg => {
      console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`);
    });
  }

  async goto(url, opts = { waitUntil: "domcontentloaded" }) {
    await this.setup();

    console.log("Navigating to:", url);
    await super.goto(url, opts);
    await this._handleCloudflare();

    // Auto reload every 31 minutes
    if (!this._reloadTimer) {
      this._reloadTimer = setInterval(() => this.reload(), 31 * 60 * 1000);
    }
  }

  async _handleCloudflare() {
    console.log("Waiting for possible Cloudflare challenge...");
    let title = await this.title();
    const start = Date.now();

    while (
      (title === "Just a moment..." ||
        title.includes("Checking your browser")) &&
      Date.now() - start < 60000
    ) {
      await new Promise(r => setTimeout(r, 500));
      title = await this.title();
    }
    console.log("Title after challenge:", title);

    await this.waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 })
      .catch(() => {});
    console.log("✅ Challenge passed! Final URL:", this.url());

    if (this.timesLoaded > 0) {
      await this.removeExposedFunction("updateStatus");
      await this.removeExposedFunction("reload");
    }
    this.timesLoaded++;

    await this.exposeFunction("updateStatus", ({ working, lastLog }) => {
      if (working !== undefined) {
        console.log("Status:", working ? "Working ✅" : "Stopped ❌");
      }
      if (lastLog) {
        console.log("Last log:", lastLog);
      }
    });

    await this.exposeFunction("reload", this.reload.bind(this));

    // Save cookies
    const newCookies = await this.cookies();
    fs.writeFileSync("cookies.json", JSON.stringify(newCookies, null, 2));
    console.log("Cookies saved to cookies.json");
  }

  async reload() {
    await super.reload();
    setTimeout(async () => {
      await this._handleCloudflare();
    }, 3000);
  }

  async exit() {
    const cookies = await this.cookies();
    fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
    console.log("Cookies saved. Exiting...");
    await this.browser.close();
    process.exit(0);
  }
}

// Wrap browser.newPage so all pages become SmartPage
function wrapBrowser(browser) {
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await origNewPage();
    return new SmartPage(page, browser);
  };
  return browser;
}

// Wrapper around connect() to return { browser, page }
export async function connectSmart(opts = {}) {
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    disableXvfb: false,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--enable-accelerated-2d-canvas",
      "--disable-software-rasterizer",
    ],
    ...opts,
  });

  const smartBrowser = wrapBrowser(browser);
  const smartPage = new SmartPage(page, smartBrowser);

  return { browser: smartBrowser, page: smartPage };
}
