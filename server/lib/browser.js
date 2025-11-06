import { chromium } from 'playwright-core'

export const sessions = {}

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
    // webdriver
    def(navigator, 'webdriver', undefined)
    // languages / language
    def(navigator, 'languages', ${JSON.stringify(fp.languages)})
    def(navigator, 'language', ${JSON.stringify(fp.languages[0])})
    // platform
    def(navigator, 'platform', ${JSON.stringify(fp.platform)})
    // hardwareConcurrency & deviceMemory
    def(navigator, 'hardwareConcurrency', ${JSON.stringify(fp.hardwareConcurrency)})
    def(navigator, 'deviceMemory', ${JSON.stringify(fp.deviceMemory)})
    // window.chrome
    if (!window.chrome) window.chrome = { runtime: {} }
    // plugins & mimeTypes spoof
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
    // permissions.query override (notifications)
    if (navigator.permissions && navigator.permissions.query) {
      const orig = navigator.permissions.query
      navigator.permissions.query = (p) => {
        if (p && p.name === 'notifications') return Promise.resolve({ state: 'granted' })
        return orig(p)
      }
    }
    // WebGL vendor/renderer
    if (${fp.noiseWebGL ? 'true' : 'false'}) {
      const getParameter = WebGLRenderingContext && WebGLRenderingContext.prototype && WebGLRenderingContext.prototype.getParameter
      if (getParameter) {
        WebGLRenderingContext.prototype.getParameter = function (param) {
          if (param === 37445) return ${JSON.stringify(fp.vendor)} // UNMASKED_VENDOR_WEBGL
          if (param === 37446) return ${JSON.stringify(fp.renderer)} // UNMASKED_RENDERER_WEBGL
          return getParameter.call(this, param)
        }
      }
    }
    // Canvas fingerprint noise
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

function proxyToPlaywright(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return undefined
  const auth = proxy.username && proxy.password ? `${proxy.username}:${proxy.password}@` : ''
  const server = `socks5://${auth}${proxy.host}:${proxy.port}`
  return { server }
}

export async function openSession(profile) {
  if (sessions[profile.id]) return makeContext(profile.id)
  const proxy = proxyToPlaywright(profile.proxy)
  const fp = { ...defaultFingerprint, ...(profile.fingerprint || {}) }
  const opts = {
    headless: false,
    proxy,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    userAgent: fp.userAgent || undefined,
    args: [
      `--lang=${fp.locale}`,
      `--force-webrtc-ip-handling-policy=${fp.webrtcPolicy}`,
      '--disable-quic'
    ]
  }
  if (process.env.CHROME_PATH) {
    opts.executablePath = process.env.CHROME_PATH
  } else {
    opts.channel = 'chrome'
  }
  const context = await chromium.launchPersistentContext(profile.userDataDir, opts)
  await context.addInitScript({ content: stealthInitSource(fp) })
  sessions[profile.id] = { context, fingerprint: fp }
  return makeContext(profile.id)
}

function makeContext(id) {
  const sess = sessions[id]
  if (!sess) return null
  const { context, fingerprint } = sess
  return {
    async newPage(initialUrl = 'about:blank') {
      const page = await context.newPage()
      // Align Accept-Language header with fingerprint.languages
      try {
        const langs = Array.isArray(fingerprint.languages) ? fingerprint.languages : [fingerprint.locale]
        const header = { 'Accept-Language': langs.map((l, i) => i === 0 ? l : `${l};q=${(0.9 - i * 0.1).toFixed(1)}`).join(',') }
        await page.setExtraHTTPHeaders(header)
      } catch {}
      if (initialUrl && initialUrl !== 'about:blank') {
        try { await page.goto(initialUrl) } catch {}
      }
      return {
        async goto(url) { await page.goto(url) },
        async evaluate(fn, arg) { return page.evaluate(fn, arg) },
        async close() { await page.close() }
      }
    },
    async cookies(domain) {
      try {
        const urls = domain ? [`https://${domain}`, `http://${domain}`] : undefined
        return await context.cookies(urls)
      } catch (e) {
        throw e
      }
    },
    async addCookies(cookies) {
      await context.addCookies(cookies)
    }
  }
}

export function getContext(id) {
  return makeContext(id)
}

export async function closeSession(id) {
  const sess = sessions[id]
  if (!sess) return
  try { await sess.context.close() } catch {}
  delete sessions[id]
}

export async function getChromeInfo() {
  const opts = { headless: true }
  if (process.env.CHROME_PATH) {
    opts.executablePath = process.env.CHROME_PATH
  } else {
    opts.channel = 'chrome'
  }
  const browser = await chromium.launch(opts)
  const version = browser.version()
  await browser.close()
  return {
    version,
    channel: opts.channel || null,
    executablePath: opts.executablePath || null
  }
}