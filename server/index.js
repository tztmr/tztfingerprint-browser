import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import dns from 'dns/promises'
import { v4 as uuidv4 } from 'uuid'
// 统一使用 CDP 驱动（不再支持 puppeteer-core）
const mod = await import('./lib/cdp.js')
const openSession = mod.openSession
const closeSession = mod.closeSession
const sessions = mod.sessions
const getContext = mod.getContext
const getChromeInfo = mod.getChromeInfo
console.log('[server] Using CDP driver (puppeteer disabled)')
import { execSync, execFile } from 'child_process'
import net from 'net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
// 提升全局 JSON 解析上限，避免导入上传体积较大时被默认 2MB 限制拦截
app.use(bodyParser.json({ limit: '800mb' }))
// 统一返回 JSON 错误（包括 bodyParser 的解析错误，如实体过大）
app.use((err, req, res, next) => {
  if (!err) return next()
  const status = err.status || err.statusCode || 400
  const type = err.type || ''
  if (type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大', limit: '800mb' })
  }
  res.status(status).json({ error: err.message || String(err) })
})

const dataDir = path.join(__dirname, 'data')
const profilesFile = path.join(dataDir, 'profiles.json')
const exportRoot = path.join(dataDir, 'exports')
const browserPathFile = path.join(dataDir, 'browser-path.txt')

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
if (!fs.existsSync(path.join(dataDir, 'profiles'))) fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true })
if (!fs.existsSync(profilesFile)) fs.writeFileSync(profilesFile, JSON.stringify([]))
if (!fs.existsSync(exportRoot)) fs.mkdirSync(exportRoot, { recursive: true })
// 预创建浏览器路径文件（为空即可），便于后续写入
try { if (!fs.existsSync(browserPathFile)) fs.writeFileSync(browserPathFile, '') } catch {}

function readProfiles() {
  return JSON.parse(fs.readFileSync(profilesFile, 'utf-8'))
}

// execFile 已通过 ES Module 方式导入

// 查找桌面目录（存在才返回），不创建
function findDesktopDir() {
  const home = os.homedir()
  const candidates = []
  if (process.platform === 'win32') {
    candidates.push(path.join(home, 'OneDrive', 'Desktop'))
    candidates.push(path.join(home, 'Desktop'))
    candidates.push(path.join(home, '桌面'))
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Desktop'))
  } else {
    candidates.push(path.join(home, 'Desktop'))
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// 弹出系统目录选择框（macOS 使用 osascript；Windows 使用 PowerShell）
function chooseFolderViaOS(promptText = '请选择导出目录') {
  return new Promise((resolve) => {
    const platform = process.platform
    if (platform === 'darwin') {
      const script = `POSIX path of (choose folder with prompt \"${String(promptText).replace(/"/g, '\\"')}\" default location path to desktop folder)`
      execFile('osascript', ['-e', script], { encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        const out = (stdout || '').trim()
        resolve(out || null)
      })
    } else if (platform === 'win32') {
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
        `$f.Description = "${String(promptText).replace(/"/g, '`"')}";`,
        '$f.ShowNewFolderButton = $true;',
        'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }'
      ].join(' ')
      execFile('powershell', ['-NoProfile', '-Command', psScript], { encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        const out = (stdout || '').trim()
        resolve(out || null)
      })
    } else {
      // 其他平台暂不支持原生弹窗
      resolve(null)
    }
  })
}

// 弹出系统文件选择框（macOS 使用 osascript；Windows 使用 PowerShell）
function chooseExecutableViaOS(promptText = '请选择浏览器可执行文件') {
  return new Promise((resolve) => {
    const platform = process.platform
    if (platform === 'darwin') {
      const script = `POSIX path of (choose file with prompt \"${String(promptText).replace(/"/g, '\\"')}\" default location path to applications folder)`
      execFile('osascript', ['-e', script], { encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        const out = (stdout || '').trim()
        resolve(out || null)
      })
    } else if (platform === 'win32') {
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$f = New-Object System.Windows.Forms.OpenFileDialog;',
        `$f.Title = "${String(promptText).replace(/"/g, '`"')}";`,
        '$f.Filter = "Executable (*.exe)|*.exe|All files (*.*)|*.*";',
        'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.FileName }'
      ].join(' ')
      execFile('powershell', ['-NoProfile', '-Command', psScript], { encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        const out = (stdout || '').trim()
        resolve(out || null)
      })
    } else {
      // 其他平台暂不支持原生弹窗
      resolve(null)
    }
  })
}

function writeProfiles(list) {
fs.writeFileSync(profilesFile, JSON.stringify(list, null, 2))
}

// 规范化浏览器可执行路径：支持传入目录（自动寻找常见二进制）或直接传入可执行文件
function normalizeExecutable(inputPath) {
  if (!inputPath) return null
  try {
    const p = path.resolve(String(inputPath))
    if (!fs.existsSync(p)) return null
    const stat = fs.statSync(p)
    if (stat.isDirectory()) {
      if (process.platform === 'darwin') {
        const candidates = [
          path.join(p, 'Contents', 'MacOS', 'Google Chrome'),
          path.join(p, 'Contents', 'MacOS', 'Chromium'),
          path.join(p, 'Contents', 'MacOS', 'Brave Browser'),
          path.join(p, 'Contents', 'MacOS', 'Microsoft Edge')
        ]
        for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch {} }
      } else if (process.platform === 'win32') {
        const candidates = ['chrome.exe', 'msedge.exe', 'brave.exe'].map(n => path.join(p, n))
        for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch {} }
      } else {
        const candidates = ['chrome', 'chromium', 'brave-browser', 'microsoft-edge'].map(n => path.join(p, n))
        for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch {} }
      }
      return null
    }
    return p
  } catch {
    return null
  }
}

// 优雅关闭：收到进程信号时，尝试关闭所有会话与遗留浏览器进程
async function gracefulShutdown() {
  try {
    const ids = Object.keys(sessions || {})
    for (const id of ids) { try { await closeSession(id) } catch {} }
    // 兜底：杀掉仍绑定到本项目 profiles 的 Chrome 进程
    try {
      const profilesRoot = path.join(__dirname, 'data', 'profiles')
      const out = execSync(`pgrep -fl "user-data-dir=${profilesRoot}" || true`, { encoding: 'utf8' })
      const lines = (out || '').split('\n').map(s => s.trim()).filter(Boolean)
      for (const line of lines) {
        const pidStr = line.split(' ')[0]
        const pid = Number(pidStr)
        if (!Number.isNaN(pid)) {
          try { process.kill(pid, 'SIGKILL') } catch {}
        }
      }
    } catch {}
  } catch {}
}

process.on('SIGINT', async () => { await gracefulShutdown(); process.exit(0) })
process.on('SIGTERM', async () => { await gracefulShutdown(); process.exit(0) })

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

// 计算机器码（HWID）：优先使用 macOS 的 IOPlatformUUID（稳定且与 Tauri machine_uid 一致）
function computeHWID() {
  // macOS: use IOPlatformUUID
  if (process.platform === 'darwin') {
    try {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $3}' | tr -d '\"'", { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
      if (out) return out
    } catch {}
    // Fallback: system_profiler (slower)
    try {
      const sp = execSync("system_profiler SPHardwareDataType | awk -F': ' '/Hardware UUID/{print $2}'", { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
      if (sp) return sp
    } catch {}
  }

  // Windows: use MachineGuid from registry (stable identifier used by Tauri machine_uid)
  if (process.platform === 'win32') {
    try {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
      const m = /MachineGuid\s+REG_[A-Z]+\s+([^\r\n]+)/i.exec(out)
      const guid = (m && m[1] ? m[1].trim() : '')
      if (guid) return guid
    } catch {}
    try {
      const ps = execSync("powershell -NoProfile -Command \"(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid\"", { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
      if (ps) return ps
    } catch {}
  }

  // Generic fallback: hash hostname + platform + arch + stable NIC MACs
  const hostname = os.hostname()
  const platform = os.platform()
  const arch = os.arch()
  const nics = os.networkInterfaces()
  const macs = []
  for (const [name, arr] of Object.entries(nics)) {
    for (const it of arr || []) {
      const mac = (it && it.mac) || ''
      // exclude invalid and internal; normalize & sort for stability
      if (mac && mac !== '00:00:00:00:00:00' && !it.internal) macs.push(mac.toLowerCase())
    }
  }
  macs.sort()
  const basis = [hostname, platform, arch, ...macs].join('|')
  const digest = crypto.createHash('sha256').update(basis).digest('hex')
  return digest.slice(0, 32)
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
  const uaPlatform = plt === 'darwin' ? 'macOS' : plt === 'win32' ? 'Windows' : 'Linux'

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

  // Build UA-CH brands from UA
  let userAgentBrands = null
  try {
    const m = /Chrome\/(\d+)/.exec(userAgent || '')
    const ver = m ? m[1] : '120'
    userAgentBrands = [
      { brand: 'Not A(Brand', version: '99' },
      { brand: 'Chromium', version: ver },
      { brand: 'Google Chrome', version: ver }
    ]
  } catch {}

  return {
    locale,
    timezoneId,
    languages,
    platform,
    uaPlatform,
    hardwareConcurrency,
    deviceMemory,
    vendor: 'Google Inc.',
    renderer: 'ANGLE (Apple, Apple M2, Metal)',
    productSub: '20030107',
    maxTouchPoints: 0,
    noiseCanvas: true,
    noiseWebGL: true,
    spoofPlugins: true,
    audioNoise: true,
    connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false },
    userAgent,
    userAgentBrands,
    webrtcPolicy: 'disable_non_proxied_udp'
  }
}

// 获取所有配置文件
// 获取机器码
// 统一加密（哈希）算法：base64(SHA256(salt + ":" + raw))，与 Tauri 端一致
function encryptHWID(raw) {
  const salt = process.env.HWID_SALT || 'TZT-HWID-V1'
  const digest = crypto.createHash('sha256').update(`${salt}:${raw}`).digest()
  return Buffer.from(digest).toString('base64')
}

app.get('/api/hwid', (req, res) => {
  try {
    const raw = computeHWID()
    const hwid = encryptHWID(raw)
    res.json({ ok: true, hwid })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) })
  }
})

// 保存浏览器可执行路径（开发/浏览器环境使用），server/lib/cdp.js 会读取该路径
app.post('/api/browser-path', (req, res) => {
  try {
    const input = (req.body && req.body.path) ? String(req.body.path) : ''
    if (!input) return res.status(400).json({ ok: false, error: '缺少 path' })
    const chosen = normalizeExecutable(input)
    if (!chosen || !fs.existsSync(chosen)) {
      return res.status(400).json({ ok: false, error: '无效的浏览器路径，请选择可执行文件或包含可执行文件的目录' })
    }
    fs.writeFileSync(browserPathFile, chosen, 'utf8')
    res.json({ ok: true, path: chosen })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) })
  }
})

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
    list[idx] = { ...list[idx], name, proxy, preferred: preferred ?? list[idx].preferred }
    writeProfiles(list)
    return res.json(list[idx])
  }
  const newId = uuidv4()
  const desiredName = name || `Profile ${newId.slice(0, 8)}`
  const { dirName, userDataDir } = makeUniqueProfileDir(desiredName)
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true })
  } catch (e) {
    return res.status(500).json({ error: `无法创建配置数据目录：${e.message}` })
  }
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
    const ctx = await openSession(profile, startUrl || null)
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
  const timeout = Number(timeoutMs || 15000)

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

// 会话网络诊断日志（最近 200 条）
app.get('/api/profiles/:id/net-logs', (req, res) => {
  const { id } = req.params
  const sess = sessions[id]
  if (!sess) return res.status(400).json({ ok: false, error: 'session not running' })
  res.json({ ok: true, logs: sess.netLogs || [] })
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

// 仅弹窗选择一个目录并返回路径，用于批量导出根目录选择
app.get('/api/choose-folder', async (req, res) => {
  try {
    const dir = await chooseFolderViaOS('请选择批量导出位置')
    if (!dir) return res.status(412).json({ error: 'no selection', code: 'NO_SELECTION' })
    res.json({ ok: true, path: dir })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 仅弹窗选择一个可执行文件并返回路径，用于浏览器路径选择
app.get('/api/choose-executable', async (req, res) => {
  try {
    const file = await chooseExecutableViaOS('请选择浏览器可执行文件')
    if (!file) return res.status(412).json({ error: 'no selection', code: 'NO_SELECTION' })
    const normalized = normalizeExecutable(file)
    if (!normalized || !fs.existsSync(normalized)) {
      return res.status(400).json({ error: '选择的文件无效或无法访问' })
    }
    res.json({ ok: true, path: normalized })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导出当前配置文件列表为 JSON 到指定文件夹
app.post('/api/export-profiles-to-folder', (req, res) => {
  try {
    const { targetDir, fileName } = req.body || {}
    let destRoot = targetDir && typeof targetDir === 'string' ? targetDir : findDesktopDir()
    if (!destRoot) return res.status(412).json({ error: 'no desktop path', code: 'DESKTOP_NOT_FOUND' })
    if (!path.isAbsolute(destRoot)) destRoot = path.join(__dirname, destRoot)
    fs.mkdirSync(destRoot, { recursive: true })
    const name = (fileName && String(fileName).trim()) || 'profiles-list.json'
    const cleanName = name.replace(/[^a-zA-Z0-9_.-]+/g, '_')
    const payload = readProfiles().map(p => ({ id: p.id, name: p.name, proxy: p.proxy || null, createdAt: p.createdAt || null }))
    const dest = path.join(destRoot, cleanName)
    fs.writeFileSync(dest, JSON.stringify(payload, null, 2))
    res.json({ ok: true, path: dest })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 一键导出到文件夹（默认桌面；若桌面不存在则弹窗选择）
app.get('/api/profiles/:id/export-folder', async (req, res) => {
  const { id } = req.params
  const profile = readProfiles().find(p => p.id === id)
  if (!profile) return res.status(404).json({ error: 'profile not found' })
  try {
    const force = String(req.query.force || '').toLowerCase()
    const forceChoose = force === '1' || force === 'true'
    let destRoot = null
    if (forceChoose) {
      destRoot = await chooseFolderViaOS('请选择导出位置')
      if (!destRoot) return res.status(412).json({ error: 'no selection', code: 'NO_SELECTION' })
    } else {
      destRoot = findDesktopDir()
      if (!destRoot) {
        destRoot = await chooseFolderViaOS('未找到桌面目录，请选择导出位置')
        if (!destRoot) return res.status(412).json({ error: 'no desktop path and no selection', code: 'DESKTOP_NOT_FOUND' })
      }
    }
    fs.mkdirSync(destRoot, { recursive: true })
    const cleanName = (profile.name || 'profile').replace(/[^a-zA-Z0-9_.-]+/g, '_')
    let dest = path.join(destRoot, cleanName)
    if (fs.existsSync(dest)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      dest = path.join(destRoot, `${cleanName}-${stamp}`)
    }
    fs.cpSync(profile.userDataDir, dest, { recursive: true })
    // 新规则：在导出命名的文件夹内写入 fingerprint.json 与 proxy.json
    try {
      if (profile.fingerprint) {
        fs.writeFileSync(path.join(dest, 'fingerprint.json'), JSON.stringify(profile.fingerprint, null, 2))
      }
      if (profile.proxy) {
        fs.writeFileSync(path.join(dest, 'proxy.json'), JSON.stringify(profile.proxy, null, 2))
      }
    } catch {}
    res.json({ ok: true, path: dest })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导出到用户指定的目标路径（服务器可访问的目录）
app.post('/api/profiles/:id/export-folder', (req, res) => {
  const { id } = req.params
  const { targetDir, folderName } = req.body || {}
  const profile = readProfiles().find(p => p.id === id)
  if (!profile) return res.status(404).json({ error: 'profile not found' })
  try {
    // 目标根目录：若未指定则回退到桌面路径（存在才使用）
    let destRoot = targetDir && typeof targetDir === 'string' ? targetDir : findDesktopDir()
    if (!destRoot) return res.status(412).json({ error: 'no desktop path', code: 'DESKTOP_NOT_FOUND' })
    // 相对路径则按服务器工作目录解析
    if (!path.isAbsolute(destRoot)) destRoot = path.join(__dirname, destRoot)
    // 创建目标根目录
    fs.mkdirSync(destRoot, { recursive: true })
    const defaultName = (folderName && String(folderName).trim()) || (profile.name || 'profile')
    const cleanName = defaultName.replace(/[^a-zA-Z0-9_.-]+/g, '_')
    let dest = path.join(destRoot, cleanName)
    if (fs.existsSync(dest)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      dest = path.join(destRoot, `${cleanName}-${stamp}`)
    }
    fs.cpSync(profile.userDataDir, dest, { recursive: true })
    // 新规则：在导出命名的文件夹内写入 fingerprint.json 与 proxy.json
    try {
      if (profile.fingerprint) {
        fs.writeFileSync(path.join(dest, 'fingerprint.json'), JSON.stringify(profile.fingerprint, null, 2))
      }
      if (profile.proxy) {
        fs.writeFileSync(path.join(dest, 'proxy.json'), JSON.stringify(profile.proxy, null, 2))
      }
    } catch {}
    res.json({ ok: true, path: dest })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 导出为 zip 并流式下载
app.get('/api/profiles/:id/export-zip', (req, res) => {
  const { id } = req.params
  const profile = readProfiles().find(p => p.id === id)
  if (!profile) return res.status(404).json({ error: 'profile not found' })
  try {
    const safeName = (profile.name || 'profile').replace(/[^a-zA-Z0-9_-]+/g, '_')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const zipName = `${safeName}-${id}-${stamp}.zip`
    const outPath = path.join(exportRoot, zipName)
    // 使用系统 zip 打包目录（包含根目录名）
    const srcDir = profile.userDataDir
    const parentDir = path.dirname(srcDir)
    const baseName = path.basename(srcDir)
    execSync(`zip -r -q "${outPath}" "${baseName}"`, { cwd: parentDir })
    // 设置下载头并流式传输
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
    const stream = fs.createReadStream(outPath)
    stream.on('error', err => res.status(500).end(`Stream error: ${err.message}`))
    stream.pipe(res)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})


// 已移除上传导入接口，推荐使用批量从文件夹导入（/api/import-profiles-from-folder）

// 批量从文件夹导入配置：
// - 若选择的是单个导出的配置目录（包含 webset-profile.json），则导入该目录
// - 若选择的是包含多个导出目录的根文件夹，则导入其直接子目录中带有 webset-profile.json 的目录
app.post('/api/import-profiles-from-folder', (req, res) => {
  try {
    const { sourceDir } = req.body || {}
    if (!sourceDir) return res.status(400).json({ error: 'sourceDir required' })
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return res.status(400).json({ error: 'sourceDir invalid' })
    }
    // 新规则：以 fingerprint.json 或 proxy.json 的存在作为候选目录标记；为兼容旧导出同时支持 webset-profile.json
    const hasMarker = (dir) => {
      const fp = path.join(dir, 'fingerprint.json')
      const px = path.join(dir, 'proxy.json')
      const legacy = path.join(dir, 'webset-profile.json')
      return fs.existsSync(fp) || fs.existsSync(px) || fs.existsSync(legacy)
    }
    // 可选：从根目录或其父目录读取批量导出的 profiles-list.json，以便在 meta 未包含代理时回填
    let proxyMap = new Map()
    const tryLoadProxyList = (dir) => {
      const listPath = path.join(dir, 'profiles-list.json')
      if (fs.existsSync(listPath)) {
        try {
          const arr = JSON.parse(fs.readFileSync(listPath, 'utf-8'))
          if (Array.isArray(arr)) {
            proxyMap = new Map(arr.map(it => [String(it.name || '').trim(), it.proxy || null]))
          }
        } catch {}
      }
    }
    tryLoadProxyList(sourceDir)
    let candidates = []
    if (hasMarker(sourceDir)) {
      candidates.push(sourceDir)
      // 若直接选择的是单个配置目录，尝试在其父目录查找列表文件进行代理回填
      tryLoadProxyList(path.dirname(sourceDir))
    } else {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const sub = path.join(sourceDir, ent.name)
          if (hasMarker(sub)) candidates.push(sub)
        }
      }
    }
    if (candidates.length === 0) {
      return res.json({ ok: true, importedCount: 0, imported: [], skippedCount: 0, skipped: [], note: 'no profiles found' })
    }
    const list = readProfiles()
    const imported = []
    const skipped = []
    for (const dir of candidates) {
      try {
        // 读取新规则下的 fingerprint/proxy 文件，保留旧格式兼容
        let meta = null
        const legacyMetaPath = path.join(dir, 'webset-profile.json')
        try { if (fs.existsSync(legacyMetaPath)) meta = JSON.parse(fs.readFileSync(legacyMetaPath, 'utf-8')) } catch {}
        const fpPath = path.join(dir, 'fingerprint.json')
        const pxPath = path.join(dir, 'proxy.json')
        let fingerprint = null
        let proxy = null
        try { if (fs.existsSync(fpPath)) fingerprint = JSON.parse(fs.readFileSync(fpPath, 'utf-8')) || null } catch {}
        try { if (fs.existsSync(pxPath)) proxy = JSON.parse(fs.readFileSync(pxPath, 'utf-8')) || null } catch {}
        if (!fingerprint && meta && meta.fingerprint) fingerprint = meta.fingerprint
        if (!proxy && meta && meta.proxy) proxy = meta.proxy
        const desiredName = path.basename(dir)
        const id = uuidv4()
        const { userDataDir } = makeUniqueProfileDir(desiredName)
        fs.mkdirSync(userDataDir, { recursive: true })
        fs.cpSync(dir, userDataDir, { recursive: true })
        // 若未在文件中提供代理，则尝试批量导出列表 JSON 回填
        if (!proxy && proxyMap.size > 0) {
          const guessed = proxyMap.get(desiredName)
          if (guessed && guessed.host && guessed.port) proxy = guessed
        }
        const createdAt = (meta && typeof meta.createdAt === 'number' ? meta.createdAt : Date.now())
        const profile = { id, name: desiredName, proxy: proxy || null, userDataDir, createdAt, fingerprint }
        list.push(profile)
        imported.push({ id, name: desiredName, from: dir })
      } catch (e) {
        skipped.push({ path: dir, error: e.message })
      }
    }
    writeProfiles(list)
    res.json({ ok: true, importedCount: imported.length, imported, skippedCount: skipped.length, skipped })
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
