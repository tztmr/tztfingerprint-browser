import net from 'net'

// 轻量 SOCKS5 本地转发器：
// 接受本地客户端（Chrome）无认证握手，连接上游 SOCKS5（支持用户名/密码），完成 CONNECT 并双向转发。
// 用法：
// const fwd = await createSocks5Forwarder({ upstreamHost, upstreamPort, username, password, bindHost: '127.0.0.1', bindPort: 0, timeoutMs: 15000 })
// chromeFlags 使用 `--proxy-server=socks5://127.0.0.1:${fwd.port}`；关闭时调用 fwd.close()

export async function createSocks5Forwarder({
  upstreamHost,
  upstreamPort,
  username = null,
  password = null,
  bindHost = '127.0.0.1',
  bindPort = 0,
  timeoutMs = 15000
}) {
  if (!upstreamHost || !upstreamPort) throw new Error('缺少上游代理 host/port')

  const sockets = new Set()
  const server = net.createServer((client) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    client.on('error', () => {})
    // 不对客户端连接设置闲置超时，避免正常浏览时连接被误杀
    // 开启 TCP keepalive，帮助维持 NAT 映射与长连接稳定
    try { client.setKeepAlive(true, 20000) } catch {}

    // 1) 客户端方法协商（本地不认证）
    client.once('data', (greetBuf) => {
      try {
        if (!greetBuf || greetBuf.length < 2 || greetBuf[0] !== 0x05) {
          try { client.destroy() } catch {}
          return
        }
        // 忽略具体 methods，直接回应无认证
        client.write(Buffer.from([0x05, 0x00]))

        // 2) 客户端 CONNECT 请求（只支持 CMD=0x01）
        client.once('data', (reqBuf) => {
          try {
            if (!reqBuf || reqBuf.length < 7 || reqBuf[0] !== 0x05 || reqBuf[1] !== 0x01) {
              // 命令不支持
              sendClientReply(client, 0x07)
              try { client.destroy() } catch {}
              return
            }
            const atyp = reqBuf[3]
            let dstHost = null
            let dstPort = null
            let offset = 4
            if (atyp === 0x01) { // IPv4
              if (reqBuf.length < offset + 4 + 2) { sendClientReply(client, 0x01); client.destroy(); return }
              dstHost = `${reqBuf[offset]}.${reqBuf[offset + 1]}.${reqBuf[offset + 2]}.${reqBuf[offset + 3]}`
              offset += 4
              dstPort = reqBuf.readUInt16BE(offset)
            } else if (atyp === 0x03) { // DOMAIN
              const len = reqBuf[offset]
              if (reqBuf.length < offset + 1 + len + 2) { sendClientReply(client, 0x01); client.destroy(); return }
              dstHost = reqBuf.slice(offset + 1, offset + 1 + len).toString('utf8')
              offset += 1 + len
              dstPort = reqBuf.readUInt16BE(offset)
            } else if (atyp === 0x04) { // IPv6（简单跳过，不支持）
              sendClientReply(client, 0x08)
              try { client.destroy() } catch {}
              return
            } else {
              sendClientReply(client, 0x08)
              try { client.destroy() } catch {}
              return
            }

            // 连接上游 SOCKS5 并发起 CONNECT
            const upstream = new net.Socket()
            sockets.add(upstream)
            upstream.on('close', () => sockets.delete(upstream))
            upstream.on('error', (e) => {
              // 上游发生错误，向客户端回 REP=0x01 一般故障
              try { sendClientReply(client, 0x01) } catch {}
              try { client.destroy() } catch {}
            })
            // 同样不设置闲置超时，改为 TCP keepalive
            try { upstream.setKeepAlive(true, 20000) } catch {}

            upstream.connect({ host: upstreamHost, port: Number(upstreamPort) }, () => {
              // 上游方法协商：优先用户名/密码，其次无认证
              const greet = (username && password)
                ? Buffer.from([0x05, 0x01, 0x02])
                : Buffer.from([0x05, 0x01, 0x00])
              upstream.write(greet)
              upstream.once('data', (sel) => {
                if (!sel || sel.length < 2 || sel[0] !== 0x05 || sel[1] === 0xFF) {
                  // 不支持认证方式
                  try { sendClientReply(client, 0x01) } catch {}
                  try { client.destroy() } catch {}
                  try { upstream.destroy() } catch {}
                  return
                }

                const method = sel[1]
                const proceedConnect = () => {
                  // 构造上游 CONNECT 请求
                  let req
                  if (/^\d+\.\d+\.\d+\.\d+$/.test(dstHost)) {
                    const parts = dstHost.split('.').map(n => Number(n))
                    req = Buffer.alloc(10)
                    req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x01
                    req[4] = parts[0]; req[5] = parts[1]; req[6] = parts[2]; req[7] = parts[3]
                    req.writeUInt16BE(dstPort, 8)
                  } else {
                    const hbuf = Buffer.from(dstHost)
                    req = Buffer.alloc(7 + hbuf.length)
                    req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03
                    req[4] = hbuf.length
                    hbuf.copy(req, 5)
                    req.writeUInt16BE(dstPort, 5 + hbuf.length)
                  }
                  upstream.write(req)
                  upstream.once('data', (rbuf) => {
                    if (!rbuf || rbuf.length < 2 || rbuf[0] !== 0x05) {
                      try { sendClientReply(client, 0x01) } catch {}
                      try { client.destroy() } catch {}
                      try { upstream.destroy() } catch {}
                      return
                    }
                    const rep = rbuf[1]
                    if (rep !== 0x00) {
                      try { sendClientReply(client, rep) } catch {}
                      try { client.destroy() } catch {}
                      try { upstream.destroy() } catch {}
                      return
                    }
                    // 回复客户端成功，复用上游返回的 BND 字段
                    try { client.write(rbuf) } catch {}
                    // 建立双向转发
                    try {
                      client.pipe(upstream)
                      upstream.pipe(client)
                    } catch {}
                  })
                }

                if (method === 0x02) {
                  // 用户名/密码认证
                  const u = Buffer.from(String(username || ''))
                  const p = Buffer.from(String(password || ''))
                  const auth = Buffer.alloc(3 + u.length + p.length)
                  auth[0] = 0x01
                  auth[1] = u.length
                  u.copy(auth, 2)
                  auth[2 + u.length] = p.length
                  p.copy(auth, 3 + u.length)
                  upstream.write(auth)
                  upstream.once('data', (abuf) => {
                    if (!abuf || abuf.length < 2 || abuf[0] !== 0x01 || abuf[1] !== 0x00) {
                      try { sendClientReply(client, 0x01) } catch {}
                      try { client.destroy() } catch {}
                      try { upstream.destroy() } catch {}
                      return
                    }
                    proceedConnect()
                  })
                } else {
                  // 无认证
                  proceedConnect()
                }
              })
            })
          } catch {
            try { sendClientReply(client, 0x01) } catch {}
            try { client.destroy() } catch {}
          }
        })
      } catch {
        try { client.destroy() } catch {}
      }
    })
  })

  const addr = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(bindPort, bindHost, () => {
      try { resolve(server.address()) } catch (e) { reject(e) }
    })
  })

  function sendClientReply(client, repCode) {
    // REP 回复：VER=0x05, REP=repCode, RSV=0x00, ATYP=0x01(0.0.0.0), BND=0.0.0.0:0
    const resp = Buffer.alloc(10)
    resp[0] = 0x05; resp[1] = repCode; resp[2] = 0x00; resp[3] = 0x01
    resp[4] = 0x00; resp[5] = 0x00; resp[6] = 0x00; resp[7] = 0x00
    resp.writeUInt16BE(0, 8)
    try { client.write(resp) } catch {}
  }

  const forwarder = {
    host: typeof addr === 'object' ? addr.address : bindHost,
    port: typeof addr === 'object' ? addr.port : bindPort,
    close: () => {
      try { server.close() } catch {}
      for (const s of Array.from(sockets)) {
        try { s.destroy() } catch {}
      }
      sockets.clear()
    }
  }

  return forwarder
}