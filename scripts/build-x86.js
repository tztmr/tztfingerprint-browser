const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Building x86 Windows executable...');

// Set environment variables for x86 build
process.env.TAURI_ARCH = 'x86';
process.env.CARGO_BUILD_TARGET = 'i686-pc-windows-msvc';

// Build the frontend first
console.log('📦 Building frontend...');
try {
  execSync('npm run build --prefix ./ui', { stdio: 'inherit' });
  console.log('✅ Frontend built successfully');
} catch (error) {
  console.error('❌ Frontend build failed:', error.message);
  process.exit(1);
}

// Install Rust target for x86 Windows if not already installed
console.log('🔧 Installing x86 Windows target...');
try {
  execSync('rustup target add i686-pc-windows-msvc', { stdio: 'inherit' });
  console.log('✅ x86 Windows target installed');
} catch (error) {
  console.log('ℹ️  x86 Windows target may already be installed');
}

// Build the Tauri application for x86 Windows
console.log('🏗️  Building Tauri application for x86 Windows...');
try {
  // Change to src-tauri directory and build with cargo directly
  process.chdir('src-tauri');
  execSync('cargo build --release --target i686-pc-windows-msvc', { stdio: 'inherit' });
  
  // Package with Tauri
  process.chdir('..');
  execSync('npm run tauri build -- --target i686-pc-windows-msvc', { stdio: 'inherit' });
  console.log('✅ x86 Windows executable built successfully');
} catch (error) {
  console.error('❌ Tauri build failed:', error.message);
  process.exit(1);
}

console.log('🎉 x86 Windows executable packaging complete!');
console.log('📁 Output should be in: src-tauri/target/i686-pc-windows-msvc/release/bundle/nsis/');