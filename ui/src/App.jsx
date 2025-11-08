import { useEffect, useState, useRef } from 'react'
import './App.css'
import { listProfiles, saveProfile, deleteProfile, startSession, stopSession, exportCookies, importCookies, exportStorage, importStorage, exportProfileFolder, getChromeInfo, testProxy, getNetLogs, chooseFolder, importProfilesFromFolder, getHWID } from './api.js'
import { core as tauriCore } from '@tauri-apps/api'

function App() {
  const [profiles, setProfiles] = useState([])
  const [form, setForm] = useState({ name: '', proxy: { host: '', port: '', username: '', password: '' } })
  const [selected, setSelected] = useState(null)
  const [origin, setOrigin] = useState('https://www.douyin.com')
  const presetSites = [
    { name: '抖音', url: 'https://www.douyin.com' },
    { name: '小红书', url: 'https://www.xiaohongshu.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com' },
    { name: '抖音创作者', url: 'https://creator.douyin.com' },
    { name: '微博', url: 'https://weibo.com' },
    { name: '抖音抖币充值', url: 'https://www.douyin.com' },
    { name: 'DOU+', url: 'https://www.douyin.com' },
    { name: '抖音音乐', url: 'https://www.douyin.com' },
    { name: '快手', url: 'https://www.kuaishou.com' },
    { name: '快手直播', url: 'https://live.kuaishou.com' },
    { name: '京东', url: 'https://www.jd.com' },
    { name: '腾讯安全中心', url: 'https://110.qq.com' },
    { name: '淘宝', url: 'https://www.taobao.com' },
    { name: '天猫', url: 'https://www.tmall.com' },
    { name: '今日头条', url: 'https://www.toutiao.com' },
    { name: '芒果TV', url: 'https://www.mgtv.com' },
    { name: '星巴克', url: 'https://www.starbucks.com.cn' },
    { name: '百度贴吧', url: 'https://tieba.baidu.com' },
    { name: '网易号', url: 'https://mp.163.com' },
    { name: '迅雷会员', url: 'https://vip.xunlei.com' },
    { name: 'YY直播', url: 'https://www.yy.com' },
    { name: '虎牙直播', url: 'https://www.huya.com' },
    { name: '斗鱼直播', url: 'https://www.douyu.com' },
    { name: '网易云音乐', url: 'https://music.163.com' },
    { name: 'TikTok', url: 'https://www.tiktok.com' },
    { name: 'X', url: 'https://x.com' },
    { name: 'Instagram', url: 'https://www.instagram.com' },
    { name: '知乎', url: 'https://www.zhihu.com' },
    { name: '微视', url: 'https://weishi.qq.com' },
    { name: '懂车帝', url: 'https://www.dongchedi.com' },
    { name: '微博国际版', url: 'https://weibo.cn' },
    { name: '西瓜视频', url: 'https://www.ixigua.com' },
    { name: '爱奇艺', url: 'https://www.iqiyi.com' },
    { name: 'QQ音乐', url: 'https://y.qq.com' },
    { name: 'QQ邮箱', url: 'https://mail.qq.com' },
    { name: '腾讯音乐人', url: 'https://y.qq.com' },
    { name: '拼多多', url: 'https://www.pinduoduo.com' },
    { name: 'QQ充值', url: 'https://pay.qq.com' }
  ]
  const [startUrl, setStartUrl] = useState(presetSites[0].url)
  const [cardKey, setCardKey] = useState('')
  const [cardStatus, setCardStatus] = useState('unknown') // unknown/checking/valid/invalid
  const [cardErrorMsg, setCardErrorMsg] = useState('')
  const [hwid, setHwid] = useState('')
  const activated = cardStatus === 'valid'
  const [chromeInfo, setChromeInfo] = useState(null)
  const [proxyTestResult, setProxyTestResult] = useState(null)
  // 代理 URI 快速填充（支持 socks5://[user:pass@]host:port）
  const [proxyUri, setProxyUri] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  // 代理测试：允许自定义目标域名与超时
  const [testDestHost, setTestDestHost] = useState(() => {
    try { return new URL(presetSites[0].url).hostname } catch { return 'www.douyin.com' }
  })
  const [testTimeoutMs, setTestTimeoutMs] = useState(15000)
  // 已移除“选择文件夹上传导入”相关状态与引用
  // 已移除路径输入，改为通过目录选择器保存 zip
  // 默认首选项（地区/语言/时区）
  const [defaultRegion, setDefaultRegion] = useState('HK') // auto 自动、HK 香港、CN 大陆、TW 台湾
  const [defaultLanguage, setDefaultLanguage] = useState('zh-Hant') // auto 自动、zh-Hant 繁体中文、zh-Hans 简体中文、en 英语
  const [defaultTimezone, setDefaultTimezone] = useState('Asia/Hong_Kong') // auto 自动、Asia/Hong_Kong 香港、Asia/Shanghai 上海、Asia/Taipei 台北
  const [defaultExportFormat, setDefaultExportFormat] = useState('txt') // txt 或 json，控制导出默认格式
  const [defaultStealth, setDefaultStealth] = useState('light') // light/standard/heavy 伪装等级
  // 内置模态替代 alert/prompt：在 Tauri/Webview 下保证弹窗可见
  const [logsModalVisible, setLogsModalVisible] = useState(false)
  const [logsModalText, setLogsModalText] = useState('')
  const [proxyEditVisible, setProxyEditVisible] = useState(false)
  const [proxyEditProfile, setProxyEditProfile] = useState(null)
  const [proxyEditForm, setProxyEditForm] = useState({ host: '', port: '', username: '', password: '' })
  // Toast 通知与确认对话
  const toastTimerRef = useRef(null)
  const [toast, setToast] = useState({ visible: false, text: '', type: 'info' })
  const [confirmDlg, setConfirmDlg] = useState({ visible: false, text: '', onConfirm: null })
  function showToast(text, type = 'info', ms = 2500) {
    setToast({ visible: true, text, type })
    try { clearTimeout(toastTimerRef.current) } catch {}
    toastTimerRef.current = setTimeout(() => setToast({ visible: false, text: '', type: 'info' }), ms)
  }
  function openConfirm(text, onConfirm) { setConfirmDlg({ visible: true, text, onConfirm }) }
  function closeConfirm() { setConfirmDlg({ visible: false, text: '', onConfirm: null }) }
  useEffect(() => () => { try { clearTimeout(toastTimerRef.current) } catch {} }, [])

  // 卡密持久化：加载与保存
  useEffect(() => {
    try {
      const savedKey = localStorage.getItem('cardKey')
      if (savedKey) setCardKey(savedKey)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('cardKey', cardKey) } catch {}
  }, [cardKey])

  // 检测是否处于 Tauri 环境
  function isTauri () {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  }

  // 辅助：解析证书 payload（仅用于展示，不代表验签通过）
  function parseLicensePayload(license) {
    try {
      const parts = (license || '').split('.')
      if (parts.length !== 2) return null
      const payloadB64 = parts[0]
      // base64url -> base64 标准并补齐
      let s = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      while (s.length % 4 !== 0) s += '='
      const bin = atob(s)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const text = new TextDecoder().decode(bytes)
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  // 卡密/证书校验：优先通过 Tauri 命令进行验签；浏览器环境回退为占位逻辑
  async function verifyCardKey() {
    const license = (cardKey || '').trim()
    setCardStatus('checking')
    setCardErrorMsg('')
    try {
      if (isTauri()) {
        await tauriCore.invoke('verify_license', { args: { license } })
        setCardStatus('valid')
        return
      }
      // 浏览器开发环境：占位逻辑（非空即通过）
      const ok = Boolean(license)
      setTimeout(() => setCardStatus(ok ? 'valid' : 'invalid'), 200)
    } catch (e) {
      console.error('verify_license error:', e)
      setCardStatus('invalid')
      const msg = (e?.message || String(e))
      setCardErrorMsg(msg)
      showToast('验签失败：' + msg, 'error')
    }
  }

  // 解析 socks5 代理 URI，并写入 form.proxy
  function parseProxyFromUri(uriRaw) {
    const uri = (uriRaw || '').trim()
    if (!uri) return false
    try {
      // 允许省略协议前缀，自动补全为 socks5://
      const u = new URL(uri.match(/^socks5:\/\//i) ? uri : `socks5://${uri}`)
      if (u.protocol !== 'socks5:') throw new Error('仅支持 socks5 协议')
      const host = u.hostname
      const port = Number(u.port || '')
      const username = decodeURIComponent(u.username || '')
      const password = decodeURIComponent(u.password || '')
      if (!host || !port) throw new Error('host/port 缺失')
      setForm(f => ({ ...f, proxy: { ...f.proxy, host, port: String(port), username, password } }))
      return true
    } catch (e) {
      showToast('代理 URI 解析失败：' + (e.message || '格式错误'), 'error')
      return false
    }
  }

  // 统一守卫：未激活则阻止操作
  function requireActivated() {
    if (!activated) {
      showToast('请先完成卡密校验并激活后再使用此功能。', 'error')
      return false
    }
    return true
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem('defaultExportFormat')
      if (saved === 'txt' || saved === 'json') setDefaultExportFormat(saved)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('defaultExportFormat', defaultExportFormat) } catch {}
  }, [defaultExportFormat])

  async function refresh() {
    const data = await listProfiles()
    setProfiles(data)
  }

  useEffect(() => {
    refresh()
    getChromeInfo().then(setChromeInfo).catch(() => {})
    // 获取机器码（HWID）用于校验显示
    getHWID().then(d => { if (d && d.hwid) setHwid(d.hwid) }).catch(() => {})
    // 页面关闭时，通知后端关闭所有会话，确保浏览器退出
    const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    const isDevHost = typeof window !== 'undefined'
      && (/localhost|127\.0\.0\.1/i.test(window.location.hostname))
      && (window.location.port === '5173' || window.location.port === '5174')
    const apiBase = (isDevHost || isTauriEnv) ? 'http://localhost:4000' : window.location.origin
    const handleUnload = () => {
      // 在纯浏览器开发环境下不发送 stop-all，避免中断日志
      if (isDevHost && !isTauriEnv) return
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

  // 当切换预置网站时，默认将测试目标域名同步为该网站域名（可手工改）
  useEffect(() => {
    try { setTestDestHost(new URL(startUrl).hostname) } catch {}
  }, [startUrl])

  async function createProfile() {
    if (!requireActivated()) return
    // 优先尝试从 URI 自动解析一次
    if (proxyUri) parseProxyFromUri(proxyUri)
    const proxy = form.proxy.host && form.proxy.port ? { ...form.proxy, port: Number(form.proxy.port) } : null
    const p = await saveProfile({
      name: form.name,
      proxy,
      preferred: { region: defaultRegion, language: defaultLanguage, timezoneId: defaultTimezone, stealth: defaultStealth }
    })
    setForm({ name: '', proxy: { host: '', port: '', username: '', password: '' } })
    await refresh()
    setSelected(p)
    // 新建后自动启动会话并导航到当前选择的网站
    try {
      const r = await startSession(p.id, startUrl)
      if (!r?.ok) showToast('自动启动失败：' + (r?.error || '未知错误'), 'error')
    } catch (e) {
      showToast('自动启动失败：' + e.message, 'error')
    }
  }

  async function doTestProxy() {
    if (!requireActivated()) return
    // 优先尝试从 URI 自动解析一次
    if (proxyUri) parseProxyFromUri(proxyUri)
    const proxy = form.proxy
    if (!proxy.host || !proxy.port) {
      showToast('请先填写 socks5 的 host 与 port', 'error')
      return
    }
    if ((proxy.username && !proxy.password) || (!proxy.username && proxy.password)) {
      showToast('请同时填写用户名和密码，或两者都留空', 'error')
      return
    }
    const u = new URL(startUrl)
    const destHost = (testDestHost || '').trim() || u.hostname
    const destPort = u.protocol === 'https:' ? 443 : 80
    const timeoutMs = Number(testTimeoutMs) > 0 ? Number(testTimeoutMs) : 15000
    try {
      const res = await testProxy({ host: proxy.host, port: Number(proxy.port), username: proxy.username, password: proxy.password, destHost, destPort, timeoutMs })
      if (res.ok) {
        const extra = []
        if (res.atype) extra.push(`方式=${res.atype}`)
        if (res.ip) extra.push(`IP=${res.ip}`)
        setProxyTestResult(`连接成功：${proxy.host}:${proxy.port} → ${destHost}:${destPort}${extra.length ? '（' + extra.join(', ') + '）' : ''}`)
        showToast('代理链接测试成功', 'success')
      } else {
        const msg = res.error || '未知错误'
        const extra = []
        if (res.stage) extra.push(`阶段=${res.stage}`)
        if (res.atype) extra.push(`方式=${res.atype}`)
        if (res.ip) extra.push(`IP=${res.ip}`)
        setProxyTestResult(`连接失败：${msg}${extra.length ? '（' + extra.join(', ') + '）' : ''}`)
        showToast('代理链接测试失败：' + msg, 'error')
      }
    } catch (e) {
      setProxyTestResult(`连接异常：${e.message}`)
      showToast('代理链接测试异常：' + e.message, 'error')
    }
  }

  async function removeProfile(id) {
    if (!requireActivated()) return
    await deleteProfile(id)
    if (selected?.id === id) setSelected(null)
    await refresh()
  }

  async function start(id) { if (!requireActivated()) return; await startSession(id, startUrl) }
  async function stop(id) { if (!requireActivated()) return; await stopSession(id) }

  function editProxy(p) {
    if (!requireActivated()) return
    setProxyEditProfile(p || null)
    const host = p?.proxy?.host || ''
    const port = String(p?.proxy?.port || '')
    const username = p?.proxy?.username || ''
    const password = p?.proxy?.password || ''
    setProxyEditForm({ host, port, username, password })
    setProxyEditVisible(true)
  }

  async function saveProxyEdit() {
    if (!requireActivated()) return
    const p = proxyEditProfile
    if (!p) { setProxyEditVisible(false); return }
    try {
      const host = (proxyEditForm.host || '').trim()
      const portStr = (proxyEditForm.port || '').trim()
      const username = (proxyEditForm.username || '').trim()
      const password = (proxyEditForm.password || '').trim()
      const proxy = host && portStr ? { host, port: Number(portStr), username, password } : null
      const updated = await saveProfile({ id: p.id, name: p.name, proxy })
      await refresh()
      setSelected(updated)
      setProxyEditVisible(false)
    } catch (e) {
      setLogsModalText('更新代理失败：' + e.message)
      setLogsModalVisible(true)
    }
  }

  function cancelProxyEdit() { setProxyEditVisible(false); setProxyEditProfile(null) }

  async function viewNetLogs(id) {
    if (!requireActivated()) return
    try {
      const r = await getNetLogs(id)
      if (!r.ok) throw new Error(r.error || '获取网络诊断失败')
      const logs = r.logs || []
      const last = logs.slice(-10)
      const lines = last.map(it => {
        const t = new Date(it.ts).toLocaleTimeString()
        if (it.type === 'failed') {
          return `[${t}] 失败: ${it.payload?.errorText || '未知错误'} (${it.payload?.type || 'unknown'})`
        } else if (it.type === 'response') {
          return `[${t}] 响应: ${it.payload?.status} ${it.payload?.url}`
        } else if (it.type === 'request') {
          return `[${t}] 请求: ${it.payload?.method} ${it.payload?.url}`
        }
        return `[${t}] ${it.type}`
      }).join('\n')
      setLogsModalText(lines || '暂无日志')
      setLogsModalVisible(true)
    } catch (e) {
      setLogsModalText('网络诊断获取失败：' + e.message)
      setLogsModalVisible(true)
    }
  }

  async function doExportCookies(id, domain) {
    if (!requireActivated()) return
    try {
      const cookies = await exportCookies(id, domain)
      if (!Array.isArray(cookies)) {
        const msg = cookies && typeof cookies === 'object' && (cookies.error || cookies.message)
        throw new Error(msg || '未获取到 cookies，请先启动会话或检查域名')
      }
      // 将 cookies 导出为可读的 txt 文本，每行一个 cookie，包含关键属性
      const lines = cookies.map(c => {
        const parts = []
        parts.push(`${c.name}=${c.value}`)
        if (c.domain) parts.push(`domain=${c.domain}`)
        parts.push(`path=${c.path || '/'}`)
        if (c.httpOnly) parts.push('HttpOnly')
        if (c.secure) parts.push('Secure')
        if (c.sameSite) parts.push(`SameSite=${c.sameSite}`)
        if (typeof c.expires === 'number' && c.expires > 0) {
          try { parts.push(`expires=${new Date(c.expires * 1000).toUTCString()}`) } catch {}
        }
        return parts.join('; ')
      })
      const txt = lines.join('\n')
      const json = JSON.stringify(cookies, null, 2)
      const base = `cookies-${(domain || 'all').replace(/[^a-zA-Z0-9_-]+/g, '_')}-${id}`
      await saveTxtOrJson({ txt, json, suggestedBaseName: base, preferred: defaultExportFormat })
    } catch (e) {
      const msg = /session not running/i.test(e.message || '') ? '当前会话未启动，请先点击“启动会话”后再导出 Cookies。' : e.message
      showToast('导出失败：' + msg, 'error')
    }
  }

  async function doImportCookies(id) {
    if (!requireActivated()) return
    try {
      const text = await pickTextFileContent(['.txt', '.json'])
      if (!text) return
      const host = (() => { try { return new URL(origin).hostname } catch { return '' } })()
      const cookies = parseCookiesAny(text, host)
      await importCookies(id, cookies)
      showToast('导入成功', 'success')
    } catch (e) {
      const msg = /session not running/i.test(e.message || '') ? '当前会话未启动，请先点击“启动会话”后再导入 Cookies。' : e.message
      showToast('导入失败：' + msg, 'error')
    }
  }

  async function doExportStorage(id, type) {
    if (!requireActivated()) return
    try {
      const data = await exportStorage(id, origin, type)
      const host = (() => { try { return new URL(origin).hostname } catch { return 'origin' } })()
      const lines = Object.entries(data || {}).map(([k, v]) => `${k}=${String(v ?? '')}`)
      const txt = lines.join('\n')
      const json = JSON.stringify(data || {}, null, 2)
      const base = `storage-${type}-${host}-${id}`
      await saveTxtOrJson({ txt, json, suggestedBaseName: base, preferred: defaultExportFormat })
    } catch (e) {
      const msg = /session not running/i.test(e.message || '') ? '当前会话未启动，请先点击“启动会话”后再导出存储。' : e.message
      showToast('导出失败：' + msg, 'error')
    }
  }

  async function doImportStorage(id, type) {
    if (!requireActivated()) return
    try {
      const text = await pickTextFileContent(['.txt', '.json'])
      if (!text) return
      const obj = parseStorageAny(text)
      await importStorage(id, { origin, type, data: obj })
      showToast('导入成功', 'success')
    } catch (e) {
      const msg = /session not running/i.test(e.message || '') ? '当前会话未启动，请先点击“启动会话”后再导入存储。' : e.message
      showToast('导入失败：' + msg, 'error')
    }
  }
  

  async function bulkExportChoose() {
    if (!requireActivated()) return
    try {
      if (!profiles || profiles.length === 0) { showToast('当前没有配置文件', 'info'); return }
      setBulkBusy(true)
      const pick = await chooseFolder()
      if (pick?.error || !pick?.path) { showToast('未选择路径或选择失败', 'error'); return }
      const targetRoot = pick.path
      let okCount = 0
      for (const p of profiles) {
        try {
          await exportProfileFolder(p.id, targetRoot)
          okCount++
        } catch (err) {
          console.error('导出失败', p.id, err)
        }
      }
      showToast(`批量导出完成：成功 ${okCount}/${profiles.length} 个；位置：${targetRoot}`, 'success')
    } catch (e) {
      showToast('批量导出失败：' + e.message, 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDeleteConfirmed() {
    try {
      setBulkBusy(true)
      await Promise.all(profiles.map(p => deleteProfile(p.id)))
      setSelected(null)
      await refresh()
      showToast('已批量删除所有配置', 'success')
    } catch (e) {
      showToast('批量删除失败：' + e.message, 'error')
    } finally {
      setBulkBusy(false)
    }
  }
  async function requestBulkDelete() {
    if (!requireActivated()) return
    if (!profiles || profiles.length === 0) { showToast('当前没有配置文件', 'info'); return }
    openConfirm(`确认删除全部 ${profiles.length} 个配置？此操作不可恢复！`, () => bulkDeleteConfirmed())
  }

  async function bulkImportFromFolder() {
    if (!requireActivated()) return
    try {
      setBulkBusy(true)
      const pick = await chooseFolder()
      if (pick?.error || !pick?.path) { showToast('未选择路径或选择失败', 'error'); return }
      const res = await importProfilesFromFolder(pick.path)
      await refresh()
      const ok = Number(res?.importedCount || 0)
      const skipped = Number(res?.skippedCount || 0)
      showToast(`批量导入完成：成功 ${ok} 个，跳过 ${skipped} 个；来源：${pick.path}`, 'success')
    } catch (e) {
      showToast('批量导入失败：' + e.message, 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  // 已移除“选择文件夹上传导入”的辅助函数与逻辑

  // 保存文本/JSON到用户自选路径（优先使用文件保存选择器，回退到下载）
  async function saveTextFile(content, suggestedName = 'export.txt', mime = 'text/plain') {
    try {
      if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [
            { description: 'Text', accept: { 'text/plain': ['.txt'] } },
            { description: 'JSON', accept: { 'application/json': ['.json'] } }
          ]
        })
        const writable = await handle.createWritable()
        await writable.write(new Blob([content], { type: mime }))
        await writable.close()
        showToast(`已保存文件：${handle.name}`, 'success')
        return
      }
    } catch (e) {
      // 选择器失败时回退
    }
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('已触发浏览器下载（请在系统下载目录查看保存的文件）', 'info')
  }

  // 根据用户选择的扩展名保存为 .txt 或 .json
  async function saveTxtOrJson({ txt, json, suggestedBaseName = 'export', preferred = 'txt' }) {
    const pref = preferred === 'json' ? 'json' : 'txt'
    const suggestedName = `${suggestedBaseName}.${pref}`
    try {
      if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [
            { description: 'Text', accept: { 'text/plain': ['.txt'] } },
            { description: 'JSON', accept: { 'application/json': ['.json'] } }
          ]
        })
        const writable = await handle.createWritable()
        const nameLower = String(handle.name || '').toLowerCase()
        const useJson = nameLower.endsWith('.json') || (!nameLower.endsWith('.txt') && pref === 'json')
        const blob = new Blob([useJson ? json : txt], { type: useJson ? 'application/json' : 'text/plain' })
        await writable.write(blob)
        await writable.close()
        showToast(`已保存文件：${handle.name}`, 'success')
        return
      }
    } catch (e) {
      // 选择器失败时回退
    }
    // 回退：按首选格式下载
    const useJson = pref === 'json'
    const blob = new Blob([useJson ? json : txt], { type: useJson ? 'application/json' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${suggestedBaseName}.${pref}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('已触发浏览器下载（请在系统下载目录查看保存的文件）', 'info')
  }

  // 选择并读取文本文件内容（优先使用系统选择器，回退到 input[file]）
  async function pickTextFileContent(extensions = ['.txt']) {
    try {
      if ('showOpenFilePicker' in window && typeof window.showOpenFilePicker === 'function') {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Text', accept: { 'text/plain': extensions } }],
          multiple: false
        })
        const file = await handle.getFile()
        return await file.text()
      }
    } catch (e) {
      // 选择器失败时回退
    }
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = extensions.join(',')
      input.onchange = async () => {
        const f = input.files && input.files[0]
        if (!f) return resolve('')
        resolve(await f.text())
      }
      input.click()
    })
  }

  // 解析 TXT 格式 Cookies 文本为对象数组
  function parseCookiesTxt(text, defaultDomain = '') {
    const lines = String(text || '').split(/\r?\n/)
    const out = []
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const parts = line.split(';').map(s => s.trim()).filter(Boolean)
      const first = parts.shift() || ''
      const eq = first.indexOf('=')
      const name = eq >= 0 ? first.slice(0, eq) : first
      const value = eq >= 0 ? first.slice(eq + 1) : ''
      const c = { name, value, domain: defaultDomain || undefined, path: '/', httpOnly: false, secure: false }
      for (const p of parts) {
        const [k, v] = p.split('=').map(s => s.trim())
        if (!k) continue
        const key = k.toLowerCase()
        if (key === 'domain') c.domain = v
        else if (key === 'path') c.path = v || '/'
        else if (key === 'httponly') c.httpOnly = true
        else if (key === 'secure') c.secure = true
        else if (key === 'samesite') c.sameSite = v
        else if (key === 'expires') {
          const t = Date.parse(v)
          if (!Number.isNaN(t)) c.expires = Math.floor(t / 1000)
        }
      }
      out.push(c)
    }
    return out
  }

  // 自动识别 JSON 或 TXT 格式的 Cookies 文本
  function parseCookiesAny(text, defaultDomain = '') {
    const s = String(text || '')
    try {
      const data = JSON.parse(s)
      const normalize = (c) => {
        const out = {
          name: c.name,
          value: c.value,
          domain: c.domain || defaultDomain || undefined,
          path: c.path || '/',
          httpOnly: !!c.httpOnly,
          secure: !!c.secure,
          sameSite: c.sameSite
        }
        if (typeof c.expires === 'number') out.expires = c.expires
        else if (typeof c.expires === 'string') {
          const t = Date.parse(c.expires)
          if (!Number.isNaN(t)) out.expires = Math.floor(t / 1000)
        }
        return out
      }
      if (Array.isArray(data)) return data.map(normalize)
      if (data && Array.isArray(data.cookies)) return data.cookies.map(normalize)
      if (data && typeof data === 'object') {
        // 形如 { key: value } 的对象，转为 Cookie 列表
        return Object.entries(data).map(([name, value]) => ({ name, value, domain: defaultDomain || undefined, path: '/', httpOnly: false, secure: false }))
      }
    } catch {
      // 不是 JSON，回退为 TXT 解析
    }
    return parseCookiesTxt(s, defaultDomain)
  }

  // 解析 TXT 格式存储文本为对象（每行 key=value）
  function parseStorageTxt(text) {
    const out = {}
    const lines = String(text || '').split(/\r?\n/)
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx < 0) continue
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1)
      out[key] = value
    }
    return out
  }

  // 自动识别 JSON 或 TXT 的存储文本
  function parseStorageAny(text) {
    const s = String(text || '')
    try {
      const data = JSON.parse(s)
      if (data && typeof data === 'object' && !Array.isArray(data)) return data
    } catch {
      // 非 JSON
    }
    return parseStorageTxt(s)
  }

  async function exportProfilesByName() {
    if (!requireActivated()) return
    try {
      const data = await listProfiles()
      const sorted = [...(data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      const payload = sorted.map(p => ({ id: p.id, name: p.name, proxy: p.proxy || null, createdAt: p.createdAt || null }))
      const json = JSON.stringify(payload, null, 2)
      await saveTextFile(json, 'profiles-by-name.json', 'application/json')
    } catch (e) {
      showToast('导出失败：' + e.message, 'error')
    }
  }

  // 已移除“选择文件夹”事件处理逻辑

  // 已移除体积格式化辅助函数（仅用于上传导入）

  return (
    <div style={{ padding: 20 }}>
      <h1>TZT指纹浏览器配置管理</h1>
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
            <option key={`${s.name}|${s.url}`} value={s.url}>{s.name}</option>
          ))}
        </select>
        <label style={{ marginLeft: 12, marginRight: 8 }}>卡密：</label>
        <input
          type="text"
          value={cardKey}
          onChange={e => setCardKey(e.target.value)}
          placeholder="请输入卡密"
          style={{ padding: '4px 8px', width: 220 }}
        />
        <button
          onClick={verifyCardKey}
          disabled={!cardKey || cardStatus === 'checking'}
          style={{ marginLeft: 8, padding: '4px 12px' }}
        >校验</button>
        <span style={{ marginLeft: 8, color: cardStatus === 'valid' ? 'green' : cardStatus === 'invalid' ? 'red' : '#666' }}>
          {cardStatus === 'unknown' ? '未校验' : cardStatus === 'checking' ? '校验中…' : cardStatus === 'valid' ? '已激活' : '校验失败'}
        </span>
        <span style={{ marginLeft: 16 }}>
          机器码：<code style={{ background: '#f4f4f4', padding: '2px 6px', borderRadius: 4 }}>{hwid || '获取中…'}</code>
        </span>
        <button
          onClick={() => { if (hwid) { try { navigator.clipboard?.writeText(hwid) } catch {} } }}
          disabled={!hwid}
          style={{ marginLeft: 6, padding: '4px 8px' }}
        >复制</button>
      </div>
      {!activated && (
        <div style={{ marginTop: 6, color: '#c33' }}>功能已锁定：请先校验卡密并激活后再使用下方功能。</div>
      )}
      {/* 证书详情与错误信息展示，便于定位校验失败原因 */}
      {cardKey && (
        (() => {
          const info = parseLicensePayload(cardKey)
          const bound = info?.boundHwid || ''
          const match = bound && hwid && bound === hwid
          return (
            <div style={{ margin: '8px 0', padding: '8px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}>
              <div style={{ color: '#333', marginBottom: 4 }}>
                证书信息：{info ? (
                  <>
                    <span style={{ marginRight: 12 }}>ID：{info.licenseId}</span>
                    <span style={{ marginRight: 12 }}>产品：{info.product}</span>
                    <span style={{ marginRight: 12 }}>到期：{info.expiresAt}</span>
                  </>
                ) : '无法解析（格式应为 payloadB64url.sigB64url）'}
              </div>
              {info && (
                <div style={{ color: match ? 'green' : bound ? 'red' : '#666' }}>
                  绑定 HWID：<code style={{ background: '#f4f4f4', padding: '2px 6px', borderRadius: 4 }}>{bound || '未绑定'}</code>
                  <span style={{ marginLeft: 8 }}>
                    {bound ? (match ? '（与本机匹配）' : `（与本机不匹配：${hwid || '未知'}）`) : '（建议发卡绑定设备以保证唯一性）'}
                  </span>
                </div>
              )}
              {cardStatus === 'invalid' && cardErrorMsg && (
                <div style={{ color: 'red', marginTop: 6 }}>错误原因：{cardErrorMsg}</div>
              )}
            </div>
          )
        })()
      )}

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
      <div>
          <label style={{ marginRight: 8 }}>默认导出格式：</label>
          <select value={defaultExportFormat} onChange={e => setDefaultExportFormat(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="txt">TXT</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div>
          <label style={{ marginRight: 8 }}>默认伪装等级：</label>
          <select value={defaultStealth} onChange={e => setDefaultStealth(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="light">轻度</option>
            <option value="standard">标准</option>
            <option value="heavy">重度</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h2>新建配置文件</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder="名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <h3>socks5 代理（可选）</h3>
            <input placeholder="socks5 代理 URI（如：socks5://user:pass@host:1080）" value={proxyUri} onChange={e => setProxyUri(e.target.value)} onBlur={() => proxyUri && parseProxyFromUri(proxyUri)} />
            <input placeholder="host" value={form.proxy.host} onChange={e => setForm({ ...form, proxy: { ...form.proxy, host: e.target.value } })} />
            <input placeholder="port" value={form.proxy.port} onChange={e => setForm({ ...form, proxy: { ...form.proxy, port: e.target.value } })} />
            <input placeholder="username（可选）" value={form.proxy.username} onChange={e => setForm({ ...form, proxy: { ...form.proxy, username: e.target.value } })} />
            <input placeholder="password（可选）" type="password" value={form.proxy.password} onChange={e => setForm({ ...form, proxy: { ...form.proxy, password: e.target.value } })} />
            <div style={{ color: '#666', fontSize: 12 }}>
              支持 URI 一键解析（失焦自动解析）；如代理需要认证，请同时填写用户名与密码；点击“测试链接”验证握手与连通性。
            </div>
            <input placeholder="测试目标域名（默认取当前网站域名）" value={testDestHost} onChange={e => setTestDestHost(e.target.value)} />
            <input placeholder="测试超时（毫秒，默认15000）" type="number" value={testTimeoutMs} onChange={e => setTestTimeoutMs(e.target.value)} />
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <button onClick={createProfile} disabled={!activated}>创建</button>
              <button onClick={doTestProxy} disabled={!activated}>测试链接</button>
            </div>
            {proxyTestResult && (<p style={{ color: proxyTestResult.includes('成功') ? 'green' : 'red' }}>{proxyTestResult}</p>)}
          </div>
        </div>

        <div style={{ flex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>配置文件列表</h2>
            <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
              <span style={{ color: '#666' }}>共 {profiles.length} 个</span>
              <button onClick={bulkImportFromFolder} disabled={!activated || bulkBusy}>批量导入</button>
              <button onClick={bulkExportChoose} disabled={!activated || bulkBusy || profiles.length === 0}>批量导出</button>
              <button onClick={requestBulkDelete} disabled={!activated || bulkBusy || profiles.length === 0}>批量删除</button>
            </div>
          </div>
          {/* 已移除导出配置列表按钮与路径输入，改为选择文件夹保存 zip */}
          <div style={{ height: 380, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6, padding: '8px 12px', marginTop: 8 }}>
            <ul style={{ margin: 0, padding: 0 }}>
              {profiles.map(p => (
              <li
                key={p.id}
                style={{
                  marginBottom: 8,
                  padding: 8,
                  border: '1px solid #eee',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200 }}>
                  <span style={{ fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ marginLeft: 4, color: '#888', fontSize: 12 }}>{p.proxy ? `socks5://${p.proxy.host}:${p.proxy.port}` : '无代理'}</span>
                  {selected?.id === p.id && (<span style={{ marginLeft: 6, color: '#2b7', fontSize: 12 }}>已选中</span>)}
                </div>
                <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                  <button title="选择当前配置" onClick={() => setSelected(p)}>选择</button>
                  <button title="编辑代理设置" onClick={() => editProxy(p)} disabled={!activated}>编辑代理</button>
                  <button title="启动浏览器会话" onClick={() => start(p.id)} disabled={!activated}>启动会话</button>
                  <button title="关闭浏览器会话" onClick={() => stop(p.id)} disabled={!activated}>关闭会话</button>
                  <button title="查看网络诊断" onClick={() => viewNetLogs(p.id)} disabled={!activated}>网络诊断</button>
                  <button title="删除该配置" onClick={() => removeProfile(p.id)} disabled={!activated}>删除</button>
                </div>
              </li>
            ))}
            </ul>
          </div>
          {/* 已移除“从文件夹导入为新配置（上传方式）”的 UI 区域 */}
        </div>
      </div>

      {selected && (
        <div style={{ marginTop: 24 }}>
          <h2>存储管理（{selected.name}）</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label>Origin:</label>
            <input style={{ width: 320 }} value={origin} onChange={e => setOrigin(e.target.value)} />
            <button onClick={() => doExportCookies(selected.id, new URL(origin).hostname)} disabled={!activated}>导出 Cookies</button>
            <button onClick={() => doImportCookies(selected.id)} disabled={!activated}>导入 Cookies</button>
            <button onClick={() => doExportStorage(selected.id, 'local')} disabled={!activated}>导出 localStorage</button>
            <button onClick={() => doImportStorage(selected.id, 'local')} disabled={!activated}>导入 localStorage</button>
            <button onClick={() => doExportStorage(selected.id, 'session')} disabled={!activated}>导出 sessionStorage</button>
            <button onClick={() => doImportStorage(selected.id, 'session')} disabled={!activated}>导入 sessionStorage</button>
          </div>
          <p style={{ color: '#666' }}>提示：存储与 Cookies 操作需要对应配置文件的浏览器会话处于启动状态。</p>
        </div>
      )}
      {/* 内置模态：网络诊断显示 */}
      {logsModalVisible && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ width: 640, maxWidth: '90%', maxHeight: '80%', background: '#fff', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', padding: 16, display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: 0, marginBottom: 8 }}>网络诊断</h3>
            <pre style={{ flex: 1, overflow: 'auto', background: '#f7f7f7', padding: 12, borderRadius: 6 }}>
{logsModalText}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => { try { navigator.clipboard?.writeText(logsModalText) } catch {} }}>复制</button>
              <button onClick={() => setLogsModalVisible(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 内置模态：编辑代理设置 */}
      {proxyEditVisible && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ width: 520, maxWidth: '90%', background: '#fff', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>编辑代理</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <input placeholder="host（留空清除代理）" value={proxyEditForm.host} onChange={e => setProxyEditForm({ ...proxyEditForm, host: e.target.value })} />
              <input placeholder="port" value={proxyEditForm.port} onChange={e => setProxyEditForm({ ...proxyEditForm, port: e.target.value })} />
              <input placeholder="username（可选）" value={proxyEditForm.username} onChange={e => setProxyEditForm({ ...proxyEditForm, username: e.target.value })} />
              <input placeholder="password（可选）" type="password" value={proxyEditForm.password} onChange={e => setProxyEditForm({ ...proxyEditForm, password: e.target.value })} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={saveProxyEdit}>保存</button>
                <button onClick={cancelProxyEdit}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toast.visible && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 11000 }}>
          <div style={{ padding: '10px 14px', borderRadius: 6, color: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.2)', minWidth: 240,
            background: toast.type === 'success' ? '#2b7' : toast.type === 'error' ? '#e23' : '#333' }}>
            {toast.text}
          </div>
        </div>
      )}

      {/* 确认对话 */}
      {confirmDlg.visible && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10999 }}>
          <div style={{ width: 460, maxWidth: '90%', background: '#fff', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>请确认</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{confirmDlg.text}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={closeConfirm}>取消</button>
              <button onClick={() => { try { confirmDlg.onConfirm?.() } finally { closeConfirm() } }}>确定</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
