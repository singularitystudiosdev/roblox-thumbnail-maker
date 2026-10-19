// Loads `.env` and resolves API keys server-side only. On macOS a key missing
// from the environment falls back to the login keychain, so no secret has to
// be written to disk.
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function loadDotEnv(root) {
  const file = join(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

function keychainValue(service) {
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null
  } catch {
    // `security` exits 44 when the item does not exist: an absent key, not a failure.
    return null
  }
}

function listEnv(name, fallback) {
  return (process.env[name] || fallback).split(',').map((s) => s.trim()).filter(Boolean)
}

/** Every distinct key for a provider, env first, then keychain services in order. */
function resolveKeys(envName, keychainEnvName, defaultServices) {
  const keys = []
  if (process.env[envName]) keys.push(process.env[envName])
  for (const service of listEnv(keychainEnvName, defaultServices)) {
    const value = keychainValue(service)
    if (value && !keys.includes(value)) keys.push(value)
  }
  return keys
}

let cached = null

export function config() {
  if (cached) return cached
  cached = {
    geminiKeys: resolveKeys('GEMINI_API_KEY', 'GEMINI_KEYCHAIN_SERVICES', 'gemini-api-key,nano-banana-gemini-key'),
    falKeys: resolveKeys('FAL_KEY', 'FAL_KEYCHAIN_SERVICES', 'cosmos-fal,fal-key'),
    imageProvider: process.env.IMAGE_PROVIDER || 'auto',
    imageModel: process.env.GEMINI_IMAGE_MODEL || null,
    falModel: process.env.FAL_IMAGE_MODEL || 'google/nano-banana-2.1/edit',
    textModel: process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash',
    judgeModels: listEnv('GEMINI_JUDGE_MODELS', 'gemini-3.1-pro-preview,gemini-3.5-flash'),
    falTextModel: process.env.FAL_TEXT_MODEL || 'anthropic/claude-haiku-5.5',
    falJudgeModel: process.env.FAL_JUDGE_MODEL || 'anthropic/claude-sonnet-5.5',
    styleReference: process.env.STYLE_REFERENCE || 'reference/day-67-prison-dig.png',
    styleReferenceName: process.env.STYLE_REFERENCE_NAME || 'DAY #67 prison dig',
    // The share of typed-name runs that draw all seven strategies so the selector keeps learning. Off by
    // default: an explore run costs seven images instead of two, so it runs only when asked
    // ("Try all 7 strategies" in the app, debug/explore.mjs) or when this is set.
    selectorExploreRate: Number(process.env.SELECTOR_EXPLORE_RATE ?? 0),
    // A picked run whose two thumbnails both score under this (of 50) draws two more from the runner-up; 0 turns it off.
    topUpBelow: Number(process.env.TOP_UP_BELOW ?? 40)
  }
  return cached
}
