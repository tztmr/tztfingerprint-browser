import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import { fileURLToPath } from 'url'
import extract from 'extract-zip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const platforms = {
  darwin: () => (os.arch() === 'arm64' ? 'Mac_Arm' : 'Mac'),
  win32: () => 'Win_x64'
}

function fetchText(url, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location, { timeoutMs }))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()))
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)) } catch {}
    })
  })
}

function downloadTo(url, dest, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest)
    fs.mkdirSync(dir, { recursive: true })
    const file = fs.createWriteStream(dest)
    const handle = loc => {
      const req = https.get(loc, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close(); fs.unlinkSync(dest)
          return handle(res.headers.location)
        }
        if (res.statusCode !== 200) {
          file.close()
          return reject(new Error(`HTTP ${res.statusCode} for ${loc}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      })
      req.on('error', err => {
        try { file.close(); fs.unlinkSync(dest) } catch {}
        reject(err)
      })
      req.setTimeout(timeoutMs, () => {
        try { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)) } catch {}
      })
    }
    handle(url)
  })
}

async function main() {
  const plt = process.platform
  if (!platforms[plt]) {
    console.error('当前脚本仅支持 Windows 与 macOS 的 Chromium 下载。')
    process.exit(1)
  }
  const bucket = platforms[plt]()
  // Host 选择：支持手动指定或自动回退到国内镜像
  const argHost = (process.argv.find(a => a.startsWith('--host=')) || '').replace('--host=', '')
  const argMirror = (process.argv.find(a => a.startsWith('--mirror=')) || '').replace('--mirror=', '')
  const envHost = process.env.CHROMIUM_MIRROR || process.env.PUPPETEER_DOWNLOAD_HOST || ''
  const defaultHosts = [
    'https://storage.googleapis.com/chromium-browser-snapshots',
    'https://cdn.npmmirror.com/binaries/chromium-browser-snapshots'
  ]
  const preferCn = argMirror === 'cn'
  let hosts = []
  if (argHost) hosts.push(argHost)
  else if (envHost) hosts.push(envHost)
  if (preferCn) hosts.push('https://cdn.npmmirror.com/binaries/chromium-browser-snapshots', 'https://storage.googleapis.com/chromium-browser-snapshots')
  else hosts.push(...defaultHosts)
  // 去重
  hosts = hosts.filter((h, i) => h && hosts.indexOf(h) === i)

  // 获取最新修订版本，逐个主机尝试
  let rev = null
  let chosenBase = null
  let lastErr = null
  for (const base of hosts) {
    const lastUrl = `${base}/${bucket}/LAST_CHANGE`
    try {
      rev = await fetchText(lastUrl, { timeoutMs: 12000 })
      chosenBase = base
      break
    } catch (e) {
      lastErr = e
      console.warn(`从 ${base} 获取 LAST_CHANGE 失败：${e.message}`)
    }
  }
  if (!rev || !chosenBase) {
    console.error('获取最新修订版本失败：', lastErr?.message || '未知错误')
    process.exit(1)
  }
  const zipName = plt === 'darwin' ? 'chrome-mac.zip' : 'chrome-win.zip'
  const zipUrl = `${chosenBase}/${bucket}/${rev}/${zipName}`
  const vendorDir = path.join(__dirname, '..', 'vendor')
  fs.mkdirSync(vendorDir, { recursive: true })

  // 若已存在则跳过
  if (plt === 'darwin') {
    const targetApp = path.join(vendorDir, 'Chromium.app')
    if (fs.existsSync(targetApp)) {
      console.log('已存在 vendor/Chromium.app，跳过下载。')
      return
    }
  } else {
    const targetDir = path.join(vendorDir, 'chrome-win')
    if (fs.existsSync(targetDir)) {
      console.log('已存在 vendor/chrome-win，跳过下载。')
      return
    }
  }

  const tmpZip = path.join(os.tmpdir(), `chromium-${bucket}-${rev}.zip`)
  console.log(`下载 Chromium (${bucket} rev ${rev}) 从 ${chosenBase} 到 ${tmpZip} ...`)
  try {
    await downloadTo(zipUrl, tmpZip, { timeoutMs: 60000 })
  } catch (e) {
    // 尝试其他主机
    const others = hosts.filter(h => h !== chosenBase)
    let success = false
    for (const base of others) {
      const u = `${base}/${bucket}/${rev}/${zipName}`
      console.log(`回退从 ${base} 下载 ...`)
      try {
        await downloadTo(u, tmpZip, { timeoutMs: 60000 })
        success = true
        chosenBase = base
        break
      } catch (err) {
        console.warn(`从 ${base} 下载失败：${err.message}`)
      }
    }
    if (!success) {
      console.error('所有主机下载失败：', e.message)
      process.exit(1)
    }
  }
  console.log('解压到 vendor ...')
  await extract(tmpZip, { dir: vendorDir })

  if (plt === 'darwin') {
    const srcApp = path.join(vendorDir, 'chrome-mac', 'Chromium.app')
    const destApp = path.join(vendorDir, 'Chromium.app')
    if (!fs.existsSync(srcApp)) {
      console.error('未找到解压后的 chrome-mac/Chromium.app')
      process.exit(1)
    }
    fs.cpSync(srcApp, destApp, { recursive: true })
    // 清理中间目录
    try { fs.rmSync(path.join(vendorDir, 'chrome-mac'), { recursive: true, force: true }) } catch {}
    console.log('Chromium.app 已放置到 server/vendor')
  } else {
    // Windows 解压后直接是 vendor/chrome-win
    const exe = path.join(vendorDir, 'chrome-win', 'chrome.exe')
    if (!fs.existsSync(exe)) {
      console.error('未找到解压后的 chrome-win/chrome.exe')
      process.exit(1)
    }
    console.log('chrome-win 已放置到 server/vendor')
  }
  try { fs.unlinkSync(tmpZip) } catch {}
  console.log('完成。')
}

main().catch(e => {
  console.error('下载/解压失败：', e)
  process.exit(1)
})