const API_BASE = typeof window !== 'undefined' && window.location.origin.includes(':5173')
  ? 'http://localhost:4000'
  : (typeof window !== 'undefined' ? window.location.origin : '')
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
  const res = await fetch(url)
  return res.json()
}

export async function importCookies(id, cookies) {
  const res = await fetch(`${API}/profiles/${id}/cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cookies)
  })
  return res.json()
}

export async function exportStorage(id, origin, type) {
  const url = new URL(`${API}/profiles/${id}/storage`, API_BASE || 'http://localhost:4000')
  url.searchParams.set('origin', origin)
  url.searchParams.set('type', type)
  const res = await fetch(url)
  return res.json()
}

export async function importStorage(id, payload) {
  const res = await fetch(`${API}/profiles/${id}/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return res.json()
}

export async function exportProfileFolder(id) {
  const res = await fetch(`${API}/profiles/${id}/export-folder`)
  return res.json()
}

export async function importProfileFolder(folderPath, name, proxy) {
  return fetchJson(`${API}/profiles/import-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath, name, proxy })
  })
}

// 通过上传目录文件列表导入为新配置
export async function importProfileUpload(files, name, proxy) {
  return fetchJson(`${API}/profiles/import-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, name, proxy })
  })
}

export async function getChromeInfo() {
  const res = await fetch(`${API}/chrome-info`)
  return res.json()
}

export async function testProxy({ host, port, username, password, destHost, destPort }) {
  const res = await fetch(`${API}/test-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port, username, password, destHost, destPort })
  })
  return res.json()
}