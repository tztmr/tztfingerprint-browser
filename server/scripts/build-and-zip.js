import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..', '..')
const serverDir = path.resolve(__dirname, '..')
const uiDir = path.resolve(rootDir, 'ui')
const args = process.argv.slice(2)
const isLight = args.includes('--light') || process.env.LIGHT === '1'

function run(cmd, cwd) {
  console.log(`$ ${cmd} (cwd=${cwd})`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function ensureUIBuilt() {
  if (!fs.existsSync(uiDir)) {
    console.warn('未发现 ui 目录，跳过前端构建')
    return
  }
  // 尝试构建前端
  try {
    if (!fs.existsSync(path.join(uiDir, 'node_modules'))) {
      run('npm install', uiDir)
    }
    run('npm run build', uiDir)
  } catch (e) {
    console.warn('构建前端失败，继续打包现有文件（若缺少 ui/dist 将无法静态托管）')
  }
}

function ensureVendor() {
  const vendorDir = path.join(serverDir, 'vendor')
  if (isLight) {
    console.log('轻量模式：跳过内置浏览器拷贝（将使用本机或 CHROME_PATH）')
    return
  }
  if (fs.existsSync(vendorDir)) return
  try {
    run('npm run bundle:chrome', serverDir)
  } catch (e) {
    console.warn('拷贝浏览器失败，将不包含内置浏览器。用户需本机安装或设置 CHROME_PATH。')
  }
}

function copyIntoRelease() {
  const releaseDir = path.join(rootDir, 'release_temp')
  const bundleDir = path.join(releaseDir, 'webset')
  fs.rmSync(releaseDir, { recursive: true, force: true })
  fs.mkdirSync(bundleDir, { recursive: true })

  // 复制后端
  const serverOut = path.join(bundleDir, 'server')
  fs.mkdirSync(serverOut, { recursive: true })
  if (isLight) {
    // 轻量：只复制必要文件，跳过 node_modules 与 vendor
    const whitelistFiles = ['index.js', 'package.json', 'package-lock.json']
    const whitelistDirs = ['lib', 'scripts', 'data']
    for (const f of whitelistFiles) {
      const src = path.join(serverDir, f)
      if (fs.existsSync(src)) fs.cpSync(src, path.join(serverOut, f))
    }
    for (const d of whitelistDirs) {
      const src = path.join(serverDir, d)
      if (fs.existsSync(src)) fs.cpSync(src, path.join(serverOut, d), { recursive: true })
    }
  } else {
    // 完整：包含 vendor 与 node_modules
    fs.cpSync(serverDir, serverOut, { recursive: true })
  }

  // 复制前端打包产物到 ui-dist
  const distDir = path.join(uiDir, 'dist')
  if (fs.existsSync(distDir)) {
    fs.cpSync(distDir, path.join(bundleDir, 'ui-dist'), { recursive: true })
  }

  // 附带说明文件（若存在）
  const readme = path.join(rootDir, 'read.md')
  if (fs.existsSync(readme)) {
    fs.cpSync(readme, path.join(bundleDir, 'read.md'))
  }

  return { releaseDir, bundleDir }
}

function makeZip(bundleDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0]
  const zipName = `${isLight ? 'webset_light' : 'webset'}_${stamp}.zip`
  const zipPath = path.join(rootDir, zipName)
  const parentDir = path.dirname(bundleDir)
  const folderName = path.basename(bundleDir)
  // 使用系统 zip 命令
  run(`zip -r -X ${zipPath} ${folderName}`, parentDir)
  return zipPath
}

function cleanup(releaseDir) {
  fs.rmSync(releaseDir, { recursive: true, force: true })
}

// 执行流程
ensureUIBuilt()
ensureVendor()
const { releaseDir, bundleDir } = copyIntoRelease()
const zipPath = makeZip(bundleDir)
cleanup(releaseDir)
console.log(`打包完成：${zipPath}`)