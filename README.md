1 操作系统 windos和macos 轻量级别的软件
2 用谷歌浏览器内核chrome140 做个指纹浏览器
3 此指纹浏览器用来批量管理账号的可以导出或者导入到其他电脑使用 
4 此指纹浏览器可以批量管理账号的登录状态 可以批量管理账号的cookie 可以批量管理账号的session 可以批量管理账号的localStorage 可以批量管理账号的sessionStorage
5 可以自己定义socks5 代理
6 
7 使用说明（测试阶段）：
8 - 后端与前端在本地运行，默认端口 `http://localhost:4000`（API+静态前端）与 `http://localhost:5173`（开发模式前端）。
9 - 浏览器内核使用本机安装的 Chrome/Chromium/Edge/Brave，或回退到项目内置的 `server/vendor` 浏览器。
10 
11 浏览器路径设置：
12 - macOS：优先自动查找 `/Applications/Google Chrome.app/...` 等路径；也可设置 `CHROME_PATH` 指向可执行文件：
13   - 例如 `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
14 - Windows：自动查找 `C:\Program Files\Google\Chrome\Application\chrome.exe`、Edge/Brave 等路径；也可设置：
15   - `CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`
16 
17 内置浏览器打包（避免用户下载）：
18 - 在 `server/` 目录执行：`npm run bundle:chrome`，会将本机浏览器拷贝到 `server/vendor/`。
19   - macOS：复制 `.app` 到 `server/vendor/Google Chrome.app`（或其他内核）。
20   - Windows：复制 `Application` 目录到 `server/vendor/chrome-win`（或 `edge-win`/`brave-win`/`chromium-win`）。
21 - 一键打包 ZIP：`npm run package:zip`，输出 `webset_*.zip`，内含 `server/`（含 vendor）与前端打包产物。
21 - 一键打包 ZIP（轻量测试版）：`npm run package:zip -- --light`，不包含 `vendor` 与 `node_modules`，体积更小（需目标机器执行 `npm install`）。
22 
23 运行与访问：
24 - 解压后进入 `server/` 执行 `node index.js`，访问 `http://localhost:4000`。
25 - 若使用开发模式前端，进入 `ui/` 执行 `npm run dev` 并访问 `http://localhost:5173`。
26 
27 代理：
28 - 支持自定义 SOCKS5 代理：在配置文件中填写 `host`/`port`（无认证直接生效）。
29 - 若需要认证（用户名/密码），建议使用系统级代理或扩展（如 SwitchyOmega）保存凭证。
30 
31 备注：当前为测试阶段，Windows 用户可直接运行后端并使用本机浏览器；如未安装，将自动使用打包内置浏览器（若存在）。# adweb git init git add read.md git commit -m first commit git branch -M main git remote add origin https://github.com/tztmr/adweb.git git push -u origin main
# adweb
# adweb
