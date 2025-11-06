import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import dns from 'dns/promises'
import { v4 as uuidv4 } from 'uuid'
// 切换到 Playwright 版以支持 socks5 用户名/密码代理
import { openSession, closeSession, sessions, getContext, getChromeInfo } from './lib/cdp.js'
import { execSync } from 'child_process'
import net from 'net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
// 提升全局 JSON 解析上限，避免导入上传体积较大时被默认 2MB 限制拦截
app.use(bodyParser.json({ limit: '200mb' }))
// 统一返回 JSON 错误（包括 bodyParser 的解析错误，如实体过大）
app.use((err, req, res, next) => {
  if (!err) return next()
  const status = err.status || err.statusCode || 400
  const type = err.type || ''
  if (type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大', limit: '200mb' })
  }
  res.status(status).json({ error: err.message || String(err) })
})

const dataDir = path.join(__dirname, 'data')
const profilesFile = path.join(dataDir, 'profiles.json')
const exportRoot = path.join(dataDir, 'exports')

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
if (!fs.existsSync(path.join(dataDir, 'profiles'))) fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true })
if (!fs.existsSync(profilesFile)) fs.writeFileSync(profilesFile, JSON.stringify([]))
if (!fs.existsSync(exportRoot)) fs.mkdirSync(exportRoot, { recursive: true })

function readProfiles() {
  return JSON.parse(fs.readFileSync(profilesFile, 'utf-8'))
}

function writeProfiles(list) {
fs.writeFileSync(profilesFile, JSON.stringify(list, null, 2))
}

function safeDirName(name) {
  const base = String(name || 'profile').trim()
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_\.\-]+/, '')
  return cleaned || 'profile'
}

function makeUniqueProfileDir(baseName) {
  const base = safeDirName(baseName)
  let dirName = base
  let userDataDir = path.join(dataDir, 'profiles', dirName)
  // 若重名则追加 _随机数，直到不冲突
  while (fs.existsSync(userDataDir)) {
    const suffix = Math.floor(1000 + Math.random() * 9000)
    dirName = `${base}_${suffix}`
    userDataDir = path.join(dataDir, 'profiles', dirName)
  }
  return { dirName, userDataDir }
}

function normalizeLocaleTag(loc) {
  if (!loc) return 'zh-CN'
  // examples: 'zh_CN.UTF-8', 'en_US', 'zh-CN'
  const cleaned = loc.replace('.UTF-8', '').replace('.utf8', '').replace('.utf-8', '')
  const parts = cleaned.includes('-') ? cleaned.split('-') : cleaned.split('_')
  const lang = (parts[0] || 'zh').toLowerCase()
  const region = (parts[1] || 'CN').toUpperCase()
  return `${lang}-${region}`
}

function pickNearby(value, choices) {
  // pick a plausible value from choices closest to given value
  let best = choices[0]
  let bestDiff = Math.abs(choices[0] - value)
  for (const c of choices) {
    const d = Math.abs(c - value)
    if (d < bestDiff) { best = c; bestDiff = d }
  }
  // small randomness among close values
  const neighbors = choices.filter(c => Math.abs(c - value) <= 2)
  return neighbors.length ? neighbors[Math.floor(Math.random() * neighbors.length)] : best
}

async function generateFingerprint(reqProxy, preferred) {
  // Helper: fetch IP geolocation from ipapi.co
  async function ipGeo(ip) {
    // First try ipapi.co
    const url1 = ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/'
    let countryCode = null
    let timezone = null
    let languages = null
    try {
      const resp1 = await fetch(url1)
      if (resp1.ok) {
        const data1 = await resp1.json()
        countryCode = (data1.country_code || '').toUpperCase() || null
        timezone = data1.timezone || null
        languages = (data1.languages || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      }
    } catch {}

    // Fallback to ip-api.com when ipapi has missing fields
    if (!countryCode || !timezone) {
      const url2 = ip ? `http://ip-api.com/json/${ip}` : 'http://ip-api.com/json/'
      try {
        const resp2 = await fetch(url2)
        if (resp2.ok) {
          const data2 = await resp2.json()
          countryCode = countryCode || ((data2.countryCode || '').toUpperCase() || null)
          timezone = timezone || (data2.timezone || null)
        }
      } catch {}
    }

    return { countryCode, timezone, languages: languages || [] }
  }

  // Helper: resolve proxy host to IP (best-effort)
  async function resolveProxyIP(proxy) {
    if (!proxy || !proxy.host) return null
    try {
      const res = await dns.lookup(proxy.host)
      return res?.address || null
    } catch {
      return null
    }
  }

  // Build locale from geolocation info
  function localeFromGeo(geo) {
    const country = (geo?.countryCode || 'US').toUpperCase()
    const first = (geo?.languages && geo.languages[0]) ? geo.languages[0] : primaryLanguageFromCountry(country)
    const lang = first.split('-')[0].toLowerCase()
    return `${lang}-${country}`
  }

  function primaryLanguageFromCountry(country) {
    const map = {
      CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh',
      JP: 'ja', KR: 'ko',
      DE: 'de', FR: 'fr', IT: 'it', ES: 'es', PT: 'pt', BR: 'pt', RU: 'ru', TR: 'tr',
      US: 'en', GB: 'en', AU: 'en', CA: 'en', IN: 'en', SG: 'en'
    }
    return map[country] || 'en'
  }

  // Compute IP-based geo first
  let geo = null
  try {
    const ip = await resolveProxyIP(reqProxy)
    geo = await ipGeo(ip)
  } catch {}
  if (!geo || !geo.timezone || !geo.countryCode) {
    try { geo = await ipGeo(null) } catch {}
  }
  const sysLocaleFallback = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().locale } catch { return null }
  })() || normalizeLocaleTag(process.env.LANG || 'zh-CN')
  const timezoneFallback = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'Asia/Shanghai' }
  })()

  // Preferred with 'auto' support (auto => use IP geo)
  const tzMap = { HK: 'Asia/Hong_Kong', CN: 'Asia/Shanghai', TW: 'Asia/Taipei' }
  const pref = preferred || {}
  const isAuto = v => !v || String(v).toLowerCase() === 'auto'
  const region = !isAuto(pref.region) ? String(pref.region).toUpperCase() : ((geo?.countryCode || '').toUpperCase() || 'CN')
  const langPref = !isAuto(pref.language) ? String(pref.language) : null
  let timezoneId = !isAuto(pref.timezoneId) ? String(pref.timezoneId) : (geo?.timezone || tzMap[region] || timezoneFallback)
  let locale, languages
  if (langPref === 'zh-Hant') {
    locale = `zh-${region}`
    languages = ['zh-Hant', locale, 'zh']
  } else if (langPref === 'zh-Hans') {
    locale = `zh-${region}`
    languages = [locale, 'zh-Hans', 'zh']
  } else if (langPref === 'en') {
    locale = `en-${region}`
    languages = [locale, 'en']
  } else {
    // auto language -> use IP geo derived
    locale = geo ? localeFromGeo(geo) : sysLocaleFallback
    const baseLang = locale.split('-')[0]
    languages = (() => {
      const cc = (geo?.countryCode || '').toUpperCase()
      if (cc === 'HK' || cc === 'TW' || cc === 'MO') return ['zh-Hant', locale, baseLang]
      if (cc === 'CN') return [locale, 'zh-Hans', baseLang]
      return [locale, baseLang]
    })()
  }

  // platform by OS
  const plt = os.platform()
  const platform = plt === 'darwin' ? 'MacIntel' : plt === 'win32' ? 'Win32' : 'Linux x86_64'

  // hardware concurrency & device memory (plausible stable values)
  const cpuCount = (os.cpus() || []).length || 8
  const hwChoices = [4, 6, 8, 12, 16]
  const hardwareConcurrency = pickNearby(cpuCount, hwChoices)
  const totalGB = Math.round((os.totalmem() || 8 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024))
  const memChoices = [4, 8, 16, 32]
  const deviceMemory = pickNearby(totalGB, memChoices)

  // userAgent from local Chrome info (stable)
  let userAgent = null
  try {
    const info = await getChromeInfo()
    userAgent = info.userAgent || null
    // Normalize Headless UA to non-headless to减少风控
    if (userAgent && userAgent.includes('HeadlessChrome/')) {
      userAgent = userAgent.replace('HeadlessChrome/', 'Chrome/')
    }
  } catch {}

  return {
    locale,
    timezoneId,
    languages,
    platform,
    hardwareConcurrency,
    deviceMemory,
    vendor: 'Google Inc.',
    renderer: 'ANGLE (Apple, Apple M2, Metal)',
    noiseCanvas: true,
    noiseWebGL: true,
    spoofPlugins: true,
    userAgent,
    webrtcPolicy: 'disable_non_proxied_udp'
  }
}

// 获取所有配置文件
app.get('/api/profiles', (req, res) => {
  res.json(readProfiles())
})

// 新建或更新配置文件
app.post('/api/profiles', async (req, res) => {
  const { id, name, proxy, preferred } = req.body
  let list = readProfiles()
  if (id) {
    const idx = list.findIndex(p => p.id === id)
    if (idx === -1) return res.status(404).json({ error: 'profile not found' })
    list[idx] = { ...list[idx], name, proxy }
    writeProfiles(list)
    return res.json(list[idx])
  }
  const newId = uuidv4()
  const desiredName = name || `Profile ${newId.slice(0, 8)}`
  const { dirName, userDataDir } = makeUniqueProfileDir(desiredName)
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true })
  let fingerprint = null
  try { fingerprint = await generateFingerprint(proxy || null, preferred || null) } catch {}
  const profile = {
    id: newId,
    name: desiredName,
    proxy: proxy || null,
    preferred: preferred || null,
    userDataDir,
    createdAt: Date.now(),
    fingerprint
  }
  list.push(profile)
  writeProfiles(list)
  res.json(profile)
})

// 删除配置文件
app.delete('/api/profiles/:id', async (req, res) => {
  const { id } = req.params
  let list = readProfiles()
  const idx = list.findIndex(p => p.id === id)
  if (idx === -1) return res.status(404).json({ error: 'profile not found' })
  // 关闭会话
  if (sessions[id]) {
    try { await closeSession(id) } catch {}
  }
  // 删除数据目录
  try {
    fs.rmSync(list[idx].userDataDir, { recursive: true, force: true })
  } catch {}
  list.splice(idx, 1)
  writeProfiles(list)
  res.json({ ok: true })
})

// 启动会话
app.post('/api/profiles/:id/start', async (req, res) => {
  const { id } = req.params
  const { startUrl } = req.body || {}
  const profile = readProfiles().find(p => p.id === id)
  if (!profile) return res.status(404).json({ error: 'profile not found' })
  try {
    const ctx = await openSession(profile)
    const page = await ctx.newPage(startUrl || 'about:blank')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 调试：查看当前目标页（仅用于定位问题）
app.get('/api/profiles/:id/targets', async (req, res) => {
  const { id } = req.params
  const ctx = getContext(id)
  if (!ctx) return res.status(400).json({ error: 'session not running' })
  try {
    const { port } = sessions[id]
    const CDPClient = (await import('chrome-remote-interface')).default
    const browser = await CDPClient({ port })
    const { targetInfos } = await browser.Target.getTargets()
    await browser.close()
    res.json((targetInfos || []).map(t => ({ id: t.targetId, type: t.type, url: t.url })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 关闭会话
app.post('/api/profiles/:id/stop', async (req, res) => {
  const { id } = req.params
  if (!sessions[id]) return res.json({ ok: true, message: 'not running' })
  try {
    await closeSession(id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 关闭所有会话（用于页面关闭时清理所有浏览器进程）
app.post('/api/stop-all', async (req, res) => {
  const ids = Object.keys(sessions)
  let stopped = 0
  for (const id of ids) {
    try { await closeSession(id); stopped++ } catch {}
  }
  // 兜底：如果存在遗留的 Chrome 进程（使用本项目 profiles 的 user-data-dir），尝试直接杀掉
  let extraKilled = 0
  try {
    const profilesRoot = path.join(__dirname, 'data', 'profiles')
    const out = execSync(`pgrep -fl "user-data-dir=${profilesRoot}" || true`, { encoding: 'utf8' })
    const lines = (out || '').split('\n').map(s => s.trim()).filter(Boolean)
    for (const line of lines) {
      const pidStr = line.split(' ')[0]
      const pid = Number(pidStr)
      if (!Number.isNaN(pid)) {
        try { process.kill(pid, 'SIGKILL'); extraKilled++ } catch {}
      }
    }
  } catch {}
  res.json({ ok: true, stopped, extraKilled })
})

// socks5 代理链接测试
// 请求体: { host, port, username, password, destHost, destPort, timeoutMs }
app.post('/api/test-proxy', async (req, res) => {
  const { host, port, username, password, destHost, destPort, timeoutMs } = req.body || {}
  if (!host || !port) return res.status(400).json({ ok: false, error: '缺少 host/port' })
  const destH = destHost || 'www.douyin.com'
  const destP = Number(destPort || 443)
  const timeout = Number(timeoutMs || 6000)

  function mapRep(rep) {
    const map = {
      0x01: '一般性故障',
      0x02: '规则不允许连接',
      0x03: '网络不可达',
      0x04: '主机不可达',
      0x05: '连接被拒绝',
      0x06: 'TTL 过期',
      0x07: '命令不支持',
      0x08: '地址类型不支持'
    }
    return map[rep] || `未知错误代码 ${rep}`
  }

  function socks5Handshake(atype = 'domain', ipAddr = null) {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      let timer = null
      let stage = 'init'
      const complete = (result) => {
        if (timer) clearTimeout(timer)
        try { socket.end() } catch {}
        try { socket.destroy() } catch {}
        resolve(result)
      }
      timer = setTimeout(() => complete({ ok: false, error: '连接超时', stage }), timeout)
      socket.once('error', (e) => complete({ ok: false, error: '网络错误: ' + e.message, stage }))
      socket.connect({ host, port: Number(port) }, () => {
        stage = 'greeting'
        const methods = username && password ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
        socket.write(methods)
        socket.once('data', (buf) => {
          if (buf.length < 2 || buf[0] !== 0x05) return complete({ ok: false, error: '无效方法协商响应', stage: 'greeting' })
          const method = buf[1]
          if (method === 0xFF) return complete({ ok: false, error: '代理不支持提供的认证方式', stage: 'greeting' })
          const proceed = () => {
            stage = 'connect'
            let req
            if (atype === 'ipv4' && ipAddr) {
              const parts = String(ipAddr).split('.').map(n => Number(n))
              req = Buffer.alloc(10)
              req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x01
              req[4] = parts[0]; req[5] = parts[1]; req[6] = parts[2]; req[7] = parts[3]
              req.writeUInt16BE(destP, 8)
            } else {
              const hostBuf = Buffer.from(destH)
              req = Buffer.alloc(7 + hostBuf.length)
              req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03
              req[4] = hostBuf.length
              hostBuf.copy(req, 5)
              req.writeUInt16BE(destP, 5 + hostBuf.length)
            }
            socket.write(req)
            socket.once('data', (rbuf) => {
              if (rbuf.length < 2 || rbuf[0] !== 0x05) return complete({ ok: false, error: '无效连接响应', stage: 'reply' })
              const rep = rbuf[1]
              if (rep !== 0x00) return complete({ ok: false, error: '代理连接失败: ' + mapRep(rep), rep, stage: 'reply', atype })
              return complete({ ok: true, stage: 'reply', atype })
            })
          }
          if (method === 0x02) {
            stage = 'auth'
            const u = Buffer.from(String(username || ''))
            const p = Buffer.from(String(password || ''))
            const auth = Buffer.alloc(3 + u.length + p.length)
            auth[0] = 0x01
            auth[1] = u.length
            u.copy(auth, 2)
            auth[2 + u.length] = p.length
            p.copy(auth, 3 + u.length)
            socket.write(auth)
            socket.once('data', (abuf) => {
              if (abuf.length < 2 || abuf[0] !== 0x01 || abuf[1] !== 0x00) return complete({ ok: false, error: '用户名/密码认证失败', stage: 'auth' })
              proceed()
            })
          } else {
            proceed()
          }
        })
      })
    })
  }

  try {
    // 先尝试域名 CONNECT
    const first = await socks5Handshake('domain')
    if (first.ok) {
      return res.json({ ok: true, host, port: Number(port), destHost: destH, destPort: destP, atype: 'domain' })
    }
    // 失败则回退到 IPv4 方式
    let ipAddr = null
    try {
      const ips = await dns.resolve4(destH)
      ipAddr = ips && ips[0]
    } catch {}
    if (!ipAddr) {
      return res.json({ ok: false, error: first.error || '域名方式失败，且无法解析 IPv4', stage: first.stage || 'unknown' })
    }
    const second = await socks5Handshake('ipv4', ipAddr)
    if (second.ok) {
      return res.json({ ok: true, host, port: Number(port), destHost: destH, destPort: destP, atype: 'ipv4', ip: ipAddr })
    }
    return res.json({ ok: false, error: second.error || first.error || '连接失败', stage: second.stage || first.stage || 'unknown' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 导出 cookies（按域）
app.get('/api/profiles/:id/cookies', async (req, res) => {
  const { id } = req.params
  const { domain } = req.query
  const ctx = getContext(id)
  if (!ctx) return res.status(400).json({ error: 'session not running' })
  try {
    const cookies = await ctx.cookies(domain || undefined)
    res.json(cookies)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导入 cookies
app.post('/api/profiles/:id/cookies', async (req, res) => {
  const { id } = req.params
  const cookies = req.body
  const ctx = getContext(id)
  if (!ctx) return res.status(400).json({ error: 'session not running' })
  try {
    await ctx.addCookies(cookies)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导出 localStorage / sessionStorage（需要提供 origin）
app.get('/api/profiles/:id/storage', async (req, res) => {
  const { id } = req.params
  const { origin, type } = req.query // type: 'local' | 'session'
  if (!origin) return res.status(400).json({ error: 'origin required, e.g., https://example.com' })
  const ctx = getContext(id)
  if (!ctx) return res.status(400).json({ error: 'session not running' })
  try {
    const page = await ctx.newPage()
    await page.goto(origin)
    const data = await page.evaluate(t => {
      const store = t === 'session' ? window.sessionStorage : window.localStorage
      const out = {}
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        out[k] = store.getItem(k)
      }
      return out
    }, type === 'session' ? 'session' : 'local')
    await page.close()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导入 localStorage / sessionStorage
app.post('/api/profiles/:id/storage', async (req, res) => {
  const { id } = req.params
  const { origin, type, data } = req.body
  if (!origin) return res.status(400).json({ error: 'origin required' })
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data object required' })
  const ctx = getContext(id)
  if (!ctx) return res.status(400).json({ error: 'session not running' })
  try {
    const page = await ctx.newPage()
    await page.goto(origin)
    await page.evaluate(({ t, d }) => {
      const store = t === 'session' ? window.sessionStorage : window.localStorage
      Object.entries(d).forEach(([k, v]) => store.setItem(k, v))
    }, { t: type === 'session' ? 'session' : 'local', d: data })
    await page.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导出/导入配置文件集合
app.get('/api/export-profiles', (req, res) => {
  res.json(readProfiles())
})

app.post('/api/import-profiles', (req, res) => {
  const incoming = req.body
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'array of profiles required' })
  // 简单合并，忽略 userDataDir（新建）
  const list = readProfiles()
  const merged = [...list]
  for (const p of incoming) {
    const id = uuidv4()
    const userDataDir = path.join(dataDir, 'profiles', id)
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true })
    merged.push({ id, name: p.name, proxy: p.proxy || null, userDataDir, createdAt: Date.now() })
  }
  writeProfiles(merged)
  res.json({ ok: true, count: merged.length })
})

// 一键导出到文件夹（复制 userDataDir 到 data/exports/xxx）
app.get('/api/profiles/:id/export-folder', (req, res) => {
  const { id } = req.params
  const profile = readProfiles().find(p => p.id === id)
  if (!profile) return res.status(404).json({ error: 'profile not found' })
  try {
    const safeName = (profile.name || 'profile').replace(/[^a-zA-Z0-9_-]+/g, '_')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = path.join(exportRoot, `${safeName}-${id}-${stamp}`)
    fs.cpSync(profile.userDataDir, dest, { recursive: true })
    res.json({ ok: true, path: dest })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 从文件夹导入（复制该文件夹到新建的 userDataDir）
app.post('/api/profiles/import-folder', (req, res) => {
  const { folderPath, name, proxy } = req.body || {}
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' })
  const src = path.isAbsolute(folderPath) ? folderPath : path.join(__dirname, folderPath)
  if (!fs.existsSync(src)) return res.status(400).json({ error: 'source folder not found' })
  try {
    const id = uuidv4()
    const srcBase = path.basename(src)
    const { dirName, userDataDir } = makeUniqueProfileDir(srcBase)
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.cpSync(src, userDataDir, { recursive: true })
    const list = readProfiles()
    const profile = { id, name: name || srcBase, proxy: proxy || null, userDataDir, createdAt: Date.now() }
    list.push(profile)
    writeProfiles(list)
    res.json(profile)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 通过上传的文件列表导入为新配置（大目录可能受限于请求大小）
app.post('/api/profiles/import-upload', bodyParser.json({ limit: '200mb' }), (req, res) => {
  const { files, name, proxy } = req.body || {}
  if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'files required' })
  try {
    const id = uuidv4()
    // 从第一个文件的相对路径中提取根目录名
    const firstPath = String(files[0].path || '')
    const safeFirst = firstPath.replace(/\\/g, '/').split('/').filter(seg => seg && seg !== '.' && seg !== '..')
    const rootName = safeFirst.length > 1 ? safeFirst[0] : (safeFirst[0] || 'uploaded')
    const { dirName, userDataDir } = makeUniqueProfileDir(rootName)
    fs.mkdirSync(userDataDir, { recursive: true })
    for (const f of files) {
      const rel = String(f.path || '')
      // 防止目录遍历
      const safeRel = rel.replace(/\\/g, '/').split('/').filter(seg => seg && seg !== '.' && seg !== '..').join('/')
      // 去除根目录名，避免重复嵌套
      const parts = safeRel.split('/')
      const inside = parts.length > 1 ? parts.slice(1).join('/') : parts[0]
      const dest = path.join(userDataDir, inside)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const buf = Buffer.from(f.base64, 'base64')
      fs.writeFileSync(dest, buf)
    }
    const list = readProfiles()
    const profile = { id, name: name || rootName, proxy: proxy || null, userDataDir, createdAt: Date.now() }
    list.push(profile)
    writeProfiles(list)
    res.json(profile)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Chrome 信息：版本与使用通道/可执行路径
app.get('/api/chrome-info', async (req, res) => {
  try {
    const info = await getChromeInfo()
    res.json(info)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 静态托管打包后的前端（ui/dist），仅当存在时启用
const staticDir = path.resolve(__dirname, '../ui/dist')
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir))
  // SPA 路由回退到 index.html，排除 /api/*
  app.get(/^(?!\/api).*$/, (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'))
  })
}

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})