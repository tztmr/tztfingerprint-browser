import { useEffect, useState, useRef } from 'react'
import './App.css'
import { listProfiles, saveProfile, deleteProfile, startSession, stopSession, exportCookies, importCookies, exportStorage, importStorage, exportProfileFolder, importProfileFolder, importProfileUpload, getChromeInfo, testProxy } from './api.js'

function App() {
  const [profiles, setProfiles] = useState([])
  const [form, setForm] = useState({ name: '', proxy: { host: '', port: '', username: '', password: '' } })
  const [selected, setSelected] = useState(null)
  const [origin, setOrigin] = useState('https://www.douyin.com')
  const presetSites = [
    { name: '抖音', url: 'https://www.douyin.com' },
    { name: '小红书', url: 'https://www.xiaohongshu.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com' }
  ]
  const [startUrl, setStartUrl] = useState(presetSites[0].url)
  const [chromeInfo, setChromeInfo] = useState(null)
  const [proxyTestResult, setProxyTestResult] = useState(null)
  // 从文件夹导入表单
  const [importForm, setImportForm] = useState({ folderPath: '', name: '', proxy: { host: '', port: '', username: '', password: '' } })
  const [importFiles, setImportFiles] = useState([])
  const [selectedFolderSize, setSelectedFolderSize] = useState(0)
  const folderInputRef = useRef(null)
  const [selectedFolderName, setSelectedFolderName] = useState('')
  // 默认首选项（地区/语言/时区）
  const [defaultRegion, setDefaultRegion] = useState('HK') // auto 自动、HK 香港、CN 大陆、TW 台湾
  const [defaultLanguage, setDefaultLanguage] = useState('zh-Hant') // auto 自动、zh-Hant 繁体中文、zh-Hans 简体中文、en 英语
  const [defaultTimezone, setDefaultTimezone] = useState('Asia/Hong_Kong') // auto 自动、Asia/Hong_Kong 香港、Asia/Shanghai 上海、Asia/Taipei 台北

  async function refresh() {
    const data = await listProfiles()
    setProfiles(data)
  }

  useEffect(() => {
    refresh()
    getChromeInfo().then(setChromeInfo).catch(() => {})
    // 页面关闭时，通知后端关闭所有会话，确保浏览器退出
    const apiBase = window.location.origin.includes(':5173') ? 'http://localhost:4000' : window.location.origin
    const handleUnload = () => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`${apiBase}/api/stop-all`)
        } else {
          fetch(`${apiBase}/api/stop-all`, { method: 'POST', keepalive: true })
        }
      } catch {}
    }
    window.addEventListener('beforeunload', handleUnload)
    // 兼容性更好的 pagehide（支持 keepalive）
    window.addEventListener('pagehide', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [])

  async function createProfile() {
    const proxy = form.proxy.host && form.proxy.port ? { ...form.proxy, port: Number(form.proxy.port) } : null
    const p = await saveProfile({
      name: form.name,
      proxy,
      preferred: { region: defaultRegion, language: defaultLanguage, timezoneId: defaultTimezone }
    })
    setForm({ name: '', proxy: { host: '', port: '', username: '', password: '' } })
    await refresh()
    setSelected(p)
    // 新建后自动启动会话并导航到当前选择的网站
    try {
      const r = await startSession(p.id, startUrl)
      if (!r?.ok) alert('自动启动失败：' + (r?.error || '未知错误'))
    } catch (e) {
      alert('自动启动失败：' + e.message)
    }
  }

  async function doTestProxy() {
    const proxy = form.proxy
    if (!proxy.host || !proxy.port) {
      alert('请先填写 socks5 的 host 与 port')
      return
    }
    const u = new URL(startUrl)
    const destHost = u.hostname
    const destPort = u.protocol === 'https:' ? 443 : 80
    try {
      const res = await testProxy({ host: proxy.host, port: Number(proxy.port), username: proxy.username, password: proxy.password, destHost, destPort })
      if (res.ok) {
        const extra = []
        if (res.atype) extra.push(`方式=${res.atype}`)
        if (res.ip) extra.push(`IP=${res.ip}`)
        setProxyTestResult(`连接成功：${proxy.host}:${proxy.port} → ${destHost}:${destPort}${extra.length ? '（' + extra.join(', ') + '）' : ''}`)
        alert('代理链接测试成功')
      } else {
        const msg = res.error || '未知错误'
        const extra = []
        if (res.stage) extra.push(`阶段=${res.stage}`)
        if (res.atype) extra.push(`方式=${res.atype}`)
        if (res.ip) extra.push(`IP=${res.ip}`)
        setProxyTestResult(`连接失败：${msg}${extra.length ? '（' + extra.join(', ') + '）' : ''}`)
        alert('代理链接测试失败：' + msg)
      }
    } catch (e) {
      setProxyTestResult(`连接异常：${e.message}`)
      alert('代理链接测试异常：' + e.message)
    }
  }

  async function removeProfile(id) {
    await deleteProfile(id)
    if (selected?.id === id) setSelected(null)
    await refresh()
  }

  async function start(id) { await startSession(id, startUrl) }
  async function stop(id) { await stopSession(id) }

  async function doExportCookies(id, domain) {
    const cookies = await exportCookies(id, domain)
    alert(JSON.stringify(cookies, null, 2))
  }

  async function doImportCookies(id) {
    const text = prompt('粘贴 cookies JSON 数组')
    if (!text) return
    try {
      const arr = JSON.parse(text)
      await importCookies(id, arr)
      alert('导入成功')
    } catch (e) {
      alert('格式错误: ' + e.message)
    }
  }

  async function doExportStorage(id, type) {
    const data = await exportStorage(id, origin, type)
    alert(JSON.stringify(data, null, 2))
  }

  async function doImportStorage(id, type) {
    const text = prompt(`粘贴 ${type}Storage 的 JSON 对象`)
    if (!text) return
    try {
      const obj = JSON.parse(text)
      await importStorage(id, { origin, type, data: obj })
      alert('导入成功')
    } catch (e) {
      alert('格式错误: ' + e.message)
    }
  }

  async function exportFolder(id) {
    const res = await exportProfileFolder(id)
    if (res.error) return alert('导出失败: ' + res.error)
    alert(`已导出到文件夹:\n${res.path}`)
  }

  async function importFolder() {
    const folderPath = importForm.folderPath
    if (!folderPath) { alert('请填写源文件夹路径'); return }
    try {
      const proxy = importForm.proxy.host && importForm.proxy.port ? { ...importForm.proxy, port: Number(importForm.proxy.port) } : null
      const profile = await importProfileFolder(folderPath, importForm.name, proxy)
      await refresh()
      setSelected(profile)
      setImportForm({ folderPath: '', name: '', proxy: { host: '', port: '', username: '', password: '' } })
      alert('导入成功')
    } catch (e) {
      alert('导入失败: ' + e.message)
    }
  }

  function abToBase64(ab) {
    const u8 = new Uint8Array(ab)
    let s = ''
    const chunk = 0x8000
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
    }
    return btoa(s)
  }

  async function importFolderUpload() {
    if (!importFiles || importFiles.length === 0) { alert('请先选择文件夹'); return }
    const totalBytes = importFiles.reduce((sum, f) => sum + (f.size || 0), 0)
    const limitBytes = 200 * 1024 * 1024
    if (totalBytes > limitBytes) {
      alert(`目录体积过大（约 ${formatBytes(totalBytes)}），超过当前上限 200MB。建议使用“按服务器路径导入”或将目录压缩为 zip 再导入。`)
      return
    }
    try {
      const filesPayload = []
      for (const f of importFiles) {
        const ab = await f.arrayBuffer()
        filesPayload.push({ path: f.webkitRelativePath || f.name, base64: abToBase64(ab) })
      }
      const proxy = importForm.proxy.host && importForm.proxy.port ? { ...importForm.proxy, port: Number(importForm.proxy.port) } : null
      const profile = await importProfileUpload(filesPayload, importForm.name, proxy)
      await refresh()
      setSelected(profile)
      setImportForm({ folderPath: '', name: '', proxy: { host: '', port: '', username: '', password: '' } })
      setImportFiles([])
      alert('上传并导入成功')
    } catch (e) {
      alert('上传导入失败: ' + e.message)
    }
  }

  function handleFolderSelect(e) {
    const files = Array.from(e.target.files || [])
    setImportFiles(files)
    let rootName = ''
    if (files.length > 0) {
      const p = files[0].webkitRelativePath || files[0].name
      rootName = p.includes('/') ? p.split('/')[0] : p
    }
    setSelectedFolderName(rootName)
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0)
    setSelectedFolderSize(totalBytes)
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const val = bytes / Math.pow(1024, i)
    return `${val.toFixed(val >= 100 ? 0 : 1)} ${units[i]}`
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>指纹浏览器配置管理</h1>
      <p>操作系统：Windows 与 macOS；支持 socks5 代理；批量管理账号的登录状态、cookies、session、localStorage、sessionStorage。</p>
      {chromeInfo && (
        <p style={{ color: '#333' }}>
          Chrome 版本：{chromeInfo.version}（{chromeInfo.channel ? `channel=${chromeInfo.channel}` : chromeInfo.executablePath ? `path=${chromeInfo.executablePath}` : '默认'}）
        </p>
      )}

      <div style={{ margin: '12px 0' }}>
        <label style={{ marginRight: 8 }}>默认打开网站：</label>
        <select
          value={startUrl}
          onChange={e => { setStartUrl(e.target.value); setOrigin(e.target.value) }}
          style={{ padding: '4px 8px' }}
        >
          {presetSites.map(s => (
            <option key={s.url} value={s.url}>{s.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 16, margin: '12px 0' }}>
        <div>
          <label style={{ marginRight: 8 }}>默认地区：</label>
          <select value={defaultRegion} onChange={e => setDefaultRegion(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="auto">自动（按 IP/代理）</option>
            <option value="HK">香港</option>
            <option value="CN">大陆</option>
            <option value="TW">台湾</option>
          </select>
        </div>
        <div>
          <label style={{ marginRight: 8 }}>默认语言：</label>
          <select value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="auto">自动（按 IP）</option>
            <option value="zh-Hant">繁体中文</option>
            <option value="zh-Hans">简体中文</option>
            <option value="en">英语</option>
          </select>
        </div>
        <div>
          <label style={{ marginRight: 8 }}>默认时区：</label>
          <select value={defaultTimezone} onChange={e => setDefaultTimezone(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="auto">自动（按 IP/地区）</option>
            <option value="Asia/Hong_Kong">香港</option>
            <option value="Asia/Shanghai">上海</option>
            <option value="Asia/Taipei">台北</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h2>新建配置文件</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder="名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <h3>socks5 代理（可选）</h3>
            <input placeholder="host" value={form.proxy.host} onChange={e => setForm({ ...form, proxy: { ...form.proxy, host: e.target.value } })} />
            <input placeholder="port" value={form.proxy.port} onChange={e => setForm({ ...form, proxy: { ...form.proxy, port: e.target.value } })} />
            <input placeholder="username" value={form.proxy.username} onChange={e => setForm({ ...form, proxy: { ...form.proxy, username: e.target.value } })} />
            <input placeholder="password" type="password" value={form.proxy.password} onChange={e => setForm({ ...form, proxy: { ...form.proxy, password: e.target.value } })} />
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <button onClick={createProfile}>创建</button>
              <button onClick={doTestProxy}>测试链接</button>
            </div>
            {proxyTestResult && (<p style={{ color: proxyTestResult.includes('成功') ? 'green' : 'red' }}>{proxyTestResult}</p>)}
          </div>
        </div>

        <div style={{ flex: 2 }}>
          <h2>配置文件列表</h2>
          <ul>
            {profiles.map(p => (
              <li key={p.id} style={{ marginBottom: 8 }}>
                <b>{p.name}</b>
                <span style={{ marginLeft: 8, color: '#555' }}>{p.proxy ? `socks5://${p.proxy.host}:${p.proxy.port}` : '无代理'}</span>
                <div style={{ display: 'inline-flex', gap: 8, marginLeft: 12 }}>
                  <button onClick={() => setSelected(p)}>选择</button>
                  <button onClick={() => start(p.id)}>启动会话</button>
                  <button onClick={() => stop(p.id)}>关闭会话</button>
                  <button onClick={() => exportFolder(p.id)}>导出到文件夹</button>
                  <button onClick={() => removeProfile(p.id)}>删除</button>
                </div>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16, textAlign: 'left' }}>
            <h3>从文件夹导入为新配置</h3>
            <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
              <input
                placeholder="源文件夹路径（服务器可访问）"
                value={importForm.folderPath}
                onChange={e => setImportForm({ ...importForm, folderPath: e.target.value })}
              />
              <input
                placeholder="名称（可选）"
                value={importForm.name}
                onChange={e => setImportForm({ ...importForm, name: e.target.value })}
              />
              <h4 style={{ margin: '8px 0 0' }}>socks5 代理（可选）</h4>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <input placeholder="host" value={importForm.proxy.host} onChange={e => setImportForm({ ...importForm, proxy: { ...importForm.proxy, host: e.target.value } })} />
                <input placeholder="port" value={importForm.proxy.port} onChange={e => setImportForm({ ...importForm, proxy: { ...importForm.proxy, port: e.target.value } })} />
                <input placeholder="username" value={importForm.proxy.username} onChange={e => setImportForm({ ...importForm, proxy: { ...importForm.proxy, username: e.target.value } })} />
                <input placeholder="password" type="password" value={importForm.proxy.password} onChange={e => setImportForm({ ...importForm, proxy: { ...importForm.proxy, password: e.target.value } })} />
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <input ref={folderInputRef} type="file" style={{ display: 'none' }} webkitdirectory="" directory="" multiple onChange={handleFolderSelect} />
                  <button onClick={() => folderInputRef.current?.click()}>选择文件夹</button>
                  <div style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
                    {importFiles.length > 0
                      ? `已选择目录：${selectedFolderName}（${importFiles.length} 个文件，约 ${formatBytes(selectedFolderSize)}）`
                      : '点击“选择文件夹”以选择本地目录上传导入'}
                  </div>
                </div>
                <div style={{ display: 'inline-flex', gap: 8 }}>
                  <button onClick={importFolder}>按服务器路径导入</button>
                  <button onClick={importFolderUpload}>选择文件夹上传导入</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <div style={{ marginTop: 24 }}>
          <h2>存储管理（{selected.name}）</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label>Origin:</label>
            <input style={{ width: 320 }} value={origin} onChange={e => setOrigin(e.target.value)} />
            <button onClick={() => doExportCookies(selected.id, new URL(origin).hostname)}>导出 Cookies</button>
            <button onClick={() => doImportCookies(selected.id)}>导入 Cookies</button>
            <button onClick={() => doExportStorage(selected.id, 'local')}>导出 localStorage</button>
            <button onClick={() => doImportStorage(selected.id, 'local')}>导入 localStorage</button>
            <button onClick={() => doExportStorage(selected.id, 'session')}>导出 sessionStorage</button>
            <button onClick={() => doImportStorage(selected.id, 'session')}>导入 sessionStorage</button>
          </div>
          <p style={{ color: '#666' }}>提示：存储与 Cookies 操作需要对应配置文件的浏览器会话处于启动状态。</p>
        </div>
      )}
    </div>
  )
}

export default App
