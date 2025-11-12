// 在本地开发（localhost）或 Tauri 环境下统一指向后端 4000，确保前端端口/协议变化不影响 API 指向
const isBrowser = typeof window !== 'undefined'
const isLocalHost = isBrowser && /localhost|127\.0\.0\.1/i.test(window.location.hostname)
const isTauri = isBrowser && '__TAURI_INTERNALS__' in window
const API_BASE = (isLocalHost || isTauri)
  ? 'http://localhost:4000'
  : (isBrowser ? window.location.origin : '')
const API = `${API_BASE}/api`

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('application/json')) {
    const data = await res.json()
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || JSON.stringify(data)
      throw new Error(`[${res.status}] ${msg}`)
    }
    return data
  } else {
    const text = await res.text()
    if (!res.ok) throw new Error(`[${res.status}] ${text}`)
    try { return JSON.parse(text) } catch {
      throw new Error(`[${res.status}] ${text}`)
    }
  }
}

export async function listProfiles() {
  const res = await fetch(`${API}/profiles`)
  return res.json()
}

export async function saveProfile(profile) {
  const res = await fetch(`${API}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile)
  })
  return res.json()
}

export async function deleteProfile(id) {
  const res = await fetch(`${API}/profiles/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function startSession(id, startUrl) {
  const res = await fetch(`${API}/profiles/${id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startUrl })
  })
  return res.json()
}

export async function stopSession(id) {
  const res = await fetch(`${API}/profiles/${id}/stop`, { method: 'POST' })
  return res.json()
}

export async function exportCookies(id, domain) {
  const url = new URL(`${API}/profiles/${id}/cookies`, API_BASE || 'http://localhost:4000')
  if (domain) url.searchParams.set('domain', domain)
  // 使用统一的 fetchJson，非 2xx 时抛错，避免前端误当作数组处理
  return fetchJson(url.toString())
}

export async function importCookies(id, cookies) {
  return fetchJson(`${API}/profiles/${id}/cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cookies)
  })
}

export async function exportStorage(id, origin, type) {
  const url = new URL(`${API}/profiles/${id}/storage`, API_BASE || 'http://localhost:4000')
  url.searchParams.set('origin', origin)
  url.searchParams.set('type', type)
  return fetchJson(url.toString())
}

export async function importStorage(id, payload) {
  return fetchJson(`${API}/profiles/${id}/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export async function exportProfileFolder(id, targetDir, folderName) {
  // 支持用户指定路径（POST），未指定时回退为默认导出根目录（GET）
  if (targetDir) {
    return fetchJson(`${API}/profiles/${id}/export-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDir, folderName })
    })
  } else {
    const res = await fetch(`${API}/profiles/${id}/export-folder`)
    return res.json()
  }
}

// 强制弹窗选择路径进行导出（不管是否找到桌面）
export async function exportProfileFolderChoose(id) {
  const res = await fetch(`${API}/profiles/${id}/export-folder?force=1`)
  return res.json()
}

export async function exportProfileZip(id) {
  const res = await fetch(`${API}/profiles/${id}/export-zip`)
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const data = await res.json()
      const msg = (data && (data.error || data.message)) || JSON.stringify(data)
      throw new Error(`[${res.status}] ${msg}`)
    } else {
      throw new Error(`[${res.status}] ${await res.text()}`)
    }
  }
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename="?([^";]+)"?/)
  const filename = m ? m[1] : `profile-${id}.zip`
  return { blob, filename }
}


// 已移除上传导入接口，改用批量从文件夹导入（importProfilesFromFolder）

// 批量从文件夹导入配置（识别包含 fingerprint.json / proxy.json 的目录；兼容旧版 webset-profile.json）
export async function importProfilesFromFolder(sourceDir) {
  return fetchJson(`${API}/import-profiles-from-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceDir })
  })
}

export async function getChromeInfo() {
  const res = await fetch(`${API}/chrome-info`)
  return res.json()
}

// 获取机器码（HWID），用于证书绑定与校验显示
export async function getHWID() {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    const hwid = await invoke('get_hwid')
    return { ok: true, hwid }
  }
  return fetchJson(`${API}/hwid`)
}

export async function testProxy({ host, port, username, password, destHost, destPort, timeoutMs }) {
  const res = await fetch(`${API}/test-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port, username, password, destHost, destPort, timeoutMs })
  })
  return res.json()
}

export async function getNetLogs(id) {
  return fetchJson(`${API}/profiles/${id}/net-logs`)
}

// 选择一个目录（始终弹窗），返回 { ok, path }，使用统一 JSON 解析以规避 HTML 回退误判
export async function chooseFolder() {
  return fetchJson(`${API}/choose-folder`)
}

// 选择一个可执行文件（始终弹窗），返回 { ok, path }
export async function chooseExecutable() {
  return fetchJson(`${API}/choose-executable`)
}

// 将当前配置文件列表导出为 JSON 到指定文件夹
export async function exportProfilesListToFolder(targetDir, fileName) {
  return fetchJson(`${API}/export-profiles-to-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetDir, fileName })
  })
}

// 保存浏览器可执行路径（开发/浏览器环境），写入 server/data/browser-path.txt
export async function setBrowserPath(path) {
  return fetchJson(`${API}/browser-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
}