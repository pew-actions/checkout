import * as core from '@actions/core'
import * as fsHelper from './fs-helper'
import * as io from '@actions/io'
import * as os from 'os'
import * as perforceCommandManager from './p4-command-manager'
import {IPerforceCommandManager} from './p4-command-manager'
import {IPerforceSourceSettings} from './p4-source-settings'

export async function getSource(settings: IPerforceSourceSettings): Promise<void> {

  core.info(
    `Syncing repository: ${settings.repositoryName}`
  )

  // remove conflicting file path (file not directory)
  if (fsHelper.fileExistsSync(settings.repositoryPath)) {
    await io.rmRF(settings.repositoryPath)
  }

  // create directory
  if (!fsHelper.directoryExistsSync(settings.repositoryPath)) {
    await io.mkdirP(settings.repositoryPath)
  }

  // Perforce command manager
  core.startGroup('Getting Perforce version info')
  const p4 = await getPerforceCommandManager(settings)
  console.log(`P4 version ${await p4.version()}`)
  core.endGroup()

  const p4User = settings.authToken
  p4.setEnvironmentVariable('P4PORT', settings.repositoryName)
  p4.setEnvironmentVariable('P4USER', p4User)

  core.startGroup('Login to server')
  try {
    await p4.verifyLogin()
  } catch {
    throw 'Workflow must login to perforce before running checkout'
  }
  core.endGroup()

  core.startGroup('Get template workspace')
  const clientTemplate = await p4.client(settings.clientTemplate)
  core.endGroup()

  core.startGroup('Setting up client workspace')
  const clientName = settings.useClientTemplate ? settings.clientTemplate : `${settings.clientTemplate}_${os.hostname().replace('-', '_')}`
  let needSyncNone = false
  if (await p4.clientExists(clientName)) {
    const existingClient = await p4.client(clientName)
    if (existingClient.owner && existingClient.owner !== p4User) {
      throw new Error(`Client owner does not match, aborting. ${existingClient.owner} != ${p4User}`)
    }

    let rebuildClient = false

    // check the mappings match
    const templateMappings: Map<string, string> = new Map()
    for (const mapping of clientTemplate.view) {
      templateMappings.set(mapping.depot, mapping.client.replace(`//${settings.clientTemplate}/`, `//${clientName}/`))
    }
    for (const mapping of existingClient.view) {
      if (!templateMappings.has(mapping.depot)) {
        rebuildClient = true
        core.warning(`Client has extra mapping: ${mapping.depot} ${mapping.client}`)
      } else if (templateMappings.get(mapping.depot) !== mapping.client) {
        rebuildClient = true
        core.warning(`Client has extra mapping: ${mapping.depot} ${mapping.client}`)
      }

      templateMappings.delete(mapping.depot)
    }
    for (const mapping of templateMappings) {
      rebuildClient = true
      core.warning(`Client is missing mapping: ${mapping[0]} ${mapping[1]}`)
    }

    // ensure the host matches
    if (existingClient.host !== os.hostname()) {
      rebuildClient = true
      core.warning(`Client has mismatched host: ${existingClient.host} != ${os.hostname()}`)
    }

    // ensure root matches
    if (existingClient.root !== settings.repositoryPath) {
      rebuildClient = true
      core.warning(`Client has mismatched root: ${existingClient.root} != ${settings.repositoryPath}`)
    }

    if (rebuildClient) {
      needSyncNone = true

      existingClient.host = os.hostname()
      existingClient.root = settings.repositoryPath
      existingClient.view = []
      for (const mapping of clientTemplate.view) {
        existingClient.view.push({
          depot: mapping.depot,
          client: mapping.client.replace(`//${settings.clientTemplate}/`, `//${clientName}/`)
        })
      }

      console.log('Modifying client to match spec')
      await p4.editClient(existingClient)
    }

  } else {
    const newClient = await p4.client(settings.clientTemplate)
    newClient.client = clientName
    newClient.description = `Build template instance for ${os.hostname()}`
    newClient.host = os.hostname()
    newClient.root = settings.repositoryPath
    newClient.view = []
    for (const mapping of clientTemplate.view) {
      newClient.view.push({
        depot: mapping.depot,
        client: mapping.client.replace(`//${settings.clientTemplate}/`, `//${clientName}/`)
      })
    }

    console.log('Creating new client for build machine')
    await p4.editClient(newClient)
  }
  core.endGroup()

  p4.setEnvironmentVariable('P4CLIENT', clientName)

  if (needSyncNone) {
    core.startGroup('Purging client workspace to #none')
    core.warning('Client workspace changed. Resetting all files')
    await p4.syncK(`//${clientName}/...#none`)

    // re-create the checkout directory
    await io.rmRF(settings.repositoryPath)
    await io.mkdirP(settings.repositoryPath)

    core.endGroup()
  }

  core.startGroup('Restoring checkout directory')
  await p4.revert(`//${clientName}/...`)
  core.endGroup()

  core.startGroup('Checking out the ref')
  await p4.sync(`//${clientName}/...${settings.ref}`)
  core.endGroup()

  // get client workspace info
  console.log(`Changelist ${settings.ref}`)
  core.setOutput('commit', settings.ref)
}

async function getPerforceCommandManager(
  settings: IPerforceSourceSettings
): Promise<IPerforceCommandManager> {
  core.info(`Working directory is '${settings.repositoryPath}'`)
  return await perforceCommandManager.createCommandManager(settings.repositoryPath)
}
