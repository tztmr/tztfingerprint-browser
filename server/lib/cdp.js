import chromeLauncher from 'chrome-launcher'
import CDP from 'chrome-remote-interface'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createSocks5Forwarder } from './socks5-forwarder.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const sessions = {}
let chromeInfoCache = null

export const defaultFingerprint = {
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  languages: ['zh-CN', 'zh'],
  platform: 'MacIntel',
  uaPlatform: 'macOS',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  vendor: 'Google Inc.',
  renderer: 'ANGLE (Apple, Apple M2, Metal)',
  productSub: '20030107',
  maxTouchPoints: 0,
  noiseCanvas: true,
  noiseWebGL: true,
  spoofPlugins: true,
  audioNoise: true,
  connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false },
  userAgentBrands: null,
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
    def(navigator, 'userAgent', ${JSON.stringify(fp.userAgent || '')})
    def(navigator, 'vendor', ${JSON.stringify(fp.vendor)})
    def(navigator, 'productSub', ${JSON.stringify(fp.productSub)})
    def(navigator, 'maxTouchPoints', ${JSON.stringify(fp.maxTouchPoints)})
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
    if (${fp.audioNoise ? 'true' : 'false'}) {
      const AB = window.AudioBuffer && window.AudioBuffer.prototype
      if (AB && AB.getChannelData) {
        const orig = AB.getChannelData
        AB.getChannelData = function () {
          const data = orig.apply(this, arguments)
          const len = Math.min(50, data ? data.length : 0)
          for (let i = 0; i < len; i++) data[i] += 1e-7
          return data
        }
      }
    }
    // Patch Intl locale/timezone resolution to align
    try {
      const origResolved = Intl.DateTimeFormat.prototype.resolvedOptions
      Intl.DateTimeFormat.prototype.resolvedOptions = function () {
        const r = origResolved.call(new Intl.DateTimeFormat(${JSON.stringify(fp.locale)}))
        r.locale = ${JSON.stringify(fp.locale)}
        r.timeZone = ${JSON.stringify(fp.timezoneId)}
        return r
      }
    } catch (e) {}
    // Patch userAgentData for UA-CH consistency
    try {
      const brands = ${JSON.stringify(fp.userAgentBrands || [])}
      const platform = ${JSON.stringify(fp.uaPlatform)}
      const mobile = false
      const uaData = {
        brands,
        mobile,
        platform,
        getHighEntropyValues: async (hints) => {
          const out = { brands, mobile, platform }
          if (Array.isArray(hints)) {
            for (const h of hints) {
              if (h === 'architecture') out.architecture = 'arm'
              if (h === 'model') out.model = ''
              if (h === 'platformVersion') out.platformVersion = '14'
              if (h === 'uaFullVersion') out.uaFullVersion = brands?.[1]?.version || '120.0.0.0'
              if (h === 'bitness') out.bitness = '64'
            }
          }
          return out
        }
      }
      if (!navigator.userAgentData) {
        def(navigator, 'userAgentData', uaData)
      } else {
        try { Object.assign(navigator.userAgentData, uaData) } catch (_) {}
      }
    } catch (e) {}
    // Network Information API
    try {
      const conn = ${JSON.stringify(fp.connection || {})}
      if (conn && Object.keys(conn).length) {
        const api = {
          effectiveType: conn.effectiveType || '4g',
          rtt: conn.rtt || 50,
          downlink: conn.downlink || 10,
          saveData: !!conn.saveData,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {}
        }
        def(navigator, 'connection', api)
      }
    } catch (e) {}
  })();`
}

function proxyFlagFromHostPort(host, port) {
  if (!host || !port) return null
  // 为确保对所有浏览器变体兼容，使用通用的 socks5 方案
  // 注：这将使用本地解析 DNS；我们通过始终使用本地转发器来兼容需要鉴权的上游
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
    const pf = process.env["PROGRAMFILES"] || 'C:\\Program Files'
    const pfx = process.env["PROGRAMFILES(X86)"] || 'C:\\Program Files (x86)'
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
  if (platform === 'win32') {
    const regKeys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe'
    ]
    for (const key of regKeys) {
      try {
        const out = execSync(`reg query "${key}" /ve`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
        const line = out.split(/\r?\n/).find(l => /REG_/i.test(l)) || ''
        const exe = line.trim().split(/\s{2,}/).pop()
        if (exe && fs.existsSync(exe)) return exe
      } catch {}
    }
    const whereCmds = ['where chrome', 'where msedge', 'where brave']
    for (const cmd of whereCmds) {
      try {
        const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
        const paths = out.split(/\r?\n/).filter(Boolean)
        for (const p of paths) {
          try { if (fs.existsSync(p)) return p } catch {}
        }
      } catch {}
    }
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

function getPersistedChromePath() {
  try {
    const persistFile = path.join(__dirname, '..', 'data', 'browser-path.txt')
    if (fs.existsSync(persistFile)) {
      const p = fs.readFileSync(persistFile, 'utf8').trim()
      if (p && fs.existsSync(p)) return p
    }
  } catch {}
  return null
}

export async function openSession(profile, initialUrl = null) {
  if (sessions[profile.id]) return sessions[profile.id]
  const fpRaw = { ...defaultFingerprint, ...(profile.fingerprint || {}) }
  // Apply stealth level overrides without changing persisted fingerprint surface
  const level = (profile.preferred && profile.preferred.stealth) ? String(profile.preferred.stealth).toLowerCase() : null
  const stealthPrefs = (() => {
    if (level === 'light') return { noiseCanvas: false, noiseWebGL: false, audioNoise: false, spoofPlugins: false }
    if (level === 'standard') return { noiseCanvas: true, noiseWebGL: true, audioNoise: false, spoofPlugins: true }
    if (level === 'heavy') return { noiseCanvas: true, noiseWebGL: true, audioNoise: true, spoofPlugins: true }
    return {}
  })()
  const fpMerged = { ...fpRaw, ...stealthPrefs }
 const fp = { ...fpMerged, userAgent: fpMerged.userAgent && fpMerged.userAgent.includes('HeadlessChrome/') ? fpMerged.userAgent.replace('HeadlessChrome/', 'Chrome/') : fpMerged.userAgent }
 // Build launch flags with safer defaults. Avoid obsolete or highly-detectable flags.
 const flags = [
  `--user-data-dir=${profile.userDataDir}`,
  `--lang=${fp.locale}`,
  `--force-webrtc-ip-handling-policy=${fp.webrtcPolicy}`,
  '--disable-quic',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--mute-audio'
 ]
 // Apply platform-specific flags only where they are supported
 if (process.platform === 'linux') {
  flags.push('--password-store=basic', '--use-mock-keychain')
 }
 // Stealth: disable AutomationControlled only when not explicitly set to 'light'
 if (level !== 'light') {
  flags.push('--disable-blink-features=AutomationControlled')
 }

  // 可选：以 App 模式打开初始网址，避免工具栏与自动化横幅
  if (process.env.USE_APP_MODE === '1' && initialUrl && initialUrl !== 'about:blank') {
    flags.push(`--app=${initialUrl}`)
  }
  try {
    if (String(process.env.SANITIZE_PROFILE || '').trim() === '1') {
      const extDir = path.join(profile.userDataDir, 'Default', 'Extensions')
      if (fs.existsSync(extDir)) {
        fs.rmSync(extDir, { recursive: true, force: true })
      }
    }
  } catch {}
  // 与 Chrome 一致：无认证直连；有认证时使用本地转发器嵌入凭据
  let forwarder = null
  const { proxy } = profile || {}
  if (proxy && proxy.host && proxy.port) {
    const needAuth = Boolean(proxy.username) || Boolean(proxy.password)
    if (needAuth) {
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
      if (pflag) flags.push(pflag)
    } else {
      const pflag = proxyFlagFromHostPort(proxy.host, Number(proxy.port))
      if (pflag) flags.push(pflag)
    }
  }
  // Prefer a valid env-provided path only if it actually exists; otherwise fall back to local/bundled detection
  const envPath = process.env.CHROME_PATH
  const savedPath = getPersistedChromePath()
  const chosen = (envPath && (() => { try { return fs.existsSync(envPath) } catch { return false } })())
    ? envPath
    : (savedPath || findLocalChrome() || findBundledChrome())
  let chrome
  try {
    chrome = await chromeLauncher.launch({
      chromePath: chosen,
      chromeFlags: flags
    })
  } catch (e) {
    const msg = '未找到可用的 Chrome/Chromium 可执行文件。请安装浏览器，或手动指定路径：\n1) 设置环境变量 CHROME_PATH 指向可执行文件；\n2) 在 server/data/browser-path.txt 写入绝对路径；\n也支持 Edge/Brave 的可执行路径。'
    throw new Error(msg)
  }
  const port = chrome.port
  const browser = await CDP({ port })
  sessions[profile.id] = { chrome, port, browser, fingerprint: fp, forwarder, netLogs: [] }
  return makeContext(profile.id)
}

function makeContext(id) {
  return {
    async newPage(initialUrl = 'about:blank') {
      const sess = sessions[id]
      if (!sess) throw new Error('session not running')
      const { port, fingerprint } = sess
      const browser = await CDP({ port })
      // Prefer reuse existing page matching initialUrl, otherwise the default startup tab
      let targetId = null
      try {
        const { targetInfos } = await browser.Target.getTargets()
        if (initialUrl && initialUrl !== 'about:blank') {
          const match = (targetInfos || []).find(t => t.type === 'page' && t.url === initialUrl)
          if (match) targetId = match.targetId
        }
        if (!targetId) {
          const boot = (targetInfos || []).find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith('chrome://')))
          if (boot) targetId = boot.targetId
        }
      } catch {}
      if (!targetId) {
        const created = await browser.Target.createTarget({ url: initialUrl || 'about:blank' })
        targetId = created.targetId
      }
      const page = await CDP({ port, target: targetId })
      await page.Page.enable()
      await page.Network.enable()
      // capture network diagnostics for troubleshooting
      try {
        const sess = sessions[id]
        const logs = sess.netLogs || (sess.netLogs = [])
        const push = (type, payload) => {
          logs.push({ ts: Date.now(), type, payload })
          if (logs.length > 200) logs.shift()
        }
        page.on('Network.requestWillBeSent', (p) => {
          const { requestId, request, type } = p || {}
          push('request', { requestId, url: request?.url, method: request?.method, type })
        })
        page.on('Network.responseReceived', (p) => {
          const { requestId, response, type } = p || {}
          push('response', { requestId, url: response?.url, status: response?.status, mimeType: response?.mimeType, type })
        })
        page.on('Network.loadingFailed', (p) => {
          const { requestId, errorText, canceled, type } = p || {}
          push('failed', { requestId, errorText, canceled, type })
        })
      } catch {}
      // Align Accept-Language + UA-CH headers with fingerprint
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
        await page.Network.setExtraHTTPHeaders({ headers })
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
          // Clean up stray about:blank tabs if any remain after navigation
          try {
            const { targetInfos } = await browser.Target.getTargets()
            const blanks = (targetInfos || []).filter(t => {
              return t.type === 'page' && (t.url === 'about:blank' || String(t.url || '').startsWith('chrome://')) && t.targetId !== targetId
            })
            for (const t of blanks) {
              try { await page.Target.closeTarget({ targetId: t.targetId }) } catch {}
            }
          } catch {}
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
  try { if (sess.forwarder && typeof sess.forwarder.close === 'function') sess.forwarder.close() } catch {}
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