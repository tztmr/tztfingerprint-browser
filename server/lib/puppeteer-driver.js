import puppeteer from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createSocks5Forwarder } from './socks5-forwarder.js'
import { defaultFingerprint } from './cdp.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const sessions = {}
let chromeInfoCache = null

function stealthInitSource(fp) {
  return `(() => {
    const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); } catch (_) {} }
    def(navigator, 'webdriver', undefined)
    def(navigator, 'languages', ${JSON.stringify(fp.languages)})
    def(navigator, 'language', ${JSON.stringify(fp.languages[0])})
    def(navigator, 'platform', ${JSON.stringify(fp.platform)})
    def(navigator, 'userAgent', ${JSON.stringify(fp.userAgent || '')})
    def(navigator, 'vendor', ${JSON.stringify(fp.vendor)})
    def(navigator, 'productSub', ${JSON.stringify(fp.productSub)})
    def(navigator, 'maxTouchPoints', ${JSON.stringify(fp.maxTouchPoints)})
    def(navigator, 'hardwareConcurrency', ${JSON.stringify(fp.hardwareConcurrency)})
    def(navigator, 'deviceMemory', ${JSON.stringify(fp.deviceMemory)})
    if (!window.chrome) window.chrome = { runtime: {} }
    try {
      const c = document.createElement('canvas')
      const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl')
      if (${fp.noiseCanvas ? 'true' : 'false'}) {
        const getImageData = HTMLCanvasElement.prototype.toDataURL
        HTMLCanvasElement.prototype.toDataURL = function() {
          const ctx = this.getContext('2d')
          if (ctx) {
            const { width, height } = this
            const imgData = ctx.getImageData(0, 0, width, height)
            for (let i = 0; i < imgData.data.length; i += 4) { imgData.data[i] ^= 0x01 }
            ctx.putImageData(imgData, 0, 0)
          }
          return getImageData.apply(this, arguments)
        }
      }
      if (${fp.noiseWebGL ? 'true' : 'false'} && gl) {
        const getP = WebGLRenderingContext.prototype.getParameter
        WebGLRenderingContext.prototype.getParameter = function(param) {
          if (param === 37445) return ${JSON.stringify(fp.vendor)}
          if (param === 37446) return ${JSON.stringify(fp.renderer)}
          return getP.apply(this, arguments)
        }
      }
    } catch {}
    try {
      const conn = ${JSON.stringify(fp.connection)}
      const api = {
        effectiveType: conn.effectiveType || '4g', rtt: conn.rtt || 50, downlink: conn.downlink || 10, saveData: !!conn.saveData,
        onchange: null, addEventListener: () => {}, removeEventListener: () => {}
      }
      def(navigator, 'connection', api)
    } catch {}
  })();`
}

function proxyFlagFromHostPort(host, port) {
  if (!host || !port) return null
  return `--proxy-server=socks5://${host}:${port}`
}

function findLocalChrome() {
  const platform = os.platform()
  const candidates = []
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    )
  } else if (platform === 'win32') {
    const pf = 'C:/Program Files'
    const pfx = 'C:/Program Files (x86)'
    const local = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : 'C:/Users/Default/AppData/Local')
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pfx, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Chromium', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pfx, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(pfx, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    )
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome', '/snap/bin/chromium', '/usr/bin/brave-browser', '/usr/bin/microsoft-edge'
    )
  }
  for (const p of candidates) { try { if (fs.existsSync(p)) return p } catch {} }
  return null
}

function findBundledChrome() {
  const vendorDir = path.join(__dirname, '..', 'vendor')
  const platform = os.platform()
  const candidates = []
  if (platform === 'darwin') {
    candidates.push(
      path.join(vendorDir, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      path.join(vendorDir, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      path.join(vendorDir, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
      path.join(vendorDir, 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser')
    )
  } else if (platform === 'win32') {
    candidates.push(
      path.join(vendorDir, 'chrome-win', 'chrome.exe'),
      path.join(vendorDir, 'chromium-win', 'chrome.exe'),
      path.join(vendorDir, 'edge-win', 'msedge.exe'),
      path.join(vendorDir, 'brave-win', 'brave.exe')
    )
  } else if (platform === 'linux') {
    candidates.push(
      path.join(vendorDir, 'chrome-linux', 'chrome'),
      path.join(vendorDir, 'chromium-linux', 'chromium'),
      path.join(vendorDir, 'brave-linux', 'brave-browser'),
      path.join(vendorDir, 'edge-linux', 'microsoft-edge')
    )
  }
  for (const p of candidates) { try { if (fs.existsSync(p)) return p } catch {} }
  return null
}

export async function openSession(profile) {
  if (sessions[profile.id]) return sessions[profile.id]
  const fpRaw = { ...defaultFingerprint, ...(profile.fingerprint || {}) }
  const level = (profile.preferred && profile.preferred.stealth) ? String(profile.preferred.stealth).toLowerCase() : null
  const stealthPrefs = (() => {
    if (level === 'light') return { noiseCanvas: false, noiseWebGL: false, audioNoise: false, spoofPlugins: false }
    if (level === 'standard') return { noiseCanvas: true, noiseWebGL: true, audioNoise: false, spoofPlugins: true }
    if (level === 'heavy') return { noiseCanvas: true, noiseWebGL: true, audioNoise: true, spoofPlugins: true }
    return {}
  })()
  const fpMerged = { ...fpRaw, ...stealthPrefs }
  const fp = { ...fpMerged, userAgent: fpMerged.userAgent && fpMerged.userAgent.includes('HeadlessChrome/') ? fpMerged.userAgent.replace('HeadlessChrome/', 'Chrome/') : fpMerged.userAgent }
  const args = [
    `--user-data-dir=${profile.userDataDir}`,
    `--lang=${fp.locale}`,
    `--force-webrtc-ip-handling-policy=${fp.webrtcPolicy}`,
    '--disable-quic',
    '--proxy-bypass-list=<-loopback>',
    '--no-first-run',
    '--no-default-browser-check'
  ]
  let forwarder = null
  const { proxy } = profile || {}
  if (proxy && proxy.host && proxy.port) {
    forwarder = await createSocks5Forwarder({
      upstreamHost: proxy.host,
      upstreamPort: Number(proxy.port),
      username: proxy.username || null,
      password: proxy.password || null,
      bindHost: '127.0.0.1',
      bindPort: 0,
      timeoutMs: 15000
    })
    const pflag = proxyFlagFromHostPort('127.0.0.1', forwarder.port)
    if (pflag) args.push(pflag)
  }
  const chosenPath = process.env.CHROME_PATH || findLocalChrome() || findBundledChrome()
  if (!chosenPath) {
    throw new Error('未找到可用的 Chrome/Chromium 可执行文件。请安装 Google Chrome 或 Chromium，或设置环境变量 CHROME_PATH 指向浏览器可执行文件（示例：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome）。也支持 Edge/Brave 的可执行路径。')
  }
  const browser = await puppeteer.launch({ executablePath: chosenPath, headless: false, args, defaultViewport: null })
  sessions[profile.id] = { browser, fingerprint: fp, forwarder, netLogs: [] }
  return makeContext(profile.id)
}

function makeContext(id) {
  return {
    async newPage(initialUrl = 'about:blank') {
      const sess = sessions[id]
      if (!sess) throw new Error('session not running')
      const { browser, fingerprint } = sess
      const page = await browser.newPage()
      // Network diagnostics
      try {
        const logs = sess.netLogs || (sess.netLogs = [])
        const push = (type, payload) => { logs.push({ ts: Date.now(), type, payload }); if (logs.length > 200) logs.shift() }
        page.on('request', (req) => push('request', { url: req.url(), method: req.method(), resourceType: req.resourceType() }))
        page.on('response', async (res) => {
          try { push('response', { url: res.url(), status: res.status(), mimeType: res.headers()['content-type'] || '' }) } catch {}
        })
        page.on('requestfailed', (req) => push('failed', { url: req.url(), errorText: req.failure()?.errorText }))
      } catch {}
      // Headers: Accept-Language + UA-CH hints
      try {
        const langs = Array.isArray(fingerprint.languages) ? fingerprint.languages : [fingerprint.locale]
        const acceptLang = langs.map((l, i) => i === 0 ? l : `${l};q=${(0.9 - i * 0.1).toFixed(1)}`).join(',')
        const headers = { 'Accept-Language': acceptLang }
        const brands = fingerprint.userAgentBrands
        if (brands && brands.length) {
          const secUa = brands.map(b => `"${b.brand}";v="${b.version}"`).join(', ')
          headers['sec-ch-ua'] = secUa
          headers['sec-ch-ua-platform'] = `"${fingerprint.uaPlatform || 'macOS'}"`
          headers['sec-ch-ua-mobile'] = '?0'
        }
        await page.setExtraHTTPHeaders(headers)
      } catch {}
      // UA / locale / timezone stealth
      try {
        if (fingerprint.userAgent) { await page.setUserAgent(fingerprint.userAgent) }
        if (fingerprint.timezoneId) { await page.emulateTimezone(fingerprint.timezoneId) }
        await page.evaluateOnNewDocument(stealthInitSource(fingerprint))
      } catch {}
      if (initialUrl && initialUrl !== 'about:blank') {
        try { await page.goto(initialUrl, { waitUntil: 'load' }) } catch {}
      }
      return {
        async goto(url) { await page.goto(url, { waitUntil: 'load' }) },
        async evaluate(fn, arg) { return page.evaluate(fn, arg) },
        async close() { try { await page.close() } catch {} }
      }
    },
    async cookies(domain) {
      const sess = sessions[id]
      const { browser } = sess
      const page = await browser.newPage()
      const client = await page.target().createCDPSession()
      await client.send('Network.enable')
      const urls = domain ? [`https://${domain}`, `http://${domain}`] : []
      const { cookies } = await client.send('Network.getCookies', { urls })
      await client.detach()
      await page.close()
      return cookies
    },
    async addCookies(cookies) {
      const sess = sessions[id]
      const { browser } = sess
      const page = await browser.newPage()
      try { await page.setCookie(...cookies) } finally { try { await page.close() } catch {} }
    }
  }
}

export function getContext(id) {
  if (!sessions[id]) return null
  return makeContext(id)
}

export async function closeSession(id) {
  const sess = sessions[id]
  if (!sess) return
  try { await sess.browser.close() } catch {}
  try { if (sess.forwarder && typeof sess.forwarder.close === 'function') sess.forwarder.close() } catch {}
  delete sessions[id]
}

export async function getChromeInfo() {
  if (chromeInfoCache) return chromeInfoCache
  const chosenPath = process.env.CHROME_PATH || findLocalChrome() || findBundledChrome()
  if (!chosenPath) throw new Error('未找到 Chrome/Chromium/Edge/Brave，可安装本机或设置 CHROME_PATH，或在 server/vendor 中提供内置浏览器')
  const browser = await puppeteer.launch({ executablePath: chosenPath, headless: true, args: ['--no-first-run', '--no-default-browser-check'] })
  const product = await browser.version()
  const userAgent = await browser.userAgent()
  await browser.close()
  chromeInfoCache = { version: product, userAgent, executablePath: chosenPath }
  return chromeInfoCache
}