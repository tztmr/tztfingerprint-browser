import chromeLauncher from 'chrome-launcher'
import CDP from 'chrome-remote-interface'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const sessions = {}
let chromeInfoCache = null

export const defaultFingerprint = {
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  languages: ['zh-CN', 'zh'],
  platform: 'MacIntel',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  vendor: 'Google Inc.',
  renderer: 'ANGLE (Apple, Apple M2, Metal)',
  noiseCanvas: true,
  noiseWebGL: true,
  spoofPlugins: true,
  userAgent: null,
  webrtcPolicy: 'disable_non_proxied_udp'
}

function stealthInitSource(fp) {
  return `(() => {
    const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); } catch (_) {} }
    def(navigator, 'webdriver', undefined)
    def(navigator, 'languages', ${JSON.stringify(fp.languages)})
    def(navigator, 'language', ${JSON.stringify(fp.languages[0])})
    def(navigator, 'platform', ${JSON.stringify(fp.platform)})
    def(navigator, 'hardwareConcurrency', ${JSON.stringify(fp.hardwareConcurrency)})
    def(navigator, 'deviceMemory', ${JSON.stringify(fp.deviceMemory)})
    if (!window.chrome) window.chrome = { runtime: {} }
    if (${fp.spoofPlugins ? 'true' : 'false'}) {
      const fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client' }
      ]
      const PluginArray = function () {}
      PluginArray.prototype = {
        get length() { return fakePlugins.length },
        item: i => fakePlugins[i],
        namedItem: name => fakePlugins.find(p => p.name === name) || null,
        refresh: () => {}
      }
      def(navigator, 'plugins', new PluginArray())
      def(navigator, 'mimeTypes', [ { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: fakePlugins[1] } ])
    }
    if (navigator.permissions && navigator.permissions.query) {
      const orig = navigator.permissions.query
      navigator.permissions.query = (p) => {
        if (p && p.name === 'notifications') return Promise.resolve({ state: 'granted' })
        return orig(p)
      }
    }
    if (${fp.noiseWebGL ? 'true' : 'false'}) {
      const getParameter = WebGLRenderingContext && WebGLRenderingContext.prototype && WebGLRenderingContext.prototype.getParameter
      if (getParameter) {
        WebGLRenderingContext.prototype.getParameter = function (param) {
          if (param === 37445) return ${JSON.stringify(fp.vendor)}
          if (param === 37446) return ${JSON.stringify(fp.renderer)}
          return getParameter.call(this, param)
        }
      }
    }
    if (${fp.noiseCanvas ? 'true' : 'false'}) {
      const toDataURL = HTMLCanvasElement && HTMLCanvasElement.prototype && HTMLCanvasElement.prototype.toDataURL
      if (toDataURL) {
        HTMLCanvasElement.prototype.toDataURL = function () {
          const ctx = this.getContext('2d')
          if (ctx) {
            ctx.save()
            ctx.globalCompositeOperation = 'multiply'
            ctx.fillStyle = 'rgba(255,255,255,0.001)'
            ctx.fillRect(0, 0, this.width, this.height)
            ctx.restore()
          }
          return toDataURL.apply(this, arguments)
        }
      }
      const toBlob = HTMLCanvasElement && HTMLCanvasElement.prototype && HTMLCanvasElement.prototype.toBlob
      if (toBlob) {
        HTMLCanvasElement.prototype.toBlob = function () {
          const ctx = this.getContext('2d')
          if (ctx) {
            ctx.save()
            ctx.globalCompositeOperation = 'multiply'
            ctx.fillStyle = 'rgba(255,255,255,0.001)'
            ctx.fillRect(0, 0, this.width, this.height)
            ctx.restore()
          }
          return toBlob.apply(this, arguments)
        }
      }
    }
  })();`
}

function proxyFlag(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return null
  return `--proxy-server=socks5://${proxy.host}:${proxy.port}`
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
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/opt/google/chrome/chrome',
      '/snap/bin/chromium',
      '/usr/bin/brave-browser',
      '/usr/bin/microsoft-edge'
    )
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
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
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return null
}

export async function openSession(profile) {
  if (sessions[profile.id]) return sessions[profile.id]
  const fpRaw = { ...defaultFingerprint, ...(profile.fingerprint || {}) }
  const fp = { ...fpRaw, userAgent: fpRaw.userAgent && fpRaw.userAgent.includes('HeadlessChrome/') ? fpRaw.userAgent.replace('HeadlessChrome/', 'Chrome/') : fpRaw.userAgent }
  const flags = [
    `--user-data-dir=${profile.userDataDir}`,
    `--lang=${fp.locale}`,
    `--force-webrtc-ip-handling-policy=${fp.webrtcPolicy}`,
    '--no-first-run',
    '--no-default-browser-check'
  ]
  const pflag = proxyFlag(profile.proxy)
  if (pflag) flags.push(pflag)
  const chosenPath = process.env.CHROME_PATH || findLocalChrome() || findBundledChrome()
  let chrome
  try {
    chrome = await chromeLauncher.launch({
      chromePath: chosenPath,
      chromeFlags: flags
    })
  } catch (e) {
    const msg = '未找到可用的 Chrome/Chromium 可执行文件。请安装 Google Chrome 或 Chromium，或设置环境变量 CHROME_PATH 指向浏览器可执行文件（示例：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome）。也支持 Edge/Brave 的可执行路径。'
    throw new Error(msg)
  }
  const port = chrome.port
  const browser = await CDP({ port })
  sessions[profile.id] = { chrome, port, browser, fingerprint: fp }
  return makeContext(profile.id)
}

function makeContext(id) {
  return {
    async newPage(initialUrl = 'about:blank') {
      const sess = sessions[id]
      if (!sess) throw new Error('session not running')
      const { port, fingerprint } = sess
      const browser = await CDP({ port })
      // Prefer reusing the default startup tab (about:blank / chrome new tab)
      let targetId = null
      try {
        const { targetInfos } = await browser.Target.getTargets()
        const boot = (targetInfos || []).find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith('chrome://')))
        if (boot) targetId = boot.targetId
      } catch {}
      if (!targetId) {
        const created = await browser.Target.createTarget({ url: initialUrl || 'about:blank' })
        targetId = created.targetId
      }
      const page = await CDP({ port, target: targetId })
      await page.Page.enable()
      await page.Network.enable()
      // Align Accept-Language header with fingerprint.languages
      try {
        const langs = Array.isArray(fingerprint.languages) ? fingerprint.languages : [fingerprint.locale]
        const header = langs.map((l, i) => i === 0 ? l : `${l};q=${(0.9 - i * 0.1).toFixed(1)}`).join(',')
        await page.Network.setExtraHTTPHeaders({ headers: { 'Accept-Language': header } })
      } catch {}
      if (fingerprint.userAgent) {
        await page.Emulation.setUserAgentOverride({ userAgent: fingerprint.userAgent, platform: fingerprint.platform })
      }
      await page.Emulation.setLocaleOverride({ locale: fingerprint.locale })
      await page.Emulation.setTimezoneOverride({ timezoneId: fingerprint.timezoneId })
      await page.Page.addScriptToEvaluateOnNewDocument({ source: stealthInitSource(fingerprint) })
      // Navigate if a meaningful initialUrl is provided
      if (initialUrl && initialUrl !== 'about:blank') {
        try {
          await page.Page.navigate({ url: initialUrl })
          await page.Page.loadEventFired()
        } catch {}
      }
      return {
        async goto(url) {
          await page.Page.navigate({ url })
          await page.Page.loadEventFired()
        },
        async evaluate(fn, arg) {
          const expr = `(${fn})(...(${JSON.stringify([arg])}))`
          const { result } = await page.Runtime.evaluate({ expression: expr, returnByValue: true })
          return result?.value
        },
        async close() {
          await page.Target.closeTarget({ targetId })
          await page.close()
        }
      }
    },
    async cookies(domain) {
      const sess = sessions[id]
      const port = sess.port
      const browser = await CDP({ port })
      await browser.Network.enable()
      const urls = domain ? [`https://${domain}`, `http://${domain}`] : []
      const { cookies } = await browser.Network.getCookies({ urls })
      await browser.close()
      return cookies
    },
    async addCookies(cookies) {
      const sess = sessions[id]
      const port = sess.port
      const browser = await CDP({ port })
      await browser.Network.enable()
      await browser.Network.setCookies({ cookies })
      await browser.close()
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
  await sess.chrome.kill()
  delete sessions[id]
}

export async function getChromeInfo() {
  if (chromeInfoCache) return chromeInfoCache
  // Launch a temporary browser to read version (headless to avoid UI flicker)
  const chosenPath = process.env.CHROME_PATH || findLocalChrome() || findBundledChrome()
  let chrome
  try {
    chrome = await chromeLauncher.launch({ chromePath: chosenPath, chromeFlags: ['--headless=new', '--no-first-run', '--no-default-browser-check'] })
  } catch (e) {
    throw new Error('未找到 Chrome/Chromium/Edge/Brave，可安装本机或设置 CHROME_PATH，或在 server/vendor 中提供内置浏览器')
  }
  const browser = await CDP({ port: chrome.port })
  const { product, userAgent } = await browser.Browser.getVersion()
  await browser.close()
  await chrome.kill()
  chromeInfoCache = { version: product, userAgent, executablePath: chosenPath }
  return chromeInfoCache
}