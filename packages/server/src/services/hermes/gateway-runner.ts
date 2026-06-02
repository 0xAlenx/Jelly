import { spawn } from 'child_process'
import { getActiveProfileDir } from './hermes-profile'
import { isJellyManagedMode } from '../jellyai/managed-mode'
import { managedChildProcessEnv } from '../jellyai/managed-env'
import { getOrCreateLocalProxySecret } from '../jellyai/device-session'

export function managedGatewayProxyEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const port = source.PORT || '8648'
  const localProxySecret = getOrCreateLocalProxySecret()
  return {
    JELLY_MANAGED_MODE: '1',
    JELLY_LOCAL_MODEL_PROXY_URL: `http://127.0.0.1:${port}/api/jelly/model/v1`,
    JELLY_LOCAL_PROXY_SECRET: localProxySecret,
    JELLY_CLIENT_MODEL: source.JELLY_CLIENT_MODEL || 'jelly-managed',
    GATEWAY_PROXY_URL: `http://127.0.0.1:${port}/api/jelly/channel-agent`,
    GATEWAY_PROXY_KEY: localProxySecret,
  }
}

export function buildGatewayRunEnv(
  profileDir: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const jellyManaged = isJellyManagedMode(source)
  return {
    ...(jellyManaged ? managedChildProcessEnv(source) : source),
    HERMES_HOME: profileDir,
    ...(jellyManaged ? managedGatewayProxyEnv(source) : {}),
  }
}

export function startGatewayRunManaged(
  hermesBin: string,
  opts: { profileDir?: string } = {},
): { pid: number | null; reused: boolean } {
  const profileDir = opts.profileDir || getActiveProfileDir()
  const child = spawn(hermesBin, ['gateway', 'run', '--replace'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: buildGatewayRunEnv(profileDir),
  })
  child.unref()

  const pid = child.pid ?? null
  return { pid, reused: false }
}
