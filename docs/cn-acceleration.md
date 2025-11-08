**大陆环境加速下载指引**

- Rust 工具链（rustup/cargo）使用国内镜像：
  - 终端执行：
    - `export RUSTUP_DIST_SERVER=https://rsproxy.cn`
    - `export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup`
    - 安装：`curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh -s -- -y`
    - 初始化后执行：`source $HOME/.cargo/env`（或重新打开终端）
  - 本项目已在 `.cargo/config.toml` 配置了 crates 镜像（`rsproxy.cn`），后续 `cargo` 拉取依赖会走国内源。

- NPM 使用国内镜像：
  - 全局设置：`npm config set registry https://registry.npmmirror.com`
  - 本项目已在根、`ui/`、`server/` 写入 `.npmrc` 指向 `npmmirror.com`。

- 代理（如有）：
  - `export HTTPS_PROXY=http://127.0.0.1:7890`
  - `export HTTP_PROXY=http://127.0.0.1:7890`
  - `export ALL_PROXY=socks5://127.0.0.1:7890`

- 验证安装：
  - `cargo -V` 与 `rustc -V` 有版本输出即成功。

- 启动开发：
  - 在项目根：`npx tauri dev`
  - 如需前端热更新：先在 `ui/` 运行 `npm run dev`，再在根执行 `npx tauri dev`（配置已指向 `http://localhost:5173`）。