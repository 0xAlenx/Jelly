import { cp, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { detectHermesRootHome } from '../hermes/hermes-path'
import { HermesSkillInjector } from '../hermes/skill-injector'
import { hostedProfileName } from './web-hosted-mode'

async function copyIfPresent(source: string, target: string): Promise<void> {
  if (!existsSync(source) || existsSync(target)) return
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true })
}

export async function ensureHostedProfile(accountId: string, localProxySecret: string): Promise<string> {
  const root = detectHermesRootHome()
  const profile = hostedProfileName(accountId)
  const profileDir = join(root, 'profiles', profile)

  await mkdir(profileDir, { recursive: true })
  await copyIfPresent(join(root, 'config.yaml'), join(profileDir, 'config.yaml'))
  await copyIfPresent(join(root, 'SOUL.md'), join(profileDir, 'SOUL.md'))
  await new HermesSkillInjector(undefined, HermesSkillInjector.resolveTargetDirForProfile(profile, root)).injectMissingSkills()

  const envPath = join(profileDir, '.env')
  let current = ''
  try {
    current = await readFile(envPath, 'utf8')
  } catch {}
  const withoutProxySecret = current
    .split(/\r?\n/)
    .filter(line => !line.startsWith('JELLY_LOCAL_PROXY_SECRET='))
    .filter(Boolean)
  await writeFile(envPath, `${[...withoutProxySecret, `JELLY_LOCAL_PROXY_SECRET=${localProxySecret}`].join('\n')}\n`, { mode: 0o600 })
  return profile
}
