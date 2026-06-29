// electron-builder custom Windows sign hook.
//
// Signs Windows executables with osslsigncode using our in-house, self-signed
// code-signing certificate so the installer/app show "Quantum Law Group" as the
// publisher instead of "Unknown publisher".
//
// Secrets are NOT stored in this (public) repo. The hook reads them from env:
//   WIN_CSC_PFX  — absolute path to the .pfx (PKCS#12) certificate
//   WIN_CSC_PASS — the .pfx password
// If WIN_CSC_PFX is unset the hook no-ops (leaves the file unsigned) so plain
// dev builds and CI without the cert still succeed.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

exports.default = async function sign(configuration) {
  const file = configuration.path
  const pfx = process.env.WIN_CSC_PFX
  const pass = process.env.WIN_CSC_PASS || ''
  if (!pfx) {
    console.log(`[sign] WIN_CSC_PFX not set — leaving ${path.basename(file)} unsigned`)
    return
  }
  const tmp = `${file}.signed`
  const base = [
    'sign',
    '-pkcs12', pfx,
    '-pass', pass,
    '-n', 'Quantum Law Group',
    '-i', 'https://github.com/noobling/quantumlawgroup',
    '-h', 'sha256'
  ]
  const withTs = [...base, '-ts', 'http://timestamp.digicert.com', '-in', file, '-out', tmp]
  const noTs = [...base, '-in', file, '-out', tmp]
  try {
    execFileSync('osslsigncode', withTs, { stdio: 'inherit' })
  } catch {
    // Timestamp server unreachable — sign without a timestamp rather than fail the build.
    console.warn('[sign] timestamped sign failed; retrying without timestamp')
    execFileSync('osslsigncode', noTs, { stdio: 'inherit' })
  }
  fs.renameSync(tmp, file)
  console.log(`[sign] signed ${path.basename(file)}`)
}
