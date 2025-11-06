import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return null
}

function appRootFromExe(exePath) {
  if (!exePath) return null
  const app = path.resolve(exePath, '../../../')
  if (fs.existsSync(app) && app.endsWith('.app')) return app
  return null
}

const platform = os.platform()
const exe = process.env.CHROME_PATH || findLocalChrome()
if (!exe) {
  console.error('未找到本地浏览器。请安装 Chrome/Chromium/Edge/Brave 或设置 CHROME_PATH 环境变量。')
  process.exit(1)
}
const vendorDir = path.join(__dirname, '..', 'vendor')
fs.mkdirSync(vendorDir, { recursive: true })

if (platform === 'darwin') {
  const appRoot = appRootFromExe(exe)
  if (!appRoot) {
    console.error('无法解析浏览器 .app 目录，请提供 macOS .app 版本路径。')
    process.exit(1)
  }
  const dest = path.join(vendorDir, path.basename(appRoot))
  if (fs.existsSync(dest)) {
    console.log(`已存在：${dest}，跳过拷贝。如需更新请先删除该目录。`)
    process.exit(0)
  }
  console.log(`拷贝浏览器到 ${dest} ... 体积较大，可能需要几分钟。`)
  fs.cpSync(appRoot, dest, { recursive: true })
  console.log('完成。打包时包含 server/vendor 目录即可实现开箱即用。')
} else if (platform === 'win32') {
  const appDir = path.dirname(exe) // Application 目录
  let label = 'chrome-win'
  const lower = exe.toLowerCase()
  if (lower.includes('chromium')) label = 'chromium-win'
  else if (lower.includes('msedge')) label = 'edge-win'
  else if (lower.includes('brave')) label = 'brave-win'
  const dest = path.join(vendorDir, label)
  if (fs.existsSync(dest)) {
    console.log(`已存在：${dest}，跳过拷贝。如需更新请先删除该目录。`)
    process.exit(0)
  }
  console.log(`拷贝浏览器到 ${dest} ... 体积较大，可能需要几分钟。`)
  fs.cpSync(appDir, dest, { recursive: true })
  console.log('完成。打包时包含 server/vendor 目录即可实现开箱即用。')
} else {
  console.warn('当前脚本仅实现 macOS 与 Windows 的浏览器打包。Linux 请在生产阶段使用系统浏览器或后续提供的下载脚本。')
}