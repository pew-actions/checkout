import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fshelper from './fs-helper'
import {PerforceVersion} from './p4-version'

export interface IPerforceCommandManager {
  verifyLogin(): Promise<void>
  client(name: string): Promise<PerforceClient>
  editClient(client: PerforceClient): Promise<void>
  clientExists(name: string): Promise<boolean>
  sync(spec: string): Promise<void>
  syncK(spec: string): Promise<void>
  revert(spec: string): Promise<void>
  getWorkingDirectory(): string
  setEnvironmentVariable(name: string, value: string): void
  version(): Promise<PerforceVersion>
}

export async function createCommandManager(
  workingDirectory: string,
): Promise<IPerforceCommandManager> {
  return await PerforceCommandManager.createCommandManager(
    workingDirectory,
  )
}

class PerforceCommandManager implements IPerforceCommandManager {
  private p4Env = {
  }
  private workingDirectory = ''
  private perforceVersion: PerforceVersion = new PerforceVersion()

  static async createCommandManager(
    workingDirectory: string
  ): Promise<PerforceCommandManager> {
    const result = new PerforceCommandManager()
    await result.initializeCommandManager(workingDirectory)
    return result
  }

  // private constructor; use createCommandManager
  private constructor() {}

  private async initializeCommandManager(workingDirectory: string): Promise<void> {
    this.workingDirectory = workingDirectory

    // P4 version
    core.debug('Getting p4 version')
    let p4Output = await this.execP4(['-V'])
    const match = p4Output.stdout.match(/Rev. P4\/\w+\/(\d+\.\d+)\/\d+ /)
    if (match) {
      this.perforceVersion = new PerforceVersion(match[1])
    }
    if (!this.perforceVersion.isValid()) {
      throw new Error('Unable to determine p4 version')
    }
  }

  async verifyLogin(): Promise<void> {
    await this.execP4(['login', '-s'])
  }

  async client(name: string): Promise<PerforceClient> {
    const output = await this.execP4(['-Mj', '-Ztag', 'client', '-o', name])
    const client = JSON.parse(output.stdout)

    const mappings: PerforceMapping[] = []
    for (const key of Object.keys(client)) {
      if (key.startsWith('View')) {
        const view = client[key]
        const parts = view.split(' ')
        if (parts.length !== 2) {
          throw new Error(`Invalid client view '${view}'`)
        }

        mappings.push({
          depot: parts[0],
          client: parts[1],
        })
      }
    }

    return {
      host: client.Host!,
      client: client.Client!,
      description: client.Description!,
      options: client.Options!,
      submitOptions: client.SubmitOptions!,
      lineEnd: client.LineEnd!,
      owner: client.Owner!,
      root: client.Root!,
      view: mappings,
    }
  }

  async editClient(client: PerforceClient): Promise<void>  {
    const spec: string[] = []
    spec.push(`Client:\t${client.client}`)
    spec.push(`Owner:\t${client.owner}`)
    spec.push(`Host:\t${client.host}`)
    spec.push('Description:')
    for (const line of client.description.split('\n')) {
      spec.push(`\t${line}`)
    }
    spec.push(`Root:\t${client.root}`)
    spec.push(`Options:\t${client.options}`)
    spec.push(`SubmitOptions:\t${client.submitOptions}`)
    spec.push(`LineEnd:\t${client.lineEnd}`)
    spec.push('View:')
    for (const mapping of client.view) {
      spec.push(`\t${mapping.depot} ${mapping.client}`)
    }

    console.log(spec.join('\n'))
    await this.execP4(['client', '-i'], spec.join('\n'))
  }

  async clientExists(name: string): Promise<boolean> {
    const output = await this.execP4(['clients', '-e', name])
    if (output.stdout) {
      return true
    }

    return false
  }

  async sync(spec: string): Promise<void> {
    await this.execP4(['sync', spec])
  }

  async syncK(spec: string): Promise<void> {
    await this.execP4(['sync', '-k', spec])
  }

  async revert(spec: string): Promise<void> {
    await this.execP4(['clean', '-a', '-d', '-e', spec])
  }

  getWorkingDirectory(): string {
    return this.workingDirectory
  }

  setEnvironmentVariable(name: string, value: string): void {
    this.p4Env[name] = value
  }

  async version(): Promise<PerforceVersion> {
    return this.perforceVersion
  }

  private async execP4(
    args: string[],
    input = '',
    allowAllExitCodes = false,
    silent = false,
    customListeners = {}
  ): Promise<PerforceOutput> {
    fshelper.directoryExistsSync(this.workingDirectory, true)

    const result = new PerforceOutput()

    const env = {}
    for (const key of Object.keys(process.env)) {
      env[key] = process.env[key]
    }
    for (const key of Object.keys(this.p4Env)) {
      env[key] = this.p4Env[key]
    }

    const defaultListener = {
      stdout: (data: Buffer) => {
        stdout.push(data.toString())
      }
    }

    const mergedListeners = {...defaultListener, ...customListeners}
    const stdout: string[] = []
    const options = {
      cwd: this.workingDirectory,
      env,
      silent,
      ignoreReturnCode: allowAllExitCodes,
      listeners: mergedListeners,
      input: input ? Buffer.from(input!) : undefined,
    }

    result.exitCode = await exec.exec('p4.exe', args, options)
    result.stdout = stdout.join('')

    core.debug(result.exitCode.toString())
    core.debug(result.stdout)
    return result
  }
}

class PerforceOutput {
  stdout = ''
  exitCode = 0
}

type PerforceMapping = {
  depot: string,
  client: string,
}

type PerforceClient = {
  host: string
  client: string
  description: string
  options: string
  submitOptions: string
  lineEnd: string
  owner: string
  root: string
  view: PerforceMapping[]
}
