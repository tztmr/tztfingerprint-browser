use serde::Deserialize;
use ed25519_dalek::{PublicKey, Signature, Verifier};
use base64::{engine::general_purpose, Engine as _};
use machine_uid::get;
use std::time::SystemTime;

// 固定内置的 base64 公钥（Ed25519 32 字节）
const PUBKEY_B64: &str = "0OFf5j7nMnQk0vRrhviwpNu0DFzBK2eYGwdr5zRoOwY=";

#[derive(Deserialize)]
pub struct VerifyArgs {
    license: String
}

#[derive(serde::Deserialize)]
struct Payload {
    licenseId: String,
    product: String,
    expiresAt: String,
    maxActivations: Option<u32>,
    nonce: Option<String>,
    boundHwid: Option<String>,
    issuedAt: Option<String>,
}

#[tauri::command]
pub fn verify_license(args: VerifyArgs) -> Result<String, String> {
    // 拆分 license = payloadB64 + "." + sigB64url
    let parts: Vec<&str> = args.license.split('.').collect();
    if parts.len() != 2 { return Err("license 格式错误".into()); }
    let payload_b64 = parts[0];
    let sig_b64url = parts[1];

    // base64url -> bytes
    let payload_bytes = base64url_to_vec(payload_b64).map_err(|e| format!("payload 解码失败: {}", e))?;
    let sig_bytes = base64url_to_vec(sig_b64url).map_err(|e| format!("sig 解码失败: {}", e))?;

    // parse payload JSON（payload_bytes 是 canonical JSON 字符串）
    let payload_str = String::from_utf8(payload_bytes.clone()).map_err(|e| format!("payload 非 utf8: {}", e))?;
    let payload: Payload = serde_json::from_str(&payload_str).map_err(|e| format!("payload JSON 解析失败: {}", e))?;

    // verify signature using embedded pubkey
    let pubkey_bytes = general_purpose::STANDARD.decode(PUBKEY_B64).map_err(|e| format!("公钥 base64 解码失败: {}", e))?;
    let pubkey = PublicKey::from_bytes(&pubkey_bytes).map_err(|e| format!("公钥解析失败: {}", e))?;
    let signature = Signature::from_bytes(&sig_bytes).map_err(|e| format!("签名解析失败: {}", e))?;

    pubkey.verify(&payload_bytes, &signature).map_err(|_| "签名验证失败".to_string())?;

    // 检查过期
    let now = SystemTime::now();
    let exp = payload.expiresAt.parse::<chrono::DateTime<chrono::Utc>>()
        .map_err(|_| "expiresAt 不是有效时间格式（ISO）".to_string())?;
    if exp <= chrono::Utc::now() {
        return Err("license 已过期".into());
    }

    // 获取本机 hwid
    let my_hwid = get().map_err(|e| format!("获取本机 HWID 失败: {}", e))?;

    // 如果 payload 中带 boundHwid（发卡时绑定了设备），则必须匹配
    if let Some(bound) = payload.boundHwid {
        if bound != my_hwid {
            return Err(format!("设备不匹配（boundHwid != 本机），bound: {}, local: {}", bound, my_hwid));
        }
    } else {
        // 如果没有 boundHwid，你可以选择：
        // 1) 拒绝：因为无法保证唯一性
        // 2) 或者将 licenseId 本地写入激活记录，视为“已在本机激活”
        // 这里我们拒绝（强制发卡端绑定 hwid 才能保证单机唯一）
        return Err("该 license 未绑定设备 hwid，无法保证唯一性。请使用已绑定 hwid 的 license。".into());
    }

    // 若通过所有检查，则返回成功
    Ok(format!("OK. licenseId: {}, product: {}", payload.licenseId, payload.product))
}

fn base64url_to_vec(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    let mut ss = s.replace('-', "+").replace('_', "/");
    while ss.len() % 4 != 0 { ss.push('='); }
    general_purpose::STANDARD.decode(ss)
}

// 注意：本文件不再定义 main()，命令在 src-tauri/src/main.rs 中注册
